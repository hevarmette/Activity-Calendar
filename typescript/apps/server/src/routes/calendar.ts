import { Hono } from "hono";
import { TIMEZONE } from "../config.js";
import sql, { SCHEMA } from "../db.js";

export const calendarRoutes = new Hono();

calendarRoutes.get("/", async (c) => {
	const rows = await sql`
		SELECT
			a.activity_id,
			COALESCE(a.local_timestamp, a.timestamp AT TIME ZONE ${TIMEZONE}) AS activity_date,
			a.activity_name,
			a.num_sessions,
			STRING_AGG(s.sport, ',' ORDER BY s.start_time) AS sport
		FROM ${sql(SCHEMA)}.activity a
		JOIN ${sql(SCHEMA)}.session s ON a.activity_id = s.activity_id
		GROUP BY a.activity_id, a.local_timestamp, a.timestamp, a.activity_name, a.num_sessions
		ORDER BY activity_date DESC
	`;
	return c.json(rows);
});
