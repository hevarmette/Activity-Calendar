/**
 * StepList — Ordered list of workout steps with repeat group rendering.
 *
 * Renders WorkoutStepOrRepeat items. Single steps are displayed as StepEditor rows.
 * RepeatStep groups render as indented containers with editable repeat count,
 * inner step editors, and controls to add/remove steps within the group.
 *
 * Features:
 * - HTML5 drag-and-drop reordering for top-level steps
 * - Sport-aware display labels (Run/Bike/Swim)
 * - Per-step distance unit passthrough (mi/km/m)
 * - Always-visible delete buttons on all steps
 */
import type { RepeatStep, WorkoutSport, WorkoutStep, WorkoutStepOrRepeat } from "@activity-calendar/shared";
import { isRepeatStep } from "@activity-calendar/shared";
import { useCallback, useState } from "react";
import { StepEditor } from "./StepEditor.js";
import type { DistanceUnit } from "./constants.js";

interface StepListProps {
	/** The ordered list of steps and repeat groups. */
	steps: WorkoutStepOrRepeat[];
	/** Current sport for unit display. */
	sport: WorkoutSport;
	/** Per-step distance units keyed by a stable identifier (top-level index, or "group-inner" for repeat groups). */
	distanceUnits: Record<string, DistanceUnit>;
	/** Called when a step's distance unit changes. Key format: "idx" for top-level, "idx-innerIdx" for repeat inner steps. */
	onDistanceUnitChange: (key: string, unit: DistanceUnit) => void;
	/** Update a step at the given top-level index. */
	onUpdate: (index: number, step: WorkoutStepOrRepeat) => void;
	/** Remove a step at the given top-level index. */
	onRemove: (index: number) => void;
	/** Move a step from one index to another. */
	onMove: (from: number, to: number) => void;
	/** Duplicate a step at the given index. */
	onDuplicate: (index: number) => void;
}

/** Default step used when adding a step inside a repeat group. */
function defaultInnerStep(): WorkoutStep {
	return { durationType: "open", targetType: "open", intensity: "active" };
}

/**
 * RepeatGroupEditor — renders a repeat group with its inner steps, repeat count,
 * and controls for managing the group. Supports drag-and-drop for inner steps.
 */
function RepeatGroupEditor({
	group,
	index,
	sport,
	distanceUnits,
	onDistanceUnitChange,
	onUpdate,
	onRemove,
	onMoveUp,
	onMoveDown,
	isDragOver,
	onDragStart,
	onDragOver,
	onDrop,
	onDragEnd,
}: {
	group: RepeatStep;
	index: number;
	sport: WorkoutSport;
	distanceUnits: Record<string, DistanceUnit>;
	onDistanceUnitChange: (key: string, unit: DistanceUnit) => void;
	onUpdate: (updated: RepeatStep) => void;
	onRemove: () => void;
	onMoveUp?: () => void;
	onMoveDown?: () => void;
	isDragOver?: boolean;
	onDragStart?: (e: React.DragEvent) => void;
	onDragOver?: (e: React.DragEvent) => void;
	onDrop?: (e: React.DragEvent) => void;
	onDragEnd?: (e: React.DragEvent) => void;
}) {
	const [innerDragIdx, setInnerDragIdx] = useState<number | null>(null);
	const [innerDragOverIdx, setInnerDragOverIdx] = useState<number | null>(null);

	const handleRepeatCountChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const val = Number.parseInt(e.target.value, 10);
			if (!Number.isNaN(val) && val >= 1 && val <= 99) {
				onUpdate({ ...group, repeatCount: val });
			}
		},
		[group, onUpdate],
	);

	const handleInnerStepChange = useCallback(
		(innerIndex: number, updated: WorkoutStep) => {
			const newSteps = [...group.steps];
			newSteps[innerIndex] = updated;
			onUpdate({ ...group, steps: newSteps });
		},
		[group, onUpdate],
	);

	const handleInnerStepRemove = useCallback(
		(innerIndex: number) => {
			if (group.steps.length <= 1) {
				onRemove();
				return;
			}
			const newSteps = group.steps.filter((_, i) => i !== innerIndex);
			onUpdate({ ...group, steps: newSteps });
		},
		[group, onUpdate, onRemove],
	);

	const handleInnerStepMove = useCallback(
		(from: number, to: number) => {
			if (to < 0 || to >= group.steps.length) return;
			const newSteps = [...group.steps];
			const moved = newSteps.splice(from, 1)[0];
			if (moved) newSteps.splice(to, 0, moved);
			onUpdate({ ...group, steps: newSteps });
		},
		[group, onUpdate],
	);

	const handleInnerDuplicate = useCallback(
		(innerIndex: number) => {
			const newSteps = [...group.steps];
			const original = group.steps[innerIndex];
			if (original) newSteps.splice(innerIndex + 1, 0, { ...original });
			onUpdate({ ...group, steps: newSteps });
		},
		[group, onUpdate],
	);

	const handleAddInnerStep = useCallback(() => {
		onUpdate({ ...group, steps: [...group.steps, defaultInnerStep()] });
	}, [group, onUpdate]);

	// Inner drag-and-drop handlers
	const handleInnerDragStart = useCallback((innerIdx: number) => {
		return (e: React.DragEvent) => {
			e.stopPropagation();
			setInnerDragIdx(innerIdx);
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", `inner-${innerIdx}`);
		};
	}, []);

	const handleInnerDragOver = useCallback((innerIdx: number) => {
		return (e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setInnerDragOverIdx(innerIdx);
		};
	}, []);

	const handleInnerDrop = useCallback(
		(toIdx: number) => {
			return (e: React.DragEvent) => {
				e.preventDefault();
				e.stopPropagation();
				if (innerDragIdx !== null && innerDragIdx !== toIdx) {
					handleInnerStepMove(innerDragIdx, toIdx);
				}
				setInnerDragIdx(null);
				setInnerDragOverIdx(null);
			};
		},
		[innerDragIdx, handleInnerStepMove],
	);

	const handleInnerDragEnd = useCallback(() => {
		setInnerDragIdx(null);
		setInnerDragOverIdx(null);
	}, []);

	return (
		<div
			className={`border-l-2 border-dashed border-gray-700 ml-4 pl-3 py-1 ${isDragOver ? "bg-gray-800/70 border-t border-t-red-500/50" : ""}`}
			draggable
			onDragStart={onDragStart}
			onDragOver={onDragOver}
			onDrop={onDrop}
			onDragEnd={onDragEnd}
		>
			{/* Repeat group header */}
			<div className="flex items-center gap-2 py-1.5">
				{/* Drag handle */}
				<span
					className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-300 shrink-0 select-none"
					aria-label="Drag to reorder group"
					title="Drag to reorder"
				>
					⠿
				</span>

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
					className="text-gray-400 shrink-0"
				>
					<path d="M17 1l4 4-4 4" />
					<path d="M3 11V9a4 4 0 014-4h14" />
					<path d="M7 23l-4-4 4-4" />
					<path d="M21 13v2a4 4 0 01-4 4H3" />
				</svg>
				<span className="text-xs font-medium text-gray-300">Repeat ×</span>
				<input
					type="number"
					value={group.repeatCount}
					onChange={handleRepeatCountChange}
					min="1"
					max="99"
					aria-label="Repeat count"
					className="w-12 rounded bg-gray-800 border border-gray-700 px-1.5 py-1 text-xs text-gray-200 text-center focus:outline-none focus:ring-2 focus:ring-red-500/50"
				/>
				<button
					type="button"
					onClick={onRemove}
					aria-label="Remove repeat group"
					className="ml-auto p-1 text-gray-500 hover:text-red-400 transition-colors"
					title="Delete group"
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

			{/* Inner steps */}
			<div className="space-y-0.5">
				{group.steps.map((innerStep, innerIdx) => (
					<StepEditor
						key={`${index}-${innerIdx}`}
						step={innerStep}
						index={innerIdx + 1}
						sport={sport}
						distanceUnit={distanceUnits[`${index}-${innerIdx}`] ?? "mi"}
						onDistanceUnitChange={(unit) => onDistanceUnitChange(`${index}-${innerIdx}`, unit)}
						onChange={(updated) => handleInnerStepChange(innerIdx, updated)}
						onRemove={() => handleInnerStepRemove(innerIdx)}
						onMoveUp={innerIdx > 0 ? () => handleInnerStepMove(innerIdx, innerIdx - 1) : undefined}
						onMoveDown={
							innerIdx < group.steps.length - 1 ? () => handleInnerStepMove(innerIdx, innerIdx + 1) : undefined
						}
						onDuplicate={() => handleInnerDuplicate(innerIdx)}
						isDragOver={innerDragOverIdx === innerIdx && innerDragIdx !== innerIdx}
						onDragStart={handleInnerDragStart(innerIdx)}
						onDragOver={handleInnerDragOver(innerIdx)}
						onDrop={handleInnerDrop(innerIdx)}
						onDragEnd={handleInnerDragEnd}
					/>
				))}
			</div>

			{/* Add step to group */}
			<button
				type="button"
				onClick={handleAddInnerStep}
				className="mt-1 ml-6 px-2 py-1 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors"
			>
				+ Add Step to Group
			</button>
		</div>
	);
}

/**
 * StepList component — renders the full ordered step list with HTML5 drag-and-drop.
 * Handles both single steps and repeat groups with uniform move/remove/update controls.
 */
export function StepList({
	steps,
	sport,
	distanceUnits,
	onDistanceUnitChange,
	onUpdate,
	onRemove,
	onMove,
	onDuplicate,
}: StepListProps) {
	const [dragIdx, setDragIdx] = useState<number | null>(null);
	const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

	// Top-level drag-and-drop handlers
	const handleDragStart = useCallback((idx: number) => {
		return (e: React.DragEvent) => {
			setDragIdx(idx);
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", `top-${idx}`);
		};
	}, []);

	const handleDragOver = useCallback((idx: number) => {
		return (e: React.DragEvent) => {
			e.preventDefault();
			setDragOverIdx(idx);
		};
	}, []);

	const handleDrop = useCallback(
		(toIdx: number) => {
			return (e: React.DragEvent) => {
				e.preventDefault();
				if (dragIdx !== null && dragIdx !== toIdx) {
					onMove(dragIdx, toIdx);
				}
				setDragIdx(null);
				setDragOverIdx(null);
			};
		},
		[dragIdx, onMove],
	);

	const handleDragEnd = useCallback(() => {
		setDragIdx(null);
		setDragOverIdx(null);
	}, []);

	// Track global step numbering (flattened across repeat groups for display)
	let stepCounter = 0;

	return (
		<div className="space-y-0.5">
			{steps.map((item, idx) => {
				if (isRepeatStep(item)) {
					return (
						<RepeatGroupEditor
							key={`repeat-${idx}`}
							group={item}
							index={idx}
							sport={sport}
							distanceUnits={distanceUnits}
							onDistanceUnitChange={onDistanceUnitChange}
							onUpdate={(updated) => onUpdate(idx, updated)}
							onRemove={() => onRemove(idx)}
							onMoveUp={idx > 0 ? () => onMove(idx, idx - 1) : undefined}
							onMoveDown={idx < steps.length - 1 ? () => onMove(idx, idx + 1) : undefined}
							isDragOver={dragOverIdx === idx && dragIdx !== idx}
							onDragStart={handleDragStart(idx)}
							onDragOver={handleDragOver(idx)}
							onDrop={handleDrop(idx)}
							onDragEnd={handleDragEnd}
						/>
					);
				}

				stepCounter++;
				const currentCounter = stepCounter;
				return (
					<StepEditor
						key={`step-${idx}`}
						step={item}
						index={currentCounter}
						sport={sport}
						distanceUnit={distanceUnits[String(idx)] ?? "mi"}
						onDistanceUnitChange={(unit) => onDistanceUnitChange(String(idx), unit)}
						onChange={(updated) => onUpdate(idx, updated)}
						onRemove={() => onRemove(idx)}
						onMoveUp={idx > 0 ? () => onMove(idx, idx - 1) : undefined}
						onMoveDown={idx < steps.length - 1 ? () => onMove(idx, idx + 1) : undefined}
						onDuplicate={() => onDuplicate(idx)}
						isDragOver={dragOverIdx === idx && dragIdx !== idx}
						onDragStart={handleDragStart(idx)}
						onDragOver={handleDragOver(idx)}
						onDrop={handleDrop(idx)}
						onDragEnd={handleDragEnd}
					/>
				);
			})}

			{steps.length === 0 && (
				<p className="py-8 text-center text-sm text-gray-500">No steps yet. Add a step below to get started.</p>
			)}
		</div>
	);
}
