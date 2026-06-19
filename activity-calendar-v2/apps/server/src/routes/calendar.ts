import { Hono } from "hono";
import sql, { SCHEMA } from "../db.js";

export const calendarRoutes = new Hono();

calendarRoutes.get("/", async (c) => {
	const rows = await sql`
		SELECT
			a.activity_id,
			a.timestamp AS activity_date,
			a.activity_name,
			a.num_sessions,
			STRING_AGG(s.sport, ',' ORDER BY s.start_time) AS sport
		FROM ${sql(SCHEMA)}.activity a
		JOIN ${sql(SCHEMA)}.session s ON a.activity_id = s.activity_id
		GROUP BY a.activity_id, a.timestamp, a.activity_name, a.num_sessions
		ORDER BY activity_date DESC
	`;
	return c.json(rows);
});
