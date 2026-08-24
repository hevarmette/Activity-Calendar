import {
	EFFORT_LABELS,
	FEEL_MAP,
	METERS_PER_MILE,
	Sport,
	convertSecondsToHms,
	formatPace,
	formatPaceSpeed,
} from "@activity-calendar/shared";
import { Link } from "react-router";
import { useActivity, useRecords, useSessions } from "../../api/queries.js";
import { ActivityMap } from "../maps/ActivityMap.js";
import { Dialog } from "../ui/Dialog.js";
import { MetricCard } from "../ui/MetricCard.js";

interface Props {
	activityId: number;
	title: string;
	sport: string;
	numSessions: number;
	open: boolean;
	onClose: () => void;
}

/**
 * Modal dialog showing a quick activity summary when clicking a calendar event.
 * Displays key metrics, a GPS map preview, multisport legs, and a link to full details.
 */
export function ActivityDialog({ activityId, title, sport, numSessions, open, onClose }: Props) {
	const { data: activity, isLoading: activityLoading } = useActivity(activityId);
	const { data: points, isLoading: pointsLoading } = useRecords(activityId);
	const { data: sessions } = useSessions(activityId);

	const distance = activity?.distance ?? 0;
	const duration = activity?.duration ?? 0;
	const miles = distance / METERS_PER_MILE;
	const durationStr = convertSecondsToHms(duration) ?? "—";
	const isMultisport = numSessions > 1 || sport === Sport.Multisport;
	const isSwimming = sport === Sport.Swimming;

	let thirdMetric: { label: string; value: string };
	if (isMultisport) {
		const mph = duration > 0 ? miles / (duration / 3600) : 0;
		thirdMetric = {
			label: "Avg Speed",
			value: mph > 0 ? `${mph.toFixed(1)} mph` : "—",
		};
	} else if (sport === Sport.Cycling) {
		if (activity?.avgPower != null && activity.avgPower > 0) {
			thirdMetric = { label: "Power", value: `${activity.avgPower} W` };
		} else {
			const mph = duration > 0 ? miles / (duration / 3600) : 0;
			thirdMetric = { label: "Speed", value: mph > 0 ? `${mph.toFixed(1)} mph` : "—" };
		}
	} else if (isSwimming) {
		thirdMetric = {
			label: "Pace",
			value: distance > 0 && duration > 0 ? formatPaceSpeed(sport, distance, duration) : "—",
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

	const timestamp = activity?.localTimestamp ? new Date(activity.localTimestamp).toLocaleString() : undefined;

	return (
		<Dialog open={open} onClose={onClose} title={title} subtitle={timestamp}>
			{activityLoading ? (
				<div className="flex items-center justify-center py-10">
					<div className="text-gray-400 text-sm animate-pulse">Loading activity…</div>
				</div>
			) : (
				<>
					{/* Metrics row */}
					<div className="flex flex-row gap-3 w-full mb-5">
						<MetricCard label="Distance" value={isSwimming ? `${Math.round(distance)} m` : `${miles.toFixed(2)} mi`} />
						<MetricCard label="Duration" value={durationStr} />
						<MetricCard label={thirdMetric.label} value={thirdMetric.value} />
					</div>

					{/* Multisport legs */}
					{isMultisport && sessions && sessions.length > 1 && (
						<div className="mb-5 rounded-lg bg-gray-800 p-3">
							<p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Legs</p>
							<ul className="space-y-1">
								{sessions.map((s) => {
									const legDist = s.totalDistance ?? 0;
									const legMiles = legDist / METERS_PER_MILE;
									const legDur = convertSecondsToHms(s.totalTimerTime ?? 0) ?? "—";
									const isSwimLeg = s.sport === Sport.Swimming;
									const distStr = isSwimLeg ? `${Math.round(legDist)} m` : `${legMiles.toFixed(2)} mi`;
									const sportName = (s.sport ?? "unknown").charAt(0).toUpperCase() + (s.sport ?? "").slice(1);
									return (
										<li key={s.sessionId} className="text-sm text-gray-300">
											<span className="font-medium text-gray-100">{sportName}</span>
											{" — "}
											{distStr} · {legDur}
										</li>
									);
								})}
							</ul>
						</div>
					)}

					{/* Map */}
					<div className="mb-5 rounded-lg overflow-hidden h-[300px]">
						{pointsLoading ? (
							<div className="flex items-center justify-center h-full bg-gray-800 text-gray-500 text-sm animate-pulse">
								Loading map…
							</div>
						) : points && points.length > 0 ? (
							<ActivityMap points={points} sessions={isMultisport ? sessions : undefined} />
						) : (
							<div className="flex items-center justify-center h-full bg-gray-800 text-gray-500 text-sm">
								No GPS data available
							</div>
						)}
					</div>

					{/* Description */}
					{activity?.description && activity.description !== "0" && (
						<p className="text-sm text-gray-400 italic mb-5">{activity.description}</p>
					)}

					{/* Footer */}
					<div className="flex items-center justify-between pt-3 border-t border-gray-700">
						<div className="flex items-center gap-3">
							{feel != null && FEEL_MAP[feel] && (
								<div className="flex items-center gap-1.5">
									<img src={`/assets/${FEEL_MAP[feel]}.svg`} alt={FEEL_MAP[feel]} className="w-6 h-6" />
									<span className="text-[0.8rem] text-gray-300 capitalize">{FEEL_MAP[feel].replace("-", " ")}</span>
								</div>
							)}
							{effortIndex != null && (
								<span className="text-[0.8rem] text-gray-400">
									Effort: <span className="text-gray-300">{effortIndex}/10</span>
								</span>
							)}
						</div>
						<Link
							to={`/activity/${activityId}?sport=${sport}`}
							className="inline-block rounded-lg bg-orange-600 hover:bg-orange-500 px-5 py-2 text-sm font-medium text-white no-underline transition-colors"
							onClick={onClose}
						>
							View Details
						</Link>
					</div>
				</>
			)}
		</Dialog>
	);
}
