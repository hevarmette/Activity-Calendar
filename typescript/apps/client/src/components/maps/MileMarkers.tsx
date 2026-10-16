import { METERS_PER_MILE } from "@activity-calendar/shared";
import type { RecordPoint } from "@activity-calendar/shared";
import L from "leaflet";
import type React from "react";
import { FeatureGroup, Marker, Tooltip } from "react-leaflet";

function mileIcon(num: number) {
	return L.divIcon({
		className: "",
		html: `<div style="background:#fff;color:#000;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;border:2px solid #666;">${num}</div>`,
		iconSize: [22, 22],
		iconAnchor: [11, 11],
	});
}

interface Props {
	points: RecordPoint[];
	interval: number;
}

/**
 * Renders auto mile markers at each interval along the route.
 * Returns a FeatureGroup so it can be used as a child of LayersControl.Overlay.
 */
export function MileMarkers({ points, interval }: Props) {
	const valid = points.filter((p) => p.latitude != null && p.longitude != null && p.distance != null);

	// Rebase cumulative distance to the first point of this segment. For multisport
	// legs the points carry whole-activity cumulative distance, so without this the
	// markers would be labeled by activity-wide distance (e.g. starting at mile 5 on
	// the run leg). Subtracting the base makes markers count from the leg start.
	const baseDist = valid.length > 0 ? valid[0]!.distance! : 0;

	const markers: React.ReactElement[] = [];
	if (valid.length > 0) {
		const relMax = valid[valid.length - 1]!.distance! - baseDist;
		const maxUnits = Math.floor(relMax / METERS_PER_MILE / interval);
		for (let unit = 1; unit <= maxUnits; unit++) {
			const targetDist = baseDist + unit * interval * METERS_PER_MILE;
			const point = valid.find((p) => p.distance! >= targetDist);
			if (!point) continue;
			markers.push(
				<Marker key={unit} position={[point.latitude!, point.longitude!]} icon={mileIcon(unit * interval)}>
					<Tooltip>Mile {unit * interval}</Tooltip>
				</Marker>,
			);
		}
	}

	return <FeatureGroup>{markers}</FeatureGroup>;
}
