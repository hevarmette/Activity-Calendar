import { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sql, { SCHEMA } from "../db.js";

export const recordsRoutes = new Hono();

const METERS_TO_FEET = 3.28084;
const CACHE_DIR = join(import.meta.dirname ?? ".", ".elevation-cache");

function getCachePath(activityId: number): string {
	return join(CACHE_DIR, `${activityId}.json`);
}

function readCache(activityId: number): number[] | null {
	const path = getCachePath(activityId);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

function writeCache(activityId: number, elevations: number[]): void {
	if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
	writeFileSync(getCachePath(activityId), JSON.stringify(elevations));
}

/**
 * Fetches corrected elevation data from the Open-Meteo API.
 *
 * From the original Streamlit db.py:
 * "Getting elevation data from 3rd party package because the garmin data is bad"
 * The Garmin barometric altitude is often inaccurate, so we fetch DEM-based
 * elevations for the GPS coordinates. Values are converted from meters to feet.
 * If the API call fails (rate limiting, network error), we fall back to the
 * raw altitude column from the FIT file (also converted to feet).
 */
async function fetchElevations(activityId: number, records: any[]): Promise<number[]> {
	const cached = readCache(activityId);
	if (cached && cached.length === records.length) return cached;

	const elevations = new Array(records.length).fill(null);
	const BATCH = 80;
	const MAX_RETRIES = 3;
	const BASE_DELAY_MS = 500;

	try {
		for (let i = 0; i < records.length; i += BATCH) {
			const batch = records.slice(i, i + BATCH);
			const lats = batch.map((r: any) => r.latitude).join(",");
			const lons = batch.map((r: any) => r.longitude).join(",");

			let lastError: Error | null = null;
			let success = false;

			// Retry with exponential backoff on rate limit or transient errors
			for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
				try {
					const res = await fetch(
						`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`
					);
					if (res.status === 429 || res.status >= 500) {
						// Rate limited or server error — retry after backoff
						const delay = BASE_DELAY_MS * 2 ** attempt;
						await new Promise((r) => setTimeout(r, delay));
						continue;
					}
					if (!res.ok) throw new Error(`elevation API returned ${res.status}`);
					const data = await res.json();
					for (let j = 0; j < data.elevation.length; j++) {
						elevations[i + j] = data.elevation[j] * METERS_TO_FEET;
					}
					success = true;
					break;
				} catch (err) {
					lastError = err instanceof Error ? err : new Error(String(err));
					if (attempt < MAX_RETRIES - 1) {
						const delay = BASE_DELAY_MS * 2 ** attempt;
						await new Promise((r) => setTimeout(r, delay));
					}
				}
			}

			if (!success) {
				// If all retries failed for this batch, fall back to raw altitude
				console.warn(
					`Elevation fetch failed for batch at index ${i}: ${lastError?.message}. Using raw altitude.`
				);
				for (let j = 0; j < batch.length; j++) {
					elevations[i + j] = records[i + j].altitude != null
						? records[i + j].altitude * METERS_TO_FEET
						: null;
				}
			}

			// Delay between successful batches to avoid rate limiting (500ms)
			if (i + BATCH < records.length) await new Promise((r) => setTimeout(r, 500));
		}
		// Only cache if all values were fetched from the API (no fallbacks)
		if (elevations.every((e) => e !== null)) {
			writeCache(activityId, elevations);
		}
	} catch {
		// Fallback: use raw altitude from DB if available
		for (let i = 0; i < records.length; i++) {
			elevations[i] = records[i].altitude != null ? records[i].altitude * METERS_TO_FEET : null;
		}
	}
	return elevations;
}

/**
 * Computes pause-removed elapsed time for each record point.
 *
 * From the original Streamlit db.py:
 * "Compute pause-removed elapsed time using timer events so time-based graphs
 * don't show gaps during paused periods."
 *
 * The algorithm builds pause intervals from stop_all/start event pairs,
 * then subtracts the total paused duration from each point's raw elapsed time.
 * This ensures performance charts (pace over time, HR over time) show continuous
 * moving time without misleading flat sections during pauses.
 */
function computeElapsedTimes(records: any[], events: any[]): number[] {
	if (records.length === 0) return [];
	const firstTs = new Date(records[0].timestamp).getTime() / 1000;

	// Build pause intervals
	const pauses: { start: number; end: number }[] = [];
	let stopTime: number | null = null;
	for (const ev of events) {
		const ts = new Date(ev.timestamp).getTime() / 1000;
		if (ev.eventType === "stop_all") stopTime = ts;
		else if (ev.eventType === "start" && stopTime !== null) {
			pauses.push({ start: stopTime, end: ts });
			stopTime = null;
		}
	}

	return records.map((r: any) => {
		const ts = new Date(r.timestamp).getTime() / 1000;
		let pausedSeconds = 0;
		for (const p of pauses) {
			if (p.end <= ts) pausedSeconds += p.end - p.start;
			else if (p.start < ts) pausedSeconds += ts - p.start;
		}
		return ts - firstTs - pausedSeconds;
	});
}

/**
 * GET /api/records/:activityId - fetch GPS points with imputed lat/lon.
 *
 * From the original Streamlit db.py (fetch_activity_points):
 * "In rare cases, I was receiving an NA error when plotting some maps, so
 * this query will impute missing values by taking the next available, and
 * previous lat and long. Will not work if missing value is at the start or
 * end. For that see if the session table has the start and end lat and longs."
 *
 * The SQL uses window functions (COUNT + FIRST_VALUE) to forward/backward fill
 * null lat/lon gaps, averaging the nearest bounds when both sides are available.
 */
recordsRoutes.get("/:activityId", async (c) => {
	const activityId = Number(c.req.param("activityId"));

	const [rows, events] = await Promise.all([
		sql`
			WITH groups AS (
				SELECT
					record_id, activity_id, "timestamp", latitude, longitude,
					lap, altitude, heart_rate, cadence, fractional_cadence,
					enhanced_speed, distance,
					COUNT(latitude) OVER (ORDER BY "timestamp" ASC) as fwd_grp,
					COUNT(latitude) OVER (ORDER BY "timestamp" DESC) as bwd_grp
				FROM ${sql(SCHEMA)}.record
				WHERE activity_id = ${activityId}
			),
			imputed_bounds AS (
				SELECT *,
					FIRST_VALUE(latitude) OVER (PARTITION BY fwd_grp ORDER BY "timestamp" ASC) as prev_lat,
					FIRST_VALUE(longitude) OVER (PARTITION BY fwd_grp ORDER BY "timestamp" ASC) as prev_long,
					FIRST_VALUE(latitude) OVER (PARTITION BY bwd_grp ORDER BY "timestamp" DESC) as next_lat,
					FIRST_VALUE(longitude) OVER (PARTITION BY bwd_grp ORDER BY "timestamp" DESC) as next_long
				FROM groups
			)
			SELECT
				record_id, activity_id,
				COALESCE(latitude, (prev_lat + next_lat) / 2.0, next_lat, prev_lat) as latitude,
				COALESCE(longitude, (prev_long + next_long) / 2.0, next_long, prev_long) as longitude,
				lap, altitude, "timestamp", heart_rate, cadence, fractional_cadence,
				enhanced_speed, distance
			FROM imputed_bounds
			ORDER BY "timestamp" ASC
		`,
		sql`
			SELECT "timestamp", event, event_type
			FROM ${sql(SCHEMA)}.event
			WHERE activity_id = ${activityId} AND event = 'timer'
			ORDER BY "timestamp" ASC
		`,
	]);

	const [elevations, elapsedTimes] = await Promise.all([
		fetchElevations(activityId, rows as any[]),
		Promise.resolve(computeElapsedTimes(rows as any[], events as any[])),
	]);

	const result = (rows as any[]).map((r, i) => ({
		...r,
		fractionalCadence: r.fractionalCadence != null ? Number(r.fractionalCadence) : null,
		correctedAltitude: elevations[i],
		elapsedTime: elapsedTimes[i],
	}));

	return c.json(result);
});
