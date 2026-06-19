import { Hono } from "hono";
import sql, { SCHEMA } from "../db.js";

export const recordsRoutes = new Hono();

/** GET /api/records/:activityId - fetch GPS points with imputed lat/lon */
recordsRoutes.get("/:activityId", async (c) => {
	const activityId = Number(c.req.param("activityId"));

	const rows = await sql`
		WITH groups AS (
			SELECT
				record_id, activity_id, "timestamp", latitude, longitude,
				lap, altitude, heart_rate, cadence, fractional_cadence,
				enhanced_speed, distance,
				COUNT(latitude) OVER (ORDER BY "timestamp" ASC) as fwd_grp,
				COUNT(latitude) OVER (ORDER BY "timestamp" DESC) as bwd_grp
			FROM ${sql(SCHEMA)}.record
			WHERE activity_id = ${activityId}
		),
		imputed_bounds AS (
			SELECT *,
				FIRST_VALUE(latitude) OVER (PARTITION BY fwd_grp ORDER BY "timestamp" ASC) as prev_lat,
				FIRST_VALUE(longitude) OVER (PARTITION BY fwd_grp ORDER BY "timestamp" ASC) as prev_long,
				FIRST_VALUE(latitude) OVER (PARTITION BY bwd_grp ORDER BY "timestamp" DESC) as next_lat,
				FIRST_VALUE(longitude) OVER (PARTITION BY bwd_grp ORDER BY "timestamp" DESC) as next_long
			FROM groups
		)
		SELECT
			record_id, activity_id,
			COALESCE(latitude, (prev_lat + next_lat) / 2.0, next_lat, prev_lat) as latitude,
			COALESCE(longitude, (prev_long + next_long) / 2.0, next_long, prev_long) as longitude,
			lap, altitude, "timestamp", heart_rate, cadence, fractional_cadence,
			enhanced_speed, distance
		FROM imputed_bounds
		ORDER BY "timestamp" ASC
	`;

	return c.json(rows);
});
