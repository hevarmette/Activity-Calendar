const BASE = import.meta.env.VITE_API_URL || "";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		headers: { "Content-Type": "application/json" },
		...init,
	});
	if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
	return res.json() as Promise<T>;
}
