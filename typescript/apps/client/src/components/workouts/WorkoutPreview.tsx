/**
 * WorkoutPreview — Visual horizontal bar showing workout structure.
 *
 * Displays each step as a proportional-width segment color-coded by intensity.
 * Repeat groups expand their inner steps visually with a ×N badge.
 * Shows estimated total time and distance below the bar.
 * Uses sport-aware intensity labels (Run/Bike/Swim instead of Interval/Active).
 */
import { METERS_PER_MILE } from "@activity-calendar/shared";
import type { StepIntensity, WorkoutSport, WorkoutStep, WorkoutStepOrRepeat } from "@activity-calendar/shared";
import { isRepeatStep } from "@activity-calendar/shared";
import { useMemo } from "react";
import { DEFAULT_PACE_S_PER_M, INTENSITY_BG_CLASSES, getIntensityLabel } from "./constants.js";

interface WorkoutPreviewProps {
	/** The ordered list of steps and repeat groups. */
	steps: WorkoutStepOrRepeat[];
	/** Current sport for time estimation from distance and label display. */
	sport: WorkoutSport;
}

/** A flattened segment for preview rendering. */
interface PreviewSegment {
	name?: string;
	intensity: StepIntensity;
	estimatedSeconds: number;
	repeatBadge?: number;
}

/** Estimate duration in seconds for a single step. */
function estimateStepSeconds(step: WorkoutStep, sport: WorkoutSport): number {
	if (step.durationType === "time") {
		return step.durationValue ?? 60;
	}
	if (step.durationType === "distance") {
		const meters = step.durationValue ?? 0;
		return meters * DEFAULT_PACE_S_PER_M[sport];
	}
	// Open duration — default visual width
	return 60;
}

/** Flatten steps into preview segments, expanding repeat groups. */
function buildSegments(steps: WorkoutStepOrRepeat[], sport: WorkoutSport): PreviewSegment[] {
	const segments: PreviewSegment[] = [];

	for (const item of steps) {
		if (isRepeatStep(item)) {
			for (const inner of item.steps) {
				segments.push({
					name: inner.name,
					intensity: inner.intensity,
					estimatedSeconds: estimateStepSeconds(inner, sport) * item.repeatCount,
					repeatBadge: item.repeatCount,
				});
			}
		} else {
			segments.push({
				name: item.name,
				intensity: item.intensity,
				estimatedSeconds: estimateStepSeconds(item, sport),
			});
		}
	}

	return segments;
}

/** Compute totals from the step list. */
function computeTotals(
	steps: WorkoutStepOrRepeat[],
	sport: WorkoutSport,
): { totalSeconds: number; totalMeters: number } {
	let totalSeconds = 0;
	let totalMeters = 0;

	function processStep(step: WorkoutStep, multiplier: number) {
		if (step.durationType === "time" && step.durationValue) {
			totalSeconds += step.durationValue * multiplier;
		} else if (step.durationType === "distance" && step.durationValue) {
			totalMeters += step.durationValue * multiplier;
			totalSeconds += step.durationValue * DEFAULT_PACE_S_PER_M[sport] * multiplier;
		} else {
			// Open — add a small default for time estimate
			totalSeconds += 60 * multiplier;
		}
	}

	for (const item of steps) {
		if (isRepeatStep(item)) {
			for (const inner of item.steps) {
				processStep(inner, item.repeatCount);
			}
		} else {
			processStep(item, 1);
		}
	}

	return { totalSeconds, totalMeters };
}

/** Format seconds as H:MM or MM:SS. */
function formatDuration(seconds: number): string {
	if (seconds >= 3600) {
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		return `${h}h ${m}min`;
	}
	const m = Math.floor(seconds / 60);
	const s = Math.round(seconds % 60);
	if (s === 0) return `${m}min`;
	return `${m}min ${s}s`;
}

/** Format distance in sport-appropriate units. */
function formatDistance(meters: number, sport: WorkoutSport): string {
	if (meters === 0) return "";
	if (sport === "swimming") return `${Math.round(meters)}m`;
	const mi = meters / METERS_PER_MILE;
	return `${mi.toFixed(2)} mi`;
}

/**
 * WorkoutPreview component — visual bar timeline for workout structure.
 * Compact, color-coded representation of the workout with sport-aware labels.
 */
export function WorkoutPreview({ steps, sport }: WorkoutPreviewProps) {
	const segments = useMemo(() => buildSegments(steps, sport), [steps, sport]);
	const totals = useMemo(() => computeTotals(steps, sport), [steps, sport]);
	const totalEstimatedSeconds = useMemo(() => segments.reduce((sum, s) => sum + s.estimatedSeconds, 0), [segments]);

	if (segments.length === 0) {
		return (
			<div className="rounded-lg border border-gray-800 p-6 text-center text-sm text-gray-500">
				Add steps to see workout preview
			</div>
		);
	}

	return (
		<div>
			{/* Bar visualization */}
			<div
				className="h-16 w-full flex rounded-lg overflow-hidden border border-gray-800"
				role="img"
				aria-label="Workout structure preview"
			>
				{segments.map((seg, idx) => {
					const widthPercent = totalEstimatedSeconds > 0 ? (seg.estimatedSeconds / totalEstimatedSeconds) * 100 : 0;
					const bgClass = INTENSITY_BG_CLASSES[seg.intensity] ?? "bg-gray-500";
					const label = getIntensityLabel(seg.intensity, sport);

					return (
						<div
							key={`seg-${idx}`}
							className={`${bgClass} relative flex items-center justify-center min-w-[2px] transition-all`}
							style={{ width: `${Math.max(widthPercent, 1)}%` }}
							title={`${label}${seg.name ? `: ${seg.name}` : ""} — ~${formatDuration(seg.estimatedSeconds)}`}
						>
							{/* Step name (if space allows) */}
							{widthPercent > 8 && (
								<span className="text-[10px] text-white/80 truncate px-0.5 text-center">{seg.name ?? label}</span>
							)}
							{/* Repeat badge */}
							{seg.repeatBadge && widthPercent > 5 && (
								<span className="absolute top-0.5 right-0.5 text-[9px] bg-black/40 text-white/90 rounded px-0.5">
									×{seg.repeatBadge}
								</span>
							)}
						</div>
					);
				})}
			</div>

			{/* Totals */}
			<div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
				<span>~{formatDuration(totals.totalSeconds)}</span>
				{totals.totalMeters > 0 && <span>{formatDistance(totals.totalMeters, sport)}</span>}
				<span className="text-gray-600 text-xs">(estimated)</span>
			</div>
		</div>
	);
}
