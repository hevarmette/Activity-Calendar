import { MapContainer, TileLayer, Polyline, Marker, CircleMarker, LayersControl } from "react-leaflet";
import L from "leaflet";
import type { RecordPoint, Session } from "@activity-calendar/shared";
import { SPORT_COLORS, AUTO_LAP_DISTANCES } from "@activity-calendar/shared";
import { SpeedColorLine } from "./SpeedColorLine.js";
import { LapMarkers } from "./LapMarkers.js";
import { MileMarkers } from "./MileMarkers.js";
import "leaflet/dist/leaflet.css";

const startIcon = L.divIcon({
	className: "",
	html: `<div style="background:#1EB300;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:3px solid #1EB300;color:white;font-size:14px;">▶</div>`,
	iconSize: [28, 28],
	iconAnchor: [14, 14],
});

const endIcon = L.divIcon({
	className: "",
	html: `<div style="background:#e53e3e;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:3px solid #e53e3e;color:white;font-size:14px;">■</div>`,
	iconSize: [28, 28],
	iconAnchor: [14, 14],
});

interface Props {
	points: RecordPoint[];
	sport: string;
	sessions?: Session[];
	hoveredIndex?: number | null;
}

export function DetailMap({ points, sport, sessions, hoveredIndex }: Props) {
	const coords = points
		.filter((p) => p.latitude != null && p.longitude != null)
		.map((p) => [p.latitude!, p.longitude!] as [number, number]);

	if (coords.length < 2) return null;

	const bounds = L.latLngBounds(coords.map(([lat, lng]) => L.latLng(lat, lng)));
	const isMultisport = sessions && sessions.length > 1;
	const autoLapDist = AUTO_LAP_DISTANCES[sport] ?? AUTO_LAP_DISTANCES["default"]!;

	return (
		<MapContainer bounds={bounds} scrollWheelZoom className="h-[500px] w-full rounded-lg">
			<LayersControl position="topright">
				<LayersControl.BaseLayer checked name="OpenStreetMap">
					<TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
				</LayersControl.BaseLayer>
				<LayersControl.BaseLayer name="Esri Satellite">
					<TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
				</LayersControl.BaseLayer>

				{isMultisport ? (
					<LayersControl.Overlay checked name="Route by Sport">
						<>
							{sessions.map((session) => {
								const start = new Date(session.startTime).getTime();
								const end = start + (session.totalTimerTime ?? 0) * 1000;
								const seg = points
									.filter((p) => {
										const t = new Date(p.timestamp).getTime();
										return t >= start && t <= end && p.latitude != null && p.longitude != null;
									})
									.map((p) => [p.latitude!, p.longitude!] as [number, number]);
								return seg.length > 1 ? (
									<Polyline
										key={session.sessionId}
										positions={seg}
										pathOptions={{ color: SPORT_COLORS[session.sport] ?? "#7F7F7F", weight: 5 }}
									/>
								) : null;
							})}
						</>
					</LayersControl.Overlay>
				) : (
					<LayersControl.Overlay checked name="Route">
						<Polyline positions={coords} pathOptions={{ color: "#FF4B4B", weight: 5 }} />
					</LayersControl.Overlay>
				)}

				<LayersControl.Overlay name="Speed">
					<SpeedColorLine points={points} />
				</LayersControl.Overlay>
			</LayersControl>

			<LapMarkers points={points} />
			<MileMarkers points={points} interval={autoLapDist} />

			<Marker position={coords[0]!} icon={startIcon} />
			<Marker position={coords[coords.length - 1]!} icon={endIcon} />

			{hoveredIndex != null && points[hoveredIndex]?.latitude != null && (
				<CircleMarker
					center={[points[hoveredIndex]!.latitude!, points[hoveredIndex]!.longitude!]}
					radius={6}
					pathOptions={{ color: "#f97316", fillColor: "#f97316", fillOpacity: 1, weight: 2 }}
				/>
			)}
		</MapContainer>
	);
}
