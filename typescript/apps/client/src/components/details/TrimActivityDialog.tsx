import { METERS_PER_MILE, convertSecondsToHms } from "@activity-calendar/shared";
import { useState } from "react";
import { downloadActivityFit } from "../../api/client.js";
import { Dialog } from "../ui/Dialog.js";

interface Props {
	/** Whether the confirmation dialog is open. */
	open: boolean;
	/** Close the dialog without trimming. */
	onClose: () => void;
	/** The activity being trimmed (used for the export filename + schema). */
	activityId: number;
	/** Human-readable activity name, used for the original-.fit export filename. */
	activityName: string | null | undefined;
	/** Active (secondary) schema, forwarded to the export download. */
	schema?: string;
	/** Number of seconds being dropped off the tail — shown for context. */
	seconds: number;
	/** Current (pre-trim) distance in meters. */
	distanceMeters: number;
	/** Current (pre-trim) duration in seconds. */
	durationSeconds: number;
	/** True while the trim request is in flight. */
	isPending: boolean;
	/** Server/validation error to surface in the dialog, if any. */
	error: string | null;
	/** Invoke the destructive trim. The parent owns the mutation + payload. */
	onConfirm: () => void;
}

/**
 * Confirmation modal for the destructive "trim end" action on an activity.
 *
 * Makes the irreversibility explicit, shows the current distance + duration so
 * the user sees what will change, and offers to download the original `.fit`
 * (a restore artifact) before confirming. The final confirm button uses the
 * project's red destructive accent and reflects the mutation's pending/error
 * state.
 */
export function TrimActivityDialog({
	open,
	onClose,
	activityId,
	activityName,
	schema,
	seconds,
	distanceMeters,
	durationSeconds,
	isPending,
	error,
	onConfirm,
}: Props) {
	const [isExporting, setIsExporting] = useState(false);
	const [exportError, setExportError] = useState<string | null>(null);

	async function handleDownloadOriginal() {
		if (isExporting) return;
		setExportError(null);
		setIsExporting(true);
		try {
			const rawName = activityName ?? `activity_${activityId}`;
			const safeName = rawName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
			await downloadActivityFit(activityId, `${safeName}_${activityId}_original.fit`, schema);
		} catch (err) {
			setExportError(err instanceof Error ? err.message : "Download failed.");
		} finally {
			setIsExporting(false);
		}
	}

	const miles = distanceMeters / METERS_PER_MILE;

	return (
		<Dialog open={open} onClose={onClose} title="Trim end of activity" subtitle={`Drop the last ${seconds}s`}>
			<div className="space-y-5">
				{/* Irreversibility warning */}
				<div className="rounded-lg bg-red-950/50 border border-red-800/70 px-4 py-3 text-sm text-red-200">
					This <span className="font-semibold">permanently deletes</span> the trailing records and{" "}
					<span className="font-semibold">cannot be undone</span>. The map, charts, laps and totals will be recomputed
					from the surviving records.
				</div>

				{/* Before (current) metrics — bare label + value, data-dense */}
				<div>
					<p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">Before trim</p>
					<div className="grid grid-cols-2 gap-4">
						<div>
							<p className="text-[0.7rem] uppercase tracking-wide text-gray-500">Distance</p>
							<p className="mt-0.5 text-2xl font-bold text-gray-50 tabular-nums">
								{miles.toFixed(2)}
								<span className="text-gray-500 font-bold"> mi</span>
							</p>
						</div>
						<div>
							<p className="text-[0.7rem] uppercase tracking-wide text-gray-500">Duration</p>
							<p className="mt-0.5 text-2xl font-bold text-gray-50 tabular-nums">
								{convertSecondsToHms(Math.round(durationSeconds)) ?? "—"}
							</p>
						</div>
					</div>
				</div>

				{/* Safety net: download original before confirming */}
				<div className="rounded-lg border border-gray-700 bg-gray-800/40 px-4 py-3">
					<div className="flex items-center justify-between gap-4">
						<div className="text-sm text-gray-300">
							<p className="font-medium text-gray-200">Download original .fit first</p>
							<p className="text-xs text-gray-500 mt-0.5">Keep a restore artifact before deleting records.</p>
						</div>
						<button
							type="button"
							onClick={handleDownloadOriginal}
							disabled={isExporting}
							aria-label="Download original activity as a .fit file"
							className="shrink-0 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg px-3 py-1.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
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

				{/* Mutation error surface (409 multisport / 422 swim / 400 window, etc.) */}
				{error && (
					<p role="alert" className="rounded-lg bg-red-900/50 border border-red-700 px-4 py-2.5 text-sm text-red-200">
						{error}
					</p>
				)}

				{/* Actions */}
				<div className="flex items-center justify-end gap-3 pt-1">
					<button
						type="button"
						onClick={onClose}
						disabled={isPending}
						className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg px-4 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onConfirm}
						disabled={isPending}
						aria-label={`Permanently trim the last ${seconds} seconds`}
						className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:opacity-60 disabled:cursor-not-allowed"
					>
						{isPending ? "Trimming…" : `Trim last ${seconds}s`}
					</button>
				</div>
			</div>
		</Dialog>
	);
}
