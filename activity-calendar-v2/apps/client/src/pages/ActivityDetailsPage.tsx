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
import { ActivityMetadataEditor } from "../components/details/ActivityMetadataEditor.js";
import { SidebarAdjustments } from "../components/details/SidebarAdjustments.js";
import { SimilarActivities } from "../components/details/SimilarActivities.js";
import { RunningDynamics } from "../components/details/RunningDynamics.js";
import { BestLap } from "../components/details/BestLap.js";
import { MetricCard } from "../components/ui/MetricCard.js";

type Tab = "laps" | "charts" | "details" | "similar";

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

	const handleMetadataChange = useCallback((updates: Partial<ActivityUpdatePayload>) => {
		setActivityEdits((prev) => ({ ...prev, ...updates }));
	}, []);

	const isDirty = Object.keys(activityEdits).length > 0 || lapEdits.length > 0;

	async function handleSave() {
		if (Object.keys(activityEdits).length > 0) {
			await saveActivity.mutateAsync(activityEdits as ActivityUpdatePayload);
		}
		for (const edit of lapEdits) {
			await saveLap.mutateAsync({ lapId: edit.lapId, [edit.field]: edit.value } as Parameters<typeof saveLap.mutateAsync>[0]);
		}
		setActivityEdits({});
		setLapEdits([]);
	}

	// TASK 5: Keyboard shortcut 'S' to save
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

	// TASK 7: Multisport session scoping
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

	return (
		<div className="space-y-6">
			{/* Header with nav */}
			<div className="flex items-center justify-between">
				<button onClick={goPrev} disabled={!prev} className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
					← Prev
				</button>
				<h1 className="text-2xl font-bold text-gray-100">{activity.name || "Untitled Activity"}</h1>
				<button onClick={goNext} disabled={!next} className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
					Next →
				</button>
			</div>

			{/* Summary metrics */}
			<div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
				<MetricCard label="Distance" value={`${miles.toFixed(2)} mi`} />
				<MetricCard label="Duration" value={convertSecondsToHms(duration) ?? "—"} />
				<MetricCard
					label={isCycling ? "Speed" : "Pace"}
					value={
						isCycling
							? `${(duration > 0 ? miles / (duration / 3600) : 0).toFixed(1)} mph`
							: `${formatPace(miles > 0 ? duration / 60 / miles : null) ?? "—"} /mi`
					}
				/>
			</div>

			{/* Map */}
			{points && points.length > 0 && (
				<DetailMap points={points} sport={sport} sessions={isMultisport ? sessions : undefined} />
			)}

			{/* TASK 7: Multisport session tabs */}
			{isMultisport && sessions && (
				<div className="flex gap-1 border-b border-gray-800">
					{sessions.map((s, i) => (
						<button
							key={s.sessionId}
							onClick={() => setSessionIdx(i)}
							className={`capitalize ${sessionIdx === i ? "px-4 py-2.5 text-sm font-medium text-orange-400 border-b-2 border-orange-400" : "px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-300 border-b-2 border-transparent transition-colors"}`}
						>
							{s.sport} ({i + 1})
						</button>
					))}
				</div>
			)}

			{/* Tabs */}
			<div className="flex border-b border-gray-800 mb-6">
				{(["laps", "charts", "details", "similar"] as Tab[]).map((t) => (
					<button
						key={t}
						onClick={() => setTab(t)}
						className={`capitalize ${tab === t ? "px-4 py-2.5 text-sm font-medium text-orange-400 border-b-2 border-orange-400" : "px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-300 border-b-2 border-transparent transition-colors"}`}
					>
						{t}
					</button>
				))}
			</div>

			{/* Tab content */}
			<div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
				<div>
					{tab === "laps" && sessionLaps.length > 0 && (
						<>
							<BestLap laps={sessionLaps} sport={sessionSport} />
							<div className="mt-4">
								{sessionSport === Sport.Swimming ? (
									<SwimLengthTable activityId={id} poolLengthM={activeSession?.poolLength ?? 25} />
								) : (
									<LapTable laps={sessionLaps} sport={sessionSport} onEdits={setLapEdits} />
								)}
							</div>
							<div className="mt-4">
								<h3 className="text-sm font-medium text-gray-400 mb-2">Auto Laps</h3>
								<AutoLapTable activityId={id} sport={sessionSport} />
							</div>
						</>
					)}
					{tab === "charts" && sessionPoints.length > 0 && <PerformanceCharts points={sessionPoints} sport={sessionSport} />}
					{tab === "details" && (
						<>
							<ActivityMetadataEditor
								name={activity.name}
								description={activity.description}
								category={activity.category}
								feel={activity.feel}
								effort={activity.effort}
								onChange={handleMetadataChange}
							/>
							{sessionLaps.length > 0 && sessionSport === Sport.Running && (
								<div className="mt-4">
									<RunningDynamics laps={sessionLaps} />
								</div>
							)}
						</>
					)}
					{tab === "similar" && activity.name && (
						<SimilarActivities activityId={id} title={activity.name} sport={sport} />
					)}
				</div>

				{/* Sidebar */}
				<div className="space-y-4">
					<div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
						<SidebarAdjustments
							distanceM={distance}
							durationS={duration}
							onDistanceChange={(m) => handleMetadataChange({ adjustedDistance: m })}
							onDurationChange={(s) => handleMetadataChange({ adjustedDuration: s })}
						/>
					</div>
					<button
						onClick={handleSave}
						disabled={!isDirty || saveActivity.isPending}
						className={isDirty ? "w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white transition-colors" : "w-full rounded-lg bg-emerald-600/30 px-4 py-2.5 text-sm font-medium text-emerald-200/50 cursor-not-allowed"}
					>
						{saveActivity.isPending ? "Saving…" : "Save Changes"}
					</button>
				</div>
			</div>
		</div>
	);
}

export default ActivityDetailsPage;
