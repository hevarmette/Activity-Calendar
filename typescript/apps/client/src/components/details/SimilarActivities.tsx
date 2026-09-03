import { METERS_PER_MILE, convertSecondsToHms, formatPaceSpeed } from "@activity-calendar/shared";
import { Link, useNavigate } from "react-router";
import { useSimilar } from "../../api/queries.js";

interface Props {
	activityId: number;
	title: string;
	sport: string;
	/**
	 * Normalized category of the CURRENT activity. The direct "Compare" button is
	 * only shown for goal-oriented efforts — "training" or "race" — where a
	 * head-to-head comparison against a similar activity is meaningful.
	 */
	category?: string;
}

export function SimilarActivities({ activityId, title, sport, category }: Props) {
	const { data, isLoading } = useSimilar(activityId, title, sport);
	const navigate = useNavigate();

	// Only surface the direct compare affordance for training/racing activities.
	const showCompare = category === "training" || category === "race";

	if (isLoading) return <p className="text-sm text-gray-400">Loading similar…</p>;
	if (!data || data.length === 0) return <p className="text-sm text-gray-400">No similar activities found.</p>;

	return (
		<div>
			{data.slice(0, 10).map((a) => {
				const miles = (a.totalDistance ?? 0) / METERS_PER_MILE;
				const dur = convertSecondsToHms(a.totalTimerTime ?? 0);
				const paceSpeed = formatPaceSpeed(sport, a.totalDistance ?? 0, a.totalTimerTime ?? 0);
				const date = new Date(a.localTimestamp).toLocaleDateString();
				return (
					// Relatively-positioned row so the Compare button can sit as a sibling
					// (not nested) inside the details Link — avoids invalid interactive
					// nesting while keeping the whole row clickable for navigation.
					<div key={a.activityId} className="group relative border-b border-gray-800">
						<Link
							to={`/activity/${a.activityId}?sport=${sport}`}
							className="block py-2 pr-9 transition-colors hover:bg-gray-900/50"
						>
							<div className="flex items-center justify-between">
								<span className="text-sm font-medium text-gray-200">{a.activityName}</span>
								<span className="text-xs text-gray-500">{date}</span>
							</div>
							<div className="mt-0.5 text-xs text-gray-400">
								{miles.toFixed(2)} mi · {dur} · {paceSpeed}
							</div>
						</Link>
						{showCompare && (
							<button
								type="button"
								onClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									navigate(`/compare?a=${activityId}&b=${a.activityId}`);
								}}
								aria-label="Compare"
								title="Compare"
								className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gray-600 opacity-0 transition-colors hover:text-orange-400 focus:opacity-100 group-hover:opacity-100"
							>
								{/* Compare icon (two opposing arrows) */}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 20 20"
									fill="currentColor"
									className="h-4 w-4"
									aria-hidden="true"
								>
									<path d="M8 3a1 1 0 0 1 1 1v12a1 1 0 1 1-2 0V6.414L5.707 7.707a1 1 0 0 1-1.414-1.414l3-3A1 1 0 0 1 8 3Zm4 14a1 1 0 0 1-1-1V4a1 1 0 1 1 2 0v9.586l1.293-1.293a1 1 0 0 1 1.414 1.414l-3 3A1 1 0 0 1 12 17Z" />
								</svg>
							</button>
						)}
					</div>
				);
			})}
		</div>
	);
}
