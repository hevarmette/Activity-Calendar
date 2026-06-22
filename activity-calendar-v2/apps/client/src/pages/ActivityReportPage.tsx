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
const METRICS = ["Distance (mi)", "Time (hours)", "Activities", "Calories"] as const;
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
			const startOfYear = new Date(sun.getFullYear(), 0, 1);
			const dayOfYear = Math.floor((sun.getTime() - startOfYear.getTime()) / 86400000);
			const weekNum = Math.floor(dayOfYear / 7) + 1;
			return `${sun.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
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
	timeS: number;
	timeHours: number;
	calories: number;
	ascent: number;
	avgHr: number;
	maxHr: number;
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
		const totalCal = items.reduce((s, r) => s + (r.totalCalories ?? 0), 0);
		const totalAsc = items.reduce((s, r) => s + (r.totalAscent ?? 0), 0);
		const hrs = items.filter((r) => r.avgHeartRate).map((r) => r.avgHeartRate!);
		const maxHrs = items.filter((r) => r.maxHeartRate).map((r) => r.maxHeartRate!);

		result.push({
			period,
			sport,
			activities: ids.size,
			distanceMi: totalDist / METERS_PER_MILE,
			timeS: totalTime,
			timeHours: totalTime / 3600,
			calories: totalCal,
			ascent: totalAsc,
			avgHr: hrs.length > 0 ? hrs.reduce((a, b) => a + b, 0) / hrs.length : 0,
			maxHr: maxHrs.length > 0 ? Math.max(...maxHrs) : 0,
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
				case "Calories": row[sport] = item?.calories ?? 0; break;
			}
		}
		return row;
	});
}

export function ActivityReportPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const { data, isLoading } = useReport();

	const grouping = (searchParams.get("group") as Grouping) || "Monthly";
	const metric = (searchParams.get("metric") as ChartMetric) || "Distance (mi)";
	const sportsParam = searchParams.get("sports");
	const groupBySport = searchParams.get("groupBySport") !== "true";

	const availableSports = useMemo(() => {
		if (!data) return [];
		return [...new Set(data.map((r) => r.sport))].sort();
	}, [data]);

	const selectedSports = useMemo(() => {
		if (sportsParam) return sportsParam.split(",");
		return availableSports.includes(Sport.Running) ? [Sport.Running] : availableSports;
	}, [sportsParam, availableSports]);

	const agg = useMemo(() => {
		if (!data) return [];
		return aggregate(data, grouping, selectedSports, groupBySport);
	}, [data, grouping, selectedSports, groupBySport]);

	const chartData = useMemo(() => buildChartData(agg, metric), [agg, metric]);
	const chartSports = [...new Set(agg.map((r) => r.sport))];

	const totalActivities = agg.reduce((s, r) => s + r.activities, 0);
	const totalDistance = agg.reduce((s, r) => s + r.distanceMi, 0);
	const totalTime = agg.reduce((s, r) => s + r.timeS, 0);
	const totalCalories = agg.reduce((s, r) => s + r.calories, 0);

	function updateParam(key: string, value: string) {
		const params = new URLSearchParams(searchParams);
		params.set(key, value);
		setSearchParams(params);
	}

	if (isLoading) return <div className="text-center py-10">Loading report…</div>;

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Activity Report</h1>

			{/* Controls */}
			<div className="flex flex-wrap gap-3 items-end">
				<div>
					<label className="text-xs text-gray-400 block mb-1">Sports</label>
					<select
						multiple
						value={selectedSports}
						onChange={(e) => updateParam("sports", Array.from(e.target.selectedOptions, (o) => o.value).join(","))}
						className="rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm min-w-[120px]"
					>
						{availableSports.map((s) => (
							<option key={s} value={s}>{s}</option>
						))}
					</select>
				</div>
				<div>
					<label className="text-xs text-gray-400 block mb-1">Group By</label>
					<select value={grouping} onChange={(e) => updateParam("group", e.target.value)} className="rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm">
						{GROUPINGS.map((g) => <option key={g} value={g}>{g}</option>)}
					</select>
				</div>
				<div>
					<label className="text-xs text-gray-400 block mb-1">Chart Metric</label>
					<select value={metric} onChange={(e) => updateParam("metric", e.target.value)} className="rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm">
						{METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
					</select>
				</div>
				<label className="flex items-center gap-2 text-sm text-gray-400">
					<input
						type="checkbox"
						checked={groupBySport}
						onChange={(e) => updateParam("groupBySport", e.target.checked ? "false" : "true")}
						className="rounded"
					/>
					Combine sports
				</label>
			</div>

			{/* Summary */}
			<div className="flex gap-3">
				<MetricCard label="Activities" value={`${totalActivities}`} />
				<MetricCard label="Distance" value={`${totalDistance.toFixed(1)} mi`} />
				<MetricCard label="Time" value={convertSecondsToHms(totalTime) ?? "—"} />
				<MetricCard label="Calories" value={`${Math.round(totalCalories).toLocaleString()}`} />
			</div>

			{/* Chart */}
			<div className="bg-gray-800 rounded-lg p-4">
				<ResponsiveContainer width="100%" height={300}>
					<BarChart data={chartData}>
						<CartesianGrid strokeDasharray="3 3" stroke="#374151" />
						<XAxis dataKey="period" tick={{ fontSize: 11, fill: "#9ca3af" }} angle={-45} textAnchor="end" height={60} />
						<YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} />
						<Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151" }} />
						<Legend />
						{chartSports.map((sport) => (
							<Bar key={sport} dataKey={sport} stackId="a" fill={SPORT_COLORS[sport] ?? "#7F7F7F"} />
						))}
					</BarChart>
				</ResponsiveContainer>
			</div>

			{/* Table */}
			<div className="overflow-x-auto">
				<table className="w-full text-sm text-left">
					<thead className="text-xs text-gray-400 border-b border-gray-700">
						<tr>
							<th className="px-2 py-1">Period</th>
							{!groupBySport && <th className="px-2 py-1">Sport</th>}
							<th className="px-2 py-1">Activities</th>
							<th className="px-2 py-1">Distance (mi)</th>
							<th className="px-2 py-1">Time</th>
							<th className="px-2 py-1">Avg Pace/Speed</th>
							<th className="px-2 py-1">Calories</th>
							<th className="px-2 py-1">Elev Gain (ft)</th>
							<th className="px-2 py-1">Avg HR</th>
						</tr>
					</thead>
					<tbody>
						{agg.map((row, i) => {
							const paceSpeed = row.distanceMi > 0 && row.timeS > 0
								? row.sport === Sport.Cycling || row.sport === "All Sports"
									? `${(row.distanceMi / (row.timeS / 3600)).toFixed(1)} mph`
									: `${formatPace(row.timeS / 60 / row.distanceMi)} /mi`
								: "—";
							return (
								<tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50">
									<td className="px-2 py-1">{row.period}</td>
									{!groupBySport && <td className="px-2 py-1 capitalize">{row.sport}</td>}
									<td className="px-2 py-1">{row.activities}</td>
									<td className="px-2 py-1">{row.distanceMi.toFixed(2)}</td>
									<td className="px-2 py-1">{convertSecondsToHms(row.timeS)}</td>
									<td className="px-2 py-1">{paceSpeed}</td>
									<td className="px-2 py-1">{Math.round(row.calories)}</td>
									<td className="px-2 py-1">{Math.round(row.ascent * METERS_TO_FEET)}</td>
									<td className="px-2 py-1">{row.avgHr > 0 ? Math.round(row.avgHr) : "—"}</td>
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
