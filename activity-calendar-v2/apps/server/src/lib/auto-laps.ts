/**
 * Auto-lap computation ported from the Streamlit app's `create_auto_laps` in lap_processing.py.
 *
 * Key algorithmic notes from the original Python implementation:
 * - Pause removal: Only explicit device pauses (stop_all/start events) are removed from
 *   elapsed time. A speed-based filter (STOP_THRESHOLD_MPS) was originally considered for
 *   removing "near-stationary" time (e.g., waiting at a light) but was disabled so that
 *   only explicit timer pauses affect the split times.
 * - Interpolation: To compute exact split times at precise mile boundaries, cumulative
 *   metrics (time, ascent, descent) are interpolated using np.interp. The x-axis (distance)
 *   must be strictly increasing, so duplicate distance values (standing still) are dropped.
 * - HR/Cadence binning: Each GPS point is assigned to an auto-lap using pd.cut, then
 *   aggregated per lap. Values are forced to numeric to handle empty bins gracefully.
 * - The last "partial" lap is always included (distance to the end of the activity).
 */
const METERS_PER_MILE = 1609.344;
const METERS_TO_FEET = 3.28084;
const MPS_TO_MPH = 2.23694;

interface RecordPoint {
	distance: number;
	timestamp: string;
	heartRate: number | null;
	cadence: number | null;
	enhancedSpeed: number | null;
	altitude: number | null;
}

interface TimerEvent {
	timestamp: string;
	event: string;
	eventType: string;
}

function interp(x: number, xp: number[], fp: number[]): number {
	if (xp.length === 0) return 0;
	if (x <= xp[0]!) return fp[0]!;
	if (x >= xp[xp.length - 1]!) return fp[fp.length - 1]!;
	let i = 0;
	while (i < xp.length - 1 && xp[i + 1]! < x) i++;
	const t = (x - xp[i]!) / (xp[i + 1]! - xp[i]!);
	return fp[i]! + t * (fp[i + 1]! - fp[i]!);
}

export function computeAutoLaps(records: RecordPoint[], events: TimerEvent[], sport: string, lapDistMiles: number) {
	if (records.length < 2) return [];

	const autoLapDist = lapDistMiles * METERS_PER_MILE;

	// Build pause intervals from stop_all/start pairs
	const pauses: { start: number; end: number }[] = [];
	let stopTime: number | null = null;
	for (const ev of events) {
		const ts = new Date(ev.timestamp).getTime() / 1000;
		if (ev.eventType === "stop_all") stopTime = ts;
		else if (ev.eventType === "start" && stopTime !== null) {
			pauses.push({ start: stopTime, end: ts });
			stopTime = null;
		}
	}

	// Compute cumulative moving seconds and ascent
	const dists: number[] = [];
	const cumMoving: number[] = [];
	const cumAscent: number[] = [];
	const cumDescent: number[] = [];
	const hrs: number[] = [];
	const cadences: number[] = [];

	let totalMoving = 0;
	let totalAscent = 0;
	let totalDescent = 0;

	for (let i = 0; i < records.length; i++) {
		const r = records[i]!;
		const ts = new Date(r.timestamp).getTime() / 1000;

		if (i > 0) {
			const prev = records[i - 1]!;
			const prevTs = new Date(prev.timestamp).getTime() / 1000;
			let diff = ts - prevTs;
			for (const p of pauses) {
				const overlapStart = Math.max(prevTs, p.start);
				const overlapEnd = Math.min(ts, p.end);
				if (overlapEnd > overlapStart) diff -= overlapEnd - overlapStart;
			}
			if (diff > 0) totalMoving += diff;

			const alt = r.altitude ?? 0;
			const prevAlt = prev.altitude ?? 0;
			const altDiff = alt - prevAlt;
			if (altDiff > 0) totalAscent += altDiff;
			else totalDescent += Math.abs(altDiff);
		}

		dists.push(r.distance ?? 0);
		cumMoving.push(totalMoving);
		cumAscent.push(totalAscent);
		cumDescent.push(totalDescent);
		hrs.push(r.heartRate ?? 0);
		cadences.push(r.cadence ?? 0);
	}

	const maxDist = dists[dists.length - 1]!;
	if (maxDist < autoLapDist) return [];

	// Build lap boundaries
	const boundaries: number[] = [0];
	for (let d = autoLapDist; d < maxDist; d += autoLapDist) boundaries.push(d);
	boundaries.push(maxDist);

	// Filter to monotonically increasing distances for interpolation
	const xp: number[] = [dists[0]!];
	const movingFp: number[] = [cumMoving[0]!];
	const ascentFp: number[] = [cumAscent[0]!];
	const descentFp: number[] = [cumDescent[0]!];
	for (let i = 1; i < dists.length; i++) {
		if (dists[i]! > xp[xp.length - 1]!) {
			xp.push(dists[i]!);
			movingFp.push(cumMoving[i]!);
			ascentFp.push(cumAscent[i]!);
			descentFp.push(cumDescent[i]!);
		}
	}

	const interpTimes = boundaries.map((d) => interp(d, xp, movingFp));
	const interpAscents = boundaries.map((d) => interp(d, xp, ascentFp));
	const interpDescents = boundaries.map((d) => interp(d, xp, descentFp));

	const laps = [];
	for (let i = 0; i < boundaries.length - 1; i++) {
		const dStart = boundaries[i]!;
		const dEnd = boundaries[i + 1]!;
		const timeSeconds = interpTimes[i + 1]! - interpTimes[i]!;
		const ascentFt = (interpAscents[i + 1]! - interpAscents[i]!) * METERS_TO_FEET;
		const descentFt = (interpDescents[i + 1]! - interpDescents[i]!) * METERS_TO_FEET;
		const distMi = (dEnd - dStart) / METERS_PER_MILE;
		const cumulativeDistanceMi = dEnd / METERS_PER_MILE;

		let hrSum = 0,
			hrMax = 0,
			hrCount = 0;
		let cadSum = 0,
			cadMax = 0,
			cadCount = 0;
		for (let j = 0; j < dists.length; j++) {
			if (dists[j]! >= dStart && dists[j]! < dEnd) {
				if (hrs[j]! > 0) {
					hrSum += hrs[j]!;
					hrMax = Math.max(hrMax, hrs[j]!);
					hrCount++;
				}
				if (cadences[j]! > 0) {
					cadSum += cadences[j]!;
					cadMax = Math.max(cadMax, cadences[j]!);
					cadCount++;
				}
			}
		}

		const avgSpeedMps = timeSeconds > 0 ? (dEnd - dStart) / timeSeconds : 0;
		const speedMph = avgSpeedMps * MPS_TO_MPH;
		const paceMinPerMile = speedMph > 0 ? 60 / speedMph : 0;

		laps.push({
			lap: i + 1,
			distanceMi: Math.round(distMi * 100) / 100,
			cumulativeDistanceMi: Math.round(cumulativeDistanceMi * 100) / 100,
			timeSeconds: Math.round(timeSeconds * 100) / 100,
			paceMinPerMile: sport === "running" ? Math.round(paceMinPerMile * 100) / 100 : null,
			speedMph: sport === "cycling" ? Math.round(speedMph * 100) / 100 : null,
			totalAscentFt: Math.round(ascentFt * 10) / 10,
			totalDescentFt: Math.round(descentFt * 10) / 10,
			avgHr: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
			maxHr: hrMax || null,
			avgCadence: cadCount > 0 ? Math.round((cadSum / cadCount) * (sport === "cycling" ? 1 : 2)) : null,
			maxCadence: cadMax ? Math.round(cadMax * (sport === "cycling" ? 1 : 2)) : null,
			cumulativeTimeSeconds: Math.round(interpTimes[i + 1]! * 100) / 100,
		});
	}

	return laps;
}
