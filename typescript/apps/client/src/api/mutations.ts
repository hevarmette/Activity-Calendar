import type {
	ActivityUpdatePayload,
	CreateActivityPayload,
	CreateActivityResponse,
	LapUpdatePayload,
	SessionUpdatePayload,
	TrimActivityPayload,
	TrimActivityResponse,
} from "@activity-calendar/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.js";
import { queryKeys } from "./queries.js";

/**
 * Mutation for creating a manual activity via POST /api/activities.
 * On success, invalidates the calendar query so new events appear immediately.
 */
export function useCreateActivity() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (payload: CreateActivityPayload) =>
			api<CreateActivityResponse>("/api/activities", { method: "POST", body: JSON.stringify(payload) }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.calendar });
			qc.invalidateQueries({ queryKey: queryKeys.search });
			qc.invalidateQueries({ queryKey: queryKeys.report });
		},
	});
}

/**
 * Flush staged swim-length edits to the server.
 *
 * Runs the combine merges first (each group collapses into its lowest
 * message_index row, summing time + strokes), then applies per-length
 * stroke-count / stroke-type field edits. Combines run before field edits so a
 * field edit keyed on a surviving length id still targets an existing row.
 * On success, invalidates the activity's lengths so the table refetches the
 * persisted state.
 */
export function useSaveLengthEdits(activityId: number) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (edits: {
			combines: number[][];
			fieldEdits: Map<number, { totalStrokes?: number; swimStroke?: string }>;
		}) => {
			for (const group of edits.combines) {
				if (group.length < 2) continue;
				await api("/api/lengths/combine", { method: "POST", body: JSON.stringify({ lengthIds: group }) });
			}
			for (const [lengthId, payload] of edits.fieldEdits) {
				if (Object.keys(payload).length === 0) continue;
				await api(`/api/lengths/${lengthId}`, { method: "PATCH", body: JSON.stringify(payload) });
			}
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.lengths(activityId) });
		},
	});
}

export function useSaveActivity(activityId: number) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (payload: ActivityUpdatePayload) =>
			api<{ success: boolean; sql: string | null }>(`/api/activities/${activityId}`, {
				method: "PATCH",
				body: JSON.stringify(payload),
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.activity(activityId) });
			qc.invalidateQueries({ queryKey: queryKeys.calendar });
		},
	});
}

export function useSaveLap() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ lapId, ...payload }: LapUpdatePayload & { lapId: number }) =>
			api(`/api/laps/update/${lapId}`, { method: "PATCH", body: JSON.stringify(payload) }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["activity"] });
		},
	});
}

/**
 * Mutation for updating an individual multisport session leg via
 * PATCH /api/sessions/update/:sessionId.
 *
 * For multisport activities the sessions are the source of truth; the server
 * recomputes the whole-activity adjusted distance/duration as SUM(sessions).
 * On success we invalidate the activity query (its prefix also covers the
 * sessions query), plus the calendar and report queries so aggregate views
 * refresh.
 */
export function useSaveSession(activityId: number) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ sessionId, ...payload }: SessionUpdatePayload & { sessionId: number }) =>
			api(`/api/sessions/update/${sessionId}`, { method: "PATCH", body: JSON.stringify(payload) }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.activity(activityId) });
			qc.invalidateQueries({ queryKey: queryKeys.calendar });
			qc.invalidateQueries({ queryKey: queryKeys.report });
		},
	});
}

/**
 * Mutation for trimming records off an activity via
 * POST /api/activities/:id/trim.
 *
 * This is a DESTRUCTIVE operation: the server permanently deletes the
 * out-of-window `record` rows (and any laps left empty), then recomputes the
 * session/lap/activity summaries from the surviving records. Phase 1 supports a
 * tail trim (`trimEnd`) on single-session activities.
 *
 * On success we invalidate:
 * - `queryKeys.activity(id)` — this prefix (`["activity", id]`) also covers the
 *   records, laps, sessions and auto-laps queries, so the map, charts, lap
 *   tables and auto-laps all refetch the trimmed state.
 * - `queryKeys.calendar` and `queryKeys.report` — aggregate views that show the
 *   activity's distance/duration.
 *
 * @param activityId - The activity to trim.
 */
export function useTrimActivity(activityId: number) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (payload: TrimActivityPayload) =>
			api<TrimActivityResponse>(`/api/activities/${activityId}/trim`, {
				method: "POST",
				body: JSON.stringify(payload),
			}),
		onSuccess: () => {
			// The `["activity", id]` prefix also matches records/laps/sessions/
			// auto-laps query keys, so a single invalidation refetches them all.
			qc.invalidateQueries({ queryKey: queryKeys.activity(activityId) });
			qc.invalidateQueries({ queryKey: queryKeys.calendar });
			qc.invalidateQueries({ queryKey: queryKeys.report });
		},
	});
}
