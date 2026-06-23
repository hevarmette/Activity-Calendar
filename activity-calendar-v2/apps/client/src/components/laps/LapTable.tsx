import { useState } from "react";
import {
	METERS_PER_MILE,
	Intensity,
	Sport,
	formatPace,
	convertSecondsToHms,
} from "@activity-calendar/shared";
import type { Lap } from "@activity-calendar/shared";

export interface LapEdit {
	lapId: number;
	field: string;
	value: unknown;
}

interface Props {
	laps: Lap[];
	sport: string;
	onEdits: (edits: LapEdit[]) => void;
}

const INTENSITIES = Object.values(Intensity);

export function LapTable({ laps, sport, onEdits }: Props) {
	const [filter, setFilter] = useState<string | null>(null);
	const [edits, setEdits] = useState<Map<string, LapEdit>>(new Map());

	const filtered = filter ? laps.filter((l) => l.intensity === filter) : laps;
	const isCycling = sport === Sport.Cycling;

	function handleEdit(lapId: number, field: string, value: unknown) {
		const key = `${lapId}-${field}`;
		const updated = new Map(edits);
		updated.set(key, { lapId, field, value });
		setEdits(updated);
		onEdits(Array.from(updated.values()));
	}

	return (
		<div>
			<div className="inline-flex rounded-lg bg-gray-800 border border-gray-700 p-0.5 mb-4">
				<button
					onClick={() => setFilter(null)}
					className={filter === null ? "px-3 py-1.5 rounded-md text-xs font-medium text-white bg-orange-500" : "px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"}
				>
					All
				</button>
				{INTENSITIES.map((i) => (
					<button
						key={i}
						onClick={() => setFilter(i)}
						className={`capitalize ${filter === i ? "px-3 py-1.5 rounded-md text-xs font-medium text-white bg-orange-500" : "px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"}`}
					>
						{i}
					</button>
				))}
			</div>

			<div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
				<table className="w-full text-sm text-left">
					<thead className="bg-gray-800/50 text-xs font-medium text-gray-400 uppercase tracking-wide">
						<tr>
							<th className="px-4 py-3">Lap</th>
							<th className="px-4 py-3">Distance (mi)</th>
							<th className="px-4 py-3">Time</th>
							<th className="px-4 py-3">{isCycling ? "Speed (mph)" : "Pace"}</th>
							<th className="px-4 py-3">Avg HR</th>
							<th className="px-4 py-3">Max HR</th>
							<th className="px-4 py-3">Ascent</th>
							<th className="px-4 py-3">Intensity</th>
						</tr>
					</thead>
					<tbody>
						{filtered.map((lap) => {
							const miles = (lap.totalDistance ?? 0) / METERS_PER_MILE;
							const time = lap.totalTimerTime ?? 0;
							const paceVal = miles > 0 ? time / 60 / miles : null;
							const speedMph = time > 0 ? miles / (time / 3600) : null;

							return (
								<tr key={lap.lapId} className="border-t border-gray-800 hover:bg-gray-800/30 transition-colors">
									<td className="px-4 py-3 text-gray-300">{lap.number}</td>
									<td className="px-4 py-3 text-gray-300">
										<input
											type="number"
											step="0.01"
											defaultValue={miles.toFixed(2)}
											onBlur={(e) => handleEdit(lap.lapId, "totalDistance", Number(e.target.value) * METERS_PER_MILE)}
											className="w-20 bg-transparent border-b border-dashed border-gray-700 focus:border-orange-500 outline-none text-gray-200 tabular-nums"
										/>
									</td>
									<td className="px-4 py-3 text-gray-300">
										<input
											type="text"
											defaultValue={convertSecondsToHms(time) ?? ""}
											onBlur={(e) => {
												const parts = e.target.value.split(":").map(Number);
												const secs = parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! :
													parts.length === 2 ? parts[0]! * 60 + parts[1]! : parts[0] ?? 0;
												handleEdit(lap.lapId, "totalTimerTime", secs);
											}}
											className="w-24 bg-transparent border-b border-dashed border-gray-700 focus:border-orange-500 outline-none text-gray-200 tabular-nums"
										/>
									</td>
									<td className="px-4 py-3 text-gray-300">
										{isCycling ? (speedMph?.toFixed(1) ?? "—") : (formatPace(paceVal) ?? "—")}
									</td>
									<td className="px-4 py-3 text-gray-300">
										<input
											type="number"
											defaultValue={lap.avgHeartRate ?? ""}
											onBlur={(e) => handleEdit(lap.lapId, "avgHeartRate", Number(e.target.value))}
											className="w-14 bg-transparent border-b border-dashed border-gray-700 focus:border-orange-500 outline-none text-gray-200 tabular-nums"
										/>
									</td>
									<td className="px-4 py-3 text-gray-300">{lap.maxHeartRate ?? "—"}</td>
									<td className="px-4 py-3 text-gray-300">{lap.totalAscent ?? "—"}</td>
									<td className="px-4 py-3 text-gray-300">
										<select
											defaultValue={lap.intensity ?? ""}
											onChange={(e) => handleEdit(lap.lapId, "intensity", e.target.value)}
											className="rounded-lg bg-gray-800 border border-gray-700 text-xs px-2 py-1 text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500"
										>
											<option value="">—</option>
											{INTENSITIES.map((i) => (
												<option key={i} value={i}>{i}</option>
											))}
										</select>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>

			{filtered.length > 0 && (
				<IntervalSummary laps={filtered} sport={sport} />
			)}
		</div>
	);
}

function IntervalSummary({ laps, sport }: { laps: Lap[]; sport: string }) {
	const isCycling = sport === Sport.Cycling;
	const totalDist = laps.reduce((s, l) => s + (l.totalDistance ?? 0), 0);
	const totalTime = laps.reduce((s, l) => s + (l.totalTimerTime ?? 0), 0);
	const miles = totalDist / METERS_PER_MILE;
	const avgPace = miles > 0 ? totalTime / 60 / miles : null;
	const avgSpeed = totalTime > 0 ? miles / (totalTime / 3600) : null;
	const avgHr = laps.filter((l) => l.avgHeartRate).reduce((s, l, _, a) => s + (l.avgHeartRate ?? 0) / a.length, 0);

	return (
		<div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-5">
			<p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{laps.length} intervals</p>
			<div className="flex gap-4 text-sm text-gray-300">
				<span>Total: {miles.toFixed(2)} mi</span>
				<span>Time: {convertSecondsToHms(totalTime)}</span>
				{isCycling ? <span>Avg Speed: {avgSpeed?.toFixed(1)} mph</span> : <span>Avg Pace: {formatPace(avgPace)}</span>}
				{avgHr > 0 && <span>Avg HR: {Math.round(avgHr)}</span>}
			</div>
		</div>
	);
}
