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
 *   - titleSearch (optional): Case-insensitive POSIX regular-expression match against
 *     activity_name (Postgres `~*` operator). The value is treated as a raw regex
 *     pattern (not a literal substring), so tokens like `\d`, `.*`, `^`, `$`, and
 *     alternation `(a|b)` work. No fuzzy/trigram logic applied. An invalid pattern
 *     is treated as matching nothing rather than erroring the request.
 *
 *   - descriptionSearch (optional): Case-insensitive POSIX regular-expression match
 *     against description (Postgres `~*` operator). Same semantics as titleSearch.
 *
 *   When multiple search params are provided, they are combined with AND logic.
 *   When none are provided, all activities are returned ordered by local_timestamp DESC.
 *
 * Requires the pg_trgm extension to be enabled in the database.
 */
import { Hono } from "hono";
import { TIMEZONE } from "../config.js";
import sql, { SCHEMA } from "../db.js";

export const searchRoutes = new Hono();

/**
 * Validate a user-supplied regex pattern before handing it to Postgres.
 *
 * Postgres `~*` throws a query error on a malformed pattern, which would 500 the
 * request. We pre-validate with the JS engine (a close-enough proxy for POSIX
 * ARE syntax) and, when invalid, substitute a sentinel that matches nothing so
 * the search simply returns no rows instead of erroring.
 */
function toRegexPattern(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	try {
		new RegExp(trimmed);
		return trimmed;
	} catch {
		// A pattern that can never match — Postgres treats this literally as an
		// impossible assertion, so the column matches no rows.
		return "$.^";
	}
}

searchRoutes.get("/", async (c) => {
	const q = c.req.query("q")?.trim() || "";
	const titleSearch = c.req.query("titleSearch")?.trim() || "";
	const descriptionSearch = c.req.query("descriptionSearch")?.trim() || "";

	const hasSearch = q || titleSearch || descriptionSearch;

	if (hasSearch) {
		const normalized = q ? q.toLowerCase().replace(/\s+/g, " ").trim() : "";

		// When only q is provided (no titleSearch/descriptionSearch), preserve original fuzzy behavior
		if (q && !titleSearch && !descriptionSearch) {
			const rows = await sql`
				SELECT
					a.activity_id,
					COALESCE(a.local_timestamp, a.timestamp AT TIME ZONE ${TIMEZONE}) AS local_timestamp,
					a.activity_name, a.description, a.category, a.num_sessions,
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
				ORDER BY relevance DESC, local_timestamp DESC
			`;
			return c.json(rows);
		}

		// Targeted search with titleSearch and/or descriptionSearch (case-insensitive
		// regex via `~*`, AND logic). Also supports combining with q for additional
		// fuzzy filtering. Regex patterns are used verbatim (no %-wrapping or
		// whitespace normalization, which would corrupt tokens like \s+).
		const titlePattern = toRegexPattern(titleSearch);
		const descPattern = toRegexPattern(descriptionSearch);

		const rows = await sql`
			SELECT
				a.activity_id,
				COALESCE(a.local_timestamp, a.timestamp AT TIME ZONE ${TIMEZONE}) AS local_timestamp,
				a.activity_name, a.description, a.category, a.num_sessions,
				s.sport, s.sub_sport, s.total_distance, s.total_timer_time,
				s.total_calories, s.total_ascent, s.total_descent,
				s.avg_heart_rate, s.max_heart_rate, s.enhanced_avg_speed
			FROM ${sql(SCHEMA)}.activity a
			JOIN ${sql(SCHEMA)}.session s ON a.activity_id = s.activity_id
			WHERE
				(${titlePattern}::text IS NULL OR a.activity_name ~* ${titlePattern ?? ""})
				AND (${descPattern}::text IS NULL OR a.description ~* ${descPattern ?? ""})
				${
					q
						? sql`AND (
					a.activity_name ILIKE ${`%${normalized}%`}
					OR a.description ILIKE ${`%${normalized}%`}
					OR word_similarity(${normalized}, LOWER(TRIM(regexp_replace(COALESCE(a.activity_name, ''), '\s+', ' ', 'g')))) > 0.3
					OR word_similarity(${normalized}, LOWER(TRIM(regexp_replace(COALESCE(a.description, ''), '\s+', ' ', 'g')))) > 0.3
				)`
						: sql``
				}
			ORDER BY local_timestamp DESC
		`;
		return c.json(rows);
	}

	const rows = await sql`
		SELECT
			a.activity_id,
			COALESCE(a.local_timestamp, a.timestamp AT TIME ZONE ${TIMEZONE}) AS local_timestamp,
			a.activity_name, a.description, a.category, a.num_sessions,
			s.sport, s.sub_sport, s.total_distance, s.total_timer_time,
			s.total_calories, s.total_ascent, s.total_descent,
			s.avg_heart_rate, s.max_heart_rate, s.enhanced_avg_speed
		FROM ${sql(SCHEMA)}.activity a
		JOIN ${sql(SCHEMA)}.session s ON a.activity_id = s.activity_id
		ORDER BY local_timestamp DESC
	`;
	return c.json(rows);
});
