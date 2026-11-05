/**
 * Constants for the Workout Builder UI.
 *
 * Defines intensity-to-color mappings, sport-specific defaults, and display
 * label helpers used by StepEditor, StepList, and WorkoutPreview components.
 */
import type { StepDurationType, StepIntensity, WorkoutSport } from "@activity-calendar/shared";

/** Hex color values for each step intensity (used in WorkoutPreview). */
export const INTENSITY_COLORS: Record<StepIntensity, string> = {
	warmup: "#eab308",
	interval: "#ef4444",
	active: "#dc2626",
	rest: "#3b82f6",
	recovery: "#60a5fa",
	cooldown: "#22c55e",
	other: "#6b7280",
};

/** Tailwind border-l classes for step intensity color coding. */
export const INTENSITY_BORDER_CLASSES: Record<StepIntensity, string> = {
	warmup: "border-l-yellow-500",
	interval: "border-l-red-500",
	active: "border-l-red-600",
	rest: "border-l-blue-500",
	recovery: "border-l-blue-400",
	cooldown: "border-l-green-500",
	other: "border-l-gray-500",
};

/** Tailwind background classes for step intensity (faint tint). */
export const INTENSITY_BG_CLASSES: Record<StepIntensity, string> = {
	warmup: "bg-yellow-500",
	interval: "bg-red-500",
	active: "bg-red-600",
	rest: "bg-blue-500",
	recovery: "bg-blue-400",
	cooldown: "bg-green-500",
	other: "bg-gray-500",
};

/** Static labels for non-sport-dependent intensities. */
const STATIC_INTENSITY_LABELS: Record<string, string> = {
	warmup: "Warmup",
	rest: "Rest",
	recovery: "Recovery",
	cooldown: "Cooldown",
	other: "Other",
};

/** Sport-specific verb used for 'active' and 'interval' intensity display. */
const SPORT_VERBS: Record<WorkoutSport, string> = {
	running: "Run",
	cycling: "Bike",
	swimming: "Swim",
};

/**
 * Get the display label for an intensity value, using the sport verb
 * for 'active' and 'interval' intensities.
 */
export function getIntensityLabel(intensity: StepIntensity, sport: WorkoutSport): string {
	if (intensity === "active" || intensity === "interval") {
		return SPORT_VERBS[sport];
	}
	return STATIC_INTENSITY_LABELS[intensity] ?? intensity.charAt(0).toUpperCase() + intensity.slice(1);
}

/**
 * Backwards-compatible static INTENSITY_LABELS (uses 'Interval'/'Active' as fallback).
 * Prefer getIntensityLabel() when sport is available.
 */
export const INTENSITY_LABELS: Record<StepIntensity, string> = {
	warmup: "Warmup",
	interval: "Interval",
	active: "Active",
	rest: "Rest",
	recovery: "Recovery",
	cooldown: "Cooldown",
	other: "Other",
};

/** Display labels for duration types. 'open' → 'Lap Button'. */
export const DURATION_TYPE_LABELS: Record<StepDurationType, string> = {
	time: "Time",
	distance: "Distance",
	open: "Lap Button",
};

/** Distance unit labels per sport (imperial default). */
export const DISTANCE_UNITS: Record<WorkoutSport, string> = {
	running: "mi",
	cycling: "mi",
	swimming: "m",
};

/** Cadence unit labels per sport. */
export const CADENCE_UNITS: Record<WorkoutSport, string> = {
	running: "spm",
	cycling: "rpm",
	swimming: "str/min",
};

/**
 * Default pace per sport for estimating visual duration from distance.
 * Values in seconds per meter.
 */
export const DEFAULT_PACE_S_PER_M: Record<WorkoutSport, number> = {
	running: (8 * 60) / 1609.344, // 8:00/mi
	cycling: 1 / (16 * 0.44704), // 16 mph
	swimming: (2 * 60) / 100, // 2:00/100m
};

/** Get the sport verb (Run/Bike/Swim) for a given sport. */
export function getSportVerb(sport: WorkoutSport): string {
	return SPORT_VERBS[sport];
}

/** Unit systems supported for distance display (legacy — prefer per-step DistanceUnit). */
export type UnitSystem = "imperial" | "metric";

/** Get the distance unit label based on sport and unit system (legacy). */
export function getDistanceUnit(sport: WorkoutSport, unitSystem: UnitSystem): string {
	if (sport === "swimming") return "m"; // Swimming always uses meters
	return unitSystem === "imperial" ? "mi" : "km";
}

/** Meters per unit for distance conversion (legacy). */
export function getMetersPerUnit(sport: WorkoutSport, unitSystem: UnitSystem): number {
	if (sport === "swimming") return 1; // meters
	return unitSystem === "imperial" ? 1609.344 : 1000;
}

// ─── Per-step distance unit (replaces page-level UnitSystem toggle) ───────────

/** Distance unit choices available per-step. */
export type DistanceUnit = "mi" | "km" | "m";

/** Conversion factor: how many meters per one display unit. */
export const METERS_PER_DISTANCE_UNIT: Record<DistanceUnit, number> = {
	mi: 1609.344,
	km: 1000,
	m: 1,
};

/** All distance unit options for the per-step selector. */
export const DISTANCE_UNIT_OPTIONS: DistanceUnit[] = ["mi", "km", "m"];

// ─── Drag-and-drop location model ────────────────────────────────────────────

/**
 * A location within the step tree, used by the MOVE_ITEM reducer action and the
 * @dnd-kit sortable wiring.
 *
 * - `root`  → a top-level item at `index` in state.steps
 * - `group` → an inner WorkoutStep at `index` inside the repeat group located at
 *   top-level index `group`
 */
export type Loc = { kind: "root"; index: number } | { kind: "group"; group: number; index: number };

/** Build the transient sortable id for a top-level item at index `i`. */
export function topId(i: number): string {
	return `top:${i}`;
}

/** Build the transient sortable id for inner step `j` of the group at top-level index `i`. */
export function innerId(i: number, j: number): string {
	return `inner:${i}:${j}`;
}

/** Build the droppable container id for the repeat group at top-level index `i`. */
export function groupId(i: number): string {
	return `group:${i}`;
}

/** The droppable container id for the top-level (root) list. */
export const ROOT_ID = "root";

/**
 * Parse a transient sortable/droppable id back into a {@link Loc} (or a container
 * marker). Returns `null` if the id is unrecognized.
 *
 * - `top:i`        → { kind: 'root', index: i }
 * - `inner:i:j`    → { kind: 'group', group: i, index: j }
 * - `group:i`      → container for the repeat group at root index i (kind 'group', index at end)
 * - `root`         → the root container
 */
export function parseDndId(id: string): { loc?: Loc; container: "root" | number } | null {
	if (id === ROOT_ID) return { container: "root" };
	const [prefix, a, b] = id.split(":");
	if (prefix === "top" && a !== undefined) {
		const index = Number.parseInt(a, 10);
		if (Number.isNaN(index)) return null;
		return { loc: { kind: "root", index }, container: "root" };
	}
	if (prefix === "inner" && a !== undefined && b !== undefined) {
		const group = Number.parseInt(a, 10);
		const index = Number.parseInt(b, 10);
		if (Number.isNaN(group) || Number.isNaN(index)) return null;
		return { loc: { kind: "group", group, index }, container: group };
	}
	if (prefix === "group" && a !== undefined) {
		const group = Number.parseInt(a, 10);
		if (Number.isNaN(group)) return null;
		// Dropping onto the group container itself (append to end handled by caller)
		return { container: group };
	}
	return null;
}
