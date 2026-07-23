import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SwimLength } from "@activity-calendar/shared";
import { convertSecondsToHms } from "@activity-calendar/shared";
import { useLengths, queryKeys } from "../../api/queries.js";
import { useCombineLengths } from "../../api/mutations.js";

interface Props {
	activityId: number;
	poolLengthM?: number;
}

export function SwimLengthTable({ activityId, poolLengthM = 25 }: Props) {
	const { data: lengths } = useLengths(activityId);
	const combine = useCombineLengths(activityId);
	const [selected, setSelected] = useState<Set<number>>(new Set());

	if (!lengths?.length) return <p className="text-gray-400 text-sm">No swim lengths.</p>;

	function toggleSelect(id: number) {
		setSelected((prev) => {
			const next = new Set(prev);
			next.has(id) ? next.delete(id) : next.add(id);
			return next;
		});
	}

	function toggleAll() {
		setSelected((prev) => (prev.size === lengths!.length ? new Set() : new Set(lengths!.map((l) => l.lengthId))));
	}

	function handleCombine() {
		if (selected.size < 2) return;
		combine.mutate(Array.from(selected), { onSuccess: () => setSelected(new Set()) });
	}

	return (
		<div>
			{selected.size >= 2 && (
				<button onClick={handleCombine} disabled={combine.isPending} className="mb-2 rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500 disabled:opacity-40">
					Combine {selected.size} lengths
				</button>
			)}
			<div className="overflow-x-auto">
				<table className="w-full text-sm text-left">
					<thead className="text-xs text-gray-400 border-b border-gray-700">
						<tr>
							<th className="px-2 py-1"><input type="checkbox" onChange={toggleAll} checked={selected.size === lengths.length} /></th>
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
						{lengths.map((l, i) => {
							const time = l.totalTimerTime ?? 0;
							const dist = poolLengthM;
							const pace100 = dist > 0 && time > 0 ? time / (dist / 100) : null;
							const swolf = time > 0 && l.totalStrokes != null ? Math.round(time + l.totalStrokes) : null;

							return (
								<tr key={l.lengthId} className="border-b border-gray-800 hover:bg-gray-800/50">
									<td className="px-2 py-1"><input type="checkbox" checked={selected.has(l.lengthId)} onChange={() => toggleSelect(l.lengthId)} /></td>
									<td className="px-2 py-1">{i + 1}</td>
									<td className="px-2 py-1">{l.lengthType ?? "—"}</td>
									<td className="px-2 py-1">{dist}</td>
									<td className="px-2 py-1">{convertSecondsToHms(time) ?? "—"}</td>
									<td className="px-2 py-1">
										<input type="number" defaultValue={l.totalStrokes ?? ""} className="w-14 bg-transparent border-b border-gray-600 focus:border-blue-500 outline-none" />
									</td>
									<td className="px-2 py-1">
										<input type="text" defaultValue={l.swimStroke ?? ""} className="w-20 bg-transparent border-b border-gray-600 focus:border-blue-500 outline-none" />
									</td>
									<td className="px-2 py-1">{pace100 != null ? `${Math.floor(pace100 / 60)}:${String(Math.round(pace100 % 60)).padStart(2, "0")}` : "—"}</td>
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
