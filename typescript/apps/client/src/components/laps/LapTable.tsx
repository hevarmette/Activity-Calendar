import { useState, useMemo, useEffect, useCallback } from "react";
import {
	METERS_PER_MILE,
	Intensity,
	Sport,
	TRACK_DISTANCES,
	formatPacePrecise,
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
	category: string;
	onEdits: (edits: LapEdit[]) => void;
}

interface IntervalSet {
	count: number;
	label: string;
	avgDuration: string | null;
	avgPaceLabel: string;
	fastestSplit: string | null;
	fastestLap: number;
	avgHr: number | null;
	firstLap: number;
	avgDistLabel: string;
	meanDist: number;
	farthestSplit: string;
	farthestLap: number;
	timeDevTrend: string | null;
	distDevTrend: string | null;
	timeDevTrendValue: number | null;
	distDevTrendValue: number | null;
}

const INTENSITIES = Object.values(Intensity);

function scalingTolerance(distMi: number): number {
	return Math.max(0.02, 0.1 * (0.0621 / distMi));
}

function distanceLabel(meanDistMi: number): string {
	const tol = scalingTolerance(meanDistMi);
	for (const [ref, label] of TRACK_DISTANCES) {
		if (Math.abs(meanDistMi - ref) / ref <= tol) return label;
	}
	return `${meanDistMi.toFixed(2)} mi`;
}

function timeLabel(meanSecs: number): string {
	const total = Math.round(meanSecs);
	const m = Math.floor(total / 60);
	const s = total % 60;
	return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
}

/**
 * Compute the median of a numeric array.
 */
function median(arr: number[]): number {
	const sorted = [...arr].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Format a deviation trend value as a signed string with 2 decimal places.
 */
function formatDevTrend(value: number, mode: "time" | "dist"): string {
	const sign = value < 0 ? "-" : "+";
	const absVal = Math.abs(value);
	if (mode === "time") {
		const totalSec = absVal;
		const m = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		return `${sign}${m}:${s.toFixed(2).padStart(5, "0")}`;
	}
	return `${sign}${absVal.toFixed(2)}`;
}

/**
 * Groups active laps by similar distance or time and returns per-set stats.
 *
 * From the original Streamlit lap_processing.py (compute_interval_summary):
 * - Only sets with >= 2 reps are included. Results are sorted by workout order.
 * - Clustering uses a scaling tolerance that starts at 10% for 100m intervals
 *   and shrinks proportionally with distance.
 * - Deviation trend: each rep's deviation from the median is computed, then
 *   last deviation minus first deviation (by lap order) shows positive/negative split drift.
 * - The default grouping mode (distance vs time) is auto-detected by comparing
 *   the coefficient of variation (CV) of distances vs times — whichever is more
 *   consistent (lower CV) becomes the grouping axis.
 */
function computeIntervalSummary(laps: Lap[], sport: string, groupBy: "distance" | "time"): IntervalSet[] {
	const active = laps.filter(
		(l) => l.intensity === Intensity.Active && (l.totalDistance ?? 0) > 0 && (l.totalTimerTime ?? 0) > 0,
	);
	if (active.length < 2) return [];

	const withMetrics = active.map((l) => ({
		lap: l,
		dist: (l.totalDistance ?? 0) / METERS_PER_MILE,
		secs: l.totalTimerTime ?? 0,
	}));

	const sorted = [...withMetrics].sort((a, b) => (groupBy === "time" ? a.secs - b.secs : a.dist - b.dist));

	// Cluster
	const groups: (typeof sorted)[] = [];
	let current = [sorted[0]!];
	for (let i = 1; i < sorted.length; i++) {
		const val = groupBy === "time" ? sorted[i]!.secs : sorted[i]!.dist;
		const meanVal = current.reduce((s, c) => s + (groupBy === "time" ? c.secs : c.dist), 0) / current.length;
		const tol = groupBy === "time" ? Math.max(0.05, 0.15 * (15 / meanVal)) : scalingTolerance(meanVal);
		if (Math.abs(val - meanVal) / meanVal <= tol) {
			current.push(sorted[i]!);
		} else {
			groups.push(current);
			current = [sorted[i]!];
		}
	}
	groups.push(current);

	const isCycling = sport === Sport.Cycling;
	const results: IntervalSet[] = [];

	for (const group of groups) {
		if (group.length < 2) continue;
		const meanDist = group.reduce((s, g) => s + g.dist, 0) / group.length;
		const avgSecs = group.reduce((s, g) => s + g.secs, 0) / group.length;
		const label = groupBy === "time" ? timeLabel(avgSecs) : distanceLabel(meanDist);

		const fastestSecs = Math.min(...group.map((g) => g.secs));
		const fastestItem = group.find((g) => g.secs === fastestSecs)!;
		const fastestLap = fastestItem.lap.number;

		const farthestDist = Math.max(...group.map((g) => g.dist));
		const farthestItem = group.find((g) => g.dist === farthestDist)!;
		const farthestSplit = `${farthestDist.toFixed(2)} mi`;
		const farthestLap = farthestItem.lap.number;

		let avgPaceLabel: string;
		if (isCycling) {
			const avgSpeed = meanDist / (avgSecs / 3600);
			avgPaceLabel = `${avgSpeed.toFixed(2)} mph`;
		} else {
			const pace = avgSecs / 60 / meanDist;
			avgPaceLabel = `${formatPacePrecise(pace) ?? "—"} /mi`;
		}

		const hrs = group.map((g) => g.lap.avgHeartRate).filter((h): h is number => h != null);
		const avgHr = hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
		const firstLap = Math.min(...group.map((g) => g.lap.number));

		// Deviation trends: sort by lap order, compute deviation from median
		const byOrder = [...group].sort((a, b) => a.lap.number - b.lap.number);
		let timeDevTrend: string | null = null;
		let timeDevTrendValue: number | null = null;
		if (byOrder.length >= 2) {
			const times = byOrder.map((g) => g.secs);
			const medTime = median(times);
			const deviations = times.map((t) => t - medTime);
			const trend = deviations[deviations.length - 1]! - deviations[0]!;
			timeDevTrend = formatDevTrend(trend, "time");
			timeDevTrendValue = trend;
		}

		let distDevTrend: string | null = null;
		let distDevTrendValue: number | null = null;
		if (byOrder.length >= 2) {
			const dists = byOrder.map((g) => g.dist);
			const medDist = median(dists);
			const deviations = dists.map((d) => d - medDist);
			const trend = deviations[deviations.length - 1]! - deviations[0]!;
			distDevTrend = formatDevTrend(trend, "dist");
			distDevTrendValue = trend;
		}

		results.push({
			count: group.length,
			label,
			avgDuration: convertSecondsToHms(avgSecs),
			avgPaceLabel,
			fastestSplit: convertSecondsToHms(fastestSecs),
			fastestLap,
			avgHr,
			firstLap,
			avgDistLabel: meanDist.toFixed(2),
			meanDist,
			farthestSplit,
			farthestLap,
			timeDevTrend,
			distDevTrend,
			timeDevTrendValue,
			distDevTrendValue,
		});
	}

	results.sort((a, b) => a.firstLap - b.firstLap);
	return results;
}

/** Detect whether to default to "time" or "distance" grouping based on coefficient of variation. */
function detectDefaultGroup(laps: Lap[]): "distance" | "time" {
	const active = laps.filter(
		(l) => l.intensity === Intensity.Active && (l.totalDistance ?? 0) > 0 && (l.totalTimerTime ?? 0) > 0,
	);
	if (active.length < 2) return "distance";
	const dists = active.map((l) => (l.totalDistance ?? 0) / METERS_PER_MILE);
	const times = active.map((l) => l.totalTimerTime ?? 0);
	const cv = (arr: number[]) => {
		const m = arr.reduce((a, b) => a + b, 0) / arr.length;
		const std = Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
		return m > 0 ? std / m : 1;
	};
	return cv(times) < cv(dists) ? "time" : "distance";
}

/**
 * LapTable component with inline editing, intensity copy-paste, and interval summary.
 *
 * Copy-paste intensity feature:
 * - Select laps by clicking anywhere on the row (form controls are excluded so
 *   the distance/time inputs and intensity select stay usable). Supports
 *   Shift+Click for range selection.
 * - Copy intensity pattern from selected laps (Ctrl+C / ⌘C or button)
 * - Paste pattern onto other selected laps (Ctrl+V / ⌘V or button), cycling if shorter
 * - Visual feedback: orange highlight + left border for selected rows, blue
 *   outline for copied source.
 * - Selection actions live in a fixed, bottom-pinned floating bar that overlays
 *   content (zero layout shift) rather than an inline toolbar above the table.
 */
export function LapTable({ laps, sport, category, onEdits }: Props) {
	const [filters, setFilters] = useState<Set<string>>(new Set());
	const [edits, setEdits] = useState<Map<string, LapEdit>>(new Map());
	const defaultGroup = useMemo(() => detectDefaultGroup(laps), [laps]);
	const [groupBy, setGroupBy] = useState<"distance" | "time">(defaultGroup);
	const [focusedCell, setFocusedCell] = useState<string | null>(null);

	// --- Copy-paste intensity state ---
	const [selectedLaps, setSelectedLaps] = useState<Set<number>>(new Set());
	const [copiedPattern, setCopiedPattern] = useState<string[]>([]);
	const [lastCopiedFrom, setLastCopiedFrom] = useState<Set<number>>(new Set());
	const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);

	const filtered = filters.size > 0 ? laps.filter((l) => l.intensity != null && filters.has(l.intensity)) : laps;
	const isCycling = sport === Sport.Cycling;

	const activeLaps = laps.filter((l) => l.intensity === Intensity.Active);
	const showIntervalSummary = category === "training" && activeLaps.length >= 2;
	const intervalSets = useMemo(
		() => (showIntervalSummary ? computeIntervalSummary(laps, sport, groupBy) : []),
		[laps, sport, groupBy, showIntervalSummary],
	);

	// Reset selection and clipboard when laps change (e.g., navigating to different activity)
	useEffect(() => {
		setSelectedLaps(new Set());
		setCopiedPattern([]);
		setLastCopiedFrom(new Set());
		setLastClickedIdx(null);
		setEdits(new Map());
	}, [laps]);

	/** Copy intensity values from selected laps in display order. */
	const handleCopy = useCallback(() => {
		if (selectedLaps.size === 0) return;
		const selectedInOrder = filtered.filter((l) => selectedLaps.has(l.lapId)).sort((a, b) => a.number - b.number);
		const pattern = selectedInOrder.map((l) => {
			const edit = edits.get(`${l.lapId}-intensity`);
			return edit != null ? (edit.value as string) : (l.intensity ?? "");
		});
		setCopiedPattern(pattern);
		setLastCopiedFrom(new Set(selectedLaps));
	}, [selectedLaps, filtered, edits]);

	/** Paste copied intensity pattern onto selected laps, cycling if pattern is shorter. */
	const handlePaste = useCallback(() => {
		if (copiedPattern.length === 0 || selectedLaps.size === 0) return;
		const selectedInOrder = filtered.filter((l) => selectedLaps.has(l.lapId)).sort((a, b) => a.number - b.number);

		const newEdits = new Map(edits);
		for (let i = 0; i < selectedInOrder.length; i++) {
			const lap = selectedInOrder[i]!;
			const intensity = copiedPattern[i % copiedPattern.length]!;
			const key = `${lap.lapId}-intensity`;
			newEdits.set(key, { lapId: lap.lapId, field: "intensity", value: intensity });
		}
		setEdits(newEdits);
		onEdits(Array.from(newEdits.values()));
		// Clear selection after paste (natural spreadsheet behavior)
		setSelectedLaps(new Set());
	}, [copiedPattern, selectedLaps, filtered, edits, onEdits]);

	// Keyboard shortcuts for copy/paste intensity
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

			if ((e.ctrlKey || e.metaKey) && e.key === "c") {
				if (selectedLaps.size === 0) return;
				if (window.getSelection()?.toString()) return;
				e.preventDefault();
				handleCopy();
			}
			if ((e.ctrlKey || e.metaKey) && e.key === "v") {
				if (selectedLaps.size === 0 || copiedPattern.length === 0) return;
				e.preventDefault();
				handlePaste();
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [selectedLaps, copiedPattern, handleCopy, handlePaste]);

	/** Toggle or range-select laps via row click. Supports Shift+Click for range selection. */
	function handleRowSelect(lapId: number, idx: number, shiftKey: boolean) {
		setSelectedLaps((prev) => {
			const next = new Set(prev);
			if (shiftKey && lastClickedIdx !== null) {
				const start = Math.min(lastClickedIdx, idx);
				const end = Math.max(lastClickedIdx, idx);
				for (let i = start; i <= end; i++) {
					next.add(filtered[i]!.lapId);
				}
			} else {
				if (next.has(lapId)) next.delete(lapId);
				else next.add(lapId);
			}
			return next;
		});
		setLastClickedIdx(idx);
	}

	function toggleFilter(intensity: string) {
		setFilters((prev) => {
			const next = new Set(prev);
			if (next.has(intensity)) next.delete(intensity);
			else next.add(intensity);
			return next;
		});
	}

	function handleEdit(lapId: number, field: string, value: unknown) {
		const key = `${lapId}-${field}`;
		const updated = new Map(edits);
		updated.set(key, { lapId, field, value });
		setEdits(updated);
		onEdits(Array.from(updated.values()));
	}

	/** Get the effective intensity value for a lap, considering pending edits. */
	function getEffectiveIntensity(lap: Lap): string {
		const edit = edits.get(`${lap.lapId}-intensity`);
		return edit != null ? (edit.value as string) : (lap.intensity ?? "");
	}

	return (
		<div>
			<div className="inline-flex rounded-lg bg-gray-800 border border-gray-700 p-0.5 mb-4">
				<button
					onClick={() => setFilters(new Set())}
					className={
						filters.size === 0
							? "px-3 py-1.5 rounded-md text-xs font-medium text-white bg-orange-600"
							: "px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
					}
				>
					All
				</button>
				{INTENSITIES.map((i) => (
					<button
						key={i}
						onClick={() => toggleFilter(i)}
						className={`capitalize ${filters.has(i) ? "px-3 py-1.5 rounded-md text-xs font-medium text-white bg-orange-600" : "px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"}`}
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
							<th className="px-4 py-3">Cum. Dist</th>
							<th className="px-4 py-3">Cum. Time</th>
							<th className="px-4 py-3">{isCycling ? "Speed (mph)" : "Pace"}</th>
							<th className="px-4 py-3">Ascent</th>
							<th className="px-4 py-3">Descent</th>
							<th className="px-4 py-3">Cadence</th>
							<th className="px-4 py-3">Intensity</th>
						</tr>
					</thead>
					<tbody>
						{(() => {
							let cumDist = 0;
							let cumTime = 0;
							return filtered.map((lap, idx) => {
								const distEdit = edits.get(`${lap.lapId}-totalDistance`);
								const timeEdit = edits.get(`${lap.lapId}-totalTimerTime`);
								const miles =
									distEdit != null
										? (distEdit.value as number) / METERS_PER_MILE
										: (lap.totalDistance ?? 0) / METERS_PER_MILE;
								const time = timeEdit != null ? (timeEdit.value as number) : (lap.totalTimerTime ?? 0);
								cumDist += miles;
								cumTime += time;
								const paceVal = miles > 0 ? time / 60 / miles : null;
								const speedMph = time > 0 ? miles / (time / 3600) : null;

								const isSelected = selectedLaps.has(lap.lapId);
								const isCopiedSource = lastCopiedFrom.has(lap.lapId);

								return (
									<tr
										key={lap.lapId}
										// Row-click selection: clicking anywhere on the row toggles selection
										// (Shift+Click extends a range). Editable cells stop propagation so
										// interacting with the inputs/select never toggles selection.
										onClick={(e) => handleRowSelect(lap.lapId, idx, e.shiftKey)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												handleRowSelect(lap.lapId, idx, e.shiftKey);
											}
										}}
										tabIndex={0}
										aria-selected={isSelected}
										aria-label={`Lap ${lap.number}, click to select`}
										className={`cursor-pointer border-t border-gray-800 transition-colors ${
											isSelected
												? "bg-orange-600/10 border-l-2 border-l-orange-600"
												: isCopiedSource
													? "bg-blue-500/5 ring-1 ring-inset ring-blue-400/30"
													: "hover:bg-gray-800/30"
										}`}
									>
										<td className="px-4 py-3 text-gray-300">{lap.number}</td>
										<td className="px-4 py-3 text-gray-300">
											<input
												type="number"
												step="0.01"
												defaultValue={focusedCell === `${lap.lapId}-dist` ? miles.toString() : miles.toFixed(2)}
												key={`${lap.lapId}-dist-${focusedCell === `${lap.lapId}-dist` ? "full" : "rounded"}-${distEdit ? miles : ""}`}
												onClick={(e) => e.stopPropagation()}
												onFocus={() => setFocusedCell(`${lap.lapId}-dist`)}
												onBlur={(e) => {
													setFocusedCell(null);
													handleEdit(lap.lapId, "totalDistance", Number(e.target.value) * METERS_PER_MILE);
												}}
												className="w-20 bg-transparent border-b border-dashed border-gray-700 focus:border-orange-500 outline-none text-gray-200 tabular-nums"
											/>
										</td>
										<td className="px-4 py-3 text-gray-300">
											<input
												type="text"
												defaultValue={
													focusedCell === `${lap.lapId}-time`
														? (convertSecondsToHms(time) ?? "")
														: (convertSecondsToHms(Math.round(time * 100) / 100) ?? "")
												}
												key={`${lap.lapId}-time-${focusedCell === `${lap.lapId}-time` ? "full" : "rounded"}-${timeEdit ? time : ""}`}
												onClick={(e) => e.stopPropagation()}
												onFocus={() => setFocusedCell(`${lap.lapId}-time`)}
												onBlur={(e) => {
													setFocusedCell(null);
													const parts = e.target.value.split(":").map(Number);
													const secs =
														parts.length === 3
															? parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
															: parts.length === 2
																? parts[0]! * 60 + parts[1]!
																: (parts[0] ?? 0);
													handleEdit(lap.lapId, "totalTimerTime", secs);
												}}
												className="w-24 bg-transparent border-b border-dashed border-gray-700 focus:border-orange-500 outline-none text-gray-200 tabular-nums"
											/>
										</td>
										<td className="px-4 py-3 text-gray-400 tabular-nums">{cumDist.toFixed(2)}</td>
										<td className="px-4 py-3 text-gray-400 tabular-nums">
											{convertSecondsToHms(Math.round(cumTime * 100) / 100)}
										</td>
										<td className="px-4 py-3 text-gray-300">
											{isCycling ? (speedMph?.toFixed(1) ?? "—") : (formatPacePrecise(paceVal) ?? "—")}
										</td>
										<td className="px-4 py-3 text-gray-300">{lap.totalAscent ?? "—"}</td>
										<td className="px-4 py-3 text-gray-300">{lap.totalDescent ?? "—"}</td>
										<td className="px-4 py-3 text-gray-300">
											{lap.avgRunningCadence != null ? Math.round(lap.avgRunningCadence * (isCycling ? 1 : 2)) : "—"}
										</td>
										<td className="px-4 py-3 text-gray-300">
											<select
												value={getEffectiveIntensity(lap)}
												onClick={(e) => e.stopPropagation()}
												onChange={(e) => handleEdit(lap.lapId, "intensity", e.target.value)}
												className="rounded-lg bg-gray-800 border border-gray-700 text-xs px-2 py-1 text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500"
											>
												<option value="">—</option>
												{INTENSITIES.map((i) => (
													<option key={i} value={i}>
														{i}
													</option>
												))}
											</select>
										</td>
									</tr>
								);
							});
						})()}
					</tbody>
				</table>
			</div>

			{showIntervalSummary && (
				<div className="mt-6">
					<div className="inline-flex rounded-lg bg-gray-800 border border-gray-700 p-0.5 mb-4">
						<button
							onClick={() => setGroupBy("distance")}
							className={
								groupBy === "distance"
									? "px-3 py-1.5 rounded-md text-xs font-medium text-white bg-orange-600"
									: "px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
							}
						>
							Distance
						</button>
						<button
							onClick={() => setGroupBy("time")}
							className={
								groupBy === "time"
									? "px-3 py-1.5 rounded-md text-xs font-medium text-white bg-orange-600"
									: "px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
							}
						>
							Time
						</button>
					</div>

					{intervalSets.map((set, idx) => (
						<div key={idx} className="mb-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
							<p className="text-lg font-bold text-gray-50 mb-2">
								{set.count}×{set.label}
							</p>
							<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
								{groupBy === "distance" ? (
									<>
										<div>
											<p className="text-xs text-gray-500 uppercase tracking-wide">Avg Time</p>
											<p className="text-gray-200 font-medium tabular-nums">
												{set.avgDuration ?? "—"}
												{set.timeDevTrend != null && set.timeDevTrendValue != null && (
													<span
														className={`ml-1.5 text-xs ${set.timeDevTrendValue < 0 ? "text-green-400" : set.timeDevTrendValue > 0 ? "text-red-400" : "text-gray-500"}`}
													>
														{set.timeDevTrend}
													</span>
												)}
											</p>
										</div>
										<div>
											<p className="text-xs text-gray-500 uppercase tracking-wide">
												Fastest Split (Lap {set.fastestLap})
											</p>
											<p className="text-gray-200 font-medium tabular-nums">{set.fastestSplit ?? "—"}</p>
										</div>
									</>
								) : (
									<>
										<div>
											<p className="text-xs text-gray-500 uppercase tracking-wide">Avg Distance</p>
											<p className="text-gray-200 font-medium tabular-nums">
												{set.avgDistLabel} mi
												{set.distDevTrend != null && set.distDevTrendValue != null && (
													<span
														className={`ml-1.5 text-xs ${set.distDevTrendValue > 0 ? "text-green-400" : set.distDevTrendValue < 0 ? "text-red-400" : "text-gray-500"}`}
													>
														{set.distDevTrend}
													</span>
												)}
											</p>
										</div>
										<div>
											<p className="text-xs text-gray-500 uppercase tracking-wide">Farthest (Lap {set.farthestLap})</p>
											<p className="text-gray-200 font-medium tabular-nums">{set.farthestSplit}</p>
										</div>
									</>
								)}
								<div>
									<p className="text-xs text-gray-500 uppercase tracking-wide">
										{isCycling ? "Avg Speed" : "Avg Pace"}
									</p>
									<p className="text-gray-200 font-medium tabular-nums">{set.avgPaceLabel}</p>
								</div>
								{set.avgHr != null && (
									<div>
										<p className="text-xs text-gray-500 uppercase tracking-wide">Avg HR</p>
										<p className="text-gray-200 font-medium tabular-nums">{set.avgHr} bpm</p>
									</div>
								)}
							</div>
						</div>
					))}

					{intervalSets.length === 0 && (
						<p className="text-sm text-gray-500">No interval sets detected (need ≥2 similar active laps).</p>
					)}
				</div>
			)}

			{/*
			 * Floating selection action bar — pinned to the bottom of the viewport and
			 * overlaid via position:fixed so it never reflows the table (zero layout
			 * shift). Fades/slides in when laps are selected. Orange accent matches the
			 * Activity Details page.
			 */}
			<div
				className={`fixed bottom-6 left-1/2 z-40 -translate-x-1/2 transition-all duration-200 ${
					selectedLaps.size > 0
						? "pointer-events-auto translate-y-0 opacity-100"
						: "pointer-events-none translate-y-4 opacity-0"
				}`}
			>
				<div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-2 rounded-full border border-gray-700 bg-gray-900/90 px-4 py-2 shadow-lg backdrop-blur-sm">
					<span className="text-xs font-medium text-gray-200">
						{selectedLaps.size} lap{selectedLaps.size > 1 ? "s" : ""} selected
					</span>
					<button
						type="button"
						onClick={handleCopy}
						className="rounded-full bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-700"
						aria-label="Copy intensity pattern from selected laps"
					>
						Copy Intensity <kbd className="ml-1 text-[10px] text-gray-500">⌘C</kbd>
					</button>
					{copiedPattern.length > 0 && (
						<button
							type="button"
							onClick={handlePaste}
							className="rounded-full bg-orange-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-orange-500"
							aria-label="Paste intensity pattern onto selected laps"
						>
							Paste ({copiedPattern.length}) <kbd className="ml-1 text-[10px] text-orange-200">⌘V</kbd>
						</button>
					)}
					<button
						type="button"
						onClick={() => {
							setSelectedLaps(new Set());
							setLastCopiedFrom(new Set());
						}}
						className="rounded-full px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-200"
						aria-label="Clear lap selection"
					>
						Clear
					</button>
				</div>
			</div>
		</div>
	);
}
