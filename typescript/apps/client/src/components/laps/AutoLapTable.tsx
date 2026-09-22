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
	// Raw string so the field can be cleared mid-edit without collapsing to 0.
	const [inputValue, setInputValue] = useState("1");
	const [unit, setUnit] = useState<Unit>("mi");
	const [debouncedValue, setDebouncedValue] = useState(1);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		// Only propagate a valid, positive distance; ignore empty/0/NaN so we never
		// feed a zero divisor into the split calculation (division by zero).
		const parsed = Number(inputValue);
		if (!Number.isFinite(parsed) || parsed <= 0) return;
		timerRef.current = setTimeout(() => setDebouncedValue(parsed), 400);
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
					onChange={(e) => setInputValue(e.target.value)}
					aria-label="Lap distance"
					className="w-20 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500"
				/>
				<div className="flex rounded overflow-hidden text-xs" role="group" aria-label="Distance unit">
					<button
						type="button"
						onClick={() => setUnit("mi")}
						className={`px-2 py-1 ${unit === "mi" ? "bg-orange-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
						aria-pressed={unit === "mi"}
					>
						mi
					</button>
					<button
						type="button"
						onClick={() => setUnit("m")}
						className={`px-2 py-1 ${unit === "m" ? "bg-orange-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
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
								<th className="px-2 py-1">Cum. Pace</th>
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
									<td className="px-2 py-1">
										{/* Cumulative pace/speed derived from cumulative distance + time */}
										{isCycling
											? `${(l.cumulativeTimeSeconds > 0 ? l.cumulativeDistanceMi / (l.cumulativeTimeSeconds / 3600) : null)?.toFixed(1) ?? "—"} mph`
											: `${formatPacePrecise(l.cumulativeDistanceMi > 0 ? l.cumulativeTimeSeconds / 60 / l.cumulativeDistanceMi : null) ?? "—"} /mi`}
									</td>
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
