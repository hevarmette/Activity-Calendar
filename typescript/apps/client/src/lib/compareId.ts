/**
 * Parsing/serialization helpers and color palette for schema-qualified compare
 * ids (Feature #5 N-activity compare + Feature #6 read-only cross-schema).
 *
 * The compare page addresses activities via a single `?ids=` query parameter
 * holding a comma-separated list of ids. Each id is either:
 *
 * - a bare number (e.g. `1234`) → an activity in the PRIMARY schema (your data), or
 * - a `schema:id` pair (e.g. `alice:1234`) → an activity in a SECONDARY schema,
 *   read-only, resolved server-side against the `?schema=` allowlist.
 *
 * These helpers are intentionally free of React so the parsing rules can be
 * reasoned about (and unit-tested) in isolation.
 */

/**
 * A single parsed compare target.
 *
 * `schema` is `undefined` for primary-schema ids (bare numbers). When present it
 * names the secondary schema the id lives in — this is threaded through the read
 * queries as `?schema=` and disables primary-only deep links in the UI.
 */
export interface CompareId {
	/** Secondary schema name, or `undefined` for the primary schema. */
	schema?: string;
	/** Numeric activity id (always positive when parsed successfully). */
	id: number;
}

/**
 * Parse a single raw compare-id token.
 *
 * Accepted forms:
 * - `"1234"` → `{ id: 1234 }` (primary schema).
 * - `"alice:1234"` → `{ schema: "alice", id: 1234 }` (secondary schema).
 *
 * Returns `null` (malformed) when:
 * - the id part is non-numeric, non-integer, or not > 0;
 * - the schema part is empty (e.g. `":1234"`);
 * - there is more than one colon (e.g. `"a:b:1"`);
 * - the token is empty/whitespace.
 *
 * @param raw - A single token (already comma-split), possibly padded with space.
 * @returns The parsed {@link CompareId}, or `null` if malformed.
 */
export function parseCompareId(raw: string): CompareId | null {
	const token = raw.trim();
	if (token.length === 0) return null;

	const colonCount = (token.match(/:/g) ?? []).length;
	if (colonCount > 1) return null;

	if (colonCount === 1) {
		const idx = token.indexOf(":");
		const schema = token.slice(0, idx).trim();
		const idPart = token.slice(idx + 1).trim();
		if (schema.length === 0) return null;
		const id = parseId(idPart);
		if (id == null) return null;
		return { schema, id };
	}

	const id = parseId(token);
	if (id == null) return null;
	return { id };
}

/**
 * Parse and validate the numeric id portion of a token.
 *
 * @returns A positive integer, or `null` when non-numeric / non-integer / <= 0.
 */
function parseId(raw: string): number | null {
	if (raw.length === 0) return null;
	// Reject anything that isn't a plain non-negative integer literal so tokens
	// like "1.5", "1e3", "0x1", "  " or "12a" are treated as malformed.
	if (!/^\d+$/.test(raw)) return null;
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) return null;
	return n;
}

/**
 * Parse the full `?ids=` query value into an ordered list of {@link CompareId}s.
 *
 * The value is comma-split; each token is parsed with {@link parseCompareId} and
 * malformed tokens are silently DROPPED (they never produce an entry). Order is
 * preserved so the first surviving id remains the delta baseline. Duplicate ids
 * are kept (the caller keys them by serialized-id + index).
 *
 * @param param - The raw `?ids=` value, or `null`/`undefined` when absent.
 * @returns The parsed ids in order; `[]` when the param is empty or all-malformed.
 */
export function parseCompareIds(param: string | null | undefined): CompareId[] {
	if (!param) return [];
	const out: CompareId[] = [];
	for (const token of param.split(",")) {
		const parsed = parseCompareId(token);
		if (parsed != null) out.push(parsed);
	}
	return out;
}

/**
 * Serialize a {@link CompareId} back into its `?ids=` token form.
 *
 * Primary ids render as a bare number; secondary ids render as `schema:id`. This
 * round-trips with {@link parseCompareId} and is also used as a stable React
 * `key` for a compare column.
 *
 * @param c - The compare id to serialize.
 * @returns The token string (`"1234"` or `"alice:1234"`).
 */
export function serializeCompareId(c: CompareId): string {
	return c.schema ? `${c.schema}:${c.id}` : String(c.id);
}

/**
 * Ordered color palette for compare columns/tracks/markers.
 *
 * Index 0 is the compare-orange accent (matching the rest of the compare stack)
 * and index 1 is sky, preserving today's two-activity color pair exactly. The
 * remaining entries are chosen for contrast on the dark theme. Colors repeat
 * (modulo) beyond the palette length via {@link paletteColor}.
 */
export const COMPARE_PALETTE: readonly string[] = Object.freeze([
	"#f97316", // orange
	"#38bdf8", // sky
	"#4ade80", // green
	"#a78bfa", // purple
	"#facc15", // yellow
	"#f472b6", // pink
	"#2dd4bf", // teal
	"#fb7185", // rose
]);

/**
 * Resolve a stable color for the compare item at `index`, wrapping (modulo) once
 * the palette is exhausted so any N activities always get a color.
 *
 * @param index - Zero-based position of the activity in the compare list.
 * @returns A hex color string from {@link COMPARE_PALETTE}.
 */
export function paletteColor(index: number): string {
	const len = COMPARE_PALETTE.length;
	// Guard against negative/NaN indices defensively.
	const i = Number.isInteger(index) && index >= 0 ? index % len : 0;
	// biome-ignore lint/style/noNonNullAssertion: i is in [0, len) by construction.
	return COMPARE_PALETTE[i]!;
}
