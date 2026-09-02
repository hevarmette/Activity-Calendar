import { SPORT_COLORS } from "@activity-calendar/shared";
import type { Lap, RecordPoint } from "@activity-calendar/shared";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useActivity, useLaps, useRecords, useSessions } from "../api/queries.js";
import { CompareAnimationMap } from "../components/compare/CompareAnimationMap.js";
import { CompareControls } from "../components/compare/CompareControls.js";
import { LapComparison } from "../components/compare/LapComparison.js";
import type { LatLngTime } from "../lib/geo.js";

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

	// Resolve distinct colors: use sport colors, falling back to a fixed pair on
	// collision so the two markers/tracks are always distinguishable. Sport is read
	// per-activity from its first session (ActivityDetails carries no sport field).
	const rawSportA = sesA.data?.[0]?.sport ?? "";
	const rawSportB = sesB.data?.[0]?.sport ?? "";
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

	// Reset the clock + stop playback when the compared ids change.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset only on id change.
	useEffect(() => {
		setClock(0);
		setIsPlaying(false);
		setOffsetA(0);
		setOffsetB(0);
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
						{compA.name}
					</span>
					<span className="text-gray-700">vs</span>
					<span className="inline-flex items-center gap-1.5">
						<span className="h-3 w-3 rounded-full" style={{ backgroundColor: colorB }} aria-hidden="true" />
						{compB.name}
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

			<LapComparison
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
		</div>
	);
}

export default ActivityComparePage;
