import { Hono } from "hono";
import sql, { SCHEMA } from "../db.js";

export const recordsRoutes = new Hono();

const METERS_TO_FEET = 3.28084;

async function fetchElevations(records: any[]): Promise<number[]> {
	const elevations = new Array(records.length).fill(null);
	const BATCH = 100;
	try {
		for (let i = 0; i < records.length; i += BATCH) {
			const batch = records.slice(i, i + BATCH);
			const lats = batch.map((r: any) => r.latitude).join(",");
			const lons = batch.map((r: any) => r.longitude).join(",");
			const res = await fetch(
				`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`
			);
			if (!res.ok) throw new Error("elevation API failed");
			const data = await res.json();
			for (let j = 0; j < data.elevation.length; j++) {
				elevations[i + j] = data.elevation[j] * METERS_TO_FEET;
			}
		}
	} catch {
		// Fallback: use raw altitude
		for (let i = 0; i < records.length; i++) {
			elevations[i] = (records[i].altitude ?? 0) * METERS_TO_FEET;
		}
	}
	return elevations;
}

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

/** GET /api/records/:activityId - fetch GPS points with imputed lat/lon */
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
		fetchElevations(rows as any[]),
		Promise.resolve(computeElapsedTimes(rows as any[], events as any[])),
	]);

	const result = (rows as any[]).map((r, i) => ({
		...r,
		correctedAltitude: elevations[i],
		elapsedTime: elapsedTimes[i],
	}));

	return c.json(result);
});
