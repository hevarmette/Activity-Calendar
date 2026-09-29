import { Hono } from "hono";
import { TIMEZONE } from "../config.js";
import sql, { resolveReadSchema, UnknownSchemaError } from "../db.js";

export const similarRoutes = new Hono();

/**
 * Finds activities with similar names using PostgreSQL's pg_trgm similarity function.
 * From the original Streamlit db.py (fetch_similar_activities):
 * Names are normalized (lowercased, trimmed, collapsed whitespace) before comparison.
 * Only results with similarity > 0.3 are returned, ordered by similarity desc.
 * This requires the pg_trgm extension to be enabled in the database.
 *
 * GET /api/similar/:activityId
 *   Query: ?title, ?sport (required for a match), ?schema=<name> (optional,
 *   read-only cross-schema override).
 */
similarRoutes.get("/:activityId", async (c) => {
	const activityId = Number(c.req.param("activityId"));
	const title = c.req.query("title") || "";
	const sport = c.req.query("sport") || "";

	if (!title || !sport) return c.json([]);

	let schema: string;
	try {
		schema = resolveReadSchema(c.req.query("schema"));
	} catch (err) {
		if (err instanceof UnknownSchemaError) return c.json({ error: err.message }, 400);
		throw err;
	}

	const rows = await sql`
		WITH normalized AS (
			SELECT
				a.activity_id, a.activity_name,
				COALESCE(a.local_timestamp, a.timestamp AT TIME ZONE ${TIMEZONE}) AS local_timestamp,
				s.total_distance, s.total_timer_time,
				LOWER(TRIM(regexp_replace(a.activity_name, '\s+', ' ', 'g'))) AS norm_name
			FROM ${sql(schema)}.activity a
			JOIN ${sql(schema)}.session s ON a.activity_id = s.activity_id
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
