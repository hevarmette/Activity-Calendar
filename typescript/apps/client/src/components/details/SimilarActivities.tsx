import { Link } from "react-router";
import { METERS_PER_MILE, convertSecondsToHms, formatPaceSpeed } from "@activity-calendar/shared";
import { useSimilar } from "../../api/queries.js";

interface Props {
	activityId: number;
	title: string;
	sport: string;
}

export function SimilarActivities({ activityId, title, sport }: Props) {
	const { data, isLoading } = useSimilar(activityId, title, sport);

	if (isLoading) return <p className="text-sm text-gray-400">Loading similar…</p>;
	if (!data || data.length === 0) return <p className="text-sm text-gray-400">No similar activities found.</p>;

	return (
		<div className="space-y-2">
			{data.slice(0, 10).map((a) => {
				const miles = (a.totalDistance ?? 0) / METERS_PER_MILE;
				const dur = convertSecondsToHms(a.totalTimerTime ?? 0);
				const paceSpeed = formatPaceSpeed(sport, a.totalDistance ?? 0, a.totalTimerTime ?? 0);
				const date = new Date(a.localTimestamp).toLocaleDateString();
				return (
					<Link
						key={a.activityId}
						to={`/activity/${a.activityId}?sport=${sport}`}
						className="block rounded bg-gray-800 p-3 hover:bg-gray-700 transition-colors"
					>
						<div className="flex justify-between items-center">
							<span className="font-medium text-sm">{a.activityName}</span>
							<span className="text-xs text-gray-400">{date}</span>
						</div>
						<div className="text-xs text-gray-400 mt-1">
							{miles.toFixed(2)} mi · {dur} · {paceSpeed}
						</div>
					</Link>
				);
			})}
		</div>
	);
}
