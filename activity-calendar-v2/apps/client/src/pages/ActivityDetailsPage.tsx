import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router";
import { METERS_PER_MILE, Sport, convertSecondsToHms, formatPace } from "@activity-calendar/shared";
import type { ActivityUpdatePayload } from "@activity-calendar/shared";
import { useActivity, useRecords, useSessions, useLaps } from "../api/queries.js";
import { useSaveActivity, useSaveLap } from "../api/mutations.js";
import { useActivityNavigation } from "../hooks/useActivityNavigation.js";
import { DetailMap } from "../components/maps/DetailMap.js";
import { PerformanceCharts } from "../components/charts/PerformanceCharts.js";
import { LapTable, type LapEdit } from "../components/laps/LapTable.js";
import { AutoLapTable } from "../components/laps/AutoLapTable.js";
import { SwimLengthTable } from "../components/laps/SwimLengthTable.js";
import { ActivityStatsGrid } from "../components/details/ActivityStatsGrid.js";
import { FeelEffortRow } from "../components/details/FeelEffortRow.js";
import { SimilarActivities } from "../components/details/SimilarActivities.js";

type Tab = "laps" | "details" | "auto-laps";

const CATEGORIES = ["uncategorized", "training", "race", "transportation", "recreational", "touring", "fitness"];

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
	const [lapEdits, setLapEdits] = useState<LapEdit[]>([]);
	const [sessionIdx, setSessionIdx] = useState(0);
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
	const [lastSql, setLastSql] = useState<string | null>(null);

	const handleChange = useCallback((updates: Partial<ActivityUpdatePayload>) => {
		setActivityEdits((prev) => ({ ...prev, ...updates }));
	}, []);

	const isDirty = Object.keys(activityEdits).length > 0 || lapEdits.length > 0;

	async function handleSave() {
		const sqls: string[] = [];
		if (Object.keys(activityEdits).length > 0) {
			const result = await saveActivity.mutateAsync(activityEdits as ActivityUpdatePayload);
			if (result?.sql) sqls.push(result.sql);
		}
		for (const edit of lapEdits) {
			await saveLap.mutateAsync({ lapId: edit.lapId, [edit.field]: edit.value } as Parameters<typeof saveLap.mutateAsync>[0]);
		}
		setActivityEdits({});
		setLapEdits([]);
		setLastSql(sqls.length > 0 ? sqls.join("\n") : null);
	}

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key !== "s" || e.metaKey || e.ctrlKey || e.altKey) return;
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
			if (isDirty) { e.preventDefault(); handleSave(); }
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	});

	// Multisport session scoping
	const isMultisport = (sessions?.length ?? 0) > 1;
	const activeSession = isMultisport ? sessions![sessionIdx] : null;
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
		return points.filter((p) => { const t = new Date(p.timestamp).getTime(); return t >= start && t <= end; });
	}, [points, activeSession]);

	if (isLoading) return <div className="text-center py-10 text-gray-400">Loading activity…</div>;
	if (!activity) return <div className="text-center py-10 text-gray-400">Activity not found.</div>;

	const distance = activity.distance ?? 0;
	const duration = activity.duration ?? 0;
	const miles = distance / METERS_PER_MILE;
	const isCycling = sessionSport === Sport.Cycling;
	const localDate = new Date(activity.localTimestamp);

	return (
		<div className="w-full space-y-8">
			{/* 1. Title row: title left, category + nav right */}
			<div className="flex items-center justify-between gap-6">
				<div className="flex items-baseline gap-2 flex-1 min-w-0">
					<input
						type="text"
						defaultValue={activity.name ?? ""}
						onBlur={(e) => handleChange({ activityName: e.target.value || null })}
						placeholder="Activity title"
						className="flex-1 min-w-0 bg-transparent border-none text-4xl font-bold text-gray-50 placeholder-gray-600 focus:outline-none"
					/>
					<span className="text-lg text-gray-500 shrink-0">- {id}</span>
				</div>
				<div className="flex items-center gap-3 shrink-0">
					<select
						defaultValue={activity.category ?? "uncategorized"}
						onChange={(e) => handleChange({ category: e.target.value || null })}
						className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-orange-500"
					>
						{CATEGORIES.map((c) => (
							<option key={c} value={c}>{c}</option>
						))}
					</select>
					<button onClick={goPrev} disabled={!prev} className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">&lt;</button>
					<button onClick={goNext} disabled={!next} className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">&gt;</button>
				</div>
			</div>

			{/* 2. Date — small italic */}
			<p className="text-xs italic text-gray-500">
				{localDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} @ {localDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
			</p>

			{/* 3. Summary metrics — horizontal cards */}
			<div className="grid grid-cols-3 gap-4">
				<MetricBlock label="Distance" value={`${miles.toFixed(2)} mi`} />
				<MetricBlock label="Duration" value={convertSecondsToHms(duration) ?? "—"} />
				<MetricBlock
					label={isCycling ? (activity.avgPower ? "Power" : "Speed") : "Pace"}
					value={
						isCycling
							? activity.avgPower ? `${activity.avgPower} W` : `${(duration > 0 ? miles / (duration / 3600) : 0).toFixed(2)} mph`
							: `${formatPace(miles > 0 ? duration / 60 / miles : null) ?? "—"} /mi`
					}
				/>
			</div>

			{/* 4. Map + Description side-by-side */}
			<div className="grid grid-cols-1 md:grid-cols-[7fr_3fr] gap-4">
				<div className="min-h-[500px]">
					{sessionPoints.length > 0 && sessionPoints.some((p) => p.latitude != null) ? (
						<DetailMap points={sessionPoints} sport={sessionSport} sessions={isMultisport ? sessions : undefined} hoveredIndex={hoveredIndex} />
					) : (
						<div className="flex items-center justify-center h-full min-h-[500px] bg-gray-900 border border-gray-800 rounded-xl text-gray-500 text-sm">No GPS data</div>
					)}
				</div>
				<div>
					<textarea
						defaultValue={activity.description ?? ""}
						onBlur={(e) => handleChange({ description: e.target.value || null })}
						placeholder="Description"
						rows={8}
						className="w-full h-full min-h-[500px] rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-orange-500"
					/>
				</div>
			</div>

			{/* 5. Multisport session tabs */}
			{isMultisport && sessions && (
				<div className="flex gap-1 border-b border-gray-800">
					{sessions.map((s, i) => (
						<button
							key={s.sessionId}
							onClick={() => setSessionIdx(i)}
							className={`capitalize px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${sessionIdx === i ? "text-orange-400 border-orange-400" : "text-gray-500 hover:text-gray-300 border-transparent"}`}
						>
							{s.sport} ({i + 1})
						</button>
					))}
				</div>
			)}

			{/* 6. Performance Charts (inline, not in tab) */}
			{sessionPoints.length > 0 && <PerformanceCharts points={sessionPoints} sport={sessionSport} onHover={setHoveredIndex} />}

			{/* 7. Three tabs: Laps / Activity Details / Auto Laps */}
			<div className="flex border-b border-gray-800">
				{(["laps", "details", "auto-laps"] as Tab[]).map((t) => (
					<button
						key={t}
						onClick={() => setTab(t)}
						className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t ? "text-orange-400 border-orange-400" : "text-gray-500 hover:text-gray-300 border-transparent"}`}
					>
						{t === "laps" ? "Laps" : t === "details" ? "Activity Details" : "Auto Laps"}
					</button>
				))}
			</div>

			<div>
				{tab === "laps" && (
					<>
						{sessionSport === Sport.Swimming ? (
							<SwimLengthTable activityId={id} poolLengthM={activeSession?.poolLength ?? 25} />
						) : sessionLaps.length > 0 ? (
							<LapTable laps={sessionLaps} sport={sessionSport} category={activity.category ?? "uncategorized"} onEdits={setLapEdits} />
						) : (
							<p className="text-sm text-gray-500">No lap data available.</p>
						)}
					</>
				)}
				{tab === "details" && (
					<ActivityStatsGrid
						distance={distance}
						duration={duration}
						sport={sessionSport}
						points={sessionPoints}
						laps={sessionLaps}
						avgPower={activity.avgPower}
					/>
				)}
				{tab === "auto-laps" && (
					<AutoLapTable activityId={id} sport={sessionSport} />
				)}
			</div>

			{/* 8. Feel + Effort row */}
			<FeelEffortRow feel={activity.feel} effort={activity.effort} onChange={handleChange} />

			{/* 9. Save button */}
			<button
				onClick={handleSave}
				disabled={!isDirty || saveActivity.isPending}
				className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${isDirty ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-emerald-600/30 text-emerald-200/50 cursor-not-allowed"}`}
			>
				{saveActivity.isPending ? "Saving…" : "Save Changes"}
			</button>

			{lastSql && (
				<pre className="rounded-lg bg-gray-900 border border-gray-700 p-3 text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap">{lastSql}</pre>
			)}

			{/* 10. Similar Activities at bottom */}
			{(activity.category === "training" || activity.category === "race") && activity.name && (
				<div className="border-t border-gray-800 pt-6">
					<h3 className="text-sm font-medium uppercase tracking-wide text-gray-500 mb-3">Similar Activities</h3>
					<SimilarActivities activityId={id} title={activity.name} sport={sport} />
				</div>
			)}
		</div>
	);
}

function MetricBlock({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-xl bg-gray-900 border border-gray-800 p-4">
			<p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
			<p className="mt-1 text-2xl font-bold text-gray-50 tabular-nums">{value}</p>
		</div>
	);
}

export default ActivityDetailsPage;
