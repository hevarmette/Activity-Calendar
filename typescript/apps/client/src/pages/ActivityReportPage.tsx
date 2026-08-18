import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
	Legend,
} from "recharts";
import {
	METERS_PER_MILE,
	METERS_TO_FEET,
	SPORT_COLORS,
	Sport,
	convertSecondsToHms,
	formatPace,
} from "@activity-calendar/shared";
import type { ReportRow } from "@activity-calendar/shared";
import { useReport } from "../api/queries.js";
import { MetricCard } from "../components/ui/MetricCard.js";

const GROUPINGS = ["Daily", "Weekly", "Monthly", "Yearly"] as const;
type Grouping = (typeof GROUPINGS)[number];
const METRICS = ["Distance (mi)", "Time (hours)", "Activities"] as const;
type ChartMetric = (typeof METRICS)[number];

function periodKey(date: Date, grouping: Grouping): string {
	const y = date.getFullYear();
	const m = date.getMonth();
	const d = date.getDate();
	switch (grouping) {
		case "Daily":
			return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
		case "Weekly": {
			const day = date.getDay(); // 0=Sun
			const sun = new Date(date);
			sun.setDate(date.getDate() - day);
			return `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, "0")}-${String(sun.getDate()).padStart(2, "0")}`;
		}
		case "Monthly":
			return `${y}-${String(m + 1).padStart(2, "0")}`;
		case "Yearly":
			return `${y}`;
	}
}

interface AggRow {
	period: string;
	sport: string;
	activities: number;
	distanceMi: number;
	distanceM: number;
	timeS: number;
	timeHours: number;
	ascent: number;
	avgHr: number;
	maxHr: number;
	avgPower: number | null;
}

function aggregate(rows: ReportRow[], grouping: Grouping, sports: string[], groupBySport: boolean): AggRow[] {
	const filtered = rows.filter((r) => sports.includes(r.sport));
	const buckets = new Map<string, Map<string, ReportRow[]>>();

	for (const row of filtered) {
		const date = new Date(row.localTimestamp);
		const period = periodKey(date, grouping);
		const sport = groupBySport ? "All Sports" : row.sport;
		const key = `${period}|${sport}`;
		if (!buckets.has(key)) buckets.set(key, new Map());
		const bucket = buckets.get(key)!;
		if (!bucket.has(sport)) bucket.set(sport, []);
		bucket.get(sport)!.push(row);
	}

	const result: AggRow[] = [];
	for (const [key] of buckets) {
		const [period, sport] = key.split("|") as [string, string];
		const items = filtered.filter((r) => {
			const p = periodKey(new Date(r.localTimestamp), grouping);
			const s = groupBySport ? "All Sports" : r.sport;
			return p === period && s === sport;
		});
		const ids = new Set(items.map((r) => r.activityId));
		const totalDist = items.reduce((s, r) => s + (r.totalDistance ?? 0), 0);
		const totalTime = items.reduce((s, r) => s + (r.totalTimerTime ?? 0), 0);
		const totalAsc = items.reduce((s, r) => s + (r.totalAscent ?? 0), 0);
		const hrs = items.filter((r) => r.avgHeartRate).map((r) => r.avgHeartRate!);
		const maxHrs = items.filter((r) => r.maxHeartRate).map((r) => r.maxHeartRate!);
		const powers = items.filter((r) => r.avgPower != null && r.avgPower > 0).map((r) => r.avgPower!);

		result.push({
			period,
			sport,
			activities: ids.size,
			distanceMi: totalDist / METERS_PER_MILE,
			distanceM: totalDist,
			timeS: totalTime,
			timeHours: totalTime / 3600,
			ascent: totalAsc,
			avgHr: hrs.length > 0 ? hrs.reduce((a, b) => a + b, 0) / hrs.length : 0,
			maxHr: maxHrs.length > 0 ? Math.max(...maxHrs) : 0,
			avgPower: powers.length > 0 ? Math.round(powers.reduce((a, b) => a + b, 0) / powers.length) : null,
		});
	}

	return result.sort((a, b) => b.period.localeCompare(a.period));
}

function buildChartData(agg: AggRow[], metric: ChartMetric) {
	const periods = [...new Set(agg.map((r) => r.period))].sort();
	const sports = [...new Set(agg.map((r) => r.sport))];

	return periods.map((period) => {
		const row: Record<string, string | number> = { period };
		for (const sport of sports) {
			const item = agg.find((r) => r.period === period && r.sport === sport);
			switch (metric) {
				case "Distance (mi)": row[sport] = item?.distanceMi ?? 0; break;
				case "Time (hours)": row[sport] = item?.timeHours ?? 0; break;
				case "Activities": row[sport] = item?.activities ?? 0; break;
			}
		}
		return row;
	});
}

export function ActivityReportPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const { data, isLoading } = useReport();

	const grouping = (searchParams.get("group") as Grouping) || "Weekly";
	const metric = (searchParams.get("metric") as ChartMetric) || "Distance (mi)";
	const sportsParam = searchParams.get("sports");
	const groupBySport = searchParams.get("groupBySport") !== "true";
	const dateFrom = searchParams.get("from") ?? "";
	const dateTo = searchParams.get("to") ?? new Date().toISOString().slice(0, 10);

	const availableSports = useMemo(() => {
		if (!data) return [];
		return [...new Set(data.map((r) => r.sport))].sort();
	}, [data]);

	const selectedSports = useMemo(() => {
		if (sportsParam) return sportsParam.split(",");
		return availableSports.includes(Sport.Running) ? [Sport.Running] : availableSports;
	}, [sportsParam, availableSports]);

	/** Whether only running is selected — controls pace column display */
	const isRunningOnly = selectedSports.length === 1 && selectedSports[0] === Sport.Running;
	/** Whether only swimming is selected — shows pace per 100m */
	const isSwimmingOnly = selectedSports.length === 1 && selectedSports[0] === Sport.Swimming;
	/** Whether only cycling is selected — shows avg power if available, else mph */
	const isCyclingOnly = selectedSports.length === 1 && selectedSports[0] === Sport.Cycling;

	/** Filter data by date range before aggregation */
	const filteredData = useMemo(() => {
		if (!data) return [];
		let result = data;
		if (dateFrom) result = result.filter((r) => r.localTimestamp != null && r.localTimestamp >= dateFrom);
		if (dateTo) result = result.filter((r) => r.localTimestamp != null && r.localTimestamp.slice(0, 10) <= dateTo);
		return result;
	}, [data, dateFrom, dateTo]);

	const agg = useMemo(() => {
		if (filteredData.length === 0) return [];
		return aggregate(filteredData, grouping, selectedSports, groupBySport);
	}, [filteredData, grouping, selectedSports, groupBySport]);

	const chartData = useMemo(() => buildChartData(agg, metric), [agg, metric]);
	const chartSports = [...new Set(agg.map((r) => r.sport))];

	const totalActivities = agg.reduce((s, r) => s + r.activities, 0);
	const totalDistance = agg.reduce((s, r) => s + r.distanceMi, 0);
	const totalTime = agg.reduce((s, r) => s + r.timeS, 0);

	function updateParam(key: string, value: string) {
		const params = new URLSearchParams(searchParams);
		if (value) params.set(key, value);
		else params.delete(key);
		setSearchParams(params);
	}

	if (isLoading) return <div className="text-center py-10 text-gray-400">Loading report…</div>;

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold text-gray-100">Activity Report</h1>
				<p className="text-sm text-gray-500 mt-1">Analyze your training volume and trends over time</p>
			</div>

			{/* Controls */}
			<div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
				<div className="flex flex-wrap gap-x-6 gap-y-4 items-end">
					<div>
						<label className="text-xs font-medium text-gray-400 block mb-1.5">Sports</label>
						<div className="flex flex-wrap gap-1.5">
							{availableSports.map((s) => {
								const isSelected = selectedSports.includes(s);
								const sportColor = SPORT_COLORS[s];
								return (
									<button
										key={s}
										type="button"
										onClick={() => {
											const next = isSelected
												? selectedSports.filter((sp) => sp !== s)
												: [...selectedSports, s];
											updateParam("sports", next.join(","));
										}}
										className={`capitalize px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
											isSelected
												? "text-white shadow-sm"
												: "bg-gray-800 text-gray-400 border border-gray-700 hover:text-gray-200 hover:border-gray-600"
										}`}
										style={isSelected ? { backgroundColor: `${sportColor ?? "#f97316"}cc`, border: `1px solid ${sportColor ?? "#f97316"}80` } : undefined}
									>
										{s}
									</button>
								);
							})}
						</div>
					</div>
					<div>
						<label className="text-xs font-medium text-gray-400 block mb-1.5">Group By</label>
						<div className="inline-flex rounded-lg bg-gray-800 border border-gray-700 p-0.5">
							{GROUPINGS.map((g) => (
								<button
									key={g}
									type="button"
									onClick={() => updateParam("group", g)}
									className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
										grouping === g
											? "text-white bg-red-600 shadow-sm"
											: "text-gray-400 hover:text-gray-200"
									}`}
								>
									{g}
								</button>
							))}
						</div>
					</div>
					<div>
						<label className="text-xs font-medium text-gray-400 block mb-1.5">Chart Metric</label>
						<div className="inline-flex rounded-lg bg-gray-800 border border-gray-700 p-0.5">
							{METRICS.map((m) => (
								<button
									key={m}
									type="button"
									onClick={() => updateParam("metric", m)}
									className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
										metric === m
											? "text-white bg-red-600 shadow-sm"
											: "text-gray-400 hover:text-gray-200"
									}`}
								>
									{m.replace(" (mi)", "").replace(" (hours)", "")}
								</button>
							))}
						</div>
					</div>
					<button
						type="button"
						onClick={() => updateParam("groupBySport", groupBySport ? "true" : "false")}
						className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap border ${
							groupBySport
								? "bg-red-600/20 text-red-300 border-red-500/50"
								: "bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200 hover:border-gray-600"
						}`}
					>
						Combine sports
					</button>
					<div>
						<label className="text-xs font-medium text-gray-400 block mb-1.5">From</label>
						<input
							type="date"
							value={dateFrom}
							onChange={(e) => updateParam("from", e.target.value)}
							className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-colors"
							aria-label="Filter from date"
						/>
					</div>
					<div>
						<label className="text-xs font-medium text-gray-400 block mb-1.5">To</label>
						<input
							type="date"
							value={dateTo}
							onChange={(e) => updateParam("to", e.target.value)}
							className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-colors"
							aria-label="Filter to date"
						/>
					</div>
				</div>
			</div>

			{/* Summary */}
			<div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
				<MetricCard label="Activities" value={`${totalActivities}`} />
				<MetricCard label="Distance" value={`${totalDistance.toFixed(1)} mi`} />
				<MetricCard label="Time" value={convertSecondsToHms(totalTime) ?? "—"} />
			</div>

			{/* Chart */}
			<div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
				<ResponsiveContainer width="100%" height={300}>
					<BarChart data={chartData}>
						<CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
						<XAxis dataKey="period" tick={{ fontSize: 11, fill: "#6b7280" }} angle={-45} textAnchor="end" height={60} />
						<YAxis tick={{ fontSize: 11, fill: "#6b7280" }} />
						<Tooltip contentStyle={{ background: "#111827", border: "1px solid #1f2937", borderRadius: "8px" }} />
						<Legend />
						{chartSports.map((sport) => (
							<Bar key={sport} dataKey={sport} stackId="a" fill={SPORT_COLORS[sport] ?? "#7F7F7F"} />
						))}
					</BarChart>
				</ResponsiveContainer>
			</div>

			{/* Table */}
			<div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
				<table className="w-full text-sm text-left">
					<thead className="bg-gray-800/50 text-xs font-medium text-gray-400 uppercase tracking-wide">
						<tr>
							<th className="px-4 py-3">Period</th>
							{!groupBySport && <th className="px-4 py-3">Sport</th>}
							<th className="px-4 py-3">Activities</th>
							<th className="px-4 py-3">Distance (mi)</th>
							<th className="px-4 py-3">Time</th>
							<th className="px-4 py-3">{isRunningOnly ? "Avg Pace" : isSwimmingOnly ? "Avg Pace" : isCyclingOnly ? "Avg Power/Speed" : "Avg Pace/Speed"}</th>
							<th className="px-4 py-3">Elev Gain (ft)</th>
							<th className="px-4 py-3">Avg HR</th>
						</tr>
					</thead>
					<tbody>
						{agg.map((row, i) => {
							let paceSpeed = "—";
							if (row.distanceMi > 0 && row.timeS > 0) {
								if (isSwimmingOnly) {
									// Pace per 100m
									const secsPerHundred = row.timeS / (row.distanceM / 100);
									const m = Math.floor(secsPerHundred / 60);
									const s = Math.round(secsPerHundred % 60);
									paceSpeed = `${m}:${String(s).padStart(2, "0")} /100m`;
								} else if (isCyclingOnly) {
									// Show avg power if available, otherwise speed
									if (row.avgPower != null && row.avgPower > 0) {
										paceSpeed = `${row.avgPower} W`;
									} else {
										paceSpeed = `${(row.distanceMi / (row.timeS / 3600)).toFixed(1)} mph`;
									}
								} else if (isRunningOnly) {
									paceSpeed = `${formatPace(row.timeS / 60 / row.distanceMi)} /mi`;
								} else {
									// Mixed sports: determine per-row
									if (row.sport === Sport.Swimming) {
										const secsPerHundred = row.timeS / (row.distanceM / 100);
										const m = Math.floor(secsPerHundred / 60);
										const s = Math.round(secsPerHundred % 60);
										paceSpeed = `${m}:${String(s).padStart(2, "0")} /100m`;
									} else if (row.sport === Sport.Cycling || row.sport === "All Sports") {
										if (row.avgPower != null && row.avgPower > 0) {
											paceSpeed = `${row.avgPower} W`;
										} else {
											paceSpeed = `${(row.distanceMi / (row.timeS / 3600)).toFixed(1)} mph`;
										}
									} else {
										paceSpeed = `${formatPace(row.timeS / 60 / row.distanceMi)} /mi`;
									}
								}
							}
							return (
								<tr key={i} className="border-t border-gray-800 hover:bg-gray-800/30 transition-colors">
									<td className="px-4 py-3 text-gray-300">{row.period}</td>
									{!groupBySport && <td className="px-4 py-3 text-gray-300 capitalize">{row.sport}</td>}
									<td className="px-4 py-3 text-gray-300">{row.activities}</td>
									<td className="px-4 py-3 text-gray-300">{row.distanceMi.toFixed(2)}</td>
									<td className="px-4 py-3 text-gray-300">{convertSecondsToHms(row.timeS)}</td>
									<td className="px-4 py-3 text-gray-300">{paceSpeed}</td>
									<td className="px-4 py-3 text-gray-300">{Math.round(row.ascent * METERS_TO_FEET)}</td>
									<td className="px-4 py-3 text-gray-300">{row.avgHr > 0 ? Math.round(row.avgHr) : "—"}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}

export default ActivityReportPage;
