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

export const AUTO_LAP_DISTANCES: Record<string, number> = {
	[Sport.Running]: 1,
	[Sport.Cycling]: 5,
	default: 1,
};
