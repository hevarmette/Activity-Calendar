import { Sport, convertSecondsToHms, formatPacePrecise } from "@activity-calendar/shared";
import { Link } from "react-router";
import type { AutoLap } from "../../api/queries.js";

interface ColumnProps {
	/** Activity id — links the column header to the detail page. */
	id: number;
	name: string;
	color: string;
	sport: string;
	laps: AutoLap[];
	/**
	 * Secondary schema this activity lives in, or `undefined` for primary. When
	 * set, the header renders as plain text (the detail route is primary-only).
	 */
	schema?: string;
	/**
	 * When provided, this column renders per-row split deltas relative to the
	 * auto-lap at the SAME visible index in this array. Passed to non-baseline
	 * columns so deltas read column − baseline, row-for-row (mirrors LapComparison).
	 */
	deltaAgainst?: AutoLap[];
}

/** Per-lap pace (running) or speed (cycling) label from AutoLap fields. */
function paceSpeedLabel(sport: string, lap: AutoLap): string {
	if (sport === Sport.Cycling) {
		return lap.speedMph != null ? lap.speedMph.toFixed(1) : "—";
	}
	return formatPacePrecise(lap.paceMinPerMile) ?? "—";
}

/** Signed M:SS(.ss) time delta. Negative (faster) is green, positive (slower) red. */
function formatTimeDelta(deltaS: number): { text: string; className: string } | null {
	if (!Number.isFinite(deltaS) || Math.abs(deltaS) < 0.005) return null;
	const sign = deltaS < 0 ? "−" : "+";
	const abs = convertSecondsToHms(Math.abs(deltaS)) ?? "—";
	return { text: `${sign}${abs}`, className: deltaS < 0 ? "text-green-400" : "text-red-400" };
}

/** Signed distance delta in miles. Neutral (gray) — longer is neither good nor bad. */
function formatDistDelta(deltaMi: number): { text: string; className: string } | null {
	if (!Number.isFinite(deltaMi) || Math.abs(deltaMi) < 0.005) return null;
	const sign = deltaMi < 0 ? "−" : "+";
	return { text: `${sign}${Math.abs(deltaMi).toFixed(2)}`, className: "text-gray-500" };
}

/**
 * Signed pace/speed delta between two auto-laps. For pace sports, faster = lower
 * pace = green; for cycling, faster = higher mph = green. Adapted from
 * LapComparison.formatPaceSpeedDelta but reads the precomputed AutoLap
 * pace/speed fields directly (distanceMi/timeSeconds are already normalized).
 */
function formatPaceSpeedDelta(sport: string, a: AutoLap, b: AutoLap) {
	if (sport === Sport.Cycling) {
		if (a.speedMph == null || b.speedMph == null) return null;
		const delta = b.speedMph - a.speedMph; // higher mph = faster
		if (Math.abs(delta) < 0.05) return null;
		const sign = delta < 0 ? "−" : "+";
		return { text: `${sign}${Math.abs(delta).toFixed(1)}`, className: delta > 0 ? "text-green-400" : "text-red-400" };
	}
	if (a.paceMinPerMile == null || b.paceMinPerMile == null) return null;
	const deltaMin = b.paceMinPerMile - a.paceMinPerMile; // lower pace = faster
	const deltaS = deltaMin * 60;
	if (Math.abs(deltaS) < 0.05) return null;
	const sign = deltaS < 0 ? "−" : "+";
	const abs = formatPacePrecise(Math.abs(deltaMin)) ?? "—";
	return { text: `${sign}${abs}`, className: deltaS < 0 ? "text-green-400" : "text-red-400" };
}

/** A single read-only auto-lap table for one activity (no intensity column). */
function AutoLapColumn({ id, name, color, sport, laps, schema, deltaAgainst }: ColumnProps) {
	const isCycling = sport === Sport.Cycling;

	return (
		<div className="min-w-0">
			<div className="mb-2 flex items-center gap-2">
				<span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
				{/*
				 * Primary-schema columns link to the detail page; secondary-schema
				 * columns render plain text (the detail route is primary-only, so a
				 * cross-schema deep link would not resolve).
				 */}
				{schema == null ? (
					<Link
						to={`/activity/${id}?sport=${sport}`}
						className="truncate text-sm font-medium text-gray-200 transition-colors hover:text-orange-300"
						title={name}
					>
						{name}
					</Link>
				) : (
					<span className="truncate text-sm font-medium text-gray-200" title={`${name} (${schema})`}>
						{name}
						<span className="ml-1 text-xs font-normal text-gray-500">({schema})</span>
					</span>
				)}
			</div>
			{laps.length === 0 ? (
				<p className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-6 text-center text-sm text-gray-500">
					No auto-laps to show.
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
							</tr>
						</thead>
						<tbody>
							{laps.map((lap, i) => {
								// Pair with the auto-lap at the SAME visible index in the other activity.
								const other = deltaAgainst?.[i];
								const distDelta = other != null ? formatDistDelta(lap.distanceMi - other.distanceMi) : null;
								const timeDelta = other != null ? formatTimeDelta(lap.timeSeconds - other.timeSeconds) : null;
								const paceDelta = other != null ? formatPaceSpeedDelta(sport, other, lap) : null;
								// Show an em dash only when a pairing exists but values are equal —
								// not when there's no paired lap at that index at all.
								const hasPair = deltaAgainst != null && other != null;
								return (
									<tr key={lap.lap} className="border-t border-gray-800">
										<td className="px-3 py-2 text-gray-300">{lap.lap}</td>
										<td className="px-3 py-2 text-gray-300 tabular-nums">
											{lap.distanceMi.toFixed(2)}
											{deltaAgainst != null && (
												<span className={`ml-1.5 text-xs tabular-nums ${distDelta?.className ?? "text-gray-600"}`}>
													{distDelta ? distDelta.text : hasPair ? "—" : ""}
												</span>
											)}
										</td>
										<td className="px-3 py-2 text-gray-400 tabular-nums">
											{convertSecondsToHms(lap.timeSeconds) ?? "—"}
											{deltaAgainst != null && (
												<span className={`ml-1.5 text-xs tabular-nums ${timeDelta?.className ?? "text-gray-600"}`}>
													{timeDelta ? timeDelta.text : hasPair ? "—" : ""}
												</span>
											)}
										</td>
										<td className="px-3 py-2 text-gray-300 tabular-nums">
											{paceSpeedLabel(sport, lap)}
											{deltaAgainst != null && (
												<span className={`ml-1.5 text-xs tabular-nums ${paceDelta?.className ?? "text-gray-600"}`}>
													{paceDelta ? paceDelta.text : hasPair ? "—" : ""}
												</span>
											)}
										</td>
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

/** One activity column for {@link AutoLapComparison}. */
export interface AutoLapColumnData {
	id: number;
	name: string;
	color: string;
	sport: string;
	laps: AutoLap[];
	/** Secondary schema, or `undefined` for the primary schema. */
	schema?: string;
}

interface Props {
	columns: AutoLapColumnData[];
}

/**
 * Side-by-side read-only AUTO-lap comparison for N activities.
 *
 * Auto-laps are computed server-side at a shared distance interval (the parent
 * page owns that single distance control and passes each activity's results
 * in). Unlike regular laps, auto-laps have no intensity, so this mode drops the
 * intensity filter/column entirely.
 *
 * Column 0 is the delta baseline. Every other column shows per-row split DELTAS
 * (column − baseline) for Dist, Time, and Pace/Speed, aligned by VISIBLE lap
 * index — the i-th auto-lap of the column is compared against the i-th auto-lap
 * of the baseline. Faster (lower time/pace, higher speed) reads green; slower
 * reads red; distance deltas stay neutral. Where a column has more laps than the
 * baseline, the delta shows "—". This mirrors LapComparison's visual language.
 */
export function AutoLapComparison({ columns }: Props) {
	const baseline = columns[0];
	const baselineLaps = baseline?.laps ?? [];
	const baselineName = baseline?.name ?? "baseline";

	const gridCols =
		columns.length <= 1
			? "grid-cols-1"
			: columns.length === 2
				? "grid-cols-1 md:grid-cols-2"
				: columns.length === 3
					? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
					: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4";

	return (
		<div className="space-y-4">
			<div className={`grid gap-4 ${gridCols}`}>
				{columns.map((col, index) => (
					<AutoLapColumn
						key={`${col.schema ?? ""}:${col.id}:${index}`}
						id={col.id}
						name={col.name}
						color={col.color}
						sport={col.sport}
						laps={col.laps}
						schema={col.schema}
						deltaAgainst={index === 0 ? undefined : baselineLaps}
					/>
				))}
			</div>
			{columns.length > 1 && (
				<p className="text-xs text-gray-500">
					Deltas compare each auto-lap to the same-position auto-lap on {baselineName} (baseline) —{" "}
					<span className="text-green-400">green</span> is faster, <span className="text-red-400">red</span> is slower.
				</p>
			)}
		</div>
	);
}
