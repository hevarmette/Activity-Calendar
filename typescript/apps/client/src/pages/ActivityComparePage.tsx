import type { Lap, RecordPoint } from "@activity-calendar/shared";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { type AutoLap, useActivity, useAutoLaps, useLaps, useRecords, useSessions } from "../api/queries.js";
import { AutoLapComparison } from "../components/compare/AutoLapComparison.js";
import { CompareAnimationMap } from "../components/compare/CompareAnimationMap.js";
import { CompareControls } from "../components/compare/CompareControls.js";
import { LapComparison } from "../components/compare/LapComparison.js";
import { TimeBehindChart } from "../components/compare/TimeBehindChart.js";
import { type CompareId, paletteColor, parseCompareIds, serializeCompareId } from "../lib/compareId.js";
import type { LatLngTime } from "../lib/geo.js";
import { buildDistTimeTrack, buildMultiDeltaSeries } from "../lib/timeBehind.js";

/**
 * Maximum number of activities that can be compared at once. Because React hooks
 * cannot be called conditionally or in a loop of varying length, the page always
 * calls each data hook exactly this many times (the "fixed-slot" pattern) and
 * disables the slots beyond the parsed id count. Extra ids in the URL are
 * truncated to this cap.
 */
const MAX_COMPARE = 8;

/**
 * Client-local view model for one activity in the comparison. Not an API
 * contract — it is assembled from the existing activity/records/laps hooks purely
 * for the compare UI, so it lives here rather than in the shared package.
 */
interface ComparisonActivity {
	/** Stable React key = the serialized compare id (`1234` or `schema:1234`). */
	key: string;
	id: number;
	/** Secondary schema, or `undefined` for the primary schema. */
	schema?: string;
	name: string;
	sport: string;
	color: string;
	hasGps: boolean;
	track: LatLngTime[];
	laps: Lap[];
	autoLaps: AutoLap[];
	maxT: number;
	/** Per-slot fetch error (e.g. a 400 from a disallowed schema). */
	isError: boolean;
}

/** Build a time-stamped GPS track from record points (ascending elapsedTime). */
function buildTrack(points: RecordPoint[] | undefined): LatLngTime[] {
	if (!points) return [];
	return points
		.filter((p) => p.latitude != null && p.longitude != null)
		.map((p) => ({ lat: p.latitude as number, lng: p.longitude as number, t: p.elapsedTime }));
}

/**
 * Activity Comparison page (`/compare?ids=<id>,<id>,…`).
 *
 * The `?ids=` param is a comma-separated list where each entry is either a bare
 * number (an activity in YOUR primary schema) or `schema:id` (read-only data
 * from another group's schema — Feature #6). It replaces the old `?a=&b=` pair.
 *
 * Loads records + laps + activity for every id via the existing id-scoped
 * TanStack Query hooks, using a FIXED-SLOT pattern: each hook is called
 * {@link MAX_COMPARE} times unconditionally, and unused slots pass id 0 (which
 * disables the query). Every activity overlays its GPS track on one animated map
 * driven by a single shared playback clock, with per-activity start offsets to
 * align efforts. Below the map, an N-column lap comparison shares one Intensity
 * filter and one auto-lap distance. Colors come from a fixed compare palette
 * (index-based), so any number of activities is always distinguishable.
 *
 * Guards: no valid ids → empty state; N = 1 → single activity with no deltas and
 * no time-behind chart (there is no baseline to compare against); a per-slot
 * fetch error surfaces as a per-activity banner without blanking the page.
 */
export function ActivityComparePage() {
	const [sp] = useSearchParams();
	// Parse + cap the ids. Memoized on the raw string so the fixed-slot inputs are
	// stable across renders (a fresh array each render would thrash the hooks).
	const idsParam = sp.get("ids");
	const targets = useMemo<CompareId[]>(() => parseCompareIds(idsParam).slice(0, MAX_COMPARE), [idsParam]);

	// --- Fixed-slot hook calls (Rules of Hooks) ---------------------------------
	// Build a padded array of MAX_COMPARE slots; unused slots use id 0 so the
	// hooks stay disabled (enabled: id > 0) and never fetch.
	const slots: CompareId[] = [];
	for (let i = 0; i < MAX_COMPARE; i++) slots.push(targets[i] ?? { id: 0 });

	// NOTE: each `.map` below calls exactly MAX_COMPARE hooks in a fixed order every
	// render — a stable, unconditional hook sequence that satisfies the Rules of
	// Hooks (disabled slots use id 0 so their queries never fire).
	const acts = slots.map((s) => useActivity(s.id, s.schema));
	const recs = slots.map((s) => useRecords(s.id, s.schema));
	const laps = slots.map((s) => useLaps(s.id, s.schema));
	const sess = slots.map((s) => useSessions(s.id, s.schema));

	// --- Animation + filter state (ephemeral; not persisted to URL) ---
	const [clock, setClock] = useState(0);
	const [isPlaying, setIsPlaying] = useState(false);
	const [speed, setSpeed] = useState(1);
	const [offsets, setOffsets] = useState<number[]>(() => Array(MAX_COMPARE).fill(0));
	const [intensityFilter, setIntensityFilter] = useState<Set<string>>(new Set());

	// --- Lap comparison mode toggle ---
	// 'laps' shows regular laps (with the intensity filter); 'auto-laps' shows
	// server-computed splits at a single SHARED distance applied to ALL columns.
	const [lapMode, setLapMode] = useState<"laps" | "auto-laps">("laps");
	// Raw input (miles) + its debounced value so we only refetch auto-laps ~400ms
	// after the user stops typing. One control drives EVERY activity. The raw
	// value is a string so the field can be cleared mid-edit without collapsing
	// to 0 (which would divide-by-zero in the split calculation).
	const [autoLapInput, setAutoLapInput] = useState("1");
	const [autoLapDist, setAutoLapDist] = useState(1);
	useEffect(() => {
		// Only propagate a valid, positive distance; ignore empty/0/NaN.
		const parsed = Number(autoLapInput);
		if (!Number.isFinite(parsed) || parsed <= 0) return;
		const timer = setTimeout(() => setAutoLapDist(parsed), 400);
		return () => clearTimeout(timer);
	}, [autoLapInput]);

	// Sport per slot (read from the first session; ActivityDetails carries no sport).
	const sports = slots.map((_, i) => sess[i]?.data?.[0]?.sport ?? "");

	// Auto-laps for every slot at the SHARED debounced distance. Sport is required
	// by the endpoint; each query is id-scoped, schema-scoped, and cached. Same
	// fixed-slot hook pattern as the loops above.
	const autoLaps = slots.map((s, i) => useAutoLaps(s.id, sports[i] ?? "", autoLapDist, s.schema));

	// Assemble the N view models (only the active slots). Colors are index-based
	// from the compare palette so any count stays distinguishable.
	const activities = useMemo<ComparisonActivity[]>(() => {
		return targets.map((target, i) => {
			const track = buildTrack(recs[i]?.data);
			const color = paletteColor(i);
			return {
				key: serializeCompareId(target),
				id: target.id,
				schema: target.schema,
				name: acts[i]?.data?.name ?? `Activity ${target.id}`,
				sport: sports[i] ?? "",
				color,
				hasGps: track.length > 0,
				track,
				laps: laps[i]?.data ?? [],
				autoLaps: autoLaps[i]?.data ?? [],
				maxT: track.length ? (track[track.length - 1]?.t ?? 0) : 0,
				isError:
					(acts[i]?.isError ?? false) ||
					(recs[i]?.isError ?? false) ||
					(laps[i]?.isError ?? false) ||
					(sess[i]?.isError ?? false),
			};
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [targets, acts, recs, laps, sess, autoLaps, sports]);

	// Playable range = the longest track once each activity's offset is applied.
	const maxClock = useMemo(
		() => activities.reduce((m, a, i) => Math.max(m, a.maxT - (offsets[i] ?? 0)), 0),
		[activities, offsets],
	);

	// --- "How far behind over time" multi-series delta (baseline = activity 0) ---
	// Build distance/time tracks separately from the map track (buildTrack drops
	// distance), then diff every other activity against the first. Empty/no-overlap
	// series are dropped by buildMultiDeltaSeries.
	const seriesList = useMemo(() => {
		if (activities.length < 2) return [];
		const distTracks = activities.map((_, i) => buildDistTimeTrack(recs[i]?.data));
		const baseline = distTracks[0] ?? [];
		if (baseline.length === 0) return [];
		const others = activities.slice(1).map((a, idx) => ({
			key: a.key,
			name: a.name,
			color: a.color,
			track: distTracks[idx + 1] ?? [],
		}));
		return buildMultiDeltaSeries(baseline, others);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activities, recs]);

	// Reset ephemeral state when the compared ids change.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset only on id-set change.
	useEffect(() => {
		setClock(0);
		setIsPlaying(false);
		setOffsets(Array(MAX_COMPARE).fill(0));
		setLapMode("laps");
		setAutoLapInput("1");
		setAutoLapDist(1);
	}, [idsParam]);

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

	function setOffsetAt(index: number, seconds: number) {
		setOffsets((prev) => {
			const next = [...prev];
			next[index] = seconds;
			return next;
		});
	}

	// Always-visible legend explaining the id format.
	const legend = (
		<p className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-2 text-xs text-gray-500">
			<span className="font-medium text-gray-400">Comparing ids:</span> a bare number (e.g.{" "}
			<code className="text-gray-300">1234</code>) is your own data; <code className="text-gray-300">group:id</code>{" "}
			(e.g. <code className="text-gray-300">alice:1234</code>) is another group's read-only data. Cross-group activity
			names are shown as plain text since their detail pages aren't linkable.
		</p>
	);

	if (targets.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
				<p className="text-gray-400">Pick activities to compare.</p>
				{legend}
				<Link to="/search" className="text-sm font-medium text-orange-400 hover:text-orange-300">
					Go to Activity Search →
				</Link>
			</div>
		);
	}

	const isLoading = targets.some(
		(_, i) =>
			(acts[i]?.isLoading ?? false) ||
			(recs[i]?.isLoading ?? false) ||
			(laps[i]?.isLoading ?? false) ||
			(sess[i]?.isLoading ?? false),
	);

	if (isLoading) {
		return <div className="py-10 text-center text-gray-400">Loading comparison…</div>;
	}

	// Which activities carry GPS — the map needs at least two overlapping tracks
	// to be meaningful, but we still render it for a single GPS track (animated).
	const gpsActivities = activities.filter((a) => a.hasGps);
	const showMap = gpsActivities.length > 0;

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold text-gray-100">Activity Comparison</h1>
				<p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
					{activities.map((a, i) => (
						<span key={a.key} className="inline-flex items-center gap-1.5">
							{i > 0 && <span className="text-gray-700">vs</span>}
							<span className="h-3 w-3 rounded-full" style={{ backgroundColor: a.color }} aria-hidden="true" />
							{a.schema == null ? (
								<Link to={`/activity/${a.id}?sport=${a.sport}`} className="transition-colors hover:text-orange-300">
									{a.name}
								</Link>
							) : (
								<span title={`${a.name} (${a.schema})`}>
									{a.name}
									<span className="ml-1 text-gray-600">({a.schema})</span>
								</span>
							)}
						</span>
					))}
				</p>
			</div>

			{legend}

			{/* Per-activity fetch errors (e.g. a disallowed schema returns 400). */}
			{activities.some((a) => a.isError) && (
				<div className="space-y-1.5">
					{activities
						.filter((a) => a.isError)
						.map((a) => (
							<p
								key={a.key}
								role="alert"
								className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-2 text-sm text-red-300"
							>
								Couldn't load <span className="font-medium">{a.schema ? `${a.schema}:${a.id}` : `#${a.id}`}</span> — it
								may be an unknown group or a missing activity.
							</p>
						))}
				</div>
			)}

			{showMap ? (
				<div className="space-y-4">
					<CompareAnimationMap
						tracks={gpsActivities.map((a) => {
							// Offset is stored by the activity's index in `activities`.
							const idx = activities.indexOf(a);
							return { track: a.track, color: a.color, name: a.name, offset: offsets[idx] ?? 0 };
						})}
						clock={clock}
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
						activities={activities.map((a, i) => ({
							name: a.name,
							color: a.color,
							offset: offsets[i] ?? 0,
							max: a.maxT,
						}))}
						onOffset={setOffsetAt}
					/>
				</div>
			) : (
				<p className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-400">
					No GPS data — showing lap comparison only.
				</p>
			)}

			{/* Time-behind delta chart — needs a baseline, so only when N >= 2. */}
			{activities.length >= 2 ? (
				seriesList.length > 0 ? (
					<TimeBehindChart baselineName={activities[0]?.name ?? "baseline"} seriesList={seriesList} />
				) : (
					<p className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-500">
						No distance data for delta chart.
					</p>
				)
			) : null}

			<div className="space-y-4">
				{/* Toggle between regular laps and auto-laps. */}
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

					{/* Single shared distance control applying to ALL activities. */}
					{lapMode === "auto-laps" && (
						<div className="flex items-center gap-2">
							<input
								type="number"
								min={0}
								step={0.1}
								value={autoLapInput}
								onChange={(e) => setAutoLapInput(e.target.value)}
								aria-label="Auto-lap distance in miles"
								className="w-20 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
							/>
							<span className="text-xs text-gray-500">mi splits (all activities)</span>
						</div>
					)}
				</div>

				{lapMode === "laps" ? (
					<LapComparison
						columns={activities.map((a) => ({
							id: a.id,
							name: a.name,
							color: a.color,
							sport: a.sport,
							laps: a.laps,
							schema: a.schema,
						}))}
						filter={intensityFilter}
						onToggleFilter={toggleFilter}
						onClearFilter={() => setIntensityFilter(new Set())}
					/>
				) : (
					<>
						{/* Subtle fetching hint while auto-laps recompute (no placeholderData). */}
						{targets.some((_, i) => autoLaps[i]?.isFetching) ? (
							<p className="text-xs text-gray-500">Computing auto-lap splits…</p>
						) : null}
						<AutoLapComparison
							columns={activities.map((a) => ({
								id: a.id,
								name: a.name,
								color: a.color,
								sport: a.sport,
								laps: a.autoLaps,
								schema: a.schema,
							}))}
						/>
					</>
				)}
			</div>
		</div>
	);
}

export default ActivityComparePage;
