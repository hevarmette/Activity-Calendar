import { useState } from "react";
import { useSearchParams } from "react-router";
import { useCalendar } from "../api/queries.js";
import { useCalendarWorkouts } from "../api/workout-queries.js";
import {
	ActivityCalendar,
	type CalendarActivity,
	type CalendarWorkoutClick,
} from "../components/calendar/ActivityCalendar.js";
import { ActivityDialog } from "../components/calendar/ActivityDialog.js";
import { CreateActivityDialog } from "../components/calendar/CreateActivityDialog.js";
import { WorkoutDialog } from "../components/calendar/WorkoutDialog.js";

export function CalendarPage() {
	const [searchParams] = useSearchParams();
	const now = new Date();
	const year = Number(searchParams.get("year")) || Number(sessionStorage.getItem("cal_year")) || now.getFullYear();
	const month = Number(searchParams.get("month")) || Number(sessionStorage.getItem("cal_month")) || now.getMonth() + 1;
	const initialDate = `${year}-${String(month).padStart(2, "0")}-01`;

	const { data, isLoading } = useCalendar();
	const { data: workoutEvents } = useCalendarWorkouts();
	const [selected, setSelected] = useState<CalendarActivity | null>(null);
	const [createDate, setCreateDate] = useState<string | null>(null);
	const [selectedWorkout, setSelectedWorkout] = useState<CalendarWorkoutClick | null>(null);

	if (isLoading) return <div className="text-center py-10 text-gray-400">Loading calendar…</div>;

	return (
		<div>
			<ActivityCalendar
				events={data ?? []}
				workoutEvents={workoutEvents ?? []}
				initialDate={initialDate}
				onEventClick={setSelected}
				onWorkoutClick={setSelectedWorkout}
				onDateClick={(dateStr) => setCreateDate(dateStr)}
			/>

			{selected && (
				<ActivityDialog
					activityId={selected.activityId}
					title={selected.title}
					sport={selected.sport}
					numSessions={selected.numSessions}
					open={true}
					onClose={() => setSelected(null)}
				/>
			)}

			{selectedWorkout && (
				<WorkoutDialog
					workoutId={selectedWorkout.workoutId}
					scheduledDate={selectedWorkout.scheduledDate}
					open={true}
					onClose={() => setSelectedWorkout(null)}
				/>
			)}

			{createDate != null && (
				<CreateActivityDialog open={true} onClose={() => setCreateDate(null)} initialDate={createDate} />
			)}
		</div>
	);
}

export default CalendarPage;
