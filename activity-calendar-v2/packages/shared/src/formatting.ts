import { METERS_PER_MILE } from "./constants.js";
import { Sport } from "./enums.js";

/** Convert seconds to H:MM:SS.ss or M:SS.ss string */
export function convertSecondsToHms(seconds: number | null | undefined): string | null {
	if (seconds == null || Number.isNaN(seconds)) return null;
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
	return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

/** Parse H:MM:SS, M:SS, or S string to total seconds */
export function parseHmsToSeconds(timeStr: string): number | null {
	if (!timeStr || typeof timeStr !== "string") return null;
	const parts = timeStr.trim().split(":").map(Number);
	if (parts.some(Number.isNaN)) return null;
	if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
	if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
	if (parts.length === 1) return parts[0]!;
	return null;
}

/** Format pace as M:SS (e.g. 7:30) from min/mile float */
export function formatPace(minPerMile: number | null | undefined): string | null {
	if (minPerMile == null || Number.isNaN(minPerMile)) return null;
	const totalSeconds = Math.round(minPerMile * 60);
	const m = Math.floor(totalSeconds / 60);
	const s = totalSeconds % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}

/** Format pace with hundredths: M:SS.ss */
export function formatPacePrecise(minPerMile: number | null | undefined): string | null {
	if (minPerMile == null || Number.isNaN(minPerMile)) return null;
	const totalSeconds = minPerMile * 60;
	const m = Math.floor(totalSeconds / 60);
	const s = totalSeconds % 60;
	return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

/** Format pace or speed string depending on sport */
export function formatPaceSpeed(sport: string, distanceM: number, timeS: number): string {
	if (distanceM <= 0 || timeS <= 0) return "—";
	const miles = distanceM / METERS_PER_MILE;
	if (sport === Sport.Cycling) {
		return `${(miles / (timeS / 3600)).toFixed(1)} mph`;
	}
	if (sport === Sport.Swimming) {
		const secsPerHundred = timeS / (distanceM / 100);
		const m = Math.floor(secsPerHundred / 60);
		const s = Math.round(secsPerHundred % 60);
		return `${m}:${String(s).padStart(2, "0")} /100m`;
	}
	const pace = timeS / 60 / miles;
	return `${formatPace(pace)} /mi`;
}
