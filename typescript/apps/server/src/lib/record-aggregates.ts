/**
 * Shared record-summary math for recomputing session/lap aggregates from raw
 * `record` rows.
 *
 * The pause-interval and smoothed-altitude ascent/descent algorithms here are
 * the canonical implementations also used (in duplicated form) by
 * `lib/auto-laps.ts` and `routes/records.ts`. The trim route
 * (`routes/trim.ts`) relies on them to recompute a session's summary fields
 * from its surviving records after a destructive trim, since nothing else in
 * the stack derives those fields (they are otherwise imported straight from
 * the FIT file).
 *
 * Units match how the FIT import stores them on the DB rows:
 *   - `distance` is a cumulative odometer in METERS.
 *   - times are in SECONDS.
 *   - `total_ascent` / `total_descent` are in METERS (auto-laps converts to
 *     feet for display, but the stored session columns are meters — so these
 *     helpers deliberately return meters).
 */

/** A raw `record` row, with only the columns the aggregate math reads. */
export interface RecordInput {
	/** Cumulative odometer distance in meters from activity start. */
	distance: number | null;
	/** ISO timestamp of the sample. */
	timestamp: string;
	/** Instantaneous heart rate in bpm, if recorded. */
	heartRate: number | null;
	/** Instantaneous speed in meters/second, if recorded. */
	enhancedSpeed: number | null;
	/** Instantaneous power in watts, if recorded. */
	power?: number | null;
	/** Barometric/GPS altitude in meters, if recorded. */
	altitude: number | null;
}

/** A timer `event` row (event = 'timer'), with the columns pause math reads. */
export interface EventInput {
	/** ISO timestamp of the event. */
	timestamp: string;
	/** Event name (always 'timer' for the rows we care about). */
	event: string;
	/** 'stop_all' opens a pause; 'start' closes it. */
	eventType: string;
}

/** A half-open paused interval `[start, end)` expressed in epoch seconds. */
export interface PauseInterval {
	/** Pause start, epoch seconds. */
	start: number;
	/** Pause end, epoch seconds. */
	end: number;
}

/** The HR/speed/power aggregates recomputed from a set of records. */
export interface RecordAggregates {
	/** Mean heart rate over records with a non-null, positive HR; null if none. */
	avgHr: number | null;
	/** Maximum heart rate over records; null if none recorded. */
	maxHr: number | null;
	/** Mean speed in m/s over records with a positive speed; null if none. */
	avgSpeedMps: number | null;
	/** Maximum speed in m/s over records; null if none recorded. */
	maxSpeedMps: number | null;
	/** Mean power in watts over records with a positive power; null if none. */
	avgPower: number | null;
}

/** The full recomputed session field set, in stored DB units. */
export interface SessionSummary {
	/** `last.distance - first.distance`, meters. */
	totalDistance: number;
	/** Wall-clock span `lastTs - firstTs`, seconds. */
	totalElapsedTime: number;
	/** Elapsed minus paused intervals, seconds. */
	totalTimerTime: number;
	/** Smoothed, dead-banded cumulative ascent, meters. */
	totalAscent: number;
	/** Smoothed, dead-banded cumulative descent, meters. */
	totalDescent: number;
	/** Mean HR over records, bpm; null if none. */
	avgHeartRate: number | null;
	/** Max HR over records, bpm; null if none. */
	maxHeartRate: number | null;
	/** Mean speed over records, m/s; null if none. */
	avgSpeedMps: number | null;
	/** Mean power over records, watts; null if none. */
	avgPower: number | null;
}

/** 5-point centered moving-average window for altitude smoothing. */
const SMOOTH_WINDOW = 5;
/** Dead-band (meters) below which altitude deltas are ignored (~2 ft). */
const ELEV_THRESHOLD_M = 0.6;

/** Parse an ISO timestamp to epoch seconds. */
function tsSeconds(iso: string): number {
	return new Date(iso).getTime() / 1000;
}

/**
 * Build pause intervals from `timer` stop_all/start event pairs.
 *
 * Mirrors the logic in `auto-laps.ts` and `records.ts`: a `stop_all` opens a
 * pause and the next `start` closes it. Unpaired events are ignored.
 *
 * @param events - Timer events in timestamp order.
 * @returns The paused intervals in epoch seconds.
 */
export function buildPauseIntervals(events: EventInput[]): PauseInterval[] {
	const pauses: PauseInterval[] = [];
	let stopTime: number | null = null;
	for (const ev of events) {
		const ts = tsSeconds(ev.timestamp);
		if (ev.eventType === "stop_all") stopTime = ts;
		else if (ev.eventType === "start" && stopTime !== null) {
			pauses.push({ start: stopTime, end: ts });
			stopTime = null;
		}
	}
	return pauses;
}

/**
 * Compute moving (timer) seconds across records with paused intervals removed.
 *
 * Walks consecutive record pairs, summing the wall-clock delta between them and
 * subtracting any overlap with a pause interval — the same per-step subtraction
 * used by `auto-laps.ts`.
 *
 * @param records - Records in timestamp order (need >= 2 to accumulate time).
 * @param pauses - Pause intervals from {@link buildPauseIntervals}.
 * @returns Total moving time in seconds.
 */
export function movingSeconds(records: RecordInput[], pauses: PauseInterval[]): number {
	let totalMoving = 0;
	for (let i = 1; i < records.length; i++) {
		const ts = tsSeconds(records[i]!.timestamp);
		const prevTs = tsSeconds(records[i - 1]!.timestamp);
		let diff = ts - prevTs;
		for (const p of pauses) {
			const overlapStart = Math.max(prevTs, p.start);
			const overlapEnd = Math.min(ts, p.end);
			if (overlapEnd > overlapStart) diff -= overlapEnd - overlapStart;
		}
		if (diff > 0) totalMoving += diff;
	}
	return totalMoving;
}

/**
 * Compute cumulative ascent and descent in meters.
 *
 * Applies the identical altitude treatment used by `auto-laps.ts`: a 5-point
 * centered moving average to suppress sensor noise, then a 0.6 m dead-band so
 * only meaningful elevation changes accumulate. Returns meters (the stored
 * session unit); callers that display feet convert separately.
 *
 * @param records - Records in timestamp order.
 * @returns `{ ascentM, descentM }` cumulative ascent/descent in meters.
 */
export function ascentDescent(records: RecordInput[]): { ascentM: number; descentM: number } {
	const rawAlt = records.map((r) => r.altitude ?? 0);
	const smoothedAlt: number[] = new Array(rawAlt.length);
	const half = Math.floor(SMOOTH_WINDOW / 2);
	for (let i = 0; i < rawAlt.length; i++) {
		let sum = 0;
		let count = 0;
		for (let j = Math.max(0, i - half); j <= Math.min(rawAlt.length - 1, i + half); j++) {
			sum += rawAlt[j]!;
			count++;
		}
		smoothedAlt[i] = sum / count;
	}

	let ascentM = 0;
	let descentM = 0;
	for (let i = 1; i < smoothedAlt.length; i++) {
		const altDiff = smoothedAlt[i]! - smoothedAlt[i - 1]!;
		if (altDiff > ELEV_THRESHOLD_M) ascentM += altDiff;
		else if (altDiff < -ELEV_THRESHOLD_M) descentM += Math.abs(altDiff);
	}
	return { ascentM, descentM };
}

/**
 * Aggregate HR, speed, and power over a set of records.
 *
 * Averages are taken over records with a positive value (zeros/nulls are
 * treated as "not recorded", matching the auto-laps binning) and maxima over
 * non-null values. Any aggregate with no contributing samples is null.
 *
 * @param records - Records to aggregate.
 * @returns The {@link RecordAggregates}.
 */
export function recordAggregates(records: RecordInput[]): RecordAggregates {
	let hrSum = 0;
	let hrCount = 0;
	let hrMax = 0;
	let spdSum = 0;
	let spdCount = 0;
	let spdMax = 0;
	let pwrSum = 0;
	let pwrCount = 0;

	for (const r of records) {
		const hr = r.heartRate;
		if (hr != null && hr > 0) {
			hrSum += hr;
			hrCount++;
			if (hr > hrMax) hrMax = hr;
		}
		const spd = r.enhancedSpeed;
		if (spd != null && spd > 0) {
			spdSum += spd;
			spdCount++;
			if (spd > spdMax) spdMax = spd;
		}
		const pwr = r.power;
		if (pwr != null && pwr > 0) {
			pwrSum += pwr;
			pwrCount++;
		}
	}

	return {
		avgHr: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
		maxHr: hrMax > 0 ? hrMax : null,
		avgSpeedMps: spdCount > 0 ? spdSum / spdCount : null,
		maxSpeedMps: spdMax > 0 ? spdMax : null,
		avgPower: pwrCount > 0 ? Math.round(pwrSum / pwrCount) : null,
	};
}

/**
 * Recompute the full session summary field set from surviving records.
 *
 * Combines the distance/time/elevation/aggregate helpers into the exact shape a
 * session row needs after a trim:
 *   - `totalDistance` = `last.distance - first.distance` (odometer rebased to
 *     the kept window; per-record distances are never rewritten).
 *   - `totalElapsedTime` = `lastTs - firstTs` in seconds.
 *   - `totalTimerTime` = elapsed minus pauses (via {@link movingSeconds}).
 *   - `totalAscent` / `totalDescent` in meters (via {@link ascentDescent}).
 *   - HR/speed/power via {@link recordAggregates}.
 *
 * @param records - Surviving records in timestamp order (expects >= 1; >= 2 for
 *   meaningful time/elevation).
 * @param events - Timer events spanning the kept window.
 * @returns The recomputed {@link SessionSummary}; a zeroed summary when
 *   `records` is empty.
 */
export function sessionSummaryFromRecords(records: RecordInput[], events: EventInput[]): SessionSummary {
	if (records.length === 0) {
		return {
			totalDistance: 0,
			totalElapsedTime: 0,
			totalTimerTime: 0,
			totalAscent: 0,
			totalDescent: 0,
			avgHeartRate: null,
			maxHeartRate: null,
			avgSpeedMps: null,
			avgPower: null,
		};
	}

	const first = records[0]!;
	const last = records[records.length - 1]!;
	const totalDistance = (last.distance ?? 0) - (first.distance ?? 0);
	const totalElapsedTime = tsSeconds(last.timestamp) - tsSeconds(first.timestamp);
	const pauses = buildPauseIntervals(events);
	const totalTimerTime = movingSeconds(records, pauses);
	const { ascentM, descentM } = ascentDescent(records);
	const agg = recordAggregates(records);

	return {
		totalDistance,
		totalElapsedTime,
		totalTimerTime,
		totalAscent: ascentM,
		totalDescent: descentM,
		avgHeartRate: agg.avgHr,
		maxHeartRate: agg.maxHr,
		avgSpeedMps: agg.avgSpeedMps,
		avgPower: agg.avgPower,
	};
}
