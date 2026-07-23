import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useCalendar } from "../api/queries.js";

export function useActivityNavigation(currentId: number, sport: string) {
	const { data: events } = useCalendar();
	const navigate = useNavigate();

	const { prev, next } = useMemo(() => {
		if (!events || events.length === 0) return { prev: null, next: null };
		const sorted = [...events]
			.filter((event) => Number.isFinite(Number(event.activityId)))
			.sort((a, b) => new Date(a.activityDate).getTime() - new Date(b.activityDate).getTime());
		const idx = sorted.findIndex((event) => Number(event.activityId) === currentId);
		if (idx === -1) return { prev: null, next: null };
		return {
			prev: idx > 0 ? (sorted[idx - 1] ?? null) : null,
			next: idx < sorted.length - 1 ? (sorted[idx + 1] ?? null) : null,
		};
	}, [events, currentId]);

	function goTo(activityId: number, activitySport: string) {
		navigate(`/activity/${activityId}?sport=${activitySport}`);
	}

	return {
		prev,
		next,
		goPrev: () => prev && goTo(Number(prev.activityId), prev.sport.split(",")[0] ?? sport),
		goNext: () => next && goTo(Number(next.activityId), next.sport.split(",")[0] ?? sport),
	};
}
