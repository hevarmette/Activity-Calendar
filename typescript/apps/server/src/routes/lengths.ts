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
 * POST /api/lengths/combine — merge two or more lengths into one.
 *
 * The surviving row is the one with the LOWEST message_index among the
 * selected lengths, so the merged length keeps its chronological position in
 * the swim regardless of the order ids are sent in. Its total_timer_time and
 * total_strokes become the SUM across all selected lengths; the others are
 * deleted. (Distance is derived from the session pool length × remaining
 * length count on read, so there is no distance column to update here.)
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

	const result = await sql.begin(async (tx) => {
		// Fetch the selected lengths so we can pick the earliest (lowest
		// message_index) as the survivor and sum the mergeable fields. Doing this
		// server-side keeps the "which row survives" rule independent of request
		// order and resilient to a client that sends ids in selection order.
		const rows = await tx`
			SELECT length_id, message_index,
				COALESCE(total_timer_time, 0) AS total_timer_time,
				COALESCE(total_strokes, 0) AS total_strokes
			FROM ${sql(SCHEMA)}.length
			WHERE length_id = ANY(${lengthIds})
			ORDER BY message_index ASC
		`;
		if (rows.length < 2) return null; // nothing (or not enough) to merge

		const [keep, ...rest] = rows;
		if (!keep) return null; // unreachable given the length check, satisfies the type
		const deleteIds = rest.map((r) => r.length_id);
		const totalTime = rows.reduce((acc, r) => acc + Number(r.total_timer_time), 0);
		const totalStrokes = rows.reduce((acc, r) => acc + Number(r.total_strokes), 0);

		await tx`
			UPDATE ${sql(SCHEMA)}.length
			SET total_timer_time = ${totalTime}, total_strokes = ${totalStrokes}
			WHERE length_id = ${keep.length_id}
		`;
		await tx`
			DELETE FROM ${sql(SCHEMA)}.length WHERE length_id = ANY(${deleteIds})
		`;
		return { keepId: keep.length_id, totalTimerTime: totalTime, totalStrokes };
	});

	if (result === null) return c.json({ error: "Fewer than two matching lengths to combine" }, 400);
	return c.json({ success: true, ...result });
});
