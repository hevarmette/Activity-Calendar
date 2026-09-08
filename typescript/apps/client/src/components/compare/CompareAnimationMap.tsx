import L from "leaflet";
import { useMemo } from "react";
import { MapContainer, Marker, Polyline, TileLayer } from "react-leaflet";
import { type LatLngTime, downsample, interpolatePoint } from "../../lib/geo.js";
import "leaflet/dist/leaflet.css";

/** One activity's animated track on the shared compare map. */
export interface CompareTrack {
	/** Time-stamped GPS points for this activity. */
	track: LatLngTime[];
	/** Marker/polyline color (from the compare palette). */
	color: string;
	/** Display name (marker tooltip). */
	name: string;
	/** Start offset in seconds, subtracted from the shared clock for this track. */
	offset: number;
}

interface Props {
	/** All activities to overlay; each gets one polyline + one moving marker. */
	tracks: CompareTrack[];
	/** Shared playback clock in seconds (0-based). */
	clock: number;
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
 * Overlays N GPS tracks on a single react-leaflet map with one moving marker per
 * activity. Every marker is driven by a single shared clock (owned by the page);
 * each activity's marker position is interpolated at `clock + offset` along its
 * full track for smooth motion despite ~1 Hz records.
 *
 * Polylines are downsampled (max 1000 points) for render performance while the
 * markers interpolate against the full track — mirroring DetailMap's approach.
 * The map fits its bounds over every track's downsampled line.
 */
export function CompareAnimationMap({ tracks, clock }: Props) {
	// Downsample each track's polyline once per track change. `lines` stays index-
	// aligned with `tracks` so the bounds/render loops can zip the two together.
	const lines = useMemo(
		() =>
			tracks.map((t) =>
				downsample(
					t.track.map((p) => [p.lat, p.lng] as [number, number]),
					1000,
				),
			),
		[tracks],
	);

	const bounds = useMemo(() => {
		const all = lines.flat();
		if (all.length === 0) return null;
		return L.latLngBounds(all.map(([lat, lng]) => L.latLng(lat, lng)));
	}, [lines]);

	// One divIcon per color; memoized so panning/scrubbing doesn't rebuild icons.
	const icons = useMemo(() => tracks.map((t) => markerIcon(t.color)), [tracks]);

	if (!bounds) return null;

	return (
		<MapContainer bounds={bounds} scrollWheelZoom preferCanvas className="h-[500px] w-full rounded-lg">
			<TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
			{tracks.map((t, i) => {
				const line = lines[i] ?? [];
				return line.length > 1 ? (
					<Polyline
						// biome-ignore lint/suspicious/noArrayIndexKey: tracks are index-stable within a render pass.
						key={`line-${i}`}
						positions={line}
						pathOptions={{ color: t.color, weight: 4, opacity: 0.85 }}
					/>
				) : null;
			})}
			{tracks.map((t, i) => {
				const pos = interpolatePoint(t.track, clock + t.offset);
				return pos ? (
					<Marker
						// biome-ignore lint/suspicious/noArrayIndexKey: tracks are index-stable within a render pass.
						key={`marker-${i}`}
						position={pos}
						icon={icons[i] ?? markerIcon(t.color)}
						title={t.name}
					/>
				) : null;
			})}
		</MapContainer>
	);
}
