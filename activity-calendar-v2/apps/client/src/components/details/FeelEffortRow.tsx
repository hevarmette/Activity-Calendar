import { FEEL_MAP, EFFORT_LABELS } from "@activity-calendar/shared";
import type { ActivityUpdatePayload } from "@activity-calendar/shared";

interface FeelEffortProps {
	feel: number | null;
	effort: number | null;
	onChange: (updates: Partial<ActivityUpdatePayload>) => void;
}

const FEEL_OPTIONS = Object.entries(FEEL_MAP).map(([k, v]) => ({ value: Number(k), label: v }));

export function FeelEffortRow({ feel, effort, onChange }: FeelEffortProps) {
	const effortIndex = effort != null ? Math.round(effort / 10) : null;

	return (
		<div className="grid grid-cols-[3fr_7fr] gap-8 items-start">
			{/* Feel */}
			<div>
				<label className="text-xs font-medium uppercase tracking-wide text-gray-500 block mb-2">How did you feel?</label>
				<div className="flex gap-2">
					{FEEL_OPTIONS.map(({ value, label }) => (
						<button
							key={value}
							onClick={() => onChange({ workoutFeel: value })}
							className={`rounded-lg px-3 py-2 text-xs capitalize flex flex-col items-center gap-1 transition-colors ${feel === value ? "bg-orange-500/20 border border-orange-500 ring-1 ring-orange-500/50" : "bg-gray-800 border border-gray-700 hover:border-gray-600"}`}
							title={label}
						>
							<img src={`/assets/${label}.svg`} alt={label} className="w-6 h-6 max-w-6 max-h-6" />
							<span className="text-gray-300">{label}</span>
						</button>
					))}
				</div>
			</div>

			{/* Effort */}
			<div>
				<label className="text-xs font-medium uppercase tracking-wide text-gray-500 block mb-2">
					Perceived Effort{effortIndex ? `: ${effortIndex} — ${EFFORT_LABELS[effortIndex] ?? ""}` : ""}
				</label>
				<input
					type="range"
					min={1}
					max={10}
					value={effortIndex ?? 5}
					onChange={(e) => onChange({ effort: Number(e.target.value) * 10 })}
					className="w-full accent-orange-500"
				/>
				<div className="flex justify-between text-[10px] text-gray-600 mt-1">
					{Array.from({ length: 10 }, (_, i) => <span key={i}>{i + 1}</span>)}
				</div>
			</div>
		</div>
	);
}
