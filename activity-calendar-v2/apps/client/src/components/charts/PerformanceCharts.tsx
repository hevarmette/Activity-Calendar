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
}

function buildChartData(points: RecordPoint[], xMode: XMode, sport: string) {
	const isCycling = sport === Sport.Cycling;
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
				pace: paceMinPerMile,
				speed: speedMph,
				hr: p.heartRate,
				altitude: p.correctedAltitude ?? (p.altitude ? p.altitude * 3.28084 : null),
				cadence: p.cadence ? (p.cadence + (p.fractionalCadence ?? 0)) * (isCycling ? 1 : 2) : null,
			};
		});
}

function avg(data: { [k: string]: number | null }[], key: string): number | null {
	const vals = data.map((d) => d[key] as number | null).filter((v): v is number => v != null && v > 0);
	if (vals.length === 0) return null;
	return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function Chart({
	data,
	dataKey,
	color,
	yLabel,
	xLabel,
	reversed,
	yFormatter,
	avgValue,
}: {
	data: ReturnType<typeof buildChartData>;
	dataKey: string;
	color: string;
	yLabel: string;
	xLabel: string;
	reversed?: boolean;
	yFormatter?: (v: number) => string;
	avgValue: number | null;
}) {
	if (data.every((d) => (d as Record<string, unknown>)[dataKey] == null)) return null;

	return (
		<div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
			<p className="text-sm text-gray-400 mb-2">{yLabel}</p>
			<ResponsiveContainer width="100%" height={200}>
				<LineChart data={data}>
					<CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
					<XAxis dataKey="x" tick={{ fontSize: 11, fill: "#6b7280" }} label={{ value: xLabel, position: "bottom", fill: "#6b7280", fontSize: 11 }} />
					<YAxis
						reversed={reversed}
						tick={{ fontSize: 11, fill: "#6b7280" }}
						tickFormatter={yFormatter}
					/>
					<Tooltip
						contentStyle={{ background: "#111827", border: "1px solid #1f2937", borderRadius: "8px" }}
						labelFormatter={(v) => `${typeof v === "number" ? v.toFixed(2) : v}`}
						formatter={(v: number) => [yFormatter ? yFormatter(v) : v.toFixed(1), yLabel]}
					/>
					<Line type="monotone" dataKey={dataKey} stroke={color} dot={false} strokeWidth={1.5} />
					{avgValue != null && (
						<ReferenceLine
							y={avgValue}
							stroke={color}
							strokeDasharray="5 5"
							label={{ value: `Avg: ${yFormatter ? yFormatter(avgValue) : avgValue.toFixed(1)}`, fill: "#6b7280", fontSize: 11, position: "insideBottomRight" }}
						/>
					)}
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}

export function PerformanceCharts({ points, sport }: Props) {
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
				<Chart data={data} dataKey="speed" color="#2CA02C" yLabel="Speed (mph)" xLabel={xLabel} avgValue={avg(data, "speed")} />
			) : (
				<Chart
					data={data}
					dataKey="pace"
					color="#FF4B4B"
					yLabel="Pace (min/mi)"
					xLabel={xLabel}
					reversed
					yFormatter={(v) => formatPace(v) ?? ""}
					avgValue={avg(data, "pace")}
				/>
			)}

			<Chart data={data} dataKey="hr" color="#e53e3e" yLabel="Heart Rate (bpm)" xLabel={xLabel} avgValue={avg(data, "hr")} />
			<Chart data={data} dataKey="altitude" color="#38a169" yLabel="Altitude (ft)" xLabel={xLabel} avgValue={null} />
			<Chart
				data={data}
				dataKey="cadence"
				color="#805ad5"
				yLabel={isCycling ? "Cadence (RPM)" : "Cadence (SPM)"}
				xLabel={xLabel}
				avgValue={avg(data, "cadence")}
			/>
		</div>
	);
}
