import type { Lap } from "@activity-calendar/shared";
import { METERS_PER_MILE, Sport, convertSecondsToHms, formatPace } from "@activity-calendar/shared";

interface Props {
	laps: Lap[];
	sport: string;
}

export function BestLap({ laps, sport }: Props) {
	const valid = laps.filter((l) => (l.totalDistance ?? 0) > 0 && (l.totalTimerTime ?? 0) > 0);
	if (!valid.length) return null;

	const isCycling = sport === Sport.Cycling;
	const best = isCycling
		? valid.reduce((a, b) => ((a.totalDistance! / a.totalTimerTime!) > (b.totalDistance! / b.totalTimerTime!) ? a : b))
		: valid.reduce((a, b) => ((a.totalTimerTime! / a.totalDistance!) < (b.totalTimerTime! / b.totalDistance!) ? a : b));

	const miles = (best.totalDistance ?? 0) / METERS_PER_MILE;
	const time = best.totalTimerTime ?? 0;
	const pace = miles > 0 ? time / 60 / miles : null;
	const speed = time > 0 ? miles / (time / 3600) : null;

	return (
		<div className="rounded-lg bg-green-900/30 border border-green-700 p-3">
			<p className="text-xs text-green-400 uppercase font-medium mb-1">Best Lap</p>
			<p className="text-sm text-gray-300">
				Lap {best.number} — {miles.toFixed(2)} mi — {convertSecondsToHms(time)} — {isCycling ? `${speed?.toFixed(1)} mph` : `${formatPace(pace)} /mi`}
			</p>
		</div>
	);
}
