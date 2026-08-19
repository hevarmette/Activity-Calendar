/**
 * Workout FIT file generation route.
 *
 * POST /api/workouts/generate
 *   Body: WorkoutDefinition JSON
 *   Response: Binary .fit file (application/octet-stream)
 *
 * Encodes a structured workout definition into a Garmin-compatible FIT
 * workout file using the official @garmin/fitsdk Encoder. The resulting
 * file can be placed in Garmin/Workout/ on a device or synced via
 * Garmin Connect.
 */

import {
	type WorkoutDefinition,
	type WorkoutStep,
	type WorkoutStepOrRepeat,
	isRepeatStep,
} from "@activity-calendar/shared";
import { Encoder, Profile } from "@garmin/fitsdk";
import { Hono } from "hono";
import { z } from "zod";

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
 * - time: the SDK applies scale 1000, so pass seconds (SDK will write ms)
 * - distance: the SDK applies scale 100, so pass meters (SDK will write centimeters)
 * - open: 0
 */
function encodeDurationValue(durationType: string, value?: number): number {
	if (durationType === "open" || value === undefined) return 0;
	// The SDK handles scaling via the profile field definitions (subFields).
	// For "time" durationType (value 0), the subField "durationTime" has scale=1000,
	// meaning the SDK divides by scale when reading and multiplies when writing.
	// We pass the value in the user-facing unit (seconds / meters) and the SDK
	// applies the scale factor during encoding.
	return value;
}

/**
 * Encode custom target low/high values for the FIT file.
 * - speed: the SDK's customTargetSpeedLow subField has scale=1000, units=m/s
 *   so we pass m/s and the SDK writes it as mm/s internally.
 * - heartRate: bpm, offset 100 per FIT spec (100 + bpm means custom absolute bpm)
 * - power: watts, offset 1000 per FIT spec (1000 + watts means custom absolute watts)
 * - cadence: rpm/spm, no offset
 * - open: 0
 */
function encodeCustomTargetLow(targetType: string, value?: number): number {
	if (value === undefined) return 0;
	switch (targetType) {
		case "speed":
			return value; // m/s — SDK applies scale 1000
		case "heartRate":
			return 100 + value; // FIT convention: 100 + bpm for absolute
		case "power":
			return 1000 + value; // FIT convention: 1000 + watts for absolute
		case "cadence":
			return value;
		default:
			return 0;
	}
}

function encodeCustomTargetHigh(targetType: string, value?: number): number {
	if (value === undefined) return 0;
	switch (targetType) {
		case "speed":
			return value;
		case "heartRate":
			return 100 + value;
		case "power":
			return 1000 + value;
		case "cadence":
			return value;
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

// --- Route handler ---

workoutsRoutes.post("/generate", async (c) => {
	const body = await c.req.json();

	// Validate input
	const result = workoutDefinitionSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: "Invalid workout definition", details: result.error.flatten() }, 400);
	}

	const workout = result.data as WorkoutDefinition;
	const flatSteps = flattenSteps(workout.steps);

	try {
		const encoder = new Encoder();

		// 1. File ID message (required first)
		encoder.onMesg(Profile.MesgNum.FILE_ID, {
			type: "workout",
			manufacturer: "development",
			product: 0,
			timeCreated: new Date(),
			serialNumber: 12345,
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
		const uint8Array: Uint8Array = encoder.close();

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
