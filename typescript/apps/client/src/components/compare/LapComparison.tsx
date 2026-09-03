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
	/**
	 * When provided, this column renders per-row split deltas relative to the
	 * lap at the SAME visible index in this array (already filtered upstream).
	 * Used only for column B so deltas read B − A, aligned row-for-row.
	 */
	deltaAgainst?: Lap[];
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

/** Apply the shared intensity filter to a lap list. */
function visibleLaps(laps: Lap[], filter: Set<string>): Lap[] {
	return filter.size ? laps.filter((l) => l.intensity != null && filter.has(l.intensity)) : laps;
}

/** Signed M:SS(.ss) time delta. Negative (faster) is green, positive (slower) red. */
function formatTimeDelta(deltaS: number): { text: string; className: string } | null {
	if (!Number.isFinite(deltaS) || Math.abs(deltaS) < 0.005) return null;
	const sign = deltaS < 0 ? "−" : "+";
	const abs = convertSecondsToHms(Math.abs(deltaS)) ?? "—";
	return { text: `${sign}${abs}`, className: deltaS < 0 ? "text-green-400" : "text-red-400" };
}

/** Signed distance delta in miles. Kept compact (2dp) and only shown when meaningful. */
function formatDistDelta(deltaMi: number): { text: string; className: string } | null {
	if (!Number.isFinite(deltaMi) || Math.abs(deltaMi) < 0.005) return null;
	const sign = deltaMi < 0 ? "−" : "+";
	// A longer split is neither "good" nor "bad" on its own, so distance deltas
	// stay neutral (subdued gray) rather than green/red.
	return { text: `${sign}${Math.abs(deltaMi).toFixed(2)}`, className: "text-gray-500" };
}

/**
 * Signed pace/speed delta. For pace-based sports, faster = smaller pace = green;
 * for speed-based (cycling), faster = higher mph = green. Returns a formatted,
 * color-coded label matching the column's unit.
 */
function formatPaceSpeedDelta(sport: string, distA: number, timeA: number, distB: number, timeB: number) {
	const isCycling = sport === Sport.Cycling;
	const milesA = distA / METERS_PER_MILE;
	const milesB = distB / METERS_PER_MILE;
	if (isCycling) {
		const speedA = timeA > 0 ? milesA / (timeA / 3600) : null;
		const speedB = timeB > 0 ? milesB / (timeB / 3600) : null;
		if (speedA == null || speedB == null) return null;
		const delta = speedB - speedA; // higher mph = faster
		if (Math.abs(delta) < 0.05) return null;
		const sign = delta < 0 ? "−" : "+";
		return { text: `${sign}${Math.abs(delta).toFixed(1)}`, className: delta > 0 ? "text-green-400" : "text-red-400" };
	}
	const paceA = milesA > 0 && timeA > 0 ? timeA / 60 / milesA : null;
	const paceB = milesB > 0 && timeB > 0 ? timeB / 60 / milesB : null;
	if (paceA == null || paceB == null) return null;
	const deltaMin = paceB - paceA; // lower pace = faster
	const deltaS = deltaMin * 60;
	if (Math.abs(deltaS) < 0.05) return null;
	const sign = deltaS < 0 ? "−" : "+";
	const abs = formatPacePrecise(Math.abs(deltaMin)) ?? "—";
	return { text: `${sign}${abs}`, className: deltaS < 0 ? "text-green-400" : "text-red-400" };
}

/** A single read-only lap table for one activity, styled like the details LapTable. */
function LapColumn({ name, color, sport, laps, filter, deltaAgainst }: ColumnProps) {
	const isCycling = sport === Sport.Cycling;
	const shown = visibleLaps(laps, filter);

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
							{shown.map((lap, i) => {
								const miles = (lap.totalDistance ?? 0) / METERS_PER_MILE;
								const time = lap.totalTimerTime ?? 0;
								// Pair with the lap at the SAME visible index in the other activity.
								const other = deltaAgainst?.[i];
								const distDelta =
									other != null ? formatDistDelta(miles - (other.totalDistance ?? 0) / METERS_PER_MILE) : null;
								const timeDelta = other != null ? formatTimeDelta(time - (other.totalTimerTime ?? 0)) : null;
								const paceDelta =
									other != null
										? formatPaceSpeedDelta(
												sport,
												other.totalDistance ?? 0,
												other.totalTimerTime ?? 0,
												lap.totalDistance ?? 0,
												time,
											)
										: null;
								// Only render the "vs same-index" em dash when a pairing exists
								// but the values are effectively equal — not when there's no
								// paired lap at all (columns of differing length).
								const hasPair = deltaAgainst != null && other != null;
								return (
									<tr key={lap.lapId} className="border-t border-gray-800">
										<td className="px-3 py-2 text-gray-300">{lap.number}</td>
										<td className="px-3 py-2 text-gray-300 tabular-nums">
											{miles.toFixed(2)}
											{deltaAgainst != null && (
												<span className={`ml-1.5 text-xs tabular-nums ${distDelta?.className ?? "text-gray-600"}`}>
													{distDelta ? distDelta.text : hasPair ? "—" : ""}
												</span>
											)}
										</td>
										<td className="px-3 py-2 text-gray-400 tabular-nums">
											{convertSecondsToHms(time) ?? "—"}
											{deltaAgainst != null && (
												<span className={`ml-1.5 text-xs tabular-nums ${timeDelta?.className ?? "text-gray-600"}`}>
													{timeDelta ? timeDelta.text : hasPair ? "—" : ""}
												</span>
											)}
										</td>
										<td className="px-3 py-2 text-gray-300 tabular-nums">
											{paceSpeedLabel(sport, lap.totalDistance ?? 0, time)}
											{deltaAgainst != null && (
												<span className={`ml-1.5 text-xs tabular-nums ${paceDelta?.className ?? "text-gray-600"}`}>
													{paceDelta ? paceDelta.text : hasPair ? "—" : ""}
												</span>
											)}
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
 *
 * Column B additionally shows per-row split DELTAS (B − A) for Dist, Time, and
 * Pace/Speed, aligned by VISIBLE lap index: the i-th shown lap of B is compared
 * against the i-th shown lap of A after the shared filter is applied. Faster
 * (lower time / pace, higher speed) reads green; slower reads red. Distance
 * deltas stay neutral. Where B has more visible laps than A (no pair at that
 * index), the delta shows "—".
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
	// Pre-filter A so column B can pair against the same VISIBLE index.
	const shownA = filter.size ? lapsA.filter((l) => l.intensity != null && filter.has(l.intensity)) : lapsA;

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
				<LapColumn name={nameB} color={colorB} sport={sportB} laps={lapsB} filter={filter} deltaAgainst={shownA} />
			</div>
			<p className="text-xs text-gray-500">
				Deltas on {nameB} compare each lap to the same-position lap on {nameA} —{" "}
				<span className="text-green-400">green</span> is faster, <span className="text-red-400">red</span> is slower.
			</p>
		</div>
	);
}
