/**
 * Workout routes — FIT file generation and CRUD for saved workouts.
 *
 * POST /api/workouts/generate
 *   Body: WorkoutDefinition JSON
 *   Response: Binary .fit file (application/octet-stream)
 *   Encodes an ad-hoc workout definition into a Garmin-compatible FIT file.
 *
 * GET /api/workouts
 *   Query: ?sport=running (optional filter)
 *   Response: WorkoutListItem[] ordered by updated_at DESC
 *
 * POST /api/workouts
 *   Body: WorkoutDefinition JSON
 *   Response: { workoutId: number } with status 201
 *   Saves a new workout to the database.
 *
 * GET /api/workouts/:id
 *   Response: SavedWorkout (includes full step definition)
 *   Returns 404 if not found.
 *
 * PUT /api/workouts/:id
 *   Body: WorkoutDefinition JSON
 *   Response: { success: true }
 *   Updates all fields + updated_at. Returns 404 if not found.
 *
 * DELETE /api/workouts/:id
 *   Response: { success: true }
 *
 * POST /api/workouts/:id/generate
 *   Response: Binary .fit file (application/octet-stream)
 *   Generates a FIT file from a saved workout. Uses workout_id as serialNumber.
 */

import { type WorkoutDefinition, type WorkoutStepOrRepeat, isRepeatStep } from "@activity-calendar/shared";
import { Encoder, Profile } from "@garmin/fitsdk";
import { Hono } from "hono";
import { z } from "zod";
import sql, { SCHEMA } from "../db.js";

export const workoutsRoutes = new Hono();

// --- Zod validation schema ---

const stepSchema = z.object({
	name: z.string().optional(),
	durationType: z.enum(["time", "distance", "open"]),
	durationValue: z.number().optional(),
	targetType: z.enum(["speed", "heartRate", "power", "cadence", "open"]),
	customTargetValueLow: z.number().optional(),
	customTargetValueHigh: z.number().optional(),
	intensity: z.enum(["active", "rest", "warmup", "cooldown", "recovery", "interval"]),
});

const repeatStepSchema = z.object({
	steps: z.array(stepSchema).min(1),
	repeatCount: z.number().int().min(1).max(99),
});

const workoutStepOrRepeatSchema = z.union([repeatStepSchema, stepSchema]);

const workoutDefinitionSchema = z.object({
	name: z.string().min(1).max(50),
	sport: z.enum(["running", "cycling", "swimming"]),
	description: z.string().optional(),
	steps: z.array(workoutStepOrRepeatSchema).min(1),
});

// --- FIT encoding helpers ---

/** Map sport string to FIT sport enum value. */
const SPORT_MAP: Record<string, string> = {
	running: "running",
	cycling: "cycling",
	swimming: "swimming",
};

/** Map intensity string to FIT intensity enum value. */
const INTENSITY_MAP: Record<string, string> = {
	active: "active",
	rest: "rest",
	warmup: "warmup",
	cooldown: "cooldown",
	recovery: "recovery",
	interval: "interval",
};

/** Map duration type to FIT wktStepDuration enum value. */
const DURATION_TYPE_MAP: Record<string, string> = {
	time: "time",
	distance: "distance",
	open: "open",
};

/** Map target type to FIT wktStepTarget enum value. */
const TARGET_TYPE_MAP: Record<string, string> = {
	speed: "speed",
	heartRate: "heartRate",
	power: "power",
	cadence: "cadence",
	open: "open",
};

/**
 * Encode duration value for the FIT file.
 *
 * The SDK writes `durationValue` as a raw uint32 — it does NOT auto-apply
 * the subField scale factors. We must pre-scale ourselves:
 *   - time: seconds × 1000 → milliseconds
 *   - distance: meters × 100 → centimeters
 *   - open: 0
 */
function encodeDurationValue(durationType: string, value?: number): number {
	if (durationType === "open" || value === undefined) return 0;
	if (durationType === "time") return Math.round(value * 1000); // seconds → ms
	if (durationType === "distance") return Math.round(value * 100); // meters → cm
	return Math.round(value);
}

/**
 * Encode custom target low/high values for the FIT file.
 *
 * The SDK writes `customTargetValueLow/High` as raw uint32 without applying
 * subField scales. We must pre-scale:
 *   - speed: m/s × 1000 → mm/s
 *   - heartRate: 100 + bpm (FIT convention for custom absolute HR)
 *   - power: 1000 + watts (FIT convention for custom absolute power)
 *   - cadence: rpm/spm as-is
 *   - open: 0
 */
function encodeCustomTargetLow(targetType: string, value?: number): number {
	if (value === undefined) return 0;
	switch (targetType) {
		case "speed":
			return Math.round(value * 1000); // m/s → mm/s
		case "heartRate":
			return 100 + Math.round(value); // FIT convention: 100 + bpm for absolute
		case "power":
			return 1000 + Math.round(value); // FIT convention: 1000 + watts for absolute
		case "cadence":
			return Math.round(value);
		default:
			return 0;
	}
}

function encodeCustomTargetHigh(targetType: string, value?: number): number {
	if (value === undefined) return 0;
	switch (targetType) {
		case "speed":
			return Math.round(value * 1000); // m/s → mm/s
		case "heartRate":
			return 100 + Math.round(value); // FIT convention: 100 + bpm for absolute
		case "power":
			return 1000 + Math.round(value); // FIT convention: 1000 + watts for absolute
		case "cadence":
			return Math.round(value);
		default:
			return 0;
	}
}

/**
 * Flatten WorkoutStepOrRepeat[] into indexed FIT workout step messages.
 *
 * Single steps become one WORKOUT_STEP message each.
 * RepeatStep groups expand to: [inner steps...] + [repeat step].
 * The repeat step uses durationType="repeatUntilStepsCmplt",
 * durationValue=index of first step in the group, and
 * targetValue=repeatCount.
 *
 * Returns an array of FIT-ready step objects with messageIndex assigned.
 */
interface FlatStep {
	messageIndex: number;
	wktStepName?: string;
	durationType: string;
	durationValue: number;
	targetType: string;
	targetValue: number;
	customTargetValueLow: number;
	customTargetValueHigh: number;
	intensity: string;
}

function flattenSteps(steps: WorkoutStepOrRepeat[]): FlatStep[] {
	const flat: FlatStep[] = [];
	let idx = 0;

	for (const step of steps) {
		if (isRepeatStep(step)) {
			// Write inner steps first
			const groupStartIdx = idx;
			for (const inner of step.steps) {
				flat.push({
					messageIndex: idx,
					wktStepName: inner.name,
					durationType: DURATION_TYPE_MAP[inner.durationType],
					durationValue: encodeDurationValue(inner.durationType, inner.durationValue),
					targetType: TARGET_TYPE_MAP[inner.targetType],
					targetValue: 0, // 0 = custom target range
					customTargetValueLow: encodeCustomTargetLow(inner.targetType, inner.customTargetValueLow),
					customTargetValueHigh: encodeCustomTargetHigh(inner.targetType, inner.customTargetValueHigh),
					intensity: INTENSITY_MAP[inner.intensity],
				});
				idx++;
			}
			// Write the repeat step itself
			flat.push({
				messageIndex: idx,
				durationType: "repeatUntilStepsCmplt",
				durationValue: groupStartIdx, // index of first step to loop back to
				targetType: "open",
				targetValue: step.repeatCount, // number of repetitions
				customTargetValueLow: 0,
				customTargetValueHigh: 0,
				intensity: "active",
			});
			idx++;
		} else {
			flat.push({
				messageIndex: idx,
				wktStepName: step.name,
				durationType: DURATION_TYPE_MAP[step.durationType],
				durationValue: encodeDurationValue(step.durationType, step.durationValue),
				targetType: TARGET_TYPE_MAP[step.targetType],
				targetValue: 0,
				customTargetValueLow: encodeCustomTargetLow(step.targetType, step.customTargetValueLow),
				customTargetValueHigh: encodeCustomTargetHigh(step.targetType, step.customTargetValueHigh),
				intensity: INTENSITY_MAP[step.intensity],
			});
			idx++;
		}
	}

	return flat;
}

/**
 * Encode a WorkoutDefinition into a binary FIT Uint8Array.
 *
 * Shared by both ad-hoc POST /generate and POST /:id/generate routes.
 */
function encodeFitWorkout(workout: WorkoutDefinition, serialNumber: number): Uint8Array {
	const flatSteps = flattenSteps(workout.steps);
	const encoder = new Encoder();

	// 1. File ID message (required first)
	encoder.onMesg(Profile.MesgNum.FILE_ID, {
		type: "workout",
		manufacturer: "development",
		product: 0,
		timeCreated: new Date(),
		serialNumber,
	});

	// 2. Workout message
	encoder.onMesg(Profile.MesgNum.WORKOUT, {
		wktName: workout.name,
		sport: SPORT_MAP[workout.sport],
		subSport: "generic",
		numValidSteps: flatSteps.length,
	});

	// 3. Workout step messages
	for (const step of flatSteps) {
		const mesg: Record<string, unknown> = {
			messageIndex: step.messageIndex,
			durationType: step.durationType,
			durationValue: step.durationValue,
			targetType: step.targetType,
			targetValue: step.targetValue,
			customTargetValueLow: step.customTargetValueLow,
			customTargetValueHigh: step.customTargetValueHigh,
			intensity: step.intensity,
		};
		if (step.wktStepName) {
			mesg.wktStepName = step.wktStepName;
		}
		encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, mesg);
	}

	// Finalize encoding
	return encoder.close();
}

// --- Route handlers ---

// 1. POST /generate — Ad-hoc FIT generation from JSON body
workoutsRoutes.post("/generate", async (c) => {
	const body = await c.req.json();

	// Validate input
	const result = workoutDefinitionSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: "Invalid workout definition", details: result.error.flatten() }, 400);
	}

	const workout = result.data as WorkoutDefinition;

	try {
		const uint8Array = encodeFitWorkout(workout, Date.now() % 2147483647);

		// Sanitize filename
		const filename = `${workout.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.fit`;

		return new Response(uint8Array, {
			headers: {
				"Content-Type": "application/octet-stream",
				"Content-Disposition": `attachment; filename="${filename}"`,
				"Content-Length": String(uint8Array.byteLength),
			},
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown encoding error";
		return c.json({ error: "FIT encoding failed", details: message }, 500);
	}
});

// 2. GET / — List saved workouts
workoutsRoutes.get("/", async (c) => {
	const sport = c.req.query("sport");

	const rows = sport
		? await sql`
			SELECT workout_id, name, sport, description, created_at, updated_at
			FROM ${sql(SCHEMA)}.workout
			WHERE sport = ${sport}
			ORDER BY updated_at DESC
		`
		: await sql`
			SELECT workout_id, name, sport, description, created_at, updated_at
			FROM ${sql(SCHEMA)}.workout
			ORDER BY updated_at DESC
		`;

	return c.json(rows);
});

// 3. POST / — Save a new workout
workoutsRoutes.post("/", async (c) => {
	const body = await c.req.json();

	const result = workoutDefinitionSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: "Invalid workout definition", details: result.error.flatten() }, 400);
	}

	const workout = result.data;

	const rows = await sql`
		INSERT INTO ${sql(SCHEMA)}.workout (name, sport, description, definition)
		VALUES (${workout.name}, ${workout.sport}, ${workout.description ?? null}, ${JSON.stringify(workout.steps)})
		RETURNING workout_id
	`;

	return c.json({ workoutId: rows[0].workoutId }, 201);
});

// 4. GET /:id — Get a single workout with full definition
workoutsRoutes.get("/:id", async (c) => {
	const id = Number(c.req.param("id"));

	const rows = await sql`
		SELECT workout_id, name, sport, description, definition, created_at, updated_at
		FROM ${sql(SCHEMA)}.workout
		WHERE workout_id = ${id}
		LIMIT 1
	`;

	if (rows.length === 0) {
		return c.json({ error: "Not found" }, 404);
	}

	const row = rows[0];
	return c.json({
		workoutId: row.workoutId,
		name: row.name,
		sport: row.sport,
		description: row.description,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		definition: typeof row.definition === "string" ? JSON.parse(row.definition) : row.definition,
	});
});

// 5. PUT /:id — Update a workout
workoutsRoutes.put("/:id", async (c) => {
	const id = Number(c.req.param("id"));
	const body = await c.req.json();

	const result = workoutDefinitionSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: "Invalid workout definition", details: result.error.flatten() }, 400);
	}

	const workout = result.data;

	const rows = await sql`
		UPDATE ${sql(SCHEMA)}.workout
		SET name = ${workout.name},
			sport = ${workout.sport},
			description = ${workout.description ?? null},
			definition = ${JSON.stringify(workout.steps)},
			updated_at = NOW()
		WHERE workout_id = ${id}
		RETURNING workout_id
	`;

	if (rows.length === 0) {
		return c.json({ error: "Not found" }, 404);
	}

	return c.json({ success: true });
});

// 6. DELETE /:id — Delete a workout
workoutsRoutes.delete("/:id", async (c) => {
	const id = Number(c.req.param("id"));

	await sql`
		DELETE FROM ${sql(SCHEMA)}.workout
		WHERE workout_id = ${id}
	`;

	return c.json({ success: true });
});

// 7. POST /:id/generate — Generate FIT from a saved workout
workoutsRoutes.post("/:id/generate", async (c) => {
	const id = Number(c.req.param("id"));

	const rows = await sql`
		SELECT workout_id, name, sport, description, definition
		FROM ${sql(SCHEMA)}.workout
		WHERE workout_id = ${id}
		LIMIT 1
	`;

	if (rows.length === 0) {
		return c.json({ error: "Not found" }, 404);
	}

	const row = rows[0];
	const steps: WorkoutStepOrRepeat[] = typeof row.definition === "string" ? JSON.parse(row.definition) : row.definition;

	const workout: WorkoutDefinition = {
		name: row.name,
		sport: row.sport,
		description: row.description,
		steps,
	};

	try {
		const uint8Array = encodeFitWorkout(workout, row.workoutId);

		const filename = `${workout.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.fit`;

		return new Response(uint8Array, {
			headers: {
				"Content-Type": "application/octet-stream",
				"Content-Disposition": `attachment; filename="${filename}"`,
				"Content-Length": String(uint8Array.byteLength),
			},
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown encoding error";
		return c.json({ error: "FIT encoding failed", details: message }, 500);
	}
});
