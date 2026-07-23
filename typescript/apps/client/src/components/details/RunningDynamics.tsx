import type { Lap } from "@activity-calendar/shared";
import { METERS_TO_FEET } from "@activity-calendar/shared";

interface Props {
	laps: Lap[];
}

export function RunningDynamics({ laps }: Props) {
	const totalTime = laps.reduce((s, l) => s + (l.totalTimerTime ?? 0), 0);
	if (totalTime === 0) return null;

	function weightedAvg(getter: (l: Lap) => number | null): number | null {
		let sum = 0, weight = 0;
		for (const l of laps) {
			const v = getter(l);
			const t = l.totalTimerTime ?? 0;
			if (v != null && t > 0) { sum += v * t; weight += t; }
		}
		return weight > 0 ? sum / weight : null;
	}

	const vo = weightedAvg((l) => l.avgVerticalOscillation);
	const st = weightedAvg((l) => l.avgStanceTime);
	const sl = weightedAvg((l) => l.avgStepLength);
	const vr = weightedAvg((l) => l.avgVerticalRatio);

	const hasData = vo != null || st != null || sl != null || vr != null;
	if (!hasData) return null;

	const metrics = [
		{ label: "Vert. Oscillation", value: vo != null ? `${vo.toFixed(1)} mm` : "—" },
		{ label: "Stance Time", value: st != null ? `${st.toFixed(0)} ms` : "—" },
		{ label: "Step Length", value: sl != null ? `${(sl * METERS_TO_FEET).toFixed(2)} ft` : "—" },
		{ label: "Vert. Ratio", value: vr != null ? `${vr.toFixed(1)}%` : "—" },
	];

	return (
		<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
			{metrics.map((m) => (
				<div key={m.label} className="rounded-lg bg-gray-800 p-3 text-center">
					<p className="text-xs text-gray-400 uppercase">{m.label}</p>
					<p className="text-lg font-semibold">{m.value}</p>
				</div>
			))}
		</div>
	);
}
