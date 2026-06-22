import { useState } from "react";
import {
	AUTO_LAP_DISTANCES,
	Sport,
	convertSecondsToHms,
	formatPace,
} from "@activity-calendar/shared";
import { useAutoLaps } from "../../api/queries.js";

interface Props {
	activityId: number;
	sport: string;
}

export function AutoLapTable({ activityId, sport }: Props) {
	const distances = [0.5, 1, 2, 5];
	const defaultDist = AUTO_LAP_DISTANCES[sport] ?? AUTO_LAP_DISTANCES["default"]!;
	const [dist, setDist] = useState(defaultDist);
	const { data: laps } = useAutoLaps(activityId, sport, dist);
	const isCycling = sport === Sport.Cycling;

	return (
		<div>
			<div className="flex gap-1 mb-3">
				{distances.map((d) => (
					<button key={d} onClick={() => setDist(d)} className={`rounded px-2 py-1 text-xs ${dist === d ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600"}`}>
						{d} mi
					</button>
				))}
			</div>
			{laps && laps.length > 0 ? (
				<div className="overflow-x-auto">
					<table className="w-full text-sm text-left">
						<thead className="text-xs text-gray-400 border-b border-gray-700">
							<tr>
								<th className="px-2 py-1">Lap</th>
								<th className="px-2 py-1">Time</th>
								<th className="px-2 py-1">Distance</th>
								<th className="px-2 py-1">{isCycling ? "Speed" : "Pace"}</th>
								<th className="px-2 py-1">Cum. Time</th>
								<th className="px-2 py-1">Ascent</th>
								<th className="px-2 py-1">Descent</th>
								<th className="px-2 py-1">Avg HR</th>
								<th className="px-2 py-1">Max HR</th>
								<th className="px-2 py-1">Avg Cad</th>
							</tr>
						</thead>
						<tbody>
							{laps.map((l) => (
								<tr key={l.lap} className="border-b border-gray-800 hover:bg-gray-800/50">
									<td className="px-2 py-1">{l.lap}</td>
									<td className="px-2 py-1">{convertSecondsToHms(l.timeSeconds)}</td>
									<td className="px-2 py-1">{l.distanceMi.toFixed(2)} mi</td>
									<td className="px-2 py-1">{isCycling ? `${l.speedMph?.toFixed(1)} mph` : `${formatPace(l.paceMinPerMile)} /mi`}</td>
									<td className="px-2 py-1">{convertSecondsToHms(l.cumulativeTimeSeconds)}</td>
									<td className="px-2 py-1">{Math.round(l.totalAscentFt)}</td>
									<td className="px-2 py-1">{Math.round(l.totalDescentFt)}</td>
									<td className="px-2 py-1">{l.avgHr ?? "—"}</td>
									<td className="px-2 py-1">{l.maxHr ?? "—"}</td>
									<td className="px-2 py-1">{l.avgCadence ?? "—"}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<p className="text-gray-400 text-sm">No auto-lap data.</p>
			)}
		</div>
	);
}
