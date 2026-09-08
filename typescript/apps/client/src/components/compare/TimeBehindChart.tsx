import { convertSecondsToHms } from "@activity-calendar/shared";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DeltaPoint } from "../../lib/timeBehind.js";

interface Props {
	/** Precomputed shared distance-domain delta series (B − A time, in seconds). */
	series: DeltaPoint[];
	/** Name of activity A (the reference/baseline). */
	nameA: string;
	/** Name of activity B (the one whose gap to A is plotted). */
	nameB: string;
	/** Line color — kept in the compare orange theme by default. */
	color?: string;
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

/** Tooltip: shows the mile mark and the signed time gap in plain language. */
function DeltaTooltip({
	active,
	payload,
	nameB,
}: {
	active?: boolean;
	payload?: { payload: DeltaPoint }[];
	nameB: string;
}) {
	if (!active || !payload?.[0]) return null;
	const d = payload[0].payload;
	const behind = d.deltaSeconds >= 0;
	return (
		<div className="rounded-lg border border-gray-700 bg-gray-800/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
			<p className="text-gray-400">Mile {d.distMiles.toFixed(2)}</p>
			<p className="mt-0.5 font-medium text-gray-100">
				{formatSignedDelta(d.deltaSeconds)} · {nameB} {behind ? "behind" : "ahead"}
			</p>
		</div>
	);
}

/**
 * "How far behind over time" delta chart for the two-activity comparison.
 *
 * Plots the running TIME gap of activity B relative to activity A across a shared
 * DISTANCE axis: for each mile mark, `delta = timeB(d) − timeA(d)` in seconds.
 * The horizontal reference line at y = 0 marks parity — the curve rising above it
 * means B is falling behind (slower to reach that distance), dipping below means
 * B is pulling ahead.
 *
 * Structure/styling mirror {@link PerformanceCharts}: ResponsiveContainer +
 * LineChart with a distance (mi) XAxis, a signed mm:ss YAxis, CartesianGrid,
 * custom Tooltip, and a ReferenceLine at zero. The `series` prop is expected to
 * be precomputed by the parent (via `buildDeltaSeries`) so this component stays
 * a thin, pure renderer.
 */
export function TimeBehindChart({ series, nameA, nameB, color = "#f97316" }: Props) {
	if (series.length === 0) return null;

	// X ticks every whole mile across the shared range.
	const maxDist = series[series.length - 1]?.distMiles ?? 0;
	const xTicks: number[] = [];
	for (let i = 0; i <= maxDist; i += 1) xTicks.push(i);

	return (
		<div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
			<p className="text-sm font-medium text-gray-200">Time behind over distance</p>
			<p className="mt-0.5 mb-3 text-xs text-gray-500">
				Time behind {nameB} vs {nameA} — above zero means {nameB} is behind
			</p>
			<ResponsiveContainer width="100%" height={220}>
				<LineChart data={series}>
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
					<Tooltip content={<DeltaTooltip nameB={nameB} />} cursor={{ stroke: "#f97316", strokeWidth: 1 }} />
					{/* Parity line — B and A are level where the curve crosses zero. */}
					<ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 4" />
					<Line type="monotone" dataKey="deltaSeconds" stroke={color} dot={false} strokeWidth={1.5} />
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}
