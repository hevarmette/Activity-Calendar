import { SPORT_COLORS, Sport } from "@activity-calendar/shared";
import type { CalendarEvent } from "@activity-calendar/shared";
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
				activityId: e.activityId,
				sport: canonical,
				numSessions: e.numSessions,
			},
		};
	});
}

interface Props {
	events: CalendarEvent[];
	initialDate: string;
	onEventClick: (activity: CalendarActivity) => void;
	/** Fires when clicking an empty date cell — used to open the create activity dialog. */
	onDateClick?: (dateStr: string) => void;
}

export function ActivityCalendar({ events, initialDate, onEventClick, onDateClick }: Props) {
	const calRef = useRef<FullCalendar>(null);

	useEffect(() => {
		calRef.current?.getApi().gotoDate(initialDate);
	}, [initialDate]);

	function handleEventClick(info: EventClickArg) {
		const props = info.event.extendedProps as {
			activityId: number;
			sport: string;
			numSessions: number;
		};
		onEventClick({
			activityId: props.activityId,
			title: info.event.title,
			date: info.event.startStr,
			sport: props.sport,
			numSessions: props.numSessions,
		});
	}

	return (
		<FullCalendar
			ref={calRef}
			plugins={[dayGridPlugin, interactionPlugin]}
			initialView="dayGridMonth"
			initialDate={initialDate}
			events={toFullCalendarEvents(events)}
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
