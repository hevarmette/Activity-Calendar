/**
 * Geometry helpers shared by the map components.
 *
 * `downsample` is the exact uniform sampling scheme used by DetailMap for
 * polyline-rendering performance. `interpolatePoint` locates a position along a
 * time-stamped track for the compare-page animation markers.
 */

/** A GPS coordinate paired with an elapsed-time axis value (seconds). */
export interface LatLngTime {
	lat: number;
	lng: number;
	/** Elapsed time in seconds (RecordPoint.elapsedTime — pause-removed). */
	t: number;
}

/**
 * Downsample an array of coordinates to at most `maxPoints` using uniform
 * sampling. Always preserves the first and last point for route continuity.
 *
 * Copied verbatim from DetailMap's local implementation so both maps share one
 * sampling scheme.
 */
export function downsample(coords: [number, number][], maxPoints: number): [number, number][] {
	if (coords.length <= maxPoints) return coords;
	const step = (coords.length - 1) / (maxPoints - 1);
	const result: [number, number][] = [];
	for (let i = 0; i < maxPoints - 1; i++) {
		// biome-ignore lint/style/noNonNullAssertion: index is bounded by construction.
		result.push(coords[Math.round(i * step)]!);
	}
	// biome-ignore lint/style/noNonNullAssertion: coords.length > maxPoints >= 1 here.
	result.push(coords[coords.length - 1]!);
	return result;
}

/**
 * Interpolate a lat/lng position along a time-stamped track at target time `t`.
 *
 * Binary-searches the segment [i, i+1] where track[i].t <= t <= track[i+1].t and
 * linearly interpolates between the two GPS points. Clamps to the first point
 * when `t` precedes the track and to the last point when `t` runs past its end.
 *
 * @returns `[lat, lng]` or `null` when the track is empty.
 */
export function interpolatePoint(track: LatLngTime[], t: number): [number, number] | null {
	if (track.length === 0) return null;
	// biome-ignore lint/style/noNonNullAssertion: length checked above.
	const first = track[0]!;
	// biome-ignore lint/style/noNonNullAssertion: length checked above.
	const last = track[track.length - 1]!;
	if (track.length === 1 || t <= first.t) return [first.lat, first.lng];
	if (t >= last.t) return [last.lat, last.lng];

	// Binary search for the segment containing t.
	let lo = 0;
	let hi = track.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		// biome-ignore lint/style/noNonNullAssertion: mid within [lo, hi].
		if (track[mid]!.t <= t) lo = mid;
		else hi = mid;
	}
	// biome-ignore lint/style/noNonNullAssertion: lo within bounds.
	const a = track[lo]!;
	// biome-ignore lint/style/noNonNullAssertion: hi within bounds.
	const b = track[hi]!;
	const span = b.t - a.t;
	const frac = span > 0 ? (t - a.t) / span : 0;
	return [a.lat + frac * (b.lat - a.lat), a.lng + frac * (b.lng - a.lng)];
}
