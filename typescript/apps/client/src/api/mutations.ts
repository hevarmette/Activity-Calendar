import type {
	ActivityUpdatePayload,
	CreateActivityPayload,
	CreateActivityResponse,
	LapUpdatePayload,
	SessionUpdatePayload,
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

export function useCombineLengths(activityId: number) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (lengthIds: number[]) =>
			api("/api/lengths/combine", { method: "POST", body: JSON.stringify({ lengthIds }) }),
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
