/**
 * WorkoutBuilderPage — Create structured workouts and export as Garmin .fit files.
 *
 * Two-column layout: left column for metadata and step editing, right column for
 * the visual preview and download button. All state is local (useReducer) since
 * this is a creation form, not a filterable view.
 *
 * Features:
 * - Sport selector (Running/Cycling/Swimming)
 * - Per-step distance unit selector (mi/km/m) — each step independently chooses
 *   its display unit; conversion to meters (API format) is automatic
 * - Sport-aware step labels (Run/Bike/Swim instead of Interval/Active)
 * - Warmup/Cooldown default to 'open' (Lap Button) duration
 * - Active step defaults to 'distance' (1 mi) on initial load
 * - New steps insert before the last cooldown step
 * - All intensity types available as add-step buttons
 * - Drag-and-drop step reordering
 * - Visual workout preview with estimated time/distance
 * - FIT file download
 * - Save/Update to server with URL persistence (?id=N)
 * - Keyboard shortcut: S to save (matches activity details pattern)
 * - Load saved workouts from URL search params on mount
 */
import type { RepeatStep, WorkoutSport, WorkoutStep, WorkoutStepOrRepeat } from "@activity-calendar/shared";
import { isRepeatStep } from "@activity-calendar/shared";
import { useCallback, useEffect, useReducer, useState } from "react";
import { useSearchParams } from "react-router";
import { downloadWorkoutFit } from "../api/client.js";
import { useSaveWorkout, useUpdateWorkout, useWorkout } from "../api/workout-queries.js";
import { StepList } from "../components/workouts/StepList.js";
import { WorkoutPreview } from "../components/workouts/WorkoutPreview.js";
import { type DistanceUnit, getSportVerb } from "../components/workouts/constants.js";

// ─── State & Reducer ──────────────────────────────────────────────────────────

interface WorkoutBuilderState {
	name: string;
	sport: WorkoutSport;
	description: string;
	steps: WorkoutStepOrRepeat[];
}

type Action =
	| { type: "SET_NAME"; name: string }
	| { type: "SET_SPORT"; sport: WorkoutSport }
	| { type: "SET_DESCRIPTION"; description: string }
	| { type: "ADD_STEP"; step: WorkoutStep }
	| { type: "ADD_REPEAT"; repeat: RepeatStep }
	| { type: "UPDATE_STEP"; index: number; step: WorkoutStepOrRepeat }
	| { type: "REMOVE_STEP"; index: number }
	| { type: "MOVE_STEP"; from: number; to: number }
	| { type: "DUPLICATE_STEP"; index: number }
	| { type: "LOAD"; state: WorkoutBuilderState }
	| { type: "RESET" };

const INITIAL_STATE: WorkoutBuilderState = {
	name: "My Workout",
	sport: "running",
	description: "",
	steps: [
		{ durationType: "open", targetType: "open", intensity: "warmup", name: "Warmup" },
		{ durationType: "distance", durationValue: 1609.344, targetType: "open", intensity: "active" },
		{ durationType: "open", targetType: "open", intensity: "cooldown", name: "Cooldown" },
	],
};

/**
 * Find the insertion index for a new step: before the last cooldown step if one exists,
 * otherwise at the end. This keeps the pattern [warmup, ...steps..., cooldown].
 */
function findInsertIndex(steps: WorkoutStepOrRepeat[]): number {
	// Search from the end for the last cooldown step
	for (let i = steps.length - 1; i >= 0; i--) {
		const s = steps[i];
		if (s && !isRepeatStep(s) && s.intensity === "cooldown") {
			return i;
		}
	}
	return steps.length;
}

function reducer(state: WorkoutBuilderState, action: Action): WorkoutBuilderState {
	switch (action.type) {
		case "SET_NAME":
			return { ...state, name: action.name.slice(0, 50) };
		case "SET_SPORT":
			return { ...state, sport: action.sport };
		case "SET_DESCRIPTION":
			return { ...state, description: action.description };
		case "ADD_STEP": {
			const steps = [...state.steps];
			const insertAt = findInsertIndex(steps);
			steps.splice(insertAt, 0, action.step);
			return { ...state, steps };
		}
		case "ADD_REPEAT": {
			const steps = [...state.steps];
			const insertAt = findInsertIndex(steps);
			steps.splice(insertAt, 0, action.repeat);
			return { ...state, steps };
		}
		case "UPDATE_STEP": {
			const steps = [...state.steps];
			steps[action.index] = action.step;
			return { ...state, steps };
		}
		case "REMOVE_STEP":
			return { ...state, steps: state.steps.filter((_, i) => i !== action.index) };
		case "MOVE_STEP": {
			if (action.to < 0 || action.to >= state.steps.length) return state;
			const steps = [...state.steps];
			const moved = steps.splice(action.from, 1)[0];
			if (!moved) return state;
			steps.splice(action.to, 0, moved);
			return { ...state, steps };
		}
		case "DUPLICATE_STEP": {
			const steps = [...state.steps];
			const original = steps[action.index];
			if (!original) return state;
			// Deep copy for repeat groups
			const copy = isRepeatStep(original)
				? { ...original, steps: original.steps.map((s) => ({ ...s })) }
				: { ...original };
			steps.splice(action.index + 1, 0, copy);
			return { ...state, steps };
		}
		case "LOAD":
			return action.state;
		case "RESET":
			return INITIAL_STATE;
		default:
			return state;
	}
}

// ─── Validation ───────────────────────────────────────────────────────────────

interface ValidationErrors {
	name?: string;
	steps?: string;
}

function validate(state: WorkoutBuilderState): ValidationErrors {
	const errors: ValidationErrors = {};
	if (!state.name.trim()) errors.name = "Workout name is required";
	if (state.steps.length === 0) errors.steps = "At least one step is required";

	for (const step of state.steps) {
		if (isRepeatStep(step)) {
			for (const inner of step.steps) {
				if (inner.durationType !== "open" && (!inner.durationValue || inner.durationValue <= 0)) {
					errors.steps = "All steps with time/distance duration need a value > 0";
					break;
				}
			}
		} else if (step.durationType !== "open" && (!step.durationValue || step.durationValue <= 0)) {
			errors.steps = "All steps with time/distance duration need a value > 0";
		}
		if (errors.steps) break;
	}

	return errors;
}

// ─── Component ────────────────────────────────────────────────────────────────

const SPORT_OPTIONS: { value: WorkoutSport; label: string }[] = [
	{ value: "running", label: "Running" },
	{ value: "cycling", label: "Cycling" },
	{ value: "swimming", label: "Swimming" },
];

export function WorkoutBuilderPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
	const [generating, setGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const [saving, setSaving] = useState(false);
	/** Per-step distance unit. Keys are "idx" for top-level steps and "idx-innerIdx" for repeat group inner steps. */
	const [distanceUnits, setDistanceUnits] = useState<Record<string, DistanceUnit>>({ "1": "mi" });

	// ─── Persistence state ────────────────────────────────────────────────────

	/** Current workout ID — null for new, number for editing an existing saved workout. */
	const [workoutId, setWorkoutId] = useState<number | null>(() => {
		const idParam = searchParams.get("id");
		return idParam ? Number(idParam) : null;
	});

	// Load saved workout from server when ?id=N is in URL
	const { data: savedWorkout } = useWorkout(workoutId ?? 0);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		if (savedWorkout && !loaded) {
			dispatch({
				type: "LOAD",
				state: {
					name: savedWorkout.name,
					sport: savedWorkout.sport,
					description: savedWorkout.description ?? "",
					steps: savedWorkout.definition,
				},
			});
			setLoaded(true);
		}
	}, [savedWorkout, loaded]);

	// Reset loaded flag if ID changes
	useEffect(() => {
		const idParam = searchParams.get("id");
		const newId = idParam ? Number(idParam) : null;
		if (newId !== workoutId) {
			setWorkoutId(newId);
			setLoaded(false);
			if (!newId) {
				dispatch({ type: "RESET" });
			}
		}
	}, [searchParams, workoutId]);

	const saveWorkoutMutation = useSaveWorkout();
	const updateWorkoutMutation = useUpdateWorkout(workoutId ?? 0);

	const errors = validate(state);
	const hasErrors = Object.keys(errors).length > 0;
	const sportVerb = getSportVerb(state.sport);

	// ─── Step action handlers ─────────────────────────────────────────────────

	const handleAddStep = useCallback((intensity: WorkoutStep["intensity"]) => {
		// Warmup and cooldown default to 'open' (Lap Button) duration
		const durationType = intensity === "warmup" || intensity === "cooldown" ? "open" : "open";
		const step: WorkoutStep = { durationType, targetType: "open", intensity };
		dispatch({ type: "ADD_STEP", step });
	}, []);

	const handleAddRepeat = useCallback(() => {
		const repeat: RepeatStep = {
			repeatCount: 4,
			steps: [
				{ durationType: "distance", durationValue: 800, targetType: "open", intensity: "interval" },
				{ durationType: "time", durationValue: 120, targetType: "open", intensity: "rest" },
			],
		};
		dispatch({ type: "ADD_REPEAT", repeat });
	}, []);

	const handleUpdate = useCallback((index: number, step: WorkoutStepOrRepeat) => {
		dispatch({ type: "UPDATE_STEP", index, step });
	}, []);

	const handleRemove = useCallback((index: number) => {
		dispatch({ type: "REMOVE_STEP", index });
	}, []);

	const handleMove = useCallback((from: number, to: number) => {
		dispatch({ type: "MOVE_STEP", from, to });
	}, []);

	const handleDuplicate = useCallback((index: number) => {
		dispatch({ type: "DUPLICATE_STEP", index });
	}, []);

	const handleDistanceUnitChange = useCallback((key: string, unit: DistanceUnit) => {
		setDistanceUnits((prev) => ({ ...prev, [key]: unit }));
	}, []);

	// ─── Save / Update ────────────────────────────────────────────────────────

	const buildDefinition = useCallback(() => {
		return {
			name: state.name.trim(),
			sport: state.sport,
			description: state.description || undefined,
			steps: state.steps,
		};
	}, [state]);

	const handleSave = useCallback(async () => {
		if (hasErrors) return;
		setError(null);
		setSaving(true);
		try {
			if (workoutId) {
				await updateWorkoutMutation.mutateAsync(buildDefinition());
			} else {
				const result = await saveWorkoutMutation.mutateAsync(buildDefinition());
				setWorkoutId(result.workoutId);
				setSearchParams((prev) => {
					const next = new URLSearchParams(prev);
					next.set("id", String(result.workoutId));
					return next;
				});
			}
			setSuccess(true);
			setTimeout(() => setSuccess(false), 2000);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save workout");
		} finally {
			setSaving(false);
		}
	}, [hasErrors, workoutId, buildDefinition, saveWorkoutMutation, updateWorkoutMutation, setSearchParams]);

	// ─── Keyboard shortcut: S to save ─────────────────────────────────────────

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "s" && !e.ctrlKey && !e.metaKey && !e.altKey) {
				const tag = (e.target as HTMLElement)?.tagName;
				if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
				e.preventDefault();
				handleSave();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleSave]);

	// ─── Generate / Download ──────────────────────────────────────────────────

	const handleGenerate = useCallback(async () => {
		if (hasErrors) return;
		setError(null);
		setGenerating(true);
		try {
			await downloadWorkoutFit(buildDefinition());
			setSuccess(true);
			setTimeout(() => setSuccess(false), 2000);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to generate workout");
		} finally {
			setGenerating(false);
		}
	}, [buildDefinition, hasErrors]);

	// ─── Render ───────────────────────────────────────────────────────────────

	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<h1 className="text-2xl font-bold text-gray-100">Workout Builder</h1>
				<p className="text-sm text-gray-500 mt-1">
					{workoutId ? `Editing saved workout #${workoutId}` : "Create structured workouts for your Garmin device"}
					<span className="ml-2 text-gray-600">Press S to save</span>
				</p>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
				{/* Left column: Metadata + Steps */}
				<div className="space-y-5 min-w-0">
					{/* Metadata */}
					<div className="space-y-3">
						{/* Name */}
						<div>
							<label htmlFor="workout-name" className="text-xs font-medium text-gray-400 block mb-1">
								Workout Name
							</label>
							<input
								id="workout-name"
								type="text"
								value={state.name}
								onChange={(e) => dispatch({ type: "SET_NAME", name: e.target.value })}
								maxLength={50}
								placeholder="e.g. 5x1000m Intervals"
								aria-label="Workout name"
								className={`w-full max-w-sm rounded-lg bg-gray-800 border px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 transition-colors ${
									errors.name ? "border-red-500" : "border-gray-700 focus:border-red-500"
								}`}
							/>
							{errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
						</div>

						{/* Sport selector */}
						<div className="flex flex-wrap items-end gap-4">
							<div>
								<span className="text-xs font-medium text-gray-400 block mb-1">Sport</span>
								<div className="flex gap-1">
									{SPORT_OPTIONS.map(({ value, label }) => (
										<button
											key={value}
											type="button"
											onClick={() => dispatch({ type: "SET_SPORT", sport: value })}
											aria-pressed={state.sport === value}
											className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
												state.sport === value
													? "bg-red-600 text-white"
													: "bg-gray-800 text-gray-400 border border-gray-700 hover:text-gray-200 hover:border-gray-600"
											}`}
										>
											{label}
										</button>
									))}
								</div>
							</div>
						</div>

						{/* Description (collapsible) */}
						<div>
							<label htmlFor="workout-desc" className="text-xs font-medium text-gray-400 block mb-1">
								Description (optional)
							</label>
							<textarea
								id="workout-desc"
								value={state.description}
								onChange={(e) => dispatch({ type: "SET_DESCRIPTION", description: e.target.value })}
								placeholder="Workout notes…"
								rows={2}
								className="w-full max-w-sm rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-colors resize-none"
							/>
						</div>
					</div>

					{/* Step List */}
					<div>
						<div className="flex items-center justify-between mb-2">
							<span className="text-xs font-medium text-gray-400">Steps</span>
							<button
								type="button"
								onClick={() => dispatch({ type: "RESET" })}
								className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
							>
								Reset
							</button>
						</div>

						{errors.steps && <p className="text-xs text-red-400 mb-2">{errors.steps}</p>}

						<div className="rounded-lg border border-gray-800 overflow-hidden">
							<StepList
								steps={state.steps}
								sport={state.sport}
								distanceUnits={distanceUnits}
								onDistanceUnitChange={handleDistanceUnitChange}
								onUpdate={handleUpdate}
								onRemove={handleRemove}
								onMove={handleMove}
								onDuplicate={handleDuplicate}
							/>
						</div>

						{/* Add step buttons — all intensity types + repeat group */}
						<div className="flex flex-wrap gap-1.5 mt-3">
							<button
								type="button"
								onClick={() => handleAddStep("warmup")}
								className="px-2.5 py-1.5 rounded text-xs font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors"
							>
								+ Warmup
							</button>
							<button
								type="button"
								onClick={() => handleAddStep("active")}
								className="px-2.5 py-1.5 rounded text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
							>
								+ {sportVerb}
							</button>
							<button
								type="button"
								onClick={() => handleAddStep("rest")}
								className="px-2.5 py-1.5 rounded text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 transition-colors"
							>
								+ Rest
							</button>
							<button
								type="button"
								onClick={() => handleAddStep("recovery")}
								className="px-2.5 py-1.5 rounded text-xs font-medium bg-blue-400/10 text-blue-300 border border-blue-400/30 hover:bg-blue-400/20 transition-colors"
							>
								+ Recovery
							</button>
							<button
								type="button"
								onClick={() => handleAddStep("cooldown")}
								className="px-2.5 py-1.5 rounded text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/30 hover:bg-green-500/20 transition-colors"
							>
								+ Cooldown
							</button>
							<button
								type="button"
								onClick={() => handleAddStep("other")}
								className="px-2.5 py-1.5 rounded text-xs font-medium bg-gray-500/10 text-gray-400 border border-gray-500/30 hover:bg-gray-500/20 transition-colors"
							>
								+ Other
							</button>
							<button
								type="button"
								onClick={handleAddRepeat}
								className="px-2.5 py-1.5 rounded text-xs font-medium bg-gray-700/50 text-gray-300 border border-gray-600 hover:bg-gray-700 transition-colors"
							>
								+ Repeats
							</button>
						</div>
					</div>
				</div>

				{/* Right column: Preview + Save + Generate */}
				<div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
					<div>
						<span className="text-xs font-medium text-gray-400 block mb-2">Preview</span>
						<WorkoutPreview steps={state.steps} sport={state.sport} />
					</div>

					{/* Save / Update button */}
					<button
						type="button"
						onClick={handleSave}
						disabled={hasErrors || saving}
						className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700 hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{saving ? (
							<>
								<svg aria-hidden="true" className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
									<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
									<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
								</svg>
								Saving…
							</>
						) : (
							<>
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
									<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
									<polyline points="17 21 17 13 7 13 7 21" />
									<polyline points="7 3 7 8 15 8" />
								</svg>
								{workoutId ? "Update Workout" : "Save Workout"}
							</>
						)}
					</button>

					{/* Generate / Download button */}
					<button
						type="button"
						onClick={handleGenerate}
						disabled={hasErrors || generating}
						className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
							success
								? "bg-green-600 text-white"
								: hasErrors
									? "bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700"
									: "bg-red-600 hover:bg-red-700 text-white"
						} disabled:opacity-50 disabled:cursor-not-allowed`}
					>
						{generating ? (
							<>
								<svg aria-hidden="true" className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
									<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
									<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
								</svg>
								Generating…
							</>
						) : success ? (
							<>
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
									<polyline points="20 6 9 17 4 12" />
								</svg>
								Downloaded!
							</>
						) : (
							<>
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
									<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
									<polyline points="7 10 12 15 17 10" />
									<line x1="12" y1="15" x2="12" y2="3" />
								</svg>
								Download .fit
							</>
						)}
					</button>

					{error && <p className="text-xs text-red-400 text-center">{error}</p>}
				</div>
			</div>
		</div>
	);
}

export default WorkoutBuilderPage;
