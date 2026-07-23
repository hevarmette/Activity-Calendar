import { Hono } from "hono";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sql, { SCHEMA } from "../db.js";

export const recordsRoutes = new Hono();

const METERS_TO_FEET = 3.28084;
const CACHE_DIR = join(import.meta.dirname ?? ".", ".elevation-cache");
const HELPER_SCRIPT = join(import.meta.dirname ?? ".", "..", "..", "elevation_helper.py");

// ─── Elevation Cache ─────────────────────────────────────────────────────────

function getCachePath(activityId: number): string {
	return join(CACHE_DIR, `${activityId}.json`);
}

function readCache(activityId: number): (number | null)[] | null {
	const path = getCachePath(activityId);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

function writeCache(activityId: number, elevations: (number | null)[]): void {
	if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
	writeFileSync(getCachePath(activityId), JSON.stringify(elevations));
}

// ─── pyhigh Elevation via subprocess ─────────────────────────────────────────

/**
 * Fetches corrected elevation data using pyhigh via a Python subprocess.
 *
 * From the original Streamlit db.py:
 * "Getting elevation data from 3rd party package because the garmin data is bad"
 *
 * pyhigh uses locally-cached SRTM .hgt files (downloaded on first use from
 * ArduPilot). After initial download, lookups are entirely local and fast.
 * Values are returned in meters and converted to feet here.
 *
 * If the subprocess fails (Python not available, pyhigh not installed),
 * falls back to raw altitude from the FIT file.
 */
function fetchElevationsPyhigh(activityId: number, records: any[]): (number | null)[] {
	// Check cache first
	const cached = readCache(activityId);
	if (cached && cached.length === records.length) return cached;

	// Filter to records with valid coordinates
	const coordsWithIndex: { idx: number; lat: number; lon: number }[] = [];
	for (let i = 0; i < records.length; i++) {
		const r = records[i];
		if (r.latitude != null && r.longitude != null) {
			coordsWithIndex.push({ idx: i, lat: r.latitude, lon: r.longitude });
		}
	}

	if (coordsWithIndex.length === 0) {
		// No coordinates at all — use raw altitude
		return records.map((r) => (r.altitude != null ? r.altitude * METERS_TO_FEET : null));
	}

	try {
		const input = JSON.stringify(coordsWithIndex.map((c) => [c.lat, c.lon]));

		const result = execSync(`python3 "${HELPER_SCRIPT}"`, {
			input,
			encoding: "utf-8",
			timeout: 30_000, // 30 second timeout
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large activities
		});

		const elevationsMeters: number[] = JSON.parse(result.trim());

		// Build full elevation array (feet) with nulls for records without coords
		const elevations: (number | null)[] = new Array(records.length).fill(null);
		for (let i = 0; i < coordsWithIndex.length; i++) {
			const { idx } = coordsWithIndex[i]!;
			elevations[idx] = elevationsMeters[i]! * METERS_TO_FEET;
		}

		// Fill null gaps with raw altitude fallback
		for (let i = 0; i < elevations.length; i++) {
			if (elevations[i] == null && records[i].altitude != null) {
				elevations[i] = records[i].altitude * METERS_TO_FEET;
			}
		}

		// Cache the result
		writeCache(activityId, elevations as number[]);
		return elevations as number[];
	} catch (err) {
		console.warn(
			`pyhigh elevation fetch failed for activity ${activityId}: ${err instanceof Error ? err.message : String(err)}. Using raw altitude.`
		);
		// Fallback to raw altitude from the FIT file
		return records.map((r: any) => (r.altitude != null ? r.altitude * METERS_TO_FEET : null));
	}
}

// ─── Elapsed Time Computation ────────────────────────────────────────────────

/**
 * Computes pause-removed elapsed time for each record point.
 *
 * From the original Streamlit db.py:
 * "Compute pause-removed elapsed time using timer events so time-based graphs
 * don't show gaps during paused periods."
 *
 * The algorithm builds pause intervals from stop_all/start event pairs,
 * then subtracts the total paused duration from each point's raw elapsed time.
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

// ─── Route ───────────────────────────────────────────────────────────────────

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

	const elevations = fetchElevationsPyhigh(activityId, rows as any[]);
	const elapsedTimes = computeElapsedTimes(rows as any[], events as any[]);

	const result = (rows as any[]).map((r, i) => ({
		...r,
		fractionalCadence: r.fractionalCadence != null ? Number(r.fractionalCadence) : null,
		correctedAltitude: elevations[i],
		elapsedTime: elapsedTimes[i],
	}));

	return c.json(result);
});
