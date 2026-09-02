import { Intensity, METERS_PER_MILE, Sport, convertSecondsToHms, formatPacePrecise } from "@activity-calendar/shared";
import type { Lap } from "@activity-calendar/shared";

const INTENSITIES = Object.values(Intensity);

interface ColumnProps {
	name: string;
	color: string;
	sport: string;
	laps: Lap[];
	/** Shared intensity filter (empty = show all). */
	filter: Set<string>;
}

/** Compute the per-lap pace (running) or speed (cycling) label. */
function paceSpeedLabel(sport: string, distanceM: number, timeS: number): string {
	const miles = distanceM / METERS_PER_MILE;
	if (sport === Sport.Cycling) {
		return timeS > 0 ? `${(miles / (timeS / 3600)).toFixed(1)}` : "—";
	}
	const pace = miles > 0 ? timeS / 60 / miles : null;
	return formatPacePrecise(pace) ?? "—";
}

/** A single read-only lap table for one activity, styled like the details LapTable. */
function LapColumn({ name, color, sport, laps, filter }: ColumnProps) {
	const isCycling = sport === Sport.Cycling;
	const shown = filter.size ? laps.filter((l) => l.intensity != null && filter.has(l.intensity)) : laps;

	return (
		<div className="min-w-0">
			<div className="mb-2 flex items-center gap-2">
				<span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
				<h3 className="truncate text-sm font-medium text-gray-200" title={name}>
					{name}
				</h3>
			</div>
			{shown.length === 0 ? (
				<p className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-6 text-center text-sm text-gray-500">
					No laps to show.
				</p>
			) : (
				<div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
					<table className="w-full text-left text-sm">
						<thead className="bg-gray-800/50 text-xs font-medium uppercase tracking-wide text-gray-400">
							<tr>
								<th className="px-3 py-2">Lap</th>
								<th className="px-3 py-2">Dist (mi)</th>
								<th className="px-3 py-2">Time</th>
								<th className="px-3 py-2">{isCycling ? "mph" : "Pace"}</th>
								<th className="px-3 py-2">Intensity</th>
							</tr>
						</thead>
						<tbody>
							{shown.map((lap) => {
								const miles = (lap.totalDistance ?? 0) / METERS_PER_MILE;
								const time = lap.totalTimerTime ?? 0;
								return (
									<tr key={lap.lapId} className="border-t border-gray-800">
										<td className="px-3 py-2 text-gray-300">{lap.number}</td>
										<td className="px-3 py-2 text-gray-300 tabular-nums">{miles.toFixed(2)}</td>
										<td className="px-3 py-2 text-gray-400 tabular-nums">{convertSecondsToHms(time) ?? "—"}</td>
										<td className="px-3 py-2 text-gray-300 tabular-nums">
											{paceSpeedLabel(sport, lap.totalDistance ?? 0, time)}
										</td>
										<td className="px-3 py-2 capitalize text-gray-400">{lap.intensity ?? "—"}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

interface Props {
	nameA: string;
	nameB: string;
	colorA: string;
	colorB: string;
	sportA: string;
	sportB: string;
	lapsA: Lap[];
	lapsB: Lap[];
	filter: Set<string>;
	onToggleFilter: (intensity: string) => void;
	onClearFilter: () => void;
}

/**
 * Side-by-side read-only lap comparison for two activities. A single shared
 * Intensity pill filter (reusing the details LapTable's pill UX and the shared
 * Intensity enum) applies to BOTH columns simultaneously.
 */
export function LapComparison({
	nameA,
	nameB,
	colorA,
	colorB,
	sportA,
	sportB,
	lapsA,
	lapsB,
	filter,
	onToggleFilter,
	onClearFilter,
}: Props) {
	return (
		<div className="space-y-4">
			<div className="inline-flex rounded-lg border border-gray-700 bg-gray-800 p-0.5">
				<button
					type="button"
					onClick={onClearFilter}
					className={
						filter.size === 0
							? "rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white"
							: "rounded-md px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-200"
					}
				>
					All
				</button>
				{INTENSITIES.map((i) => (
					<button
						key={i}
						type="button"
						onClick={() => onToggleFilter(i)}
						className={`capitalize ${
							filter.has(i)
								? "rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white"
								: "rounded-md px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-200"
						}`}
					>
						{i}
					</button>
				))}
			</div>

			<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
				<LapColumn name={nameA} color={colorA} sport={sportA} laps={lapsA} filter={filter} />
				<LapColumn name={nameB} color={colorB} sport={sportB} laps={lapsB} filter={filter} />
			</div>
		</div>
	);
}
