import {
	EFFORT_LABELS,
	FEEL_MAP,
	Intensity,
	METERS_PER_MILE,
	SUB_SPORT_OPTIONS,
	Sport,
	parseHmsToSeconds,
} from "@activity-calendar/shared";
import type { CreateActivityPayload, CreateLapInput } from "@activity-calendar/shared";
import { useState } from "react";
import { useCreateActivity } from "../../api/mutations.js";
import { Dialog } from "../ui/Dialog.js";

interface Props {
	open: boolean;
	onClose: () => void;
	/** Pre-filled date string (YYYY-MM-DD) from calendar dateClick */
	initialDate?: string;
}

interface LapRow {
	id: number;
	distance: string;
	unit: "mi" | "km" | "m";
	time: string;
	intensity: string;
}

const FEEL_OPTIONS = Object.entries(FEEL_MAP).map(([k, v]) => ({ value: Number(k), label: v }));
const SPORT_OPTIONS: { value: "running" | "cycling" | "swimming"; label: string }[] = [
	{ value: "running", label: "Running" },
	{ value: "cycling", label: "Cycling" },
	{ value: "swimming", label: "Swimming" },
];
const INTENSITY_OPTIONS = [
	{ value: "", label: "None" },
	{ value: Intensity.Active, label: "Active" },
	{ value: Intensity.WarmUp, label: "Warm Up" },
	{ value: Intensity.Cooldown, label: "Cooldown" },
	{ value: Intensity.Rest, label: "Rest" },
	{ value: Intensity.Recovery, label: "Recovery" },
];

let nextLapId = 1;

function createEmptyLap(): LapRow {
	return { id: nextLapId++, distance: "", unit: "mi", time: "", intensity: "" };
}

/** Convert a lap row's distance to meters based on its unit. */
function lapDistanceToMeters(distance: number, unit: "mi" | "km" | "m"): number {
	switch (unit) {
		case "mi":
			return distance * METERS_PER_MILE;
		case "km":
			return distance * 1000;
		case "m":
			return distance;
	}
}

/**
 * Modal dialog for creating a manual activity (no GPS data).
 * Supports laps with distance/time/intensity, workout feel, and effort.
 * Validates inputs client-side before posting to POST /api/activities.
 */
export function CreateActivityDialog({ open, onClose, initialDate }: Props) {
	const createMutation = useCreateActivity();

	// Default start time to "now" (rounded to minute for datetime-local input)
	function getDefaultStartTime(): string {
		if (initialDate) {
			// Use the clicked date but with current time
			const now = new Date();
			const hours = String(now.getHours()).padStart(2, "0");
			const mins = String(now.getMinutes()).padStart(2, "0");
			return `${initialDate}T${hours}:${mins}`;
		}
		const now = new Date();
		const y = now.getFullYear();
		const mo = String(now.getMonth() + 1).padStart(2, "0");
		const d = String(now.getDate()).padStart(2, "0");
		const h = String(now.getHours()).padStart(2, "0");
		const mi = String(now.getMinutes()).padStart(2, "0");
		return `${y}-${mo}-${d}T${h}:${mi}`;
	}

	// Form state
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [sport, setSport] = useState<"running" | "cycling" | "swimming">("running");
	const [subSport, setSubSport] = useState("generic");
	const [category, setCategory] = useState("");
	const [startTime, setStartTime] = useState(getDefaultStartTime);
	const [duration, setDuration] = useState("");
	const [distance, setDistance] = useState("");
	const [distanceUnit, setDistanceUnit] = useState<"mi" | "km" | "m">("mi");
	const [feel, setFeel] = useState<number | null>(null);
	const [effort, setEffort] = useState<number | null>(null);
	const [laps, setLaps] = useState<LapRow[]>([]);
	const [errors, setErrors] = useState<string[]>([]);
	const [debugSql, setDebugSql] = useState(false);
	const [sqlStatements, setSqlStatements] = useState<string[]>([]);

	function resetForm() {
		setTitle("");
		setDescription("");
		setSport("running");
		setSubSport("generic");
		setCategory("");
		setStartTime(getDefaultStartTime());
		setDuration("");
		setDistance("");
		setDistanceUnit("mi");
		setFeel(null);
		setEffort(null);
		setLaps([]);
		setErrors([]);
		setSqlStatements([]);
	}

	function handleSportChange(newSport: "running" | "cycling" | "swimming") {
		setSport(newSport);
		const opts = SUB_SPORT_OPTIONS[newSport] ?? ["generic"];
		if (!opts.includes(subSport)) setSubSport(opts[0] ?? "generic");
	}

	function updateLap(id: number, field: keyof LapRow, value: string) {
		setLaps((prev) => prev.map((lap) => (lap.id === id ? { ...lap, [field]: value } : lap)));
	}

	function addLap() {
		setLaps((prev) => [...prev, createEmptyLap()]);
	}

	function removeLap(id: number) {
		setLaps((prev) => prev.filter((l) => l.id !== id));
	}

	function validate(): string[] {
		const errs: string[] = [];
		if (!title.trim()) errs.push("Title is required");
		if (title.trim().length > 200) errs.push("Title must be 200 characters or less");
		if (!startTime) errs.push("Start time is required");
		const durationSec = parseHmsToSeconds(duration);
		if (!duration.trim()) errs.push("Duration is required");
		else if (durationSec == null || durationSec <= 0)
			errs.push("Duration must be a valid time (e.g. 0:45:00 or 45:00)");
		if (category.length > 15) errs.push("Category must be 15 characters or less");
		for (let i = 0; i < laps.length; i++) {
			const lap = laps[i];
			if (!lap) continue;
			// Only validate laps that have any data entered
			const hasData = lap.distance || lap.time;
			if (!hasData) continue;
			const dist = Number.parseFloat(lap.distance);
			if (!lap.distance || Number.isNaN(dist) || dist <= 0) errs.push(`Lap ${i + 1}: distance must be > 0`);
			const lapTime = parseHmsToSeconds(lap.time);
			if (!lap.time || lapTime == null || lapTime <= 0)
				errs.push(`Lap ${i + 1}: time must be valid (e.g. 7:30 or 0:07:30.00)`);
		}
		return errs;
	}

	function handleSubmit() {
		const validationErrors = validate();
		if (validationErrors.length > 0) {
			setErrors(validationErrors);
			return;
		}
		setErrors([]);

		const durationSec = parseHmsToSeconds(duration) ?? 0;
		// Only include laps that have both distance and time entered
		const lapInputs: CreateLapInput[] = laps
			.filter((lap) => lap.distance && lap.time)
			.map((lap) => ({
				distance: lapDistanceToMeters(Number.parseFloat(lap.distance), lap.unit),
				time: parseHmsToSeconds(lap.time) ?? 0,
				intensity: lap.intensity || undefined,
			}));

		const payload: CreateActivityPayload = {
			title: title.trim(),
			description: description.trim() || undefined,
			sport,
			subSport,
			category: category.trim() || undefined,
			localTimestamp: startTime.replace("T", "T").padEnd(19, ":00"),
			duration: durationSec,
			distance: distance ? lapDistanceToMeters(Number.parseFloat(distance), distanceUnit) : undefined,
			workoutFeel: feel,
			effort: effort != null ? effort * 10 : undefined,
			laps: lapInputs,
			debugSql,
		};

		createMutation.mutate(payload, {
			onSuccess: (result) => {
				if (debugSql && result.sql) {
					setSqlStatements(result.sql);
				} else {
					resetForm();
					onClose();
				}
			},
			onError: (err) => {
				setErrors([err.message ?? "Failed to create activity"]);
			},
		});
	}

	const subSportOptions = SUB_SPORT_OPTIONS[sport] ?? ["generic"];

	return (
		<Dialog open={open} onClose={onClose} title="Create Activity" subtitle="Add a manual activity without GPS data">
			<div className="space-y-4">
				{/* Errors */}
				{errors.length > 0 && (
					<div className="rounded-lg bg-red-900/30 border border-red-700/50 px-3 py-2 text-sm text-red-300">
						{errors.map((e) => (
							<p key={e}>• {e}</p>
						))}
					</div>
				)}

				{/* Title */}
				<div>
					<label htmlFor="create-title" className="text-xs font-medium text-gray-400 block mb-1">
						Title <span className="text-red-400">*</span>
					</label>
					<input
						id="create-title"
						type="text"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Morning Run"
						maxLength={200}
						className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-colors"
					/>
				</div>

				{/* Sport + Sub-sport row */}
				<div className="grid grid-cols-2 gap-3">
					<div>
						<label htmlFor="create-sport" className="text-xs font-medium text-gray-400 block mb-1">
							Sport <span className="text-red-400">*</span>
						</label>
						<select
							id="create-sport"
							value={sport}
							onChange={(e) => handleSportChange(e.target.value as "running" | "cycling" | "swimming")}
							className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-colors"
						>
							{SPORT_OPTIONS.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</select>
					</div>
					<div>
						<label htmlFor="create-subsport" className="text-xs font-medium text-gray-400 block mb-1">
							Sub-sport
						</label>
						<select
							id="create-subsport"
							value={subSport}
							onChange={(e) => setSubSport(e.target.value)}
							className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-colors"
						>
							{subSportOptions.map((o) => (
								<option key={o} value={o}>
									{o.replace("_", " ")}
								</option>
							))}
						</select>
					</div>
				</div>

				{/* Category + Start Time row */}
				<div className="grid grid-cols-2 gap-3">
					<div>
						<label htmlFor="create-category" className="text-xs font-medium text-gray-400 block mb-1">
							Category
						</label>
						<input
							id="create-category"
							type="text"
							value={category}
							onChange={(e) => setCategory(e.target.value)}
							placeholder="training"
							maxLength={15}
							className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-colors"
						/>
					</div>
					<div>
						<label htmlFor="create-start" className="text-xs font-medium text-gray-400 block mb-1">
							Start Time <span className="text-red-400">*</span>
						</label>
						<input
							id="create-start"
							type="datetime-local"
							value={startTime}
							onChange={(e) => setStartTime(e.target.value)}
							className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-colors"
						/>
					</div>
				</div>

				{/* Duration + Distance row */}
				<div className="grid grid-cols-2 gap-3">
					<div>
						<label htmlFor="create-duration" className="text-xs font-medium text-gray-400 block mb-1">
							Duration <span className="text-red-400">*</span>
						</label>
						<input
							id="create-duration"
							type="text"
							value={duration}
							onChange={(e) => setDuration(e.target.value)}
							placeholder="1:30:00.00 or 5400"
							aria-label="Total duration in h:mm:ss.xx, m:ss, or raw seconds"
							className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-colors"
						/>
						<p className="text-xs text-gray-600 mt-0.5">HH:MM:SS.XX, H:M:S, or seconds</p>
					</div>
					<div>
						<label htmlFor="create-distance" className="text-xs font-medium text-gray-400 block mb-1">
							Distance
						</label>
						<div className="flex gap-1.5">
							<input
								id="create-distance"
								type="number"
								step="0.01"
								min="0"
								value={distance}
								onChange={(e) => setDistance(e.target.value)}
								placeholder="5.0"
								aria-label="Total distance"
								className="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-colors"
							/>
							<select
								value={distanceUnit}
								onChange={(e) => setDistanceUnit(e.target.value as "mi" | "km" | "m")}
								aria-label="Distance unit"
								className="rounded-lg bg-gray-800 border border-gray-700 px-2 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-colors"
							>
								<option value="mi">mi</option>
								<option value="km">km</option>
								<option value="m">m</option>
							</select>
						</div>
					</div>
				</div>

				{/* Description */}
				<div>
					<label htmlFor="create-description" className="text-xs font-medium text-gray-400 block mb-1">
						Description
					</label>
					<textarea
						id="create-description"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Notes about the activity..."
						rows={2}
						className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-colors resize-none"
					/>
				</div>

				{/* Workout Feel */}
				<div>
					<span className="text-xs font-medium text-gray-400 block mb-1.5">Workout Feel</span>
					<div className="flex gap-2">
						{FEEL_OPTIONS.map(({ value, label }) => (
							<button
								key={value}
								type="button"
								onClick={() => setFeel(feel === value ? null : value)}
								className={`rounded-lg px-2.5 py-1.5 text-[10px] capitalize flex flex-col items-center gap-0.5 transition-colors ${
									feel === value
										? "bg-red-600/20 border border-red-600 ring-1 ring-red-500/50"
										: "bg-gray-800 border border-gray-700 hover:border-gray-600"
								}`}
								title={label}
								aria-label={`Feel: ${label}`}
								aria-pressed={feel === value}
							>
								<img src={`/assets/${label}.svg`} alt={label} className="w-6 h-6" />
								<span className="text-gray-400">{label.replace("-", " ")}</span>
							</button>
						))}
					</div>
				</div>

				{/* Effort slider */}
				<div>
					<label htmlFor="create-effort" className="text-xs font-medium text-gray-400 block mb-1">
						Perceived Effort{effort != null ? `: ${effort} — ${EFFORT_LABELS[effort] ?? ""}` : ""}
					</label>
					<input
						id="create-effort"
						type="range"
						min={1}
						max={10}
						value={effort ?? 5}
						onChange={(e) => setEffort(Number(e.target.value))}
						className="w-full accent-red-600"
					/>
					<div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
						{Array.from({ length: 10 }, (_, i) => (
							<span key={`effort-${i + 1}`}>{i + 1}</span>
						))}
					</div>
				</div>

				{/* Lap Splits */}
				<div>
					<div className="flex items-center justify-between mb-1.5">
						<span className="text-xs font-medium text-gray-400">
							Lap Splits <span className="text-gray-600 font-normal">(optional — auto-generates 1 lap if empty)</span>
						</span>
						<button
							type="button"
							onClick={addLap}
							className="text-xs text-red-400 hover:text-red-300 transition-colors"
							aria-label="Add lap"
						>
							+ Add Lap
						</button>
					</div>
					<div className="rounded-lg border border-gray-700 overflow-hidden">
						{/* Header */}
						<div className="grid grid-cols-[1fr_60px_1fr_100px_32px] gap-1 px-2 py-1.5 bg-gray-800/80 text-[10px] font-medium text-gray-500 uppercase tracking-wide">
							<span>Distance</span>
							<span>Unit</span>
							<span>Time</span>
							<span>Intensity</span>
							<span />
						</div>
						{/* Rows */}
						{laps.map((lap, idx) => (
							<div
								key={lap.id}
								className="grid grid-cols-[1fr_60px_1fr_100px_32px] gap-1 px-2 py-1 border-t border-gray-800 items-center"
							>
								<input
									type="number"
									step="0.01"
									min="0"
									value={lap.distance}
									onChange={(e) => updateLap(lap.id, "distance", e.target.value)}
									placeholder="5.0"
									aria-label={`Lap ${idx + 1} distance`}
									className="w-full rounded bg-gray-900 border border-gray-700 px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-red-500/50 transition-colors"
								/>
								<select
									value={lap.unit}
									onChange={(e) => updateLap(lap.id, "unit", e.target.value)}
									aria-label={`Lap ${idx + 1} unit`}
									className="w-full rounded bg-gray-900 border border-gray-700 px-1 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-red-500/50 transition-colors"
								>
									<option value="mi">mi</option>
									<option value="km">km</option>
									<option value="m">m</option>
								</select>
								<input
									type="text"
									value={lap.time}
									onChange={(e) => updateLap(lap.id, "time", e.target.value)}
									placeholder="7:30.00"
									aria-label={`Lap ${idx + 1} time`}
									className="w-full rounded bg-gray-900 border border-gray-700 px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-red-500/50 transition-colors"
								/>
								<select
									value={lap.intensity}
									onChange={(e) => updateLap(lap.id, "intensity", e.target.value)}
									aria-label={`Lap ${idx + 1} intensity`}
									className="w-full rounded bg-gray-900 border border-gray-700 px-1 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-red-500/50 transition-colors"
								>
									{INTENSITY_OPTIONS.map((o) => (
										<option key={o.value} value={o.value}>
											{o.label}
										</option>
									))}
								</select>
								<button
									type="button"
									onClick={() => removeLap(lap.id)}
									className="text-gray-600 hover:text-red-400 text-sm transition-colors"
									aria-label={`Remove lap ${idx + 1}`}
								>
									✕
								</button>
							</div>
						))}
					</div>
				</div>

				{/* SQL Debug */}
				<div className="flex items-center gap-2">
					<input
						id="create-debug-sql"
						type="checkbox"
						checked={debugSql}
						onChange={(e) => {
							setDebugSql(e.target.checked);
							if (!e.target.checked) setSqlStatements([]);
						}}
						className="rounded border-gray-600 bg-gray-800 text-orange-600 focus:ring-orange-500/50"
					/>
					<label htmlFor="create-debug-sql" className="text-xs text-gray-400">
						Show SQL (debug)
					</label>
				</div>

				{/* SQL Output */}
				{sqlStatements.length > 0 && (
					<div className="rounded-lg bg-gray-900 border border-gray-700 p-3 max-h-48 overflow-y-auto">
						<p className="text-xs font-medium text-gray-400 mb-2">SQL Executed:</p>
						{sqlStatements.map((stmt, i) => (
							<pre key={`sql-${i}`} className="text-xs text-green-400 whitespace-pre-wrap mb-2 font-mono">
								{stmt}
							</pre>
						))}
					</div>
				)}

				{/* Submit */}
				<div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-700">
					<button
						type="button"
						onClick={onClose}
						className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleSubmit}
						disabled={createMutation.isPending}
						className="rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2 text-sm font-medium text-white transition-colors"
					>
						{createMutation.isPending ? "Creating…" : "Create Activity"}
					</button>
				</div>
			</div>
		</Dialog>
	);
}
