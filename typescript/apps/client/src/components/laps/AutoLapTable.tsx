import { useState, useEffect, useRef } from "react";
import { AUTO_LAP_DISTANCES, METERS_PER_MILE, Sport, convertSecondsToHms, formatPacePrecise } from "@activity-calendar/shared";
import { useAutoLaps } from "../../api/queries.js";

type Unit = "mi" | "m";

interface Props {
	activityId: number;
	sport: string;
	onDistanceChange?: (distInMiles: number) => void;
}

/**
 * Displays auto-lap splits for an activity with a configurable distance input and unit toggle.
 */
export function AutoLapTable({ activityId, sport, onDistanceChange }: Props) {
	const [inputValue, setInputValue] = useState(1);
	const [unit, setUnit] = useState<Unit>("mi");
	const [debouncedValue, setDebouncedValue] = useState(inputValue);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		timerRef.current = setTimeout(() => setDebouncedValue(inputValue), 400);
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, [inputValue]);

	const distInMiles = unit === "mi" ? debouncedValue : debouncedValue / METERS_PER_MILE;

	// Notify parent when auto-lap distance changes (TODO #12)
	useEffect(() => {
		onDistanceChange?.(distInMiles);
	}, [distInMiles, onDistanceChange]);

	const { data: laps } = useAutoLaps(activityId, sport, distInMiles);
	const isCycling = sport === Sport.Cycling;

	return (
		<div>
			<div className="flex items-center gap-2 mb-3">
				<input
					type="number"
					min={0}
					step={unit === "mi" ? 0.1 : 100}
					value={inputValue}
					onChange={(e) => setInputValue(Number(e.target.value))}
					aria-label="Lap distance"
					className="w-20 rounded bg-gray-700 border border-gray-600 px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
				/>
				<div className="flex rounded overflow-hidden text-xs" role="group" aria-label="Distance unit">
					<button
						type="button"
						onClick={() => setUnit("mi")}
						className={`px-2 py-1 ${unit === "mi" ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
						aria-pressed={unit === "mi"}
					>
						mi
					</button>
					<button
						type="button"
						onClick={() => setUnit("m")}
						className={`px-2 py-1 ${unit === "m" ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
						aria-pressed={unit === "m"}
					>
						m
					</button>
				</div>
			</div>
			{laps && laps.length > 0 ? (
				<div className="overflow-x-auto">
					<table className="w-full text-sm text-left">
						<thead className="text-xs text-gray-400 border-b border-gray-700">
							<tr>
								<th className="px-2 py-1">Lap</th>
								<th className="px-2 py-1">Distance</th>
								<th className="px-2 py-1">Time</th>
								<th className="px-2 py-1">Cum. Dist</th>
								<th className="px-2 py-1">Cum. Time</th>
								<th className="px-2 py-1">{isCycling ? "Speed" : "Pace"}</th>
								<th className="px-2 py-1">Ascent</th>
								<th className="px-2 py-1">Descent</th>
								<th className="px-2 py-1">Cadence</th>
							</tr>
						</thead>
						<tbody>
							{laps.map((l) => (
								<tr key={l.lap} className="border-b border-gray-800 hover:bg-gray-800/50">
									<td className="px-2 py-1">{l.lap}</td>
									<td className="px-2 py-1">{l.distanceMi.toFixed(2)} mi</td>
									<td className="px-2 py-1">{convertSecondsToHms(l.timeSeconds)}</td>
									<td className="px-2 py-1">{l.cumulativeDistanceMi.toFixed(2)} mi</td>
									<td className="px-2 py-1">{convertSecondsToHms(l.cumulativeTimeSeconds)}</td>
									<td className="px-2 py-1">
										{isCycling ? `${l.speedMph?.toFixed(1)} mph` : `${formatPacePrecise(l.paceMinPerMile)} /mi`}
									</td>
									<td className="px-2 py-1">{Math.round(l.totalAscentFt)}</td>
									<td className="px-2 py-1">{Math.round(l.totalDescentFt)}</td>
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
