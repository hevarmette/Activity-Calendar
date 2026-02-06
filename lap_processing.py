import pandas as pd
from datetime import timedelta
from streamlit import session_state as ss
from utils import format_pace, convert_seconds_to_hms
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

    # Select and reorder columns for display
    display_cols = [
        "Lap",
        "Distance (miles)",
        "Time (formatted)",
        "Pace (min/mile)",
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
    """Processes lap data with cycling-specific metrics like speed."""
    if df.empty:
        return pd.DataFrame()

    df["Distance (miles)"] = round(df["Distance"] / ss.meters_to_miles, 2)

    # Calculate Average Speed in MPH for cycling
    non_zero_time = df["Time"] > 0
    df["Avg Speed (mph)"] = None
    df.loc[non_zero_time, "Avg Speed (mph)"] = round(
        df["Distance (miles)"] / (df["Time"] / 3600), 1
    )

    df["Time (formatted)"] = df["Time"].apply(lambda s: str(timedelta(seconds=int(s))))

    # Define columns relevant to cycling
    display_cols = [
        "Lap",
        "Distance (miles)",
        "Time (formatted)",
        "Avg Speed (mph)",
        "Avg Heart Rate",
        "Max Heart Rate",
        "Avg Power",
        "Avg Cadence",
        "Total Ascent",
        "Total Descent",
        "Intensity",
    ]

    # Return a DataFrame with only the relevant columns, plus the ID for updates
    df_display = df[["Lap Id"] + [col for col in display_cols if col in df.columns]]
    return df_display


def create_auto_laps(points_df, auto_lap_dist=1):
    if not ss.coordinates:
        return pd.DataFrame()

    # Convert cumulative meters to miles
    points_df = points_df.copy()
    points_df["dist_miles_cumulative"] = points_df["distance"] / ss.meters_to_miles

    # Floor of distance + 1 gives us 1 for 0-0.99, 2 for 1.0-1.99, etc.
    points_df["lap_no"] = points_df["dist_miles_cumulative"].apply(
        lambda x: int(x) + auto_lap_dist
    )

    # Calculate Deltas for precise summing (Altitude Gain/Loss)
    points_df["alt_diff"] = points_df["corrected_altitude"].diff().fillna(0)

    # Separate gains and losses for ascent/descent calculations
    points_df["ascent_ft"] = points_df["alt_diff"].clip(lower=0)
    points_df["descent_ft"] = points_df["alt_diff"].clip(upper=0).abs()

    # Define how to aggregate each column
    agg_dict = {
        "timestamp": [np.min, np.max],  # To calculate duration
        "dist_miles_cumulative": [np.min, np.max],  # To calculate lap distance
        "ascent_ft": "sum",
        "descent_ft": "sum",
    }

    # Add optional columns if they exist in the data
    if ss.hr and points_df["heart_rate"].notna().all():
        agg_dict["heart_rate"] = ["mean", "max"]

    if ss.cadence and points_df["total_cadence"].notna().all():
        agg_dict["total_cadence"] = ["mean", "max"]

    # Group by Lap Number
    laps_grouped = points_df.groupby("lap_no").agg(agg_dict)

    # Flatten MultiIndex columns (e.g., ('heart_rate', 'mean') -> 'Avg Heart Rate')
    laps_df = pd.DataFrame(index=laps_grouped.index)

    # Distance
    laps_df["Distance (miles)"] = (
        laps_grouped["dist_miles_cumulative"]["max"]
        - laps_grouped["dist_miles_cumulative"]["min"]
    )

    # Calculate duration in seconds
    laps_df["seconds_raw"] = (
        laps_grouped["timestamp"]["max"] - laps_grouped["timestamp"]["min"]
    ).dt.total_seconds()

    # Elevation
    laps_df["Total Ascent (ft)"] = laps_grouped["ascent_ft"]["sum"]
    laps_df["Total Descent (ft)"] = laps_grouped["descent_ft"]["sum"]

    # Heart Rate
    if ss.hr and points_df["heart_rate"].notna().all():
        laps_df["Avg HR"] = laps_grouped["heart_rate"]["mean"].round(0)
        laps_df["Max HR"] = laps_grouped["heart_rate"]["max"]

    # Cadence
    if ss.cadence and points_df["total_cadence"].notna().all():
        laps_df["Avg Cadence"] = laps_grouped["total_cadence"]["mean"].round(0) * 2
        laps_df["Max Cadence"] = laps_grouped["total_cadence"]["max"] * 2

    # 4. CALCULATE PACE & FORMATTING

    # Time Formatting
    laps_df["Time"] = laps_df["seconds_raw"].apply(convert_seconds_to_hms)

    if auto_lap_dist == 1:
        laps_df["Pace (min/mile)"] = laps_df["Time"]
    else:
        # Pace Calculation (Time in Minutes / Distance in Miles)
        # Avoid division by zero
        non_zero_dist = laps_df["Distance (miles)"] > 0
        laps_df["Pace (min/mile) unformatted"] = None

        laps_df.loc[non_zero_dist, "Pace (min/mile) unformatted"] = (
            laps_df.loc[non_zero_dist, "seconds_raw"] / 60
        ) / laps_df.loc[non_zero_dist, "Distance (miles)"]

        laps_df["Pace (min/mile)"] = laps_df["Pace (min/mile) unformatted"].apply(
            format_pace
        )

    # Cleanup: Select and Order columns for final display
    # We reset index so "Lap" becomes a column
    final_df = laps_df.reset_index().rename(columns={"lap_no": "Lap"})

    cols_to_display = [
        "Lap",
        "Time",
        "Distance (miles)",
        "Pace (min/mile)",
        "Total Ascent (ft)",
        "Total Descent (ft)",
    ]

    # Append conditional columns if they exist
    if "Avg HR" in final_df.columns:
        cols_to_display += ["Avg HR", "Max HR"]
    if "Avg Cadence" in final_df.columns:
        cols_to_display += ["Avg Cadence", "Max Cadence"]

    return final_df[cols_to_display]
