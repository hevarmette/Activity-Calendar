import type { Lap, RecordPoint } from "@activity-calendar/shared";
import { METERS_PER_MILE, METERS_TO_FEET, Sport, convertSecondsToHms, formatPace } from "@activity-calendar/shared";

interface Props {
	distance: number;
	duration: number;
	sport: string;
	points: RecordPoint[];
	laps: Lap[];
	avgPower: number | null;
}

function weightedAvg(laps: Lap[], getter: (l: Lap) => number | null): number | null {
	let sum = 0, weight = 0;
	for (const l of laps) {
		const v = getter(l);
		const t = l.totalTimerTime ?? 0;
		if (v != null && t > 0) { sum += v * t; weight += t; }
	}
	return weight > 0 ? sum / weight : null;
}

export function ActivityStatsGrid({ distance, duration, sport, points, laps, avgPower }: Props) {
	const miles = distance / METERS_PER_MILE;
	const isCycling = sport === Sport.Cycling;
	const durationHr = duration / 3600;
	const mph = durationHr > 0 ? miles / durationHr : 0;
	const pace = miles > 0 ? duration / 60 / miles : null;

	// HR from points
	const hrValues = points.map((p) => p.heartRate).filter((v): v is number => v != null);
	const avgHr = hrValues.length > 0 ? hrValues.reduce((a, b) => a + b, 0) / hrValues.length : null;
	const maxHr = hrValues.length > 0 ? Math.max(...hrValues) : null;

	// Elevation from points
	// A dead-band threshold prevents small SRTM noise from inflating totals.
	// Garmin/Strava use ~2-3ft thresholds; we use 2ft since we already smooth
	// the elevation data server-side.
	const ELEV_THRESHOLD_FT = 2;
	const altValues = points.map((p) => p.correctedAltitude).filter((v): v is number => v != null);
	let totalAscent: number | null = null;
	let totalDescent: number | null = null;
	if (altValues.length > 1) {
		let asc = 0, desc = 0;
		for (let i = 1; i < altValues.length; i++) {
			const diff = altValues[i]! - altValues[i - 1]!;
			if (diff > ELEV_THRESHOLD_FT) asc += diff;
			else if (diff < -ELEV_THRESHOLD_FT) desc += Math.abs(diff);
		}
		totalAscent = asc;
		totalDescent = desc;
	}

	// Best lap
	// From Streamlit (pages/2_Activity_Details.py):
	// "Due to rounding differences in avg speed and lap speed, we will use avg speed
	// if there is only one lap" — so single-lap activities use overall pace, not lap pace.
	const validLaps = laps.filter((l) => (l.totalDistance ?? 0) > 0 && (l.totalTimerTime ?? 0) > 0);
	let bestLapLabel: string | null = null;
	if (validLaps.length) {
		const best = isCycling
			? validLaps.reduce((a, b) => ((a.totalDistance ?? 0) / (a.totalTimerTime ?? 1)) > ((b.totalDistance ?? 0) / (b.totalTimerTime ?? 1)) ? a : b)
			: validLaps.reduce((a, b) => ((a.totalTimerTime ?? 0) / (a.totalDistance ?? 1)) < ((b.totalTimerTime ?? 0) / (b.totalDistance ?? 1)) ? a : b);
		const bestMiles = (best.totalDistance ?? 0) / METERS_PER_MILE;
		const bestTime = best.totalTimerTime ?? 0;
		if (isCycling) {
			const spd = bestTime > 0 ? bestMiles / (bestTime / 3600) : 0;
			bestLapLabel = `Lap ${best.number} at ${spd.toFixed(1)} mph`;
		} else {
			const p = bestMiles > 0 ? bestTime / 60 / bestMiles : null;
			bestLapLabel = `Lap ${validLaps.length > 1 ? best.number : 1} at ${formatPace(validLaps.length > 1 ? p : pace)} /mi`;
		}
	}

	// Cadence from points
	const cadenceValues = points
		.map((p) => p.cadence != null ? (p.cadence + (p.fractionalCadence ?? 0)) * (isCycling ? 1 : 2) : null)
		.filter((v): v is number => v != null);
	const avgCadence = cadenceValues.length > 0 ? cadenceValues.reduce((a, b) => a + b, 0) / cadenceValues.length : null;
	const maxCadence = cadenceValues.length > 0 ? Math.max(...cadenceValues) : null;

	// Running dynamics from laps
	const vo = weightedAvg(laps, (l) => l.avgVerticalOscillation);
	const st = weightedAvg(laps, (l) => l.avgStanceTime);
	const vr = weightedAvg(laps, (l) => l.avgVerticalRatio);

	return (
		<div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
			{/* Column 1: Distance + Pace/Speed */}
			<div className="space-y-4">
				<Stat label="Distance" value={`${miles.toFixed(2)} mi`} />
				<Stat
					label={isCycling ? "Avg Speed" : "Avg Pace"}
					value={isCycling ? `${mph.toFixed(2)} mph` : `${formatPace(pace)} /mi`}
				/>
				{isCycling && avgPower != null && <Stat label="Avg Power" value={`${avgPower} W`} />}
			</div>

			{/* Column 2: HR + Duration */}
			<div className="space-y-4">
				{avgHr != null && (
					<Stat label="Heart Rate" value={`${avgHr.toFixed(0)} avg / ${maxHr} max bpm`} />
				)}
				<Stat label="Duration" value={convertSecondsToHms(duration) ?? "—"} />
			</div>

			{/* Column 3: Elevation + Best Pace */}
			<div className="space-y-4">
				{totalAscent != null && (
					<Stat label="Elevation" value={`↑${totalAscent.toFixed(0)} ft  ↓${totalDescent!.toFixed(0)} ft`} />
				)}
				{bestLapLabel && (
					<Stat label={isCycling ? "Best Speed" : "Best Pace"} value={bestLapLabel} />
				)}
			</div>

			{/* Column 4: Cadence + Dynamics */}
			<div className="space-y-4">
				{avgCadence != null && (
					<Stat
						label="Cadence"
						value={`${avgCadence.toFixed(0)} avg / ${maxCadence!.toFixed(0)} max ${isCycling ? "rpm" : "spm"}`}
					/>
				)}
				{!isCycling && vr != null && <Stat label="Vertical Ratio" value={`${vr.toFixed(1)}%`} />}
				{!isCycling && st != null && <Stat label="Ground Contact" value={`${st.toFixed(0)} ms`} />}
				{!isCycling && vo != null && <Stat label="Vert. Oscillation" value={`${(vo / 10).toFixed(1)} cm`} />}
			</div>
		</div>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
			<p className="text-sm font-semibold text-gray-100 mt-0.5">{value}</p>
		</div>
	);
}
