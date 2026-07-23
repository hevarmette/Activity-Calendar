import { METERS_PER_MILE, Sport, convertSecondsToHms, formatPace, parseHmsToSeconds } from "@activity-calendar/shared";
import type { ActivityUpdatePayload } from "@activity-calendar/shared";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useSaveActivity, useSaveLap } from "../api/mutations.js";
import { useActivity, useLaps, useRecords, useSessions } from "../api/queries.js";
import { PerformanceCharts } from "../components/charts/PerformanceCharts.js";
import { ActivityStatsGrid } from "../components/details/ActivityStatsGrid.js";
import { FeelEffortRow } from "../components/details/FeelEffortRow.js";
import { SimilarActivities } from "../components/details/SimilarActivities.js";
import { AutoLapTable } from "../components/laps/AutoLapTable.js";
import { type LapEdit, LapTable } from "../components/laps/LapTable.js";
import { SwimLengthTable } from "../components/laps/SwimLengthTable.js";
import { DetailMap } from "../components/maps/DetailMap.js";
import { useActivityNavigation } from "../hooks/useActivityNavigation.js";

type Tab = "laps" | "details" | "auto-laps";

const CATEGORIES = ["uncategorized", "training", "race", "transportation", "recreational", "touring", "fitness"];

function normalizeCategory(category: string | null | undefined) {
	const trimmed = category?.trim();
	return trimmed && CATEGORIES.includes(trimmed) ? trimmed : "uncategorized";
}

export function ActivityDetailsPage() {
	const { activityId } = useParams<{ activityId: string }>();
	const [searchParams] = useSearchParams();
	const id = Number(activityId);
	const sport = searchParams.get("sport") || Sport.Running;

	const { data: activity, isLoading } = useActivity(id);
	const { data: points } = useRecords(id);
	const { data: sessions } = useSessions(id);
	const { data: laps } = useLaps(id);

	const saveActivity = useSaveActivity(id);
	const saveLap = useSaveLap();
	const { prev, next, goPrev, goNext } = useActivityNavigation(id, sport);

	const [tab, setTab] = useState<Tab>("laps");
	const [activityEdits, setActivityEdits] = useState<Partial<ActivityUpdatePayload>>({});
	const [lapEdits, setLapEditsState] = useState<LapEdit[]>([]);
	const lapEditsRef = useRef<LapEdit[]>([]);
	const setLapEdits = useCallback((edits: LapEdit[]) => {
		lapEditsRef.current = edits;
		setLapEditsState(edits);
	}, []);
	const [sessionIdx, setSessionIdx] = useState(0);
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
	const [selectedRange, setSelectedRange] = useState<[number, number] | null>(null);
	const [lastSql, setLastSql] = useState<string | null>(null);
	const [distanceInput, setDistanceInput] = useState("");
	const [durationInput, setDurationInput] = useState("");

	const handleChange = useCallback((updates: Partial<ActivityUpdatePayload>) => {
		setActivityEdits((prev) => ({ ...prev, ...updates }));
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: local edits must reset when the route activity changes.
	useEffect(() => {
		setActivityEdits({});
		setLapEdits([]);
		setLastSql(null);
		setDistanceInput("");
		setDurationInput("");
	}, [id]);

	useEffect(() => {
		if (!activity) return;
		setDistanceInput(((activity.distance ?? 0) / METERS_PER_MILE).toFixed(2));
		setDurationInput(convertSecondsToHms(activity.duration ?? 0) ?? "");
	}, [activity]);

	const isDirty = Object.keys(activityEdits).length > 0 || lapEdits.length > 0;

	// Toast state for save error feedback (TODO #4)
	const [saveError, setSaveError] = useState<string | null>(null);

	// Auto-lap distance state lifted for sharing between AutoLapTable and DetailMap
	const [autoLapDist, setAutoLapDist] = useState<number | null>(null);

	async function handleSave() {
		setSaveError(null);
		try {
			const sqls: string[] = [];
			if (Object.keys(activityEdits).length > 0) {
				const result = await saveActivity.mutateAsync(activityEdits as ActivityUpdatePayload);
				if (result?.sql) sqls.push(result.sql);
			}
			const currentLapEdits = lapEditsRef.current;
			for (const edit of currentLapEdits) {
				await saveLap.mutateAsync({ lapId: edit.lapId, [edit.field]: edit.value } as Parameters<
					typeof saveLap.mutateAsync
				>[0]);
			}
			setActivityEdits({});
			setLapEdits([]);
			setLastSql(sqls.length > 0 ? sqls.join("\n") : null);
		} catch (err) {
			const message = err instanceof Error ? err.message : "An unknown error occurred while saving.";
			setSaveError(message);
			// Auto-dismiss after 5 seconds
			setTimeout(() => setSaveError(null), 5000);
		}
	}

	// Ref to keep handleSave stable for the keyboard shortcut effect (TODO #3)
	const handleSaveRef = useRef(handleSave);
	handleSaveRef.current = handleSave;

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key !== "s" || e.metaKey || e.ctrlKey || e.altKey) return;
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
			if (isDirty) {
				e.preventDefault();
				handleSaveRef.current();
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isDirty]);

	// Multisport session scoping
	const isMultisport = (sessions?.length ?? 0) > 1;
	const activeSession = isMultisport ? sessions?.[sessionIdx] : null;
	const sessionSport = activeSession?.sport ?? sport;

	const sessionLaps = useMemo(() => {
		if (!laps) return [];
		if (!activeSession) return laps;
		const start = activeSession.firstLapIndex;
		return laps.slice(start, start + activeSession.numLaps);
	}, [laps, activeSession]);

	const sessionPoints = useMemo(() => {
		if (!points) return [];
		if (!activeSession) return points;
		const start = new Date(activeSession.startTime).getTime();
		const end = start + (activeSession.totalTimerTime ?? 0) * 1000;
		return points.filter((p) => {
			const t = new Date(p.timestamp).getTime();
			return t >= start && t <= end;
		});
	}, [points, activeSession]);

	if (isLoading) return <div className="text-center py-10 text-gray-400">Loading activity…</div>;
	if (!activity) return <div className="text-center py-10 text-gray-400">Activity not found.</div>;

	const distance = activity.distance ?? 0;
	const duration = activity.duration ?? 0;
	const editedDistance = activityEdits.adjustedDistance ?? distance;
	const editedDuration = activityEdits.adjustedDuration ?? duration;
	const miles = distance / METERS_PER_MILE;
	const editedMiles = editedDistance / METERS_PER_MILE;
	const isCycling = sessionSport === Sport.Cycling;
	const localDate = new Date(activity.localTimestamp);
	const category =
		activityEdits.category !== undefined
			? normalizeCategory(activityEdits.category)
			: normalizeCategory(activity.category);
	const title = activityEdits.activityName !== undefined ? (activityEdits.activityName ?? "") : (activity.name ?? "");
	const description =
		activityEdits.description !== undefined ? (activityEdits.description ?? "") : (activity.description ?? "");

	return (
		<div key={id} className="w-full space-y-8">
			{/* 1. Title row: title left, category + nav right */}
			<div className="flex items-center justify-between gap-6">
				<div className="flex items-baseline gap-2 flex-1 min-w-0">
					<input
						type="text"
						value={title}
						onChange={(e) => handleChange({ activityName: e.target.value || null })}
						placeholder="Activity title"
						className="flex-1 min-w-0 bg-transparent border-none text-4xl font-bold text-gray-50 placeholder-gray-600 focus:outline-none"
					/>
					<span className="text-lg text-gray-500 shrink-0">- {id}</span>
				</div>
				<div className="flex items-center gap-3 shrink-0">
					<select
						value={category}
						onChange={(e) => handleChange({ category: e.target.value || null })}
						className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-orange-500"
					>
						{CATEGORIES.map((c) => (
							<option key={c} value={c}>
								{c}
							</option>
						))}
					</select>
					<button
						type="button"
						onClick={goPrev}
						disabled={!prev}
						aria-label="Previous activity"
						className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
					>
						&lt;
					</button>
					<button
						type="button"
						onClick={goNext}
						disabled={!next}
						aria-label="Next activity"
						className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
					>
						&gt;
					</button>
				</div>
			</div>

			{/* 2. Date — small italic */}
			{/* NOTE from original Streamlit code (pages/2_Activity_Details.py):
			    "It looks like the old watch stored local_timestamp at the end of the activity
			     but new watch is beginning of activity. Activities from form are from the start." */}
			<p className="text-xs italic text-gray-500">
				{localDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} @{" "}
				{localDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
			</p>

			{/* 3. Summary metrics — horizontal cards */}
			<div className="grid grid-cols-3 gap-4">
				<MetricBlock label="Distance">
					<div className="mt-1 flex items-baseline gap-2">
						<input
							type="number"
							min={0}
							step="0.01"
							value={distanceInput}
							onChange={(e) => {
								const nextValue = e.target.value;
								setDistanceInput(nextValue);
								if (nextValue.trim() === "") return;
								const nextMiles = Number(nextValue);
								if (!Number.isNaN(nextMiles) && nextMiles >= 0) {
									handleChange({ adjustedDistance: nextMiles * METERS_PER_MILE });
								}
							}}
							onBlur={(e) => {
								const nextMiles = Number(e.target.value);
								setDistanceInput(
									!Number.isNaN(nextMiles) && nextMiles >= 0 ? nextMiles.toFixed(2) : editedMiles.toFixed(2),
								);
							}}
							className="w-full min-w-0 bg-transparent border-none p-0 text-2xl font-bold text-gray-50 tabular-nums focus:outline-none focus:text-orange-200"
							aria-label="Distance in miles"
						/>
						<span className="text-2xl font-bold text-gray-50">mi</span>
					</div>
				</MetricBlock>
				<MetricBlock label="Duration">
					<input
						type="text"
						value={durationInput}
						onChange={(e) => {
							const nextValue = e.target.value;
							setDurationInput(nextValue);
							const seconds = parseHmsToSeconds(nextValue);
							if (seconds != null) handleChange({ adjustedDuration: seconds });
						}}
						onBlur={(e) => {
							const seconds = parseHmsToSeconds(e.target.value);
							setDurationInput(convertSecondsToHms(seconds ?? editedDuration) ?? "");
						}}
						className="mt-1 w-full bg-transparent border-none p-0 text-2xl font-bold text-gray-50 tabular-nums focus:outline-none focus:text-orange-200"
						aria-label="Duration"
					/>
				</MetricBlock>
				<MetricBlock
					label={isCycling ? (activity.avgPower ? "Power" : "Speed") : "Pace"}
					value={
						isCycling
							? activity.avgPower
								? `${activity.avgPower} W`
								: `${(editedDuration > 0 ? editedMiles / (editedDuration / 3600) : 0).toFixed(2)} mph`
							: `${formatPace(editedMiles > 0 ? editedDuration / 60 / editedMiles : null) ?? "—"} /mi`
					}
				/>
			</div>

			{/* 4. Map + Description side-by-side */}
			<div className="grid grid-cols-1 md:grid-cols-[7fr_3fr] gap-4">
				<div className="min-h-[500px]">
					{sessionPoints.length > 0 && sessionPoints.some((p) => p.latitude != null) ? (
						<DetailMap
							points={sessionPoints}
							sport={sessionSport}
							sessions={isMultisport ? sessions : undefined}
							hoveredIndex={hoveredIndex}
							autoLapDist={autoLapDist}
							selectedRange={selectedRange}
							lapCount={sessionLaps.length}
						/>
					) : (
						<div className="flex items-center justify-center h-full min-h-[500px] bg-gray-900 border border-gray-800 rounded-xl text-gray-500 text-sm">
							No GPS data
						</div>
					)}
				</div>
				<div>
					<textarea
						value={description}
						onChange={(e) => handleChange({ description: e.target.value || null })}
						placeholder="Description"
						rows={8}
						className="w-full h-full min-h-[500px] rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-orange-500"
					/>
				</div>
			</div>

			{/* 5. Multisport session tabs */}
			{isMultisport && sessions && (
				<div className="flex gap-1 border-b border-gray-800" role="tablist" aria-label="Multisport sessions">
					{sessions.map((s, i) => (
						<button
							type="button"
							key={s.sessionId}
							role="tab"
							aria-selected={sessionIdx === i}
							aria-label={`${s.sport} session ${i + 1}`}
							onClick={() => setSessionIdx(i)}
							className={`capitalize px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${sessionIdx === i ? "text-orange-400 border-orange-400" : "text-gray-500 hover:text-gray-300 border-transparent"}`}
						>
							{s.sport} ({i + 1})
						</button>
					))}
				</div>
			)}

			{/* 6. Performance Charts (inline, not in tab) */}
			{sessionPoints.length > 0 && (
				<PerformanceCharts points={sessionPoints} sport={sessionSport} category={category} onHover={setHoveredIndex} onRangeSelect={setSelectedRange} laps={sessionLaps} />
			)}

			{/* 7. Three tabs: Laps / Activity Details / Auto Laps */}
			<div className="flex border-b border-gray-800" role="tablist" aria-label="Activity data tabs">
				{(["laps", "details", "auto-laps"] as Tab[]).map((t) => (
					<button
						type="button"
						key={t}
						role="tab"
						aria-selected={tab === t}
						aria-label={t === "laps" ? "Laps" : t === "details" ? "Activity Details" : "Auto Laps"}
						onClick={() => setTab(t)}
						className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t ? "text-orange-400 border-orange-400" : "text-gray-500 hover:text-gray-300 border-transparent"}`}
					>
						{t === "laps" ? "Laps" : t === "details" ? "Activity Details" : "Auto Laps"}
					</button>
				))}
			</div>

			<div>
				{tab === "laps" &&
					(sessionSport === Sport.Swimming ? (
						<SwimLengthTable activityId={id} poolLengthM={activeSession?.poolLength ?? 25} />
					) : sessionLaps.length > 0 ? (
						<LapTable laps={sessionLaps} sport={sessionSport} category={category} onEdits={setLapEdits} />
					) : (
						<p className="text-sm text-gray-500">No lap data available.</p>
					))}
				{tab === "details" && (
					<>
						<ActivityStatsGrid
							distance={editedDistance}
							duration={editedDuration}
							sport={sessionSport}
							points={sessionPoints}
							laps={sessionLaps}
							avgPower={activity.avgPower}
						/>
						{/* Show elapsed time from session data (TODO #11) */}
						{sessions && sessions.length > 0 && (() => {
							const session = activeSession ?? sessions[0];
							const elapsed = session?.totalElapsedTime;
							if (elapsed == null || elapsed <= 0) return null;
							return (
								<div className="mt-4 rounded-xl bg-gray-900 border border-gray-800 p-4 inline-block">
									<p className="text-xs font-medium uppercase tracking-wide text-gray-500">Elapsed Time</p>
									<p className="mt-1 text-lg font-semibold text-gray-100 tabular-nums">
										{convertSecondsToHms(Math.round(elapsed))}
									</p>
								</div>
							);
						})()}
					</>
				)}
				{tab === "auto-laps" && (
					<AutoLapTable activityId={id} sport={sessionSport} onDistanceChange={setAutoLapDist} />
				)}
			</div>

			{/* 8. Feel + Effort row */}
			<FeelEffortRow feel={activity.feel} effort={activity.effort} onChange={handleChange} />

			{/* 9. Save button */}
			{saveError && (
				<div
					role="alert"
					className="rounded-lg bg-red-900/50 border border-red-700 px-4 py-3 text-sm text-red-200 flex items-center justify-between"
				>
					<span>Save failed: {saveError}</span>
					<button
						type="button"
						onClick={() => setSaveError(null)}
						className="text-red-300 hover:text-red-100 ml-4"
						aria-label="Dismiss error"
					>
						✕
					</button>
				</div>
			)}
			<button
				type="button"
				data-testid="save-button"
				onClick={handleSave}
				disabled={!isDirty || saveActivity.isPending}
				aria-label="Save changes"
				className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${isDirty ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-emerald-600/30 text-emerald-200/50 cursor-not-allowed"}`}
			>
				{saveActivity.isPending ? "Saving…" : "Save Changes"}
			</button>

			{lastSql && (
				<pre className="rounded-lg bg-gray-900 border border-gray-700 p-3 text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap">
					{lastSql}
				</pre>
			)}

			{/* 10. Similar Activities at bottom */}
			{(category === "training" || category === "race") && title && (
				<div className="border-t border-gray-800 pt-6">
					<h3 className="text-sm font-medium uppercase tracking-wide text-gray-500 mb-3">Similar Activities</h3>
					<SimilarActivities activityId={id} title={title} sport={sport} />
				</div>
			)}
		</div>
	);
}

function MetricBlock({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
	return (
		<div className="rounded-xl bg-gray-900 border border-gray-800 p-4">
			<p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
			{children ?? <p className="mt-1 text-2xl font-bold text-gray-50 tabular-nums">{value}</p>}
		</div>
	);
}

export default ActivityDetailsPage;
