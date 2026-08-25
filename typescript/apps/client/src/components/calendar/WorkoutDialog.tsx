/**
 * WorkoutDialog — Modal shown when clicking a scheduled workout on the calendar.
 *
 * Fetches full workout details and displays a read-only summary of steps.
 * Provides actions: Download .fit, Edit Workout, Remove from Calendar.
 */
import { METERS_PER_MILE, isRepeatStep } from "@activity-calendar/shared";
import type { WorkoutSport, WorkoutStep, WorkoutStepOrRepeat } from "@activity-calendar/shared";
import { useState } from "react";
import { Link } from "react-router";
import { downloadScheduledWorkoutFit } from "../../api/client.js";
import { useScheduleWorkout, useWorkout } from "../../api/workout-queries.js";
import { Dialog } from "../ui/Dialog.js";
import { INTENSITY_COLORS, getIntensityLabel } from "../workouts/constants.js";

interface Props {
	workoutId: number;
	scheduledDate: string;
	open: boolean;
	onClose: () => void;
}

/** Format a step's duration into a readable string. */
function formatDuration(step: WorkoutStep): string {
	if (step.durationType === "open") return "Lap Button";
	if (step.durationType === "time" && step.durationValue) {
		const sec = step.durationValue;
		if (sec >= 60) {
			const min = Math.floor(sec / 60);
			const s = Math.round(sec % 60);
			return s > 0 ? `${min}:${String(s).padStart(2, "0")} min` : `${min} min`;
		}
		return `${Math.round(sec)}s`;
	}
	if (step.durationType === "distance" && step.durationValue) {
		const m = step.durationValue;
		if (m >= 1609.344) {
			const mi = m / METERS_PER_MILE;
			return `${Number(mi.toFixed(2))} mi`;
		}
		if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
		return `${Math.round(m)} m`;
	}
	return "—";
}

/** Render a single step row in the summary list. */
function StepRow({ step, sport }: { step: WorkoutStep; sport: WorkoutSport }) {
	const label = getIntensityLabel(step.intensity, sport);
	const color = INTENSITY_COLORS[step.intensity] ?? "#6b7280";
	const duration = formatDuration(step);
	const name = step.name || label;

	return (
		<div className="flex items-center gap-2 py-1.5">
			<div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: color }} />
			<span className="text-sm text-gray-200 font-medium">{name}</span>
			<span className="text-xs text-gray-500 ml-auto">{duration}</span>
		</div>
	);
}

export function WorkoutDialog({ workoutId, scheduledDate, open, onClose }: Props) {
	const { data: workout, isLoading } = useWorkout(workoutId);
	const scheduleWorkout = useScheduleWorkout();
	const [downloading, setDownloading] = useState(false);
	const [removing, setRemoving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const sport = (workout?.sport ?? "running") as WorkoutSport;
	const formattedDate = new Date(`${scheduledDate}T00:00:00`).toLocaleDateString(undefined, {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	async function handleDownload() {
		setError(null);
		setDownloading(true);
		try {
			await downloadScheduledWorkoutFit(workoutId, scheduledDate);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Download failed");
		} finally {
			setDownloading(false);
		}
	}

	async function handleRemove() {
		setError(null);
		setRemoving(true);
		try {
			await scheduleWorkout.mutateAsync({ workoutId, scheduledDate: null });
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to remove");
		} finally {
			setRemoving(false);
		}
	}

	/** Render the step list recursively (handles repeat groups). */
	function renderSteps(steps: WorkoutStepOrRepeat[]) {
		return steps.map((step, idx) => {
			if (isRepeatStep(step)) {
				return (
					<div key={idx} className="ml-2 border-l border-gray-700 pl-3 my-1">
						<p className="text-xs font-medium text-gray-400 mb-1">Repeat ×{step.repeatCount}</p>
						{step.steps.map((inner, iIdx) => (
							<StepRow key={iIdx} step={inner} sport={sport} />
						))}
					</div>
				);
			}
			return <StepRow key={idx} step={step} sport={sport} />;
		});
	}

	return (
		<Dialog open={open} onClose={onClose} title={workout?.name ?? "Scheduled Workout"} subtitle={formattedDate}>
			{isLoading ? (
				<div className="flex items-center justify-center py-10">
					<div className="text-gray-400 text-sm animate-pulse">Loading workout…</div>
				</div>
			) : workout ? (
				<>
					{/* Sport + scheduled info */}
					<div className="flex items-center gap-2 mb-4">
						<span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase border border-violet-500/30 bg-violet-500/15 text-violet-400">
							{workout.sport}
						</span>
						<span className="text-xs text-gray-500">Scheduled</span>
					</div>

					{/* Description */}
					{workout.description && <p className="text-sm text-gray-400 italic mb-4">{workout.description}</p>}

					{/* Steps summary */}
					<div className="mb-5">
						<p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">Steps</p>
						<div className="rounded-lg bg-gray-800/50 border border-gray-800 px-3 py-2 max-h-[240px] overflow-y-auto">
							{workout.definition && workout.definition.length > 0 ? (
								renderSteps(workout.definition)
							) : (
								<p className="text-sm text-gray-500">No steps defined</p>
							)}
						</div>
					</div>

					{/* Error */}
					{error && <p className="text-xs text-red-400 mb-3">{error}</p>}

					{/* Actions */}
					<div className="flex items-center gap-2 pt-3 border-t border-gray-700">
						<button
							type="button"
							onClick={handleDownload}
							disabled={downloading}
							className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white transition-colors disabled:opacity-50"
						>
							{downloading ? (
								<svg aria-hidden="true" className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
									<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
									<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
								</svg>
							) : (
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
									<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
									<polyline points="7 10 12 15 17 10" />
									<line x1="12" y1="15" x2="12" y2="3" />
								</svg>
							)}
							Download .fit
						</button>

						<Link
							to={`/workouts/builder?id=${workoutId}`}
							onClick={onClose}
							className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-colors no-underline"
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
								<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
								<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
							</svg>
							Edit
						</Link>

						<button
							type="button"
							onClick={handleRemove}
							disabled={removing}
							className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-red-400 hover:bg-gray-800 border border-transparent hover:border-gray-700 transition-colors disabled:opacity-50"
						>
							{removing ? "Removing…" : "Remove from Calendar"}
						</button>
					</div>
				</>
			) : (
				<p className="text-sm text-gray-500 py-6 text-center">Workout not found</p>
			)}
		</Dialog>
	);
}
