import { Hono } from "hono";
import sql, { SCHEMA } from "../db.js";

export const eventsRoutes = new Hono();

eventsRoutes.get("/:activityId", async (c) => {
	const activityId = Number(c.req.param("activityId"));
	const rows = await sql`
		SELECT "timestamp", event, event_type
		FROM ${sql(SCHEMA)}.event
		WHERE activity_id = ${activityId} AND event = 'timer'
		ORDER BY "timestamp" ASC
	`;
	return c.json(rows);
});
