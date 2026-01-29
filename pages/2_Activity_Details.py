import streamlit as st
import pandas as pd
from streamlit import session_state as ss
from datetime import timedelta
import plotly.express as px
from calendar_test_8 import (
    create_activity_map,
    fetch_activity_details,
    fetch_activity_points,
)
from streamlit_folium import st_folium
from db import get_connection

if "schema" not in ss:
    ss.schema = "PUBLIC"

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

METERS_TO_MILES = 1609.344
# import random
# @st.cache_data
# def generate_fake_lap_data(activity_id):
#     """Generates a realistic DataFrame of fake lap data for a given activity ID."""
#     laps = []
#     num_laps = random.randint(3, 10)  # Generate 3 to 10 laps
#     start_time = datetime.now() - timedelta(hours=random.randint(24, 96))

#     for i in range(1, num_laps + 1):
#         lap_duration_seconds = random.uniform(420, 600)  # 7 to 10 minutes per lap
#         lap = {
#             'Lap Id': int(f"{activity_id}{i:02d}"),
#             'Activity Id': activity_id,
#             'Start Time': start_time,
#             'Lap': i,
#             'Distance': random.uniform(1600, 1625),  # Approx 1 mile in meters
#             'Time': lap_duration_seconds,
#             'Total Ascent': random.uniform(5, 20),
#             'Total Descent': random.uniform(5, 20),
#             'Avg Vertical Oscillation': random.uniform(70, 95),  # In mm*10
#             'Avg Stance Time': random.uniform(220, 280), # In ms
#             'Avg Vertical Ratio': random.uniform(5, 8),
#             'Avg Stance Time Balance': random.uniform(49, 51),
#             'Avg Stride Length': random.uniform(1000, 1300), # In mm
#             'Avg Running Cadence': random.uniform(85, 92), # Single-leg, will be doubled
#             'Max Heart Rate': random.randint(170, 185),
#             'Avg Heart Rate': random.randint(155, 170),
#             'Intensity': random.choice(['active', 'rest', 'warmup'])
#         }
#         laps.append(lap)
#         start_time += timedelta(seconds=lap_duration_seconds)

#     df = pd.DataFrame(laps)
#     # Ensure columns match the expected order from your original function
#     column_order = [
#         'Lap Id', 'Activity Id', 'Start Time', 'Lap', 'Distance', 'Time',
#         'Total Ascent', 'Total Descent', 'Avg Vertical Oscillation', 'Avg Stance Time',
#         'Avg Vertical Ratio', 'Avg Stance Time Balance', 'Avg Stride Length',
#         'Avg Running Cadence', 'Max Heart Rate', 'Avg Heart Rate', 'Intensity'
#     ]
#     return df[column_order]

# @st.cache_data
# def generate_fake_cycling_lap_data(activity_id):
#     """Generates a realistic DataFrame of fake cycling lap data."""
#     laps = []
#     num_laps = random.randint(2, 6)
#     start_time = datetime.now() - timedelta(hours=random.randint(24, 96))

#     for i in range(1, num_laps + 1):
#         # Cycling laps are often longer and faster
#         lap_duration_seconds = random.uniform(1200, 1800) # 20 to 30 minutes
#         distance_meters = random.uniform(8000, 12000) # 8 to 12 km

#         lap = {
#             'Lap Id': int(f"{activity_id}{i:02d}"), 'Activity Id': activity_id, 'Start Time': start_time,
#             'Lap': i, 'Distance': distance_meters, 'Time': lap_duration_seconds,
#             'Total Ascent': random.uniform(20, 100), 'Total Descent': random.uniform(20, 100),
#             'Avg Power': random.randint(150, 300), # Cycling specific metric
#             'Avg Cadence': random.randint(75, 95), # Cycling specific metric
#             'Max Heart Rate': random.randint(160, 175), 'Avg Heart Rate': random.randint(145, 160),
#             'Intensity': random.choice(['active', 'recovery'])
#         }
#         laps.append(lap)
#         start_time += timedelta(seconds=lap_duration_seconds)
#     return pd.DataFrame(laps)


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


@st.cache_data
def fetch_lap_data(_conn, activity_id):
    """Fetches lap data for a specific activity."""
    sql_query = f"""
        SELECT 
            lap_id,
            activity_id,
            start_time,
            number,
            total_distance,
            total_timer_time,
            total_ascent,
            total_descent,
            avg_vertical_oscillation,
            avg_stance_time,
            avg_vertical_ratio,
            avg_stance_time_balance,
            avg_step_length,
            avg_running_cadence,
            max_heart_rate,
            avg_heart_rate,
            intensity,
            (total_distance * {1 / METERS_TO_MILES}) AS distance_mi
        FROM {ss.schema}.lap
        WHERE activity_id = %s
        ORDER BY number ASC
    """
    df = pd.read_sql_query(sql_query, _conn, params=(activity_id,))
    return df


def update_lap_in_db(_conn, lap_id, column_to_update, new_value):
    """Updates a single value in the lap table."""
    with _conn.cursor() as cur:
        # Important: Sanitize column name to prevent SQL injection
        # In a real app, you'd have a whitelist of editable columns.
        safe_column = "".join(c for c in column_to_update if c.isalnum() or c == "_")

        query = f"UPDATE {ss.schema}.lap SET {safe_column} = %s WHERE lap_id = %s"
        cur.execute(query, (new_value, lap_id))
    _conn.commit()


def get_lap_update_query(lap_id, db_column, new_value):
    """
    Returns a safe (query, params) tuple for updating a single value.
    """
    # Use %s for the value to handle quotes/types safely
    # We inject db_column directly because we validate it against our map first (safe whitelist)
    query = f"UPDATE {ss.schema}.lap SET {db_column} = %s WHERE lap_id = %s;"
    params = (new_value, lap_id)
    return query, params


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
    df["Pace (min/mile)"] = df["Pace (min/mile) unformatted"].apply(
        lambda x: (
            "{:d}:{:02d}".format(*divmod(int(round(x * 60)), 60))
            if pd.notna(x)
            else None
        )
    )

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

    df["Distance (miles)"] = round(df["Distance"] / METERS_TO_MILES, 2)

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


def create_plot(
    df,
    x_col,
    y_col,
    x_label,
    y_label,
    title,
    color,
    is_scatter=False,
    invert_y_axis=False,
):
    """A generalized function to create a line or scatter plot with Plotly."""
    # Gracefully handle missing data columns
    if y_col not in df.columns or df[y_col].isnull().all():
        print(f"Data for '{title}' is not available for this activity.")
        return None

    # Create the plot
    if is_scatter:
        fig = px.scatter(df, x=x_col, y=y_col, labels={x_col: x_label, y_col: y_label})
    else:
        fig = px.line(df, x=x_col, y=y_col, labels={x_col: x_label, y_col: y_label})

    # Style the plot
    fig.update_traces(line_color=color, marker_color=color if is_scatter else None)
    fig.update_layout(
        title=title, xaxis_title=x_label, yaxis_title=y_label, showlegend=False
    )

    # Add average line
    avg_value = df[y_col].mean()
    fig.add_hline(
        y=avg_value,
        line_dash="dot",
        annotation_text=f"Avg: {avg_value:.1f}",
        annotation_position="bottom right",
    )

    if invert_y_axis:
        fig.update_yaxes(autorange="reversed")

    return fig


# --- 3. PAGE LAYOUT ---
st.set_page_config(page_title="Activity Details", layout="wide")

# Check if an activity has been selected
if "selected_activity_id" not in ss:
    st.warning("Please select an activity from the calendar page first.")
    st.page_link("calendar test 8.py", label="Back to Calendar", icon="🗓️")
else:
    activity_id = ss.selected_activity_id
    sport = ss.selected_activity_sport
    # conn = init_connection()
    conn = get_connection()

    st.title(f"Lap Data for Activity ID: {activity_id}")

    if "activity_details" in ss:
        # Getting activity details
        distance_m = ss.activity_details[0]
        duration_s = ss.activity_details[1]
        avg_power = ss.activity_details[2]
        description = ss.activity_details[3] if ss.activity_details[3] else ""
        feel = ss.activity_details[4]
        effort = ss.activity_details[5]
        local_timestamp = ss.activity_details[6]

        # day of activity
        # TODO: It looks like the old watch? stored local timestamp at the end of the activity but new watch is beginning of activity. Activities from form are from the start of the activity
        st.markdown(f"_{local_timestamp.strftime("%B %d, %Y @ %I:%M %p")}_")

    title_col, category_col, nav_col = st.columns(
        [0.7, 0.25, 0.05], vertical_alignment="bottom"
    )
    # Title
    with title_col:
        title = ss.activity_details[7]
        # with title_col:
        updated_title = st.text_input(label=" ", value=title)
    with category_col:
        # category
        category = ss.activity_details[8]
        if isinstance(category, str):
            category = category.strip()

        category_options = [
            "uncategorized",
            "training",
            "race",
            "transportation",
            "recreational",
            "touring",
            "fitness",
        ]

        if category in category_options:
            cat_index = category_options.index(category)
        else:
            cat_index = 0  # Fallback to the first option

        updated_category = st.selectbox(
            "---", options=category_options, index=cat_index
        )
    with nav_col:
        back_col, forward_col = st.columns(2, gap=None)
        idx = ss.activities_df.index[ss.activities_df["activity_id"] == activity_id][0]
        with back_col:
            if st.button("<", key="prev_activity"):
                if idx < len(ss.activities_df) - 1:
                    prev_id = int(ss.activities_df.iloc[idx + 1]["activity_id"])
                    ss.selected_activity_id = prev_id
                    ss.activity_details = fetch_activity_details(conn, prev_id)
                    ss.points_df = fetch_activity_points(conn, prev_id)
                    st.rerun()
        with forward_col:
            if st.button("\>", key="next_activity"):
                if idx > 0:
                    next_id = int(ss.activities_df.iloc[idx - 1]["activity_id"])
                    ss.selected_activity_id = next_id
                    ss.activity_details = fetch_activity_details(conn, next_id)
                    ss.points_df = fetch_activity_points(conn, next_id)
                    st.rerun()

    metrics_col, white_space_col = st.columns([0.7, 0.3])
    map_col, description_col = st.columns([0.7, 0.3])

    if "activity_details" in ss:
        with metrics_col:
            miles = distance_m * 1 / METERS_TO_MILES
            duration_td = timedelta(seconds=int(duration_s))
            duration_hr = duration_s / 3600
            pace_sec_per_mile = duration_s / miles if miles > 0 else 0
            pace_min, pace_sec = divmod(int(pace_sec_per_mile), 60)
            mph = miles / duration_hr if duration_hr > 0 else 0

            col1, col2, col3 = st.columns(3)
            col1.metric("Distance", f"{miles:.2f} mi")
            col2.metric("Duration", str(duration_td))
            if sport == "cycling":
                if avg_power:
                    col3.metric("Power", f"{avg_power} watts")
                else:
                    col3.metric("Speed", f"{mph:.2f} mph")
            else:
                col3.metric("Pace", f"{pace_min}:{pace_sec:02d} /mi")

    # --- Map ---
    if "points_df" in ss and ss.points_df is not None:
        with map_col:
            activity_map = create_activity_map(ss.points_df)
            st_folium(activity_map, use_container_width=True)

    with description_col:
        # st.write(" ")
        # activity description
        if ss.activity_details and ss.activity_details[3]:
            description = ss.activity_details[3]
        else:
            description = None
        updated_description = st.text_area(
            "Description", description, width="stretch", height=200
        )

    # --- NEW: Performance Graphs Section ---
    st.header("📈 Performance Graphs")
    # move this above the map and make the map use point df. check if in session state first though
    point_df = ss.points_df

    if point_df is not None:
        if (
            "enhanced_speed" in point_df.columns
            and point_df["enhanced_speed"].notnull().any()
        ):
            # Conversion: (meters/mile) / (seconds/minute) = 26.8224
            # We divide this constant by the speed in m/s to get min/mile
            speed_mps = point_df["enhanced_speed"].replace(
                0, pd.NA
            )  # Avoid division by zero
            point_df["pace_min_per_mile"] = 26.8224 / speed_mps

        # Create the toggle for the x-axis
        x_axis_choice = st.radio(
            "Plot against:",
            ("Distance", "Time"),
            horizontal=True,
            label_visibility="collapsed",
        )

        if x_axis_choice == "Distance":
            if "distance" in point_df.columns:
                point_df = point_df.copy()
                point_df["distance_miles"] = point_df["distance"] * 1 / METERS_TO_MILES
                x_col, x_label = "distance_miles", "Distance (miles)"
            else:
                x_col, x_label = None, None
        else:
            x_col, x_label = "elapsed_time", "Time (minutes)"

        # Check if the chosen x-axis data exists
        if not x_col or x_col not in point_df.columns:
            st.warning(f"Data for '{x_label}' is not available.")
        else:
            pace_fig = create_plot(
                df=point_df,
                x_col=x_col,
                y_col="pace_min_per_mile",
                x_label=x_label,
                y_label="Pace (min/mile)",
                title="Pace over " + x_axis_choice,
                color="blue",
                invert_y_axis=True,
            )

            if pace_fig:
                pace_series = point_df["pace_min_per_mile"].dropna()

                if not pace_series.empty:
                    # --- Dynamic bounds ---
                    if updated_category == "training":
                        p_pace = min(pace_series.quantile(0.85), 12)
                    else:
                        p_pace = pace_series.quantile(0.95) + 3
                    fastest_pace = pace_series.min()

                    # Top bound logic
                    if fastest_pace >= 5:
                        top_bound = 5
                    else:
                        top_bound = fastest_pace

                    if p_pace > 11:
                        bottom_bound = 11
                    else:
                        bottom_bound = p_pace

                    # --- Average pace ---
                    avg_pace = pace_series.mean()
                    avg_min = int(avg_pace)
                    avg_sec = int(round((avg_pace - avg_min) * 60))

                    # --- Y-axis formatting ---
                    max_tick = int(bottom_bound) + 1
                    tick_vals = list(range(int(top_bound), max_tick + 1))
                    tick_text = [f"{m:02d}:00" for m in tick_vals]

                    pace_fig.update_yaxes(
                        range=[bottom_bound, top_bound],
                        autorange=False,
                        tickmode="array",
                        tickvals=tick_vals,
                        ticktext=tick_text,
                        title="Pace (mm:ss / mile)",
                    )

                    # --- Hover formatting ---
                    pace_fig.update_traces(
                        hovertemplate=(
                            "Distance: %{x:.2f} mi<br>"
                            "Pace: %{y:.2f} min/mi<br>"
                            "<extra></extra>"
                        )
                    )

                    # --- Average pace line ---
                    pace_fig.add_hline(
                        y=avg_pace,
                        line_dash="dash",
                        line_color="gray",
                        annotation_text=f"Avg: {avg_min:02d}:{avg_sec:02d} /mi",
                        annotation_position="top right",
                    )

                st.plotly_chart(pace_fig, use_container_width=True)

            hr_fig = create_plot(
                df=point_df,
                x_col=x_col,
                y_col="heart_rate",
                x_label=x_label,
                y_label="Heart Rate (bpm)",
                title="Heart Rate over " + x_axis_choice,
                color="red",
            )
            if hr_fig:
                st.plotly_chart(hr_fig, use_container_width=True)

            alt_fig = create_plot(
                df=point_df,
                x_col=x_col,
                y_col="corrected_altitude",
                x_label=x_label,
                y_label="Altitude (ft)",
                title="Altitude over " + x_axis_choice,
                color="green",
            )
            if alt_fig:
                st.plotly_chart(alt_fig, use_container_width=True)

            if "cadence" in point_df.columns:
                point_df = point_df.copy()
                point_df["cadence_spm"] = point_df["cadence"] * 2

                cad_fig = create_plot(
                    df=point_df,
                    x_col=x_col,
                    y_col="cadence_spm",
                    x_label=x_label,
                    y_label="Cadence (spm)",
                    title="Cadence over " + x_axis_choice,
                    color="purple",
                    is_scatter=True,
                )
                if cad_fig:
                    st.plotly_chart(cad_fig, use_container_width=True)
    else:
        st.info("No point-by-point data available to generate graphs.")

    st.markdown("You can edit values in the table below.")

    raw_laps_df = fetch_lap_data(conn, activity_id)
    if sport == "cycling":
        processed_laps_df = process_cycling_laps(raw_laps_df.copy())
    elif sport == "running":
        processed_laps_df = process_lap_data(raw_laps_df.copy())
    else:
        processed_laps_df = pd.DataFrame()

    if processed_laps_df.empty:
        st.info("No lap data found for this activity.")
    else:
        laps_tab, details_tab = st.tabs(["🏁 Laps", "📊 Activity Details"])

        with laps_tab:
            st.markdown("You can edit values in the table below.")

            column_config = {
                "Intensity": st.column_config.SelectboxColumn(
                    "Intensity",
                    help="Select the intensity type for the lap",
                    options=["warm up", "active", "recovery", "rest", "cooldown"],
                    required=False,
                ),
                "Activity Id": None,
                "Lap Id": None,
                "Avg Vertical Oscillation": None,
                "Avg Stance Time": None,
                "Avg Vertical Ratio": None,
                "Avg Stance Time Balance": None,
                "Pace (min/mile) unformatted": None,
                "Distance (miles)": st.column_config.NumberColumn(format="%.2f"),
                "Avg Heart Rate": st.column_config.NumberColumn(
                    "Avg Heart Rate", default=int, step=int
                ),
                "Max Heart Rate": st.column_config.NumberColumn(
                    "Max Heart Rate", default=int, step=int
                ),
            }

            # TODO: Recalc pace min/mile on_callback when data is edited
            edited_df = st.data_editor(
                processed_laps_df,
                hide_index=True,
                column_config=column_config,
                disabled=["Lap", "Pace (min/mile)"],
                key="lap_editor",
            )

        with details_tab:
            st.subheader("Activity Details")

            c1, c2, c3, c4 = st.columns(4)

            # --------------------
            # Column 1
            # --------------------
            with c1:
                if miles is not None:
                    st.markdown("**Distance**")
                    st.write(f"{miles:.2f} mi")

                if miles is not None:
                    st.markdown("---")
                    st.markdown("**Avg Pace / Speed**")
                    avg_speed = None
                    if sport == "cycling" and mph is not None:
                        avg_speed = f"{mph:.2f} mph"
                    elif pace_min is not None and pace_sec is not None:
                        avg_speed = f"{pace_min}:{pace_sec:02d} /mi"
                    if avg_speed is not None:
                        st.write(avg_speed)

            # --------------------
            # Column 2
            # --------------------
            with c2:
                hr_valid = (
                    "hr" in ss
                    and ss.hr
                    and "heart_rate" in point_df
                    and not point_df["heart_rate"].isna().all()
                )

                if hr_valid:
                    avg_hr = point_df["heart_rate"].mean()
                    max_hr = point_df["heart_rate"].max()

                    st.markdown("**Heart Rate**")
                    st.write(f"Avg HR: {avg_hr:.0f} bpm")
                    st.write(f"Max HR: {max_hr:.0f} bpm")

                if duration_td is not None:
                    if hr_valid:
                        st.markdown("---")
                    st.markdown("**Duration**")
                    st.write(str(duration_td))

            # --------------------
            # Column 3
            # --------------------
            with c3:
                elevation_valid = (
                    "coordinates" in ss
                    and ss.coordinates
                    and "corrected_altitude" in point_df
                    and not point_df["corrected_altitude"].isna().all()
                )

                if elevation_valid:
                    altitude_change = point_df["corrected_altitude"].diff()
                    total_ascent = altitude_change.clip(lower=0).sum()
                    total_descent = altitude_change.clip(upper=0).abs().sum()

                    st.markdown("**Elevation**")
                    st.write(f"Ascent: {total_ascent:.0f} feet")
                    st.write(f"Descent: {total_descent:.0f} feet")

                pace_cols_valid = (
                    "Pace (min/mile) unformatted" in processed_laps_df
                    and not processed_laps_df["Pace (min/mile) unformatted"]
                    .isna()
                    .all()
                )

                if pace_cols_valid:
                    if elevation_valid:
                        st.markdown("---")

                    fastest_idx = processed_laps_df[
                        "Pace (min/mile) unformatted"
                    ].idxmin()

                    # Do to rounding differences in avg speed and lap speed, we will use avg speed if there is only one lap
                    # TODO: Handle for cycling and other sports
                    if len(processed_laps_df) > 1:
                        fastest_lap = processed_laps_df.loc[fastest_idx, "Lap"]
                        fastest_lap_pace = processed_laps_df.loc[
                            fastest_idx, "Pace (min/mile)"
                        ]
                        fastest_lap_pace = f"{fastest_lap_pace} /mi"
                    else:
                        fastest_lap = 1
                        fastest_lap_pace = avg_speed

                    st.markdown("**Best Pace / Speed**")
                    st.write(
                        f"Fastest lap: lap {fastest_lap} " f"at {fastest_lap_pace}"
                    )

            # --------------------
            # Column 4
            # --------------------
            with c4:
                cadence_valid = (
                    "cadence" in ss
                    and ss.cadence
                    and "total_cadence" in point_df
                    and not point_df["total_cadence"].isna().all()
                )

                if cadence_valid:
                    avg_cadence = point_df["total_cadence"].mean() * 2
                    max_cadence = point_df["total_cadence"].max() * 2

                    if duration_s and distance_m:
                        total_steps = avg_cadence * duration_s / 60
                        avg_stride_length_m = distance_m / total_steps
                    else:
                        avg_stride_length_m = None

                    st.markdown("**Running Dynamics**")
                    st.write(f"Avg cadence: {avg_cadence:.1f} spm")
                    st.write(f"Max cadence: {int(max_cadence)} spm")

                    if avg_stride_length_m is not None:
                        st.write(f"Stride length: {avg_stride_length_m:.2f} m")

                distance_col = "Distance (miles)"

                avg_vertical_oscillation = weighted_average_if_present(
                    processed_laps_df, "Avg Vertical Oscillation", distance_col
                )
                avg_stance_time = weighted_average_if_present(
                    processed_laps_df, "Avg Stance Time", distance_col
                )
                avg_vertical_ratio = weighted_average_if_present(
                    processed_laps_df, "Avg Vertical Ratio", distance_col
                )
                avg_stance_time_balance = weighted_average_if_present(
                    processed_laps_df, "Avg Stance Time Balance", distance_col
                )

                dynamics_present = any(
                    v is not None
                    for v in [
                        avg_vertical_ratio,
                        avg_stance_time_balance,
                        avg_stance_time,
                        avg_vertical_oscillation,
                    ]
                )

                if dynamics_present:
                    if avg_vertical_ratio is not None:
                        st.write(f"Vertical ratio: {avg_vertical_ratio:.1f}%")

                    if avg_stance_time_balance is not None:
                        st.write(f"Stance time balance: {avg_stance_time_balance:.2f}")

                    if avg_stance_time is not None:
                        st.write(
                            f"Average ground contact time: {avg_stance_time:.0f} ms"
                        )

                    if avg_vertical_oscillation is not None:
                        st.write(
                            f"Average vertical oscillation: {avg_vertical_oscillation / 10:.1f} cm"
                        )

    if st.button("Save"):
        updates = []
        # Check for edits by comparing the new state to the previous one
        if "lap_editor" in ss and ss.lap_editor.get("edited_rows"):
            # st.info("Changes detected. Saving to database...")

            # The edited_rows dict tells us exactly what changed
            for row_idx, changes in ss.lap_editor["edited_rows"].items():
                # Get the lap_id using the row index from the ORIGINAL dataframe
                # Note: Ensure processed_laps_df aligns with the editor's data source
                try:
                    lap_id = processed_laps_df.iloc[int(row_idx)]["Lap Id"]
                except IndexError:
                    st.error("Could not find Lap ID. Did the sort order change?")
                    continue

                for ui_col_name, new_value in changes.items():

                    # REVERSE LOOKUP: Check if this UI column maps to a real DB column
                    if ui_col_name in UI_TO_DB_MAP:
                        db_col_name = UI_TO_DB_MAP[ui_col_name]

                        if db_col_name == "distance_mi":
                            # Convert Miles -> Meters
                            new_value = new_value * METERS_TO_MILES
                            # Swap the column name
                            db_col_name = "total_distance"

                        elif db_col_name == "time_formatted":
                            seconds_value = parse_hms_to_seconds(new_value)

                            if seconds_value is None:
                                st.error(
                                    f"Invalid time format '{new_value}'. Use 'M:SS.ss' or 'H:MM:SS'."
                                )
                                continue

                            new_value = seconds_value
                            # Swap column name
                            db_col_name = "total_timer_time"

                        # Generate the safe query tuple
                        update_tuple = get_lap_update_query(
                            lap_id, db_col_name, new_value
                        )
                        updates.append(update_tuple)

                        # Optional: Toast per successful mapping
                        # st.toast(f"Staged update for {ui_col_name}")

                    else:
                        # Handle calculated columns (like 'Pace' or 'Distance (miles)')
                        st.warning(
                            f"Skipping '{ui_col_name}': Cannot update calculated fields directly."
                        )

            # Clear cache to force a re-fetch of data
            fetch_lap_data.clear()

        set_clauses = []
        query_params = []

        # Check Description
        if updated_description != (ss.activity_details[3]):
            set_clauses.append("description = %s")
            query_params.append(updated_description)

        # Check Title (Activity Name)
        if updated_title != ss.activity_details[7]:
            set_clauses.append("activity_name = %s")
            query_params.append(updated_title)

        # Check Category
        if updated_category != ss.activity_details[8]:
            set_clauses.append("category = %s")
            query_params.append(updated_category)

        # Only proceed if there is at least one change
        if set_clauses:
            # Join the clauses with commas (e.g., "description = %s, category = %s")
            set_logic = ", ".join(set_clauses)

            # Construct the final query
            query = (
                f"UPDATE {ss.schema}.activity SET {set_logic} WHERE activity_id = %s;"
            )

            # Add the activity_id to the end of the parameters for the WHERE clause
            query_params.append(activity_id)

            # Append the query and the parameters (converted to a tuple)
            updates.append((query, tuple(query_params)))

        if updates:
            st.subheader("SQL to run:")

            for query, params in updates:
                # We need to wrap strings in quotes and handle None/Numbers
                display_params = []
                for p in params:
                    if isinstance(p, str):
                        # Escape existing apostrophes and wrap the whole thing in quotes
                        clean_p = p.replace("'", "''")
                        display_params.append(f"'{clean_p}'")
                    elif p is None:
                        display_params.append("NULL")
                    else:
                        # Numbers don't get quotes
                        display_params.append(str(p))

                # Python's % operator replaces the %s placeholders with our formatted list
                try:
                    readable_sql = query % tuple(display_params)
                    st.code(readable_sql, language="sql")
                except TypeError:
                    # Fallback if something goes wrong (e.g., if you have % symbols in your text)
                    st.warning(
                        "Could not format perfectly, showing raw query and params:"
                    )
                    st.text(f"Query: {query}")
                    st.text(f"Params: {params}")
                # with conn.cursor() as cur:
                # cur.execute(query, params)
                # st.balloons()
        else:
            st.info("No changes detected.")
            # Rerun the script to show the latest data from the DB
            # st.rerun()
