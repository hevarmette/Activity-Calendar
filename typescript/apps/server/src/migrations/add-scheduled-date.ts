/**
 * Migration: Add scheduled_date column to the workout table.
 *
 * This allows workouts to be scheduled on specific calendar dates.
 * Uses IF NOT EXISTS to make the migration idempotent (safe to re-run).
 */
import type postgres from "postgres";

export async function runMigrations(db: postgres.Sql, schema: string): Promise<void> {
	await db.unsafe(`ALTER TABLE ${schema}.workout ADD COLUMN IF NOT EXISTS scheduled_date DATE`);
}
