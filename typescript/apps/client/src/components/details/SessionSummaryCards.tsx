import { METERS_PER_MILE, Sport, convertSecondsToHms, formatPace, formatPaceSpeed } from "@activity-calendar/shared";
import type { Session } from "@activity-calendar/shared";

interface Props {
	/** The active multisport session (leg) to display summary metrics for. */
	session: Session;
}

/**
 * Displays per-leg summary cards for a multisport activity session.
 * Shows distance, duration, and a sport-appropriate third metric:
 * - Running: pace (/mi)
 * - Cycling: power (W) if available, otherwise speed (mph)
 * - Swimming: pace (/100m)
 *
 * Mirrors the Streamlit version's `_render_session_content` top metrics.
 */
export function SessionSummaryCards({ session }: Props) {
	const distance = session.totalDistance ?? 0;
	const duration = session.totalTimerTime ?? 0;
	const sport = session.sport ?? "running";
	const miles = distance / METERS_PER_MILE;
	const avgPower = session.avgPower;

	let thirdLabel: string;
	let thirdValue: string;

	if (sport === Sport.Cycling) {
		if (avgPower != null && avgPower > 0) {
			thirdLabel = "Power";
			thirdValue = `${Math.round(avgPower)} W`;
		} else {
			thirdLabel = "Speed";
			const mph = duration > 0 ? miles / (duration / 3600) : 0;
			thirdValue = mph > 0 ? `${mph.toFixed(2)} mph` : "—";
		}
	} else if (sport === Sport.Swimming) {
		thirdLabel = "Pace";
		thirdValue = distance > 0 && duration > 0 ? formatPaceSpeed(sport, distance, duration) : "—";
	} else {
		// Running and other sports default to pace/mi
		thirdLabel = "Pace";
		const pace = miles > 0 ? duration / 60 / miles : null;
		thirdValue = pace != null ? `${formatPace(pace) ?? "—"} /mi` : "—";
	}

	const distanceDisplay = sport === Sport.Swimming ? `${Math.round(distance)} m` : `${miles.toFixed(2)} mi`;

	return (
		<div className="grid grid-cols-3 gap-4 mb-4">
			<LegMetric label="Distance" value={distanceDisplay} />
			<LegMetric label="Duration" value={convertSecondsToHms(Math.round(duration)) ?? "—"} />
			<LegMetric label={thirdLabel} value={thirdValue} />
		</div>
	);
}

/** Read-only metric card for a multisport session leg. */
function LegMetric({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
			<p className="mt-1 text-2xl font-bold text-gray-50 tabular-nums">{value}</p>
		</div>
	);
}
