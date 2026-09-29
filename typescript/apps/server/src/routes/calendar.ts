import { Hono } from "hono";
import { TIMEZONE } from "../config.js";
import sql, { resolveReadSchema, UnknownSchemaError } from "../db.js";

export const calendarRoutes = new Hono();

/**
 * GET /api/calendar
 *   Query: ?schema=<name> (optional, read-only cross-schema override)
 *   Response: CalendarRow[] (one row per activity with aggregated sports)
 */
calendarRoutes.get("/", async (c) => {
	let schema: string;
	try {
		schema = resolveReadSchema(c.req.query("schema"));
	} catch (err) {
		if (err instanceof UnknownSchemaError) return c.json({ error: err.message }, 400);
		throw err;
	}
	const rows = await sql`
		SELECT
			a.activity_id,
			COALESCE(a.local_timestamp, a.timestamp AT TIME ZONE ${TIMEZONE}) AS activity_date,
			a.activity_name,
			a.num_sessions,
			STRING_AGG(s.sport, ',' ORDER BY s.start_time) AS sport
		FROM ${sql(schema)}.activity a
		JOIN ${sql(schema)}.session s ON a.activity_id = s.activity_id
		GROUP BY a.activity_id, a.local_timestamp, a.timestamp, a.activity_name, a.num_sessions
		ORDER BY activity_date DESC
	`;
	return c.json(rows);
});

/**
 * GET /api/calendar/workouts
 *   Query: ?schema=<name> (optional, read-only cross-schema override)
 *
 * Returns scheduled workouts for display on the calendar.
 * Only workouts with a non-null scheduled_date are included.
 *
 * Response: CalendarWorkoutEvent[] (workoutId, scheduledDate, name, sport)
 */
calendarRoutes.get("/workouts", async (c) => {
	let schema: string;
	try {
		schema = resolveReadSchema(c.req.query("schema"));
	} catch (err) {
		if (err instanceof UnknownSchemaError) return c.json({ error: err.message }, 400);
		throw err;
	}
	const rows = await sql`
		SELECT workout_id, name, sport, TO_CHAR(scheduled_date, 'YYYY-MM-DD') AS scheduled_date
		FROM ${sql(schema)}.workout
		WHERE scheduled_date IS NOT NULL
		ORDER BY scheduled_date
	`;
	return c.json(rows);
});
