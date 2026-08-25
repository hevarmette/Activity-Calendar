/**
 * WorkoutsListPage — Browse, manage, and download saved workouts.
 *
 * Compact list view with sport filter pills at the top. Each row is a clickable
 * Link that navigates to the workout builder for editing. The row shows the
 * workout name, sport badge, created date, scheduled date (if any), and
 * right-aligned action buttons (Schedule, Download, Delete) that use
 * preventDefault to avoid triggering navigation.
 *
 * Navigation:
 * - Click row → /workouts/builder?id=N (edit the workout)
 * - Schedule button → quick date picker to schedule/unschedule on the calendar
 * - Download button → triggers .fit generation from saved workout
 * - Delete button → confirmation dialog then mutation
 * - "+ New Workout" → /workouts/builder (no id)
 */
import type { WorkoutSport } from "@activity-calendar/shared";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { downloadSavedWorkoutFit } from "../api/client.js";
import { useDeleteWorkout, useScheduleWorkout, useWorkouts } from "../api/workout-queries.js";

/** Available sort options for the workout list. */
type SortOption = "newest" | "oldest" | "name-asc" | "name-desc" | "sport";

/** Sport badge color mapping consistent with the builder. */
const SPORT_BADGE_STYLES: Record<WorkoutSport, string> = {
	running: "bg-red-500/15 text-red-400 border-red-500/30",
	cycling: "bg-green-500/15 text-green-400 border-green-500/30",
	swimming: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

const SPORT_OPTIONS: { value: WorkoutSport | ""; label: string }[] = [
	{ value: "", label: "All" },
	{ value: "running", label: "Running" },
	{ value: "cycling", label: "Cycling" },
	{ value: "swimming", label: "Swimming" },
];

export function WorkoutsListPage() {
	const [sportFilter, setSportFilter] = useState<string>("");
	const [sortBy, setSortBy] = useState<SortOption>("newest");
	const [downloadingId, setDownloadingId] = useState<number | null>(null);
	const [deletingId, setDeletingId] = useState<number | null>(null);
	const [schedulingId, setSchedulingId] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);

	const { data: workouts, isLoading } = useWorkouts(sportFilter || undefined);
	const deleteWorkoutMutation = useDeleteWorkout();
	const scheduleWorkoutMutation = useScheduleWorkout();

	/** Workouts sorted by the selected criteria. Sorting is applied after the sport filter. */
	const sortedWorkouts = useMemo(() => {
		if (!workouts) return [];
		const sorted = [...workouts];
		switch (sortBy) {
			case "newest":
				sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
				break;
			case "oldest":
				sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
				break;
			case "name-asc":
				sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
				break;
			case "name-desc":
				sorted.sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: "base" }));
				break;
			case "sport":
				sorted.sort((a, b) => a.sport.localeCompare(b.sport));
				break;
		}
		return sorted;
	}, [workouts, sortBy]);

	/** Download .fit file for a saved workout. */
	async function handleDownload(workoutId: number, name: string) {
		setError(null);
		setDownloadingId(workoutId);
		try {
			await downloadSavedWorkoutFit(workoutId, name);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Download failed");
		} finally {
			setDownloadingId(null);
		}
	}

	/** Delete a workout after user confirmation. */
	async function handleDelete(workoutId: number, name: string) {
		if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
		setError(null);
		setDeletingId(workoutId);
		try {
			await deleteWorkoutMutation.mutateAsync(workoutId);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Delete failed");
		} finally {
			setDeletingId(null);
		}
	}

	/** Toggle scheduling: if already scheduled, unschedule; otherwise show the date picker. */
	async function handleScheduleToggle(workoutId: number, currentDate: string | null | undefined) {
		if (currentDate) {
			// Unschedule
			setError(null);
			setSchedulingId(workoutId);
			try {
				await scheduleWorkoutMutation.mutateAsync({ workoutId, scheduledDate: null });
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to unschedule");
			} finally {
				setSchedulingId(null);
			}
		} else {
			// Show native date picker by toggling scheduling ID
			setSchedulingId((prev) => (prev === workoutId ? null : workoutId));
		}
	}

	/** Schedule on a specific date picked from the inline date input. */
	async function handleScheduleDate(workoutId: number, date: string) {
		if (!date) return;
		setError(null);
		setSchedulingId(workoutId);
		try {
			await scheduleWorkoutMutation.mutateAsync({ workoutId, scheduledDate: date });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to schedule");
		} finally {
			setSchedulingId(null);
		}
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-gray-100">Workouts</h1>
					<p className="text-sm text-gray-500 mt-1">Saved workout templates</p>
				</div>
				<Link
					to="/workouts/builder"
					className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-orange-600 hover:bg-orange-700 text-white transition-colors"
				>
					<svg
						aria-hidden="true"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<line x1="12" y1="5" x2="12" y2="19" />
						<line x1="5" y1="12" x2="19" y2="12" />
					</svg>
					New Workout
				</Link>
			</div>

			{/* Sport filter pills and sort control */}
			<div className="flex items-center justify-between gap-4">
				<div className="flex gap-1.5">
					{SPORT_OPTIONS.map(({ value, label }) => (
						<button
							key={value}
							type="button"
							onClick={() => setSportFilter(value)}
							aria-pressed={sportFilter === value}
							className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
								sportFilter === value
									? "bg-orange-600 text-white"
									: "bg-gray-800 text-gray-400 border border-gray-700 hover:text-gray-200 hover:border-gray-600"
							}`}
						>
							{label}
						</button>
					))}
				</div>
				<select
					value={sortBy}
					onChange={(e) => setSortBy(e.target.value as SortOption)}
					aria-label="Sort workouts"
					className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors"
				>
					<option value="newest">Newest first</option>
					<option value="oldest">Oldest first</option>
					<option value="name-asc">Name A–Z</option>
					<option value="name-desc">Name Z–A</option>
					<option value="sport">Sport</option>
				</select>
			</div>

			{/* Error banner */}
			{error && (
				<div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>
			)}

			{/* Loading state */}
			{isLoading && <div className="text-center py-10 text-gray-400">Loading workouts…</div>}

			{/* Workout list */}
			{!isLoading && workouts && workouts.length === 0 && (
				<div className="flex flex-col items-center justify-center py-16 text-gray-500">
					<svg
						aria-hidden="true"
						width="48"
						height="48"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="mb-3 opacity-40"
					>
						<path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
					</svg>
					<p className="text-sm">No saved workouts yet</p>
					<Link to="/workouts/builder" className="mt-3 text-sm text-orange-400 hover:text-orange-300 transition-colors">
						Create your first workout →
					</Link>
				</div>
			)}

			{!isLoading && workouts && sortedWorkouts.length > 0 && (
				<div className="border border-gray-800 rounded-lg overflow-hidden">
					{sortedWorkouts.map((w, idx) => (
						<Link
							key={w.workoutId}
							to={`/workouts/builder?id=${w.workoutId}`}
							className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-800/60 transition-colors group ${
								idx > 0 ? "border-t border-gray-800" : ""
							}`}
							aria-label={`Edit workout: ${w.name}`}
						>
							{/* Sport badge */}
							<span
								className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${SPORT_BADGE_STYLES[w.sport]}`}
							>
								{w.sport}
							</span>

							{/* Name + date */}
							<div className="flex-1 min-w-0">
								<p className="text-sm font-medium text-gray-200 truncate group-hover:text-white transition-colors">
									{w.name}
								</p>
								<p className="text-xs text-gray-500">
									{new Date(w.createdAt).toLocaleDateString(undefined, {
										year: "numeric",
										month: "short",
										day: "numeric",
									})}
									{w.scheduledDate && (
										<span className="ml-2 text-violet-400">
											📅{" "}
											{new Date(`${w.scheduledDate}T00:00:00`).toLocaleDateString(undefined, {
												month: "short",
												day: "numeric",
											})}
										</span>
									)}
									{w.description && <span className="ml-2 text-gray-600">· {w.description}</span>}
								</p>
							</div>

							{/* Inline date picker for scheduling (shown when schedule button clicked) */}
							{schedulingId === w.workoutId && !w.scheduledDate && (
								<div onClick={(e) => e.preventDefault()} onKeyDown={(e) => e.stopPropagation()}>
									<input
										type="date"
										aria-label={`Pick schedule date for ${w.name}`}
										className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
										onChange={(e) => {
											e.preventDefault();
											handleScheduleDate(w.workoutId, e.target.value);
										}}
									/>
								</div>
							)}

							{/* Action buttons — stopPropagation prevents navigation when clicking these */}
							<div
								className="flex items-center gap-1"
								onClick={(e) => e.preventDefault()}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") e.stopPropagation();
								}}
							>
								{/* Schedule/Unschedule */}
								<button
									type="button"
									onClick={(e) => {
										e.preventDefault();
										handleScheduleToggle(w.workoutId, w.scheduledDate);
									}}
									disabled={scheduleWorkoutMutation.isPending && schedulingId === w.workoutId}
									aria-label={w.scheduledDate ? `Unschedule ${w.name}` : `Schedule ${w.name}`}
									title={w.scheduledDate ? "Remove from calendar" : "Schedule on calendar"}
									className={`p-1.5 rounded transition-colors disabled:opacity-50 ${
										w.scheduledDate
											? "text-violet-400 hover:text-violet-300 hover:bg-gray-700"
											: "text-gray-400 hover:text-violet-400 hover:bg-gray-700"
									}`}
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
										<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
										<line x1="16" y1="2" x2="16" y2="6" />
										<line x1="8" y1="2" x2="8" y2="6" />
										<line x1="3" y1="10" x2="21" y2="10" />
										{w.scheduledDate && <polyline points="9 16 11 18 15 14" />}
									</svg>
								</button>
								{/* Download */}
								<button
									type="button"
									onClick={(e) => {
										e.preventDefault();
										handleDownload(w.workoutId, w.name);
									}}
									disabled={downloadingId === w.workoutId}
									aria-label={`Download ${w.name} as .fit`}
									className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors disabled:opacity-50"
								>
									{downloadingId === w.workoutId ? (
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
								</button>

								{/* Delete */}
								<button
									type="button"
									onClick={(e) => {
										e.preventDefault();
										handleDelete(w.workoutId, w.name);
									}}
									disabled={deletingId === w.workoutId}
									aria-label={`Delete ${w.name}`}
									className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors disabled:opacity-50"
								>
									{deletingId === w.workoutId ? (
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
											<polyline points="3 6 5 6 21 6" />
											<path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
										</svg>
									)}
								</button>
							</div>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}

export default WorkoutsListPage;
