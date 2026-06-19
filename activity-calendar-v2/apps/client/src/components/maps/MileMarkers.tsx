import React from "react";
import { Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import { METERS_PER_MILE } from "@activity-calendar/shared";
import type { RecordPoint } from "@activity-calendar/shared";

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

export function MileMarkers({ points, interval }: Props) {
	const valid = points.filter((p) => p.latitude != null && p.longitude != null && p.distance != null);
	if (valid.length === 0) return null;

	const maxUnits = Math.floor((valid[valid.length - 1]!.distance! / METERS_PER_MILE) / interval);
	const markers: React.ReactElement[] = [];

	for (let unit = 1; unit <= maxUnits; unit++) {
		const targetDist = unit * interval * METERS_PER_MILE;
		const point = valid.find((p) => p.distance! >= targetDist);
		if (!point) continue;
		markers.push(
			<Marker key={unit} position={[point.latitude!, point.longitude!]} icon={mileIcon(unit * interval)}>
				<Tooltip>Mile {unit * interval}</Tooltip>
			</Marker>,
		);
	}

	return <>{markers}</>;
}
