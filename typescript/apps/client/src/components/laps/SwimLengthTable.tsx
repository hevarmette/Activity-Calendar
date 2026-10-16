import type { SwimLength } from "@activity-calendar/shared";
import { convertSecondsToHms } from "@activity-calendar/shared";
import { useEffect, useMemo, useState } from "react";
import { useLengths } from "../../api/queries.js";

/**
 * Staged swim-length edits, lifted to the parent page and flushed on Save.
 *
 * - `combines`: each entry is a group of length ids to merge into one. The
 *   server keeps the length with the lowest message_index and sums time +
 *   strokes across the group.
 * - `fieldEdits`: per-length stroke-count / stroke-type overrides, keyed by the
 *   surviving length id (PATCH /api/lengths/:id).
 */
export interface SwimLengthEdits {
	combines: number[][];
	fieldEdits: Map<number, { totalStrokes?: number; swimStroke?: string }>;
}

interface Props {
	activityId: number;
	poolLengthM?: number;
	/** Reports staged edits up to the page so they persist with the Save button. */
	onEdits?: (edits: SwimLengthEdits) => void;
}

/** A row in the derived preview: one original length, or a merged group. */
interface PreviewRow {
	/** Surviving length id (lowest message_index of the group). */
	lengthId: number;
	messageIndex: number;
	/** Ids merged into this row (length >= 2 when merged, else [lengthId]). */
	memberIds: number[];
	totalTimerTime: number;
	totalStrokes: number | null;
	swimStroke: string | null;
	lengthType: string | null;
}

/**
 * Build the preview rows from server lengths + staged combine groups. Rows in a
 * combine group collapse into the member with the lowest message_index; its
 * time and strokes become the group sum. Field edits are applied on top.
 */
function buildPreview(
	lengths: SwimLength[],
	combines: number[][],
	fieldEdits: SwimLengthEdits["fieldEdits"],
): PreviewRow[] {
	// Map each length id -> the combine group it belongs to (if any).
	const groupByMember = new Map<number, number[]>();
	for (const group of combines) {
		for (const id of group) groupByMember.set(id, group);
	}

	const byId = new Map(lengths.map((l) => [l.lengthId, l] as const));
	const rows: PreviewRow[] = [];
	const consumed = new Set<number>();

	for (const l of lengths) {
		if (consumed.has(l.lengthId)) continue;
		const group = groupByMember.get(l.lengthId);

		if (group) {
			// Resolve group members to actual lengths, pick the survivor (lowest
			// message_index), and sum the mergeable fields.
			const members = group
				.map((id) => byId.get(id))
				.filter((m): m is SwimLength => m != null)
				.sort((a, b) => a.messageIndex - b.messageIndex);
			for (const m of members) consumed.add(m.lengthId);
			const survivor = members[0];
			if (!survivor) continue;
			const sumTime = members.reduce((acc, m) => acc + (m.totalTimerTime ?? 0), 0);
			const strokeVals = members.map((m) => m.totalStrokes).filter((s): s is number => s != null);
			const sumStrokes = strokeVals.length > 0 ? strokeVals.reduce((a, b) => a + b, 0) : null;
			rows.push({
				lengthId: survivor.lengthId,
				messageIndex: survivor.messageIndex,
				memberIds: members.map((m) => m.lengthId),
				totalTimerTime: sumTime,
				totalStrokes: sumStrokes,
				swimStroke: survivor.swimStroke,
				lengthType: survivor.lengthType,
			});
		} else {
			rows.push({
				lengthId: l.lengthId,
				messageIndex: l.messageIndex,
				memberIds: [l.lengthId],
				totalTimerTime: l.totalTimerTime ?? 0,
				totalStrokes: l.totalStrokes,
				swimStroke: l.swimStroke,
				lengthType: l.lengthType,
			});
		}
	}

	// Apply per-row field edits (stroke count / stroke type).
	for (const row of rows) {
		const edit = fieldEdits.get(row.lengthId);
		if (!edit) continue;
		if (edit.totalStrokes !== undefined) row.totalStrokes = edit.totalStrokes;
		if (edit.swimStroke !== undefined) row.swimStroke = edit.swimStroke;
	}

	rows.sort((a, b) => a.messageIndex - b.messageIndex);
	return rows;
}

export function SwimLengthTable({ activityId, poolLengthM = 25, onEdits }: Props) {
	const { data: lengths } = useLengths(activityId);
	const [selected, setSelected] = useState<Set<number>>(new Set());
	const [combines, setCombines] = useState<number[][]>([]);
	const [fieldEdits, setFieldEdits] = useState<SwimLengthEdits["fieldEdits"]>(new Map());

	// Reset all staged state when switching to a different activity.
	// biome-ignore lint/correctness/useExhaustiveDependencies: staged edits must reset per activity.
	useEffect(() => {
		setSelected(new Set());
		setCombines([]);
		setFieldEdits(new Map());
	}, [activityId]);

	// Report staged edits up whenever they change so the page's Save can flush them.
	useEffect(() => {
		onEdits?.({ combines, fieldEdits });
	}, [combines, fieldEdits, onEdits]);

	const preview = useMemo(
		() => (lengths ? buildPreview(lengths, combines, fieldEdits) : []),
		[lengths, combines, fieldEdits],
	);

	if (!lengths?.length) return <p className="text-gray-400 text-sm">No swim lengths.</p>;

	function toggleSelect(id: number) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function toggleAll() {
		setSelected((prev) => (prev.size === preview.length ? new Set() : new Set(preview.map((r) => r.lengthId))));
	}

	/** Stage a merge of the selected rows (and any rows they were already merged with). */
	function handleCombine() {
		if (selected.size < 2) return;
		// Expand each selected preview-row to its underlying member ids so merging
		// an already-merged row folds its members into the new group.
		const memberMap = new Map(preview.map((r) => [r.lengthId, r.memberIds] as const));
		const groupIds = new Set<number>();
		for (const id of selected) {
			for (const member of memberMap.get(id) ?? [id]) groupIds.add(member);
		}
		const newGroup = Array.from(groupIds);
		// Drop any existing combine groups that overlap the new one, then add it.
		setCombines((prev) => [...prev.filter((g) => !g.some((id) => groupIds.has(id))), newGroup]);
		setSelected(new Set());
	}

	function setRowStrokes(lengthId: number, value: string) {
		const parsed = value.trim() === "" ? undefined : Number(value);
		setFieldEdits((prev) => {
			const next = new Map(prev);
			const cur = { ...next.get(lengthId) };
			if (parsed === undefined || Number.isNaN(parsed)) {
				const { totalStrokes: _omit, ...rest } = cur;
				next.set(lengthId, rest);
			} else {
				next.set(lengthId, { ...cur, totalStrokes: parsed });
			}
			return next;
		});
	}

	function setRowStroke(lengthId: number, value: string) {
		setFieldEdits((prev) => {
			const next = new Map(prev);
			const cur = { ...next.get(lengthId) };
			cur.swimStroke = value;
			next.set(lengthId, cur);
			return next;
		});
	}

	return (
		<div>
			{selected.size >= 2 && (
				<button
					type="button"
					onClick={handleCombine}
					className="mb-2 rounded bg-orange-600 px-3 py-1 text-sm text-white hover:bg-orange-500"
				>
					Combine {selected.size} lengths
				</button>
			)}
			<div className="overflow-x-auto">
				<table className="w-full text-sm text-left">
					<thead className="text-xs text-gray-400 border-b border-gray-700">
						<tr>
							<th className="px-2 py-1">
								<input
									type="checkbox"
									aria-label="Select all lengths"
									onChange={toggleAll}
									checked={selected.size === preview.length && preview.length > 0}
								/>
							</th>
							<th className="px-2 py-1">#</th>
							<th className="px-2 py-1">Type</th>
							<th className="px-2 py-1">Dist(m)</th>
							<th className="px-2 py-1">Time</th>
							<th className="px-2 py-1">Strokes</th>
							<th className="px-2 py-1">Stroke</th>
							<th className="px-2 py-1">Pace/100m</th>
							<th className="px-2 py-1">SWOLF</th>
						</tr>
					</thead>
					<tbody>
						{preview.map((r, i) => {
							const time = r.totalTimerTime;
							// Distance = one pool length per merged member (intended behavior).
							const dist = poolLengthM * r.memberIds.length;
							const pace100 = dist > 0 && time > 0 ? time / (dist / 100) : null;
							const swolf = time > 0 && r.totalStrokes != null ? Math.round(time + r.totalStrokes) : null;
							const isMerged = r.memberIds.length > 1;

							return (
								<tr
									key={r.lengthId}
									className={`border-b border-gray-800 hover:bg-gray-800/50 ${isMerged ? "bg-orange-950/20" : ""}`}
								>
									<td className="px-2 py-1">
										<input
											type="checkbox"
											aria-label={`Select length ${i + 1}`}
											checked={selected.has(r.lengthId)}
											onChange={() => toggleSelect(r.lengthId)}
										/>
									</td>
									<td className="px-2 py-1">
										{i + 1}
										{isMerged && (
											<span className="ml-1 text-xs text-orange-400" title={`Merged ${r.memberIds.length} lengths`}>
												(×{r.memberIds.length})
											</span>
										)}
									</td>
									<td className="px-2 py-1">{r.lengthType ?? "—"}</td>
									<td className="px-2 py-1">{dist}</td>
									<td className="px-2 py-1">{convertSecondsToHms(time) ?? "—"}</td>
									<td className="px-2 py-1">
										<input
											type="number"
											value={r.totalStrokes ?? ""}
											onChange={(e) => setRowStrokes(r.lengthId, e.target.value)}
											className="w-14 bg-transparent border-b border-gray-600 focus:border-orange-500 outline-none"
											aria-label={`Strokes for length ${i + 1}`}
										/>
									</td>
									<td className="px-2 py-1">
										<input
											type="text"
											value={r.swimStroke ?? ""}
											onChange={(e) => setRowStroke(r.lengthId, e.target.value)}
											className="w-20 bg-transparent border-b border-gray-600 focus:border-orange-500 outline-none"
											aria-label={`Stroke type for length ${i + 1}`}
										/>
									</td>
									<td className="px-2 py-1">
										{pace100 != null
											? `${Math.floor(pace100 / 60)}:${String(Math.round(pace100 % 60)).padStart(2, "0")}`
											: "—"}
									</td>
									<td className="px-2 py-1">{swolf ?? "—"}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
