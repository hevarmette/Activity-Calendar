import { MapContainer, TileLayer, Polyline } from "react-leaflet";
import type { RecordPoint, Session } from "@activity-calendar/shared";
import { SPORT_COLORS } from "@activity-calendar/shared";
import "leaflet/dist/leaflet.css";

interface Props {
	points: RecordPoint[];
	sessions?: Session[];
}

export function ActivityMap({ points, sessions }: Props) {
	if (points.length === 0) return null;

	const coords = points
		.filter((p) => p.latitude != null && p.longitude != null)
		.map((p) => [p.latitude!, p.longitude!] as [number, number]);

	if (coords.length === 0) return null;

	const bounds = coords.reduce(
		(acc, [lat, lng]) => ({
			minLat: Math.min(acc.minLat, lat),
			maxLat: Math.max(acc.maxLat, lat),
			minLng: Math.min(acc.minLng, lng),
			maxLng: Math.max(acc.maxLng, lng),
		}),
		{ minLat: coords[0]![0], maxLat: coords[0]![0], minLng: coords[0]![1], maxLng: coords[0]![1] },
	);

	const isMultisport = sessions && sessions.length > 1;

	return (
		<MapContainer
			bounds={[
				[bounds.minLat, bounds.minLng],
				[bounds.maxLat, bounds.maxLng],
			]}
			scrollWheelZoom={false}
			className="h-64 w-full rounded-lg"
		>
			<TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
			{isMultisport
				? sessions.map((session) => {
						const start = new Date(session.startTime).getTime();
						const end = start + (session.totalTimerTime ?? 0) * 1000;
						const segCoords = points
							.filter((p) => {
								const t = new Date(p.timestamp).getTime();
								return t >= start && t <= end && p.latitude != null && p.longitude != null;
							})
							.map((p) => [p.latitude!, p.longitude!] as [number, number]);
						const color = SPORT_COLORS[session.sport] ?? "#7F7F7F";
						return segCoords.length > 1 ? (
							<Polyline key={session.sessionId} positions={segCoords} pathOptions={{ color, weight: 4 }} />
						) : null;
					})
				: <Polyline positions={coords} pathOptions={{ color: "#FF4B4B", weight: 4 }} />}
		</MapContainer>
	);
}
