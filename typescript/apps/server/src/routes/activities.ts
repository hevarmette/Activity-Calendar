/**
 * Activity routes — CRUD for activities.
 *
 * GET /api/activities/:id
 *   Response: ActivityDetails (single activity with distance, duration, description, etc.)
 *
 * PATCH /api/activities/:id
 *   Body: ActivityUpdatePayload (partial fields to update)
 *   Response: { success: true, sql: string }
 *
 * POST /api/activities
 *   Body: CreateActivityPayload
 *   Response: CreateActivityResponse ({ activityId: number }) with status 201
 *   Creates a manual activity with session and lap rows in a single transaction.
 *   No GPS record data is generated for manual activities.
 */
import { SUB_SPORT_OPTIONS } from "@activity-calendar/shared";
import { Hono } from "hono";
import { z } from "zod";
import { TIMEZONE } from "../config.js";
import sql, { SCHEMA } from "../db.js";

export const activitiesRoutes = new Hono();

activitiesRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const rows = await sql`
		SELECT
			a.activity_id,
			a.adjusted_distance AS distance,
			a.adjusted_duration AS duration,
			CAST(s.avg_power AS INTEGER) AS avg_power,
			a.description,
			a.workout_feel AS feel,
			a.effort,
			COALESCE(a.local_timestamp, a.timestamp AT TIME ZONE ${TIMEZONE}) AS local_timestamp,
			a.activity_name AS name,
			a.category
		FROM ${sql(SCHEMA)}.activity a
		JOIN ${sql(SCHEMA)}.session s ON a.activity_id = s.activity_id
		WHERE a.activity_id = ${id}
		LIMIT 1
	`;
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json(rows[0]);
});

const activityUpdateSchema = z.object({
  adjustedDistance: z.number().optional(),
  adjustedDuration: z.number().optional(),
  description: z.string().nullable().optional(),
  workoutFeel: z.number().nullable().optional(),
  effort: z.number().nullable().optional(),
  activityName: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
});

activitiesRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = activityUpdateSchema.parse(await c.req.json());

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.adjustedDistance !== undefined) {
    updates.push("adjusted_distance");
    values.push(body.adjustedDistance);
  }
  if (body.adjustedDuration !== undefined) {
    updates.push("adjusted_duration");
    values.push(body.adjustedDuration);
  }
  if (body.description !== undefined) {
    updates.push("description");
    values.push(body.description);
  }
  if (body.workoutFeel !== undefined) {
    updates.push("workout_feel");
    values.push(body.workoutFeel);
  }
  if (body.effort !== undefined) {
    updates.push("effort");
    values.push(body.effort);
  }
  if (body.activityName !== undefined) {
    updates.push("activity_name");
    values.push(body.activityName);
  }
  if (body.category !== undefined) {
    updates.push("category");
    values.push(body.category);
  }

  if (updates.length === 0) return c.json({ success: true, sql: null });

  const setClause = Object.fromEntries(
    updates.map((col, i) => [col, values[i]]),
  );

  await sql`
		UPDATE ${sql(SCHEMA)}.activity
		SET ${sql(setClause)}
		WHERE activity_id = ${id}
	`;

  const sqlString = `UPDATE ${SCHEMA}.activity SET ${updates.map((col, i) => `${col} = ${JSON.stringify(values[i])}`).join(", ")} WHERE activity_id = ${id};`;

  return c.json({ success: true, sql: sqlString });
});

// --- Manual activity creation ---

const createLapSchema = z.object({
  distance: z.number().min(0),
  time: z.number().min(0),
  intensity: z.string().optional(),
});

const createActivitySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  sport: z.enum(["running", "cycling", "swimming"]),
  subSport: z.string().optional(),
  category: z.string().max(15).optional(),
  localTimestamp: z.string().min(1),
  duration: z.number().positive(),
  distance: z.number().min(0).optional(),
  workoutFeel: z.number().nullable().optional(),
  // Effort is stored on a 1–100 scale (the UI's 1–10 slider is multiplied by 10
  // before submission, matching the details-page editor and PATCH schema).
  effort: z.number().min(1).max(100).nullable().optional(),
  laps: z.array(createLapSchema),
  debugSql: z.boolean().optional(),
});

/**
 * POST /api/activities — Create a manual activity.
 *
 * Inserts an activity, session, and lap rows in a single transaction.
 * No GPS record data is generated for manual activities.
 *
 * Body: CreateActivityPayload (validated via Zod)
 * Response: { activityId: number } with status 201
 */
activitiesRoutes.post("/", async (c) => {
  const body = await c.req.json();

  const result = createActivitySchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: "Invalid request body", details: result.error.flatten() },
      400,
    );
  }

  const data = result.data;

  // Validate sub_sport against allowed values for the sport
  if (data.subSport) {
    const allowed = SUB_SPORT_OPTIONS[data.sport];
    if (!allowed || !allowed.includes(data.subSport)) {
      return c.json(
        {
          error: `Invalid subSport "${data.subSport}" for sport "${data.sport}"`,
        },
        400,
      );
    }
  }

  // Compute derived values
  const laps =
    data.laps.length > 0
      ? data.laps
      : [
          {
            distance: data.distance ?? 0,
            time: data.duration,
            intensity: undefined,
          },
        ];
  const lapDistance = laps.reduce((sum, lap) => sum + lap.distance, 0);
  const totalDistance = data.distance ?? lapDistance;
  const totalDuration = data.duration;
  const numLaps = laps.length;
  const subSport = data.subSport || "generic";

  // Convert local timestamp to UTC by using PostgreSQL's timezone conversion.
  // The localTimestamp is stored as-is in local_timestamp column,
  // and we derive the UTC timestamp via AT TIME ZONE.
  const localTs = data.localTimestamp;

  // Build SQL debug strings if requested
  const sqlStatements: string[] = [];
  const wantDebug = data.debugSql === true;

  const activityId = await sql.begin(async (tx) => {
    // 1. Insert activity row
    if (wantDebug) {
      sqlStatements.push(
        `INSERT INTO ${SCHEMA}.activity ("timestamp", local_timestamp, activity_name, description, category, workout_feel, effort, total_timer_time, adjusted_distance, adjusted_duration, num_sessions, type, event, event_type) VALUES (('${localTs}'::timestamp AT TIME ZONE '${TIMEZONE}'), '${localTs}'::timestamp, '${data.title}', ${data.description ? `'${data.description}'` : "NULL"}, ${data.category ? `'${data.category}'` : "NULL"}, ${data.workoutFeel ?? "NULL"}, ${data.effort ?? "NULL"}, ${totalDuration}, ${totalDistance}, ${totalDuration}, 1, 'activity', 'activity', 'stop') RETURNING activity_id;`,
      );
    }
    const activityRows = await tx`
			INSERT INTO ${sql(SCHEMA)}.activity (
				"timestamp",
				local_timestamp,
				activity_name,
				description,
				category,
				workout_feel,
				effort,
				total_timer_time,
				adjusted_distance,
				adjusted_duration,
				num_sessions,
				type,
				event,
				event_type
			) VALUES (
				(${localTs}::timestamp AT TIME ZONE ${TIMEZONE}),
				${localTs}::timestamp,
				${data.title},
				${data.description ?? null},
				${data.category ?? null},
				${data.workoutFeel ?? null},
				${data.effort ?? null},
				${totalDuration},
				${totalDistance},
				${totalDuration},
				${1},
				${"activity"},
				${"activity"},
				${"stop"}
			)
			RETURNING activity_id
		`;
    const id = activityRows[0].activityId as number;

    // 2. Insert session row
    if (wantDebug) {
      sqlStatements.push(
        `INSERT INTO ${SCHEMA}.session (activity_id, "timestamp", start_time, total_elapsed_time, total_timer_time, total_distance, sport, sub_sport, num_laps, first_lap_index, event, event_type, trigger, message_index) VALUES (${id}, ('${localTs}'::timestamp AT TIME ZONE '${TIMEZONE}'), ('${localTs}'::timestamp AT TIME ZONE '${TIMEZONE}'), ${totalDuration}, ${totalDuration}, ${totalDistance}, '${data.sport}', '${subSport}', ${numLaps}, 0, 'lap', 'stop', 'activity_end', 0);`,
      );
    }
    await tx`
			INSERT INTO ${sql(SCHEMA)}.session (
				activity_id,
				"timestamp",
				start_time,
				total_elapsed_time,
				total_timer_time,
				total_distance,
				sport,
				sub_sport,
				num_laps,
				first_lap_index,
				event,
				event_type,
				trigger,
				message_index
			) VALUES (
				${id},
				(${localTs}::timestamp AT TIME ZONE ${TIMEZONE}),
				(${localTs}::timestamp AT TIME ZONE ${TIMEZONE}),
				${totalDuration},
				${totalDuration},
				${totalDistance},
				${data.sport},
				${subSport},
				${numLaps},
				${0},
				${"lap"},
				${"stop"},
				${"activity_end"},
				${0}
			)
		`;

    // 3. Insert lap rows with sequential start times
    let lapStartOffset = 0;
    for (let i = 0; i < laps.length; i++) {
      const lap = laps[i];
      const intensity = lap.intensity || null;

      if (wantDebug) {
        sqlStatements.push(
          `INSERT INTO ${SCHEMA}.lap (activity_id, start_time, number, total_distance, total_timer_time, intensity) VALUES (${id}, (('${localTs}'::timestamp AT TIME ZONE '${TIMEZONE}') + INTERVAL '1 second' * ${lapStartOffset}), ${i}, ${lap.distance}, ${lap.time}, ${intensity ? `'${intensity}'` : "NULL"});`,
        );
      }
      await tx`
				INSERT INTO ${sql(SCHEMA)}.lap (
					activity_id,
					start_time,
					number,
					total_distance,
					total_timer_time,
					intensity
				) VALUES (
					${id},
					((${localTs}::timestamp AT TIME ZONE ${TIMEZONE}) + INTERVAL '1 second' * ${lapStartOffset}),
					${i},
					${lap.distance},
					${lap.time},
					${intensity}
				)
			`;
      lapStartOffset += lap.time;
    }

    return id;
  });

  const response: { activityId: number; sql?: string[] } = { activityId };
  if (wantDebug) response.sql = sqlStatements;

  return c.json(response, 201);
});
