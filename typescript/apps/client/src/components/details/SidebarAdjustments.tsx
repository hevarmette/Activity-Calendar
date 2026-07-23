import { METERS_PER_MILE, convertSecondsToHms, parseHmsToSeconds } from "@activity-calendar/shared";

interface Props {
	distanceM: number;
	durationS: number;
	onDistanceChange: (meters: number) => void;
	onDurationChange: (seconds: number) => void;
}

export function SidebarAdjustments({ distanceM, durationS, onDistanceChange, onDurationChange }: Props) {
	const miles = distanceM / METERS_PER_MILE;

	return (
		<div className="space-y-3 p-4 border border-gray-700 rounded-lg bg-gray-800/50">
			<h3 className="text-sm font-medium text-gray-300">Adjust Activity</h3>
			<div>
				<label className="text-xs text-gray-400 block mb-1">Distance (miles)</label>
				<input
					type="number"
					step="0.01"
					defaultValue={miles.toFixed(2)}
					onBlur={(e) => onDistanceChange(Number(e.target.value) * METERS_PER_MILE)}
					className="w-full rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm"
				/>
			</div>
			<div>
				<label className="text-xs text-gray-400 block mb-1">Duration (H:MM:SS)</label>
				<input
					type="text"
					defaultValue={convertSecondsToHms(durationS) ?? ""}
					onBlur={(e) => {
						const s = parseHmsToSeconds(e.target.value);
						if (s != null) onDurationChange(s);
					}}
					className="w-full rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm"
				/>
			</div>
		</div>
	);
}
