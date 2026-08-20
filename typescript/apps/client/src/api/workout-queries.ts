/**
 * TanStack Query hooks for workout persistence (CRUD + generate).
 *
 * Separated from queries.ts to keep file sizes manageable since queries.ts
 * already handles all activity-related data fetching.
 */
import type { SavedWorkout, WorkoutDefinition, WorkoutListItem } from "@activity-calendar/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.js";

export const workoutQueryKeys = {
	all: ["workouts"] as const,
	list: (sport?: string) => (sport ? ["workouts", { sport }] : ["workouts"]) as const,
	detail: (id: number) => ["workouts", id] as const,
};

/** Fetch all saved workouts, optionally filtered by sport. */
export function useWorkouts(sport?: string) {
	return useQuery({
		queryKey: workoutQueryKeys.list(sport),
		queryFn: () => {
			const qs = sport ? `?sport=${encodeURIComponent(sport)}` : "";
			return api<WorkoutListItem[]>(`/api/workouts${qs}`);
		},
	});
}

/** Fetch a single saved workout with its full step definition. */
export function useWorkout(id: number) {
	return useQuery({
		queryKey: workoutQueryKeys.detail(id),
		queryFn: () => api<SavedWorkout>(`/api/workouts/${id}`),
		enabled: id > 0,
	});
}

/** Create a new saved workout. Returns { workoutId }. */
export function useSaveWorkout() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (workout: WorkoutDefinition) =>
			api<{ workoutId: number }>("/api/workouts", {
				method: "POST",
				body: JSON.stringify(workout),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: workoutQueryKeys.all });
		},
	});
}

/** Update an existing saved workout by ID. */
export function useUpdateWorkout(id: number) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (workout: WorkoutDefinition) =>
			api<{ success: boolean }>(`/api/workouts/${id}`, {
				method: "PUT",
				body: JSON.stringify(workout),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: workoutQueryKeys.all });
			queryClient.invalidateQueries({ queryKey: workoutQueryKeys.detail(id) });
		},
	});
}

/** Delete a saved workout by ID. */
export function useDeleteWorkout() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: number) =>
			api<{ success: boolean }>(`/api/workouts/${id}`, {
				method: "DELETE",
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: workoutQueryKeys.all });
		},
	});
}
