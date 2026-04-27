import pandas as pd
from streamlit import session_state as ss
from utils import format_pace, convert_seconds_to_hms, parse_hms_to_seconds
import numpy as np

# Keys = Database Column Names
# Values = UI Display Names
LAP_COLUMN_MAPPING = {
    "lap_id": "Lap Id",
    "activity_id": "Activity Id",
    "start_time": "Start Time",
    "number": "Lap",
    "total_distance": "Distance",
    "total_timer_time": "Time",
    "total_ascent": "Total Ascent",
    "total_descent": "Total Descent",
    "avg_vertical_oscillation": "Avg Vertical Oscillation",
    "avg_stance_time": "Avg Stance Time",
    "avg_vertical_ratio": "Avg Vertical Ratio",
    "avg_stance_time_balance": "Avg Stance Time Balance",
    "avg_step_length": "Avg Stride Length",
    "avg_running_cadence": "Avg Running Cadence",
    "max_heart_rate": "Max Heart Rate",
    "avg_heart_rate": "Avg Heart Rate",
    "intensity": "Intensity",
    "distance_mi": "Distance (miles)",
    "time_formatted": "Time (formatted)",
}
# Create a reverse map for fast lookups: { 'Avg Heart Rate': 'avg_heart_rate' }
UI_TO_DB_MAP = {v: k for k, v in LAP_COLUMN_MAPPING.items()}


# --- 2. DATA PROCESSING FUNCTION ---
def process_lap_data(df):
    """Applies all the transformations from your original code."""
    if df.empty:
        return pd.DataFrame()

    # Rename columns to be more user-friendly for the editor
    df = df.rename(columns=LAP_COLUMN_MAPPING)

    # Calculate pace only where distance is not zero
    non_zero_dist = df["Distance"] > 0
    df["Pace (min/mile) unformatted"] = None
    df.loc[non_zero_dist, "Pace (min/mile) unformatted"] = (df["Time"] / 60) / df[
        "Distance (miles)"
    ]
    df["Pace (min/mile)"] = df["Pace (min/mile) unformatted"].apply(format_pace)

    df["Time (formatted)"] = df["Time"].apply(convert_seconds_to_hms)

    # Cumulative columns
    df["Cumulative Distance"] = df["Distance (miles)"].cumsum()
    df["Cumulative Time"] = df["Time"].cumsum().apply(convert_seconds_to_hms)

    # Select and reorder columns for display
    display_cols = [
        "Lap",
        "Distance (miles)",
        "Time (formatted)",
        "Pace (min/mile)",
        "Cumulative Distance",
        "Cumulative Time",
        "Avg Heart Rate",
        "Max Heart Rate",
        "Total Ascent",
        "Total Descent",
        "Avg Vertical Oscillation",
        "Avg Stance Time",
        "Avg Vertical Ratio",
        "Avg Stance Time Balance",
        "Intensity",
        "Pace (min/mile) unformatted",
    ]

    # Keep original IDs for updates, but don't show them by default
    df_display = df[
        ["Lap Id", "Activity Id"] + [col for col in display_cols if col in df.columns]
    ]

    return df_display


def process_cycling_laps(df):
    """Processes lap data with cycling-specific metrics like speed and HR."""
    if df.empty:
        return pd.DataFrame()

    # --- Distance ---
    df["Distance (miles)"] = round(df["total_distance"] / ss.meters_to_miles, 2)

    # --- Time ---
    df["Time (formatted)"] = df["total_timer_time"].apply(convert_seconds_to_hms)

    # --- Average Speed in MPH ---
    non_zero_time = df["total_timer_time"] > 0
    df["Avg Speed (mph)"] = None
    df.loc[non_zero_time, "Avg Speed (mph)"] = round(
        df.loc[non_zero_time, "Distance (miles)"]
        / (df.loc[non_zero_time, "total_timer_time"] / 3600),
        1,
    )

    # --- Heart Rate ---
    if "avg_heart_rate" in df.columns:
        df["Avg Heart Rate"] = df["avg_heart_rate"]
    if "max_heart_rate" in df.columns:
        df["Max Heart Rate"] = df["max_heart_rate"]

    # --- Elevation ---
    if "total_ascent" in df.columns:
        df["Total Ascent"] = df["total_ascent"]
    if "total_descent" in df.columns:
        df["Total Descent"] = df["total_descent"]

    # --- Lap number and intensity ---
    df["Lap"] = df["number"] # instead of making a new column, why not just use config dictionary to rename? 
    df["Intensity"] = df["intensity"] if "intensity" in df.columns else None

    # --- Cumulative columns ---
    df["Cumulative Distance"] = df["Distance (miles)"].cumsum()
    df["Cumulative Time"] = df["total_timer_time"].cumsum().apply(convert_seconds_to_hms)

    # Define columns relevant to cycling
    display_cols = [
        "Lap",
        "Distance (miles)",
        "Time (formatted)",
        "Avg Speed (mph)",
        "avg_power",
        "max_power",
        "Cumulative Distance",
        "Cumulative Time",
        "Avg Heart Rate",
        "Max Heart Rate",
        "Total Ascent",
        "Total Descent",
        "Intensity",
    ]

    df_display = df[["lap_id"] + [col for col in display_cols if col in df.columns]]
    df_display = df_display.rename(columns={"lap_id": "Lap Id"})
    return df_display


def create_auto_laps(points_df, events_df=None, auto_lap_dist=1.0):
    """
    Create a new dataframe with laps at the defined auto_lap_dist argument. Event and point dfs are sorted when queried and original dataframes are not altered

    :param points_df pandas.DataFrame: GPS coordinates; matches record FIT Frame
    :param events_df pandas.DataFrame: Event log during activity; matches event FIT Frame
    :param auto_lap_dist float: distance in miles to create laps for
    """
    if not ss.coordinates:
        return pd.DataFrame()

    points_df = points_df.copy()

    # 1. Calculate the time difference and distance difference
    points_df["time_diff"] = points_df["timestamp"].diff().dt.total_seconds().fillna(0)
    if events_df is not None and not events_df.empty:
        timer_events = events_df[events_df["event"] == "timer"]

        # Create boolean masks for stops and starts
        is_stop = timer_events["event_type"] == "stop_all"
        is_start = timer_events["event_type"] == "start"

        stops = timer_events.loc[is_stop, "timestamp"].reset_index(drop=True)

        if not stops.empty:
            # Filter starts to only those that happen AFTER the very first stop
            # (This ignores the initial 'start' event at the beginning of the activity)
            starts = timer_events.loc[
                is_start & (timer_events["timestamp"] > stops.iloc[0]), "timestamp"
            ].reset_index(drop=True)

            # Align lengths in case the activity ended on a 'stop_all' without resuming
            pair_count = min(len(stops), len(starts))

            # Create a dataframe of the exact pause intervals
            pauses_df = pd.DataFrame(
                {
                    "pause_end": starts.iloc[:pair_count],
                    "duration": (
                        starts.iloc[:pair_count] - stops.iloc[:pair_count]
                    ).dt.total_seconds(),
                }
            )

            # Filter out any weird negative/zero durations just in case
            pauses_df = pauses_df[pauses_df["duration"] > 0]

            if not pauses_df.empty:
                # Use merge_asof to match each pause to the FIRST gps point that occurs AFTER the pause ends
                # This requires both dataframes to be sorted by the timestamp
                points_subset = points_df[["timestamp"]].reset_index()
                pauses_df = pauses_df.sort_values("pause_end")

                matched = pd.merge_asof(
                    pauses_df,
                    points_subset,
                    left_on="pause_end",
                    right_on="timestamp",
                    direction="forward",  # Matches to the next available timestamp in points_df
                )

                # If multiple pauses happened before a single GPS point, group them by index and sum the durations
                pause_adjustments = matched.groupby("index")["duration"].sum()

                # Subtract the paused time from the identified points
                points_df.loc[
                    pause_adjustments.index, "time_diff"
                ] -= pause_adjustments.values

                # Ensure no time diffs drop below 0 due to precision issues
                points_df["time_diff"] = points_df["time_diff"].clip(lower=0)

    points_df["dist_diff_meters"] = points_df["distance"].diff().fillna(0)

    # 2. Identify "Stopped" time
    # The speed-based filter below zeros out moving_seconds for points where
    # segment speed falls below STOP_THRESHOLD_MPS, excluding near-stationary
    # time (e.g., waiting at a light) from auto lap split times and pace.
    # Disabled so that only explicit device pauses (handled above) are removed.
    # STOP_THRESHOLD_MPS = 0.00001
    # points_df["segment_speed"] = 0.0
    # mask_moving = points_df["time_diff"] > 0
    # points_df.loc[mask_moving, "segment_speed"] = (
    #     points_df.loc[mask_moving, "dist_diff_meters"]
    #     / points_df.loc[mask_moving, "time_diff"]
    # )

    points_df["moving_seconds"] = points_df["time_diff"]
    # points_df.loc[points_df["segment_speed"] < STOP_THRESHOLD_MPS, "moving_seconds"] = 0

    # Calculate Deltas for altitude
    points_df["alt_diff"] = pd.to_numeric(points_df["corrected_altitude"], errors="coerce").diff().fillna(0)
    points_df["ascent_ft"] = points_df["alt_diff"].clip(lower=0)
    points_df["descent_ft"] = points_df["alt_diff"].clip(upper=0).abs()

    # ---------------------------------------------------------
    # INTERPOLATION LOGIC
    # ---------------------------------------------------------
    points_df["dist_miles_cumulative"] = points_df["distance"] / ss.meters_to_miles

    # Calculate cumulative metrics for interpolation
    points_df["cum_moving_seconds"] = points_df["moving_seconds"].cumsum()
    points_df["cum_ascent"] = points_df["ascent_ft"].cumsum()
    points_df["cum_descent"] = points_df["descent_ft"].cumsum()

    max_dist = points_df["dist_miles_cumulative"].max()
    if pd.isna(max_dist) or max_dist == 0:
        return pd.DataFrame()

    # Define exact lap boundaries (e.g., [0.0, 1.0, 2.0, 3.0, 3.45])
    lap_boundaries = np.arange(auto_lap_dist, max_dist, auto_lap_dist).tolist()
    if max_dist > (lap_boundaries[-1] if lap_boundaries else 0):
        lap_boundaries.append(max_dist)
    target_dists = [0.0] + lap_boundaries

    # To use np.interp, the x-axis (distance) must be strictly increasing.
    # We drop duplicates to handle "standing still" data points cleanly.
    interp_df = points_df.drop_duplicates(
        subset=["dist_miles_cumulative"], keep="first"
    )
    xp = interp_df["dist_miles_cumulative"].values

    # Interpolate exact cumulative values at the precise mile markers
    interp_times = np.interp(target_dists, xp, interp_df["cum_moving_seconds"].values)
    interp_ascent = np.interp(target_dists, xp, interp_df["cum_ascent"].values)
    interp_descent = np.interp(target_dists, xp, interp_df["cum_descent"].values)

    # Build the laps by taking the difference between the interpolated boundaries
    laps_data = []
    for i in range(1, len(target_dists)):
        laps_data.append(
            {
                "Lap": i,
                "Distance (miles)": target_dists[i] - target_dists[i - 1],
                "seconds_raw": interp_times[i] - interp_times[i - 1],
                "Total Ascent (ft)": interp_ascent[i] - interp_ascent[i - 1],
                "Total Descent (ft)": interp_descent[i] - interp_descent[i - 1],
            }
        )
    laps_df = pd.DataFrame(laps_data)

    # ---------------------------------------------------------
    # HR & CADENCE LOGIC (Binning original points)
    # ---------------------------------------------------------
    # Assign each raw GPS point to an exact lap using pd.cut
    points_df["exact_lap_no"] = pd.cut(
        points_df["dist_miles_cumulative"],
        bins=target_dists,
        labels=range(1, len(target_dists)),
        include_lowest=True,
    )

    agg_dict = {}
    if ss.hr and points_df["heart_rate"].notna().any():
        agg_dict["heart_rate"] = ["mean", "max"]
    if ss.cadence and points_df["total_cadence"].notna().any():
        agg_dict["total_cadence"] = ["mean", "max"]

    # Speed in m/s — always aggregate for cycling auto laps
    if (
        "enhanced_speed" in points_df.columns
        and points_df["enhanced_speed"].notna().any()
    ):
        agg_dict["enhanced_speed"] = ["mean", "max"]

    if agg_dict:
        laps_grouped = points_df.groupby("exact_lap_no", observed=True).agg(agg_dict)
        laps_grouped.index = laps_grouped.index.astype(int)

        if "heart_rate" in agg_dict:
            # Force numeric, turning any weird values or empty bins into safe NaNs
            hr_mean = pd.to_numeric(laps_grouped["heart_rate"]["mean"], errors="coerce")
            hr_max = pd.to_numeric(laps_grouped["heart_rate"]["max"], errors="coerce")
            laps_df["Avg HR"] = hr_mean.round(0).values
            laps_df["Max HR"] = hr_max.values

        if "total_cadence" in agg_dict:
            # Force numeric here as well
            cad_mean = pd.to_numeric(
                laps_grouped["total_cadence"]["mean"], errors="coerce"
            )
            cad_max = pd.to_numeric(
                laps_grouped["total_cadence"]["max"], errors="coerce"
            )
            laps_df["Avg Cadence"] = cad_mean.round(0).values
            laps_df["Max Cadence"] = cad_max.values

        if "enhanced_speed" in agg_dict:
            spd_mean = pd.to_numeric(
                laps_grouped["enhanced_speed"]["mean"], errors="coerce"
            )
            spd_max = pd.to_numeric(
                laps_grouped["enhanced_speed"]["max"], errors="coerce"
            )
            # Convert m/s -> mph
            laps_df["Avg Speed (mph)"] = (spd_mean * 2.23694).round(1).values
            laps_df["Max Speed (mph)"] = (spd_max * 2.23694).round(1).values

    # ---------------------------------------------------------
    # FORMATTING
    # ---------------------------------------------------------
    # Round ascent/descent for cleaner display
    laps_df["Total Ascent (ft)"] = laps_df["Total Ascent (ft)"].round(0)
    laps_df["Total Descent (ft)"] = laps_df["Total Descent (ft)"].round(0)
    laps_df["Time"] = laps_df["seconds_raw"].apply(convert_seconds_to_hms)
    laps_df["Cumulative Time"] = laps_df["seconds_raw"].cumsum().apply(convert_seconds_to_hms)

    return laps_df, target_dists


def build_running_auto_laps(laps_df):
    """Format auto laps dataframe for running display (pace-based)."""
    laps_df = laps_df.copy()
    laps_df["Pace (min/mile) unformatted"] = (laps_df["seconds_raw"] / 60) / laps_df[
        "Distance (miles)"
    ]
    laps_df["Pace (min/mile)"] = laps_df["Pace (min/mile) unformatted"].apply(
        format_pace
    )

    cols_to_display = [
        "Lap",
        "Time",
        "Distance (miles)",
        "Pace (min/mile)",
        "Cumulative Time",
        "Total Ascent (ft)",
        "Total Descent (ft)",
    ]
    if "Avg HR" in laps_df.columns:
        cols_to_display += ["Avg HR", "Max HR"]
    if "Avg Cadence" in laps_df.columns:
        cols_to_display += ["Avg Cadence", "Max Cadence"]

    return laps_df[cols_to_display]


def build_cycling_auto_laps(laps_df):
    """Format auto laps dataframe for cycling display (speed-based)."""
    laps_df = laps_df.copy()

    cols_to_display = [
        "Lap",
        "Time",
        "Distance (miles)",
        "Cumulative Time",
        "Total Ascent (ft)",
        "Total Descent (ft)",
    ]
    if "Avg Speed (mph)" in laps_df.columns:
        cols_to_display += ["Max Speed (mph)"]
        cols_to_display.insert(3, "Avg Speed (mph)")
    if "Avg HR" in laps_df.columns:
        cols_to_display += ["Avg HR", "Max HR"]
    if "Avg Cadence" in laps_df.columns:
        cols_to_display += ["Avg Cadence", "Max Cadence"]

    return laps_df[cols_to_display]


# Standard track distances in miles for labeling interval sets
TRACK_DISTANCES = [
    (0.0621, "100m"), (0.1243, "200m"), (0.1864, "300m"),
    (0.2485, "400m"), (0.3107, "500m"), (0.3728, "600m"),
    (0.4971, "800m"), (0.6214, "1000m"), (0.7456, "1200m"),
    (1.0, "1 mi"), (1.2427, "2000m"), (1.8641, "3000m"),
]


def _scaling_tolerance(distance_mi):
    """Tolerance that starts at 10% for 100m and shrinks proportionally with distance."""
    return max(0.02, 0.10 * (0.0621 / distance_mi))


def _distance_label(mean_dist_mi):
    """Map a mean distance to the nearest standard track label, or fall back to miles."""
    tol = _scaling_tolerance(mean_dist_mi)
    for ref, label in TRACK_DISTANCES:
        if abs(mean_dist_mi - ref) / ref <= tol:
            return label
    return f"{mean_dist_mi:.2f} mi"


def _time_label(mean_secs):
    """Format a mean duration as a human-readable rep label (e.g., '1:30')."""
    mins, secs = divmod(int(round(mean_secs)), 60)
    if mins > 0:
        return f"{mins}:{secs:02d}"
    return f"0:{secs:02d}"


def compute_interval_summary(processed_laps_df, sport, group_by="distance"):
    """
    Group 'active' laps by similar distance or time and return per-set stats.
    group_by: 'distance' or 'time'.
    Only sets with >= 2 reps are included. Returns a list of dicts sorted by workout order.
    """
    df = processed_laps_df.copy()
    df = df[df["Intensity"] == "active"]
    if len(df) < 2:
        return []

    df["_dist"] = pd.to_numeric(df["Distance (miles)"], errors="coerce")
    df["_seconds"] = df["Time (formatted)"].apply(parse_hms_to_seconds)
    df = df.dropna(subset=["_dist", "_seconds"])

    if df.empty:
        return []

    if group_by == "time":
        cluster_col = "_seconds"
    else:
        cluster_col = "_dist"

    df = df.sort_values(cluster_col).reset_index(drop=True)

    # Cluster laps by similar values using scaling tolerance
    groups = []
    current = [0]
    for i in range(1, len(df)):
        group_mean = df.loc[current, cluster_col].mean()
        tol = _scaling_tolerance(group_mean) if group_by == "distance" else max(0.05, 0.15 * (15 / group_mean))
        if abs(df.loc[i, cluster_col] - group_mean) / group_mean <= tol:
            current.append(i)
        else:
            groups.append(current)
            current = [i]
    groups.append(current)

    results = []
    for idxs in groups:
        if len(idxs) < 2:
            continue
        subset = df.loc[idxs]
        mean_dist = subset["_dist"].mean()
        avg_secs = subset["_seconds"].mean()

        if group_by == "time":
            label = _time_label(subset["_seconds"].mean())
        else:
            label = _distance_label(mean_dist)

        entry = {
            "count": len(subset),
            "label": label,
            "avg_duration": convert_seconds_to_hms(int(avg_secs)),
            "avg_dist_label": f"{mean_dist:.2f}",
            "mean_dist": mean_dist,
            "first_lap": int(subset["Lap"].min()),
        }

        fastest_idx = subset["_seconds"].idxmin()
        entry["fastest_split"] = convert_seconds_to_hms(int(subset.loc[fastest_idx, "_seconds"]))
        entry["fastest_lap"] = int(subset.loc[fastest_idx, "Lap"])

        farthest_idx = subset["_dist"].idxmax()
        entry["farthest_split"] = f"{subset.loc[farthest_idx, '_dist']:.2f}"
        entry["farthest_lap"] = int(subset.loc[farthest_idx, "Lap"])

        # Deviation trend: each rep's deviation from the median, then
        # last deviation minus first deviation (by lap order).
        by_lap = subset.sort_values("Lap")

        med_secs = by_lap["_seconds"].median()
        time_devs = by_lap["_seconds"] - med_secs
        time_trend = time_devs.iloc[-1] - time_devs.iloc[0]
        entry["time_dev_trend"] = convert_seconds_to_hms(abs(int(time_trend)))
        if time_trend < 0:
            entry["time_dev_trend"] = f"-{entry['time_dev_trend']}"

        med_dist = by_lap["_dist"].median()
        dist_devs = by_lap["_dist"] - med_dist
        dist_trend = dist_devs.iloc[-1] - dist_devs.iloc[0]
        entry["dist_dev_trend"] = f"{abs(dist_trend):.2f}"
        if dist_trend < 0:
            entry["dist_dev_trend"] = f"-{entry['dist_dev_trend']}"

        if sport == "cycling" and "Avg Speed (mph)" in subset.columns:
            speeds = pd.to_numeric(subset["Avg Speed (mph)"], errors="coerce").dropna()
            if not speeds.empty:
                entry["avg_pace_label"] = f"{speeds.mean():.1f}"
        else:
            paces = pd.to_numeric(
                subset.get("Pace (min/mile) unformatted"), errors="coerce"
            ).dropna()
            if not paces.empty:
                entry["avg_pace_label"] = f"{format_pace(paces.mean())}"

        hr = pd.to_numeric(subset.get("Avg Heart Rate"), errors="coerce").dropna()
        if not hr.empty:
            entry["avg_hr"] = int(hr.mean())

        results.append(entry)

    results.sort(key=lambda s: s["first_lap"])
    return results
