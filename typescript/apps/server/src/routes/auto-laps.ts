import { Hono } from "hono";
import sql, { SCHEMA } from "../db.js";
import { computeAutoLaps } from "../lib/auto-laps.js";

export const autoLapsRoutes = new Hono();

autoLapsRoutes.get("/:id/auto-laps", async (c) => {
  const activityId = Number(c.req.param("id"));
  const sport = c.req.query("sport") || "running";
  const dist = Number(c.req.query("dist")) || 1;

  const [records, events] = await Promise.all([
    sql`
      SELECT distance, "timestamp", heart_rate, cadence, enhanced_speed, altitude
      FROM ${sql(SCHEMA)}.record
      WHERE activity_id = ${activityId}
      ORDER BY "timestamp" ASC
    `,
    sql`
      SELECT "timestamp", event, event_type
      FROM ${sql(SCHEMA)}.event
      WHERE activity_id = ${activityId} AND event = 'timer'
      ORDER BY "timestamp" ASC
    `,
  ]);

  const laps = computeAutoLaps(records as any, events as any, sport, dist);
  return c.json(laps);
});
