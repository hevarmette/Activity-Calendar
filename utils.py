import pandas as pd
import streamlit as st
from streamlit import session_state as ss
import base64


def init_session_state():
    # constants
    if "schema" not in ss:
        ss.schema = st.secrets.schema
    if "meters_to_miles" not in ss:
        ss.meters_to_miles = 1609.344
    if "feel_map" not in ss:
        ss.feel_map = {
            0: "very weak",
            25: "weak",
            50: "normal",
            75: "strong",
            100: "very strong",
        }
    if "auto_lap_distances" not in ss:
        ss.auto_lap_distances = {
            "cycling": 5,
            "running": 1,
            "default": 1,
        }
    if "effort_labels" not in ss:
        ss.effort_labels = {
            1: "very light",
            2: "light",
            3: "moderate",
            4: "somewhat hard",
            5: "hard",
            6: "hard",
            7: "very hard",
            8: "very hard",
            9: "extremely hard",
            10: "maximum",
        }


# --- Helper Function to format time ---
def convert_seconds_to_hms(seconds):
    if pd.isna(seconds):
        return None
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    if h > 0:
        return f"{h}:{m:02d}:{s:05.2f}"
    return f"{m}:{s:05.2f}"


def parse_hms_to_seconds(time_str):
    """
    Converts 'H:M:S', 'M:S', or 'S' strings back to total seconds.
    Returns None if parsing fails.
    """
    if not isinstance(time_str, str):
        return None

    try:

        # Split by colon
        parts = time_str.strip().split(":")
        parts = [float(p) for p in parts]  # Convert all parts to floats

        if len(parts) == 3:  # H:M:S
            return (parts[0] * 3600) + (parts[1] * 60) + parts[2]
        elif len(parts) == 2:  # M:S
            return (parts[0] * 60) + parts[1]

        elif len(parts) == 1:  # Just Seconds
            return parts[0]
        else:
            return None
    except ValueError:
        return None


def weighted_average_if_present(df, value_col, weight_col):
    valid = df[[value_col, weight_col]].dropna()

    if valid.empty:
        return None

    total_weight = valid[weight_col].sum()
    if total_weight == 0:
        return None

    return (valid[value_col] * valid[weight_col]).sum() / total_weight


# NOTE: Not used right now
# This is for the to do to recalculate paces as user edits data. requires processed lap data to be in the session state
def recalculate_pace(df):
    non_zero_dist = df["Distance (miles)"] > 0
    # get seconds per lap
    df["Time"] = df["Time (formatted)"].apply(parse_hms_to_seconds())
    df["Pace (min/mile) unformatted"] = None
    df.loc[non_zero_dist, "Pace (min/mile) unformatted"] = (df["Time"] / 60) / df[
        "Distance (miles)"
    ]
    df["Pace (min/mile)"] = df["Pace (min/mile) unformatted"].apply(
        lambda x: (
            "{:d}:{:02d}".format(*divmod(int(round(x * 60)), 60))
            if pd.notna(x)
            else None
        )
    )

    df["Time (formatted)"] = df["Time"].apply(convert_seconds_to_hms)


def format_pace(x):
    """pace formatting logic."""
    if pd.notna(x):
        return "{:d}:{:02d}".format(*divmod(int(round(x * 60)), 60))
    return None


def format_pace_precise(x):
    """Pace formatting to hundredths of a second."""
    if pd.notna(x):
        total_secs = x * 60
        m = int(total_secs // 60)
        s = total_secs % 60
        return f"{m}:{s:05.2f}"
    return None


def get_svg_markdown(label):
    """Reads an SVG and converts it to a markdown image string."""
    filename = f"assets/{label.replace(' ', '-')}.svg"
    try:
        with open(filename, "rb") as f:
            b64_encoded = base64.b64encode(f.read()).decode("utf-8")
        # Creates a markdown image tag followed by the label text
        return f"![{label}](data:image/svg+xml;base64,{b64_encoded}) {label}"
    except FileNotFoundError:
        return label  # Fallback to plain text if the SVG is missing


def format_effort(val):
    if val is None:
        return "None"
    return ss.effort_labels.get(int(val / 10), "Unknown")


def _format_pace_speed(sport, distance_m, time_s):
    """Return a sport-appropriate pace or speed string."""
    if distance_m <= 0 or time_s <= 0:
        return "—"
    if sport == "cycling":
        return f"{(distance_m / ss.meters_to_miles) / (time_s / 3600):.1f} mph"
    if sport == "swimming":
        mins, secs = divmod(int(round(time_s / (distance_m / 100))), 60)
        return f"{mins}:{secs:02d} /100m"
    pace = (time_s / 60) / (distance_m / ss.meters_to_miles)
    return f"{format_pace(pace)} /mi"


def render_activity_card(row, sport, conn, key_prefix, on_same_page=False):
    """Render a bordered activity card with distance, duration, and pace/speed."""
    from db import fetch_activity_details, fetch_activity_points

    activity_id = row["activity_id"]
    distance_m = row.get("total_distance") or 0
    time_s = row.get("total_timer_time") or 0
    miles = distance_m / ss.meters_to_miles
    timestamp = row.get("local_timestamp")
    date_str = pd.to_datetime(timestamp).strftime("%b %d, %Y") if pd.notna(timestamp) else ""
    pace_speed = _format_pace_speed(sport, distance_m, time_s)

    with st.container(border=True):
        header_col, btn_col = st.columns([5, 1], vertical_alignment='center')
        with header_col:
            st.markdown(f"**{row.get('activity_name', 'Untitled')}** &nbsp;·&nbsp; {sport.capitalize()} &nbsp;·&nbsp; {date_str}")
        with btn_col:
            if st.button("View", key=f"{key_prefix}_{activity_id}"):
                ss.selected_activity_id = activity_id
                ss.selected_activity_sport = sport
                ss.activity_details = fetch_activity_details(conn, activity_id)
                ss.points_df = fetch_activity_points(conn, activity_id)
                if on_same_page:
                    st.rerun()
                else:
                    st.switch_page("pages/2_Activity_Details.py")

        m1, m2, m3 = st.columns(3)
        m1.metric("Distance", f"{miles:.2f} mi")
        m2.metric("Duration", convert_seconds_to_hms(int(time_s)) if time_s else "—")
        m3.metric("Pace / Speed", pace_speed)
