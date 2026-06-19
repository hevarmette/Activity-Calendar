import React from "react";
import { Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import type { RecordPoint } from "@activity-calendar/shared";

function numberedIcon(num: number) {
	return L.divIcon({
		className: "",
		html: `<div style="background:#fff;color:#000;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;border:2px solid #333;">${num}</div>`,
		iconSize: [24, 24],
		iconAnchor: [12, 12],
	});
}

interface Props {
	points: RecordPoint[];
}

export function LapMarkers({ points }: Props) {
	if (points.length === 0) return null;

	const maxLap = points[points.length - 1]!.lap;
	const uniqueLaps = new Set(points.map((p) => p.lap));
	if (uniqueLaps.size <= 1) return null;

	const markers: React.ReactElement[] = [];
	for (let lapNum = 2; lapNum <= maxLap; lapNum++) {
		const first = points.find((p) => p.lap === lapNum);
		if (!first || first.latitude == null || first.longitude == null) continue;
		markers.push(
			<Marker key={lapNum} position={[first.latitude, first.longitude]} icon={numberedIcon(lapNum - 1)}>
				<Tooltip>Lap {lapNum - 1}</Tooltip>
			</Marker>,
		);
	}

	return <>{markers}</>;
}
