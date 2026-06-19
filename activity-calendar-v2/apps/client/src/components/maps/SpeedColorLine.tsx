import React from "react";
import { Polyline } from "react-leaflet";
import type { RecordPoint } from "@activity-calendar/shared";

interface Props {
	points: RecordPoint[];
}

function speedToColor(speed: number, min: number, max: number): string {
	const t = max > min ? (speed - min) / (max - min) : 0;
	const h = (1 - t) * 240;
	return `hsl(${h}, 80%, 50%)`;
}

export function SpeedColorLine({ points }: Props) {
	const valid = points.filter((p) => p.latitude != null && p.longitude != null && p.enhancedSpeed != null);
	if (valid.length < 2) return null;

	const speeds = valid.map((p) => p.enhancedSpeed!);
	const min = Math.min(...speeds);
	const max = Math.max(...speeds);

	const segments: React.ReactElement[] = [];
	for (let i = 0; i < valid.length - 1; i++) {
		const p1 = valid[i]!;
		const p2 = valid[i + 1]!;
		const color = speedToColor(p1.enhancedSpeed!, min, max);
		segments.push(
			<Polyline
				key={i}
				positions={[
					[p1.latitude!, p1.longitude!],
					[p2.latitude!, p2.longitude!],
				]}
				pathOptions={{ color, weight: 5, opacity: 0.9 }}
			/>,
		);
	}

	return <>{segments}</>;
}
