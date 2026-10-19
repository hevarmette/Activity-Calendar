import { METERS_PER_MILE, Sport, convertSecondsToHms } from "@activity-calendar/shared";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { downloadActivityFit } from "../api/client.js";
import { useTrimActivity } from "../api/mutations.js";
import { useActivity, useRecords, useSessions } from "../api/queries.js";
import { DetailMap } from "../components/maps/DetailMap.js";
import { useActiveSchema } from "../context/ActiveSchemaContext.js";

/**
 * Activity trim preview page (route: /activity/:activityId/trim).
 *
 * Phase 1: TAIL trim on single-session activities. The user drags a slider whose
 * value is the index of the LAST KEPT record (`boundaryIndex`). The left end of
 * the activity is fixed (index 0); dragging the right thumb inward trims more of
 * the tail. The amount can be read/typed as either seconds or distance, but the
 * underlying model is always a record index — and the request sends
 * `trimEnd = points[boundaryIndex].timestamp` (an exact record timestamp) so the
 * server's surviving set matches this preview precisely.
 *
 * The map highlights the trimmed-away tail (`selectedRange = [boundaryIndex,
 * last]`) and marks the cut point (`hoveredIndex = boundaryIndex`). Before/after
 * totals are computed client-side straight from the records:
 *   - distance:     record.distance (cumulative meters)
 *   - elapsed time: record.timestamp − firstRecord.timestamp
 *   - non-paused time: record.elapsedTime (already pause-removed, matching the
 *                   server's recomputation)
 *
 * Trimming is destructive and recomputes the stored summaries from the surviving
 * GPS data; the page states this plainly before the user confirms.
 */

type Unit = "seconds" | "distance";

export default function ActivityTrimPage() {
	const { activityId } = useParams<{ activityId: string }>();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const id = Number(activityId);
	const sport = searchParams.get("sport") || Sport.Running;

	const { activeSchema } = useActiveSchema();
	const isReadOnly = activeSchema !== undefined;

	const { data: activity, isLoading } = useActivity(id);
	const { data: points } = useRecords(id);
	const { data: sessions } = useSessions(id);
	const trimActivity = useTrimActivity(id);

	const isMultisport = (sessions?.length ?? 0) > 1;
	const recordCount = points?.length ?? 0;

	// Slider value = index of the last KEPT record. Default to the final record
	// (nothing trimmed). Range is 1..lastIndex so at least 2 records always remain.
	const lastIndex = recordCount > 0 ? recordCount - 1 : 0;
	const [boundaryIndex, setBoundaryIndex] = useState<number | null>(null);
	const [unit, setUnit] = useState<Unit>("seconds");
	// Free-text draft for the amount input so the user can type any value (e.g.
	// "16") without it snapping on each keystroke. `null` means "not editing —
	// show the value derived from the current slider boundary". The actual cut
	// still snaps to the nearest record at or before the typed amount.
	const [amountDraft, setAmountDraft] = useState<string | null>(null);
	const [trimError, setTrimError] = useState<string | null>(null);
	const [isExporting, setIsExporting] = useState(false);
	const [exportError, setExportError] = useState<string | null>(null);

	// Effective boundary: default (uninitialized) means "keep everything".
	const boundary = boundaryIndex ?? lastIndex;

	const detail = useMemo(() => {
		if (!points || points.length < 2) return null;
		const first = points[0]!;
		const last = points[points.length - 1]!;
		const b = points[boundary]!;
		const firstTs = new Date(first.timestamp).getTime();

		const beforeDistanceM = last.distance ?? 0;
		const afterDistanceM = b.distance ?? 0;
		const beforeElapsedS = (new Date(last.timestamp).getTime() - firstTs) / 1000;
		const afterElapsedS = (new Date(b.timestamp).getTime() - firstTs) / 1000;
		const beforeMovingS = last.elapsedTime ?? 0;
		const afterMovingS = b.elapsedTime ?? 0;

		return {
			beforeDistanceM,
			afterDistanceM,
			beforeElapsedS,
			afterElapsedS,
			beforeMovingS,
			afterMovingS,
			trimmedSeconds: beforeMovingS - afterMovingS,
			trimmedMeters: beforeDistanceM - afterDistanceM,
			trimmedRecords: points.length - 1 - boundary,
		};
	}, [points, boundary]);

	if (isLoading) {
		return <div className="flex items-center justify-center py-20 text-gray-400">Loading…</div>;
	}
	if (!activity) {
		return <div className="py-10 text-center text-gray-400">Activity not found.</div>;
	}

	const backTo = `/activity/${id}${sport ? `?sport=${encodeURIComponent(sport)}` : ""}`;

	// Phase 1 guard: single-session, writable, with enough records.
	const unsupportedReason = isReadOnly
		? "Trimming is disabled while viewing a secondary schema."
		: isMultisport
			? "Trimming a multisport activity is not supported yet."
			: recordCount < 2
				? "This activity has too few GPS records to trim."
				: null;

	if (unsupportedReason) {
		return (
			<div className="mx-auto max-w-2xl space-y-4 py-8">
				<Link to={backTo} className="text-sm text-gray-400 transition-colors hover:text-gray-200">
					← Back to activity
				</Link>
				<div className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-8 text-center text-gray-400">
					{unsupportedReason}
				</div>
			</div>
		);
	}

	const pts = points!;
	const d = detail!;
	const miles = (m: number) => m / METERS_PER_MILE;
	const isTrimming = boundary < lastIndex;

	// Seconds the user wants to drop (from the tail). Snaps the boundary to the
	// nearest record at or before the requested amount (records are ~1/s but can
	// have gaps, so the cut always lands on a real record timestamp).
	function setFromSeconds(dropSeconds: number) {
		const lastMoving = pts[pts.length - 1]!.elapsedTime ?? 0;
		const target = lastMoving - Math.max(0, dropSeconds);
		let idx = 0;
		for (let i = 0; i < pts.length; i++) {
			if ((pts[i]!.elapsedTime ?? 0) <= target) idx = i;
			else break;
		}
		setBoundaryIndex(Math.min(lastIndex, Math.max(1, idx)));
	}

	function setFromMiles(dropMiles: number) {
		const maxDist = pts[pts.length - 1]!.distance ?? 0;
		const target = maxDist - Math.max(0, dropMiles) * METERS_PER_MILE;
		let idx = 0;
		for (let i = 0; i < pts.length; i++) {
			if ((pts[i]!.distance ?? 0) <= target) idx = i;
			else break;
		}
		setBoundaryIndex(Math.min(lastIndex, Math.max(1, idx)));
	}

	// Handle free-text edits to the amount box: keep the raw string as the draft
	// so the field shows exactly what was typed, and move the slider boundary to
	// the nearest matching record. Empty/invalid input leaves the boundary as-is.
	function handleAmountInput(raw: string) {
		setAmountDraft(raw);
		const n = Number(raw);
		if (!Number.isFinite(n) || n < 0) return;
		if (unit === "seconds") setFromSeconds(n);
		else setFromMiles(n);
	}

	// Switching the slider or unit toggle should drop the draft so the box shows
	// the value derived from the (snapped) boundary again.
	function moveBoundary(idx: number) {
		setAmountDraft(null);
		setBoundaryIndex(idx);
	}

	async function handleDownloadOriginal() {
		if (isExporting) return;
		setExportError(null);
		setIsExporting(true);
		try {
			const rawName = activity?.name ?? `activity_${id}`;
			const safeName = rawName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
			await downloadActivityFit(id, `${safeName}_${id}_original.fit`, activeSchema);
		} catch (err) {
			setExportError(err instanceof Error ? err.message : "Download failed.");
		} finally {
			setIsExporting(false);
		}
	}

	async function handleConfirm() {
		if (!isTrimming) return;
		setTrimError(null);
		const trimEnd = pts[boundary]!.timestamp;
		try {
			await trimActivity.mutateAsync({ trimEnd, debugSql: false });
			navigate(backTo);
		} catch (err) {
			setTrimError(err instanceof Error ? err.message : "Trim failed.");
		}
	}

	return (
		<div className="mx-auto max-w-5xl space-y-6 py-6">
			<div className="flex items-center justify-between gap-4">
				<div>
					<Link to={backTo} className="text-sm text-gray-400 transition-colors hover:text-gray-200">
						← Back to activity
					</Link>
					<h1 className="mt-1 text-xl font-bold text-gray-50">Trim end of activity</h1>
					<p className="text-sm text-gray-500">{activity.name ?? `Activity ${id}`}</p>
				</div>
			</div>

			{/* Map: whole route, trimmed tail highlighted, cut point marked. */}
			<DetailMap
				points={pts}
				sport={sport}
				sessions={sessions}
				hoveredIndex={boundary}
				selectedRange={isTrimming ? [boundary, lastIndex] : null}
			/>

			{/* Amount control: slider + unit toggle + precise input. */}
			<div className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<span className="text-xs font-medium uppercase tracking-wide text-gray-500">Trim from the end</span>
					<div className="flex overflow-hidden rounded text-xs" role="group" aria-label="Trim amount unit">
						<button
							type="button"
							onClick={() => {
								setAmountDraft(null);
								setUnit("seconds");
							}}
							className={`px-3 py-1.5 ${unit === "seconds" ? "bg-red-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
							aria-pressed={unit === "seconds"}
						>
							Seconds
						</button>
						<button
							type="button"
							onClick={() => {
								setAmountDraft(null);
								setUnit("distance");
							}}
							className={`px-3 py-1.5 ${unit === "distance" ? "bg-red-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
							aria-pressed={unit === "distance"}
						>
							Distance
						</button>
					</div>
				</div>

				{/* Slider — left end fixed at the activity start, right thumb trims the tail. */}
				<div>
					<input
						type="range"
						min={1}
						max={lastIndex}
						step={1}
						value={boundary}
						onChange={(e) => moveBoundary(Number(e.target.value))}
						aria-label="Keep boundary (drag left to trim more of the end)"
						className="w-full accent-red-500"
					/>
					<div className="mt-1 flex justify-between text-[0.7rem] uppercase tracking-wide text-gray-500">
						<span>Start (kept)</span>
						<span>End</span>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-3">
					{unit === "seconds" ? (
						<label className="flex items-center gap-1.5 text-sm text-gray-300">
							<span>Drop last</span>
							<input
								type="number"
								min={0}
								step={1}
								value={amountDraft ?? String(Math.round(d.trimmedSeconds))}
								onChange={(e) => handleAmountInput(e.target.value)}
								onBlur={() => setAmountDraft(null)}
								aria-label="Seconds to drop from the end"
								className="w-24 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm tabular-nums text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/50"
							/>
							<span className="text-gray-500">s</span>
						</label>
					) : (
						<label className="flex items-center gap-1.5 text-sm text-gray-300">
							<span>Drop last</span>
							<input
								type="number"
								min={0}
								step={0.05}
								value={amountDraft ?? miles(d.trimmedMeters).toFixed(2)}
								onChange={(e) => handleAmountInput(e.target.value)}
								onBlur={() => setAmountDraft(null)}
								aria-label="Miles to drop from the end"
								className="w-24 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm tabular-nums text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/50"
							/>
							<span className="text-gray-500">mi</span>
						</label>
					)}
					<span className="text-xs text-gray-500">
						{isTrimming
							? `Removing ${d.trimmedRecords} record${d.trimmedRecords === 1 ? "" : "s"} from the end — actual cut ${d.trimmedSeconds.toFixed(1)}s / ${miles(d.trimmedMeters).toFixed(2)} mi`
							: "Nothing trimmed yet — drag the slider left"}
					</span>
				</div>
			</div>

			{/* Before → after totals (exact, from the records). */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<StatCard
					label="Total distance"
					before={`${miles(d.beforeDistanceM).toFixed(2)} mi`}
					after={`${miles(d.afterDistanceM).toFixed(2)} mi`}
					delta={isTrimming ? `−${miles(d.trimmedMeters).toFixed(2)} mi` : null}
				/>
				<StatCard
					label="Total elapsed time"
					before={convertSecondsToHms(Math.round(d.beforeElapsedS)) ?? "—"}
					after={convertSecondsToHms(Math.round(d.afterElapsedS)) ?? "—"}
					delta={isTrimming ? `−${convertSecondsToHms(Math.round(d.beforeElapsedS - d.afterElapsedS)) ?? "—"}` : null}
				/>
				<StatCard
					label="Total non-paused time"
					before={convertSecondsToHms(Math.round(d.beforeMovingS)) ?? "—"}
					after={convertSecondsToHms(Math.round(d.afterMovingS)) ?? "—"}
					delta={isTrimming ? `−${convertSecondsToHms(Math.round(d.trimmedSeconds)) ?? "—"}` : null}
				/>
			</div>

			{/* Always-on recalculation notice. */}
			<div className="rounded-lg border border-red-800/70 bg-red-950/50 px-4 py-3 text-sm text-red-200">
				Trimming <span className="font-semibold">permanently deletes</span> the removed records and recalculates this
				activity&rsquo;s <span className="font-semibold">total distance</span>,{" "}
				<span className="font-semibold">total elapsed time</span>,{" "}
				<span className="font-semibold">total moving time</span>, <span className="font-semibold">ascent/descent</span>,
				and <span className="font-semibold">average/max heart rate</span> from the remaining GPS data. This overwrites
				those values — including any you edited manually — and <span className="font-semibold">cannot be undone</span>.
			</div>

			{/* Safety net: download original first. */}
			<div className="rounded-lg border border-gray-700 bg-gray-800/40 px-4 py-3">
				<div className="flex items-center justify-between gap-4">
					<div className="text-sm text-gray-300">
						<p className="font-medium text-gray-200">Download original .fit first</p>
						<p className="mt-0.5 text-xs text-gray-500">Keep a restore artifact before deleting records.</p>
					</div>
					<button
						type="button"
						onClick={handleDownloadOriginal}
						disabled={isExporting}
						className="shrink-0 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{isExporting ? "Downloading…" : "Download .fit"}
					</button>
				</div>
				{exportError && (
					<p role="alert" className="mt-2 text-xs text-red-300">
						Download failed: {exportError}
					</p>
				)}
			</div>

			{/* Mutation error surface (400 window / 409 multisport / 422 swim). */}
			{trimError && (
				<p role="alert" className="rounded-lg border border-red-700 bg-red-900/50 px-4 py-2.5 text-sm text-red-200">
					{trimError}
				</p>
			)}

			{/* Actions. */}
			<div className="flex items-center justify-end gap-3">
				<Link
					to={backTo}
					className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700"
				>
					Cancel
				</Link>
				<button
					type="button"
					onClick={handleConfirm}
					disabled={!isTrimming || trimActivity.isPending}
					className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{trimActivity.isPending ? "Trimming…" : "Trim activity"}
				</button>
			</div>
		</div>
	);
}

/** A single before→after metric card. */
function StatCard({
	label,
	before,
	after,
	delta,
}: {
	label: string;
	before: string;
	after: string;
	delta: string | null;
}) {
	return (
		<div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3">
			<p className="text-[0.7rem] uppercase tracking-wide text-gray-500">{label}</p>
			<div className="mt-1 flex items-baseline gap-2">
				<span className="text-gray-500 line-through tabular-nums">{before}</span>
				<span className="text-gray-600">→</span>
				<span className="text-lg font-bold text-gray-50 tabular-nums">{after}</span>
			</div>
			{delta && <p className="mt-0.5 text-xs text-red-300 tabular-nums">{delta}</p>}
		</div>
	);
}
