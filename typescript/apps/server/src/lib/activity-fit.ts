/**
 * Activity FIT encoder — reconstructs a Garmin-compatible ACTIVITY .fit file
 * from database rows (activity, sessions, laps, records, events, lengths).
 *
 * This is distinct from the WORKOUT encoder in routes/workouts.ts. A workout
 * file describes a *planned* session (FILE_ID type "workout" + WORKOUT_STEP
 * messages). An activity file describes a *completed* session with recorded
 * GPS + sensor time-series (FILE_ID type "activity" + RECORD/LAP/SESSION/
 * EVENT/ACTIVITY messages).
 *
 * SCALING NOTE (verified empirically via an Encoder→Decoder round-trip):
 * The SDK auto-applies the standard Profile scales for most RECORD/LAP/SESSION
 * fields, so we pass NATURAL units and let the SDK convert:
 *   - altitude:                   meters          (SDK → scaled uint16)
 *   - speed / enhancedSpeed:      m/s             (SDK → mm/s)
 *   - distance / totalDistance:   meters          (SDK → cm)
 *   - totalTimerTime / elapsed:   seconds         (SDK → ms)
 *   - timestamps:                 JS Date objects (SDK → FIT epoch 1989-12-31)
 * EXCEPTION: positionLat / positionLong are NOT auto-scaled — they are written
 * to their raw sint32 base type, so we MUST pre-convert degrees → semicircles
 * ourselves (see SEMICIRCLES_PER_DEGREE). Passing raw degrees truncates the
 * coordinate to an integer.
 *
 * Coordinates that are null are OMITTED from the RECORD message (never emitted
 * as 0,0, which would place points off the coast of Africa). Manual activities
 * with no records simply produce a file with LAP/SESSION/ACTIVITY but no RECORD.
 */

import { Encoder, Profile } from "@garmin/fitsdk";

// Profile.MesgNum is typed Record<string, number>; under noUncheckedIndexedAccess
// indexed access widens to number | undefined. Capture the numbers we use once,
// narrowed to number, so the encoder calls stay type-clean.
const MESG = Profile.MesgNum as Record<string, number>;
const FILE_ID = MESG.FILE_ID as number;
const EVENT = MESG.EVENT as number;
const RECORD = MESG.RECORD as number;
const LAP = MESG.LAP as number;
const LENGTH = MESG.LENGTH as number;
const SESSION = MESG.SESSION as number;
const ACTIVITY = MESG.ACTIVITY as number;

/** Sport strings we store → FIT sport enum values (identity for the common set). */
const SPORT_MAP: Record<string, string> = {
	running: "running",
	cycling: "cycling",
	swimming: "swimming",
};

/**
 * Degrees → semicircles conversion factor (2^31 / 180).
 *
 * IMPORTANT: unlike speed/distance/altitude — which the SDK auto-scales for
 * RECORD messages — position fields are written to their raw sint32 base type
 * WITHOUT the profile's degree scaling. So passing raw degrees truncates to an
 * integer (33.46° → 33). We must pre-convert to semicircles ourselves.
 * (Verified via an Encoder→Decoder round-trip against real activity data.)
 */
const SEMICIRCLES_PER_DEGREE = 2 ** 31 / 180;

/** Convert decimal degrees to FIT semicircles (int32). Returns undefined for null. */
function toSemicircles(deg: number | undefined): number | undefined {
	if (deg === undefined) return undefined;
	return Math.round(deg * SEMICIRCLES_PER_DEGREE);
}

function mapSport(sport: string | null | undefined): string {
	if (!sport) return "generic";
	const mapped = SPORT_MAP[sport] ?? sport;
	return normalizeEnum("sport", mapped, "generic") ?? "generic";
}

/** Convert a snake_case value to camelCase (e.g. "indoor_cycling" → "indoorCycling"). */
function toCamel(value: string): string {
	return value.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Normalize an enum string field to a value the FIT SDK accepts.
 *
 * The DB stores enum values in snake_case (e.g. "indoor_cycling", "lap_swimming",
 * "open_water", "active"), but the SDK's Profile enums are camelCase
 * ("indoorCycling", "lapSwimming", "openWater", "active"). We convert to
 * camelCase and validate against the SDK's known values for the given type,
 * falling back to `fallback` when the value is unknown so encoding never fails
 * on an unexpected enum.
 */
function normalizeEnum(typeName: string, value: string | null | undefined, fallback?: string): string | undefined {
	if (value === null || value === undefined || value === "") return fallback;
	const known = (Profile as unknown as { types: Record<string, Record<number, string>> }).types[typeName];
	const valid = known ? new Set(Object.values(known)) : null;
	if (valid?.has(value)) return value;
	const camel = toCamel(value);
	if (!valid || valid.has(camel)) return camel;
	return fallback;
}

/** Coerce a value that may arrive as a numeric string (postgres NUMERIC) to a number. */
function num(value: unknown): number | undefined {
	if (value === null || value === undefined) return undefined;
	const n = typeof value === "string" ? Number(value) : (value as number);
	return Number.isFinite(n) ? n : undefined;
}

function toDate(value: unknown): Date | undefined {
	if (!value) return undefined;
	const d = value instanceof Date ? value : new Date(value as string);
	return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Assign a key only when the value is defined — keeps optional FIT fields out. */
function setIf(mesg: Record<string, unknown>, key: string, value: unknown): void {
	if (value !== undefined && value !== null) mesg[key] = value;
}

// --- Row shapes (subset of columns the encoder consumes) ---

export interface ActivityRow {
	activityId: number;
	timestamp: string | Date;
	activityName: string | null;
	numSessions: number | null;
	totalTimerTime: number | string | null;
}

export interface SessionRow {
	sessionId: number;
	sport: string | null;
	subSport: string | null;
	startTime: string | Date;
	timestamp: string | Date;
	totalDistance: number | string | null;
	totalTimerTime: number | string | null;
	totalElapsedTime: number | string | null;
	avgSpeed: number | string | null;
	enhancedAvgSpeed: number | string | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
	avgPower: number | string | null;
	totalAscent: number | null;
	totalDescent: number | null;
	firstLapIndex: number;
	numLaps: number;
	poolLength: number | string | null;
}

export interface LapRow {
	number: number;
	startTime: string | Date;
	totalDistance: number | string | null;
	totalTimerTime: number | string | null;
	totalAscent: number | null;
	totalDescent: number | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
	avgPower: number | string | null;
	maxPower: number | string | null;
	intensity: string | null;
}

export interface RecordRow {
	timestamp: string | Date;
	latitude: number | string | null;
	longitude: number | string | null;
	lap: number | null;
	altitude: number | string | null;
	heartRate: number | null;
	cadence: number | null;
	fractionalCadence: number | string | null;
	enhancedSpeed: number | string | null;
	distance: number | string | null;
}

export interface EventRow {
	timestamp: string | Date;
	event: string;
	eventType: string;
}

export interface LengthRow {
	messageIndex: number;
	totalTimerTime: number | string | null;
	totalStrokes: number | null;
	avgSpeed: number | string | null;
	swimStroke: string | null;
	lengthType: string | null;
}

/** Everything the encoder needs for a single activity. */
export interface ActivityFitInput {
	activity: ActivityRow;
	sessions: SessionRow[];
	laps: LapRow[];
	records: RecordRow[];
	events: EventRow[];
	lengths: LengthRow[];
}

/**
 * Build a filesystem-safe .fit filename for an activity, e.g.
 * "2025-10-09_Morning_Run_20641745871.fit".
 */
export function buildActivityFilename(activity: ActivityRow): string {
	const date = toDate(activity.timestamp);
	const datePart = date ? date.toISOString().slice(0, 10) : "activity";
	const namePart = (activity.activityName ?? "activity").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
	return `${datePart}_${namePart}_${activity.activityId}.fit`;
}

/**
 * Encode a single activity into a binary FIT Uint8Array.
 *
 * Message ordering (FIT activity file convention):
 *   FILE_ID → [EVENT timer start] → RECORD* → LAP* → LENGTH* (swims) →
 *   SESSION* → [EVENT timer stop] → ACTIVITY
 *
 * Records and laps are attributed to their owning session for multisport
 * activities using each session's firstLapIndex / numLaps window and time
 * bounds, then written grouped per session so the file decodes cleanly.
 */
export function encodeFitActivity(input: ActivityFitInput): Uint8Array {
	const { activity, sessions, laps, records, events, lengths } = input;
	const encoder = new Encoder();

	const activityStart =
		toDate(sessions[0]?.startTime) ?? toDate(records[0]?.timestamp) ?? toDate(activity.timestamp) ?? new Date();
	const activityEnd = toDate(activity.timestamp) ?? activityStart;

	// 1. FILE_ID (must be first)
	const fileIdMesg: Record<string, unknown> = {
		type: "activity",
		manufacturer: "garmin",
		product: 0,
		timeCreated: activityEnd,
		serialNumber: Number(activity.activityId) % 2147483647,
	};
	encoder.onMesg(FILE_ID, fileIdMesg);

	// Chronological event lookup for start/stop timer events.
	const startEvent = events.find((e) => e.event === "timer" && e.eventType === "start");
	const stopEvent = [...events].reverse().find((e) => e.event === "timer" && e.eventType.startsWith("stop"));

	// 2. EVENT — timer start
	const startEventMesg: Record<string, unknown> = {
		timestamp: toDate(startEvent?.timestamp) ?? activityStart,
		event: "timer",
		eventType: "start",
	};
	encoder.onMesg(EVENT, startEventMesg);

	// Sort a working copy of records chronologically.
	const sortedRecords = [...records].sort(
		(a, b) => (toDate(a.timestamp)?.getTime() ?? 0) - (toDate(b.timestamp)?.getTime() ?? 0),
	);

	const multisport = (sessions.length || 0) > 1;

	// Helper to emit one session's records, laps, lengths, then the session mesg.
	const emitSession = (session: SessionRow, sessionRecords: RecordRow[], sessionLaps: LapRow[], msgIdx: number) => {
		// RECORD messages
		for (const r of sessionRecords) {
			const ts = toDate(r.timestamp);
			if (!ts) continue;
			const mesg: Record<string, unknown> = { timestamp: ts };
			const lat = num(r.latitude);
			const lon = num(r.longitude);
			// Only emit coordinates when BOTH are present — never 0,0.
			if (lat !== undefined && lon !== undefined) {
				mesg.positionLat = toSemicircles(lat);
				mesg.positionLong = toSemicircles(lon);
			}
			setIf(mesg, "altitude", num(r.altitude));
			setIf(mesg, "heartRate", r.heartRate ?? undefined);
			setIf(mesg, "cadence", r.cadence ?? undefined);
			setIf(mesg, "fractionalCadence", num(r.fractionalCadence));
			setIf(mesg, "enhancedSpeed", num(r.enhancedSpeed));
			setIf(mesg, "distance", num(r.distance));
			encoder.onMesg(RECORD, mesg);
		}

		// LAP messages
		for (const lap of sessionLaps) {
			const mesg: Record<string, unknown> = {
				messageIndex: lap.number,
				startTime: toDate(lap.startTime) ?? activityStart,
				timestamp: toDate(lap.startTime) ?? activityStart,
			};
			setIf(mesg, "totalDistance", num(lap.totalDistance));
			setIf(mesg, "totalTimerTime", num(lap.totalTimerTime));
			setIf(mesg, "totalElapsedTime", num(lap.totalTimerTime));
			setIf(mesg, "totalAscent", lap.totalAscent ?? undefined);
			setIf(mesg, "totalDescent", lap.totalDescent ?? undefined);
			setIf(mesg, "avgHeartRate", lap.avgHeartRate ?? undefined);
			setIf(mesg, "maxHeartRate", lap.maxHeartRate ?? undefined);
			setIf(mesg, "avgPower", num(lap.avgPower));
			setIf(mesg, "maxPower", num(lap.maxPower));
			setIf(mesg, "intensity", normalizeEnum("intensity", lap.intensity));
			encoder.onMesg(LAP, mesg);
		}

		// LENGTH messages (swims) — only attached to the first/only session.
		if (msgIdx === 0) {
			for (const len of lengths) {
				const mesg: Record<string, unknown> = {
					messageIndex: len.messageIndex,
					timestamp: toDate(session.timestamp) ?? activityEnd,
				};
				setIf(mesg, "totalTimerTime", num(len.totalTimerTime));
				setIf(mesg, "totalStrokes", len.totalStrokes ?? undefined);
				setIf(mesg, "avgSpeed", num(len.avgSpeed));
				setIf(mesg, "swimStroke", normalizeEnum("swimStroke", len.swimStroke));
				setIf(mesg, "lengthType", normalizeEnum("lengthType", len.lengthType));
				encoder.onMesg(LENGTH, mesg);
			}
		}

		// SESSION message
		const sessionMesg: Record<string, unknown> = {
			messageIndex: msgIdx,
			startTime: toDate(session.startTime) ?? activityStart,
			timestamp: toDate(session.timestamp) ?? activityEnd,
			sport: mapSport(session.sport),
			subSport: normalizeEnum("subSport", session.subSport, "generic"),
			firstLapIndex: session.firstLapIndex,
			numLaps: session.numLaps,
		};
		setIf(sessionMesg, "totalDistance", num(session.totalDistance));
		setIf(sessionMesg, "totalTimerTime", num(session.totalTimerTime));
		setIf(sessionMesg, "totalElapsedTime", num(session.totalElapsedTime) ?? num(session.totalTimerTime));
		setIf(sessionMesg, "avgSpeed", num(session.enhancedAvgSpeed) ?? num(session.avgSpeed));
		setIf(sessionMesg, "enhancedAvgSpeed", num(session.enhancedAvgSpeed) ?? num(session.avgSpeed));
		setIf(sessionMesg, "avgHeartRate", session.avgHeartRate ?? undefined);
		setIf(sessionMesg, "maxHeartRate", session.maxHeartRate ?? undefined);
		setIf(sessionMesg, "avgPower", num(session.avgPower));
		setIf(sessionMesg, "totalAscent", session.totalAscent ?? undefined);
		setIf(sessionMesg, "totalDescent", session.totalDescent ?? undefined);
		encoder.onMesg(SESSION, sessionMesg);
	};

	if (!multisport) {
		// Sum lap distances for the fallback session's total distance. Manual /
		// session-less activities have no session row, so we reconstruct distance
		// from the recorded laps rather than a duration field.
		const fallbackDistance = laps.reduce((sum, lap) => sum + (num(lap.totalDistance) ?? 0), 0);
		const session =
			sessions[0] ??
			({
				sessionId: 0,
				sport: "generic",
				subSport: "generic",
				startTime: activityStart,
				timestamp: activityEnd,
				totalDistance: fallbackDistance > 0 ? fallbackDistance : null,
				totalTimerTime: num(activity.totalTimerTime) ?? null,
				totalElapsedTime: num(activity.totalTimerTime) ?? null,
				avgSpeed: null,
				enhancedAvgSpeed: null,
				avgHeartRate: null,
				maxHeartRate: null,
				avgPower: null,
				totalAscent: null,
				totalDescent: null,
				firstLapIndex: 0,
				numLaps: laps.length,
				poolLength: null,
			} satisfies SessionRow);
		emitSession(session, sortedRecords, laps, 0);
	} else {
		// Multisport: laps are sliced from the sorted lap array by each session's
		// [firstLapIndex, firstLapIndex + numLaps) window (firstLapIndex is a
		// 0-based index into the lap array).
		//
		// Every record is assigned to exactly one session so none are dropped:
		//   1. By lap membership — record.lap (1-based lap.number) is in the
		//      session's lap-number set. This is the most reliable across
		//      sport transitions.
		//   2. Otherwise by time window (records with null lap, or a lap number
		//      that no session claims — e.g. a trailing boundary point).
		//   3. Any still-unassigned record falls to the nearest session by start
		//      time, guaranteeing the record count is preserved.
		const sortedLaps = [...laps].sort((a, b) => a.number - b.number);
		const sessionLapSets: Set<number>[] = [];
		const sessionLapArrays: LapRow[][] = [];
		const sessionBounds: { start: number; end: number }[] = [];
		for (const session of sessions) {
			const sLaps = sortedLaps.slice(session.firstLapIndex, session.firstLapIndex + session.numLaps);
			sessionLapArrays.push(sLaps);
			sessionLapSets.push(new Set(sLaps.map((l) => l.number)));
			const start = toDate(session.startTime)?.getTime() ?? 0;
			const end = start + (num(session.totalElapsedTime) ?? num(session.totalTimerTime) ?? 0) * 1000;
			sessionBounds.push({ start, end });
		}

		const bucketed: RecordRow[][] = sessions.map(() => []);
		for (const r of sortedRecords) {
			// 1. lap membership
			let idx = r.lap != null ? sessionLapSets.findIndex((set) => set.has(r.lap as number)) : -1;
			// 2. time window
			if (idx < 0) {
				const t = toDate(r.timestamp)?.getTime();
				if (t !== undefined) idx = sessionBounds.findIndex((b) => t >= b.start && t <= b.end);
			}
			// 3. nearest session by start time
			if (idx < 0) {
				const t = toDate(r.timestamp)?.getTime() ?? 0;
				let best = 0;
				let bestDist = Number.POSITIVE_INFINITY;
				for (let i = 0; i < sessionBounds.length; i++) {
					const bound = sessionBounds[i];
					if (!bound) continue;
					const d = Math.abs(t - bound.start);
					if (d < bestDist) {
						bestDist = d;
						best = i;
					}
				}
				idx = best;
			}
			bucketed[idx]?.push(r);
		}

		for (let i = 0; i < sessions.length; i++) {
			const session = sessions[i];
			if (!session) continue;
			emitSession(session, bucketed[i] ?? [], sessionLapArrays[i] ?? [], i);
		}
	}

	// N. EVENT — timer stop
	const stopEventMesg: Record<string, unknown> = {
		timestamp: toDate(stopEvent?.timestamp) ?? activityEnd,
		event: "timer",
		eventType: "stopAll",
	};
	encoder.onMesg(EVENT, stopEventMesg);

	// N+1. ACTIVITY (last)
	const activityMesg: Record<string, unknown> = {
		timestamp: activityEnd,
		numSessions: activity.numSessions ?? sessions.length ?? 1,
		type: "manual",
		event: "activity",
		eventType: "stop",
	};
	setIf(activityMesg, "totalTimerTime", num(activity.totalTimerTime));
	encoder.onMesg(ACTIVITY, activityMesg);

	return encoder.close();
}
