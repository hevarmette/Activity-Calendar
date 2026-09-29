import { Hono } from "hono";
import { z } from "zod";
import sql, { assertPrimaryWriteSchema, resolveReadSchema, SCHEMA, UnknownSchemaError } from "../db.js";

export const lengthsRoutes = new Hono();

/**
 * GET /api/lengths/:activityId
 *   Query: ?schema=<name> (optional, read-only cross-schema override)
 *   Response: LengthRow[] (pool swim lengths for the activity, ordered by message_index)
 */
lengthsRoutes.get("/:activityId", async (c) => {
	const activityId = Number(c.req.param("activityId"));
	let schema: string;
	try {
		schema = resolveReadSchema(c.req.query("schema"));
	} catch (err) {
		if (err instanceof UnknownSchemaError) return c.json({ error: err.message }, 400);
		throw err;
	}
	const rows = await sql`
		SELECT length_id, activity_id, message_index, total_timer_time,
			total_strokes, avg_speed, swim_stroke, length_type
		FROM ${sql(schema)}.length
		WHERE activity_id = ${activityId}
		ORDER BY message_index ASC
	`;
	return c.json(rows);
});

const lengthUpdateSchema = z.object({
	totalTimerTime: z.number().optional(),
	totalStrokes: z.number().optional(),
	swimStroke: z.string().optional(),
});

/**
 * PATCH /api/lengths/:lengthId — update a single pool swim length.
 *
 * Writes are pinned to the primary SCHEMA; a request carrying a `?schema=` that
 * is neither empty nor the primary schema is rejected with a 400.
 */
lengthsRoutes.patch("/:lengthId", async (c) => {
	try {
		assertPrimaryWriteSchema(c.req.query("schema"));
	} catch (err) {
		if (err instanceof UnknownSchemaError)
			return c.json({ error: `Writes are only allowed on the primary schema (got '${err.schemaName}')` }, 400);
		throw err;
	}
	const lengthId = Number(c.req.param("lengthId"));
	const body = lengthUpdateSchema.parse(await c.req.json());

	const colMap: Record<string, unknown> = {};
	if (body.totalTimerTime !== undefined) colMap.total_timer_time = body.totalTimerTime;
	if (body.totalStrokes !== undefined) colMap.total_strokes = body.totalStrokes;
	if (body.swimStroke !== undefined) colMap.swim_stroke = body.swimStroke;

	if (Object.keys(colMap).length === 0) return c.json({ success: true });

	await sql`
		UPDATE ${sql(SCHEMA)}.length SET ${sql(colMap)} WHERE length_id = ${lengthId}
	`;
	return c.json({ success: true });
});

const combineSchema = z.object({ lengthIds: z.array(z.number()).min(2) });

/**
 * POST /api/lengths/combine — merge two or more lengths into the first one.
 *
 * Writes are pinned to the primary SCHEMA; a request carrying a `?schema=` that
 * is neither empty nor the primary schema is rejected with a 400.
 */
lengthsRoutes.post("/combine", async (c) => {
	try {
		assertPrimaryWriteSchema(c.req.query("schema"));
	} catch (err) {
		if (err instanceof UnknownSchemaError)
			return c.json({ error: `Writes are only allowed on the primary schema (got '${err.schemaName}')` }, 400);
		throw err;
	}
	const { lengthIds } = combineSchema.parse(await c.req.json());
	const keepId = lengthIds[0]!;
	const deleteIds = lengthIds.slice(1);

	await sql.begin(async (tx) => {
		const rows = await tx`
			SELECT COALESCE(SUM(total_timer_time), 0) AS total_time,
				COALESCE(SUM(total_strokes), 0) AS total_strokes
			FROM ${sql(SCHEMA)}.length WHERE length_id = ANY(${lengthIds})
		`;
		const totals = rows[0]!;
		await tx`
			UPDATE ${sql(SCHEMA)}.length
			SET total_timer_time = ${totals.total_time}, total_strokes = ${totals.total_strokes}
			WHERE length_id = ${keepId}
		`;
		await tx`
			DELETE FROM ${sql(SCHEMA)}.length WHERE length_id = ANY(${deleteIds})
		`;
	});

	return c.json({ success: true });
});
