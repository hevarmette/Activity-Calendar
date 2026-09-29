import { Hono } from "hono";
import sql, { resolveReadSchema, UnknownSchemaError } from "../db.js";

export const eventsRoutes = new Hono();

/**
 * GET /api/events/:activityId
 *   Query: ?schema=<name> (optional, read-only cross-schema override)
 *   Response: EventRow[] (timer events for the activity, ordered by timestamp)
 */
eventsRoutes.get("/:activityId", async (c) => {
	const activityId = Number(c.req.param("activityId"));
	let schema: string;
	try {
		schema = resolveReadSchema(c.req.query("schema"));
	} catch (err) {
		if (err instanceof UnknownSchemaError) return c.json({ error: err.message }, 400);
		throw err;
	}
	const rows = await sql`
		SELECT "timestamp", event, event_type
		FROM ${sql(schema)}.event
		WHERE activity_id = ${activityId} AND event = 'timer'
		ORDER BY "timestamp" ASC
	`;
	return c.json(rows);
});
