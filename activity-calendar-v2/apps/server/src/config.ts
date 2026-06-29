/**
 * Server configuration constants loaded from environment variables.
 * All values have sensible defaults for local development.
 */

/** IANA timezone used for converting UTC timestamps to local time in SQL queries. */
export const TIMEZONE = process.env.TIMEZONE || "America/Chicago";
