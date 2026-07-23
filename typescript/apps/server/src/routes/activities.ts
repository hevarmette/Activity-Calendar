import { Hono } from "hono";
import { z } from "zod";
import sql, { SCHEMA } from "../db.js";
import { TIMEZONE } from "../config.js";

export const activitiesRoutes = new Hono();

activitiesRoutes.get("/:id", async (c) => {
	const id = Number(c.req.param("id"));
	const rows = await sql`
		SELECT
			a.activity_id,
			a.adjusted_distance AS distance,
			a.adjusted_duration AS duration,
			CAST(s.avg_power AS INTEGER) AS avg_power,
			a.description,
			a.workout_feel AS feel,
			a.effort,
			COALESCE(a.local_timestamp, a.timestamp AT TIME ZONE ${TIMEZONE}) AS local_timestamp,
			a.activity_name AS name,
			a.category
		FROM ${sql(SCHEMA)}.activity a
		JOIN ${sql(SCHEMA)}.session s ON a.activity_id = s.activity_id
		WHERE a.activity_id = ${id}
		LIMIT 1
	`;
	if (rows.length === 0) return c.json({ error: "Not found" }, 404);
	return c.json(rows[0]);
});

const activityUpdateSchema = z.object({
	adjustedDistance: z.number().optional(),
	adjustedDuration: z.number().optional(),
	description: z.string().nullable().optional(),
	workoutFeel: z.number().nullable().optional(),
	effort: z.number().nullable().optional(),
	activityName: z.string().nullable().optional(),
	category: z.string().nullable().optional(),
});

activitiesRoutes.patch("/:id", async (c) => {
	const id = Number(c.req.param("id"));
	const body = activityUpdateSchema.parse(await c.req.json());

	const updates: string[] = [];
	const values: unknown[] = [];

	if (body.adjustedDistance !== undefined) {
		updates.push("adjusted_distance");
		values.push(body.adjustedDistance);
	}
	if (body.adjustedDuration !== undefined) {
		updates.push("adjusted_duration");
		values.push(body.adjustedDuration);
	}
	if (body.description !== undefined) {
		updates.push("description");
		values.push(body.description);
	}
	if (body.workoutFeel !== undefined) {
		updates.push("workout_feel");
		values.push(body.workoutFeel);
	}
	if (body.effort !== undefined) {
		updates.push("effort");
		values.push(body.effort);
	}
	if (body.activityName !== undefined) {
		updates.push("activity_name");
		values.push(body.activityName);
	}
	if (body.category !== undefined) {
		updates.push("category");
		values.push(body.category);
	}

	if (updates.length === 0) return c.json({ success: true, sql: null });

	const setClause = Object.fromEntries(updates.map((col, i) => [col, values[i]]));

	await sql`
		UPDATE ${sql(SCHEMA)}.activity
		SET ${sql(setClause)}
		WHERE activity_id = ${id}
	`;

	const sqlString = `UPDATE ${SCHEMA}.activity SET ${updates.map((col, i) => `${col} = ${JSON.stringify(values[i])}`).join(", ")} WHERE activity_id = ${id};`;

	return c.json({ success: true, sql: sqlString });
});
