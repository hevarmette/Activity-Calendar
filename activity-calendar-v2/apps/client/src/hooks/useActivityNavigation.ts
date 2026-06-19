import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useCalendar } from "../api/queries.js";

export function useActivityNavigation(currentId: number, sport: string) {
	const { data: events } = useCalendar();
	const navigate = useNavigate();

	const { prev, next } = useMemo(() => {
		if (!events || events.length === 0) return { prev: null, next: null };
		const sorted = [...events].sort((a, b) => a.activityDate.localeCompare(b.activityDate));
		const idx = sorted.findIndex((e) => e.activityId === currentId);
		if (idx === -1) return { prev: null, next: null };
		return {
			prev: idx > 0 ? sorted[idx - 1]! : null,
			next: idx < sorted.length - 1 ? sorted[idx + 1]! : null,
		};
	}, [events, currentId]);

	function goTo(activityId: number, activitySport: string) {
		navigate(`/activity/${activityId}?sport=${activitySport}`);
	}

	return {
		prev,
		next,
		goPrev: () => prev && goTo(prev.activityId, prev.sport.split(",")[0] ?? sport),
		goNext: () => next && goTo(next.activityId, next.sport.split(",")[0] ?? sport),
	};
}
