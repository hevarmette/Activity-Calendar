import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
/**
 * Trim route — destructively trim records off the ends of an activity.
 *
 * POST /api/activities/:id/trim
 *   Query: ?schema=<name> (writes only ever hit the primary schema; a non-empty,
 *     non-primary schema is rejected with 400)
 *   Body: TrimActivityPayload {
 *     trimStart?: string;   // ISO timestamp — keep records at/after this instant
 *     trimEnd?: string;     // ISO timestamp — keep records at/before this instant
 *     sessionId?: number;   // reserved for multisport (phase 2); unused here
 *     debugSql?: boolean;   // include equivalent SQL in the response
 *   }
 *   Response: TrimActivityResponse {
 *     success: true;
 *     removedRecords: number;   // deleted `record` rows
 *     removedLaps: number;      // deleted `lap` rows (left with no records)
 *     sql: string | null;       // equivalent SQL when debugSql, else null
 *   }
 *
 * Phase 1 supports tail/head trims (`trimEnd` and/or `trimStart`) on
 * single-session activities. The keep-window is the inclusive timestamp range
 * [keepStart, keepEnd]; records outside it are deleted and the surviving
 * session/lap/activity summaries are recomputed from the survivors (nothing
 * else in the stack derives those fields — they are imported from the FIT file).
 *
 * Error contract:
 *   - 400 non-primary `?schema=`, unparseable trimStart/trimEnd, neither bound
 *     provided, or an empty/inverted window / fewer than 2 surviving records.
 *   - 404 when the activity has no sessions.
 *   - 409 multisport activity (> 1 session) — not supported in phase 1.
 *   - 422 swim activity (has `length` rows) — not supported in phase 1.
 */
import type { TrimActivityPayload, TrimActivityResponse } from "@activity-calendar/shared";
import { Hono } from "hono";
import { z } from "zod";
import sql, { assertPrimaryWriteSchema, SCHEMA, UnknownSchemaError } from "../db.js";
import {
	ascentDescent,
	buildPauseIntervals,
	movingSeconds,
	recordAggregates,
	sessionSummaryFromRecords,
} from "../lib/record-aggregates.js";

export const trimRoutes = new Hono();

/**
 * On-disk elevation cache directory. Must match the convention in
 * `routes/records.ts` (`CACHE_DIR/${schema}__${activityId}.json`) so the trim
 * invalidates the same cached corrected-altitudes the records route writes.
 * The private helpers there are not exported, so the tiny path logic is
 * replicated here rather than imported.
 */
const CACHE_DIR = join(import.meta.dirname ?? ".", ".elevation-cache");

/** Elevation cache file path for an activity, matching records.ts. */
function cachePath(schema: string, activityId: number): string {
	return join(CACHE_DIR, `${schema}__${activityId}.json`);
}

/** An ISO-8601 timestamp string that `Date.parse` accepts. */
const isoTimestamp = z
	.string()
	.refine((v) => Number.isFinite(Date.parse(v)), { message: "must be a parseable ISO timestamp" });

const trimSchema = z
	.object({
		trimStart: isoTimestamp.optional(),
		trimEnd: isoTimestamp.optional(),
		sessionId: z.number().int().positive().optional(),
		debugSql: z.boolean().optional(),
	})
	.refine((b) => b.trimStart !== undefined || b.trimEnd !== undefined, {
		message: "at least one of trimStart or trimEnd is required",
	}) satisfies z.ZodType<TrimActivityPayload>;

/**
 * POST /api/activities/:id/trim — trim records off an activity (phase 1).
 *
 * Deletes out-of-window `record` and timer `event` rows, drops laps left with
 * no surviving records, recomputes the boundary lap and the session summary
 * from survivors, and syncs the single-session activity totals — all in one
 * transaction. Afterwards the activity's elevation cache file is removed.
 */
trimRoutes.post("/:id/trim", async (c) => {
	try {
		assertPrimaryWriteSchema(c.req.query("schema"));
	} catch (err) {
		if (err instanceof UnknownSchemaError)
			return c.json({ error: `Writes are only allowed on the primary schema (got '${err.schemaName}')` }, 400);
		throw err;
	}

	const activityId = Number(c.req.param("id"));

	const parsed = trimSchema.safeParse(await c.req.json());
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", details: parsed.error.flatten() }, 400);
	}
	const body = parsed.data;

	// Load this activity's sessions (the source of truth for single vs multisport).
	const sessions = await sql<
		{ sessionId: number; avgPower: number | null; enhancedAvgSpeed: number | null; avgSpeed: number | null }[]
	>`
		SELECT session_id, avg_power, enhanced_avg_speed, avg_speed
		FROM ${sql(SCHEMA)}.session
		WHERE activity_id = ${activityId}
		ORDER BY start_time ASC
	`;
	if (sessions.length === 0) return c.json({ error: "Not found" }, 404);
	if (sessions.length > 1) {
		return c.json(
			{
				error: "Trimming a multisport activity is not supported yet; it has more than one session (leg).",
			},
			409,
		);
	}
	const session = sessions[0]!;

	// Swim lengths are out of phase-1 scope.
	const lengthRows = await sql<{ n: number }[]>`
		SELECT COUNT(*)::int AS n
		FROM ${sql(SCHEMA)}.length
		WHERE activity_id = ${activityId}
	`;
	if ((lengthRows[0]?.n ?? 0) > 0) {
		return c.json({ error: "Trimming swim activities (with length rows) is not supported yet." }, 422);
	}

	// Load all records (ordered) and timer events for the activity.
	const [records, events] = await Promise.all([
		sql<
			{
				recordId: number;
				timestamp: string;
				distance: number | null;
				altitude: number | null;
				heartRate: number | null;
				enhancedSpeed: number | null;
				cadence: number | null;
				lap: number;
				latitude: number | null;
				longitude: number | null;
			}[]
		>`
			SELECT record_id, "timestamp", distance, altitude, heart_rate,
				enhanced_speed, cadence, lap, latitude, longitude
			FROM ${sql(SCHEMA)}.record
			WHERE activity_id = ${activityId}
			ORDER BY "timestamp" ASC
		`,
		sql<{ timestamp: string; event: string; eventType: string }[]>`
			SELECT "timestamp", event, event_type
			FROM ${sql(SCHEMA)}.event
			WHERE activity_id = ${activityId} AND event = 'timer'
			ORDER BY "timestamp" ASC
		`,
	]);

	if (records.length < 2) {
		return c.json({ error: "Activity has too few records to trim (need at least 2)." }, 400);
	}

	// Record time span (epoch ms), used to clamp the requested window.
	const firstTs = Date.parse(records[0]!.timestamp);
	const lastTs = Date.parse(records[records.length - 1]!.timestamp);

	const requestedStart = body.trimStart !== undefined ? Date.parse(body.trimStart) : firstTs;
	const requestedEnd = body.trimEnd !== undefined ? Date.parse(body.trimEnd) : lastTs;

	// Clamp to the actual record span.
	const keepStartMs = Math.max(firstTs, Math.min(requestedStart, lastTs));
	const keepEndMs = Math.min(lastTs, Math.max(requestedEnd, firstTs));

	if (keepEndMs <= keepStartMs) {
		return c.json({ error: "Trim window is empty or inverted." }, 400);
	}

	// Survivors inside the inclusive [keepStart, keepEnd] window.
	const survivors = records.filter((r) => {
		const t = Date.parse(r.timestamp);
		return t >= keepStartMs && t <= keepEndMs;
	});
	if (survivors.length < 2) {
		return c.json({ error: "Trim would leave fewer than 2 records; refusing." }, 400);
	}

	// ISO strings for the clamped window, for parameterized SQL comparisons.
	const keepStartIso = new Date(keepStartMs).toISOString();
	const keepEndIso = new Date(keepEndMs).toISOString();

	// Events spanning the kept window (for pause-aware recomputation).
	const survivingEvents = events.filter((e) => {
		const t = Date.parse(e.timestamp);
		return t >= keepStartMs && t <= keepEndMs;
	});

	// Laps that keep at least one record vs. those fully outside the window.
	const survivingLapNumbers = new Set(survivors.map((r) => r.lap));
	const allLapNumbers = new Set(records.map((r) => r.lap));
	const removedLapNumbers = [...allLapNumbers].filter((n) => !survivingLapNumbers.has(n));

	// The boundary lap = the last surviving lap (its tail is what got trimmed).
	const boundaryLap = survivors[survivors.length - 1]!.lap;
	const boundaryLapRecords = survivors.filter((r) => r.lap === boundaryLap);

	// Recompute the session from survivors.
	const summary = sessionSummaryFromRecords(survivors, survivingEvents);
	const numLaps = survivingLapNumbers.size;

	// Recompute the boundary lap aggregates.
	const boundaryPauses = buildPauseIntervals(survivingEvents);
	const boundaryMoving = movingSeconds(boundaryLapRecords, boundaryPauses);
	const boundaryElev = ascentDescent(boundaryLapRecords);
	const boundaryAgg = recordAggregates(boundaryLapRecords);
	const boundaryFirst = boundaryLapRecords[0]!;
	const boundaryLast = boundaryLapRecords[boundaryLapRecords.length - 1]!;
	const boundaryDistance = (boundaryLast.distance ?? 0) - (boundaryFirst.distance ?? 0);

	// Preserve an existing session avg_power when the records carry no power
	// column to recompute from (records never select power) — null would clobber
	// imported data.
	const nextAvgPower = summary.avgPower ?? session.avgPower;
	const nextAvgSpeed = summary.avgSpeedMps ?? session.avgSpeed;
	const nextEnhancedAvgSpeed = summary.avgSpeedMps ?? session.enhancedAvgSpeed;

	const removedRecords = await sql.begin(async (tx) => {
		// a. Delete out-of-window records.
		const deleted = await tx<{ recordId: number }[]>`
			DELETE FROM ${sql(SCHEMA)}.record
			WHERE activity_id = ${activityId}
				AND ("timestamp" < ${keepStartIso} OR "timestamp" > ${keepEndIso})
			RETURNING record_id
		`;

		// b. Delete timer events outside the window (drops any orphaned trailing
		//    stop_all with no matching start, since it falls past keepEnd).
		await tx`
			DELETE FROM ${sql(SCHEMA)}.event
			WHERE activity_id = ${activityId}
				AND event = 'timer'
				AND ("timestamp" < ${keepStartIso} OR "timestamp" > ${keepEndIso})
		`;

		// c. Delete laps that lost all their records, then recompute the boundary lap.
		if (removedLapNumbers.length > 0) {
			await tx`
				DELETE FROM ${sql(SCHEMA)}.lap
				WHERE activity_id = ${activityId}
					AND number IN ${tx(removedLapNumbers)}
			`;
		}
		await tx`
			UPDATE ${sql(SCHEMA)}.lap
			SET
				total_distance = ${boundaryDistance},
				total_timer_time = ${boundaryMoving},
				total_ascent = ${boundaryElev.ascentM},
				total_descent = ${boundaryElev.descentM},
				avg_heart_rate = ${boundaryAgg.avgHr},
				max_heart_rate = ${boundaryAgg.maxHr}
			WHERE activity_id = ${activityId} AND number = ${boundaryLap}
		`;

		// d. Recompute + update the session row.
		await tx`
			UPDATE ${sql(SCHEMA)}.session
			SET
				total_distance = ${summary.totalDistance},
				total_elapsed_time = ${summary.totalElapsedTime},
				total_timer_time = ${summary.totalTimerTime},
				total_ascent = ${summary.totalAscent},
				total_descent = ${summary.totalDescent},
				avg_heart_rate = ${summary.avgHeartRate},
				max_heart_rate = ${summary.maxHeartRate},
				avg_speed = ${nextAvgSpeed},
				enhanced_avg_speed = ${nextEnhancedAvgSpeed},
				avg_power = ${nextAvgPower},
				num_laps = ${numLaps}
			WHERE session_id = ${session.sessionId}
		`;

		// e. Single-session: sync the activity totals to the lone session.
		await tx`
			UPDATE ${sql(SCHEMA)}.activity
			SET
				adjusted_distance = ${summary.totalDistance},
				adjusted_duration = ${summary.totalTimerTime}
			WHERE activity_id = ${activityId}
		`;

		return deleted.length;
	});

	// Invalidate the on-disk elevation cache (record count/positions changed).
	const elevCache = cachePath(SCHEMA, activityId);
	if (existsSync(elevCache)) unlinkSync(elevCache);

	let sqlString: string | null = null;
	if (body.debugSql === true) {
		const lapDeleteSql =
			removedLapNumbers.length > 0
				? `DELETE FROM ${SCHEMA}.lap WHERE activity_id = ${activityId} AND number IN (${removedLapNumbers.join(", ")}); `
				: "";
		sqlString = [
			`DELETE FROM ${SCHEMA}.record WHERE activity_id = ${activityId} AND ("timestamp" < '${keepStartIso}' OR "timestamp" > '${keepEndIso}'); `,
			`DELETE FROM ${SCHEMA}.event WHERE activity_id = ${activityId} AND event = 'timer' AND ("timestamp" < '${keepStartIso}' OR "timestamp" > '${keepEndIso}'); `,
			lapDeleteSql,
			`UPDATE ${SCHEMA}.lap SET total_distance = ${boundaryDistance}, total_timer_time = ${boundaryMoving}, total_ascent = ${boundaryElev.ascentM}, total_descent = ${boundaryElev.descentM}, avg_heart_rate = ${JSON.stringify(boundaryAgg.avgHr)}, max_heart_rate = ${JSON.stringify(boundaryAgg.maxHr)} WHERE activity_id = ${activityId} AND number = ${boundaryLap}; `,
			`UPDATE ${SCHEMA}.session SET total_distance = ${summary.totalDistance}, total_elapsed_time = ${summary.totalElapsedTime}, total_timer_time = ${summary.totalTimerTime}, total_ascent = ${summary.totalAscent}, total_descent = ${summary.totalDescent}, avg_heart_rate = ${JSON.stringify(summary.avgHeartRate)}, max_heart_rate = ${JSON.stringify(summary.maxHeartRate)}, avg_speed = ${JSON.stringify(nextAvgSpeed)}, enhanced_avg_speed = ${JSON.stringify(nextEnhancedAvgSpeed)}, avg_power = ${JSON.stringify(nextAvgPower)}, num_laps = ${numLaps} WHERE session_id = ${session.sessionId}; `,
			`UPDATE ${SCHEMA}.activity SET adjusted_distance = ${summary.totalDistance}, adjusted_duration = ${summary.totalTimerTime} WHERE activity_id = ${activityId};`,
		].join("");
	}

	const response: TrimActivityResponse = {
		success: true,
		removedRecords,
		removedLaps: removedLapNumbers.length,
		sql: sqlString,
	};
	return c.json(response);
});
