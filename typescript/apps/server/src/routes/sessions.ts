import { Hono } from "hono";
import sql, { SCHEMA } from "../db.js";

export const sessionsRoutes = new Hono();

sessionsRoutes.get("/:activityId", async (c) => {
	const activityId = Number(c.req.param("activityId"));
	const rows = await sql`
		SELECT
			session_id, activity_id, start_time, "timestamp", sport, sub_sport,
			total_distance, total_timer_time, total_elapsed_time, avg_power,
			avg_heart_rate, max_heart_rate, enhanced_avg_speed, avg_speed,
			total_ascent, total_descent, first_lap_index, num_laps, pool_length
		FROM ${sql(SCHEMA)}.session
		WHERE activity_id = ${activityId}
		ORDER BY start_time ASC
	`;
	return c.json(rows);
});
