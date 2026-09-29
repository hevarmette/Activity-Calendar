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
import { useQuery } from "@tanstack/react-query";
import { useActiveSchema } from "../context/ActiveSchemaContext.js";
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

/**
 * Build the optional `?schema=`/`&schema=` fragment for cross-schema reads
 * (Feature #6). Returns an empty string when no schema is requested (primary),
 * so existing primary-schema callers produce byte-identical URLs.
 *
 * @param schema - The secondary schema name, or `undefined` for the primary schema.
 * @param hasQuery - `true` when the URL already carries a query string (so the
 *   fragment is joined with `&` instead of `?`).
 * @returns `""`, `"?schema=<enc>"`, or `"&schema=<enc>"`.
 */
export function schemaQuery(schema: string | undefined, hasQuery: boolean): string {
	if (!schema) return "";
	return `${hasQuery ? "&" : "?"}schema=${encodeURIComponent(schema)}`;
}

export function useCalendar() {
	const { activeSchema } = useActiveSchema();
	return useQuery({
		queryKey: [...queryKeys.calendar, activeSchema] as const,
		queryFn: () => api<CalendarEvent[]>(`/api/calendar${schemaQuery(activeSchema, false)}`),
	});
}

export function useActivity(id: number, schema?: string) {
	return useQuery({
		queryKey: [...queryKeys.activity(id), schema] as const,
		queryFn: () => api<ActivityDetails>(`/api/activities/${id}${schemaQuery(schema, false)}`),
		enabled: id > 0,
	});
}

export function useRecords(id: number, schema?: string) {
	return useQuery({
		queryKey: [...queryKeys.records(id), schema] as const,
		queryFn: () => api<RecordPoint[]>(`/api/records/${id}${schemaQuery(schema, false)}`),
		enabled: id > 0,
		staleTime: Number.POSITIVE_INFINITY,
	});
}

export function useSessions(id: number, schema?: string) {
	return useQuery({
		queryKey: [...queryKeys.sessions(id), schema] as const,
		queryFn: () => api<Session[]>(`/api/sessions/${id}${schemaQuery(schema, false)}`),
		enabled: id > 0,
	});
}

export function useLaps(id: number, schema?: string) {
	return useQuery({
		queryKey: [...queryKeys.laps(id), schema] as const,
		queryFn: () => api<Lap[]>(`/api/laps/${id}${schemaQuery(schema, false)}`),
		enabled: id > 0,
	});
}

export function useLengths(id: number) {
	const { activeSchema } = useActiveSchema();
	return useQuery({
		queryKey: [...queryKeys.lengths(id), activeSchema] as const,
		queryFn: () => api<SwimLength[]>(`/api/lengths/${id}${schemaQuery(activeSchema, false)}`),
		enabled: id > 0,
	});
}

export function useEvents(id: number) {
	const { activeSchema } = useActiveSchema();
	return useQuery({
		queryKey: [...queryKeys.events(id), activeSchema] as const,
		queryFn: () => api<TimerEvent[]>(`/api/events/${id}${schemaQuery(activeSchema, false)}`),
		enabled: id > 0,
	});
}

export function useSimilar(id: number, title: string, sport: string) {
	const { activeSchema } = useActiveSchema();
	return useQuery({
		// Key includes title + sport (the query depends on both) and activeSchema.
		// Previously the key omitted title/sport, so a title/sport change reused
		// stale cached results — this fixes that pre-existing mismatch.
		queryKey: [...queryKeys.similar(id), title, sport, activeSchema] as const,
		queryFn: () =>
			api<SimilarActivity[]>(
				`/api/similar/${id}?title=${encodeURIComponent(title)}&sport=${encodeURIComponent(sport)}${schemaQuery(activeSchema, true)}`,
			),
		enabled: id > 0 && title.length > 0,
	});
}

export function useReport() {
	const { activeSchema } = useActiveSchema();
	return useQuery({
		queryKey: [...queryKeys.report, activeSchema] as const,
		queryFn: () => api<ReportRow[]>(`/api/report${schemaQuery(activeSchema, false)}`),
	});
}

/** Parameters for the activity search API. All fields are optional. */
export interface SearchParams {
	/** Fuzzy text search across title and description. */
	q?: string;
	/** Case-insensitive regular-expression match on activity title. */
	titleSearch?: string;
	/** Case-insensitive regular-expression match on activity description. */
	descriptionSearch?: string;
}

export function useSearch(params?: SearchParams) {
	const { activeSchema } = useActiveSchema();
	const cacheKey = params ? `${params.q ?? ""}|${params.titleSearch ?? ""}|${params.descriptionSearch ?? ""}` : "";

	return useQuery({
		queryKey: [...queryKeys.search, cacheKey, activeSchema] as const,
		queryFn: () => {
			const searchParams = new URLSearchParams();
			if (params?.q) searchParams.set("q", params.q);
			if (params?.titleSearch) searchParams.set("titleSearch", params.titleSearch);
			if (params?.descriptionSearch) searchParams.set("descriptionSearch", params.descriptionSearch);
			const qs = searchParams.toString();
			return api<SearchRow[]>(`/api/search${qs ? `?${qs}` : ""}${schemaQuery(activeSchema, qs.length > 0)}`);
		},
	});
}

export interface AutoLap {
	lap: number;
	distanceMi: number;
	cumulativeDistanceMi: number;
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

export function useAutoLaps(id: number, sport: string, dist: number, schema?: string) {
	return useQuery({
		queryKey: ["activity", id, "auto-laps", sport, dist, schema] as const,
		queryFn: () =>
			api<AutoLap[]>(
				`/api/activities/${id}/auto-laps?sport=${encodeURIComponent(sport)}&dist=${dist}${schemaQuery(schema, true)}`,
			),
		enabled: id > 0,
	});
}
