import { useMemo } from "react";
import { useSearchParams, Link } from "react-router";
import { METERS_PER_MILE, Sport, convertSecondsToHms, formatPaceSpeed, SPORT_COLORS } from "@activity-calendar/shared";
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
		if (row.activityId == null) continue;
		const existing = map.get(row.activityId);
		if (existing) {
			existing.sport += `,${row.sport}`;
			existing.totalDistance += row.totalDistance ?? 0;
			existing.totalTimerTime += row.totalTimerTime ?? 0;
			existing.totalCalories += row.totalCalories ?? 0;
		} else {
			map.set(row.activityId, {
				activityId: row.activityId,
				localTimestamp: row.localTimestamp ?? "",
				activityName: row.activityName ?? "Untitled",
				category: row.category ?? "",
				numSessions: row.numSessions,
				sport: row.sport ?? "other",
				subSport: row.subSport ?? "",
				totalDistance: row.totalDistance ?? 0,
				totalTimerTime: row.totalTimerTime ?? 0,
				totalCalories: row.totalCalories ?? 0,
			});
		}
	}
	return [...map.values()].sort((a, b) => (b.localTimestamp ?? "").localeCompare(a.localTimestamp ?? ""));
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
	const sortField = searchParams.get("sort") || "date";
	const sortDir = searchParams.get("dir") || "desc";
	const hasFilters = sports.length > 0 || categories.length > 0 || dateFrom || dateTo || minDist || maxDist || minDur || maxDur;

	const availableSports = useMemo(() => {
		if (!data) return [];
		return [...new Set(data.map((r) => r.sport).filter(Boolean))].sort();
	}, [data]);

	const availableCategories = useMemo(() => {
		if (!data) return [];
		return [...new Set(data.map((r) => r.category?.trim()).filter((c): c is string => !!c))].sort();
	}, [data]);

	const activities = useMemo(() => {
		if (!data) return [];
		let filtered = data;
		if (sports.length > 0) filtered = filtered.filter((r) => sports.includes(r.sport));
		if (categories.length > 0) filtered = filtered.filter((r) => categories.includes(r.category?.trim() ?? ""));
		if (dateFrom) filtered = filtered.filter((r) => r.localTimestamp >= dateFrom);
		if (dateTo) filtered = filtered.filter((r) => r.localTimestamp.slice(0, 10) <= dateTo);

		const agg = aggregateActivities(filtered);

		const result = agg.filter((a) => {
			const mi = a.totalDistance / METERS_PER_MILE;
			const min = a.totalTimerTime / 60;
			if (minDist && mi < minDist) return false;
			if (maxDist && mi > maxDist) return false;
			if (minDur && min < minDur) return false;
			if (maxDur && min > maxDur) return false;
			return true;
		});

		const dir = sortDir === "asc" ? 1 : -1;
		result.sort((a, b) => {
			switch (sortField) {
				case "distance": return dir * (a.totalDistance - b.totalDistance);
				case "duration": return dir * (a.totalTimerTime - b.totalTimerTime);
				case "pace": {
					const pA = a.totalDistance > 0 ? a.totalTimerTime / a.totalDistance : Infinity;
					const pB = b.totalDistance > 0 ? b.totalTimerTime / b.totalDistance : Infinity;
					return dir * (pA - pB);
				}
				default: return dir * (a.localTimestamp ?? "").localeCompare(b.localTimestamp ?? "");
			}
		});

		return result;
	}, [data, sports, categories, dateFrom, dateTo, minDist, maxDist, minDur, maxDur, sortField, sortDir]);

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

	if (isLoading) return <div className="text-center py-10 text-gray-400">Loading search data…</div>;

	const filterPanel = (
		<div className="space-y-4">
			<div>
				<label className="text-xs font-medium text-gray-400 block mb-2">Sport</label>
				<div className="flex flex-wrap gap-1.5">
					{availableSports.map((s) => {
						const isSelected = sports.includes(s);
						const sportColor = SPORT_COLORS[s];
						return (
							<button
								key={s}
								type="button"
								onClick={() => {
									const next = isSelected
										? sports.filter((sp) => sp !== s)
										: [...sports, s];
									updateParam("sports", next.join(","));
								}}
								className={`capitalize px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
									isSelected
										? "text-white shadow-sm"
										: "bg-gray-800 text-gray-400 border border-gray-700 hover:text-gray-200 hover:border-gray-600"
								}`}
								style={isSelected ? { backgroundColor: `${sportColor ?? "#f97316"}cc`, borderColor: sportColor ?? "#f97316", border: `1px solid ${sportColor ?? "#f97316"}80` } : undefined}
							>
								{s}
							</button>
						);
					})}
				</div>
			</div>
			<div>
				<label className="text-xs font-medium text-gray-400 block mb-2">Category</label>
				<div className="flex flex-wrap gap-1.5">
					{availableCategories.map((c) => {
						const isSelected = categories.includes(c);
						return (
							<button
								key={c}
								type="button"
								onClick={() => {
									const next = isSelected
										? categories.filter((cat) => cat !== c)
										: [...categories, c];
									updateParam("categories", next.join(","));
								}}
								className={`capitalize px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap border ${
									isSelected
										? "bg-orange-500/20 text-orange-300 border-orange-500/50"
										: "bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200 hover:border-gray-600"
								}`}
							>
								{c}
							</button>
						);
					})}
				</div>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<div>
					<label className="text-xs font-medium text-gray-400 block mb-2">From</label>
					<input type="date" value={dateFrom} onChange={(e) => updateParam("from", e.target.value)} className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors" />
				</div>
				<div>
					<label className="text-xs font-medium text-gray-400 block mb-2">To</label>
					<input type="date" value={dateTo} onChange={(e) => updateParam("to", e.target.value)} className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors" />
				</div>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<div>
					<label className="text-xs font-medium text-gray-400 block mb-2">Min Dist (mi)</label>
					<input type="number" step="0.5" value={minDist || ""} onChange={(e) => updateParam("minDist", e.target.value)} className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors" />
				</div>
				<div>
					<label className="text-xs font-medium text-gray-400 block mb-2">Max Dist (mi)</label>
					<input type="number" step="0.5" value={maxDist || ""} onChange={(e) => updateParam("maxDist", e.target.value)} className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors" />
				</div>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<div>
					<label className="text-xs font-medium text-gray-400 block mb-2">Min Dur (min)</label>
					<input type="number" step="5" value={minDur || ""} onChange={(e) => updateParam("minDur", e.target.value)} className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors" />
				</div>
				<div>
					<label className="text-xs font-medium text-gray-400 block mb-2">Max Dur (min)</label>
					<input type="number" step="5" value={maxDur || ""} onChange={(e) => updateParam("maxDur", e.target.value)} className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors" />
				</div>
			</div>
		</div>
	);

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold text-gray-100">Activity Search</h1>
				<p className="text-sm text-gray-500 mt-1">Find and filter activities across your history</p>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,auto)_1fr] gap-6">
				{/* Filters */}
				<div className="min-w-0">
					<div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
						{filterPanel}
						<div className="flex gap-2 mt-4">
							<select value={sortField} onChange={(e) => updateParam("sort", e.target.value)} className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors">
								<option value="date">Sort: Date</option>
								<option value="distance">Sort: Distance</option>
								<option value="duration">Sort: Duration</option>
								<option value="pace">Sort: Pace/Speed</option>
							</select>
							<select value={sortDir} onChange={(e) => updateParam("dir", e.target.value)} className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors">
								<option value="desc">Descending</option>
								<option value="asc">Ascending</option>
							</select>
						</div>
					</div>
				</div>

				{/* Results */}
				<div className="space-y-3">
					{hasFilters ? (
						<>
							<p className="text-sm text-gray-500">{activities.length} activities found — showing {((currentPage - 1) * RESULTS_PER_PAGE) + 1}–{Math.min(currentPage * RESULTS_PER_PAGE, activities.length)}</p>

							{pageActivities.map((a) => {
								const sport = canonicalSport(a.sport, a.numSessions);
								const miles = a.totalDistance / METERS_PER_MILE;
								const paceSpeed = formatPaceSpeed(sport, a.totalDistance, a.totalTimerTime);
								const date = new Date(a.localTimestamp).toLocaleDateString();
								const sportColor = SPORT_COLORS[sport] ?? "#6b7280";
								return (
									<div key={a.activityId} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-4 hover:border-gray-700 transition-colors">
										<div className="w-1 h-12 rounded-full" style={{ backgroundColor: sportColor }} />
										<div className="flex-1 min-w-0">
											<p className="font-medium text-gray-200 truncate">{a.activityName} <span className="text-xs text-gray-500 capitalize">· {sport} · {date}</span></p>
											<div className="flex gap-4 mt-1 text-sm text-gray-400">
												<span>{miles.toFixed(2)} mi</span>
												<span>{convertSecondsToHms(a.totalTimerTime) ?? "—"}</span>
												<span>{paceSpeed}</span>
											</div>
										</div>
										<Link
											to={`/activity/${a.activityId}?sport=${sport}`}
											className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
										>
											View
										</Link>
									</div>
								);
							})}

							{/* Pagination */}
							{totalPages > 1 && (
								<div className="flex items-center justify-center gap-4 pt-4">
									<button onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1} className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
										← Prev
									</button>
									<span className="text-sm text-gray-500">Page {currentPage} of {totalPages}</span>
									<button onClick={() => setPage(currentPage + 1)} disabled={currentPage >= totalPages} className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
										Next →
									</button>
								</div>
							)}
						</>
					) : (
						<div className="flex items-center justify-center py-16 text-gray-500 text-sm">
							Select filters to search activities
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

export default ActivitySearchPage;
