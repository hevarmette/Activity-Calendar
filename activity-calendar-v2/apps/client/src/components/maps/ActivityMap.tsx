import { useEffect } from "react";
import { MapContainer, TileLayer, Polyline, useMap } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { RecordPoint, Session } from "@activity-calendar/shared";
import { SPORT_COLORS } from "@activity-calendar/shared";
import "leaflet/dist/leaflet.css";

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
	const map = useMap();
	useEffect(() => {
		setTimeout(() => {
			map.invalidateSize();
			map.fitBounds(bounds, { padding: [16, 16] });
		}, 100);
	}, [map, bounds]);
	return null;
}

interface Props {
	points: RecordPoint[];
	sessions?: Session[];
}

export function ActivityMap({ points, sessions }: Props) {
	const coords = points
		.filter((p) => p.latitude != null && p.longitude != null)
		.map((p) => [p.latitude!, p.longitude!] as [number, number]);

	if (coords.length === 0) return null;

	const lats = coords.map(([lat]) => lat);
	const lngs = coords.map(([, lng]) => lng);
	const bounds: [[number, number], [number, number]] = [
		[Math.min(...lats), Math.min(...lngs)],
		[Math.max(...lats), Math.max(...lngs)],
	];

	const isMultisport = sessions && sessions.length > 1;

	return (
		<MapContainer
			bounds={bounds}
			boundsOptions={{ padding: [16, 16] }}
			scrollWheelZoom={true}
			zoomControl={true}
			style={{ height: "100%", width: "100%" }}
		>
			<TileLayer
				url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
				attribution='© <a href="https://openstreetmap.org">OpenStreetMap</a>'
			/>
			<FitBounds bounds={bounds} />
			{isMultisport
				? sessions.map((session) => {
						const start = new Date(session.startTime).getTime();
						const end = start + (session.totalTimerTime ?? 0) * 1000;
						const segCoords = points
							.filter((p) => {
								const t = new Date(p.timestamp).getTime();
								return (
									t >= start &&
									t <= end &&
									p.latitude != null &&
									p.longitude != null
								);
							})
							.map((p) => [p.latitude!, p.longitude!] as [number, number]);
						const color = SPORT_COLORS[session.sport] ?? "#7F7F7F";
						return segCoords.length > 1 ? (
							<Polyline
								key={session.sessionId}
								positions={segCoords}
								pathOptions={{ color, weight: 4 }}
							/>
						) : null;
					})
				: <Polyline positions={coords} pathOptions={{ color: "#FF4B4B", weight: 4 }} />}
		</MapContainer>
	);
}
