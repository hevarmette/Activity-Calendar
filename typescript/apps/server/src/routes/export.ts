/**
 * Export routes — reconstruct completed activities as Garmin .fit files.
 *
 * GET /api/activities/:id/export
 *   Response: Binary .fit file (application/octet-stream)
 *   Encodes a single activity from DB rows. Returns 404 if not found.
 *   Filename: "<date>_<name>_<activityId>.fit".
 *
 * POST /api/export
 *   Body: ActivityExportRequest JSON
 *   Response: Binary ZIP archive (application/zip) of one .fit per activity.
 *   Selection precedence: activityIds > text filters > { all: true }.
 *   Bounded by EXPORT_MAX_ACTIVITIES (default 500) unless `all` is set — over
 *   the cap returns 413. Empty match set returns 404. Per-activity encoding
 *   failures are skipped and recorded in an "_export_errors.txt" manifest
 *   inside the archive rather than aborting the whole export.
 *   Filename: "activities_export_<YYYYMMDD-HHmmss>.zip".
 */

import { zipSync } from "fflate";
import { Hono } from "hono";
import { z } from "zod";
import { fetchActivityFitInput, fetchActivityFitInputs, resolveExportIds } from "../lib/activity-data.js";
import { buildActivityFilename, encodeFitActivity } from "../lib/activity-fit.js";

export const exportRoutes = new Hono();

/** Max activities allowed in a single non-`all` export before returning 413. */
const EXPORT_MAX_ACTIVITIES = Number(process.env.EXPORT_MAX_ACTIVITIES) || 500;

const exportRequestSchema = z.object({
	all: z.boolean().optional(),
	activityIds: z.array(z.number().int().positive()).optional(),
	q: z.string().optional(),
	titleSearch: z.string().optional(),
	descriptionSearch: z.string().optional(),
});

/** Compact timestamp for archive filenames, e.g. "20260828-160540". */
function archiveTimestamp(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// --- GET /api/activities/:id/export — single activity ---
exportRoutes.get("/:id/export", async (c) => {
	const id = Number(c.req.param("id"));
	if (!Number.isFinite(id)) return c.json({ error: "Invalid activity id" }, 400);

	const input = await fetchActivityFitInput(id);
	if (!input) return c.json({ error: "Not found" }, 404);

	try {
		const bytes = encodeFitActivity(input);
		const filename = buildActivityFilename(input.activity);
		return new Response(bytes, {
			headers: {
				"Content-Type": "application/octet-stream",
				"Content-Disposition": `attachment; filename="${filename}"`,
				"Content-Length": String(bytes.byteLength),
			},
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown encoding error";
		return c.json({ error: "FIT encoding failed", details: message }, 500);
	}
});

// --- POST /api/export — subset / all activities as a ZIP ---
exportRoutes.post("/", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const parsed = exportRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid export request", details: parsed.error.flatten() }, 400);
	}
	const req = parsed.data;

	// Resolve the set of activity IDs to export following the documented
	// precedence: explicit ids > text filters > all.
	let ids: number[];
	if (req.activityIds && req.activityIds.length > 0) {
		ids = req.activityIds;
	} else if (req.q || req.titleSearch || req.descriptionSearch) {
		ids = await resolveExportIds({
			q: req.q,
			titleSearch: req.titleSearch,
			descriptionSearch: req.descriptionSearch,
		});
	} else if (req.all === true) {
		ids = await resolveExportIds({});
	} else {
		return c.json({ error: "No selection: provide activityIds, filters, or all: true" }, 400);
	}

	if (ids.length === 0) {
		return c.json({ error: "No activities matched" }, 404);
	}

	// Enforce the cap for non-`all` exports.
	if (req.all !== true && ids.length > EXPORT_MAX_ACTIVITIES) {
		return c.json(
			{
				error: `Too many activities (${ids.length}). Max ${EXPORT_MAX_ACTIVITIES} per export. Refine your selection.`,
			},
			413,
		);
	}

	try {
		const inputs = await fetchActivityFitInputs(ids);

		if (inputs.length === 0) {
			return c.json({ error: "No activities matched" }, 404);
		}

		const files: Record<string, Uint8Array> = {};
		const errors: string[] = [];
		const usedNames = new Set<string>();

		for (const input of inputs) {
			try {
				const bytes = encodeFitActivity(input);
				let name = buildActivityFilename(input.activity);
				// Guard against duplicate filenames within the archive.
				if (usedNames.has(name)) name = `${name.slice(0, -4)}_${input.activity.activityId}.fit`;
				usedNames.add(name);
				files[name] = bytes;
			} catch (err) {
				const message = err instanceof Error ? err.message : "Unknown encoding error";
				errors.push(`activity ${input.activity.activityId}: ${message}`);
			}
		}

		// Count successfully-encoded .fit files (excluding a manifest).
		const encodedCount = Object.keys(files).length;

		if (errors.length > 0) {
			files["_export_errors.txt"] = new TextEncoder().encode(
				`The following activities could not be encoded:\n\n${errors.join("\n")}\n`,
			);
		}

		// If every activity failed to encode, surface an error instead of a
		// zip containing only the manifest.
		if (encodedCount === 0) {
			return c.json({ error: "FIT encoding failed for all activities", details: errors }, 500);
		}

		const zipped = zipSync(files, { level: 6 });
		const filename = `activities_export_${archiveTimestamp()}.zip`;
		// Copy into a fresh ArrayBuffer-backed view for the Response body.
		const body = new Uint8Array(zipped);
		return new Response(body, {
			headers: {
				"Content-Type": "application/zip",
				"Content-Disposition": `attachment; filename="${filename}"`,
				"Content-Length": String(body.byteLength),
			},
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown export error";
		return c.json({ error: "Export failed", details: message }, 500);
	}
});
