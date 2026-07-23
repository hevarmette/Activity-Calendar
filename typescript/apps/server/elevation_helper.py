#!/usr/bin/env python3
"""
Elevation helper for the Activity Calendar v2 server.

Reads a JSON array of [lat, lon] pairs from stdin and writes a JSON array
of elevations (in meters) to stdout.

Uses SRTM3 .hgt files from terrain.ardupilot.org with local caching.
This replaces direct use of pyhigh which has a broken download URL
(firmware.ardupilot.org now returns HTML instead of zip files).

Usage:
    echo '[[36.52, -118.67], [36.62, -118.77]]' | python3 elevation_helper.py

Requirements:
    pip install numpy requests
"""

import json
import sys
import zipfile
from math import floor
from pathlib import Path

import numpy as np
import requests

# Cache directory for downloaded .hgt files
CACHE_DIR = Path(__file__).resolve().parent / ".elevation-cache-srtm"

BASE_URL = "https://terrain.ardupilot.org/SRTM3"

# SRTM3 region boundaries (approximate lat/lon ranges)
REGIONS = [
    ("North_America", 15, 85, -180, -10),
    ("South_America", -60, 15, -93, -30),
    ("Africa", -40, 40, -20, 55),
    ("Eurasia", 0, 85, -15, 180),
    ("Australia", -50, 0, 100, 180),
    ("Islands", -90, 90, -180, 180),  # fallback
]


def get_hgt_name(lat_int: int, lon_int: int) -> str:
    """Build the .hgt filename from integer lat/lon."""
    lat_prefix = "N" if lat_int >= 0 else "S"
    lon_prefix = "E" if lon_int >= 0 else "W"
    return f"{lat_prefix}{abs(lat_int):02d}{lon_prefix}{abs(lon_int):03d}.hgt"


def get_zip_name(lat_int: int, lon_int: int) -> str:
    """Build the .hgt.zip filename (SRTM3 uses .hgt.zip for lat <= 54)."""
    hgt_name = get_hgt_name(lat_int, lon_int)
    # SRTM3 on terrain.ardupilot.org uses .hgt.zip naming
    return hgt_name + ".zip"


def get_region(lat_int: int, lon_int: int) -> str:
    """Determine which SRTM region directory contains this tile."""
    for region, lat_min, lat_max, lon_min, lon_max in REGIONS:
        if lat_min <= lat_int <= lat_max and lon_min <= lon_int <= lon_max:
            return region
    return "North_America"  # fallback


def download_hgt(lat_int: int, lon_int: int) -> Path:
    """Download and extract an SRTM .hgt file, returning the path to the .hgt file."""
    hgt_name = get_hgt_name(lat_int, lon_int)
    hgt_path = CACHE_DIR / hgt_name

    if hgt_path.is_file():
        return hgt_path

    CACHE_DIR.mkdir(exist_ok=True, parents=True)

    zip_name = get_zip_name(lat_int, lon_int)
    region = get_region(lat_int, lon_int)

    # Try the determined region first, then fall back to others
    regions_to_try = [region] + [r for r, *_ in REGIONS if r != region]

    for try_region in regions_to_try:
        url = f"{BASE_URL}/{try_region}/{zip_name}"
        try:
            resp = requests.get(url, timeout=30, headers={
                "User-Agent": "ActivityCalendar/2.0 elevation-helper"
            })

            if resp.status_code != 200:
                continue

            # Validate it's actually a zip file (zip magic bytes: PK\x03\x04)
            if not resp.content[:4].startswith(b"PK"):
                continue

            # Save and extract
            zip_path = CACHE_DIR / zip_name
            zip_path.write_bytes(resp.content)

            try:
                with zipfile.ZipFile(zip_path, "r") as zf:
                    zf.extractall(CACHE_DIR)
                zip_path.unlink()
            except zipfile.BadZipFile:
                zip_path.unlink(missing_ok=True)
                continue

            if hgt_path.is_file():
                return hgt_path

        except requests.RequestException:
            continue

    raise FileNotFoundError(
        f"Could not download SRTM tile {hgt_name} from any region"
    )


def read_elevation_from_file(hgt_file: Path, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """Read elevation values from an SRTM3 .hgt file at given coordinates."""
    samples = 1201  # SRTM3

    with open(hgt_file, "rb") as f:
        elevations = np.fromfile(f, np.dtype(">i2"), samples * samples).reshape(
            (samples, samples)
        )

    lat_rows = np.round((lats - np.floor(lats)) * (samples - 1)).astype(int)
    lon_cols = np.round((lons - np.floor(lons)) * (samples - 1)).astype(int)

    return elevations[samples - 1 - lat_rows, lon_cols].astype(int)


def smooth_elevations(elevations: np.ndarray, window: int = 5) -> np.ndarray:
    """
    Apply a moving average to smooth SRTM elevation noise.

    SRTM3 has ~1-3m vertical noise between adjacent samples. Over a typical
    activity with 1000+ GPS points, this noise accumulates into hundreds of
    feet of false ascent/descent. A small moving average (window=5) removes
    this noise while preserving real terrain features.

    Uses edge-padding to avoid shrinking the output array.
    """
    if len(elevations) < window:
        return elevations

    kernel = np.ones(window) / window
    # Pad edges to preserve array length and avoid boundary artifacts
    pad = window // 2
    padded = np.pad(elevations, pad, mode="edge")
    smoothed = np.convolve(padded, kernel, mode="valid")
    return smoothed


def get_elevation_batch(lat_lon_list: list) -> list:
    """Get elevations for a list of (lat, lon) pairs. Returns list of floats (meters)."""
    if not lat_lon_list:
        return []

    # Group coordinates by tile
    tile_groups: dict[tuple[int, int], tuple[list, list, list]] = {}
    for idx, (lat, lon) in enumerate(lat_lon_list):
        key = (int(floor(lat)), int(floor(lon)))
        if key not in tile_groups:
            tile_groups[key] = ([], [], [])
        tile_groups[key][0].append(idx)
        tile_groups[key][1].append(lat)
        tile_groups[key][2].append(lon)

    result = np.zeros(len(lat_lon_list))

    for (lat_int, lon_int), (indices, lats, lons) in tile_groups.items():
        hgt_path = download_hgt(lat_int, lon_int)
        data = read_elevation_from_file(
            hgt_path, np.array(lats), np.array(lons)
        )
        result[indices] = data

    # Smooth the elevation profile to reduce SRTM noise
    result = smooth_elevations(result)

    return result.tolist()


def main():
    try:
        raw = sys.stdin.read()
        coordinates = json.loads(raw)

        if not coordinates:
            print(json.dumps([]))
            return

        elevations = get_elevation_batch(coordinates)
        print(json.dumps(elevations))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
