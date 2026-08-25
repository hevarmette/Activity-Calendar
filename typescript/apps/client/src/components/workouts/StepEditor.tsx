/**
 * StepEditor — A single compact row for editing one WorkoutStep.
 *
 * Displays intensity-colored left border, drag handle, duration config,
 * target config, and action buttons (delete, duplicate). Used both for
 * top-level steps and steps within repeat groups.
 *
 * Features:
 * - Drag handle for HTML5 drag-and-drop reordering
 * - Sport-aware labels (Run/Bike/Swim for active/interval)
 * - 'Lap Button' display for open duration type
 * - Per-step distance unit selector (mi/km/m) shown inline when durationType='distance'
 * - Always-visible delete button
 */
import type { StepDurationType, StepIntensity, WorkoutSport, WorkoutStep } from "@activity-calendar/shared";
import { useCallback, useEffect, useState } from "react";
import { TargetConfig } from "./TargetConfig.js";
import {
	DISTANCE_UNIT_OPTIONS,
	DURATION_TYPE_LABELS,
	type DistanceUnit,
	INTENSITY_BORDER_CLASSES,
	METERS_PER_DISTANCE_UNIT,
	getIntensityLabel,
} from "./constants.js";

interface StepEditorProps {
	/** The workout step data to edit. */
	step: WorkoutStep;
	/** 1-based display index. */
	index: number;
	/** Current sport — affects unit display and available targets. */
	sport: WorkoutSport;
	/** Per-step distance unit (mi, km, m). */
	distanceUnit: DistanceUnit;
	/** Called when the user changes the distance unit for this step. */
	onDistanceUnitChange: (unit: DistanceUnit) => void;
	/** Called when any field of the step changes. */
	onChange: (updated: WorkoutStep) => void;
	/** Called when the step should be removed. */
	onRemove: () => void;
	/** Move step up in the list. Undefined if already first. */
	onMoveUp?: () => void;
	/** Move step down in the list. Undefined if already last. */
	onMoveDown?: () => void;
	/** Duplicate this step. */
	onDuplicate: () => void;
	/** Whether this step is currently being dragged over. */
	isDragOver?: boolean;
	/** HTML5 drag event handlers for reordering. */
	onDragStart?: (e: React.DragEvent) => void;
	/** Drag over handler. */
	onDragOver?: (e: React.DragEvent) => void;
	/** Drop handler. */
	onDrop?: (e: React.DragEvent) => void;
	/** Drag end handler. */
	onDragEnd?: (e: React.DragEvent) => void;
}

/** All available intensity options in the dropdown. */
const INTENSITY_OPTIONS: StepIntensity[] = ["warmup", "active", "rest", "recovery", "cooldown", "other"];

/** All available duration type options. */
const DURATION_TYPE_OPTIONS: StepDurationType[] = ["time", "distance", "open"];

/**
 * Convert the user-facing duration value to API meters or seconds.
 * Time: user enters mm:ss or plain minutes → seconds.
 * Distance: user enters value in selected unit → meters.
 */
function displayToApiDuration(value: number, durationType: StepDurationType, distanceUnit: DistanceUnit): number {
	if (durationType === "time") return value * 60; // minutes → seconds
	if (durationType === "distance") {
		return value * METERS_PER_DISTANCE_UNIT[distanceUnit];
	}
	return 0;
}

/**
 * Parse a time duration string in mm:ss or plain minutes to total seconds.
 * If the string contains ':', splits as mm:ss. Otherwise treats as minutes.
 * Returns NaN if unparseable.
 */
function parseTimeDuration(input: string): number {
	const trimmed = input.trim();
	if (trimmed === "") return Number.NaN;
	if (trimmed.includes(":")) {
		const parts = trimmed.split(":");
		const minutes = Number.parseInt(parts[0] ?? "0", 10);
		const seconds = Number.parseInt(parts[1] ?? "0", 10);
		if (Number.isNaN(minutes) || Number.isNaN(seconds) || minutes < 0 || seconds < 0) return Number.NaN;
		return minutes * 60 + seconds;
	}
	// Backward compatible: plain number = minutes
	const mins = Number.parseFloat(trimmed);
	if (Number.isNaN(mins) || mins < 0) return Number.NaN;
	return mins * 60;
}

/**
 * Convert API duration value (seconds or meters) to user-facing display value.
 * Seconds → m:ss format, meters → display value in the per-step distance unit.
 */
function apiToDisplayDuration(
	value: number | undefined,
	durationType: StepDurationType,
	distanceUnit: DistanceUnit,
): string {
	if (value == null || value === 0) return "";
	if (durationType === "time") {
		const totalSeconds = Math.round(value);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${seconds.toString().padStart(2, "0")}`;
	}
	if (durationType === "distance") {
		const metersPerUnit = METERS_PER_DISTANCE_UNIT[distanceUnit];
		const displayVal = value / metersPerUnit;
		// For meters, show integers; for mi/km show up to 2 decimals
		if (distanceUnit === "m") return String(Math.round(displayVal));
		return displayVal % 1 === 0 ? String(displayVal) : displayVal.toFixed(2);
	}
	return "";
}

/**
 * StepEditor component — renders a single step as a compact editable row.
 * Left-border is color-coded by intensity. Drag handle and delete always visible.
 */
export function StepEditor({
	step,
	index,
	sport,
	distanceUnit,
	onDistanceUnitChange,
	onChange,
	onRemove,
	onMoveUp,
	onMoveDown,
	onDuplicate,
	isDragOver,
	onDragStart,
	onDragOver,
	onDrop,
	onDragEnd,
}: StepEditorProps) {
	const borderClass = INTENSITY_BORDER_CLASSES[step.intensity] ?? "border-l-gray-500";

	// Local editing state for the time input — allows typing intermediate values like "2:"
	const [timeText, setTimeText] = useState(() => apiToDisplayDuration(step.durationValue, "time", distanceUnit));
	const [isEditingTime, setIsEditingTime] = useState(false);

	// Sync external changes to local state when not actively editing
	useEffect(() => {
		if (!isEditingTime) {
			setTimeText(apiToDisplayDuration(step.durationValue, "time", distanceUnit));
		}
	}, [step.durationValue, distanceUnit, isEditingTime]);

	const handleIntensityChange = useCallback(
		(e: React.ChangeEvent<HTMLSelectElement>) => {
			onChange({ ...step, intensity: e.target.value as StepIntensity });
		},
		[step, onChange],
	);

	const handleDurationTypeChange = useCallback(
		(e: React.ChangeEvent<HTMLSelectElement>) => {
			const newType = e.target.value as StepDurationType;
			onChange({ ...step, durationType: newType, durationValue: newType === "open" ? undefined : step.durationValue });
		},
		[step, onChange],
	);

	const handleDurationValueChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const rawText = e.target.value;
			if (step.durationType === "time") {
				// Update local text state freely for typing
				setTimeText(rawText);
				// Only propagate to parent when parseable
				const seconds = parseTimeDuration(rawText);
				if (!Number.isNaN(seconds)) {
					onChange({ ...step, durationValue: seconds });
				} else if (rawText === "") {
					onChange({ ...step, durationValue: undefined });
				}
				return;
			}
			const raw = Number.parseFloat(rawText);
			if (Number.isNaN(raw) || raw < 0) {
				onChange({ ...step, durationValue: undefined });
			} else {
				onChange({ ...step, durationValue: displayToApiDuration(raw, step.durationType, distanceUnit) });
			}
		},
		[step, distanceUnit, onChange],
	);

	const handleTimeBlur = useCallback(() => {
		setIsEditingTime(false);
		// Re-format on blur to normalize display (e.g., "2:" → "2:00")
		setTimeText(apiToDisplayDuration(step.durationValue, "time", distanceUnit));
	}, [step.durationValue, distanceUnit]);

	const handleTimeFocus = useCallback(() => {
		setIsEditingTime(true);
	}, []);

	const handleNameChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			onChange({ ...step, name: e.target.value || undefined });
		},
		[step, onChange],
	);

	const handleTargetChange = useCallback(
		(targetType: WorkoutStep["targetType"], low?: number, high?: number) => {
			onChange({ ...step, targetType, customTargetValueLow: low, customTargetValueHigh: high });
		},
		[step, onChange],
	);

	/** Get the duration unit label for display. */
	function getDurationUnit(): string {
		if (step.durationType === "time") return ""; // mm:ss format is self-evident
		if (step.durationType === "distance") return distanceUnit;
		return "";
	}

	return (
		<div
			className={`group flex items-center gap-2 py-2 pl-3 pr-2 border-l-3 ${borderClass} hover:bg-gray-900/50 transition-colors ${isDragOver ? "bg-gray-800/70 border-t border-t-orange-500/50" : ""}`}
			draggable
			onDragStart={onDragStart}
			onDragOver={onDragOver}
			onDrop={onDrop}
			onDragEnd={onDragEnd}
		>
			{/* Drag handle */}
			<span
				className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-300 shrink-0 select-none"
				aria-label="Drag to reorder"
				title="Drag to reorder"
			>
				⠿
			</span>

			{/* Index */}
			<span className="text-xs text-gray-500 w-5 text-center shrink-0">{index}</span>

			{/* Intensity */}
			<select
				value={step.intensity}
				onChange={handleIntensityChange}
				aria-label="Step intensity"
				className="w-24 rounded bg-gray-800 border border-gray-700 px-1.5 py-1 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
			>
				{INTENSITY_OPTIONS.map((i) => (
					<option key={i} value={i}>
						{getIntensityLabel(i, sport)}
					</option>
				))}
			</select>

			{/* Duration type + value */}
			<div className="flex items-center gap-1">
				<select
					value={step.durationType}
					onChange={handleDurationTypeChange}
					aria-label="Duration type"
					className="w-24 rounded bg-gray-800 border border-gray-700 px-1.5 py-1 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
				>
					{DURATION_TYPE_OPTIONS.map((d) => (
						<option key={d} value={d}>
							{DURATION_TYPE_LABELS[d]}
						</option>
					))}
				</select>
				{step.durationType !== "open" && (
					<>
						<input
							type={step.durationType === "time" ? "text" : "number"}
							value={
								step.durationType === "time"
									? timeText
									: apiToDisplayDuration(step.durationValue, step.durationType, distanceUnit)
							}
							onChange={handleDurationValueChange}
							onBlur={step.durationType === "time" ? handleTimeBlur : undefined}
							onFocus={step.durationType === "time" ? handleTimeFocus : undefined}
							placeholder={step.durationType === "time" ? "0:00" : "0"}
							step={step.durationType === "distance" ? "any" : undefined}
							min={step.durationType === "distance" ? "0" : undefined}
							inputMode={step.durationType === "time" ? "text" : "decimal"}
							aria-label={step.durationType === "time" ? "Duration value (mm:ss)" : "Duration value"}
							className="w-16 rounded bg-gray-800 border border-gray-700 px-1.5 py-1 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
						/>
						{step.durationType === "distance" ? (
							<fieldset className="flex rounded overflow-hidden border border-gray-700" aria-label="Distance unit">
								{DISTANCE_UNIT_OPTIONS.map((u) => (
									<button
										key={u}
										type="button"
										onClick={() => onDistanceUnitChange(u)}
										aria-pressed={distanceUnit === u}
										className={`px-1.5 py-1 text-xs font-medium transition-colors ${
											distanceUnit === u ? "bg-orange-600 text-white" : "bg-gray-800 text-gray-500 hover:text-gray-200"
										} ${u !== "mi" ? "border-l border-gray-700" : ""}`}
									>
										{u}
									</button>
								))}
							</fieldset>
						) : (
							<span className="text-xs text-gray-500">{getDurationUnit()}</span>
						)}
					</>
				)}
			</div>

			{/* Step name (optional, hidden on small screens) */}
			<input
				type="text"
				value={step.name ?? ""}
				onChange={handleNameChange}
				placeholder="Name…"
				aria-label="Step name"
				className="hidden sm:block w-24 rounded bg-gray-800 border border-gray-700 px-1.5 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
			/>

			{/* Target config */}
			<TargetConfig
				targetType={step.targetType}
				low={step.customTargetValueLow}
				high={step.customTargetValueHigh}
				sport={sport}
				onChange={handleTargetChange}
			/>

			{/* Actions — always visible */}
			<div className="flex items-center gap-1 ml-auto shrink-0">
				<button
					type="button"
					onClick={onDuplicate}
					aria-label="Duplicate step"
					className="p-1 text-gray-500 hover:text-gray-200 transition-colors"
					title="Duplicate"
				>
					<svg
						aria-hidden="true"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
						<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
					</svg>
				</button>
				<button
					type="button"
					onClick={onRemove}
					aria-label="Remove step"
					className="p-1 text-gray-500 hover:text-red-400 transition-colors"
					title="Delete"
				>
					<svg
						aria-hidden="true"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
			</div>
		</div>
	);
}
