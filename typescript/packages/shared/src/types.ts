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
