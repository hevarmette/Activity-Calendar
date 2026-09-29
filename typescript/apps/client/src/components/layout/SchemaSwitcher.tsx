import { useEffect, useRef, useState } from "react";
import { useActiveSchema } from "../../context/ActiveSchemaContext.js";

/** Debounce delay (ms) before an in-progress edit is committed. Project convention. */
const DEBOUNCE_MS = 300;

/**
 * Compact free-text control for the global "active schema" switcher.
 *
 * The user types a schema name free-hand; there is intentionally no available
 * schemas list, datalist, or client-side allowlist — validation happens
 * server-side (a wrong name makes read routes return 400). An empty/cleared
 * value resets to the primary schema (`undefined`, "my own data").
 *
 * Commit behavior mirrors the year input in {@link PageLayout}:
 * - debounced 300ms while typing,
 * - immediate on Enter,
 * - immediate on blur.
 *
 * When a secondary schema is active it renders a persistent pill
 * (`viewing: <schema> · read-only`). This is functional, not decoration: while
 * a secondary schema is active the whole app is read-only (mutation UI is
 * disabled), and the pill tells the user why.
 *
 * Intended to sit as the 4th control in the header's left cluster, after
 * Refresh. Accent color is red-600 per the project design system (the adjacent
 * year/month controls use orange, but orange is not propagated here).
 */
export function SchemaSwitcher() {
	const { activeSchema, setActiveSchema } = useActiveSchema();
	// Local draft so typing isn't clobbered by the committed value on each keystroke.
	const [draft, setDraft] = useState(activeSchema ?? "");
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Keep the draft in sync when the active schema changes externally
	// (e.g. restored from sessionStorage, or reset elsewhere).
	useEffect(() => {
		setDraft(activeSchema ?? "");
	}, [activeSchema]);

	// Clear any pending debounce timer on unmount.
	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

	/** Commit a raw input value: non-empty trimmed → active schema; empty → reset. */
	function commit(raw: string) {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		const trimmed = raw.trim();
		setActiveSchema(trimmed ? trimmed : undefined);
	}

	function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
		const val = e.target.value;
		setDraft(val);
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => commit(val), DEBOUNCE_MS);
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Enter") commit(draft);
	}

	function handleBlur() {
		commit(draft);
	}

	const isActive = activeSchema !== undefined;

	return (
		<div className="flex flex-row items-center gap-2">
			<input
				type="text"
				value={draft}
				onChange={handleChange}
				onKeyDown={handleKeyDown}
				onBlur={handleBlur}
				placeholder="my data"
				aria-label="Active schema (type a schema name to view another dataset read-only; clear to view your own data)"
				className={`w-24 rounded-lg bg-gray-800 border px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 transition-colors ${
					isActive ? "border-red-500/50" : "border-gray-700"
				}`}
			/>
			{isActive && (
				<span
					// Persistent read-only indicator — editing is disabled while a
					// secondary schema is active, so the user needs to see why.
					className="rounded border border-red-500/50 bg-red-600/20 px-2 py-0.5 text-xs text-red-300 whitespace-nowrap"
					title={`Viewing schema "${activeSchema}" — read-only`}
				>
					viewing: {activeSchema} · read-only
				</span>
			)}
		</div>
	);
}
