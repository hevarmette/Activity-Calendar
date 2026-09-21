import { Hono } from "hono";
import { TIMEZONE } from "../config.js";
import sql, { SCHEMA } from "../db.js";

export const reportRoutes = new Hono();

/**
 * GET /api/report
 *
 * Returns per-session rows for the activity report page.
 *
 * Distance/duration reflect the activity-level *adjusted* values
 * (`activity.adjusted_distance` / `activity.adjusted_duration`) — the same
 * user-editable totals shown on the calendar dialog and the activity details
 * page — so the report is consistent with those views.
 *
 * Because an activity can have multiple sessions (multisport), the adjusted
 * total is split across its legs in proportion to each session's share of the
 * raw session `total_distance` (falling back to `total_timer_time`, then to an
 * equal split). Summing the per-leg values back up therefore reproduces the
 * activity's adjusted total exactly, while still allowing the report to group
 * by sport. Single-session activities (the common case) receive the full
 * adjusted value on their one row.
 */
reportRoutes.get("/", async (c) => {
	const rows = await sql`
		WITH session_totals AS (
			SELECT
				activity_id,
				SUM(total_distance) AS sum_distance,
				SUM(total_timer_time) AS sum_timer,
				COUNT(*) AS leg_count
			FROM ${sql(SCHEMA)}.session
			GROUP BY activity_id
		)
		SELECT
			a.activity_id,
			COALESCE(a.local_timestamp, a.timestamp AT TIME ZONE ${TIMEZONE}) AS local_timestamp,
			s.sport,
			-- Split the activity's adjusted distance/duration across its sessions
			-- in proportion to each leg's share of the raw session totals. Fall
			-- back to the timer-time share, then to an equal split, when the
			-- primary weight sums to zero (e.g. manual or GPS-less activities).
			(a.adjusted_distance * CASE
				WHEN t.sum_distance > 0 THEN s.total_distance / t.sum_distance
				WHEN t.sum_timer > 0 THEN s.total_timer_time / t.sum_timer
				ELSE 1.0 / t.leg_count
			END) AS total_distance,
			(a.adjusted_duration * CASE
				WHEN t.sum_timer > 0 THEN s.total_timer_time / t.sum_timer
				WHEN t.sum_distance > 0 THEN s.total_distance / t.sum_distance
				ELSE 1.0 / t.leg_count
			END) AS total_timer_time,
			s.total_calories,
			s.total_ascent, s.total_descent, s.avg_heart_rate, s.max_heart_rate,
			s.avg_power
		FROM ${sql(SCHEMA)}.activity a
		JOIN ${sql(SCHEMA)}.session s ON a.activity_id = s.activity_id
		JOIN session_totals t ON t.activity_id = a.activity_id
		ORDER BY local_timestamp DESC
	`;
	return c.json(rows);
});
