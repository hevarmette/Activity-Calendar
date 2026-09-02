import L from "leaflet";
import { useMemo } from "react";
import { MapContainer, Marker, Polyline, TileLayer } from "react-leaflet";
import { type LatLngTime, downsample, interpolatePoint } from "../../lib/geo.js";
import "leaflet/dist/leaflet.css";

interface Props {
	trackA: LatLngTime[];
	trackB: LatLngTime[];
	colorA: string;
	colorB: string;
	/** Shared playback clock in seconds (0-based). */
	clock: number;
	/** Per-activity start offset in seconds, subtracted from the shared clock. */
	offsetA: number;
	offsetB: number;
	nameA: string;
	nameB: string;
}

/** Build a filled circular divIcon marker matching DetailMap's start/end style. */
function markerIcon(color: string): L.DivIcon {
	return L.divIcon({
		className: "",
		html: `<div style="background:${color};border-radius:50%;width:20px;height:20px;border:3px solid white;box-shadow:0 0 6px rgba(0,0,0,0.6);"></div>`,
		iconSize: [20, 20],
		iconAnchor: [10, 10],
	});
}

/**
 * Overlays two GPS tracks on a single react-leaflet map with a moving marker per
 * activity. Both markers are driven by a single shared clock (owned by the page);
 * each activity's marker position is interpolated at `clock + offset` along its
 * full track for smooth motion despite ~1 Hz records.
 *
 * Polylines are downsampled (max 1000 points) for render performance while the
 * markers interpolate against the full track — mirroring DetailMap's approach.
 */
export function CompareAnimationMap({ trackA, trackB, colorA, colorB, clock, offsetA, offsetB, nameA, nameB }: Props) {
	const lineA = useMemo(
		() =>
			downsample(
				trackA.map((p) => [p.lat, p.lng] as [number, number]),
				1000,
			),
		[trackA],
	);
	const lineB = useMemo(
		() =>
			downsample(
				trackB.map((p) => [p.lat, p.lng] as [number, number]),
				1000,
			),
		[trackB],
	);

	const bounds = useMemo(() => {
		const all = [...lineA, ...lineB];
		if (all.length === 0) return null;
		return L.latLngBounds(all.map(([lat, lng]) => L.latLng(lat, lng)));
	}, [lineA, lineB]);

	const posA = interpolatePoint(trackA, clock + offsetA);
	const posB = interpolatePoint(trackB, clock + offsetB);

	const iconA = useMemo(() => markerIcon(colorA), [colorA]);
	const iconB = useMemo(() => markerIcon(colorB), [colorB]);

	if (!bounds) return null;

	return (
		<MapContainer bounds={bounds} scrollWheelZoom preferCanvas className="h-[500px] w-full rounded-lg">
			<TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
			{lineA.length > 1 && <Polyline positions={lineA} pathOptions={{ color: colorA, weight: 4, opacity: 0.85 }} />}
			{lineB.length > 1 && <Polyline positions={lineB} pathOptions={{ color: colorB, weight: 4, opacity: 0.85 }} />}
			{posA && <Marker position={posA} icon={iconA} title={nameA} />}
			{posB && <Marker position={posB} icon={iconB} title={nameB} />}
		</MapContainer>
	);
}
