import { FEEL_MAP, EFFORT_LABELS } from "@activity-calendar/shared";
import type { ActivityUpdatePayload } from "@activity-calendar/shared";

interface Props {
	name: string | null;
	description: string | null;
	category: string | null;
	feel: number | null;
	effort: number | null;
	onChange: (updates: Partial<ActivityUpdatePayload>) => void;
}

const CATEGORIES = ["training", "race", "transportation", "recreation", "fitness", "other"];
const FEEL_OPTIONS = Object.entries(FEEL_MAP).map(([k, v]) => ({ value: Number(k), label: v }));

export function ActivityMetadataEditor({ name, description, category, feel, effort, onChange }: Props) {
	const effortIndex = effort != null ? Math.round(effort / 10) : null;

	return (
		<div className="space-y-4">
			<div>
				<label className="text-xs text-gray-400 block mb-1">Title</label>
				<input
					type="text"
					defaultValue={name ?? ""}
					onBlur={(e) => onChange({ activityName: e.target.value || null })}
					className="w-full rounded bg-gray-800 border border-gray-600 px-3 py-1.5 text-sm"
				/>
			</div>

			<div>
				<label className="text-xs text-gray-400 block mb-1">Description</label>
				<textarea
					defaultValue={description ?? ""}
					onBlur={(e) => onChange({ description: e.target.value || null })}
					rows={3}
					className="w-full rounded bg-gray-800 border border-gray-600 px-3 py-1.5 text-sm resize-none"
				/>
			</div>

			<div>
				<label className="text-xs text-gray-400 block mb-1">Category</label>
				<select
					defaultValue={category ?? ""}
					onChange={(e) => onChange({ category: e.target.value || null })}
					className="rounded bg-gray-800 border border-gray-600 px-3 py-1.5 text-sm"
				>
					<option value="">—</option>
					{CATEGORIES.map((c) => (
						<option key={c} value={c}>{c}</option>
					))}
				</select>
			</div>

			<div>
				<label className="text-xs text-gray-400 block mb-1">Workout Feel</label>
				<div className="flex gap-2">
					{FEEL_OPTIONS.map(({ value, label }) => (
						<button
							key={value}
							onClick={() => onChange({ workoutFeel: value })}
							className={`rounded px-2 py-1 text-xs capitalize ${feel === value ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600"}`}
						>
							{label}
						</button>
					))}
				</div>
			</div>

			<div>
				<label className="text-xs text-gray-400 block mb-1">
					Effort: {effortIndex ?? "None"}{effortIndex ? ` — ${EFFORT_LABELS[effortIndex] ?? ""}` : ""}
				</label>
				<input
					type="range"
					min={1}
					max={10}
					value={effortIndex ?? 5}
					onChange={(e) => onChange({ effort: Number(e.target.value) * 10 })}
					className="w-full"
				/>
			</div>
		</div>
	);
}
