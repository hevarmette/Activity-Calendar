import { convertSecondsToHms } from "@activity-calendar/shared";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NamedDeltaSeries } from "../../lib/timeBehind.js";

interface Props {
	/** Name of the baseline activity (the reference all deltas are measured against). */
	baselineName: string;
	/** One named/colored delta series per non-baseline activity. */
	seriesList: NamedDeltaSeries[];
}

/** A merged wide-format row: a shared distance mark plus each series' delta by KEY. */
interface WideRow {
	distMiles: number;
	/** Per-series delta in seconds, keyed by the series' stable key. Missing = gap. */
	[seriesKey: string]: number;
}

/**
 * Format a signed second delta as `±M:SS` (or `±H:MM:SS`) for axis/tooltip use.
 *
 * Rounds to whole seconds for a clean label (the underlying series keeps full
 * precision — rounding is a display concern only). Uses `convertSecondsToHms`
 * for the magnitude and prefixes the sign explicitly (the shared formatter has
 * no notion of negative time). Zero renders without a sign.
 */
function formatSignedDelta(seconds: number): string {
	if (!Number.isFinite(seconds)) return "—";
	const rounded = Math.round(seconds);
	const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
	const abs = convertSecondsToHms(Math.abs(rounded));
	// Trim the ".00" fractional part convertSecondsToHms always appends.
	const trimmed = abs ? abs.replace(/\.00$/, "") : "0";
	return `${sign}${trimmed}`;
}

/** Quantize a distance to the shared 0.05-mile grid so series rows merge cleanly. */
function gridKey(distMiles: number): number {
	return Math.round(distMiles / 0.05) * 0.05;
}

/**
 * Merge N delta series into a single wide-row dataset keyed by the shared
 * distance grid. Each row is `{ distMiles, [seriesKey]: deltaSeconds }`; a
 * series that doesn't reach a given distance simply omits its key at that row,
 * which Recharts renders as a line gap rather than a drop to zero.
 *
 * Rows are keyed by each series' STABLE key (not its display name) so two
 * activities sharing a name don't collide into one line.
 */
function mergeSeries(seriesList: NamedDeltaSeries[]): WideRow[] {
	const rows = new Map<number, WideRow>();
	for (const s of seriesList) {
		for (const point of s.series) {
			const key = gridKey(point.distMiles);
			let row = rows.get(key);
			if (!row) {
				row = { distMiles: key } as WideRow;
				rows.set(key, row);
			}
			row[s.key] = point.deltaSeconds;
		}
	}
	return [...rows.values()].sort((a, b) => a.distMiles - b.distMiles);
}

/** Tooltip: shows the mile mark and each activity's signed time gap to the baseline. */
function DeltaTooltip({
	active,
	payload,
	label,
	baselineName,
	seriesList,
}: {
	active?: boolean;
	payload?: { payload: WideRow }[];
	label?: number;
	baselineName: string;
	seriesList: NamedDeltaSeries[];
}) {
	if (!active || !payload?.[0]) return null;
	const row = payload[0].payload;
	return (
		<div className="rounded-lg border border-gray-700 bg-gray-800/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
			<p className="text-gray-400">Mile {(label ?? row.distMiles).toFixed(2)}</p>
			<p className="mt-0.5 text-[11px] text-gray-500">vs {baselineName}</p>
			<div className="mt-1 space-y-0.5">
				{seriesList.map((s) => {
					const delta = row[s.key];
					if (delta == null) return null;
					const behind = delta >= 0;
					return (
						<p key={s.key} className="flex items-center gap-1.5 font-medium text-gray-100">
							<span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
							<span className="truncate">{s.name}</span>
							<span className="tabular-nums">
								{formatSignedDelta(delta)} {behind ? "behind" : "ahead"}
							</span>
						</p>
					);
				})}
			</div>
		</div>
	);
}

/**
 * "How far behind over time" delta chart for the N-activity comparison.
 *
 * Plots the running TIME gap of each non-baseline activity relative to the
 * baseline across a shared DISTANCE axis: for each mile mark,
 * `delta = timeActivity(d) − timeBaseline(d)` in seconds. The horizontal
 * reference line at y = 0 marks parity — a curve rising above it means that
 * activity is falling behind the baseline, dipping below means it is pulling
 * ahead.
 *
 * The N series are merged into a wide-row dataset ({@link mergeSeries}) keyed by
 * the shared distance grid, and one `<Line>` is rendered per series in its
 * palette color. For a single non-baseline series (N = 2) this is visually
 * identical to the previous single-line chart. Structure/styling mirror
 * {@link PerformanceCharts}: ResponsiveContainer + LineChart with a distance (mi)
 * XAxis, a signed mm:ss YAxis, CartesianGrid, custom Tooltip, and a zero
 * ReferenceLine.
 */
export function TimeBehindChart({ baselineName, seriesList }: Props) {
	if (seriesList.length === 0) return null;

	const data = mergeSeries(seriesList);
	if (data.length === 0) return null;

	// X ticks every whole mile across the widest series' range.
	const maxDist = data[data.length - 1]?.distMiles ?? 0;
	const xTicks: number[] = [];
	for (let i = 0; i <= maxDist; i += 1) xTicks.push(i);

	return (
		<div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
			<p className="text-sm font-medium text-gray-200">Time behind over distance</p>
			<p className="mt-0.5 mb-3 text-xs text-gray-500">
				Time behind each activity vs {baselineName} — above zero means that activity is behind
			</p>
			<ResponsiveContainer width="100%" height={220}>
				<LineChart data={data}>
					<CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
					<XAxis
						dataKey="distMiles"
						type="number"
						domain={[0, "dataMax"]}
						ticks={xTicks}
						tick={{ fontSize: 11, fill: "#6b7280" }}
						tickFormatter={(v) => `${v}`}
						label={{ value: "Distance (mi)", position: "bottom", fill: "#6b7280", fontSize: 11 }}
					/>
					<YAxis
						tick={{ fontSize: 11, fill: "#6b7280" }}
						tickFormatter={(v) => formatSignedDelta(Number(v))}
						width={64}
						label={{ value: "Δ time", angle: -90, position: "insideLeft", fill: "#6b7280", fontSize: 11 }}
					/>
					<Tooltip
						content={<DeltaTooltip baselineName={baselineName} seriesList={seriesList} />}
						cursor={{ stroke: "#f97316", strokeWidth: 1 }}
					/>
					{/* Parity line — an activity and the baseline are level where its curve crosses zero. */}
					<ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 4" />
					{seriesList.map((s) => (
						<Line
							key={s.key}
							type="monotone"
							dataKey={s.key}
							name={s.name}
							stroke={s.color}
							dot={false}
							strokeWidth={1.5}
							connectNulls={false}
						/>
					))}
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}
