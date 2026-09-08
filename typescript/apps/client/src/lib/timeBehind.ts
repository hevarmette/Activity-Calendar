/**
 * Pure helpers for the compare-page "how far behind over time" delta chart.
 *
 * The delta chart answers: over a shared DISTANCE axis, how far behind (in TIME)
 * is activity B versus activity A? For a common cumulative distance `d`, we
 * define `delta(d) = timeB_at_distance(d) − timeA_at_distance(d)` in seconds.
 * Positive means B is behind (slower to reach `d`); negative means B is ahead.
 *
 * These functions are intentionally free of React and Recharts so the
 * interpolation math can be reasoned about (and unit-tested) in isolation.
 */

import { METERS_PER_MILE } from "@activity-calendar/shared";
import type { RecordPoint } from "@activity-calendar/shared";

/** A single (cumulative distance in miles, elapsed time in seconds) sample. */
export interface DistTimePoint {
	/** Cumulative distance from the activity start, in miles. */
	distMiles: number;
	/** Elapsed (pause-removed) time from the activity start, in seconds. */
	t: number;
}

/** One point of the shared delta series: distance (mi) with B−A time delta (s). */
export interface DeltaPoint {
	/** Shared cumulative distance, in miles. */
	distMiles: number;
	/** timeB(d) − timeA(d), in seconds. Positive = B behind, negative = B ahead. */
	deltaSeconds: number;
}

/**
 * A named, colored delta series for one non-baseline activity in the N-activity
 * compare chart. Each entry's {@link series} holds `thisActivity − baseline`
 * time deltas over the shared distance grid (positive = this activity behind).
 */
export interface NamedDeltaSeries {
	/**
	 * Stable unique identifier for this series (e.g. the serialized compare id).
	 * Used as the Recharts dataKey / row key so two activities with the SAME
	 * display name never collide into one line.
	 */
	key: string;
	/** Display name of the activity this series represents (label only). */
	name: string;
	/** Line color (matches the activity's compare palette color). */
	color: string;
	/** The activity's delta-vs-baseline points over the shared distance grid. */
	series: DeltaPoint[];
}

/**
 * Build a monotonic distance/time track from record points.
 *
 * Only points carrying a non-null distance are kept. Both distance and time are
 * rebased to the first kept point so the series starts at (0, 0) — mirroring the
 * baseline subtraction in {@link PerformanceCharts} `buildChartData`, which keeps
 * multisport sessions starting at zero. Distance is converted to miles; time is
 * left in seconds.
 *
 * Note: the page's existing `buildTrack` drops distance (it only needs lat/lng/t
 * for map animation), so this is a separate pass over the same record points.
 */
export function buildDistTimeTrack(points: RecordPoint[] | undefined): DistTimePoint[] {
	if (!points || points.length === 0) return [];
	const withDist = points.filter((p) => p.distance != null);
	if (withDist.length === 0) return [];
	// biome-ignore lint/style/noNonNullAssertion: filtered to non-null distance above.
	const baseDistance = withDist[0]!.distance as number;
	// biome-ignore lint/style/noNonNullAssertion: length checked above.
	const baseTime = withDist[0]!.elapsedTime;
	// Enforce a monotonically non-decreasing distance axis: interpolateTimeAtDistance
	// binary-searches on distance, so a backward/stationary GPS sample (occasional
	// noise) would otherwise corrupt the interpolated delta near that point. We clamp
	// each sample's distance to the running max rather than dropping the sample, so its
	// (later) time still anchors the curve.
	let runningMax = Number.NEGATIVE_INFINITY;
	return withDist.map((p) => {
		const dist = ((p.distance as number) - baseDistance) / METERS_PER_MILE;
		runningMax = Math.max(runningMax, dist);
		return {
			distMiles: runningMax,
			t: p.elapsedTime - baseTime,
		};
	});
}

/**
 * Linearly interpolate the elapsed time at a target cumulative distance.
 *
 * Binary-searches the segment `[i, i+1]` where `track[i].distMiles <= d <=
 * track[i+1].distMiles` and linearly interpolates time against distance — the
 * distance-domain analogue of {@link interpolatePoint} in `geo.ts` (which
 * interpolates lat/lng against time). Clamps to the first sample when `d`
 * precedes the track and to the last sample when `d` runs past its end.
 *
 * @returns elapsed time in seconds, or `null` when the track is empty.
 */
export function interpolateTimeAtDistance(track: DistTimePoint[], d: number): number | null {
	if (track.length === 0) return null;
	// biome-ignore lint/style/noNonNullAssertion: length checked above.
	const first = track[0]!;
	// biome-ignore lint/style/noNonNullAssertion: length checked above.
	const last = track[track.length - 1]!;
	if (track.length === 1 || d <= first.distMiles) return first.t;
	if (d >= last.distMiles) return last.t;

	// Binary search for the segment whose distance range brackets `d`.
	let lo = 0;
	let hi = track.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		// biome-ignore lint/style/noNonNullAssertion: mid within [lo, hi].
		if (track[mid]!.distMiles <= d) lo = mid;
		else hi = mid;
	}
	// biome-ignore lint/style/noNonNullAssertion: lo within bounds.
	const a = track[lo]!;
	// biome-ignore lint/style/noNonNullAssertion: hi within bounds.
	const b = track[hi]!;
	const span = b.distMiles - a.distMiles;
	const frac = span > 0 ? (d - a.distMiles) / span : 0;
	return a.t + frac * (b.t - a.t);
}

/**
 * Build the shared distance-domain delta series for two activities.
 *
 * A uniform distance grid is laid out from 0 to `min(maxDistA, maxDistB)` — the
 * furthest distance both activities actually reached, so every sample has real
 * (interpolated, never extrapolated) data on both sides. For each grid distance
 * the elapsed time of each activity is interpolated and `deltaSeconds = tB − tA`
 * is recorded. No values are rounded here; rounding is a display concern.
 *
 * @param trackA distance/time samples for activity A (from {@link buildDistTimeTrack})
 * @param trackB distance/time samples for activity B
 * @param stepMiles grid spacing in miles (default 0.05 ≈ every ~80 m)
 * @returns delta series, or `[]` when the shared range is empty
 */
export function buildDeltaSeries(trackA: DistTimePoint[], trackB: DistTimePoint[], stepMiles = 0.05): DeltaPoint[] {
	if (trackA.length === 0 || trackB.length === 0) return [];
	// biome-ignore lint/style/noNonNullAssertion: length checked above.
	const maxA = trackA[trackA.length - 1]!.distMiles;
	// biome-ignore lint/style/noNonNullAssertion: length checked above.
	const maxB = trackB[trackB.length - 1]!.distMiles;
	const maxShared = Math.min(maxA, maxB);
	if (!(maxShared > 0) || !(stepMiles > 0)) return [];

	const series: DeltaPoint[] = [];
	for (let d = 0; d <= maxShared + 1e-9; d += stepMiles) {
		const dClamped = Math.min(d, maxShared);
		const tA = interpolateTimeAtDistance(trackA, dClamped);
		const tB = interpolateTimeAtDistance(trackB, dClamped);
		if (tA == null || tB == null) continue;
		series.push({ distMiles: dClamped, deltaSeconds: tB - tA });
	}
	return series;
}

/** An input activity for {@link buildMultiDeltaSeries}: its track plus display metadata. */
export interface NamedDistTimeTrack {
	/** Stable unique identifier (e.g. serialized compare id) — used as the series key. */
	key: string;
	/** Display name of the activity. */
	name: string;
	/** Line color (from the compare palette). */
	color: string;
	/** Distance/time samples (from {@link buildDistTimeTrack}). */
	track: DistTimePoint[];
}

/**
 * Build one delta series per non-baseline activity for the N-activity time-behind
 * chart.
 *
 * The FIRST activity is the baseline (its own delta is always zero, so it is not
 * emitted). For every other activity, {@link buildDeltaSeries} computes
 * `thisActivity − baseline` over their shared distance range. Activities whose
 * series come back empty — no distance data, or no overlapping distance range
 * with the baseline — are dropped so the chart never renders a flat/empty line.
 *
 * @param baseline - The reference activity (delta = 0), rendered separately by name.
 * @param others - Every other activity, in display order.
 * @param stepMiles - Distance grid spacing in miles (default 0.05 ≈ every ~80 m).
 * @returns One {@link NamedDeltaSeries} per non-empty non-baseline activity.
 */
export function buildMultiDeltaSeries(
	baseline: DistTimePoint[],
	others: NamedDistTimeTrack[],
	stepMiles = 0.05,
): NamedDeltaSeries[] {
	if (baseline.length === 0) return [];
	const out: NamedDeltaSeries[] = [];
	for (const other of others) {
		const series = buildDeltaSeries(baseline, other.track, stepMiles);
		if (series.length === 0) continue;
		out.push({ key: other.key, name: other.name, color: other.color, series });
	}
	return out;
}
