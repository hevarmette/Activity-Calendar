/**
 * Pure conversion of a completed activity's laps into a WorkoutDefinition.
 *
 * Each lap becomes a step (distance- or time-based, with rounded values),
 * then consecutive repeating blocks are collapsed into RepeatSteps.
 * No API changes: the result is saved through the existing POST /api/workouts.
 */

import { Intensity } from "./enums.js";
import type { Lap } from "./types.js";
import type {
	RepeatStep,
	StepIntensity,
	WorkoutDefinition,
	WorkoutSport,
	WorkoutStep,
	WorkoutStepOrRepeat,
} from "./workout-types.js";

/** Whether generated steps are measured by distance or by time. */
export type WorkoutMode = "distance" | "time";

/** Input for {@link activityToWorkout}. */
export interface ActivityToWorkoutInput {
	/** Workout name. */
	name: string;
	/** Activity sport string (e.g. "running"). Unsupported sports yield null. */
	sport: string;
	/** Laps of the activity, in order. */
	laps: Lap[];
	/** Step measurement mode. */
	mode: WorkoutMode;
}

/** Longest repeating block (in steps) that will be collapsed. */
const MAX_REPEAT_PERIOD = 3;

/**
 * Map an activity sport string to a WorkoutSport.
 * Returns null for unsupported sports (e.g. "multisport").
 */
export function toWorkoutSport(sport: string | null | undefined): WorkoutSport | null {
	const s = (sport ?? "").toLowerCase();
	if (s === "running" || s === "cycling" || s === "swimming") return s;
	return null;
}

/** Round `value` to the nearest multiple of `increment`. */
export function roundTo(value: number, increment: number): number {
	return Math.round(value / increment) * increment;
}

/**
 * Rounding increment (meters) for a lap distance.
 * Swimming: 25 m. Running: 100 m below 5 km, else 500 m.
 * Cycling: 500 m below 5 km, 1000 m below 20 km, else 5000 m.
 */
export function distanceIncrement(sport: WorkoutSport, meters: number): number {
	if (sport === "swimming") return 25;
	if (sport === "running") return meters < 5000 ? 100 : 500;
	if (meters < 5000) return 500;
	return meters < 20000 ? 1000 : 5000;
}

/** Round a lap distance (meters) using the sport's increment. */
export function roundDistance(sport: WorkoutSport, meters: number): number {
	return roundTo(meters, distanceIncrement(sport, meters));
}

/** Round a lap duration (seconds): 30 s below 10 min, otherwise 60 s. */
export function roundDuration(seconds: number): number {
	return roundTo(seconds, seconds < 600 ? 30 : 60);
}

/** Map a DB lap intensity string (Intensity enum) to a StepIntensity. Unknown/null → "active". */
export function mapLapIntensity(intensity: string | null | undefined): StepIntensity {
	switch (intensity) {
		case Intensity.WarmUp:
			return "warmup";
		case Intensity.Recovery:
			return "recovery";
		case Intensity.Rest:
			return "rest";
		case Intensity.Cooldown:
			return "cooldown";
		default:
			return "active";
	}
}

const INTENSITY_LABEL: Record<StepIntensity, string> = {
	active: "Active",
	rest: "Rest",
	warmup: "Warmup",
	cooldown: "Cooldown",
	recovery: "Recovery",
	interval: "Interval",
	other: "Other",
};

/** Build a short step name such as "800m Active" or "2:30 Rest". */
export function formatStepName(intensity: StepIntensity, mode: WorkoutMode, value: number): string {
	let amount: string;
	if (mode === "distance") {
		amount = value >= 1000 && value % 1000 === 0 ? `${value / 1000}km` : `${value}m`;
	} else {
		const m = Math.floor(value / 60);
		const s = value % 60;
		amount = `${m}:${String(s).padStart(2, "0")}`;
	}
	return `${amount} ${INTENSITY_LABEL[intensity]}`;
}

/**
 * Convert one lap into a step, or null if the relevant value is null, ≤ 0,
 * or rounds to 0.
 */
export function lapToStep(lap: Lap, sport: WorkoutSport, mode: WorkoutMode): WorkoutStep | null {
	const raw = mode === "distance" ? lap.totalDistance : lap.totalTimerTime;
	if (raw === null || raw === undefined || !(raw > 0)) return null;
	const value = mode === "distance" ? roundDistance(sport, raw) : roundDuration(raw);
	if (value <= 0) return null;
	const intensity = mapLapIntensity(lap.intensity);
	return {
		name: formatStepName(intensity, mode, value),
		durationType: mode,
		durationValue: value,
		targetType: "open",
		intensity,
	};
}

function sameStep(a: WorkoutStep, b: WorkoutStep): boolean {
	return a.durationType === b.durationType && a.durationValue === b.durationValue && a.intensity === b.intensity;
}

/** Number of consecutive repetitions of steps[i..i+p) starting at i. */
function countRepeats(steps: WorkoutStep[], i: number, p: number): number {
	let reps = 1;
	while (i + (reps + 1) * p <= steps.length) {
		const start = i + reps * p;
		let match = true;
		for (let k = 0; k < p; k++) {
			if (!sameStep(steps[i + k] as WorkoutStep, steps[start + k] as WorkoutStep)) {
				match = false;
				break;
			}
		}
		if (!match) break;
		reps++;
	}
	return reps;
}

/**
 * Collapse consecutive repeating blocks (period 1–3, at least 2 repetitions)
 * into RepeatSteps. At each position the period covering the most steps wins;
 * ties go to the shorter period.
 */
export function collapseSteps(steps: WorkoutStep[]): WorkoutStepOrRepeat[] {
	const out: WorkoutStepOrRepeat[] = [];
	let i = 0;
	while (i < steps.length) {
		let bestP = 0;
		let bestReps = 1;
		let bestCover = 0;
		for (let p = 1; p <= MAX_REPEAT_PERIOD; p++) {
			if (i + 2 * p > steps.length) break;
			const reps = countRepeats(steps, i, p);
			if (reps >= 2 && reps * p > bestCover) {
				bestP = p;
				bestReps = reps;
				bestCover = reps * p;
			}
		}
		if (bestP > 0) {
			const repeat: RepeatStep = {
				steps: steps.slice(i, i + bestP).map((s) => ({ ...s })),
				repeatCount: bestReps,
			};
			out.push(repeat);
			i += bestCover;
		} else {
			out.push(steps[i] as WorkoutStep);
			i++;
		}
	}
	return out;
}

/**
 * Convert an activity's laps into a WorkoutDefinition.
 *
 * Returns null when the sport is unsupported (e.g. multisport). The returned
 * definition may have an empty `steps` array if no lap yields a usable step;
 * callers should check before saving.
 */
export function activityToWorkout(input: ActivityToWorkoutInput): WorkoutDefinition | null {
	const sport = toWorkoutSport(input.sport);
	if (!sport) return null;
	const steps: WorkoutStep[] = [];
	for (const lap of input.laps) {
		const step = lapToStep(lap, sport, input.mode);
		if (step) steps.push(step);
	}
	return { name: input.name, sport, steps: collapseSteps(steps) };
}
