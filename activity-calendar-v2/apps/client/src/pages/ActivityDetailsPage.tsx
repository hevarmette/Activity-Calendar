import { useState, useCallback } from "react";
import { useParams, useSearchParams } from "react-router";
import { METERS_PER_MILE, Sport, convertSecondsToHms, formatPace } from "@activity-calendar/shared";
import type { ActivityUpdatePayload } from "@activity-calendar/shared";
import { useActivity, useRecords, useSessions, useLaps } from "../api/queries.js";
import { useSaveActivity, useSaveLap } from "../api/mutations.js";
import { useActivityNavigation } from "../hooks/useActivityNavigation.js";
import { DetailMap } from "../components/maps/DetailMap.js";
import { PerformanceCharts } from "../components/charts/PerformanceCharts.js";
import { LapTable, type LapEdit } from "../components/laps/LapTable.js";
import { ActivityMetadataEditor } from "../components/details/ActivityMetadataEditor.js";
import { SidebarAdjustments } from "../components/details/SidebarAdjustments.js";
import { SimilarActivities } from "../components/details/SimilarActivities.js";
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

	if (isLoading) return <div className="text-center py-10">Loading activity…</div>;
	if (!activity) return <div className="text-center py-10">Activity not found.</div>;

	const distance = activity.distance ?? 0;
	const duration = activity.duration ?? 0;
	const miles = distance / METERS_PER_MILE;
	const isCycling = sport === Sport.Cycling;
	const isMultisport = (sessions?.length ?? 0) > 1;

	return (
		<div className="space-y-6">
			{/* Header with nav */}
			<div className="flex items-center justify-between">
				<button onClick={goPrev} disabled={!prev} className="rounded bg-gray-700 px-3 py-1 text-sm disabled:opacity-30">
					← Prev
				</button>
				<h1 className="text-2xl font-bold">{activity.name || "Untitled Activity"}</h1>
				<button onClick={goNext} disabled={!next} className="rounded bg-gray-700 px-3 py-1 text-sm disabled:opacity-30">
					Next →
				</button>
			</div>

			{/* Summary metrics */}
			<div className="flex gap-3">
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

			{/* Tabs */}
			<div className="flex gap-1 border-b border-gray-700 pb-1">
				{(["laps", "charts", "details", "similar"] as Tab[]).map((t) => (
					<button
						key={t}
						onClick={() => setTab(t)}
						className={`rounded-t px-4 py-2 text-sm capitalize ${tab === t ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-200"}`}
					>
						{t}
					</button>
				))}
			</div>

			{/* Tab content */}
			<div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
				<div>
					{tab === "laps" && laps && <LapTable laps={laps} sport={sport} onEdits={setLapEdits} />}
					{tab === "charts" && points && <PerformanceCharts points={points} sport={sport} />}
					{tab === "details" && (
						<ActivityMetadataEditor
							name={activity.name}
							description={activity.description}
							category={activity.category}
							feel={activity.feel}
							effort={activity.effort}
							onChange={handleMetadataChange}
						/>
					)}
					{tab === "similar" && activity.name && (
						<SimilarActivities activityId={id} title={activity.name} sport={sport} />
					)}
				</div>

				{/* Sidebar */}
				<div className="space-y-4">
					<SidebarAdjustments
						distanceM={distance}
						durationS={duration}
						onDistanceChange={(m) => handleMetadataChange({ adjustedDistance: m })}
						onDurationChange={(s) => handleMetadataChange({ adjustedDuration: s })}
					/>
					<button
						onClick={handleSave}
						disabled={!isDirty || saveActivity.isPending}
						className="w-full rounded bg-green-600 px-4 py-2 text-sm font-medium hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{saveActivity.isPending ? "Saving…" : "Save Changes"}
					</button>
				</div>
			</div>
		</div>
	);
}

export default ActivityDetailsPage;
