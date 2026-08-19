const BASE = import.meta.env.VITE_API_URL || "";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		headers: { "Content-Type": "application/json" },
		...init,
	});
	if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
	return res.json() as Promise<T>;
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
	const filename = disposition?.match(/filename="(.+)"/)?.[1] ?? `${workout.name}.fit`;
	// Trigger browser download via temporary anchor element
	const blob = await res.blob();
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
