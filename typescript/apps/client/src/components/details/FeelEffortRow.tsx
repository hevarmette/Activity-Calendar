import { EFFORT_LABELS, FEEL_MAP } from "@activity-calendar/shared";
import type { ActivityUpdatePayload } from "@activity-calendar/shared";
import { useEffect, useState } from "react";

interface FeelEffortProps {
	feel: number | null;
	effort: number | null;
	onChange: (updates: Partial<ActivityUpdatePayload>) => void;
}

const FEEL_OPTIONS = Object.entries(FEEL_MAP).map(([k, v]) => ({ value: Number(k), label: v }));

export function FeelEffortRow({ feel, effort, onChange }: FeelEffortProps) {
	const [localFeel, setLocalFeel] = useState(feel);
	const [localEffort, setLocalEffort] = useState(effort);

	const effortIndex = localEffort != null ? Math.round(localEffort / 10) : null;
	const hasEffort = effortIndex != null;

	useEffect(() => {
		setLocalFeel(feel);
		setLocalEffort(effort);
	}, [feel, effort]);

	function handleFeel(value: number) {
		setLocalFeel(value);
		onChange({ workoutFeel: value });
	}

	function handleEffort(value: number) {
		const scaled = value * 10;
		setLocalEffort(scaled);
		onChange({ effort: scaled });
	}

	return (
		<div className="grid grid-cols-[3fr_7fr] gap-6 items-start">
			{/* Feel */}
			<div>
				<div className="text-xs font-medium uppercase tracking-wide text-gray-500 block mb-2">How did you feel?</div>
				<div className="grid grid-cols-5 gap-2">
					{FEEL_OPTIONS.map(({ value, label }) => (
						<button
							type="button"
							key={value}
							onClick={() => handleFeel(value)}
							className={`rounded-lg px-3 py-2 text-xs capitalize flex flex-col items-center gap-1 transition-colors ${localFeel === value ? "bg-orange-600/20 border border-orange-600 ring-1 ring-orange-500/50" : "bg-gray-800 border border-gray-700 hover:border-gray-600"}`}
							title={label}
							aria-label={`Feel: ${label}`}
							aria-pressed={localFeel === value}
						>
							<img src={`/assets/${label}.svg`} alt={label} className="w-8 h-8" />
							<span className="text-gray-300">{label}</span>
						</button>
					))}
				</div>
			</div>

			{/* Effort */}
			<div>
				<div className="flex items-center justify-between gap-3 mb-2">
					<label htmlFor="perceived-effort" className="text-xs font-medium uppercase tracking-wide text-gray-500">
						Perceived Effort{hasEffort ? `: ${effortIndex} - ${EFFORT_LABELS[effortIndex] ?? ""}` : ""}
					</label>
					{!hasEffort && <span className="text-xs text-gray-600">Not set</span>}
				</div>
				<input
					id="perceived-effort"
					type="range"
					min={1}
					max={10}
					value={effortIndex ?? 1}
					onChange={(e) => handleEffort(Number(e.target.value))}
					className={`effort-slider w-full accent-orange-600 ${hasEffort ? "" : "effort-slider-unset"}`}
				/>
				<div className="flex justify-between text-[10px] text-gray-600 mt-1">
					{Array.from({ length: 10 }, (_, i) => i + 1).map((value) => (
						<span key={value}>{value}</span>
					))}
				</div>
			</div>
		</div>
	);
}
