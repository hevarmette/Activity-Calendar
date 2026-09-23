/**
 * Session routes — read + edit for an activity's sessions (legs).
 *
 * GET /api/sessions/:activityId
 *   Query: ?schema=<name> (optional, read-only cross-schema override)
 *   Response: Session[] (all sessions for the activity, ordered by start_time)
 *
 * PATCH /api/sessions/update/:sessionId
 *   Body: SessionUpdatePayload { totalDistance?: number; totalTimerTime?: number }
 *     - both optional; when present must be finite numbers >= 0
 *   Response: { success: true, sql: string | null }
 *     - 404 { error: 'Not found' } when the session id does not exist
 *   Updates a single session leg and re-derives the parent activity's
 *   adjusted_distance/adjusted_duration as the SUM of its sessions, all inside
 *   a single transaction. Writes always target the primary SCHEMA.
 */
import type { SessionUpdatePayload } from "@activity-calendar/shared";
import { Hono } from "hono";
import { z } from "zod";
import sql, { resolveReadSchema, SCHEMA, UnknownSchemaError } from "../db.js";

export const sessionsRoutes = new Hono();

sessionsRoutes.get("/:activityId", async (c) => {
	const activityId = Number(c.req.param("activityId"));
	let schema: string;
	try {
		schema = resolveReadSchema(c.req.query("schema"));
	} catch (err) {
		if (err instanceof UnknownSchemaError) return c.json({ error: err.message }, 400);
		throw err;
	}
	const rows = await sql`
		SELECT
			session_id, activity_id, start_time, "timestamp", sport, sub_sport,
			total_distance, total_timer_time, total_elapsed_time, avg_power,
			avg_heart_rate, max_heart_rate, enhanced_avg_speed, avg_speed,
			total_ascent, total_descent, first_lap_index, num_laps, pool_length
		FROM ${sql(schema)}.session
		WHERE activity_id = ${activityId}
		ORDER BY start_time ASC
	`;
	return c.json(rows);
});

/** A finite, non-negative number (rejects NaN/Infinity and negatives). */
const nonNegativeFinite = z.number().finite().min(0);

const sessionUpdateSchema = z.object({
	totalDistance: nonNegativeFinite.optional(),
	totalTimerTime: nonNegativeFinite.optional(),
}) satisfies z.ZodType<SessionUpdatePayload>;

/**
 * PATCH /api/sessions/update/:sessionId — update a single session leg.
 *
 * Applies only the provided columns to the session row, then recomputes the
 * parent activity's adjusted_distance/adjusted_duration from the SUM of all its
 * sessions (COALESCE'd to 0). Both statements run in one transaction so the
 * activity total never drifts from its legs.
 */
sessionsRoutes.patch("/update/:sessionId", async (c) => {
	const sessionId = Number(c.req.param("sessionId"));
	const body = sessionUpdateSchema.parse(await c.req.json());

	const colMap: Record<string, unknown> = {};
	if (body.totalDistance !== undefined) colMap.total_distance = body.totalDistance;
	if (body.totalTimerTime !== undefined) colMap.total_timer_time = body.totalTimerTime;

	// No updatable fields provided — mirror the activities PATCH no-op behavior.
	if (Object.keys(colMap).length === 0) return c.json({ success: true, sql: null });

	const activityId = await sql.begin(async (tx) => {
		// a. Update the session row, capturing its parent activity_id.
		const updated = await tx`
			UPDATE ${sql(SCHEMA)}.session
			SET ${tx(colMap)}
			WHERE session_id = ${sessionId}
			RETURNING activity_id
		`;
		if (updated.length === 0) return null;

		const parentId = updated[0]?.activityId as number;

		// b. Re-derive the parent activity totals from the SUM of its sessions.
		await tx`
			UPDATE ${sql(SCHEMA)}.activity
			SET
				adjusted_distance = (
					SELECT COALESCE(SUM(total_distance), 0)
					FROM ${sql(SCHEMA)}.session
					WHERE activity_id = ${parentId}
				),
				adjusted_duration = (
					SELECT COALESCE(SUM(total_timer_time), 0)
					FROM ${sql(SCHEMA)}.session
					WHERE activity_id = ${parentId}
				)
			WHERE activity_id = ${parentId}
		`;
		return parentId;
	});

	if (activityId === null) return c.json({ error: "Not found" }, 404);

	const setClause = Object.entries(colMap)
		.map(([col, val]) => `${col} = ${JSON.stringify(val)}`)
		.join(", ");
	const sqlString =
		`UPDATE ${SCHEMA}.session SET ${setClause} WHERE session_id = ${sessionId}; ` +
		`UPDATE ${SCHEMA}.activity SET ` +
		`adjusted_distance = (SELECT COALESCE(SUM(total_distance), 0) FROM ${SCHEMA}.session WHERE activity_id = ${activityId}), ` +
		`adjusted_duration = (SELECT COALESCE(SUM(total_timer_time), 0) FROM ${SCHEMA}.session WHERE activity_id = ${activityId}) ` +
		`WHERE activity_id = ${activityId};`;

	return c.json({ success: true, sql: sqlString });
});
