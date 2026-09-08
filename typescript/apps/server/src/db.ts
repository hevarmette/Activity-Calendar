import postgres from "postgres";

const sql = postgres({
	host: process.env.DB_HOST || "localhost",
	port: Number(process.env.DB_PORT) || 5432,
	database: process.env.DB_NAME || "postgres",
	username: process.env.DB_USER || "postgres",
	password: process.env.DB_PASSWORD || "",
	max: 10,
	idle_timeout: 20,
	transform: {
	  column: { from: postgres.toCamel },
	},
});

export const SCHEMA = process.env.DB_SCHEMA || "public";

/**
 * Additional schemas that read-only routes are allowed to target via the
 * optional `?schema=` query parameter (Feature #6 — cross-schema comparison).
 *
 * Parsed from the comma-separated `DB_COMPARE_SCHEMAS` env var: each entry is
 * trimmed, empty entries are dropped, and the primary {@link SCHEMA} is excluded
 * (it is always readable without opting in). The result is frozen so the
 * allowlist cannot be mutated at runtime.
 */
export const COMPARE_SCHEMAS: readonly string[] = Object.freeze(
	(process.env.DB_COMPARE_SCHEMAS || "")
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && s !== SCHEMA)
		// De-duplicate while preserving order.
		.filter((s, i, arr) => arr.indexOf(s) === i),
);

/**
 * Set of every schema name a read route may resolve to: the primary
 * {@link SCHEMA} plus each entry in {@link COMPARE_SCHEMAS}.
 */
const READ_SCHEMA_ALLOWLIST: ReadonlySet<string> = new Set([SCHEMA, ...COMPARE_SCHEMAS]);

/**
 * Thrown when a requested schema name is not part of the read allowlist.
 *
 * Carries the offending {@link schemaName} so route handlers can surface a
 * precise `400` response to the client.
 */
export class UnknownSchemaError extends Error {
	/** The schema name that was requested but not allowlisted. */
	readonly schemaName: string;

	constructor(schemaName: string) {
		super(`Unknown schema '${schemaName}'`);
		this.name = "UnknownSchemaError";
		this.schemaName = schemaName;
	}
}

/**
 * Resolve the schema a read-only route should query.
 *
 * - `undefined` or empty input → the primary {@link SCHEMA}.
 * - A value present in the read allowlist → that value.
 * - Anything else → throws {@link UnknownSchemaError}.
 *
 * Although `sql()` already escapes identifiers (so this is not an injection
 * guard), we still validate the requested name against the explicit allowlist
 * so that a caller can only reach schemas the operator has intentionally
 * exposed via `DB_COMPARE_SCHEMAS` — never an arbitrary schema that happens to
 * exist in the database.
 *
 * @param requested - The raw `?schema=` query value, if any.
 * @returns The resolved, allowlisted schema name.
 * @throws {UnknownSchemaError} If `requested` is non-empty and not allowlisted.
 */
export function resolveReadSchema(requested?: string): string {
	if (requested === undefined || requested === "") return SCHEMA;
	if (READ_SCHEMA_ALLOWLIST.has(requested)) return requested;
	throw new UnknownSchemaError(requested);
}

export default sql;
