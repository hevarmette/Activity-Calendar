import { Sport } from "./enums.js";

export const METERS_PER_MILE = 1609.344;
export const METERS_TO_FEET = 3.28084;
export const MPS_TO_MPH = 2.23694;

export const SPORT_COLORS: Record<string, string> = {
	[Sport.Running]: "#FF4B4B",
	[Sport.Cycling]: "#2CA02C",
	[Sport.Swimming]: "#1F77B4",
	[Sport.Multisport]: "#FF8C00",
};

/**
 * From the original Streamlit utils.py (init_session_state):
 * Feel values map to SVG asset filenames for display in the UI.
 * The integers are the raw database values stored in workout_feel.
 */
export const FEEL_MAP: Record<number, string> = {
	0: "very-weak",
	25: "weak",
	50: "normal",
	75: "strong",
	100: "very-strong",
};

export const EFFORT_LABELS: Record<number, string> = {
	1: "very light",
	2: "light",
	3: "moderate",
	4: "somewhat hard",
	5: "hard",
	6: "hard",
	7: "very hard",
	8: "very hard",
	9: "extremely hard",
	10: "maximum",
};

/**
 * Default auto-lap distances per sport (in miles).
 * From the original Streamlit utils.py (init_session_state):
 * cycling = 5 miles, running = 1 mile, default = 1 mile.
 * These are used for both the map mile markers and the auto-lap table.
 */
export const AUTO_LAP_DISTANCES: Record<string, number> = {
	[Sport.Running]: 1,
	[Sport.Cycling]: 5,
	default: 1,
};

/**
 * Standard track distances in miles paired with labels.
 * From the original Streamlit lap_processing.py:
 * Used for labeling interval sets — maps mean lap distance to the nearest
 * standard track distance using a scaling tolerance (10% at 100m, shrinking
 * proportionally with distance). Falls back to "X.XX mi" if no match.
 */
export const TRACK_DISTANCES: [number, string][] = [
	[0.0621, "100m"], [0.1243, "200m"], [0.1864, "300m"],
	[0.2485, "400m"], [0.3107, "500m"], [0.3728, "600m"],
	[0.4971, "800m"], [0.6214, "1000m"], [0.7456, "1200m"],
	[1.0, "1 mi"], [1.2427, "2000m"], [1.8641, "3000m"],
];
