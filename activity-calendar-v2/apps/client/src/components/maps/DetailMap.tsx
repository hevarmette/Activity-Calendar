import { MapContainer, TileLayer, Polyline, Marker, CircleMarker, LayersControl, FeatureGroup } from "react-leaflet";
import L from "leaflet";
import type { RecordPoint, Session } from "@activity-calendar/shared";
import { SPORT_COLORS, AUTO_LAP_DISTANCES } from "@activity-calendar/shared";
import { SpeedColorLine } from "./SpeedColorLine.js";
import { LapMarkers } from "./LapMarkers.js";
import { MileMarkers } from "./MileMarkers.js";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

/**
 * Downsample an array of coordinates to at most `maxPoints` using uniform sampling.
 * Always preserves the first and last point for route continuity.
 */
function downsample(coords: [number, number][], maxPoints: number): [number, number][] {
	if (coords.length <= maxPoints) return coords;
	const step = (coords.length - 1) / (maxPoints - 1);
	const result: [number, number][] = [];
	for (let i = 0; i < maxPoints - 1; i++) {
		result.push(coords[Math.round(i * step)]!);
	}
	result.push(coords[coords.length - 1]!);
	return result;
}

interface Props {
	points: RecordPoint[];
	sport: string;
	sessions?: Session[];
	hoveredIndex?: number | null;
	/** Dynamic auto-lap distance in miles. Overrides the sport default when provided. */
	autoLapDist?: number | null;
	/** Optional selected range [startIndex, endIndex] to highlight on the map. */
	selectedRange?: [number, number] | null;
	/** Number of laps in the session. Controls default visibility of Laps vs Auto Mile Markers. */
	lapCount?: number;
}

export function DetailMap({ points, sport, sessions, hoveredIndex, autoLapDist: autoLapDistProp, selectedRange, lapCount }: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);

	const toggleFullscreen = useCallback(() => {
		if (!document.fullscreenElement) {
			containerRef.current?.requestFullscreen();
		} else {
			document.exitFullscreen();
		}
	}, []);

	useEffect(() => {
		const handler = () => setIsFullscreen(!!document.fullscreenElement);
		document.addEventListener("fullscreenchange", handler);
		return () => document.removeEventListener("fullscreenchange", handler);
	}, []);

	const coords = useMemo(
		() =>
			points
				.filter((p) => p.latitude != null && p.longitude != null)
				.map((p) => [p.latitude!, p.longitude!] as [number, number]),
		[points],
	);

	// Downsample polyline for rendering performance — keeps markers accurate on full coords
	const displayCoords = useMemo(() => downsample(coords, 1000), [coords]);

	if (coords.length < 2) return null;

	const bounds = L.latLngBounds(coords.map(([lat, lng]) => L.latLng(lat, lng)));
	const isMultisport = sessions && sessions.length > 1;
	const autoLapDist = autoLapDistProp ?? AUTO_LAP_DISTANCES[sport] ?? AUTO_LAP_DISTANCES["default"]!;

	// Determine default visibility for Laps vs Auto Mile Markers (matches Streamlit logic)
	const hasWatchLaps = lapCount != null && lapCount > 1;
	const showLapsByDefault = hasWatchLaps;
	const showAutoMilesByDefault = !hasWatchLaps;

	// Build highlighted segment coords from selectedRange
	const highlightCoords = useMemo(() => {
		if (!selectedRange) return null;
		const [startIdx, endIdx] = selectedRange;
		const seg = points
			.slice(startIdx, endIdx + 1)
			.filter((p) => p.latitude != null && p.longitude != null)
			.map((p) => [p.latitude!, p.longitude!] as [number, number]);
		return seg.length > 1 ? seg : null;
	}, [points, selectedRange]);

	return (
		<div ref={containerRef} className="relative h-full w-full">
			<button
				type="button"
				onClick={toggleFullscreen}
				aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
				className="absolute top-2 left-2 z-[1000] rounded-md bg-white border border-gray-300 shadow-md px-2 py-1.5 text-gray-700 hover:bg-gray-100 transition-colors text-sm leading-none"
			>
				{isFullscreen ? "⤓" : "⤢"}
			</button>
			<MapContainer bounds={bounds} scrollWheelZoom preferCanvas className={`${isFullscreen ? "h-full" : "h-[500px]"} w-full rounded-lg`}>
			<LayersControl position="topright">
				{/* ─── Base Layers ─── */}
				<LayersControl.BaseLayer checked name="OpenStreetMap">
					<TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
				</LayersControl.BaseLayer>
				<LayersControl.BaseLayer name="USGS Topo">
					<TileLayer url="https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}" />
				</LayersControl.BaseLayer>
				<LayersControl.BaseLayer name="Esri Satellite">
					<TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
				</LayersControl.BaseLayer>

				{/* ─── Route Overlays ─── */}
				{isMultisport ? (
					<>
						<LayersControl.Overlay checked name="Route by Sport">
							<FeatureGroup>
								{sessions.map((session) => {
									const start = new Date(session.startTime).getTime();
									const end = start + (session.totalTimerTime ?? 0) * 1000;
									const seg = points
										.filter((p) => {
											const t = new Date(p.timestamp).getTime();
											return t >= start && t <= end && p.latitude != null && p.longitude != null;
										})
										.map((p) => [p.latitude!, p.longitude!] as [number, number]);
									const displaySeg = downsample(seg, 1000);
									return displaySeg.length > 1 ? (
										<Polyline
											key={session.sessionId}
											positions={displaySeg}
											pathOptions={{ color: SPORT_COLORS[session.sport] ?? "#7F7F7F", weight: 5 }}
										/>
									) : null;
								})}
							</FeatureGroup>
						</LayersControl.Overlay>
						<LayersControl.Overlay name="Default Line Color">
							<FeatureGroup>
								<Polyline positions={displayCoords} pathOptions={{ color: "#FF4B4B", weight: 5 }} />
							</FeatureGroup>
						</LayersControl.Overlay>
					</>
				) : (
					<LayersControl.Overlay checked name="Default Line Color">
						<FeatureGroup>
							<Polyline positions={displayCoords} pathOptions={{ color: "#FF4B4B", weight: 5 }} />
						</FeatureGroup>
					</LayersControl.Overlay>
				)}

				{/* ─── Speed Color Overlay ─── */}
				<LayersControl.Overlay name="Speed">
					<SpeedColorLine points={points} />
				</LayersControl.Overlay>

				{/* ─── Lap Markers Overlay ─── */}
				<LayersControl.Overlay checked={showLapsByDefault} name="Laps">
					<LapMarkers points={points} />
				</LayersControl.Overlay>

				{/* ─── Auto Mile Markers Overlay ─── */}
				<LayersControl.Overlay checked={showAutoMilesByDefault} name="Auto Mile Markers">
					<MileMarkers points={points} interval={autoLapDist} />
				</LayersControl.Overlay>
			</LayersControl>

			{/* Start / End markers (always visible, not toggleable) */}
			<Marker position={coords[0]!} icon={startIcon} />
			<Marker position={coords[coords.length - 1]!} icon={endIcon} />

			{/* Highlighted range segment from chart selection */}
			{highlightCoords && (
				<Polyline
					positions={highlightCoords}
					pathOptions={{ color: "#f97316", weight: 6, opacity: 0.9 }}
				/>
			)}

			{/* Hovered point indicator */}
			{hoveredIndex != null && points[hoveredIndex]?.latitude != null && (
				<CircleMarker
					center={[points[hoveredIndex]!.latitude!, points[hoveredIndex]!.longitude!]}
					radius={6}
					pathOptions={{ color: "#f97316", fillColor: "#f97316", fillOpacity: 1, weight: 2 }}
				/>
			)}
		</MapContainer>
		</div>
	);
}
