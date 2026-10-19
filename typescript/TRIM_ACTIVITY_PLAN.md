# Trim Activity Records — Implementation Plan

## Goal

Let a user **trim records off an activity** — primarily chop the last few
seconds/points off the end (you crossed the finish line but kept recording), and
optionally trim from the start. The trim must **update the Postgres backend
correctly** and keep all derived/summary data (session, lap, activity totals)
consistent so every downstream view (details, map, charts, laps, auto-laps,
calendar, report, FIT export) reflects the trimmed activity.

This is destructive (it deletes `record` rows). The plan treats correctness and
reversibility as first-class concerns.

---

## 1. How the data model works today (verified)

No DDL lives in the repo — the Postgres schema is populated by an external FIT
importer. The shapes below are inferred from the queries in
`apps/server/src/routes/*` and `apps/server/src/lib/*`.

### Tables and the columns the app reads

- **`record`** (one row per GPS/sensor sample) — `record_id`, `activity_id`,
  `timestamp`, `latitude`, `longitude`, `lap`, `altitude`, `heart_rate`,
  `cadence`, `fractional_cadence`, `enhanced_speed`, `distance`.
  - `distance` is a **cumulative odometer** (meters from activity start).
  - Records are ordered by `timestamp ASC` everywhere.
  - Each record carries a `lap` number linking it to a lap.
- **`session`** (one row per leg; multisport has >1) — summary fields:
  `total_distance`, `total_timer_time`, `total_elapsed_time`, `avg_power`,
  `avg_heart_rate`, `max_heart_rate`, `enhanced_avg_speed`, `avg_speed`,
  `total_ascent`, `total_descent`, `first_lap_index`, `num_laps`, `pool_length`,
  `start_time`, `timestamp`, `sport`, `sub_sport`.
- **`lap`** — `lap_id`, `activity_id`, `start_time`, `number`, `total_distance`,
  `total_timer_time`, `total_ascent`, `total_descent`, HR/power/running-dynamics
  aggregates, `intensity`.
- **`event`** — `activity_id`, `timestamp`, `event`, `event_type` (timer
  stop_all/start pairs drive pause removal).
- **`length`** — swim lengths (`message_index`, `total_timer_time`,
  `total_strokes`, `avg_speed`, `swim_stroke`, `length_type`).
- **`activity`** — `activity_id`, `timestamp`, `local_timestamp`,
  `activity_name`, `description`, `category`, `workout_feel`, `effort`,
  `total_timer_time`, **`adjusted_distance`**, **`adjusted_duration`**,
  `num_sessions`, `type`, `event`, `event_type`.
  - The details route exposes `adjusted_distance AS distance` and
    `adjusted_duration AS duration`.

### The critical finding: summaries are IMPORTED, not recomputed

There is **no existing server-side logic that recomputes session/lap/activity
summaries from raw records**. Summary fields come straight from the FIT import.
The only derivation that exists is the "totals = SUM(sessions)" relationship for
`activity.adjusted_distance/adjusted_duration`, implemented in
`sessions.ts` (PATCH) and `activities.ts` (PATCH). `auto-laps.ts` and
`records.ts` compute things on the fly from records at read time but never write
back.

**Implication:** a correct trim cannot just delete `record` rows — it must also
recompute and write the affected session + lap + activity summary fields from
the surviving records, because nothing else will. This is the bulk of the work.

### Existing write conventions to mirror

- Routes are Hono instances in `apps/server/src/routes/<name>.ts`, mounted in
  `apps/server/src/index.ts`.
- DB access: `sql` + `SCHEMA` from `../db.js`; `postgres` auto-converts
  snake_case ↔ camelCase. Multi-statement writes use `sql.begin(tx => …)`.
- Every write route calls `assertPrimaryWriteSchema(c.req.query("schema"))`
  first and returns 400 for a non-primary `?schema=` (writes only ever hit the
  primary schema).
- Input validated with Zod.
- Mutations return `{ success: true, sql: string | null }` (an equivalent SQL
  string for transparency/debugging) — the trim route should follow suit.
- Client mutations live in `apps/client/src/api/mutations.ts` using
  `useMutation` + `queryClient.invalidateQueries`.

---

## 2. Design decisions

### 2a. Trim granularity — start with "trim the tail by time"

The core use case is "drop the last N seconds." The cleanest, most intuitive
contract is a **keep-window**: the user picks a new **end** (and optionally a new
**start**) and everything outside it is deleted.

Recommended API shape (absolute, idempotent — not a relative "drop 5s", which is
dangerous to re-apply):

```
POST /api/activities/:id/trim
Body: {
  // Keep only records with timestamp in [trimStart, trimEnd] (inclusive).
  // Both optional; omitting one leaves that end untouched.
  trimStart?: string;   // ISO timestamp
  trimEnd?: string;     // ISO timestamp
  // Optional multisport scoping: when the activity has >1 session, restrict the
  // trim to one leg. Omit for single-session activities.
  sessionId?: number;
  debugSql?: boolean;
}
```

Why absolute timestamps over "drop last N seconds":
- Idempotent — re-sending the same request is a no-op, not a second trim.
- Matches the existing multisport session-window concept already used by
  `auto-laps` (`?start`/`?end` ISO params), so the UI can reuse range-picking.
- The UI can still *present* it as "drop last 5s" and compute the absolute
  `trimEnd = lastRecordTs − 5s` client-side.

Phase 1 (MVP) can implement **`trimEnd` only** (tail trim), which covers the
stated goal. `trimStart` and `sessionId` are natural phase-2 extensions that the
same route can grow into.

### 2b. Single-session vs multisport

- **Single-session (≤1 session):** the activity is the source of truth (same as
  `activities.ts`). Recompute the one session, its laps, and sync
  `activity.adjusted_distance/adjusted_duration`.
- **Multisport (>1 session):** trimming across legs is ambiguous. For the MVP,
  **only support trimming the last leg's tail** (or require `sessionId`), then
  recompute that session + its laps, and re-derive activity totals as
  SUM(sessions) exactly like `sessions.ts` already does. If `sessionId` is
  omitted on a multisport activity and the trim window would cross a leg
  boundary, return **409** with a clear message (mirrors the existing multisport
  409 in `activities.ts`).

### 2c. Reversibility / safety (important — this deletes data)

Deleting `record` rows is irreversible once committed. Options, pick per appetite:

1. **Soft-trim (recommended, safest):** add a boolean/time marker rather than
   deleting. E.g. keep rows but filter them out everywhere. **Rejected** for the
   MVP because it requires touching every read query (records, auto-laps, export,
   etc.) and the schema is externally managed — high blast radius.
2. **Hard delete inside a transaction (recommended for MVP):** delete the
   out-of-window records and recompute summaries in one `sql.begin`. Pair it with
   a **pre-trim FIT export safety net**: the app already has a full FIT exporter
   (`lib/activity-fit.ts` + `routes/export.ts`) that reconstructs the activity
   from DB rows. Before trimming, the client can offer/trigger a download of the
   original `.fit` so the user always has a restore artifact. Document this
   clearly in the confirm dialog.
3. **Backup table:** copy deleted rows into a `*_trim_backup` table. Clean but
   requires DDL in an externally-managed DB — out of scope unless you own
   migrations.

**MVP choice:** option 2 (transactional hard delete) + a mandatory confirmation
dialog + an offer to export the original first. Revisit soft-trim later if
restore-in-app is desired.

---

## 3. Recomputation: what must be rewritten after deleting records

All recomputation happens **server-side, from the surviving records**, inside
the same transaction as the delete. Build one reusable helper (see §4) so the
math lives in a single, tested place.

Given the surviving, in-window records (ordered by timestamp) and that leg's
timer events:

- **Session (`total_*`)**
  - `total_distance` = `lastRecord.distance − firstRecord.distance`
    (cumulative odometer; rebased to the leg).
  - `total_elapsed_time` = `lastTs − firstTs` (wall clock).
  - `total_timer_time` = elapsed minus paused intervals (reuse the pause-interval
    logic already in `records.ts::computeElapsedTimes` and
    `auto-laps.ts` — stop_all/start pairs).
  - `total_ascent` / `total_descent` = recompute with the smoothed-altitude +
    0.6 m dead-band algorithm already in `auto-laps.ts` (factor it out, see §4).
  - `avg_heart_rate` / `max_heart_rate`, `avg_speed`/`enhanced_avg_speed`,
    `avg_power` = aggregate over surviving records (avg over non-null, max over
    non-null). Power may be absent for runs.
  - `num_laps` = number of laps that still have ≥1 surviving record (see below).
- **Laps**
  - Reassign/trim the last partial lap: the lap containing the new boundary gets
    recomputed (`total_distance`, `total_timer_time`, ascent/descent, HR) from
    its surviving records; laps entirely outside the window are **deleted**, and
    `session.num_laps` / `session.first_lap_index` kept consistent. For a
    tail-only trim, usually only the final lap changes and zero-or-more trailing
    laps are removed.
- **Activity**
  - Single-session: set `adjusted_distance`/`adjusted_duration` to the session's
    recomputed `total_distance`/`total_timer_time` (and keep the lone session in
    sync, exactly like `activities.ts`).
  - Multisport: re-derive `adjusted_distance`/`adjusted_duration` as
    `SUM(session.total_distance|total_timer_time)` across all legs (copy the
    pattern in `sessions.ts`).
- **Events** — drop timer events outside the kept window (so pause math and FIT
  export stay consistent). An `stop_all` at the very end that becomes orphaned
  should be dropped or clamped.
- **Lengths** (swims) — out of MVP scope; if the activity has `length` rows,
  either reject with a clear 422 for phase 1, or extend later.
- **Elevation cache** — `routes/records.ts` caches corrected elevations keyed by
  `schema__activityId.json` and keyed by **record count**. After a trim the
  count changes so the cache self-invalidates, but to be safe **delete the cache
  file** for the activity in the trim route (same `getCachePath` logic).

---

## 4. Reuse opportunity: extract a shared summary helper

Right now the pause-interval math and the smoothed-ascent/descent math are
duplicated inside `auto-laps.ts` and `records.ts`. Introduce a new lib,
`apps/server/src/lib/record-aggregates.ts`, exporting:

- `buildPauseIntervals(events)` → `{start,end}[]`
- `movingSeconds(records, pauses)` → number
- `ascentDescent(records)` → `{ ascentM, descentM }` (smoothing + dead-band)
- `recordAggregates(records)` → `{ avgHr, maxHr, avgSpeedMps, maxSpeedMps, avgPower }`
- `sessionSummaryFromRecords(records, events)` → the full session field set

Then refactor `auto-laps.ts` and `records.ts` to call it (behavior-preserving),
and have the trim route use it too. This keeps the trim math honest and avoids a
third copy. (If you'd rather minimize churn for the MVP, implement the helper
fresh in the trim route and schedule the dedupe as a follow-up — but the shared
helper is the right long-term call.)

---

## 5. Server implementation steps

Owner: **server** agent (write-scope `apps/server/src/**`, `packages/shared/src/**`,
`README.md`). All work is inside its allowed paths.

1. **Shared types** (`packages/shared/src/types.ts`): add
   `TrimActivityPayload` (`trimStart?`, `trimEnd?`, `sessionId?`, `debugSql?`)
   and `TrimActivityResponse` (`{ success: true; removedRecords: number;
   removedLaps: number; sql: string | null }`). Export from
   `packages/shared/src/index.ts`. (shared-types agent territory, but server
   agent also has write access here.)
2. **Lib** (`apps/server/src/lib/record-aggregates.ts`): implement the helpers in
   §4. Add JSDoc.
3. **Route** (`apps/server/src/routes/trim.ts`, new): `POST /:id/trim`.
   - `assertPrimaryWriteSchema` guard → 400 on non-primary schema.
   - Zod-validate body; require at least one of `trimStart`/`trimEnd`; validate
     the window is within the activity's record span and leaves ≥2 records.
   - Determine single vs multisport (`SELECT COUNT(*) FROM session`), apply the
     §2b rules (409 for ambiguous multisport).
   - Reject swims with `length` rows (422) for the MVP.
   - In `sql.begin`:
     a. `DELETE FROM record WHERE activity_id = :id AND (timestamp < trimStart OR
        timestamp > trimEnd)` (scoped to the leg when `sessionId` given).
     b. `DELETE FROM event …` outside the window.
     c. `DELETE FROM lap …` for laps with no surviving records; recompute the
        boundary lap.
     d. Recompute + `UPDATE session …` via the §4 helper.
     e. Sync `activity` totals (single-session set; multisport SUM).
   - Delete the elevation cache file for the activity.
   - Return `TrimActivityResponse` (+ debug SQL when asked).
   - Add the doc comment block at the top of the file (method/path/params/
     response) per the server agent's documentation convention.
4. **Mount** in `apps/server/src/index.ts`:
   `app.route("/api/activities", trimRoutes)` (alongside the other
   `/api/activities` sub-routers).
5. **README**: add the route to the Features/API section.
6. Run `bunx biome check .` and build (`bun build apps/server/src/index.ts …`).

---

## 6. Client implementation steps

Owner: **frontend** agent (write-scope `apps/client/src/**`, `packages/shared/src/**`,
`README.md`).

1. **Mutation** (`apps/client/src/api/mutations.ts`): `useTrimActivity(activityId)`
   → `POST /api/activities/:id/trim`. On success invalidate:
   `queryKeys.activity(id)` (prefix also covers records/laps/sessions/auto-laps),
   `queryKeys.calendar`, `queryKeys.report`, plus the records query key so the
   map/charts refetch.
2. **UI** — add a "Trim" affordance on `ActivityDetailsPage`. Two options:
   - **Simple (MVP):** a "Trim end" control = a number input "drop last N
     seconds" + a confirm dialog. The page already holds the records (ordered),
     so compute `trimEnd = lastRecord.timestamp − N s` client-side and send it.
   - **Richer (phase 2):** a draggable range selector over the existing
     time-series/map. `ActivityDetailsPage` already tracks a `selectedRange`
     concept (passed to `DetailMap`), so a range-based trim could reuse it.
3. **Confirmation + safety:** a modal using the existing `Dialog` component
   (`apps/client/src/components/ui/Dialog.tsx`) that states this permanently
   deletes records, shows the before/after distance + duration, and offers
   "Download original .fit first" (hit the existing export endpoint) before
   confirming. Match the project's dark theme; per the frontend agent's steering,
   destructive confirm actions should use a red accent (`bg-red-600`).
4. Reflect the new totals after success (React Query invalidation handles this).
5. **README**: note the trim feature in the client features list.

---

## 7. Edge cases & guards

- Reject trims that would leave **< 2 records** (auto-laps/charts need ≥2).
- Clamp `trimStart`/`trimEnd` to the activity's actual record span; 400 if the
  window is empty or inverted.
- Rebase nothing in the DB: `record.distance` stays an absolute odometer, so
  session `total_distance` is `last.distance − first.distance` — don't rewrite
  per-record distances (keeps the delete cheap and avoids corrupting the
  odometer).
- Orphaned trailing `stop_all` event with no matching `start` → drop it.
- Multisport ambiguity → 409 (don't guess).
- Swim `length` rows present → 422 for MVP (documented limitation).
- Elevation cache file removed so stale corrected-altitudes don't resurface.
- Concurrency: the whole mutation is one transaction; React Query invalidation
  refetches the consistent post-trim state.

---

## 8. Verification

- **Types/build:** `bunx tsc` (server has no typecheck script — use `tsc
  --noEmit` ad hoc or the client's `tsc -b`), `bunx biome check .`, build both
  apps.
- **Manual/API test:** pick a real activity, record its `record` count +
  session `total_distance`/`total_timer_time`, POST a `trimEnd` a few seconds
  before the last record, then assert: record count dropped, session totals
  shrank by roughly the trimmed tail, `activity.adjusted_*` matches the session,
  the final lap shrank, `/api/records`, `/api/auto-laps`, and the FIT export all
  reflect the shorter activity. Use `debugSql: true` to inspect the statements.
- **Round-trip:** export the trimmed activity to `.fit` and confirm it decodes
  (the encoder reads the same rows we rewrote).

---

## 9. Suggested delivery order (phased)

1. **Phase 1 (MVP, covers the stated goal):** server `record-aggregates.ts`
   helper + `trim.ts` route supporting **`trimEnd` on single-session activities**
   with full session/lap/activity recomputation; client "drop last N seconds" +
   confirm dialog + invalidation. Reject multisport/swim with clear errors.
2. **Phase 2:** `trimStart` (head trim) and multisport per-leg trim via
   `sessionId`; range-selector UI reusing `selectedRange`.
3. **Phase 3:** swim `length` support; optional soft-trim/restore or backup
   table if in-app undo is desired.
4. **Follow-up refactor:** dedupe pause/ascent math out of `auto-laps.ts` and
   `records.ts` into the shared helper (if not already done in phase 1).

---

## 10. Agent split

- **shared-types** (or server): `TrimActivityPayload`/`TrimActivityResponse` in
  `packages/shared`.
- **server**: `lib/record-aggregates.ts`, `routes/trim.ts`, mount in `index.ts`,
  README API section.
- **frontend**: `useTrimActivity` mutation, trim UI + confirm dialog on
  `ActivityDetailsPage`, README feature note.
- **architect** (read-only): good fit to review the recomputation math and the
  destructive-delete safety story before implementation.
