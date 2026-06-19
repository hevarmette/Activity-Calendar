import { useMemo } from "react";
import { useSearchParams, Link } from "react-router";
import { METERS_PER_MILE, Sport, convertSecondsToHms, formatPaceSpeed } from "@activity-calendar/shared";
import type { SearchRow } from "@activity-calendar/shared";
import { useSearch } from "../api/queries.js";
import { MetricCard } from "../components/ui/MetricCard.js";

const RESULTS_PER_PAGE = 20;

interface Activity {
	activityId: number;
	localTimestamp: string;
	activityName: string;
	category: string;
	numSessions: number;
	sport: string;
	subSport: string;
	totalDistance: number;
	totalTimerTime: number;
	totalCalories: number;
}

function aggregateActivities(rows: SearchRow[]): Activity[] {
	const map = new Map<number, Activity>();
	for (const row of rows) {
		const existing = map.get(row.activityId);
		if (existing) {
			existing.sport += `,${row.sport}`;
			existing.totalDistance += row.totalDistance ?? 0;
			existing.totalTimerTime += row.totalTimerTime ?? 0;
			existing.totalCalories += row.totalCalories ?? 0;
		} else {
			map.set(row.activityId, {
				activityId: row.activityId,
				localTimestamp: row.localTimestamp,
				activityName: row.activityName ?? "Untitled",
				category: row.category ?? "",
				numSessions: row.numSessions,
				sport: row.sport,
				subSport: row.subSport ?? "",
				totalDistance: row.totalDistance ?? 0,
				totalTimerTime: row.totalTimerTime ?? 0,
				totalCalories: row.totalCalories ?? 0,
			});
		}
	}
	return [...map.values()].sort((a, b) => b.localTimestamp.localeCompare(a.localTimestamp));
}

function canonicalSport(sport: string, numSessions: number): string {
	const sports = sport.split(",").map((s) => s.trim());
	if (numSessions > 1 || new Set(sports).size > 1) return Sport.Multisport;
	return sports[0] ?? "other";
}

export function ActivitySearchPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const { data, isLoading } = useSearch();

	const sports = searchParams.get("sports")?.split(",").filter(Boolean) ?? [];
	const categories = searchParams.get("categories")?.split(",").filter(Boolean) ?? [];
	const dateFrom = searchParams.get("from") ?? "";
	const dateTo = searchParams.get("to") ?? "";
	const minDist = Number(searchParams.get("minDist")) || 0;
	const maxDist = Number(searchParams.get("maxDist")) || 0;
	const minDur = Number(searchParams.get("minDur")) || 0;
	const maxDur = Number(searchParams.get("maxDur")) || 0;
	const page = Number(searchParams.get("page")) || 1;
	const hasFilters = sports.length > 0 || categories.length > 0 || dateFrom || dateTo || minDist || maxDist || minDur || maxDur;

	const availableSports = useMemo(() => {
		if (!data) return [];
		return [...new Set(data.map((r) => r.sport))].sort();
	}, [data]);

	const availableCategories = useMemo(() => {
		if (!data) return [];
		return [...new Set(data.map((r) => r.category?.trim()).filter(Boolean) as string[])].sort();
	}, [data]);

	const activities = useMemo(() => {
		if (!data) return [];
		let filtered = data;
		if (sports.length > 0) filtered = filtered.filter((r) => sports.includes(r.sport));
		if (categories.length > 0) filtered = filtered.filter((r) => categories.includes(r.category?.trim() ?? ""));
		if (dateFrom) filtered = filtered.filter((r) => r.localTimestamp >= dateFrom);
		if (dateTo) filtered = filtered.filter((r) => r.localTimestamp.slice(0, 10) <= dateTo);

		const agg = aggregateActivities(filtered);

		return agg.filter((a) => {
			const mi = a.totalDistance / METERS_PER_MILE;
			const min = a.totalTimerTime / 60;
			if (minDist && mi < minDist) return false;
			if (maxDist && mi > maxDist) return false;
			if (minDur && min < minDur) return false;
			if (maxDur && min > maxDur) return false;
			return true;
		});
	}, [data, sports, categories, dateFrom, dateTo, minDist, maxDist, minDur, maxDur]);

	const totalPages = Math.max(1, Math.ceil(activities.length / RESULTS_PER_PAGE));
	const currentPage = Math.min(page, totalPages);
	const pageActivities = activities.slice((currentPage - 1) * RESULTS_PER_PAGE, currentPage * RESULTS_PER_PAGE);

	function updateParam(key: string, value: string) {
		const params = new URLSearchParams(searchParams);
		if (value) params.set(key, value);
		else params.delete(key);
		params.set("page", "1");
		setSearchParams(params);
	}

	function setPage(p: number) {
		const params = new URLSearchParams(searchParams);
		params.set("page", String(p));
		setSearchParams(params);
	}

	if (isLoading) return <div className="text-center py-10">Loading search data…</div>;

	const filterPanel = (
		<div className="space-y-3">
			<div>
				<label className="text-xs text-gray-400 block mb-1">Sport</label>
				<select
					multiple
					value={sports}
					onChange={(e) => updateParam("sports", Array.from(e.target.selectedOptions, (o) => o.value).join(","))}
					className="w-full rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm"
				>
					{availableSports.map((s) => <option key={s} value={s}>{s}</option>)}
				</select>
			</div>
			<div>
				<label className="text-xs text-gray-400 block mb-1">Category</label>
				<select
					multiple
					value={categories}
					onChange={(e) => updateParam("categories", Array.from(e.target.selectedOptions, (o) => o.value).join(","))}
					className="w-full rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm"
				>
					{availableCategories.map((c) => <option key={c} value={c}>{c}</option>)}
				</select>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<div>
					<label className="text-xs text-gray-400 block mb-1">From</label>
					<input type="date" value={dateFrom} onChange={(e) => updateParam("from", e.target.value)} className="w-full rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm" />
				</div>
				<div>
					<label className="text-xs text-gray-400 block mb-1">To</label>
					<input type="date" value={dateTo} onChange={(e) => updateParam("to", e.target.value)} className="w-full rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm" />
				</div>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<div>
					<label className="text-xs text-gray-400 block mb-1">Min Dist (mi)</label>
					<input type="number" step="0.5" value={minDist || ""} onChange={(e) => updateParam("minDist", e.target.value)} className="w-full rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm" />
				</div>
				<div>
					<label className="text-xs text-gray-400 block mb-1">Max Dist (mi)</label>
					<input type="number" step="0.5" value={maxDist || ""} onChange={(e) => updateParam("maxDist", e.target.value)} className="w-full rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm" />
				</div>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<div>
					<label className="text-xs text-gray-400 block mb-1">Min Dur (min)</label>
					<input type="number" step="5" value={minDur || ""} onChange={(e) => updateParam("minDur", e.target.value)} className="w-full rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm" />
				</div>
				<div>
					<label className="text-xs text-gray-400 block mb-1">Max Dur (min)</label>
					<input type="number" step="5" value={maxDur || ""} onChange={(e) => updateParam("maxDur", e.target.value)} className="w-full rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm" />
				</div>
			</div>
		</div>
	);

	return (
		<div className="space-y-4">
			<h1 className="text-2xl font-bold">Activity Search</h1>

			<div className={hasFilters ? "grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6" : ""}>
				{/* Filters: sidebar when results shown, inline otherwise */}
				<div className={hasFilters ? "" : "max-w-md mb-4"}>
					{filterPanel}
				</div>

				{/* Results */}
				{hasFilters && (
					<div className="space-y-3">
						<p className="text-sm text-gray-400">{activities.length} activities found — showing {((currentPage - 1) * RESULTS_PER_PAGE) + 1}–{Math.min(currentPage * RESULTS_PER_PAGE, activities.length)}</p>

						{pageActivities.map((a) => {
							const sport = canonicalSport(a.sport, a.numSessions);
							const miles = a.totalDistance / METERS_PER_MILE;
							const paceSpeed = formatPaceSpeed(sport, a.totalDistance, a.totalTimerTime);
							const date = new Date(a.localTimestamp).toLocaleDateString();
							return (
								<div key={a.activityId} className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 flex items-center justify-between">
									<div>
										<p className="font-medium">{a.activityName} <span className="text-xs text-gray-400 capitalize">· {sport} · {date}</span></p>
										<div className="flex gap-4 mt-1 text-sm text-gray-400">
											<span>{miles.toFixed(2)} mi</span>
											<span>{convertSecondsToHms(a.totalTimerTime) ?? "—"}</span>
											<span>{paceSpeed}</span>
										</div>
									</div>
									<Link
										to={`/activity/${a.activityId}?sport=${sport}`}
										className="rounded bg-gray-700 px-3 py-1 text-sm hover:bg-gray-600"
									>
										View
									</Link>
								</div>
							);
						})}

						{/* Pagination */}
						{totalPages > 1 && (
							<div className="flex items-center justify-center gap-4 pt-2">
								<button onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1} className="rounded bg-gray-700 px-3 py-1 text-sm disabled:opacity-30">
									← Prev
								</button>
								<span className="text-sm text-gray-400">Page {currentPage} of {totalPages}</span>
								<button onClick={() => setPage(currentPage + 1)} disabled={currentPage >= totalPages} className="rounded bg-gray-700 px-3 py-1 text-sm disabled:opacity-30">
									Next →
								</button>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

export default ActivitySearchPage;
