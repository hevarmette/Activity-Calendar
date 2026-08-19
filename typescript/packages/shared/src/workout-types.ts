/**
 * Workout FIT file generation types.
 *
 * These interfaces describe the JSON structure sent from the client to the
 * server's POST /api/workouts/generate endpoint. The server encodes them
 * into a binary .fit file using the @garmin/fitsdk Encoder.
 *
 * Duration values:
 *   - time: seconds (e.g. 600 = 10 minutes)
 *   - distance: meters (e.g. 1000 = 1 km)
 *   - open: no value needed (manual lap press)
 *   - repeatUntilStepsCmplt: not set here — handled via RepeatStep
 *
 * Target values (customTargetValueLow / High):
 *   - speed: m/s (e.g. 3.33 = ~5:00/km pace)
 *   - heartRate: bpm (e.g. 140–160)
 *   - power: watts (e.g. 250–280)
 *   - cadence: spm/rpm (e.g. 170–180)
 *   - open: no target constraints
 */

/** Supported sport types for workout encoding. */
export type WorkoutSport = "running" | "cycling" | "swimming";

/** How a step's duration is determined. */
export type StepDurationType = "time" | "distance" | "open";

/** What target metric the step constrains. */
export type StepTargetType = "speed" | "heartRate" | "power" | "cadence" | "open";

/** Step intensity category (maps to FIT intensity enum). */
export type StepIntensity = "active" | "rest" | "warmup" | "cooldown" | "recovery" | "interval" | "other";

/**
 * A single workout step (warmup, interval, rest, cooldown).
 *
 * For repeat groups, use RepeatStep instead.
 */
export interface WorkoutStep {
	/** Display name shown on the watch (e.g. "800m Fast"). */
	name?: string;

	/** How duration is measured. */
	durationType: StepDurationType;

	/**
	 * Duration value in the unit implied by durationType:
	 *   - "time": seconds
	 *   - "distance": meters
	 *   - "open": omit or 0
	 */
	durationValue?: number;

	/** What metric to target during this step. */
	targetType: StepTargetType;

	/**
	 * Low end of the custom target range.
	 *   - speed: m/s
	 *   - heartRate: bpm
	 *   - power: watts
	 *   - cadence: spm or rpm
	 */
	customTargetValueLow?: number;

	/**
	 * High end of the custom target range.
	 * Same units as customTargetValueLow.
	 */
	customTargetValueHigh?: number;

	/** Intensity category for this step. */
	intensity: StepIntensity;
}

/**
 * A repeat block that loops a sequence of steps N times.
 *
 * In the FIT file this becomes one WORKOUT_STEP with:
 *   durationType = "repeatUntilStepsCmplt"
 *   durationValue = messageIndex of the first step to repeat back to
 *   targetValue = number of repetitions
 */
export interface RepeatStep {
	/** The steps to repeat (warmup/interval/rest inside the group). */
	steps: WorkoutStep[];

	/** Number of repetitions. */
	repeatCount: number;
}

/** A step in the workout definition — either a single step or a repeat group. */
export type WorkoutStepOrRepeat = WorkoutStep | RepeatStep;

/** Type guard to distinguish repeat groups from single steps. */
export function isRepeatStep(step: WorkoutStepOrRepeat): step is RepeatStep {
	return "repeatCount" in step && "steps" in step;
}

/**
 * Complete workout definition sent from the client.
 *
 * The server validates this, flattens repeat groups into indexed steps,
 * and encodes it as a FIT workout file.
 */
export interface WorkoutDefinition {
	/** Workout name shown on the device (max ~15 chars recommended). */
	name: string;

	/** Sport type. */
	sport: WorkoutSport;

	/** Optional description. */
	description?: string;

	/**
	 * Ordered list of steps and repeat groups.
	 * A typical structure: [warmup, repeat({ interval, rest }), cooldown]
	 */
	steps: WorkoutStepOrRepeat[];
}
