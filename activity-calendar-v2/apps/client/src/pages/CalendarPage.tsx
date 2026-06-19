import { useState } from "react";
import { useSearchParams } from "react-router";
import { useCalendar } from "../api/queries.js";
import { ActivityCalendar, type CalendarActivity } from "../components/calendar/ActivityCalendar.js";
import { ActivityDialog } from "../components/calendar/ActivityDialog.js";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/queries.js";

export function CalendarPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const now = new Date();
	const year = Number(searchParams.get("year")) || now.getFullYear();
	const month = Number(searchParams.get("month")) || now.getMonth() + 1;
	const initialDate = `${year}-${String(month).padStart(2, "0")}-01`;

	const { data, isLoading } = useCalendar();
	const queryClient = useQueryClient();

	const [selected, setSelected] = useState<CalendarActivity | null>(null);

	function handleYearChange(e: React.ChangeEvent<HTMLInputElement>) {
		setSearchParams({ year: e.target.value, month: String(month) });
	}

	function handleMonthChange(e: React.ChangeEvent<HTMLSelectElement>) {
		setSearchParams({ year: String(year), month: e.target.value });
	}

	if (isLoading) return <div className="text-center py-10">Loading calendar…</div>;

	return (
		<div>
			<div className="flex items-center gap-4 mb-4">
				<input
					type="number"
					value={year}
					onChange={handleYearChange}
					className="w-24 rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm"
					aria-label="Year"
				/>
				<select
					value={month}
					onChange={handleMonthChange}
					className="rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm"
					aria-label="Month"
				>
					{Array.from({ length: 12 }, (_, i) => (
						<option key={i + 1} value={i + 1}>
							{new Date(2000, i).toLocaleString("default", { month: "long" })}
						</option>
					))}
				</select>
				<button
					onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.calendar })}
					className="ml-auto rounded bg-gray-700 px-3 py-1 text-sm hover:bg-gray-600"
				>
					Refresh
				</button>
			</div>

			<ActivityCalendar
				events={data ?? []}
				initialDate={initialDate}
				onEventClick={setSelected}
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
		</div>
	);
}

export default CalendarPage;
