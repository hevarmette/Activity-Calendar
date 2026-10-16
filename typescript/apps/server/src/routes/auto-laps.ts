import { Hono } from "hono";
import sql, { resolveReadSchema, UnknownSchemaError } from "../db.js";
import { computeAutoLaps } from "../lib/auto-laps.js";

export const autoLapsRoutes = new Hono();

autoLapsRoutes.get("/:id/auto-laps", async (c) => {
	const activityId = Number(c.req.param("id"));
	const sport = c.req.query("sport") || "running";
	const dist = Number(c.req.query("dist")) || 1;

	// Optional session window for multisport legs: when `start`/`end` are provided
	// (ISO timestamps), auto-laps are computed over just that leg's records so
	// each leg is split independently rather than across the whole activity.
	const startParam = c.req.query("start");
	const endParam = c.req.query("end");
	const startMs = startParam ? Date.parse(startParam) : Number.NaN;
	const endMs = endParam ? Date.parse(endParam) : Number.NaN;
	const hasWindow = Number.isFinite(startMs) && Number.isFinite(endMs);

	let schema: string;
	try {
		schema = resolveReadSchema(c.req.query("schema"));
	} catch (err) {
		if (err instanceof UnknownSchemaError) return c.json({ error: err.message }, 400);
		throw err;
	}

	const [records, events] = await Promise.all([
		sql`
      SELECT distance, "timestamp", heart_rate, cadence, enhanced_speed, altitude
      FROM ${sql(schema)}.record
      WHERE activity_id = ${activityId}
      ORDER BY "timestamp" ASC
    `,
		sql`
      SELECT "timestamp", event, event_type
      FROM ${sql(schema)}.event
      WHERE activity_id = ${activityId} AND event = 'timer'
      ORDER BY "timestamp" ASC
    `,
	]);

	// Scope to the requested session window and rebase cumulative distance to the
	// leg start so per-leg laps are measured from 0 within the leg.
	let scopedRecords = records as any[];
	let scopedEvents = events as any[];
	if (hasWindow) {
		scopedRecords = (records as any[]).filter((r) => {
			const t = Date.parse(r.timestamp);
			return t >= startMs && t <= endMs;
		});
		scopedEvents = (events as any[]).filter((e) => {
			const t = Date.parse(e.timestamp);
			return t >= startMs && t <= endMs;
		});
		const baseDist = scopedRecords.length > 0 ? (scopedRecords[0]!.distance ?? 0) : 0;
		scopedRecords = scopedRecords.map((r) => ({
			...r,
			distance: r.distance != null ? r.distance - baseDist : r.distance,
		}));
	}

	const laps = computeAutoLaps(scopedRecords as any, scopedEvents as any, sport, dist);
	return c.json(laps);
});
