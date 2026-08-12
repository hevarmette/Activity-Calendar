/**
 * GET /api/search
 *
 * Returns activities matching optional filter criteria.
 *
 * Query parameters:
 *   - q (optional): Free-text search query matched against activity_name and description.
 *     When provided, results are filtered using ILIKE pattern matching and pg_trgm
 *     word_similarity (threshold > 0.3) for fuzzy matching. Results are ordered by
 *     relevance (GREATEST word_similarity score) descending, then by local_timestamp DESC.
 *     Input is normalized (lowercased, trimmed, whitespace collapsed) before comparison.
 *     This handles variations like "5x600m" vs "5 x 600m".
 *
 *   When q is empty or missing, all activities are returned ordered by local_timestamp DESC.
 *
 * Requires the pg_trgm extension to be enabled in the database.
 */
import { Hono } from "hono";
import sql, { SCHEMA } from "../db.js";

export const searchRoutes = new Hono();

searchRoutes.get("/", async (c) => {
	const q = c.req.query("q")?.trim() || "";

	if (q) {
		const normalized = q.toLowerCase().replace(/\s+/g, " ").trim();

		const rows = await sql`
			SELECT
				a.activity_id, a.local_timestamp, a.activity_name, a.description, a.category, a.num_sessions,
				s.sport, s.sub_sport, s.total_distance, s.total_timer_time,
				s.total_calories, s.total_ascent, s.total_descent,
				s.avg_heart_rate, s.max_heart_rate, s.enhanced_avg_speed,
				GREATEST(
					word_similarity(${normalized}, LOWER(TRIM(regexp_replace(COALESCE(a.activity_name, ''), '\s+', ' ', 'g')))),
					word_similarity(${normalized}, LOWER(TRIM(regexp_replace(COALESCE(a.description, ''), '\s+', ' ', 'g'))))
				) AS relevance
			FROM ${sql(SCHEMA)}.activity a
			JOIN ${sql(SCHEMA)}.session s ON a.activity_id = s.activity_id
			WHERE
				a.activity_name ILIKE ${`%${normalized}%`}
				OR a.description ILIKE ${`%${normalized}%`}
				OR word_similarity(${normalized}, LOWER(TRIM(regexp_replace(COALESCE(a.activity_name, ''), '\s+', ' ', 'g')))) > 0.3
				OR word_similarity(${normalized}, LOWER(TRIM(regexp_replace(COALESCE(a.description, ''), '\s+', ' ', 'g')))) > 0.3
			ORDER BY relevance DESC, a.local_timestamp DESC
		`;
		return c.json(rows);
	}

	const rows = await sql`
		SELECT
			a.activity_id, a.local_timestamp, a.activity_name, a.description, a.category, a.num_sessions,
			s.sport, s.sub_sport, s.total_distance, s.total_timer_time,
			s.total_calories, s.total_ascent, s.total_descent,
			s.avg_heart_rate, s.max_heart_rate, s.enhanced_avg_speed
		FROM ${sql(SCHEMA)}.activity a
		JOIN ${sql(SCHEMA)}.session s ON a.activity_id = s.activity_id
		ORDER BY a.local_timestamp DESC
	`;
	return c.json(rows);
});
