import { Hono } from "hono";
import sql, { SCHEMA } from "../db.js";

export const reportRoutes = new Hono();

reportRoutes.get("/", async (c) => {
	const rows = await sql`
		SELECT
			a.activity_id, a.local_timestamp, s.sport,
			s.total_distance, s.total_timer_time, s.total_calories,
			s.total_ascent, s.total_descent, s.avg_heart_rate, s.max_heart_rate,
			s.avg_power
		FROM ${sql(SCHEMA)}.activity a
		JOIN ${sql(SCHEMA)}.session s ON a.activity_id = s.activity_id
		ORDER BY a.local_timestamp DESC
	`;
	return c.json(rows);
});
