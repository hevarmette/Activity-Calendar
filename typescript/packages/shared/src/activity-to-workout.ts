/**
 * Pure conversion of a completed activity's laps into a WorkoutDefinition.
 *
 * Each lap becomes a step (distance- or time-based, with rounded values),
 * then consecutive repeating blocks are collapsed into RepeatSteps.
 * No API changes: the result is saved through the existing POST /api/workouts.
 *
 * Generated steps never carry a `name` — the device/builder derives a label
 * from the duration and intensity, so step names are intentionally omitted.
 *
 * BREAKING CHANGES (vs. the previous version of this module):
 *   - {@link ActivityToWorkoutInput} replaced the single `mode` field with the
 *     pair `activeMode` + `restMode`. Callers passing `{ mode }` must migrate
 *     to `{ activeMode, restMode }`.
 *   - {@link ActivityToWorkoutInput} gained a required `units` field
 *     ("metric" | "imperial") that controls distance rounding.
 *   - {@link lapToStep} signature changed to
 *     `lapToStep(lap, sport, units, activeMode, restMode)`.
 *   - {@link distanceIncrement} / {@link roundDistance} now take a `units`
 *     argument.
 *   - Generated {@link WorkoutStep}s no longer have a `name`. `formatStepName`
 *     and the `INTENSITY_LABEL` map were removed.
 */

import { METERS_PER_MILE, METERS_PER_YARD } from "./constants.js";
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

/**
 * Unit system for distance rounding.
 *   - "metric": round to nice metric increments (25 m / 100 m / 500 m / …).
 *   - "imperial": round to nice imperial increments expressed in meters
 *     (25 yd / 100 yd / 0.25 mi / …).
 */
export type WorkoutUnits = "metric" | "imperial";

/** Input for {@link activityToWorkout}. */
export interface ActivityToWorkoutInput {
	/** Workout name. */
	name: string;
	/** Activity sport string (e.g. "running"). Unsupported sports yield null. */
	sport: string;
	/** Laps of the activity, in order. */
	laps: Lap[];
	/**
	 * Unit system controlling distance rounding increments.
	 * Does not affect time-based steps.
	 */
	units: WorkoutUnits;
	/**
	 * Measurement mode applied to active laps — any lap whose intensity is NOT
	 * `rest`/`recovery` (i.e. active/warmup/cooldown/interval/other).
	 */
	activeMode: WorkoutMode;
	/**
	 * Measurement mode applied to recovery laps — laps whose intensity is
	 * `rest` or `recovery`.
	 */
	restMode: WorkoutMode;
}

/**
 * Longest repeating block (in steps) that will be collapsed.
 *
 * 6 allows a 3-interval ladder with a recovery lap after each interval
 * (e.g. 1000/rest/800/rest/600/rest) to collapse as one cycle.
 */
const MAX_REPEAT_PERIOD = 6;

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
 * Rounding increment (in METERS) for a lap distance, for the given unit system.
 *
 * Metric:
 *   - swimming: 25 m
 *   - running: 100 m below 5 km, else 500 m
 *   - cycling: 500 m below 5 km, 1000 m below 20 km, else 5000 m
 *
 * Imperial (increments are nice yard/mile amounts expressed in meters):
 *   - swimming: 25 yd
 *   - running: 100 yd below 1 mile, else 0.25 mi
 *   - cycling: 0.25 mi below 5 mi, 0.5 mi below 20 mi, else 1 mi
 */
export function distanceIncrement(sport: WorkoutSport, meters: number, units: WorkoutUnits): number {
	if (units === "imperial") {
		if (sport === "swimming") return 25 * METERS_PER_YARD;
		if (sport === "running") {
			return meters < METERS_PER_MILE ? 100 * METERS_PER_YARD : 0.25 * METERS_PER_MILE;
		}
		if (meters < 5 * METERS_PER_MILE) return 0.25 * METERS_PER_MILE;
		return meters < 20 * METERS_PER_MILE ? 0.5 * METERS_PER_MILE : METERS_PER_MILE;
	}
	if (sport === "swimming") return 25;
	if (sport === "running") return meters < 5000 ? 100 : 500;
	if (meters < 5000) return 500;
	return meters < 20000 ? 1000 : 5000;
}

/**
 * Round a lap distance (meters) using the sport's increment for `units`.
 * The result is always a whole number of meters so downstream FIT encoding
 * and metric/yard display stay sensible.
 */
export function roundDistance(sport: WorkoutSport, meters: number, units: WorkoutUnits): number {
	return Math.round(roundTo(meters, distanceIncrement(sport, meters, units)));
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

/**
 * Pick the measurement mode for a lap based on its mapped intensity.
 * `rest` and `recovery` laps use `restMode`; every other intensity
 * (active/warmup/cooldown/interval/other) uses `activeMode`.
 */
export function modeForIntensity(
	intensity: StepIntensity,
	activeMode: WorkoutMode,
	restMode: WorkoutMode,
): WorkoutMode {
	return intensity === "rest" || intensity === "recovery" ? restMode : activeMode;
}

/**
 * Convert one lap into a step, or null if the relevant value is null, ≤ 0,
 * or rounds to 0.
 *
 * The per-lap mode is chosen from the lap's intensity: recovery laps use
 * `restMode`, all others use `activeMode`. Generated steps carry no `name`.
 */
export function lapToStep(
	lap: Lap,
	sport: WorkoutSport,
	units: WorkoutUnits,
	activeMode: WorkoutMode,
	restMode: WorkoutMode,
): WorkoutStep | null {
	const intensity = mapLapIntensity(lap.intensity);
	const mode = modeForIntensity(intensity, activeMode, restMode);
	const raw = mode === "distance" ? lap.totalDistance : lap.totalTimerTime;
	if (raw === null || raw === undefined || !(raw > 0)) return null;
	const value = mode === "distance" ? roundDistance(sport, raw, units) : roundDuration(raw);
	if (value <= 0) return null;
	return {
		durationType: mode,
		durationValue: value,
		targetType: "open",
		intensity,
	};
}

/** Structural equality of two steps (names are not part of generated steps). */
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
 * Collapse consecutive repeating blocks (period 1–6, at least 2 repetitions)
 * into RepeatSteps.
 *
 * At each position we pick the period whose repeats cover the most steps
 * (`reps * period`). On ties we prefer the SHORTER period: this is what makes
 * both canonical cases correct —
 *   - 10 identical steps collapse to one RepeatStep of period 1 / count 10
 *     (period 1 covers 10, period 2 also covers 10, shorter wins); and
 *   - four trailing identical steps collapse to period 1 / count 4 rather than
 *     period 2 / count 2.
 * A genuine multi-step cycle (e.g. [1000,800,600] × 3) is still captured because
 * no shorter period matches it at all, so period 3 is the only candidate with
 * reps ≥ 2 there.
 * A single occurrence (reps < 2) is emitted as a plain step.
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
			// Strict `>` with ascending p keeps the shorter period on ties.
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
 *
 * Distance rounding follows `input.units`; active vs. recovery laps are
 * measured with `input.activeMode` / `input.restMode` respectively.
 */
export function activityToWorkout(input: ActivityToWorkoutInput): WorkoutDefinition | null {
	const sport = toWorkoutSport(input.sport);
	if (!sport) return null;
	const steps: WorkoutStep[] = [];
	for (const lap of input.laps) {
		const step = lapToStep(lap, sport, input.units, input.activeMode, input.restMode);
		if (step) steps.push(step);
	}
	return { name: input.name, sport, steps: collapseSteps(steps) };
}
