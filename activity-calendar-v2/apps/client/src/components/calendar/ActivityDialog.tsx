import { Link } from "react-router";
import {
	METERS_PER_MILE,
	Sport,
	formatPace,
	convertSecondsToHms,
	FEEL_MAP,
	EFFORT_LABELS,
} from "@activity-calendar/shared";
import { useActivity, useRecords, useSessions } from "../../api/queries.js";
import { Dialog } from "../ui/Dialog.js";
import { MetricCard } from "../ui/MetricCard.js";
import { ActivityMap } from "../maps/ActivityMap.js";

interface Props {
	activityId: number;
	title: string;
	sport: string;
	numSessions: number;
	open: boolean;
	onClose: () => void;
}

export function ActivityDialog({ activityId, title, sport, numSessions, open, onClose }: Props) {
	const { data: activity } = useActivity(activityId);
	const { data: points } = useRecords(activityId);
	const { data: sessions } = useSessions(activityId);

	const distance = activity?.distance ?? 0;
	const duration = activity?.duration ?? 0;
	const miles = distance / METERS_PER_MILE;
	const durationStr = convertSecondsToHms(duration) ?? "0:00";
	const isMultisport = numSessions > 1 || sport === Sport.Multisport;

	let thirdMetric: { label: string; value: string };
	if (isMultisport || sport === Sport.Cycling) {
		const mph = duration > 0 ? miles / (duration / 3600) : 0;
		thirdMetric = { label: sport === Sport.Cycling ? "Speed" : "Avg Speed", value: `${mph.toFixed(1)} mph` };
	} else {
		const pace = miles > 0 ? duration / 60 / miles : 0;
		thirdMetric = { label: "Pace", value: `${formatPace(pace) ?? "—"} /mi` };
	}

	return (
		<Dialog open={open} onClose={onClose} title={title}>
			<div className="flex gap-3 mb-4">
				<MetricCard label="Distance" value={`${miles.toFixed(2)} mi`} />
				<MetricCard label="Duration" value={durationStr} />
				<MetricCard label={thirdMetric.label} value={thirdMetric.value} />
			</div>

			{isMultisport && sessions && sessions.length > 1 && (
				<div className="mb-4">
					<p className="text-sm font-semibold text-gray-300 mb-1">Legs</p>
					<ul className="text-sm text-gray-400 space-y-0.5">
						{sessions.map((s, i) => {
							const legMiles = (s.totalDistance ?? 0) / METERS_PER_MILE;
							const legDur = convertSecondsToHms(s.totalTimerTime ?? 0);
							return (
								<li key={s.sessionId}>
									<span className="font-medium text-gray-200">{(s.sport ?? "unknown").charAt(0).toUpperCase() + (s.sport ?? "").slice(1)}</span>
									{" — "}{legMiles.toFixed(2)} mi · {legDur}
								</li>
							);
						})}
					</ul>
				</div>
			)}

			{points && points.length > 0 && <ActivityMap points={points} sessions={isMultisport ? sessions : undefined} />}

			{activity?.feel != null && (
				<p className="mt-3 text-sm text-gray-400">
					Feel: <span className="text-gray-200">{FEEL_MAP[activity.feel] ?? "unknown"}</span>
				</p>
			)}
			{activity?.effort != null && (
				<p className="text-sm text-gray-400">
					Effort: <span className="text-gray-200">{Math.round(activity.effort / 10)} — {EFFORT_LABELS[Math.round(activity.effort / 10)] ?? ""}</span>
				</p>
			)}

			<div className="mt-4 text-right">
				<Link
					to={`/activity/${activityId}?sport=${sport}`}
					className="inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"
					onClick={onClose}
				>
					View Details
				</Link>
			</div>
		</Dialog>
	);
}
