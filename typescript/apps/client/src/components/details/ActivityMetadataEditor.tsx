import { EFFORT_LABELS, FEEL_MAP } from "@activity-calendar/shared";
import type { ActivityUpdatePayload } from "@activity-calendar/shared";

interface Props {
	name: string | null;
	description: string | null;
	category: string | null;
	feel: number | null;
	effort: number | null;
	onChange: (updates: Partial<ActivityUpdatePayload>) => void;
	/**
	 * When `true`, all inputs are disabled — set this to `activeSchema !== undefined`
	 * so editing is blocked while viewing another (read-only) schema.
	 */
	disabled?: boolean;
}

const CATEGORIES = ["training", "race", "transportation", "recreation", "fitness", "other"];
const FEEL_OPTIONS = Object.entries(FEEL_MAP).map(([k, v]) => ({ value: Number(k), label: v }));

/**
 * Inline editor for an activity's metadata (title, description, category,
 * workout feel, and perceived effort). Reports each change back via
 * {@link Props.onChange}.
 *
 * @param disabled - Disables all controls; pass `activeSchema !== undefined`
 *   so editing is blocked while viewing another (read-only) schema.
 */
export function ActivityMetadataEditor({ name, description, category, feel, effort, onChange, disabled }: Props) {
	const effortIndex = effort != null ? Math.round(effort / 10) : null;

	return (
		<div className="space-y-4">
			<div>
				<label htmlFor="metadata-title" className="text-xs text-gray-400 block mb-1">
					Title
				</label>
				<input
					id="metadata-title"
					type="text"
					defaultValue={name ?? ""}
					onBlur={(e) => onChange({ activityName: e.target.value || null })}
					disabled={disabled}
					className="w-full rounded bg-gray-800 border border-gray-600 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
				/>
			</div>

			<div>
				<label htmlFor="metadata-description" className="text-xs text-gray-400 block mb-1">
					Description
				</label>
				<textarea
					id="metadata-description"
					defaultValue={description ?? ""}
					onBlur={(e) => onChange({ description: e.target.value || null })}
					rows={3}
					disabled={disabled}
					className="w-full rounded bg-gray-800 border border-gray-600 px-3 py-1.5 text-sm resize-none disabled:cursor-not-allowed disabled:opacity-60"
				/>
			</div>

			<div>
				<label htmlFor="metadata-category" className="text-xs text-gray-400 block mb-1">
					Category
				</label>
				<select
					id="metadata-category"
					defaultValue={category ?? ""}
					onChange={(e) => onChange({ category: e.target.value || null })}
					disabled={disabled}
					className="rounded bg-gray-800 border border-gray-600 px-3 py-1.5 text-sm text-gray-200 [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-60"
				>
					<option value="" className="bg-gray-800 text-gray-200">
						—
					</option>
					{CATEGORIES.map((c) => (
						<option key={c} value={c} className="bg-gray-800 text-gray-200">
							{c}
						</option>
					))}
				</select>
			</div>

			<div>
				<span className="text-xs text-gray-400 block mb-1">Workout Feel</span>
				<div className="flex gap-2">
					{FEEL_OPTIONS.map(({ value, label }) => (
						<button
							key={value}
							type="button"
							onClick={() => onChange({ workoutFeel: value })}
							disabled={disabled}
							className={`rounded px-2 py-1 text-xs capitalize flex flex-col items-center gap-1 disabled:cursor-not-allowed disabled:opacity-60 ${feel === value ? "bg-orange-600/20 text-orange-300 border border-orange-500/50" : "bg-gray-700 hover:bg-gray-600"}`}
							title={label}
						>
							<img src={`/assets/${label}.svg`} alt={label} className="w-6 h-6" />
							<span>{label}</span>
						</button>
					))}
				</div>
			</div>

			<div>
				<label htmlFor="metadata-effort" className="text-xs text-gray-400 block mb-1">
					Effort: {effortIndex ?? "None"}
					{effortIndex ? ` — ${EFFORT_LABELS[effortIndex] ?? ""}` : ""}
				</label>
				<input
					id="metadata-effort"
					type="range"
					min={1}
					max={10}
					value={effortIndex ?? 5}
					onChange={(e) => onChange({ effort: Number(e.target.value) * 10 })}
					disabled={disabled}
					className="w-full disabled:cursor-not-allowed disabled:opacity-60"
				/>
			</div>
		</div>
	);
}
