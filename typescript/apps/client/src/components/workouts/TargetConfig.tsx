/**
 * TargetConfig — Inline target type selector with value range inputs.
 *
 * Displays a target type dropdown (open, speed, heartRate, power, cadence)
 * and low/high value inputs with sport-aware unit labels. For running/swimming
 * speed targets, values are displayed as pace (MM:SS format) and converted to
 * m/s internally.
 */
import { METERS_PER_MILE } from "@activity-calendar/shared";
import type { StepTargetType, WorkoutSport } from "@activity-calendar/shared";
import { useCallback } from "react";
import { CADENCE_UNITS } from "./constants.js";

interface TargetConfigProps {
	/** Currently selected target type. */
	targetType: StepTargetType;
	/** Low end of target range in API units (m/s, bpm, watts, rpm). */
	low?: number;
	/** High end of target range in API units. */
	high?: number;
	/** Current sport — affects available targets and unit display. */
	sport: WorkoutSport;
	/** Callback when target type or range values change. */
	onChange: (targetType: StepTargetType, low?: number, high?: number) => void;
}

/** Available target types per sport. Swimming excludes power. */
function getAvailableTargets(sport: WorkoutSport): StepTargetType[] {
	if (sport === "swimming") return ["open", "speed", "heartRate", "cadence"];
	return ["open", "speed", "heartRate", "power", "cadence"];
}

/** Get the display unit label for the current target/sport combo. */
function getUnitLabel(targetType: StepTargetType, sport: WorkoutSport): string {
	switch (targetType) {
		case "speed":
			if (sport === "running") return "/mi";
			if (sport === "swimming") return "/100m";
			return "mph";
		case "heartRate":
			return "bpm";
		case "power":
			return "W";
		case "cadence":
			return CADENCE_UNITS[sport];
		default:
			return "";
	}
}

/** Whether this target type uses pace input (MM:SS text) instead of number. */
function usesPaceInput(targetType: StepTargetType, sport: WorkoutSport): boolean {
	return targetType === "speed" && (sport === "running" || sport === "swimming");
}

/** Convert m/s to pace string. For running: min/mi. For swimming: min/100m. */
function msToPace(ms: number, sport: WorkoutSport): string {
	if (ms <= 0) return "";
	const divisor = sport === "running" ? METERS_PER_MILE : 100;
	const totalSec = divisor / ms;
	const min = Math.floor(totalSec / 60);
	const sec = Math.round(totalSec % 60);
	return `${min}:${sec.toString().padStart(2, "0")}`;
}

/** Convert pace string (M:SS or MM:SS) to m/s. Returns undefined if invalid. */
function paceToMs(pace: string, sport: WorkoutSport): number | undefined {
	const match = pace.match(/^(\d{1,2}):(\d{2})$/);
	if (!match) return undefined;
	const min = Number(match[1]);
	const sec = Number(match[2]);
	if (sec >= 60) return undefined;
	const totalSec = min * 60 + sec;
	if (totalSec <= 0) return undefined;
	const divisor = sport === "running" ? METERS_PER_MILE : 100;
	return divisor / totalSec;
}

/** Convert m/s to mph for cycling display. */
function msToMph(ms: number): string {
	if (ms <= 0) return "";
	return (ms * 2.23694).toFixed(1);
}

/** Convert mph to m/s. */
function mphToMs(mph: number): number {
	return mph / 2.23694;
}

/**
 * TargetConfig component — renders inline target type + range inputs.
 * Compact layout designed to fit within a StepEditor row.
 */
export function TargetConfig({ targetType, low, high, sport, onChange }: TargetConfigProps) {
	const availableTargets = getAvailableTargets(sport);
	const isPace = usesPaceInput(targetType, sport);
	const unit = getUnitLabel(targetType, sport);

	const handleTypeChange = useCallback(
		(e: React.ChangeEvent<HTMLSelectElement>) => {
			const newType = e.target.value as StepTargetType;
			onChange(newType, undefined, undefined);
		},
		[onChange],
	);

	const handleLowChange = useCallback(
		(value: string) => {
			if (isPace) {
				// For pace: "Fast" pace (low value label) = higher m/s = lower pace number
				// We store: low = slower pace (lower m/s), high = faster pace (higher m/s)
				// UI: "Slow" input → low m/s, "Fast" input → high m/s
				const ms = paceToMs(value, sport);
				onChange(targetType, ms, high);
			} else if (targetType === "speed" && sport === "cycling") {
				const mph = Number.parseFloat(value);
				if (!Number.isNaN(mph) && mph > 0) onChange(targetType, mphToMs(mph), high);
				else onChange(targetType, undefined, high);
			} else {
				const num = Number.parseFloat(value);
				onChange(targetType, Number.isNaN(num) ? undefined : num, high);
			}
		},
		[isPace, sport, targetType, high, onChange],
	);

	const handleHighChange = useCallback(
		(value: string) => {
			if (isPace) {
				const ms = paceToMs(value, sport);
				onChange(targetType, low, ms);
			} else if (targetType === "speed" && sport === "cycling") {
				const mph = Number.parseFloat(value);
				if (!Number.isNaN(mph) && mph > 0) onChange(targetType, low, mphToMs(mph));
				else onChange(targetType, low, undefined);
			} else {
				const num = Number.parseFloat(value);
				onChange(targetType, low, Number.isNaN(num) ? undefined : num);
			}
		},
		[isPace, sport, targetType, low, onChange],
	);

	/** Get display value for the low input. */
	function getLowDisplay(): string {
		if (low == null) return "";
		if (isPace) return msToPace(low, sport);
		if (targetType === "speed" && sport === "cycling") return msToMph(low);
		return String(low);
	}

	/** Get display value for the high input. */
	function getHighDisplay(): string {
		if (high == null) return "";
		if (isPace) return msToPace(high, sport);
		if (targetType === "speed" && sport === "cycling") return msToMph(high);
		return String(high);
	}

	return (
		<div className="flex items-center gap-1.5 flex-wrap">
			<select
				value={targetType}
				onChange={handleTypeChange}
				aria-label="Target type"
				className="w-24 rounded bg-gray-800 border border-gray-700 px-1.5 py-1 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/50"
			>
				{availableTargets.map((t) => (
					<option key={t} value={t}>
						{t === "heartRate" ? "HR" : t === "open" ? "No Target" : t.charAt(0).toUpperCase() + t.slice(1)}
					</option>
				))}
			</select>

			{targetType !== "open" && (
				<>
					<input
						type={isPace ? "text" : "number"}
						value={getLowDisplay()}
						onChange={(e) => handleLowChange(e.target.value)}
						placeholder={isPace ? "M:SS" : "Low"}
						aria-label={isPace ? "Slow pace" : "Target low value"}
						className="w-16 rounded bg-gray-800 border border-gray-700 px-1.5 py-1 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/50"
						{...(isPace ? { pattern: "\\d{1,2}:\\d{2}" } : { step: "1", min: "0" })}
					/>
					<span className="text-gray-600 text-xs">–</span>
					<input
						type={isPace ? "text" : "number"}
						value={getHighDisplay()}
						onChange={(e) => handleHighChange(e.target.value)}
						placeholder={isPace ? "M:SS" : "High"}
						aria-label={isPace ? "Fast pace" : "Target high value"}
						className="w-16 rounded bg-gray-800 border border-gray-700 px-1.5 py-1 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/50"
						{...(isPace ? { pattern: "\\d{1,2}:\\d{2}" } : { step: "1", min: "0" })}
					/>
					<span className="text-xs text-gray-500">{unit}</span>
				</>
			)}
		</div>
	);
}
