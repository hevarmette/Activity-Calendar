import { SPORT_COLORS, Sport } from "@activity-calendar/shared";
import type { CalendarEvent, CalendarWorkoutEvent } from "@activity-calendar/shared";
import type { EventClickArg } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DateClickArg } from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import { useEffect, useRef } from "react";

export interface CalendarActivity {
	activityId: number;
	title: string;
	date: string;
	sport: string;
	numSessions: number;
}

/** Info passed when a scheduled workout event is clicked on the calendar. */
export interface CalendarWorkoutClick {
	workoutId: number;
	scheduledDate: string;
	name: string;
	sport: string;
}

/** Distinct color for scheduled workout events on the calendar. */
const WORKOUT_EVENT_COLOR = "#8B5CF6";

function toFullCalendarEvents(events: CalendarEvent[]) {
	return events.map((e) => {
		const sports = e.sport.split(",").map((s) => s.trim());
		const canonical = e.numSessions > 1 || new Set(sports).size > 1 ? Sport.Multisport : (sports[0] ?? "unknown");
		return {
			title: e.activityName,
			start: e.activityDate,
			backgroundColor: SPORT_COLORS[canonical] ?? "#7F7F7F",
			borderColor: SPORT_COLORS[canonical] ?? "#7F7F7F",
			extendedProps: {
				type: "activity" as const,
				activityId: e.activityId,
				sport: canonical,
				numSessions: e.numSessions,
			},
		};
	});
}

function toWorkoutFullCalendarEvents(workouts: CalendarWorkoutEvent[]) {
	return workouts.map((w) => ({
		title: `🏋️ ${w.name}`,
		start: w.scheduledDate,
		backgroundColor: "transparent",
		borderColor: WORKOUT_EVENT_COLOR,
		textColor: WORKOUT_EVENT_COLOR,
		classNames: ["workout-event"],
		extendedProps: {
			type: "workout" as const,
			workoutId: w.workoutId,
			scheduledDate: w.scheduledDate,
			name: w.name,
			sport: w.sport,
		},
	}));
}

interface Props {
	events: CalendarEvent[];
	workoutEvents?: CalendarWorkoutEvent[];
	initialDate: string;
	onEventClick: (activity: CalendarActivity) => void;
	onWorkoutClick?: (workout: CalendarWorkoutClick) => void;
	/** Fires when clicking an empty date cell — used to open the create activity dialog. */
	onDateClick?: (dateStr: string) => void;
}

/**
 * FullCalendar wrapper that renders activity events (solid colored) and
 * scheduled workout events (dashed border, violet/purple).
 */
export function ActivityCalendar({
	events,
	workoutEvents,
	initialDate,
	onEventClick,
	onWorkoutClick,
	onDateClick,
}: Props) {
	const calRef = useRef<FullCalendar>(null);

	useEffect(() => {
		calRef.current?.getApi().gotoDate(initialDate);
	}, [initialDate]);

	function handleEventClick(info: EventClickArg) {
		const props = info.event.extendedProps;
		if (props.type === "workout") {
			onWorkoutClick?.({
				workoutId: props.workoutId as number,
				scheduledDate: props.scheduledDate as string,
				name: props.name as string,
				sport: props.sport as string,
			});
		} else {
			onEventClick({
				activityId: props.activityId as number,
				title: info.event.title,
				date: info.event.startStr,
				sport: props.sport as string,
				numSessions: props.numSessions as number,
			});
		}
	}

	const allEvents = [...toFullCalendarEvents(events), ...toWorkoutFullCalendarEvents(workoutEvents ?? [])];

	return (
		<FullCalendar
			ref={calRef}
			plugins={[dayGridPlugin, interactionPlugin]}
			initialView="dayGridMonth"
			initialDate={initialDate}
			events={allEvents}
			eventClick={handleEventClick}
			dateClick={(info: DateClickArg) => onDateClick?.(info.dateStr)}
			headerToolbar={{
				left: "today prev,next",
				center: "title",
				right: "",
			}}
			height="auto"
		/>
	);
}
