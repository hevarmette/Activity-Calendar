import type { Intensity, Sport } from "./enums.js";

export interface ActivityDetails {
	activityId: number;
	distance: number;
	duration: number;
	avgPower: number | null;
	description: string | null;
	feel: number | null;
	effort: number | null;
	localTimestamp: string;
	name: string | null;
	category: string | null;
}

export interface CalendarEvent {
	activityId: number;
	activityDate: string;
	activityName: string;
	numSessions: number;
	sport: string;
}

export interface Session {
	sessionId: number;
	activityId: number;
	startTime: string;
	timestamp: string;
	sport: string;
	subSport: string | null;
	totalDistance: number | null;
	totalTimerTime: number | null;
	totalElapsedTime: number | null;
	avgPower: number | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
	enhancedAvgSpeed: number | null;
	avgSpeed: number | null;
	totalAscent: number | null;
	totalDescent: number | null;
	firstLapIndex: number;
	numLaps: number;
	poolLength: number | null;
}

export interface Lap {
	lapId: number;
	activityId: number;
	startTime: string;
	number: number;
	totalDistance: number | null;
	totalTimerTime: number | null;
	totalAscent: number | null;
	totalDescent: number | null;
	avgVerticalOscillation: number | null;
	avgStanceTime: number | null;
	avgVerticalRatio: number | null;
	avgStanceTimeBalance: number | null;
	avgStepLength: number | null;
	avgRunningCadence: number | null;
	maxHeartRate: number | null;
	avgHeartRate: number | null;
	intensity: string | null;
	avgPower: number | null;
	maxPower: number | null;
}

export interface RecordPoint {
	recordId: number;
	activityId: number;
	timestamp: string;
	latitude: number | null;
	longitude: number | null;
	lap: number;
	altitude: number | null;
	heartRate: number | null;
	cadence: number | null;
	fractionalCadence: number | null;
	enhancedSpeed: number | null;
	distance: number | null;
	correctedAltitude: number | null;
	elapsedTime: number;
}

export interface TimerEvent {
	timestamp: string;
	event: string;
	eventType: string;
}

export interface SwimLength {
	lengthId: number;
	activityId: number;
	messageIndex: number;
	totalTimerTime: number | null;
	totalStrokes: number | null;
	avgSpeed: number | null;
	swimStroke: string | null;
	lengthType: string | null;
}

export interface ReportRow {
	activityId: number;
	localTimestamp: string;
	sport: string;
	totalDistance: number | null;
	totalTimerTime: number | null;
	totalCalories: number | null;
	totalAscent: number | null;
	totalDescent: number | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
	avgPower: number | null;
}

export interface SearchRow {
	activityId: number;
	localTimestamp: string;
	activityName: string | null;
	/** User-editable activity description, used for text search. */
	description: string | null;
	category: string | null;
	numSessions: number;
	sport: string;
	subSport: string | null;
	totalDistance: number | null;
	totalTimerTime: number | null;
	totalCalories: number | null;
	totalAscent: number | null;
	totalDescent: number | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
	enhancedAvgSpeed: number | null;
}

export interface SimilarActivity {
	activityId: number;
	activityName: string;
	localTimestamp: string;
	totalDistance: number | null;
	totalTimerTime: number | null;
	nameSimilarity: number;
}

export interface ActivityUpdatePayload {
	adjustedDistance?: number;
	adjustedDuration?: number;
	description?: string | null;
	workoutFeel?: number | null;
	effort?: number | null;
	activityName?: string | null;
	category?: string | null;
}

export interface LapUpdatePayload {
	totalDistance?: number;
	totalTimerTime?: number;
	avgHeartRate?: number;
	intensity?: string;
}

export interface LengthUpdatePayload {
	totalTimerTime?: number;
	totalStrokes?: number;
	swimStroke?: string;
}

// --- Manual Activity Creation ---

/** A single lap entry for manual activity creation (POST /api/activities). */
export interface CreateLapInput {
	/** Distance in meters. */
	distance: number;
	/** Duration in seconds. */
	time: number;
	/** Lap intensity (e.g. "active", "warm up", "cooldown"). Defaults to "active". */
	intensity?: string;
}

/**
 * Payload for POST /api/activities — manual activity creation.
 *
 * Creates an activity, session, and lap rows in a single transaction.
 * No GPS record data is generated for manual activities.
 */
export interface CreateActivityPayload {
	/** Activity title/name (1–200 characters). */
	title: string;
	/** Optional description text. */
	description?: string;
	/** Sport type. Must be one of the supported sports. */
	sport: "running" | "cycling" | "swimming";
	/** Sub-sport (e.g. "generic", "trail", "open_water", "lap_swimming"). Defaults to "generic". */
	subSport?: string;
	/** Category label (e.g. "training", "race", "long run"). Max 15 characters. */
	category?: string;
	/** Local timestamp as ISO string without timezone (YYYY-MM-DDTHH:mm:ss). */
	localTimestamp: string;
	/** Total activity duration in seconds. */
	duration: number;
	/** Total activity distance in meters. If provided, used for adjusted_distance and session total_distance. */
	distance?: number;
	/** Workout feel: 0, 25, 50, 75, or 100 (maps to FEEL_MAP icons). */
	workoutFeel?: number | null;
	/** Perceived effort: 1–10 scale (maps to EFFORT_LABELS). */
	effort?: number | null;
	/** Lap splits. If empty, one lap matching activity distance/duration is auto-generated. */
	laps: CreateLapInput[];
	/** When true, the response includes the SQL statements executed. */
	debugSql?: boolean;
}

/** Response from POST /api/activities — returns the created activity's ID. */
export interface CreateActivityResponse {
	/** The database-assigned activity ID for the newly created activity. */
	activityId: number;
	/** SQL statements executed (only present when debugSql was true in request). */
	sql?: string[];
}

// --- Activity Export ---

/**
 * Payload for POST /api/export — export a set of completed activities as Garmin
 * .fit files bundled into a ZIP archive.
 *
 * Selection precedence (enforced server-side):
 *   1. If `activityIds` is non-empty, export exactly those IDs (filters ignored).
 *   2. Else, apply the text filters (`q` / `titleSearch` / `descriptionSearch`)
 *      combined with AND logic, matching the GET /api/search contract.
 *   3. Else, require `all: true` as an explicit guard to export the entire
 *      library. A request with neither ids, filters, nor `all` is rejected.
 *
 * The number of activities in a non-`all` request is bounded by the server's
 * EXPORT_MAX_ACTIVITIES cap; exceeding it returns 413.
 *
 * The response is a binary ZIP (`application/zip`), not JSON.
 */
export interface ActivityExportRequest {
	/** Explicit guard required to export the entire library (no ids/filters). */
	all?: boolean;
	/** Explicit activity IDs to export. Takes precedence over all filters. */
	activityIds?: number[];
	/** Fuzzy text query matched against name/description (see search route). */
	q?: string;
	/** Exact case-insensitive substring match against activity name. */
	titleSearch?: string;
	/** Exact case-insensitive substring match against description. */
	descriptionSearch?: string;
}

/**
 * A scheduled workout event for the calendar view.
 *
 * Returned by the calendar API alongside CalendarEvent items so the UI
 * can render upcoming workouts on their scheduled dates.
 */
export interface CalendarWorkoutEvent {
	/** The database-assigned workout ID. */
	workoutId: number;
	/** ISO date string (YYYY-MM-DD) when the workout is scheduled. */
	scheduledDate: string;
	/** Workout name displayed on the calendar. */
	name: string;
	/** Sport type (e.g. "running", "cycling", "swimming"). */
	sport: string;
}
