import { useQuery } from "@tanstack/react-query";
import type {
	ActivityDetails,
	CalendarEvent,
	Lap,
	RecordPoint,
	ReportRow,
	SearchRow,
	Session,
	SimilarActivity,
	SwimLength,
	TimerEvent,
} from "@activity-calendar/shared";
import { api } from "./client.js";

export const queryKeys = {
	calendar: ["calendar"] as const,
	activity: (id: number) => ["activity", id] as const,
	records: (id: number) => ["activity", id, "records"] as const,
	sessions: (id: number) => ["activity", id, "sessions"] as const,
	laps: (id: number) => ["activity", id, "laps"] as const,
	lengths: (id: number) => ["activity", id, "lengths"] as const,
	events: (id: number) => ["activity", id, "events"] as const,
	similar: (id: number) => ["activity", id, "similar"] as const,
	report: ["report"] as const,
	search: ["search"] as const,
};

export function useCalendar() {
	return useQuery({
		queryKey: queryKeys.calendar,
		queryFn: () => api<CalendarEvent[]>("/api/calendar"),
	});
}

export function useActivity(id: number) {
	return useQuery({
		queryKey: queryKeys.activity(id),
		queryFn: () => api<ActivityDetails>(`/api/activities/${id}`),
		enabled: id > 0,
	});
}

export function useRecords(id: number) {
	return useQuery({
		queryKey: queryKeys.records(id),
		queryFn: () => api<RecordPoint[]>(`/api/records/${id}`),
		enabled: id > 0,
		staleTime: Number.POSITIVE_INFINITY,
	});
}

export function useSessions(id: number) {
	return useQuery({
		queryKey: queryKeys.sessions(id),
		queryFn: () => api<Session[]>(`/api/sessions/${id}`),
		enabled: id > 0,
	});
}

export function useLaps(id: number) {
	return useQuery({
		queryKey: queryKeys.laps(id),
		queryFn: () => api<Lap[]>(`/api/laps/${id}`),
		enabled: id > 0,
	});
}

export function useLengths(id: number) {
	return useQuery({
		queryKey: queryKeys.lengths(id),
		queryFn: () => api<SwimLength[]>(`/api/lengths/${id}`),
		enabled: id > 0,
	});
}

export function useEvents(id: number) {
	return useQuery({
		queryKey: queryKeys.events(id),
		queryFn: () => api<TimerEvent[]>(`/api/events/${id}`),
		enabled: id > 0,
	});
}

export function useSimilar(id: number, title: string, sport: string) {
	return useQuery({
		queryKey: queryKeys.similar(id),
		queryFn: () =>
			api<SimilarActivity[]>(`/api/similar/${id}?title=${encodeURIComponent(title)}&sport=${encodeURIComponent(sport)}`),
		enabled: id > 0 && title.length > 0,
	});
}

export function useReport() {
	return useQuery({
		queryKey: queryKeys.report,
		queryFn: () => api<ReportRow[]>("/api/report"),
	});
}

export function useSearch() {
	return useQuery({
		queryKey: queryKeys.search,
		queryFn: () => api<SearchRow[]>("/api/search"),
	});
}

export interface AutoLap {
	lap: number;
	distanceMi: number;
	timeSeconds: number;
	paceMinPerMile: number | null;
	speedMph: number | null;
	totalAscentFt: number;
	totalDescentFt: number;
	avgHr: number | null;
	maxHr: number | null;
	avgCadence: number | null;
	maxCadence: number | null;
	cumulativeTimeSeconds: number;
}

export function useAutoLaps(id: number, sport: string, dist: number) {
	return useQuery({
		queryKey: ["activity", id, "auto-laps", sport, dist] as const,
		queryFn: () => api<AutoLap[]>(`/api/activities/${id}/auto-laps?sport=${encodeURIComponent(sport)}&dist=${dist}`),
		enabled: id > 0,
	});
}
