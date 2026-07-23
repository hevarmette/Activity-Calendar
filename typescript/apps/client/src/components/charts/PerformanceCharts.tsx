import { useCallback, useMemo, useRef, useState } from "react";
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
	/** Activity category used for pace y-axis bounding logic. */
	category?: string;
	onHover?: (index: number | null) => void;
	/** Callback when user selects a range on any chart. Returns [startPointIndex, endPointIndex] or null to clear. */
	onRangeSelect?: (range: [number, number] | null) => void;
	/** Per-lap power data for cycling power chart. */
	laps?: { number: number; avgPower: number | null; totalDistance: number | null; totalTimerTime: number | null }[];
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

/**
 * Compute bounded pace y-axis domain and tick marks matching original Streamlit logic.
 * Returns null if insufficient pace data is available.
 */
function computePaceDomain(data: ChartPoint[], category: string): { domain: [number, number]; ticks: number[] } | null {
	const paceValues = data.map((d) => d.pace).filter((p): p is number => p != null && p > 0 && p < 30);
	if (paceValues.length === 0) return null;
	const sorted = [...paceValues].sort((a, b) => a - b);
	const fastestPace = sorted[0]!;
	let pPace: number;
	if (category === "training") {
		const idx = Math.floor(sorted.length * 0.85);
		pPace = Math.min(sorted[idx] ?? sorted[sorted.length - 1]!, 12);
	} else {
		const idx = Math.floor(sorted.length * 0.95);
		pPace = (sorted[idx] ?? sorted[sorted.length - 1]!) + 3;
	}
	const topBound = fastestPace >= 5 ? 5 : fastestPace;
	const bottomBound = pPace > 11 ? 11 : pPace;
	const minTick = Math.floor(topBound);
	const maxTick = Math.ceil(bottomBound);
	const ticks: number[] = [];
	for (let i = minTick; i <= maxTick; i++) ticks.push(i);
	return { domain: [topBound, bottomBound], ticks };
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
	selectionRange,
	onSelectionStart,
	onSelectionEnd,
	yDomain,
	yTicks,
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
	selectionRange?: [number, number] | null;
	onSelectionStart?: (x: number) => void;
	onSelectionEnd?: (x: number) => void;
	yDomain?: [number, number];
	yTicks?: number[];
}) {
	if (data.every((d) => (d as unknown as Record<string, unknown>)[dataKey] == null)) return null;

	const integerAxis = dataKey === "hr" || dataKey === "altitude" || dataKey === "cadence";

	// Filter data to selected range if present
	const displayData = selectionRange
		? data.filter((d) => d.x >= selectionRange[0] && d.x <= selectionRange[1])
		: data;
	const displayAvg = selectionRange ? avg(displayData, dataKey as keyof ChartPoint) : avgValue;

	return (
		<div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
			<p className="text-sm text-gray-400 mb-2">{yLabel}</p>
			<ResponsiveContainer width="100%" height={200}>
				<LineChart
					data={displayData}
					onMouseDown={(e) => {
						if (e?.activeLabel != null && onSelectionStart) {
							onSelectionStart(Number(e.activeLabel));
						}
					}}
					onMouseUp={(e) => {
						if (e?.activeLabel != null && onSelectionEnd) {
							onSelectionEnd(Number(e.activeLabel));
						}
					}}
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
						domain={yDomain}
						ticks={yTicks}
						allowDataOverflow={!!yDomain}
						tick={{ fontSize: 11, fill: "#6b7280" }}
						tickFormatter={yFormatter ?? (integerAxis ? (v) => Math.round(v).toString() : undefined)}
					/>
					<Tooltip
						content={<ChartTooltip metric={metric} isCycling={isCycling} />}
						cursor={{ stroke: "#f97316", strokeWidth: 1 }}
					/>
					<Line type="monotone" dataKey={dataKey} stroke={color} dot={false} strokeWidth={1.5} />
					{displayAvg != null && (
						<ReferenceLine
							y={displayAvg}
							stroke={color}
							strokeDasharray="5 5"
							label={{ value: `Avg: ${yFormatter ? yFormatter(displayAvg) : integerAxis ? Math.round(displayAvg).toString() : displayAvg.toFixed(1)}`, fill: "#6b7280", fontSize: 11, position: "insideBottomRight" }}
						/>
					)}
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}

/**
 * Performance charts for activity record data.
 *
 * Color scheme ported from the Streamlit plotting.py:
 *   - Pace (running): blue — invert y-axis so faster pace is higher
 *   - Speed (cycling): blue
 *   - Heart Rate: red
 *   - Altitude: green
 *   - Cadence: purple (scatter in Streamlit, line here for density)
 *
 * From the original Streamlit code (pages/2_Activity_Details.py):
 * - Pace y-axis range is bounded: top_bound = min(5, fastest_pace),
 *   bottom_bound = min(11, p_pace) where p_pace = 85th percentile for training,
 *   95th + 3 for other categories. This prevents outlier spikes from compressing
 *   the useful range.
 * - Time x-axis uses pd.Timestamp(0) + elapsed_time to format as HH:MM:SS
 *   (the timestamp is technically 1970-01-01 00:00:00, showing only the time part).
 * - Average line is drawn as a dashed horizontal reference with annotation.
 *
 * Range selection (TODO #10): Drag on any chart to select an x-axis range.
 * All charts zoom to that range and the map highlights the corresponding segment.
 * Click without dragging to clear the selection.
 */
export function PerformanceCharts({ points, sport, category, onHover, onRangeSelect, laps }: Props) {
	const [xMode, setXMode] = useState<XMode>("distance");
	const [selectionRange, setSelectionRange] = useState<[number, number] | null>(null);
	const selectionStartRef = useRef<number | null>(null);

	const data = useMemo(() => buildChartData(points, xMode, sport), [points, xMode, sport]);
	const xLabel = xMode === "distance" ? "Distance (mi)" : "Time (min)";
	const isCycling = sport === Sport.Cycling;

	// Build per-lap power chart data for cycling
	const powerData = useMemo(() => {
		if (!isCycling || !laps || laps.length === 0) return null;
		const withPower = laps.filter((l) => l.avgPower != null && l.avgPower > 0);
		if (withPower.length === 0) return null;

		// Build step data: each lap becomes a segment from its start to end on the x-axis
		let cumulativeDist = 0;
		let cumulativeTime = 0;
		const points: { x: number; power: number }[] = [];
		for (const lap of laps) {
			const dist = (lap.totalDistance ?? 0) / METERS_PER_MILE;
			const time = (lap.totalTimerTime ?? 0) / 60;
			const power = lap.avgPower;
			if (power != null && power > 0) {
				const startX = xMode === "distance" ? cumulativeDist : cumulativeTime;
				const endX = xMode === "distance" ? cumulativeDist + dist : cumulativeTime + time;
				points.push({ x: startX, power });
				points.push({ x: endX, power });
			}
			cumulativeDist += dist;
			cumulativeTime += time;
		}
		return points.length > 0 ? points : null;
	}, [isCycling, laps, xMode]);

	const paceDomain = useMemo(() => {
		if (isCycling || !category) return null;
		return computePaceDomain(data, category);
	}, [data, category, isCycling]);

	const handleSelectionStart = useCallback((x: number) => {
		selectionStartRef.current = x;
	}, []);

	const handleSelectionEnd = useCallback((x: number) => {
		const start = selectionStartRef.current;
		selectionStartRef.current = null;
		if (start == null || start === x) {
			// Click without drag — clear selection
			setSelectionRange(null);
			onRangeSelect?.(null);
			return;
		}
		const xMin = Math.min(start, x);
		const xMax = Math.max(start, x);
		setSelectionRange([xMin, xMax]);

		// Convert x range to point indices for the map
		const startIdx = data.find((d) => d.x >= xMin)?.pointIndex ?? 0;
		const endIdx = [...data].reverse().find((d) => d.x <= xMax)?.pointIndex ?? data[data.length - 1]?.pointIndex ?? 0;
		onRangeSelect?.([startIdx, endIdx]);
	}, [data, onRangeSelect]);

	const clearSelection = useCallback(() => {
		setSelectionRange(null);
		onRangeSelect?.(null);
	}, [onRangeSelect]);

	return (
		<div className="space-y-4">
			<div className="inline-flex rounded-lg bg-gray-800 border border-gray-700 p-0.5" role="group" aria-label="X-axis mode">
				<button
					type="button"
					onClick={() => setXMode("distance")}
					aria-pressed={xMode === "distance"}
					aria-label="Plot by distance"
					className={xMode === "distance" ? "px-3 py-1.5 rounded-md text-xs font-medium text-white bg-orange-500" : "px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"}
				>
					Distance
				</button>
				<button
					type="button"
					onClick={() => setXMode("time")}
					aria-pressed={xMode === "time"}
					aria-label="Plot by time"
					className={xMode === "time" ? "px-3 py-1.5 rounded-md text-xs font-medium text-white bg-orange-500" : "px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"}
				>
					Time
				</button>
			</div>

			{selectionRange && (
				<button
					type="button"
					onClick={clearSelection}
					className="text-xs text-orange-400 hover:text-orange-300 underline"
					aria-label="Clear chart range selection"
				>
					Clear selection
				</button>
			)}

			{isCycling ? (
				<>
					{/* Power chart on top for cycling if lap power data is available */}
					{powerData && (
						<div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
							<p className="text-sm text-gray-400 mb-2">Power (W)</p>
							<ResponsiveContainer width="100%" height={200}>
								<LineChart data={powerData}>
									<CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
									<XAxis
										dataKey="x"
										type="number"
										domain={[0, "dataMax"]}
										ticks={getXTicks(data, xMode)}
										tick={{ fontSize: 11, fill: "#6b7280" }}
										label={{ value: xLabel, position: "bottom", fill: "#6b7280", fontSize: 11 }}
									/>
									<YAxis tick={{ fontSize: 11, fill: "#6b7280" }} />
									<Tooltip
										content={({ active, payload }) => {
											if (!active || !payload?.[0]) return null;
											const d = payload[0].payload as { x: number; power: number };
											return (
												<div className="rounded-lg border border-gray-700 bg-gray-800/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
													<p className="text-gray-400">Mile {d.x.toFixed(2)}</p>
													<p className="mt-0.5 font-medium text-gray-100">{Math.round(d.power)} W</p>
												</div>
											);
										}}
										cursor={{ stroke: "#f97316", strokeWidth: 1 }}
									/>
									<Line type="stepAfter" dataKey="power" stroke="#FF8C00" dot={false} strokeWidth={2} />
									<ReferenceLine
										y={Math.round(powerData.reduce((s, p) => s + p.power, 0) / powerData.length)}
										stroke="#FF8C00"
										strokeDasharray="5 5"
										label={{ value: `Avg: ${Math.round(powerData.reduce((s, p) => s + p.power, 0) / powerData.length)} W`, fill: "#6b7280", fontSize: 11, position: "insideBottomRight" }}
									/>
								</LineChart>
							</ResponsiveContainer>
						</div>
					)}
					<Chart data={data} dataKey="speed" metric="speed" color="#1F77B4" yLabel="Speed (mph)" xLabel={xLabel} xMode={xMode} isCycling={isCycling} avgValue={avg(data, "speed")} onHover={onHover} selectionRange={selectionRange} onSelectionStart={handleSelectionStart} onSelectionEnd={handleSelectionEnd} />
				</>
			) : (
				<Chart
					data={data}
					dataKey="pace"
					metric="pace"
					color="#1F77B4"
					yLabel="Pace (min/mi)"
					xLabel={xLabel}
					xMode={xMode}
					reversed
					yFormatter={(v) => formatPace(v) ?? ""}
					avgValue={avg(data, "pace")}
					isCycling={isCycling}
					onHover={onHover}
					selectionRange={selectionRange}
					onSelectionStart={handleSelectionStart}
					onSelectionEnd={handleSelectionEnd}
					yDomain={paceDomain?.domain}
					yTicks={paceDomain?.ticks}
				/>
			)}

			<Chart data={data} dataKey="hr" metric="hr" color="#e53e3e" yLabel="Heart Rate (bpm)" xLabel={xLabel} xMode={xMode} isCycling={isCycling} avgValue={avg(data, "hr")} onHover={onHover} selectionRange={selectionRange} onSelectionStart={handleSelectionStart} onSelectionEnd={handleSelectionEnd} />
			<Chart data={data} dataKey="altitude" metric="altitude" color="#2CA02C" yLabel="Altitude (ft)" xLabel={xLabel} xMode={xMode} isCycling={isCycling} avgValue={null} onHover={onHover} selectionRange={selectionRange} onSelectionStart={handleSelectionStart} onSelectionEnd={handleSelectionEnd} />
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
				selectionRange={selectionRange}
				onSelectionStart={handleSelectionStart}
				onSelectionEnd={handleSelectionEnd}
			/>
		</div>
	);
}
