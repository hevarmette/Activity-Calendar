/**
 * WorkoutsListPage — Browse, manage, and download saved workouts.
 *
 * Compact list view with sport filter pills at the top. Each row shows the
 * workout name, sport badge, created date, and action buttons for editing,
 * downloading, and deleting. Follows the app's dark theme with red-600 accent.
 *
 * Navigation:
 * - Edit → /workouts/builder?id=N
 * - Download → triggers .fit generation from saved workout
 * - Delete → confirmation dialog then mutation
 * - "+ New Workout" → /workouts/builder (no id)
 */
import type { WorkoutSport } from "@activity-calendar/shared";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { downloadSavedWorkoutFit } from "../api/client.js";
import { useDeleteWorkout, useWorkouts } from "../api/workout-queries.js";

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
	const [error, setError] = useState<string | null>(null);

	const navigate = useNavigate();
	const { data: workouts, isLoading } = useWorkouts(sportFilter || undefined);
	const deleteWorkoutMutation = useDeleteWorkout();

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
					className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
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
									? "bg-red-600 text-white"
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
					className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-colors"
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
					<Link to="/workouts/builder" className="mt-3 text-sm text-red-400 hover:text-red-300 transition-colors">
						Create your first workout →
					</Link>
				</div>
			)}

			{!isLoading && workouts && sortedWorkouts.length > 0 && (
				<div className="border border-gray-800 rounded-lg overflow-hidden">
					{sortedWorkouts.map((w, idx) => (
						<div
							key={w.workoutId}
							className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-900/50 transition-colors ${
								idx > 0 ? "border-t border-gray-800" : ""
							}`}
						>
							{/* Sport badge */}
							<span
								className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${SPORT_BADGE_STYLES[w.sport]}`}
							>
								{w.sport}
							</span>

							{/* Name + date */}
							<div className="flex-1 min-w-0">
								<p className="text-sm font-medium text-gray-200 truncate">{w.name}</p>
								<p className="text-xs text-gray-500">
									{new Date(w.createdAt).toLocaleDateString(undefined, {
										year: "numeric",
										month: "short",
										day: "numeric",
									})}
									{w.description && <span className="ml-2 text-gray-600">· {w.description}</span>}
								</p>
							</div>

							{/* Action buttons */}
							<div className="flex items-center gap-1">
								{/* Edit */}
								<button
									type="button"
									onClick={() => navigate(`/workouts/builder?id=${w.workoutId}`)}
									aria-label={`Edit ${w.name}`}
									className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
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
								</button>

								{/* Download */}
								<button
									type="button"
									onClick={() => handleDownload(w.workoutId, w.name)}
									disabled={downloadingId === w.workoutId}
									aria-label={`Download ${w.name} as .fit`}
									className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-50"
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
									onClick={() => handleDelete(w.workoutId, w.name)}
									disabled={deletingId === w.workoutId}
									aria-label={`Delete ${w.name}`}
									className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors disabled:opacity-50"
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
						</div>
					))}
				</div>
			)}
		</div>
	);
}

export default WorkoutsListPage;
