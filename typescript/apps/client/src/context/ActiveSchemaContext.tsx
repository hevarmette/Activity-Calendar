import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * sessionStorage key under which the active secondary schema name is persisted.
 * Mirrors the `cal_year` / `cal_month` precedent used by `PageLayout`.
 */
const STORAGE_KEY = "cal_schema";

/**
 * Value exposed by {@link ActiveSchemaProvider} via {@link useActiveSchema}.
 *
 * The client deliberately does NOT know the real name of the primary schema.
 * `activeSchema === undefined` means "my own data" (the primary schema); any
 * non-empty string is the active secondary schema the user is reading as.
 */
export interface ActiveSchemaContextValue {
	/**
	 * The active secondary schema name, or `undefined` for the primary schema
	 * ("my own data"). This is the single source of truth threaded into read
	 * hooks' query keys and URLs.
	 */
	activeSchema: string | undefined;
	/**
	 * Set the active schema. Pass a non-empty string to switch to a secondary
	 * schema (read-only), or `undefined` / an empty string to reset to the
	 * primary schema. The value is written through to `sessionStorage`.
	 */
	setActiveSchema: (schema: string | undefined) => void;
}

const ActiveSchemaContext = createContext<ActiveSchemaContextValue | null>(null);

/**
 * Read the initial active schema from `sessionStorage`. Returns `undefined`
 * (primary) when the key is absent or blank, so a fresh tab always starts on
 * the user's own data.
 */
function readInitialSchema(): string | undefined {
	if (typeof window === "undefined") return undefined;
	const stored = window.sessionStorage.getItem(STORAGE_KEY);
	const trimmed = stored?.trim();
	return trimmed ? trimmed : undefined;
}

/**
 * Provides the global "active schema" state to the app. Mount inside
 * `<QueryClientProvider>` so read hooks (which call {@link useActiveSchema})
 * can append the active schema to their query keys and request URLs.
 *
 * The primary schema is modeled as `undefined` — the client never learns or
 * stores the real primary schema name. Persistence uses `sessionStorage`
 * (not the URL) so a new tab starts on the user's own data and the year/month
 * `setSearchParams({ ... })` replace-all calls in `PageLayout` cannot wipe it.
 *
 * @param children - The application subtree that can read the active schema.
 */
export function ActiveSchemaProvider({ children }: { children: ReactNode }) {
	const [activeSchema, setActiveSchemaState] = useState<string | undefined>(readInitialSchema);

	const setActiveSchema = useCallback((schema: string | undefined) => {
		// Normalize: a blank/whitespace-only value resets to the primary schema.
		const trimmed = schema?.trim();
		const next = trimmed ? trimmed : undefined;
		setActiveSchemaState(next);
		// Write through to sessionStorage; remove the key entirely on reset so a
		// stale secondary name never lingers.
		if (typeof window !== "undefined") {
			if (next) window.sessionStorage.setItem(STORAGE_KEY, next);
			else window.sessionStorage.removeItem(STORAGE_KEY);
		}
	}, []);

	const value = useMemo<ActiveSchemaContextValue>(
		() => ({ activeSchema, setActiveSchema }),
		[activeSchema, setActiveSchema],
	);

	return <ActiveSchemaContext.Provider value={value}>{children}</ActiveSchemaContext.Provider>;
}

/**
 * Access the full active-schema context value
 * (`{ activeSchema, setActiveSchema }`).
 *
 * @throws If called outside an {@link ActiveSchemaProvider}.
 */
export function useActiveSchema(): ActiveSchemaContextValue {
	const ctx = useContext(ActiveSchemaContext);
	if (ctx === null) {
		throw new Error("useActiveSchema must be used within an <ActiveSchemaProvider>");
	}
	return ctx;
}

/**
 * Convenience accessor returning only the active schema name (or `undefined`
 * for the primary schema). Handy for read hooks that don't need the setter.
 *
 * @throws If called outside an {@link ActiveSchemaProvider}.
 */
export function useActiveSchemaValue(): string | undefined {
	return useActiveSchema().activeSchema;
}
