const BASE = import.meta.env.VITE_API_URL || "";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		headers: { "Content-Type": "application/json" },
		...init,
	});
	if (!res.ok) throw new Error(await extractErrorMessage(res));
	return res.json() as Promise<T>;
}

/**
 * Build a descriptive error message from a non-2xx JSON response.
 *
 * The server returns `{ error, details? }` on failures. For Zod validation
 * errors, `details.fieldErrors` maps each field to its messages — we flatten
 * those into "field: message" pairs so the user sees exactly what was wrong
 * instead of a generic "400 Bad Request".
 */
async function extractErrorMessage(res: Response): Promise<string> {
	const fallback = `API error: ${res.status} ${res.statusText}`;
	const body = await res.json().catch(() => null);
	if (!body || typeof body !== "object") return fallback;

	const details = (body as { details?: unknown }).details;
	if (details && typeof details === "object") {
		const fieldErrors = (details as { fieldErrors?: Record<string, string[] | undefined> }).fieldErrors;
		const formErrors = (details as { formErrors?: string[] }).formErrors;
		const parts: string[] = [];
		if (fieldErrors) {
			for (const [field, msgs] of Object.entries(fieldErrors)) {
				if (msgs && msgs.length > 0) parts.push(`${field}: ${msgs.join(", ")}`);
			}
		}
		if (formErrors && formErrors.length > 0) parts.push(...formErrors);
		if (parts.length > 0) {
			const base = (body as { error?: string }).error ?? "Invalid request";
			return `${base} — ${parts.join("; ")}`;
		}
	}

	const error = (body as { error?: string }).error;
	return typeof error === "string" && error.length > 0 ? error : fallback;
}

/**
 * Trigger a browser download from a fetch Response carrying a binary body.
 *
 * Reads the filename from the Content-Disposition header (falling back to the
 * provided name), then downloads via a temporary anchor element. Reads the
 * JSON `error` field from non-2xx responses for a useful message.
 */
async function triggerBlobDownload(res: Response, fallbackName: string): Promise<void> {
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: `API error: ${res.status}` }));
		throw new Error(err.error ?? `API error: ${res.status}`);
	}
	const disposition = res.headers.get("Content-Disposition");
	const filename = disposition?.match(/filename="(.+)"/)?.[1] ?? fallbackName;
	const blob = await res.blob();
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

/**
 * Export a single completed activity as a .fit file and trigger a download.
 * Uses GET /api/activities/:id/export.
 */
export async function downloadActivityFit(activityId: number, fallbackName?: string): Promise<void> {
	const res = await fetch(`${BASE}/api/activities/${activityId}/export`);
	await triggerBlobDownload(res, fallbackName ?? `activity_${activityId}.fit`);
}

/**
 * Export a set of completed activities as a ZIP of .fit files and trigger a
 * download. Uses POST /api/export with an ActivityExportRequest body
 * (activityIds, text filters, or { all: true }).
 */
export async function downloadActivitiesZip(
	request: import("@activity-calendar/shared").ActivityExportRequest,
): Promise<void> {
	const res = await fetch(`${BASE}/api/export`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(request),
	});
	await triggerBlobDownload(res, "activities_export.zip");
}

/**
 * POST a WorkoutDefinition to the server and trigger a browser download
 * of the returned .fit binary file.
 *
 * This bypasses the standard `api()` helper since it needs to handle
 * a binary Blob response instead of JSON.
 */
export async function downloadWorkoutFit(
	workout: import("@activity-calendar/shared").WorkoutDefinition,
): Promise<void> {
	const res = await fetch(`${BASE}/api/workouts/generate`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(workout),
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: `API error: ${res.status}` }));
		throw new Error(err.error ?? `API error: ${res.status}`);
	}
	// Extract filename from Content-Disposition header or use fallback
	const disposition = res.headers.get("Content-Disposition");
	const filename = disposition?.match(/filename="(.+)"/)?.[1] ?? `${workout.name}_workout.fit`;
	// Trigger browser download via temporary anchor element
	const blob = await res.blob();
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

/**
 * Generate a .fit file from a saved workout (by ID) and trigger browser download.
 *
 * Uses POST /api/workouts/:id/generate which looks up the workout definition
 * from the database and encodes it using the workout_id as the serial number.
 */
export async function downloadSavedWorkoutFit(workoutId: number, name: string): Promise<void> {
	const res = await fetch(`${BASE}/api/workouts/${workoutId}/generate`, {
		method: "POST",
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: `API error: ${res.status}` }));
		throw new Error(err.error ?? `API error: ${res.status}`);
	}
	const disposition = res.headers.get("Content-Disposition");
	const filename = disposition?.match(/filename="(.+)"/)?.[1] ?? `${name}_workout.fit`;
	const blob = await res.blob();
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

/**
 * Generate a .fit file for a scheduled workout and download it using the
 * scheduled date as the filename (e.g. "2026-08-18.fit").
 *
 * Overrides whatever the server sends in Content-Disposition — uses the
 * scheduledDate directly for a cleaner filename when downloading from the calendar.
 */
export async function downloadScheduledWorkoutFit(workoutId: number, scheduledDate: string): Promise<void> {
	const res = await fetch(`${BASE}/api/workouts/${workoutId}/generate`, {
		method: "POST",
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: `API error: ${res.status}` }));
		throw new Error(err.error ?? `API error: ${res.status}`);
	}
	const blob = await res.blob();
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `${scheduledDate.slice(0, 10)}.fit`;
	a.click();
	URL.revokeObjectURL(url);
}
