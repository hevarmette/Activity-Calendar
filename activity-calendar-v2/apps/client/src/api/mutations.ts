import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ActivityUpdatePayload, LapUpdatePayload } from "@activity-calendar/shared";
import { api } from "./client.js";
import { queryKeys } from "./queries.js";

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
			api(`/api/activities/${activityId}`, { method: "PATCH", body: JSON.stringify(payload) }),
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
