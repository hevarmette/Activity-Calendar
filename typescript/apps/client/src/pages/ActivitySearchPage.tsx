import { METERS_PER_MILE, SPORT_COLORS, Sport, convertSecondsToHms, formatPaceSpeed } from "@activity-calendar/shared";
import type { SearchRow } from "@activity-calendar/shared";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { downloadActivitiesZip } from "../api/client.js";
import { useSearch } from "../api/queries.js";

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

	// --- Text search state (fuzzy, title, description) ---
	const qParam = searchParams.get("q") ?? "";
	const titleParam = searchParams.get("titleSearch") ?? "";
	const descParam = searchParams.get("descriptionSearch") ?? "";

	// Live input state for controlled inputs
	const [searchText, setSearchText] = useState(qParam);
	const [titleText, setTitleText] = useState(titleParam);
	const [descText, setDescText] = useState(descParam);

	// Committed values — only update when user presses Enter
	const [committedQ, setCommittedQ] = useState(qParam);
	const [committedTitle, setCommittedTitle] = useState(titleParam);
	const [committedDesc, setCommittedDesc] = useState(descParam);

	/**
	 * Commits all text search fields at once. Called when the user presses Enter
	 * in any of the search inputs. This triggers the API request and URL update.
	 */
	function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Enter") {
			setCommittedQ(searchText);
			setCommittedTitle(titleText);
			setCommittedDesc(descText);
		}
	}

	// Sync committed text values back to URL search params
	useEffect(() => {
		setSearchParams((prev) => {
			const next = new URLSearchParams(prev);
			let changed = false;

			for (const [key, val] of [
				["q", committedQ],
				["titleSearch", committedTitle],
				["descriptionSearch", committedDesc],
			] as const) {
				const current = prev.get(key) ?? "";
				if (val !== current) {
					if (val) next.set(key, val);
					else next.delete(key);
					changed = true;
				}
			}

			if (changed) {
				next.set("page", "1");
				return next;
			}
			return prev;
		});
	}, [committedQ, committedTitle, committedDesc, setSearchParams]);

	// Build search params object for the API hook
	const searchApiParams = useMemo(() => {
		const hasAny = committedQ || committedTitle || committedDesc;
		if (!hasAny) return undefined;
		return {
			q: committedQ || undefined,
			titleSearch: committedTitle || undefined,
			descriptionSearch: committedDesc || undefined,
		};
	}, [committedQ, committedTitle, committedDesc]);

	const { data, isLoading } = useSearch(searchApiParams);

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

	// --- Date filter local state ---
	// Native `type=date` inputs emit intermediate empty/partial values while the
	// user types a year (e.g. "202" before "2026"), which — if committed directly
	// to the URL — would wipe the value and reset the page. We hold the input value
	// in local state and only commit a *complete valid* date (or an explicit clear
	// on blur) to the URL. Mirrors the previously-fixed calendar-year bug.
	const [fromInput, setFromInput] = useState(dateFrom);
	const [toInput, setToInput] = useState(dateTo);

	// Keep local input state in sync when the URL param changes externally
	// (e.g. back/forward navigation, shared links).
	useEffect(() => {
		setFromInput(dateFrom);
	}, [dateFrom]);
	useEffect(() => {
		setToInput(dateTo);
	}, [dateTo]);

	/** True for the empty string or a complete YYYY-MM-DD date the browser accepts. */
	function isCommittableDate(value: string): boolean {
		if (value === "") return true;
		return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
	}

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
		if (dateFrom) filtered = filtered.filter((r) => r.localTimestamp != null && r.localTimestamp >= dateFrom);
		if (dateTo) filtered = filtered.filter((r) => r.localTimestamp != null && r.localTimestamp.slice(0, 10) <= dateTo);

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
				case "distance":
					return dir * (a.totalDistance - b.totalDistance);
				case "duration":
					return dir * (a.totalTimerTime - b.totalTimerTime);
				case "pace": {
					const pA = a.totalDistance > 0 ? a.totalTimerTime / a.totalDistance : Number.POSITIVE_INFINITY;
					const pB = b.totalDistance > 0 ? b.totalTimerTime / b.totalDistance : Number.POSITIVE_INFINITY;
					return dir * (pA - pB);
				}
				default:
					return dir * (a.localTimestamp ?? "").localeCompare(b.localTimestamp ?? "");
			}
		});

		return result;
	}, [data, sports, categories, dateFrom, dateTo, minDist, maxDist, minDur, maxDur, sortField, sortDir]);

	const totalPages = Math.max(1, Math.ceil(activities.length / RESULTS_PER_PAGE));
	const currentPage = Math.min(page, totalPages);
	const pageActivities = activities.slice((currentPage - 1) * RESULTS_PER_PAGE, currentPage * RESULTS_PER_PAGE);

	// --- Multi-select + export state ---
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
	const [isExporting, setIsExporting] = useState(false);
	const [exportError, setExportError] = useState<string | null>(null);

	// The full set of activity IDs currently matching the filters (all pages).
	const allMatchingIds = useMemo(() => activities.map((a) => a.activityId), [activities]);

	// Stable signature of the matching id set. Using a string here (instead of the
	// array reference) means the reset effect below only fires when the actual set
	// of matching activities changes — not on every render — so toggling "Select
	// all" persists rather than being wiped by a fresh array identity.
	const matchingIdsSignature = useMemo(() => allMatchingIds.join(","), [allMatchingIds]);

	// Reset the selection whenever the matching set changes (filters/search).
	// biome-ignore lint/correctness/useExhaustiveDependencies: selection resets only when the matching id set (by value) changes.
	useEffect(() => {
		setSelectedIds(new Set());
	}, [matchingIdsSignature]);

	const allSelected = allMatchingIds.length > 0 && selectedIds.size === allMatchingIds.length;

	function toggleSelected(activityId: number) {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(activityId)) next.delete(activityId);
			else next.add(activityId);
			return next;
		});
	}

	function toggleSelectAll() {
		setSelectedIds((prev) => (prev.size === allMatchingIds.length ? new Set() : new Set(allMatchingIds)));
	}

	/** Confirm before large exports, then download a ZIP of the given IDs. */
	async function runExport(ids: number[]) {
		if (isExporting || ids.length === 0) return;
		if (ids.length > 50 && !window.confirm(`Export ${ids.length} activities? This may take a moment.`)) return;
		setExportError(null);
		setIsExporting(true);
		try {
			await downloadActivitiesZip({ activityIds: ids });
		} catch (err) {
			const message = err instanceof Error ? err.message : "Export failed.";
			setExportError(message);
			setTimeout(() => setExportError(null), 6000);
		} finally {
			setIsExporting(false);
		}
	}

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
			{/* Fuzzy search — matches variations like "5x600m" vs "5 x 600m" */}
			<div>
				<label htmlFor="search-fuzzy" className="text-xs font-medium text-gray-400 block mb-1">
					Fuzzy Search
				</label>
				<input
					id="search-fuzzy"
					type="text"
					value={searchText}
					onChange={(e) => setSearchText(e.target.value)}
					onKeyDown={handleSearchKeyDown}
					placeholder="Fuzzy match (e.g. 5x600m)…"
					aria-label="Fuzzy search activities by title or description, press Enter to search"
					className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors"
				/>
				<p className="text-[10px] text-gray-600 mt-1">Press Enter to search</p>
			</div>
			{/* Exact title search — case-insensitive substring match on activity name */}
			<div>
				<label htmlFor="search-title" className="text-xs font-medium text-gray-400 block mb-2">
					Title
				</label>
				<input
					id="search-title"
					type="text"
					value={titleText}
					onChange={(e) => setTitleText(e.target.value)}
					onKeyDown={handleSearchKeyDown}
					placeholder="Exact title match..."
					aria-label="Search activities by exact title"
					className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors"
				/>
			</div>
			{/* Exact description search — case-insensitive substring match on description */}
			<div>
				<label htmlFor="search-description" className="text-xs font-medium text-gray-400 block mb-2">
					Description
				</label>
				<input
					id="search-description"
					type="text"
					value={descText}
					onChange={(e) => setDescText(e.target.value)}
					onKeyDown={handleSearchKeyDown}
					placeholder="Exact description match..."
					aria-label="Search activities by exact description"
					className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors"
				/>
			</div>
			<div>
				<span className="text-xs font-medium text-gray-400 block mb-2">Sport</span>
				<div className="flex flex-wrap gap-1.5">
					{availableSports.map((s) => {
						const isSelected = sports.includes(s);
						const sportColor = SPORT_COLORS[s];
						return (
							<button
								key={s}
								type="button"
								onClick={() => {
									const next = isSelected ? sports.filter((sp) => sp !== s) : [...sports, s];
									updateParam("sports", next.join(","));
								}}
								className={`capitalize px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
									isSelected
										? "text-white shadow-sm"
										: "bg-gray-800 text-gray-400 border border-gray-700 hover:text-gray-200 hover:border-gray-600"
								}`}
								style={
									isSelected
										? {
												backgroundColor: `${sportColor ?? "#6b7280"}cc`,
												borderColor: sportColor ?? "#6b7280",
												border: `1px solid ${sportColor ?? "#6b7280"}80`,
											}
										: undefined
								}
							>
								{s}
							</button>
						);
					})}
				</div>
			</div>
			<div>
				<span className="text-xs font-medium text-gray-400 block mb-2">Category</span>
				<div className="flex flex-wrap gap-1.5">
					{availableCategories.map((c) => {
						const isSelected = categories.includes(c);
						return (
							<button
								key={c}
								type="button"
								onClick={() => {
									const next = isSelected ? categories.filter((cat) => cat !== c) : [...categories, c];
									updateParam("categories", next.join(","));
								}}
								className={`capitalize px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap border ${
									isSelected
										? "bg-orange-600/20 text-orange-300 border-orange-500/50"
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
					<label htmlFor="filter-from" className="text-xs font-medium text-gray-400 block mb-2">
						From
					</label>
					<input
						id="filter-from"
						type="date"
						value={fromInput}
						onChange={(e) => {
							const value = e.target.value;
							setFromInput(value);
							// Only commit a complete valid date (or an explicit empty clear) so
							// partial values while typing a year don't wipe the URL param.
							if (isCommittableDate(value) && value !== "") updateParam("from", value);
						}}
						onBlur={(e) => {
							const value = e.target.value;
							if (isCommittableDate(value) && value !== dateFrom) updateParam("from", value);
						}}
						className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors"
					/>
				</div>
				<div>
					<label htmlFor="filter-to" className="text-xs font-medium text-gray-400 block mb-2">
						To
					</label>
					<input
						id="filter-to"
						type="date"
						value={toInput}
						onChange={(e) => {
							const value = e.target.value;
							setToInput(value);
							if (isCommittableDate(value) && value !== "") updateParam("to", value);
						}}
						onBlur={(e) => {
							const value = e.target.value;
							if (isCommittableDate(value) && value !== dateTo) updateParam("to", value);
						}}
						className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors"
					/>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<div>
					<label htmlFor="filter-min-dist" className="text-xs font-medium text-gray-400 block mb-2">
						Min Dist (mi)
					</label>
					<input
						id="filter-min-dist"
						type="number"
						step="0.5"
						value={minDist || ""}
						onChange={(e) => updateParam("minDist", e.target.value)}
						className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors"
					/>
				</div>
				<div>
					<label htmlFor="filter-max-dist" className="text-xs font-medium text-gray-400 block mb-2">
						Max Dist (mi)
					</label>
					<input
						id="filter-max-dist"
						type="number"
						step="0.5"
						value={maxDist || ""}
						onChange={(e) => updateParam("maxDist", e.target.value)}
						className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors"
					/>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<div>
					<label htmlFor="filter-min-dur" className="text-xs font-medium text-gray-400 block mb-2">
						Min Dur (min)
					</label>
					<input
						id="filter-min-dur"
						type="number"
						step="5"
						value={minDur || ""}
						onChange={(e) => updateParam("minDur", e.target.value)}
						className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors"
					/>
				</div>
				<div>
					<label htmlFor="filter-max-dur" className="text-xs font-medium text-gray-400 block mb-2">
						Max Dur (min)
					</label>
					<input
						id="filter-max-dur"
						type="number"
						step="5"
						value={maxDur || ""}
						onChange={(e) => updateParam("maxDur", e.target.value)}
						className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors"
					/>
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

			<div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,auto)_1fr] gap-5">
				{/* Filters */}
				<div className="min-w-0 lg:border-r lg:border-gray-800 lg:pr-6">
					<div>
						{filterPanel}
						<div className="flex gap-2 mt-4">
							<select
								value={sortField}
								onChange={(e) => updateParam("sort", e.target.value)}
								className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors"
							>
								<option value="date">Sort: Date</option>
								<option value="distance">Sort: Distance</option>
								<option value="duration">Sort: Duration</option>
								<option value="pace">Sort: Pace/Speed</option>
							</select>
							<select
								value={sortDir}
								onChange={(e) => updateParam("dir", e.target.value)}
								className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors"
							>
								<option value="desc">Descending</option>
								<option value="asc">Ascending</option>
							</select>
						</div>
					</div>
				</div>

				{/* Results */}
				<div className="space-y-0">
					{activities.length > 0 ? (
						<>
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
								<p className="text-sm text-gray-500">
									{activities.length} activities found — showing {(currentPage - 1) * RESULTS_PER_PAGE + 1}–
									{Math.min(currentPage * RESULTS_PER_PAGE, activities.length)}
								</p>
								{/*
								 * Minimal ghost select-all toggle placed next to the results count.
								 * Replaces the old bulky checkbox + inline action bar. Bulk actions
								 * live in the floating bottom bar (zero layout shift).
								 */}
								<button
									type="button"
									onClick={toggleSelectAll}
									className="text-xs font-medium text-gray-500 hover:text-red-300 transition-colors"
									aria-pressed={allSelected}
								>
									{allSelected ? "Clear selection" : `Select all ${allMatchingIds.length}`}
								</button>
							</div>

							{exportError && (
								<div
									role="alert"
									className="mt-3 rounded-lg bg-red-900/50 border border-red-700 px-4 py-3 text-sm text-red-200 flex items-center justify-between"
								>
									<span>Export failed: {exportError}</span>
									<button
										type="button"
										onClick={() => setExportError(null)}
										className="text-red-300 hover:text-red-100 ml-4"
										aria-label="Dismiss export error"
									>
										✕
									</button>
								</div>
							)}

							{pageActivities.map((a) => {
								const sport = canonicalSport(a.sport, a.numSessions);
								const miles = a.totalDistance / METERS_PER_MILE;
								const paceSpeed = formatPaceSpeed(sport, a.totalDistance, a.totalTimerTime);
								const date = new Date(a.localTimestamp).toLocaleDateString();
								const sportColor = SPORT_COLORS[sport] ?? "#6b7280";
								const isSelected = selectedIds.has(a.activityId);
								return (
									<Link
										key={a.activityId}
										to={`/activity/${a.activityId}?sport=${sport}`}
										className={`group border-b border-gray-800 py-3 flex items-center gap-3 transition-colors ${
											isSelected ? "bg-red-600/10 border-l-2 border-l-red-600 pl-2" : "hover:bg-gray-900/50"
										}`}
									>
										{/*
										 * Selection toggle — a minimal circular check that appears on hover
										 * and stays visible when selected. preventDefault/stopPropagation
										 * keep it from triggering the row's navigation.
										 */}
										<button
											type="button"
											onClick={(e) => {
												e.preventDefault();
												e.stopPropagation();
												toggleSelected(a.activityId);
											}}
											aria-pressed={isSelected}
											aria-label={`Select ${a.activityName}`}
											className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all ${
												isSelected
													? "border-red-500 bg-red-600 text-white opacity-100"
													: "border-gray-600 text-transparent opacity-0 hover:border-gray-400 group-hover:opacity-100 focus:opacity-100"
											}`}
										>
											<svg
												viewBox="0 0 16 16"
												className="h-3 w-3"
												fill="none"
												stroke="currentColor"
												strokeWidth="2.5"
												aria-hidden="true"
											>
												<path d="M3 8.5l3.5 3.5L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
											</svg>
										</button>
										<div className="w-0.5 h-8 rounded-full shrink-0" style={{ backgroundColor: sportColor }} />
										<div className="flex-1 min-w-0">
											<p className="text-sm font-medium text-gray-200 truncate">
												{a.activityName}{" "}
												<span className="text-xs text-gray-500 capitalize">
													· {sport} · {date}
												</span>
											</p>
											<div className="flex gap-3 mt-0.5 text-xs text-gray-400">
												<span>{miles.toFixed(2)} mi</span>
												<span>{convertSecondsToHms(a.totalTimerTime) ?? "—"}</span>
												<span>{paceSpeed}</span>
											</div>
										</div>
									</Link>
								);
							})}

							{/* Pagination */}
							{totalPages > 1 && (
								<div className="flex items-center justify-center gap-4 pt-4">
									<button
										type="button"
										onClick={() => setPage(currentPage - 1)}
										disabled={currentPage <= 1}
										className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
									>
										← Prev
									</button>
									<span className="text-sm text-gray-500">
										Page {currentPage} of {totalPages}
									</span>
									<button
										type="button"
										onClick={() => setPage(currentPage + 1)}
										disabled={currentPage >= totalPages}
										className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
									>
										Next →
									</button>
								</div>
							)}
						</>
					) : (
						<div className="flex items-center justify-center py-16 text-gray-500 text-sm">
							No activities match your filters
						</div>
					)}
				</div>
			</div>

			{/*
			 * Floating export action bar — pinned to the bottom of the viewport and
			 * overlaid via position:fixed so it never reflows results (zero layout
			 * shift). Fades/slides in when activities are selected. Red accent matches
			 * the export flow. Mirrors the LapTable selection bar for cohesion.
			 */}
			<div
				className={`fixed bottom-6 left-1/2 z-40 -translate-x-1/2 transition-all duration-200 ${
					selectedIds.size > 0
						? "pointer-events-auto translate-y-0 opacity-100"
						: "pointer-events-none translate-y-4 opacity-0"
				}`}
			>
				<div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-2 rounded-full border border-gray-700 bg-gray-900/90 px-4 py-2 shadow-lg backdrop-blur-sm">
					<span className="text-xs font-medium text-gray-200">{selectedIds.size} selected</span>
					<button
						type="button"
						onClick={() => runExport([...selectedIds])}
						disabled={isExporting || selectedIds.size === 0}
						className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-red-500/50"
					>
						{isExporting ? "Exporting…" : `Export selected (${selectedIds.size})`}
					</button>
					<button
						type="button"
						onClick={() => runExport(allMatchingIds)}
						disabled={isExporting || allMatchingIds.length === 0}
						className="rounded-full bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
					>
						Export all ({allMatchingIds.length})
					</button>
					<button
						type="button"
						onClick={() => setSelectedIds(new Set())}
						className="rounded-full px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-200"
						aria-label="Clear selection"
					>
						Clear
					</button>
				</div>
			</div>
		</div>
	);
}

export default ActivitySearchPage;
