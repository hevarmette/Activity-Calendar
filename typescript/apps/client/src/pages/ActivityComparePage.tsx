import { SPORT_COLORS } from "@activity-calendar/shared";
import type { Lap, RecordPoint } from "@activity-calendar/shared";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useActivity, useAutoLaps, useLaps, useRecords, useSessions } from "../api/queries.js";
import { AutoLapComparison } from "../components/compare/AutoLapComparison.js";
import { CompareAnimationMap } from "../components/compare/CompareAnimationMap.js";
import { CompareControls } from "../components/compare/CompareControls.js";
import { LapComparison } from "../components/compare/LapComparison.js";
import { TimeBehindChart } from "../components/compare/TimeBehindChart.js";
import type { LatLngTime } from "../lib/geo.js";
import { buildDeltaSeries, buildDistTimeTrack } from "../lib/timeBehind.js";

/** Distinct fallback colors when both activities share a sport color. */
const FALLBACK_A = "#f97316"; // orange
const FALLBACK_B = "#38bdf8"; // sky

/**
 * Client-local view model for one side of the comparison. Not an API contract —
 * it is assembled from the existing activity/records/laps hooks purely for the
 * compare UI, so it lives here rather than in the shared package.
 */
interface ComparisonActivity {
	id: number;
	name: string;
	sport: string;
	color: string;
	hasGps: boolean;
	track: LatLngTime[];
	laps: Lap[];
	maxT: number;
}

/** Build a time-stamped GPS track from record points (ascending elapsedTime). */
function buildTrack(points: RecordPoint[] | undefined): LatLngTime[] {
	if (!points) return [];
	return points
		.filter((p) => p.latitude != null && p.longitude != null)
		.map((p) => ({ lat: p.latitude as number, lng: p.longitude as number, t: p.elapsedTime }));
}

/**
 * Activity Comparison page (/compare?a=<idA>&b=<idB>).
 *
 * Loads records + laps + activity for both ids via the existing id-scoped
 * TanStack Query hooks. Overlays both GPS tracks on one animated map driven by a
 * single shared playback clock, with per-activity start offsets to align efforts.
 * Below the map, a side-by-side lap comparison shares one Intensity filter.
 * Activities without GPS gracefully degrade to a lap-only comparison.
 */
export function ActivityComparePage() {
	const [sp] = useSearchParams();
	const a = Number(sp.get("a"));
	const b = Number(sp.get("b"));
	const validIds = a > 0 && b > 0 && !Number.isNaN(a) && !Number.isNaN(b);

	const actA = useActivity(a);
	const actB = useActivity(b);
	const recA = useRecords(a);
	const recB = useRecords(b);
	const lapA = useLaps(a);
	const lapB = useLaps(b);
	const sesA = useSessions(a);
	const sesB = useSessions(b);
	// --- Animation + filter state (ephemeral; not persisted to URL) ---
	const [clock, setClock] = useState(0);
	const [isPlaying, setIsPlaying] = useState(false);
	const [speed, setSpeed] = useState(1);
	const [offsetA, setOffsetA] = useState(0);
	const [offsetB, setOffsetB] = useState(0);
	const [intensityFilter, setIntensityFilter] = useState<Set<string>>(new Set());

	// --- Lap comparison mode toggle (Enhancement #4) ---
	// 'laps' shows regular laps (with the intensity filter); 'auto-laps' shows
	// server-computed splits at a single SHARED distance applied to both columns.
	const [lapMode, setLapMode] = useState<"laps" | "auto-laps">("laps");
	// Raw input (miles) + its debounced value so we only refetch auto-laps ~400ms
	// after the user stops typing. One control drives BOTH activities.
	const [autoLapInput, setAutoLapInput] = useState(1);
	const [autoLapDist, setAutoLapDist] = useState(1);
	useEffect(() => {
		const timer = setTimeout(() => setAutoLapDist(autoLapInput), 400);
		return () => clearTimeout(timer);
	}, [autoLapInput]);

	// Resolve distinct colors: use sport colors, falling back to a fixed pair on
	// collision so the two markers/tracks are always distinguishable. Sport is read
	// per-activity from its first session (ActivityDetails carries no sport field).
	const rawSportA = sesA.data?.[0]?.sport ?? "";
	const rawSportB = sesB.data?.[0]?.sport ?? "";

	// Auto-laps for both activities at the SHARED debounced distance (Enhancement #4).
	// Sport is required by the endpoint; both queries are id-scoped and cached.
	const autoLapA = useAutoLaps(a, rawSportA, autoLapDist);
	const autoLapB = useAutoLaps(b, rawSportB, autoLapDist);
	const { colorA, colorB } = useMemo(() => {
		const cA = SPORT_COLORS[rawSportA] ?? FALLBACK_A;
		const cB = SPORT_COLORS[rawSportB] ?? FALLBACK_B;
		if (cA === cB) return { colorA: FALLBACK_A, colorB: FALLBACK_B };
		return { colorA: cA, colorB: cB };
	}, [rawSportA, rawSportB]);

	const compA = useMemo<ComparisonActivity>(() => {
		const track = buildTrack(recA.data);
		return {
			id: a,
			name: actA.data?.name ?? `Activity ${a}`,
			sport: rawSportA,
			color: colorA,
			hasGps: track.length > 0,
			track,
			laps: lapA.data ?? [],
			maxT: track.length ? (track[track.length - 1]?.t ?? 0) : 0,
		};
	}, [a, actA.data, recA.data, lapA.data, rawSportA, colorA]);

	const compB = useMemo<ComparisonActivity>(() => {
		const track = buildTrack(recB.data);
		return {
			id: b,
			name: actB.data?.name ?? `Activity ${b}`,
			sport: rawSportB,
			color: colorB,
			hasGps: track.length > 0,
			track,
			laps: lapB.data ?? [],
			maxT: track.length ? (track[track.length - 1]?.t ?? 0) : 0,
		};
	}, [b, actB.data, recB.data, lapB.data, rawSportB, colorB]);

	const maxClock = Math.max(0, Math.max(compA.maxT - offsetA, compB.maxT - offsetB));

	// --- "How far behind over time" delta series (Enhancement #3) ---
	// Build distance/time tracks separately from the map track (buildTrack drops
	// distance), then interpolate a shared distance grid of B−A time deltas. Only
	// meaningful when BOTH activities carry distance data.
	const deltaSeries = useMemo(() => {
		const trackA = buildDistTimeTrack(recA.data);
		const trackB = buildDistTimeTrack(recB.data);
		if (trackA.length === 0 || trackB.length === 0) return [];
		return buildDeltaSeries(trackA, trackB);
	}, [recA.data, recB.data]);

	// Reset the clock + stop playback when the compared ids change.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset only on id change.
	useEffect(() => {
		setClock(0);
		setIsPlaying(false);
		setOffsetA(0);
		setOffsetB(0);
		setLapMode("laps");
		setAutoLapInput(1);
		setAutoLapDist(1);
	}, [a, b]);

	// Re-clamp the clock when offsets shrink the playable range.
	useEffect(() => {
		setClock((c) => (c > maxClock ? maxClock : c));
	}, [maxClock]);

	// requestAnimationFrame playback loop — single animation source of truth.
	useEffect(() => {
		if (!isPlaying) return;
		let raf = 0;
		let last = performance.now();
		const tick = (now: number) => {
			const dt = (now - last) / 1000;
			last = now;
			setClock((c) => {
				const next = c + dt * speed;
				if (next >= maxClock) {
					setIsPlaying(false);
					return maxClock;
				}
				return next;
			});
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [isPlaying, speed, maxClock]);

	function toggleFilter(intensity: string) {
		setIntensityFilter((prev) => {
			const next = new Set(prev);
			if (next.has(intensity)) next.delete(intensity);
			else next.add(intensity);
			return next;
		});
	}

	if (!validIds) {
		return (
			<div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
				<p className="text-gray-400">Pick two activities to compare.</p>
				<Link to="/search" className="text-sm font-medium text-orange-400 hover:text-orange-300">
					Go to Activity Search →
				</Link>
			</div>
		);
	}

	const isLoading =
		actA.isLoading ||
		actB.isLoading ||
		recA.isLoading ||
		recB.isLoading ||
		lapA.isLoading ||
		lapB.isLoading ||
		sesA.isLoading ||
		sesB.isLoading;

	if (isLoading) {
		return <div className="py-10 text-center text-gray-400">Loading comparison…</div>;
	}

	if (!actA.data || !actB.data) {
		return (
			<div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
				<p className="text-gray-400">One or both activities could not be found.</p>
				<Link to="/search" className="text-sm font-medium text-orange-400 hover:text-orange-300">
					Back to Activity Search →
				</Link>
			</div>
		);
	}

	const bothHaveGps = compA.hasGps && compB.hasGps;

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold text-gray-100">Activity Comparison</h1>
				<p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
					<span className="inline-flex items-center gap-1.5">
						<span className="h-3 w-3 rounded-full" style={{ backgroundColor: colorA }} aria-hidden="true" />
						<Link to={`/activity/${compA.id}?sport=${compA.sport}`} className="transition-colors hover:text-orange-300">
							{compA.name}
						</Link>
					</span>
					<span className="text-gray-700">vs</span>
					<span className="inline-flex items-center gap-1.5">
						<span className="h-3 w-3 rounded-full" style={{ backgroundColor: colorB }} aria-hidden="true" />
						<Link to={`/activity/${compB.id}?sport=${compB.sport}`} className="transition-colors hover:text-orange-300">
							{compB.name}
						</Link>
					</span>
				</p>
			</div>

			{bothHaveGps ? (
				<div className="space-y-4">
					<CompareAnimationMap
						trackA={compA.track}
						trackB={compB.track}
						colorA={colorA}
						colorB={colorB}
						clock={clock}
						offsetA={offsetA}
						offsetB={offsetB}
						nameA={compA.name}
						nameB={compB.name}
					/>
					<CompareControls
						isPlaying={isPlaying}
						onPlayPause={() => setIsPlaying((p) => !p)}
						clock={clock}
						maxClock={maxClock}
						onScrub={(s) => {
							setIsPlaying(false);
							setClock(s);
						}}
						speed={speed}
						onSpeedChange={setSpeed}
						offsetA={offsetA}
						offsetB={offsetB}
						onOffsetA={setOffsetA}
						onOffsetB={setOffsetB}
						maxA={compA.maxT}
						maxB={compB.maxT}
						colorA={colorA}
						colorB={colorB}
						nameA={compA.name}
						nameB={compB.name}
					/>
				</div>
			) : (
				<p className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-400">
					No GPS data — showing lap comparison only.
				</p>
			)}

			{/* Enhancement #3: time-behind delta chart, only when both have distance data. */}
			{deltaSeries.length > 0 ? (
				<TimeBehindChart series={deltaSeries} nameA={compA.name} nameB={compB.name} />
			) : (
				<p className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-500">
					No distance data for delta chart.
				</p>
			)}

			<div className="space-y-4">
				{/* Enhancement #4: toggle between regular laps and auto-laps. */}
				<div className="flex flex-wrap items-center gap-3">
					<div
						className="inline-flex rounded-lg border border-gray-700 bg-gray-800 p-0.5"
						role="group"
						aria-label="Lap mode"
					>
						<button
							type="button"
							onClick={() => setLapMode("laps")}
							aria-pressed={lapMode === "laps"}
							className={
								lapMode === "laps"
									? "rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white"
									: "rounded-md px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-200"
							}
						>
							Laps
						</button>
						<button
							type="button"
							onClick={() => setLapMode("auto-laps")}
							aria-pressed={lapMode === "auto-laps"}
							className={
								lapMode === "auto-laps"
									? "rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white"
									: "rounded-md px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-200"
							}
						>
							Auto-laps
						</button>
					</div>

					{/* Single shared distance control applying to BOTH activities. */}
					{lapMode === "auto-laps" && (
						<div className="flex items-center gap-2">
							<input
								type="number"
								min={0}
								step={0.1}
								value={autoLapInput}
								onChange={(e) => setAutoLapInput(Number(e.target.value))}
								aria-label="Auto-lap distance in miles"
								className="w-20 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
							/>
							<span className="text-xs text-gray-500">mi splits (both activities)</span>
						</div>
					)}
				</div>

				{lapMode === "laps" ? (
					<LapComparison
						idA={compA.id}
						idB={compB.id}
						nameA={compA.name}
						nameB={compB.name}
						colorA={colorA}
						colorB={colorB}
						sportA={compA.sport}
						sportB={compB.sport}
						lapsA={compA.laps}
						lapsB={compB.laps}
						filter={intensityFilter}
						onToggleFilter={toggleFilter}
						onClearFilter={() => setIntensityFilter(new Set())}
					/>
				) : (
					<AutoLapComparison
						idA={compA.id}
						idB={compB.id}
						nameA={compA.name}
						nameB={compB.name}
						colorA={colorA}
						colorB={colorB}
						sportA={compA.sport}
						sportB={compB.sport}
						lapsA={autoLapA.data ?? []}
						lapsB={autoLapB.data ?? []}
					/>
				)}
			</div>
		</div>
	);
}

export default ActivityComparePage;
