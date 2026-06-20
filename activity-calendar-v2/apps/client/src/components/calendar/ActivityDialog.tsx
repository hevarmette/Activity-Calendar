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
	const { data: activity, isLoading: activityLoading } = useActivity(activityId);
	const { data: points, isLoading: pointsLoading } = useRecords(activityId);
	const { data: sessions } = useSessions(activityId);

	const distance = activity?.distance ?? 0;
	const duration = activity?.duration ?? 0;
	const miles = distance / METERS_PER_MILE;
	const durationStr = convertSecondsToHms(duration) ?? "—";
	const isMultisport = numSessions > 1 || sport === Sport.Multisport;

	let thirdMetric: { label: string; value: string };
	if (isMultisport || sport === Sport.Cycling) {
		const mph = duration > 0 ? miles / (duration / 3600) : 0;
		thirdMetric = {
			label: sport === Sport.Cycling ? "Speed" : "Avg Speed",
			value: mph > 0 ? `${mph.toFixed(1)} mph` : "—",
		};
	} else {
		const pace = miles > 0 && duration > 0 ? duration / 60 / miles : 0;
		thirdMetric = {
			label: "Pace",
			value: pace > 0 ? `${formatPace(pace) ?? "—"} /mi` : "—",
		};
	}

	const feel = activity?.feel;
	const effort = activity?.effort;
	const effortIndex = effort != null ? Math.round(effort / 10) : null;

	return (
		<Dialog open={open} onClose={onClose} title={title}>
			{activityLoading ? (
				<div className="flex items-center justify-center py-10">
					<div className="text-gray-400 text-sm animate-pulse">Loading activity…</div>
				</div>
			) : (
				<>
					{/* Metrics row */}
					<div className="grid grid-cols-3 gap-3 mb-5">
						<MetricCard label="Distance" value={`${miles.toFixed(2)} mi`} />
						<MetricCard label="Duration" value={durationStr} />
						<MetricCard label={thirdMetric.label} value={thirdMetric.value} />
					</div>

					{/* Multisport legs */}
					{isMultisport && sessions && sessions.length > 1 && (
						<div className="mb-5 rounded-lg bg-gray-800 p-3">
							<p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Legs</p>
							<ul className="space-y-1">
								{sessions.map((s) => {
									const legMiles = (s.totalDistance ?? 0) / METERS_PER_MILE;
									const legDur = convertSecondsToHms(s.totalTimerTime ?? 0) ?? "—";
									const sportName =
										(s.sport ?? "unknown").charAt(0).toUpperCase() +
										(s.sport ?? "").slice(1);
									return (
										<li key={s.sessionId} className="text-sm text-gray-300">
											<span className="font-medium text-gray-100">{sportName}</span>
											{" — "}
											{legMiles.toFixed(2)} mi · {legDur}
										</li>
									);
								})}
							</ul>
						</div>
					)}

					{/* Map */}
					<div className="mb-5 rounded-lg overflow-hidden" style={{ height: 300 }}>
						{pointsLoading ? (
							<div className="flex items-center justify-center h-full bg-gray-800 text-gray-500 text-sm animate-pulse">
								Loading map…
							</div>
						) : points && points.length > 0 ? (
							<ActivityMap
								points={points}
								sessions={isMultisport ? sessions : undefined}
							/>
						) : (
							<div className="flex items-center justify-center h-full bg-gray-800 text-gray-500 text-sm">
								No GPS data available
							</div>
						)}
					</div>

					{/* Feel / Effort */}
					{(feel != null || effortIndex != null) && (
						<div className="flex gap-4 mb-5 text-sm text-gray-400">
							{feel != null && (
								<span>
									Feel:{" "}
									<span className="text-gray-200 capitalize">
										{FEEL_MAP[feel] ?? "unknown"}
									</span>
								</span>
							)}
							{effortIndex != null && (
								<span>
									Effort:{" "}
									<span className="text-gray-200">
										{effortIndex} — {EFFORT_LABELS[effortIndex] ?? ""}
									</span>
								</span>
							)}
						</div>
					)}

					{/* Description */}
					{activity?.description && activity.description !== "0" && (
						<p className="text-sm text-gray-400 italic mb-5">
							{activity.description}
						</p>
					)}

					{/* Footer */}
					<div className="flex items-center justify-between pt-3 border-t border-gray-700">
						<span className="text-xs text-gray-500">
							Activity #{activityId}
						</span>
						<Link
							to={`/activity/${activityId}?sport=${sport}`}
							className="inline-block rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium hover:bg-blue-500 transition-colors"
							onClick={onClose}
						>
							View Details →
						</Link>
					</div>
				</>
			)}
		</Dialog>
	);
}
