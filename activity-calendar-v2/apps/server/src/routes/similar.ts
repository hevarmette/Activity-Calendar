import { Hono } from "hono";
import sql, { SCHEMA } from "../db.js";

export const similarRoutes = new Hono();

similarRoutes.get("/:activityId", async (c) => {
	const activityId = Number(c.req.param("activityId"));
	const title = c.req.query("title") || "";
	const sport = c.req.query("sport") || "";

	if (!title || !sport) return c.json([]);

	const rows = await sql`
		WITH normalized AS (
			SELECT
				a.activity_id, a.activity_name,
				COALESCE(a.local_timestamp, a.timestamp AT TIME ZONE 'America/Chicago') AS local_timestamp,
				s.total_distance, s.total_timer_time,
				LOWER(TRIM(regexp_replace(a.activity_name, '\s+', ' ', 'g'))) AS norm_name
			FROM ${sql(SCHEMA)}.activity a
			JOIN ${sql(SCHEMA)}.session s ON a.activity_id = s.activity_id
			WHERE a.activity_id != ${activityId} AND s.sport = ${sport}
		)
		SELECT activity_id, activity_name, local_timestamp, total_distance, total_timer_time,
			similarity(norm_name, LOWER(TRIM(regexp_replace(${title}, '\s+', ' ', 'g')))) AS name_similarity
		FROM normalized
		WHERE similarity(norm_name, LOWER(TRIM(regexp_replace(${title}, '\s+', ' ', 'g')))) > 0.3
		ORDER BY name_similarity DESC
	`;
	return c.json(rows);
});
