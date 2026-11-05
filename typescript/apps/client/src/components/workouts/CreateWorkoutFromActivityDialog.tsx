import {
	type Lap,
	type WorkoutDefinition,
	type WorkoutMode,
	type WorkoutUnits,
	activityToWorkout,
	toWorkoutSport,
} from "@activity-calendar/shared";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useSaveWorkout } from "../../api/workout-queries.js";
import { Dialog } from "../ui/Dialog.js";

/** Server limit on workout name length (workoutDefinitionSchema). */
const MAX_NAME_LENGTH = 50;

interface Props {
	open: boolean;
	onClose: () => void;
	/** Default workout name (usually the activity title). */
	defaultName: string;
	/** Activity sport string; unsupported sports show a message instead of the form. */
	sport: string;
	/** Laps of the activity (or active multisport leg). */
	laps: Lap[];
}

/** Recursively count leaf steps for the summary line. */
function summarize(workout: WorkoutDefinition): { steps: number; repeats: number } {
	let repeats = 0;
	for (const s of workout.steps) if ("repeatCount" in s) repeats++;
	return { steps: workout.steps.length, repeats };
}

/**
 * Shared styling for the three button-toggle controls. `active` highlights the
 * selected option with the red accent; inactive options use the neutral gray
 * surface so the toggle group reads as a single compact control.
 */
function toggleClass(active: boolean): string {
	return `rounded-lg px-3 py-1.5 text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/50 ${
		active ? "bg-red-600 border-red-600 text-white" : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
	}`;
}

/**
 * Dialog that builds a structured workout from a completed activity's laps
 * (via the shared `activityToWorkout`) and saves it through POST /api/workouts.
 * After saving it navigates to the builder (`/workouts/builder?id=N`) for editing.
 *
 * Three toggles tune the conversion before saving:
 * - `units` (metric/imperial) controls how lap distances are rounded.
 * - `activeMode` (distance/time) controls how active/warmup/cooldown/interval
 *   laps are measured.
 * - `restMode` (distance/time) controls how rest/recovery laps are measured.
 *
 * Props: `open`/`onClose` control visibility; `defaultName`, `sport` and `laps`
 * come from the activity being viewed.
 */
export function CreateWorkoutFromActivityDialog({ open, onClose, defaultName, sport, laps }: Props) {
	const navigate = useNavigate();
	const save = useSaveWorkout();
	const resetSave = save.reset;
	const [name, setName] = useState(defaultName);
	const [units, setUnits] = useState<WorkoutUnits>("metric");
	const [activeMode, setActiveMode] = useState<WorkoutMode>("distance");
	const [restMode, setRestMode] = useState<WorkoutMode>("distance");

	// Reset the form each time the dialog is opened.
	useEffect(() => {
		if (open) {
			setName(defaultName);
			setUnits("metric");
			setActiveMode("distance");
			setRestMode("distance");
			resetSave();
		}
	}, [open, defaultName, resetSave]);

	const supported = toWorkoutSport(sport) !== null;
	const trimmed = name.trim();
	const workout = useMemo(
		() =>
			supported
				? activityToWorkout({
						name: trimmed || "Workout",
						sport,
						laps,
						units,
						activeMode,
						restMode,
					})
				: null,
		[supported, trimmed, sport, laps, units, activeMode, restMode],
	);
	const summary = workout ? summarize(workout) : null;
	const empty = !workout || workout.steps.length === 0;
	const canSave = !empty && trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH && !save.isPending;

	const handleSave = () => {
		if (!workout || !canSave) return;
		save.mutate(workout, {
			onSuccess: ({ workoutId }) => {
				onClose();
				navigate(`/workouts/builder?id=${workoutId}`);
			},
		});
	};

	return (
		<Dialog
			open={open}
			onClose={onClose}
			title="Create workout from activity"
			subtitle="Laps are rounded and repeats collapsed"
		>
			{!supported ? (
				<p className="text-sm text-gray-400">Workouts can only be created from running, cycling or swimming.</p>
			) : (
				<form
					className="space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						handleSave();
					}}
				>
					<div>
						<label htmlFor="cwfa-name" className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
							Name
						</label>
						<input
							id="cwfa-name"
							type="text"
							value={name}
							maxLength={MAX_NAME_LENGTH}
							onChange={(e) => setName(e.target.value)}
							className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/50"
						/>
					</div>

					<fieldset>
						<legend className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Units</legend>
						<div className="flex gap-2">
							{(["metric", "imperial"] as const).map((u) => (
								<button
									key={u}
									type="button"
									aria-pressed={units === u}
									onClick={() => setUnits(u)}
									className={toggleClass(units === u)}
								>
									{u === "metric" ? "Metric" : "Imperial"}
								</button>
							))}
						</div>
					</fieldset>

					<fieldset>
						<legend className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
							Active reps
						</legend>
						<div className="flex gap-2">
							{(["distance", "time"] as const).map((m) => (
								<button
									key={m}
									type="button"
									aria-pressed={activeMode === m}
									onClick={() => setActiveMode(m)}
									className={toggleClass(activeMode === m)}
								>
									{m === "distance" ? "By distance" : "By time"}
								</button>
							))}
						</div>
					</fieldset>

					<fieldset>
						<legend className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
							Rest / recovery
						</legend>
						<div className="flex gap-2">
							{(["distance", "time"] as const).map((m) => (
								<button
									key={m}
									type="button"
									aria-pressed={restMode === m}
									onClick={() => setRestMode(m)}
									className={toggleClass(restMode === m)}
								>
									{m === "distance" ? "By distance" : "By time"}
								</button>
							))}
						</div>
					</fieldset>

					<p className="text-sm text-gray-400" aria-live="polite">
						{empty
							? "No usable laps found for these settings."
							: `${summary?.steps} top-level step${summary?.steps === 1 ? "" : "s"}, ${summary?.repeats} repeat group${summary?.repeats === 1 ? "" : "s"}.`}
					</p>

					{save.isError && (
						<p role="alert" className="text-sm text-red-400">
							Failed to save workout. Please try again.
						</p>
					)}

					<div className="flex justify-end gap-2 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg px-3 py-1.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/50"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!canSave}
							className="bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-3 py-1.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/50"
						>
							{save.isPending ? "Saving…" : "Save & edit"}
						</button>
					</div>
				</form>
			)}
		</Dialog>
	);
}
