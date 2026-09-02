import { convertSecondsToHms, parseHmsToSeconds } from "@activity-calendar/shared";
import { useEffect, useState } from "react";

interface Props {
	label: string;
	/** Marker color for the chip. */
	color: string;
	/** Current offset in seconds. */
	value: number;
	/** Maximum offset (the activity's last elapsed-time value). */
	max: number;
	onChange: (seconds: number) => void;
}

/** Clamp a value into the inclusive range [0, max]. */
function clamp(v: number, max: number): number {
	if (Number.isNaN(v) || v < 0) return 0;
	if (v > max) return max;
	return v;
}

/**
 * Per-activity start-offset control: an mm:ss text input plus a range slider,
 * both clamped to [0, max]. Lets the user skip an activity's warmup so both
 * markers start together from a chosen point. The color chip matches the map
 * marker and lap-column header for that activity.
 */
export function OffsetControl({ label, color, value, max, onChange }: Props) {
	// Local text state so partial typing (e.g. "1:") doesn't reset the value.
	const [text, setText] = useState(() => convertSecondsToHms(value) ?? "0:00.00");

	// Keep the text field in sync when the value changes externally (slider/reset).
	useEffect(() => {
		setText(convertSecondsToHms(value) ?? "0:00.00");
	}, [value]);

	function commitText(raw: string) {
		const secs = parseHmsToSeconds(raw);
		if (secs != null) onChange(clamp(secs, max));
		else setText(convertSecondsToHms(value) ?? "0:00.00");
	}

	return (
		<div className="flex items-center gap-2">
			<span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
			<span className="w-28 shrink-0 truncate text-xs text-gray-400" title={label}>
				{label}
			</span>
			<input
				type="text"
				inputMode="numeric"
				value={text}
				onChange={(e) => setText(e.target.value)}
				onBlur={(e) => commitText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") commitText((e.target as HTMLInputElement).value);
				}}
				aria-label={`${label} start offset (mm:ss)`}
				className="w-24 rounded-lg bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 tabular-nums focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500"
			/>
			<input
				type="range"
				min={0}
				max={Math.max(1, Math.floor(max))}
				step={1}
				value={Math.min(value, max)}
				onChange={(e) => onChange(clamp(Number(e.target.value), max))}
				aria-label={`${label} start offset slider`}
				className="min-w-0 flex-1 accent-orange-500"
			/>
		</div>
	);
}
