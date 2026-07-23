import { Link } from "react-router";
import {
	METERS_PER_MILE,
	Sport,
	formatPace,
	formatPaceSpeed,
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

	const timestamp = activity?.localTimestamp
		? new Date(activity.localTimestamp).toLocaleString()
		: undefined;

	return (
		<Dialog open={open} onClose={onClose} title={title} subtitle={timestamp}>
			{activityLoading ? (
				<div className="flex items-center justify-center py-10">
					<div className="text-gray-400 text-sm animate-pulse">Loading activity…</div>
				</div>
			) : (
				<>
					{/* Metrics row */}
					<div style={{ display: "flex", flexDirection: "row", gap: "12px", width: "100%", marginBottom: "20px" }}>
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
									const sportName =
										(s.sport ?? "unknown").charAt(0).toUpperCase() +
										(s.sport ?? "").slice(1);
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

					{/* Description */}
					{activity?.description && activity.description !== "0" && (
						<p className="text-sm text-gray-400 italic mb-5">
							{activity.description}
						</p>
					)}

					{/* Footer */}
					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: "12px", borderTop: "1px solid #374151" }}>
						<div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
							{feel != null && FEEL_MAP[feel] && (
								<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
									<img src={`/assets/${FEEL_MAP[feel]}.svg`} alt={FEEL_MAP[feel]} style={{ width: "24px", height: "24px" }} />
									<span style={{ fontSize: "0.8rem", color: "#d1d5db", textTransform: "capitalize" }}>{FEEL_MAP[feel].replace("-", " ")}</span>
								</div>
							)}
							{effortIndex != null && (
								<span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
									Effort: <span style={{ color: "#d1d5db" }}>{effortIndex}/10</span>
								</span>
							)}
						</div>
						<Link
							to={`/activity/${activityId}?sport=${sport}`}
							style={{ display: "inline-block", borderRadius: "8px", background: "#2563eb", padding: "8px 20px", fontSize: "0.875rem", fontWeight: 500, color: "#fff", textDecoration: "none" }}
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
