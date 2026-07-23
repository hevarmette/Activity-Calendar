import { Hono } from "hono";
import { z } from "zod";
import sql, { SCHEMA } from "../db.js";

export const lapsRoutes = new Hono();

/** GET /api/laps/:activityId - fetch laps for an activity (optionally scoped to a session) */
lapsRoutes.get("/:activityId", async (c) => {
	const activityId = Number(c.req.param("activityId"));
	const firstLapIndex = c.req.query("first_lap_index");
	const numLaps = c.req.query("num_laps");

	if (firstLapIndex && numLaps) {
		const rows = await sql`
			SELECT lap_id, activity_id, start_time, number, total_distance,
				total_timer_time, total_ascent, total_descent,
				avg_vertical_oscillation, avg_stance_time, avg_vertical_ratio,
				avg_stance_time_balance, avg_step_length, avg_running_cadence,
				max_heart_rate, avg_heart_rate, intensity, avg_power, max_power
			FROM ${sql(SCHEMA)}.lap
			WHERE activity_id = ${activityId}
				AND number >= ${Number(firstLapIndex)}
				AND number < ${Number(firstLapIndex) + Number(numLaps)}
			ORDER BY number ASC
		`;
		return c.json(rows);
	}

	const rows = await sql`
		SELECT lap_id, activity_id, start_time, number, total_distance,
			total_timer_time, total_ascent, total_descent,
			avg_vertical_oscillation, avg_stance_time, avg_vertical_ratio,
			avg_stance_time_balance, avg_step_length, avg_running_cadence,
			max_heart_rate, avg_heart_rate, intensity, avg_power, max_power
		FROM ${sql(SCHEMA)}.lap
		WHERE activity_id = ${activityId}
		ORDER BY number ASC
	`;
	return c.json(rows);
});

const lapUpdateSchema = z.object({
	totalDistance: z.number().optional(),
	totalTimerTime: z.number().optional(),
	avgHeartRate: z.number().optional(),
	intensity: z.string().optional(),
});

/** PATCH /api/laps/:lapId - update a single lap */
lapsRoutes.patch("/update/:lapId", async (c) => {
	const lapId = Number(c.req.param("lapId"));
	const body = lapUpdateSchema.parse(await c.req.json());

	const colMap: Record<string, unknown> = {};
	if (body.totalDistance !== undefined) colMap.total_distance = body.totalDistance;
	if (body.totalTimerTime !== undefined) colMap.total_timer_time = body.totalTimerTime;
	if (body.avgHeartRate !== undefined) colMap.avg_heart_rate = body.avgHeartRate;
	if (body.intensity !== undefined) colMap.intensity = body.intensity;

	if (Object.keys(colMap).length === 0) return c.json({ success: true });

	await sql`
		UPDATE ${sql(SCHEMA)}.lap
		SET ${sql(colMap)}
		WHERE lap_id = ${lapId}
	`;
	return c.json({ success: true });
});
