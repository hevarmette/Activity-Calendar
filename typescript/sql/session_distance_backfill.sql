-- ============================================================================
-- session_distance_backfill.sql
--
-- One-off data fix: for SINGLE-SESSION activities, backfill the session row's
-- total_distance / total_timer_time from the activity's user-edited
-- adjusted_distance / adjusted_duration.
--
-- WHY
--   The app now treats these columns as a synced pair:
--     - Single-session activity: the activity (adjusted_*) is the source of
--       truth, and edits are written through to the lone session row.
--     - Multisport activity: the sessions are the source of truth and the
--       activity total is derived as SUM(sessions).
--   Historically, edits went only to activity.adjusted_* while the session row
--   kept its raw imported value, so session.total_distance / total_timer_time
--   went stale. This script realigns the stale single-session rows.
--
-- SCOPE / SAFETY
--   * SINGLE-SESSION ONLY. Activities with more than one session row are the
--     multisport case and are NEVER touched here (their totals are derived from
--     the sessions, not the other way around).
--   * NULL-safe: a column is only updated when the corresponding
--     activity.adjusted_* value IS NOT NULL. Distance and duration are handled
--     independently — an activity may need one fixed but not the other.
--   * Epsilon tolerance: rows already within EPS of the target are left alone,
--     to avoid needless float (real) churn.
--   * Schema: targets the "act" schema (production). To run against another
--     schema, change :'target_schema' below.
--
-- HOW TO RUN (review before committing!)
--   psql "<conn string>" -f sql/session_distance_backfill.sql
--   The script runs inside a single transaction and ends with a COMMIT. If you
--   want to preview only, comment out the final COMMIT and uncomment ROLLBACK,
--   or just run Step 1 (the preview SELECT) on its own first.
--
-- NOTE ON UNITS
--   total_distance / adjusted_distance : meters (real)
--   total_timer_time / adjusted_duration: seconds (real)
-- ============================================================================

\set target_schema act

-- Distance/time epsilons below which we consider the values already equal.
-- (Kept as plain numeric literals inline since psql \set does not type-check.)
--   distance epsilon: 0.5 meters
--   duration epsilon: 0.5 seconds

-- ----------------------------------------------------------------------------
-- STEP 1 — PREVIEW: single-session activities whose lone session is stale.
-- Run this first (read-only). Each row is a candidate the UPDATEs below will fix.
-- ----------------------------------------------------------------------------
SET search_path TO :"target_schema";

WITH single_session AS (
    SELECT s.activity_id,
           MIN(s.session_id)   AS session_id,
           COUNT(*)            AS leg_count
    FROM session s
    GROUP BY s.activity_id
    HAVING COUNT(*) = 1
)
SELECT
    a.activity_id,
    a.activity_name,
    ss.session_id,
    a.adjusted_distance                                   AS activity_distance_m,
    s.total_distance                                      AS session_distance_m,
    (a.adjusted_distance - s.total_distance)              AS distance_delta_m,
    a.adjusted_duration                                   AS activity_duration_s,
    s.total_timer_time                                    AS session_duration_s,
    (a.adjusted_duration - s.total_timer_time)            AS duration_delta_s,
    CASE
        WHEN a.adjusted_distance IS NOT NULL
         AND (s.total_distance IS NULL
              OR abs(a.adjusted_distance - s.total_distance) > 0.5)
        THEN 'fix distance' ELSE '' END                   AS will_fix_distance,
    CASE
        WHEN a.adjusted_duration IS NOT NULL
         AND (s.total_timer_time IS NULL
              OR abs(a.adjusted_duration - s.total_timer_time) > 0.5)
        THEN 'fix duration' ELSE '' END                   AS will_fix_duration
FROM single_session ss
JOIN activity a ON a.activity_id = ss.activity_id
JOIN session  s ON s.session_id  = ss.session_id
WHERE
    -- Distance is stale (and fixable)…
    (   a.adjusted_distance IS NOT NULL
        AND (s.total_distance IS NULL
             OR abs(a.adjusted_distance - s.total_distance) > 0.5)
    )
    OR
    -- …or duration is stale (and fixable).
    (   a.adjusted_duration IS NOT NULL
        AND (s.total_timer_time IS NULL
             OR abs(a.adjusted_duration - s.total_timer_time) > 0.5)
    )
ORDER BY a.activity_id;

-- ----------------------------------------------------------------------------
-- STEP 2 — APPLY the fix, inside a transaction.
-- ----------------------------------------------------------------------------
BEGIN;

SET search_path TO :"target_schema";

-- Identify the single-session activities once, reused by both UPDATEs.
-- (A temp table keeps the two UPDATEs consistent and readable.)
CREATE TEMP TABLE _single_session_fix ON COMMIT DROP AS
SELECT s.activity_id,
       MIN(s.session_id) AS session_id
FROM session s
GROUP BY s.activity_id
HAVING COUNT(*) = 1;

-- 2a. Backfill session distance from activity.adjusted_distance.
UPDATE session s
SET total_distance = a.adjusted_distance
FROM _single_session_fix f
JOIN activity a ON a.activity_id = f.activity_id
WHERE s.session_id = f.session_id
  AND a.adjusted_distance IS NOT NULL
  AND (s.total_distance IS NULL
       OR abs(a.adjusted_distance - s.total_distance) > 0.5);

-- 2b. Backfill session duration from activity.adjusted_duration.
UPDATE session s
SET total_timer_time = a.adjusted_duration
FROM _single_session_fix f
JOIN activity a ON a.activity_id = f.activity_id
WHERE s.session_id = f.session_id
  AND a.adjusted_duration IS NOT NULL
  AND (s.total_timer_time IS NULL
       OR abs(a.adjusted_duration - s.total_timer_time) > 0.5);

-- ----------------------------------------------------------------------------
-- STEP 3 — POST-CHECK (still inside the transaction): should return 0 rows.
-- Any rows here mean something still diverges beyond epsilon among
-- single-session activities. Review before committing.
-- ----------------------------------------------------------------------------
WITH single_session AS (
    SELECT s.activity_id, MIN(s.session_id) AS session_id
    FROM session s
    GROUP BY s.activity_id
    HAVING COUNT(*) = 1
)
SELECT a.activity_id,
       a.adjusted_distance, s.total_distance,
       a.adjusted_duration, s.total_timer_time
FROM single_session ss
JOIN activity a ON a.activity_id = ss.activity_id
JOIN session  s ON s.session_id  = ss.session_id
WHERE (a.adjusted_distance IS NOT NULL
       AND (s.total_distance IS NULL
            OR abs(a.adjusted_distance - s.total_distance) > 0.5))
   OR (a.adjusted_duration IS NOT NULL
       AND (s.total_timer_time IS NULL
            OR abs(a.adjusted_duration - s.total_timer_time) > 0.5))
ORDER BY a.activity_id;

-- ----------------------------------------------------------------------------
-- Commit the fix. Comment this out and uncomment ROLLBACK to dry-run instead.
-- ----------------------------------------------------------------------------
COMMIT;
-- ROLLBACK;
