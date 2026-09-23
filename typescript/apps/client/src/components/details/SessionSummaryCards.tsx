import {
	METERS_PER_MILE,
	Sport,
	convertSecondsToHms,
	formatPace,
	formatPaceSpeed,
	parseHmsToSeconds,
} from "@activity-calendar/shared";
import type { Session } from "@activity-calendar/shared";
import { type ReactNode, useEffect, useState } from "react";

interface Props {
	/** The active multisport session (leg) to display summary metrics for. */
	session: Session;
	/** Pending edited distance in meters (overrides session.totalDistance for display). */
	editedDistance?: number;
	/** Pending edited duration in seconds. */
	editedDuration?: number;
	/** When provided, Distance & Duration render as inputs and call this on change. */
	onChange?: (updates: { totalDistance?: number; totalTimerTime?: number }) => void;
}

/**
 * Displays per-leg summary cards for a multisport activity session.
 * Shows distance, duration, and a sport-appropriate third metric:
 * - Running: pace (/mi)
 * - Cycling: power (W) if available, otherwise speed (mph)
 * - Swimming: pace (/100m)
 *
 * When `onChange` is provided the Distance and Duration cards become editable
 * inputs (miles for run/cycle, meters for swim; hms for duration) and report
 * changes back in SI units (meters / seconds). The third metric stays
 * read-only and is computed from the effective (edited) distance/duration.
 *
 * Mirrors the Streamlit version's `_render_session_content` top metrics.
 */
export function SessionSummaryCards({ session, editedDistance, editedDuration, onChange }: Props) {
	const distance = editedDistance ?? session.totalDistance ?? 0;
	const duration = editedDuration ?? session.totalTimerTime ?? 0;
	const sport = session.sport ?? "running";
	const miles = distance / METERS_PER_MILE;
	const avgPower = session.avgPower;
	const isSwim = sport === Sport.Swimming;
	const editable = onChange != null;

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
	} else if (isSwim) {
		thirdLabel = "Pace";
		thirdValue = distance > 0 && duration > 0 ? formatPaceSpeed(sport, distance, duration) : "—";
	} else {
		// Running and other sports default to pace/mi
		thirdLabel = "Pace";
		const pace = miles > 0 ? duration / 60 / miles : null;
		thirdValue = pace != null ? `${formatPace(pace) ?? "—"} /mi` : "—";
	}

	const distanceDisplay = isSwim ? `${Math.round(distance)} m` : `${miles.toFixed(2)} mi`;
	const durationDisplay = convertSecondsToHms(Math.round(duration)) ?? "—";

	// Local draft state for the editable inputs so typing isn't reformatted on
	// every keystroke (mirrors the single-session inputs on the details page).
	// Reset whenever the active leg changes (keyed by sessionId) or an external
	// edit revises the effective value.
	const distanceValue = isSwim ? Math.round(distance).toString() : miles.toFixed(2);
	const [distanceDraft, setDistanceDraft] = useState(distanceValue);
	const [durationDraft, setDurationDraft] = useState(durationDisplay === "—" ? "" : durationDisplay);
	// biome-ignore lint/correctness/useExhaustiveDependencies: resync drafts only when the leg or its effective values change.
	useEffect(() => {
		setDistanceDraft(distanceValue);
		setDurationDraft(durationDisplay === "—" ? "" : durationDisplay);
	}, [session.sessionId, distanceValue, durationDisplay]);

	return (
		<div className="grid grid-cols-3 gap-4 mb-4">
			{editable ? (
				<>
					<LegMetric label="Distance">
						<div className="mt-1 flex items-baseline">
							<input
								type="number"
								min={0}
								step={isSwim ? 1 : 0.01}
								value={distanceDraft}
								onChange={(e) => {
									const nextValue = e.target.value;
									setDistanceDraft(nextValue);
									if (nextValue.trim() === "") return;
									const next = Number(nextValue);
									if (Number.isNaN(next) || next < 0) return;
									onChange({ totalDistance: isSwim ? next : next * METERS_PER_MILE });
								}}
								onBlur={() => setDistanceDraft(distanceValue)}
								className="min-w-0 w-24 bg-transparent border-none p-0 text-2xl font-bold text-gray-50 tabular-nums focus:outline-none focus:text-orange-200"
								aria-label={isSwim ? "Leg distance in meters" : "Leg distance in miles"}
							/>
							<span className="text-2xl font-bold text-gray-500 ml-1">{isSwim ? "m" : "mi"}</span>
						</div>
					</LegMetric>
					<LegMetric label="Duration">
						<input
							type="text"
							value={durationDraft}
							onChange={(e) => {
								const nextValue = e.target.value;
								setDurationDraft(nextValue);
								const seconds = parseHmsToSeconds(nextValue);
								if (seconds != null) onChange({ totalTimerTime: seconds });
							}}
							onBlur={() => setDurationDraft(durationDisplay === "—" ? "" : durationDisplay)}
							className="mt-1 w-full bg-transparent border-none p-0 text-2xl font-bold text-gray-50 tabular-nums focus:outline-none focus:text-orange-200"
							aria-label="Leg duration"
						/>
					</LegMetric>
				</>
			) : (
				<>
					<LegMetric label="Distance" value={distanceDisplay} />
					<LegMetric label="Duration" value={durationDisplay} />
				</>
			)}
			<LegMetric label={thirdLabel} value={thirdValue} />
		</div>
	);
}

/** Read-only (or editable, via children) metric card for a multisport session leg. */
function LegMetric({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
	return (
		<div>
			<p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
			{children ?? <p className="mt-1 text-2xl font-bold text-gray-50 tabular-nums">{value}</p>}
		</div>
	);
}
