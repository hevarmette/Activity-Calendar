/**
 * StepList — Ordered list of workout steps with repeat group rendering.
 *
 * Renders WorkoutStepOrRepeat items. Single steps are displayed as StepEditor rows.
 * RepeatStep groups render as indented containers with editable repeat count,
 * inner step editors, and controls to add/remove steps within the group.
 *
 * Drag-and-drop is powered by @dnd-kit with a single DndContext spanning the whole
 * list. Two kinds of droppable containers exist: the root list and each repeat
 * group. Because of this, steps can be dragged BETWEEN the root list and repeat
 * groups (into, out of, and across groups) — not just reordered within one list.
 *
 * Each sortable item carries a transient id derived from its current position
 * (`top:i`, `inner:i:j`, `group:i`); on drop the ids are parsed back into a
 * {@link Loc} and a single `onMoveItem(from, to)` performs the structural move.
 *
 * Features:
 * - Cross-container drag-and-drop (reorder + move into/out of repeat groups)
 * - Up/Down arrow buttons as an always-available, non-drag reordering fallback
 * - Sport-aware display labels (Run/Bike/Swim)
 * - Per-step distance unit passthrough (mi/km/m)
 * - Always-visible delete buttons on all steps
 */
import type { RepeatStep, WorkoutSport, WorkoutStep, WorkoutStepOrRepeat } from "@activity-calendar/shared";
import { isRepeatStep } from "@activity-calendar/shared";
import {
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback } from "react";
import { StepEditor } from "./StepEditor.js";
import { type DistanceUnit, type Loc, groupId, innerId, parseDndId, topId } from "./constants.js";

interface StepListProps {
	/** The ordered list of steps and repeat groups. */
	steps: WorkoutStepOrRepeat[];
	/** Current sport for unit display. */
	sport: WorkoutSport;
	/** Per-step distance units keyed by a stable identifier (top-level index, or "idx-innerIdx" for repeat groups). */
	distanceUnits: Record<string, DistanceUnit>;
	/** Called when a step's distance unit changes. Key format: "idx" for top-level, "idx-innerIdx" for repeat inner steps. */
	onDistanceUnitChange: (key: string, unit: DistanceUnit) => void;
	/** Update a step at the given top-level index. */
	onUpdate: (index: number, step: WorkoutStepOrRepeat) => void;
	/** Remove a step at the given top-level index. */
	onRemove: (index: number) => void;
	/** Move a top-level item from one index to another (used by group up/down arrows). */
	onMove: (from: number, to: number) => void;
	/** Structural move between any two locations (root ↔ group). */
	onMoveItem: (from: Loc, to: Loc) => void;
	/** Duplicate a step at the given index. */
	onDuplicate: (index: number) => void;
}

/** Default step used when adding a step inside a repeat group. */
function defaultInnerStep(): WorkoutStep {
	return { durationType: "open", targetType: "open", intensity: "active" };
}

/**
 * SortableStep — wraps StepEditor with dnd-kit's useSortable so the row can be
 * dragged by its handle while its inputs stay interactive. `id` is the transient
 * sortable id (`top:i` or `inner:i:j`).
 */
function SortableStep({
	id,
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
}: {
	id: string;
	step: WorkoutStep;
	index: number;
	sport: WorkoutSport;
	distanceUnit: DistanceUnit;
	onDistanceUnitChange: (unit: DistanceUnit) => void;
	onChange: (updated: WorkoutStep) => void;
	onRemove: () => void;
	onMoveUp?: () => void;
	onMoveDown?: () => void;
	onDuplicate: () => void;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
	const dragStyle = {
		transform: CSS.Translate.toString(transform),
		transition,
		zIndex: isDragging ? 10 : undefined,
	};
	return (
		<StepEditor
			step={step}
			index={index}
			sport={sport}
			distanceUnit={distanceUnit}
			onDistanceUnitChange={onDistanceUnitChange}
			onChange={onChange}
			onRemove={onRemove}
			onMoveUp={onMoveUp}
			onMoveDown={onMoveDown}
			onDuplicate={onDuplicate}
			isDragging={isDragging}
			dragStyle={dragStyle}
			dragHandleProps={{ ...attributes, ...listeners }}
			setNodeRef={setNodeRef}
		/>
	);
}

/**
 * RepeatGroupEditor — renders a repeat group as its own droppable/sortable
 * container. The group itself is sortable at the root level; its inner steps form
 * a nested SortableContext so items can be reordered within, and dropped into/out
 * of, the group.
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
	onMoveItem,
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
	onMoveItem: (from: Loc, to: Loc) => void;
}) {
	// The group row is itself sortable within the root list.
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: topId(index) });
	// And a droppable so items can be dropped onto the group (append to the end).
	const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: groupId(index) });

	const dragStyle = {
		transform: CSS.Translate.toString(transform),
		transition,
		zIndex: isDragging ? 10 : undefined,
	};

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

	const innerIds = group.steps.map((_, j) => innerId(index, j));

	return (
		<div
			ref={setNodeRef}
			style={dragStyle}
			className={`border-l-2 border-dashed border-gray-700 ml-4 pl-3 py-1 ${isDragging ? "opacity-50" : ""} ${isOver ? "bg-gray-800/70 ring-1 ring-orange-500/50 rounded" : ""}`}
		>
			{/* Repeat group header */}
			<div className="flex items-center gap-2 py-1.5">
				{/* Drag handle — only this starts a group drag. */}
				<button
					type="button"
					{...attributes}
					{...listeners}
					className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-300 shrink-0 select-none bg-transparent border-none p-0 leading-none touch-none"
					aria-label="Drag to reorder group"
					title="Drag to reorder"
				>
					⠿
				</button>

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
					className="w-12 rounded bg-gray-800 border border-gray-700 px-1.5 py-1 text-xs text-gray-200 text-center focus:outline-none focus:ring-2 focus:ring-orange-500/50"
				/>

				{/* Up / Down move the whole group within the root list. */}
				<button
					type="button"
					onClick={onMoveUp}
					disabled={!onMoveUp}
					aria-label="Move group up"
					title="Move group up"
					className="p-1 text-gray-500 hover:text-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
						<polyline points="18 15 12 9 6 15" />
					</svg>
				</button>
				<button
					type="button"
					onClick={onMoveDown}
					disabled={!onMoveDown}
					aria-label="Move group down"
					title="Move group down"
					className="p-1 text-gray-500 hover:text-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
						<polyline points="6 9 12 15 18 9" />
					</svg>
				</button>
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

			{/* Inner steps — nested sortable container. The droppable ref lets items
			    drop onto the group even when it is empty-ish. */}
			<div ref={setDroppableRef} className="space-y-0.5 min-h-[8px]">
				<SortableContext items={innerIds} strategy={verticalListSortingStrategy}>
					{group.steps.map((innerStep, innerIdx) => (
						<SortableStep
							key={innerId(index, innerIdx)}
							id={innerId(index, innerIdx)}
							step={innerStep}
							index={innerIdx + 1}
							sport={sport}
							distanceUnit={distanceUnits[`${index}-${innerIdx}`] ?? "mi"}
							onDistanceUnitChange={(unit) => onDistanceUnitChange(`${index}-${innerIdx}`, unit)}
							onChange={(updated) => handleInnerStepChange(innerIdx, updated)}
							onRemove={() => handleInnerStepRemove(innerIdx)}
							onMoveUp={
								innerIdx > 0
									? () =>
											onMoveItem(
												{ kind: "group", group: index, index: innerIdx },
												{ kind: "group", group: index, index: innerIdx - 1 },
											)
									: undefined
							}
							onMoveDown={
								innerIdx < group.steps.length - 1
									? () =>
											onMoveItem(
												{ kind: "group", group: index, index: innerIdx },
												{ kind: "group", group: index, index: innerIdx + 1 },
											)
									: undefined
							}
							onDuplicate={() => handleInnerDuplicate(innerIdx)}
						/>
					))}
				</SortableContext>
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
 * StepList component — renders the full ordered step list inside one DndContext.
 * Handles both single steps and repeat groups with uniform move/remove/update
 * controls, and resolves drag drops into structural `onMoveItem` calls.
 */
export function StepList({
	steps,
	sport,
	distanceUnits,
	onDistanceUnitChange,
	onUpdate,
	onRemove,
	onMove,
	onMoveItem,
	onDuplicate,
}: StepListProps) {
	// PointerSensor with a small activation distance so clicks on inputs/selects/
	// buttons inside a row are not swallowed; a drag only begins after a 6px move.
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			const { active, over } = event;
			if (!over) return;
			const activeId = String(active.id);
			const overId = String(over.id);
			if (activeId === overId) return;

			const from = parseDndId(activeId);
			const over2 = parseDndId(overId);
			if (!from?.loc || !over2) return;

			// Destination is either an item (over2.loc) or a bare container.
			let to: Loc;
			if (over2.loc) {
				to = over2.loc;
			} else if (over2.container === "root") {
				to = { kind: "root", index: steps.length };
			} else {
				// Dropped onto a group container → append to that group's end.
				const g = steps[over2.container];
				const len = g && isRepeatStep(g) ? g.steps.length : 0;
				to = { kind: "group", group: over2.container, index: len };
			}

			onMoveItem(from.loc, to);
		},
		[steps, onMoveItem],
	);

	// Root-level sortable ids, in order.
	const rootIds = steps.map((_, idx) => topId(idx));

	// Track global step numbering (flattened across repeat groups for display).
	let stepCounter = 0;

	return (
		<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
			<div className="space-y-0.5">
				<SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
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
									onMoveItem={onMoveItem}
								/>
							);
						}

						stepCounter++;
						const currentCounter = stepCounter;
						return (
							<SortableStep
								key={`step-${idx}`}
								id={topId(idx)}
								step={item}
								index={currentCounter}
								sport={sport}
								distanceUnit={distanceUnits[String(idx)] ?? "mi"}
								onDistanceUnitChange={(unit) => onDistanceUnitChange(String(idx), unit)}
								onChange={(updated) => onUpdate(idx, updated)}
								onRemove={() => onRemove(idx)}
								onMoveUp={
									idx > 0 ? () => onMoveItem({ kind: "root", index: idx }, { kind: "root", index: idx - 1 }) : undefined
								}
								onMoveDown={
									idx < steps.length - 1
										? () => onMoveItem({ kind: "root", index: idx }, { kind: "root", index: idx + 1 })
										: undefined
								}
								onDuplicate={() => onDuplicate(idx)}
							/>
						);
					})}
				</SortableContext>

				{steps.length === 0 && (
					<p className="py-8 text-center text-sm text-gray-500">No steps yet. Add a step below to get started.</p>
				)}
			</div>
		</DndContext>
	);
}
