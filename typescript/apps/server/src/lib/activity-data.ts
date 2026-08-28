/**
 * Data access for activity FIT export.
 *
 * Fetches the raw rows needed to reconstruct an activity .fit file. Unlike
 * routes/records.ts, this module deliberately uses RAW record rows:
 *   - NO coordinate imputation (we omit null coords in the encoder instead).
 *   - NO pyhigh elevation correction (that shells out to python3 and mutates
 *     recorded altitude). Exports preserve the originally recorded values.
 *
 * Two entry points:
 *   - fetchActivityFitInput(id): hydrate a single activity.
 *   - fetchActivityFitInputs(ids): hydrate many activities with one query per
 *     table (WHERE activity_id = ANY(...)) grouped in JS, avoiding N+1.
 */

import sql, { SCHEMA } from "../db.js";
import type {
	ActivityFitInput,
	ActivityRow,
	EventRow,
	LapRow,
	LengthRow,
	RecordRow,
	SessionRow,
} from "./activity-fit.js";

const ACTIVITY_COLS = sql`activity_id, "timestamp", activity_name, num_sessions, total_timer_time`;
const SESSION_COLS = sql`
	session_id, activity_id, start_time, "timestamp", sport, sub_sport,
	total_distance, total_timer_time, total_elapsed_time, avg_power,
	avg_heart_rate, max_heart_rate, enhanced_avg_speed, avg_speed,
	total_ascent, total_descent, first_lap_index, num_laps, pool_length`;
const LAP_COLS = sql`
	activity_id, start_time, number, total_distance, total_timer_time,
	total_ascent, total_descent, max_heart_rate, avg_heart_rate,
	intensity, avg_power, max_power`;
const RECORD_COLS = sql`
	activity_id, "timestamp", latitude, longitude, lap, altitude,
	heart_rate, cadence, fractional_cadence, enhanced_speed, distance`;
const EVENT_COLS = sql`activity_id, "timestamp", event, event_type`;
const LENGTH_COLS = sql`
	activity_id, message_index, total_timer_time, total_strokes,
	avg_speed, swim_stroke, length_type`;

/** Hydrate a single activity's rows for FIT encoding. Returns null if not found. */
export async function fetchActivityFitInput(activityId: number): Promise<ActivityFitInput | null> {
	const [activityRows, sessions, laps, records, events, lengths] = await Promise.all([
		sql<ActivityRow[]>`SELECT ${ACTIVITY_COLS} FROM ${sql(SCHEMA)}.activity WHERE activity_id = ${activityId} LIMIT 1`,
		sql<
			SessionRow[]
		>`SELECT ${SESSION_COLS} FROM ${sql(SCHEMA)}.session WHERE activity_id = ${activityId} ORDER BY start_time ASC`,
		sql<LapRow[]>`SELECT ${LAP_COLS} FROM ${sql(SCHEMA)}.lap WHERE activity_id = ${activityId} ORDER BY number ASC`,
		sql<
			RecordRow[]
		>`SELECT ${RECORD_COLS} FROM ${sql(SCHEMA)}.record WHERE activity_id = ${activityId} ORDER BY "timestamp" ASC`,
		sql<
			EventRow[]
		>`SELECT ${EVENT_COLS} FROM ${sql(SCHEMA)}.event WHERE activity_id = ${activityId} ORDER BY "timestamp" ASC`,
		sql<
			LengthRow[]
		>`SELECT ${LENGTH_COLS} FROM ${sql(SCHEMA)}.length WHERE activity_id = ${activityId} ORDER BY message_index ASC`,
	]);

	const activity = activityRows[0];
	if (!activity) return null;

	return { activity, sessions, laps, records, events, lengths };
}

/**
 * Hydrate many activities in bulk. Runs one query per table filtered by
 * `activity_id = ANY(ids)`, then groups rows by activity_id in JS.
 *
 * Returns inputs in the same order as the requested ids (skipping any id that
 * has no activity row).
 */
export async function fetchActivityFitInputs(ids: number[]): Promise<ActivityFitInput[]> {
	if (ids.length === 0) return [];

	const [activityRows, sessionRows, lapRows, recordRows, eventRows, lengthRows] = await Promise.all([
		sql<ActivityRow[]>`SELECT ${ACTIVITY_COLS} FROM ${sql(SCHEMA)}.activity WHERE activity_id = ANY(${ids})`,
		sql<
			(SessionRow & { activityId: number })[]
		>`SELECT ${SESSION_COLS} FROM ${sql(SCHEMA)}.session WHERE activity_id = ANY(${ids}) ORDER BY start_time ASC`,
		sql<
			(LapRow & { activityId: number })[]
		>`SELECT ${LAP_COLS} FROM ${sql(SCHEMA)}.lap WHERE activity_id = ANY(${ids}) ORDER BY number ASC`,
		sql<
			(RecordRow & { activityId: number })[]
		>`SELECT ${RECORD_COLS} FROM ${sql(SCHEMA)}.record WHERE activity_id = ANY(${ids}) ORDER BY "timestamp" ASC`,
		sql<
			(EventRow & { activityId: number })[]
		>`SELECT ${EVENT_COLS} FROM ${sql(SCHEMA)}.event WHERE activity_id = ANY(${ids}) ORDER BY "timestamp" ASC`,
		sql<
			(LengthRow & { activityId: number })[]
		>`SELECT ${LENGTH_COLS} FROM ${sql(SCHEMA)}.length WHERE activity_id = ANY(${ids}) ORDER BY message_index ASC`,
	]);

	const activityById = new Map<number, ActivityRow>();
	for (const a of activityRows) activityById.set(Number(a.activityId), a);

	const group = <T extends { activityId: number | string }>(rows: T[]): Map<number, T[]> => {
		const map = new Map<number, T[]>();
		for (const row of rows) {
			const key = Number(row.activityId);
			const arr = map.get(key);
			if (arr) arr.push(row);
			else map.set(key, [row]);
		}
		return map;
	};

	const sessionsBy = group(sessionRows);
	const lapsBy = group(lapRows);
	const recordsBy = group(recordRows);
	const eventsBy = group(eventRows);
	const lengthsBy = group(lengthRows);

	const inputs: ActivityFitInput[] = [];
	for (const id of ids) {
		const activity = activityById.get(id);
		if (!activity) continue;
		inputs.push({
			activity,
			sessions: sessionsBy.get(id) ?? [],
			laps: lapsBy.get(id) ?? [],
			records: recordsBy.get(id) ?? [],
			events: eventsBy.get(id) ?? [],
			lengths: lengthsBy.get(id) ?? [],
		});
	}

	return inputs;
}

/**
 * Resolve the set of activity IDs matching text-search filters, mirroring the
 * GET /api/search normalization (ILIKE + trigram fuzzy on q). Returns IDs
 * ordered by local_timestamp DESC. When no filters are given, returns every
 * activity id (used by the `all: true` export path).
 */
export async function resolveExportIds(filters: {
	q?: string;
	titleSearch?: string;
	descriptionSearch?: string;
}): Promise<number[]> {
	const q = filters.q?.trim() || "";
	const titleSearch = filters.titleSearch?.trim() || "";
	const descriptionSearch = filters.descriptionSearch?.trim() || "";

	if (!q && !titleSearch && !descriptionSearch) {
		const rows = await sql<{ activityId: number }[]>`
			SELECT activity_id
			FROM ${sql(SCHEMA)}.activity
			ORDER BY COALESCE(local_timestamp, "timestamp") DESC
		`;
		return rows.map((r) => Number(r.activityId));
	}

	const normalized = q ? q.toLowerCase().replace(/\s+/g, " ").trim() : "";
	const titlePattern = titleSearch ? `%${titleSearch.toLowerCase().replace(/\s+/g, " ").trim()}%` : null;
	const descPattern = descriptionSearch ? `%${descriptionSearch.toLowerCase().replace(/\s+/g, " ").trim()}%` : null;

	const rows = await sql<{ activityId: number }[]>`
		SELECT a.activity_id
		FROM ${sql(SCHEMA)}.activity a
		WHERE
			(${titlePattern}::text IS NULL OR a.activity_name ILIKE ${titlePattern ?? ""})
			AND (${descPattern}::text IS NULL OR a.description ILIKE ${descPattern ?? ""})
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
		ORDER BY COALESCE(a.local_timestamp, a."timestamp") DESC
	`;
	return rows.map((r) => Number(r.activityId));
}
