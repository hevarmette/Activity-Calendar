import { useState } from "react";
import {
	LineChart,
	Line,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
	ReferenceLine,
} from "recharts";
import { METERS_PER_MILE, Sport, formatPace } from "@activity-calendar/shared";
import type { RecordPoint } from "@activity-calendar/shared";

type XMode = "distance" | "time";

interface Props {
	points: RecordPoint[];
	sport: string;
	onHover?: (index: number | null) => void;
}

interface ChartPoint {
	x: number;
	distMiles: number;
	elapsedMin: number;
	pointIndex: number;
	pace: number | null;
	speed: number | null;
	hr: number | null;
	altitude: number | null;
	cadence: number | null;
}

function buildChartData(points: RecordPoint[], xMode: XMode, sport: string): ChartPoint[] {
	const isCycling = sport === Sport.Cycling;
	let idx = 0;
	return points
		.filter((p) => p.latitude != null)
		.map((p) => {
			const distMiles = (p.distance ?? 0) / METERS_PER_MILE;
			const elapsedMin = p.elapsedTime / 60;
			const paceMinPerMile =
				p.enhancedSpeed && p.enhancedSpeed > 0 ? (1 / p.enhancedSpeed) * (METERS_PER_MILE / 60) : null;
			const speedMph = p.enhancedSpeed ? p.enhancedSpeed * 2.23694 : null;
			return {
				x: xMode === "distance" ? distMiles : elapsedMin,
				distMiles,
				elapsedMin,
				pointIndex: idx++,
				pace: paceMinPerMile,
				speed: speedMph,
				hr: p.heartRate,
				altitude: p.correctedAltitude ?? (p.altitude ? p.altitude * 3.28084 : null),
				cadence: p.cadence ? (p.cadence + (p.fractionalCadence ?? 0)) * (isCycling ? 1 : 2) : null,
			};
		});
}

function getXTicks(data: ChartPoint[], xMode: XMode): number[] {
	if (data.length === 0) return [];
	const max = data[data.length - 1]!.x;
	const step = xMode === "distance" ? 1 : 5;
	const ticks: number[] = [];
	for (let i = 0; i <= max; i += step) ticks.push(i);
	return ticks;
}

function avg(data: ChartPoint[], key: keyof ChartPoint): number | null {
	const vals = data.map((d) => d[key] as number | null).filter((v): v is number => v != null && v > 0);
	if (vals.length === 0) return null;
	return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function formatTime(minutes: number): string {
	const m = Math.floor(minutes);
	const s = Math.round((minutes - m) * 60).toString().padStart(2, "0");
	return `${m}:${s}`;
}

function ChartTooltip({ active, payload, metric, isCycling }: { active?: boolean; payload?: any[]; metric: string; isCycling: boolean }) {
	if (!active || !payload?.[0]) return null;
	const d = payload[0].payload as ChartPoint;
	const dist = `Mile ${d.distMiles.toFixed(2)}`;
	const time = formatTime(d.elapsedMin);

	let value: string;
	if (metric === "pace") value = formatPace(d.pace) ?? "—";
	else if (metric === "speed") value = d.speed != null ? `${d.speed.toFixed(1)} mph` : "—";
	else if (metric === "hr") value = d.hr != null ? `${Math.round(d.hr)} bpm` : "—";
	else if (metric === "altitude") value = d.altitude != null ? `${Math.round(d.altitude)} ft` : "—";
	else value = d.cadence != null ? `${Math.round(d.cadence)} ${isCycling ? "rpm" : "spm"}` : "—";

	return (
		<div className="rounded-lg border border-gray-700 bg-gray-800/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
			<p className="text-gray-400">{dist} | {time}</p>
			<p className="mt-0.5 font-medium text-gray-100">{value}</p>
		</div>
	);
}

function Chart({
	data,
	dataKey,
	metric,
	color,
	yLabel,
	xLabel,
	xMode,
	reversed,
	yFormatter,
	avgValue,
	isCycling,
	onHover,
}: {
	data: ChartPoint[];
	dataKey: string;
	metric: string;
	color: string;
	yLabel: string;
	xLabel: string;
	xMode: XMode;
	reversed?: boolean;
	yFormatter?: (v: number) => string;
	avgValue: number | null;
	isCycling: boolean;
	onHover?: (index: number | null) => void;
}) {
	if (data.every((d) => (d as Record<string, unknown>)[dataKey] == null)) return null;

	const integerAxis = dataKey === "hr" || dataKey === "altitude" || dataKey === "cadence";

	return (
		<div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
			<p className="text-sm text-gray-400 mb-2">{yLabel}</p>
			<ResponsiveContainer width="100%" height={200}>
				<LineChart
					data={data}
					onMouseMove={(e) => {
						if (e?.activePayload?.[0] && onHover) {
							onHover((e.activePayload[0].payload as ChartPoint).pointIndex);
						}
					}}
					onMouseLeave={() => onHover?.(null)}
				>
					<CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
					<XAxis
						dataKey="x"
						type="number"
						domain={[0, "dataMax"]}
						ticks={getXTicks(data, xMode)}
						tick={{ fontSize: 11, fill: "#6b7280" }}
						label={{ value: xLabel, position: "bottom", fill: "#6b7280", fontSize: 11 }}
					/>
					<YAxis
						reversed={reversed}
						allowDecimals={!integerAxis}
						tick={{ fontSize: 11, fill: "#6b7280" }}
						tickFormatter={yFormatter ?? (integerAxis ? (v) => Math.round(v).toString() : undefined)}
					/>
					<Tooltip
						content={<ChartTooltip metric={metric} isCycling={isCycling} />}
						cursor={{ stroke: "#f97316", strokeWidth: 1 }}
					/>
					<Line type="monotone" dataKey={dataKey} stroke={color} dot={false} strokeWidth={1.5} />
					{avgValue != null && (
						<ReferenceLine
							y={avgValue}
							stroke={color}
							strokeDasharray="5 5"
							label={{ value: `Avg: ${yFormatter ? yFormatter(avgValue) : integerAxis ? Math.round(avgValue).toString() : avgValue.toFixed(1)}`, fill: "#6b7280", fontSize: 11, position: "insideBottomRight" }}
						/>
					)}
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}

export function PerformanceCharts({ points, sport, onHover }: Props) {
	const [xMode, setXMode] = useState<XMode>("distance");
	const data = buildChartData(points, xMode, sport);
	const xLabel = xMode === "distance" ? "Distance (mi)" : "Time (min)";
	const isCycling = sport === Sport.Cycling;

	return (
		<div className="space-y-4">
			<div className="inline-flex rounded-lg bg-gray-800 border border-gray-700 p-0.5">
				<button
					onClick={() => setXMode("distance")}
					className={xMode === "distance" ? "px-3 py-1.5 rounded-md text-xs font-medium text-white bg-orange-500" : "px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"}
				>
					Distance
				</button>
				<button
					onClick={() => setXMode("time")}
					className={xMode === "time" ? "px-3 py-1.5 rounded-md text-xs font-medium text-white bg-orange-500" : "px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"}
				>
					Time
				</button>
			</div>

			{isCycling ? (
				<Chart data={data} dataKey="speed" metric="speed" color="#2CA02C" yLabel="Speed (mph)" xLabel={xLabel} xMode={xMode} isCycling={isCycling} avgValue={avg(data, "speed")} onHover={onHover} />
			) : (
				<Chart
					data={data}
					dataKey="pace"
					metric="pace"
					color="#FF4B4B"
					yLabel="Pace (min/mi)"
					xLabel={xLabel}
					xMode={xMode}
					reversed
					yFormatter={(v) => formatPace(v) ?? ""}
					avgValue={avg(data, "pace")}
					isCycling={isCycling}
					onHover={onHover}
				/>
			)}

			<Chart data={data} dataKey="hr" metric="hr" color="#e53e3e" yLabel="Heart Rate (bpm)" xLabel={xLabel} xMode={xMode} isCycling={isCycling} avgValue={avg(data, "hr")} onHover={onHover} />
			<Chart data={data} dataKey="altitude" metric="altitude" color="#38a169" yLabel="Altitude (ft)" xLabel={xLabel} xMode={xMode} isCycling={isCycling} avgValue={null} onHover={onHover} />
			<Chart
				data={data}
				dataKey="cadence"
				metric="cadence"
				color="#805ad5"
				yLabel={isCycling ? "Cadence (RPM)" : "Cadence (SPM)"}
				xLabel={xLabel}
				xMode={xMode}
				isCycling={isCycling}
				avgValue={avg(data, "cadence")}
				onHover={onHover}
			/>
		</div>
	);
}
