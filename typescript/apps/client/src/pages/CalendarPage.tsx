import { useState } from "react";
import { useSearchParams } from "react-router";
import { useCalendar } from "../api/queries.js";
import { ActivityCalendar, type CalendarActivity } from "../components/calendar/ActivityCalendar.js";
import { ActivityDialog } from "../components/calendar/ActivityDialog.js";
import { CreateActivityDialog } from "../components/calendar/CreateActivityDialog.js";

export function CalendarPage() {
	const [searchParams] = useSearchParams();
	const now = new Date();
	const year = Number(searchParams.get("year")) || Number(sessionStorage.getItem("cal_year")) || now.getFullYear();
	const month = Number(searchParams.get("month")) || Number(sessionStorage.getItem("cal_month")) || now.getMonth() + 1;
	const initialDate = `${year}-${String(month).padStart(2, "0")}-01`;

	const { data, isLoading } = useCalendar();
	const [selected, setSelected] = useState<CalendarActivity | null>(null);
	const [createDate, setCreateDate] = useState<string | null>(null);

	if (isLoading) return <div className="text-center py-10 text-gray-400">Loading calendar…</div>;

	return (
		<div>
			<ActivityCalendar
				events={data ?? []}
				initialDate={initialDate}
				onEventClick={setSelected}
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

			{createDate != null && (
				<CreateActivityDialog open={true} onClose={() => setCreateDate(null)} initialDate={createDate} />
			)}
		</div>
	);
}

export default CalendarPage;
