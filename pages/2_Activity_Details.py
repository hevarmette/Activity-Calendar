import streamlit as st
import pandas as pd
from streamlit import session_state as ss
import random
from datetime import datetime, timedelta
import plotly.express as px
from calendar_test_8 import (
    create_activity_map,
    fetch_activity_details,
    fetch_activity_points,
)
from streamlit_folium import st_folium
from db import get_connection

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


@st.cache_data
def fetch_lap_data(_conn, activity_id):
    """Fetches lap data for a specific activity."""
    # Note: Your query selected '*', which might not match the number of columns provided.
    # It's safer to explicitly name the columns in the SELECT statement.
    sql_query = "SELECT *, (total_distance * 0.0006213711922) AS distance_mi FROM public.lap WHERE activity_id = %s ORDER BY number ASC"
    df = pd.read_sql_query(sql_query, _conn, params=(activity_id,))
    return df


def update_lap_in_db(_conn, lap_id, column_to_update, new_value):
    """Updates a single value in the lap table."""
    with _conn.cursor() as cur:
        # Important: Sanitize column name to prevent SQL injection
        # In a real app, you'd have a whitelist of editable columns.
        safe_column = "".join(c for c in column_to_update if c.isalnum() or c == "_")

        query = f"UPDATE public.lap SET {safe_column} = %s WHERE lap_id = %s"
        cur.execute(query, (new_value, lap_id))
    _conn.commit()


def update_lap_in_db_test(lap_id, column_to_update, new_value):
    """Updates a single value in the lap table."""
    # Important: Sanitize column name to prevent SQL injection
    # In a real app, you'd have a whitelist of editable columns.
    safe_column = "".join(c for c in column_to_update if c.isalnum() or c == "_")

    query = (
        f"UPDATE public.lap SET {safe_column} = {new_value} WHERE lap_id = {lap_id};"
    )
    return query


# --- 2. DATA PROCESSING FUNCTION ---
def process_lap_data(df):
    """Applies all the transformations from your original code."""
    if df.empty:
        return pd.DataFrame()

    # Rename columns to be more user-friendly for the editor
    df.columns = [
        "Lap Id",
        "Activity Id",
        "Start Time",
        "Lap",
        "Distance",
        "Time",
        "Total Ascent",
        "Total Descent",
        "Avg Vertical Oscillation",
        "Avg Stance Time",
        "Avg Vertical Ratio",
        "Avg Stance Time Balance",
        "Avg Stride Length",
        "Avg Running Cadence",
        "Max Heart Rate",
        "Avg Heart Rate",
        "Intensity",
        "Distance (miles)",
    ]

    # --- Your data cleaning and feature engineering logic ---
    # df['Distance (miles)'] = round(df['Distance'] / 1609.34, 2) in query now

    # Calculate pace only where distance is not zero
    non_zero_dist = df["Distance"] > 0
    df["Pace (min/mile)"] = None
    df.loc[non_zero_dist, "Pace (min/mile)"] = (df["Time"] / 60) / df[
        "Distance (miles)"
    ]
    df["Pace (min/mile)"] = df["Pace (min/mile)"].apply(
        lambda x: f"{int(x)}:{round((x % 1) * 60):02d}" if pd.notna(x) else None
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
        "Intensity",
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

    df["Distance (miles)"] = round(df["Distance"] / 1609.34, 2)

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
        st.info(f"Data for '{title}' is not available for this activity.")
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
        category = ss.activity_details[8].strip()
        category_options = [
            "uncategorized",
            "training",
            "race",
            "transportation",
            "recreational",
            "touring",
            "fitness",
        ]
        cat_index = category_options.index(category)
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
            miles = distance_m * 0.0006213711922
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
            x_col, x_label = "distance", "Distance (km)"
        else:
            x_col, x_label = "elapsed_time", "Time (minutes)"

        # Check if the chosen x-axis data exists
        if x_col not in point_df.columns:
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

            cad_fig = create_plot(
                df=point_df,
                x_col=x_col,
                y_col="cadence",
                x_label=x_label,
                y_label="Cadence",
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
                    required=True,
                ),
                "Activity Id": None,
                "Lap Id": None,
                "Distance (miles)": st.column_config.NumberColumn(format="%.2f"),
            }

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

            with c1:
                st.markdown("**Distance**")
                st.write(f"{miles:.2f} mi")
                st.markdown("---")
                st.markdown("**Pace / Speed**")
                if sport == "cycling":
                    st.write(f"{mph:.2f} mph")
                else:
                    st.write(f"{pace_min}:{pace_sec:02d} /mi")

            with c2:
                # getting summary stats if the column is present
                # TODO: add average statistics for active reps for intervals
                if "hr" in ss and ss.hr:
                    avg_hr = point_df.loc[:, "heart_rate"].mean()
                    max_hr = point_df.loc[:, "heart_rate"].max()

                    st.markdown("**Heart Rate**")
                    st.write(f"Avg HR: {avg_hr} bpm")
                    st.write(f"Max HR: {max_hr} bpm")
                    st.markdown("---")

                st.markdown("**Duration**")
                st.write(str(duration_td))

            with c3:
                if "coordinates" in ss and ss.coordinates:
                    # This creates a new Series where each value is (row[i] - row[i-1])
                    altitude_change = point_df["corrected_altitude"].diff()

                    # Calculate Ascent:
                    # Filter for only positive changes (gains) and sum them up.
                    # .clip(lower=0) sets all negative numbers to 0.
                    total_ascent = altitude_change.clip(lower=0).sum()

                    # Calculate Descent:
                    # Filter for only negative changes (losses), make them positive, and sum them up.
                    # .clip(upper=0) sets all positive numbers to 0.
                    # .abs() makes the negative changes positive.
                    total_descent = altitude_change.clip(upper=0).abs().sum()
                    st.markdown("**Elevation**")
                    st.write(f"Ascent: {total_ascent} feet")
                    st.write(f"Descent: {total_descent} feet")
                    st.markdown("---")
                st.markdown("**Pace / Speed Info**")
                st.write("Best lap pace: {info} will go here")

            with c4:
                if "cadence" in ss and ss.cadence:
                    avg_cadence = point_df.loc[:, "total_cadence"].mean()
                    max_cadence = point_df.loc[:, "total_cadence"].max()
                    st.markdown("**Running Dynamics**")
                    st.write(f"Avg cadence: {avg_cadence} spm")
                    st.write(f"Max cadence: {max_cadence} spm")

                # if ss.dynamics
                st.write("Stride length: {info} will go here")
                st.write("Vertical ratio: {info} will go here")
                st.write("Stance time balance: {info} will go here")

    if st.button("Save"):
        updates = []
        # Check for edits by comparing the new state to the previous one
        if "lap_editor" in ss and ss.lap_editor.get("edited_rows"):
            # st.info("Changes detected. Saving to database...")

            # The edited_rows dict tells us exactly what changed
            for row_idx, changes in ss.lap_editor["edited_rows"].items():
                # Get the lap_id for the edited row
                lap_id = processed_laps_df.iloc[row_idx]["Lap Id"]

                for col_name, new_value in changes.items():
                    try:
                        # Find the original column name if we renamed it
                        # This part needs to be robust based on your column mapping
                        original_col = col_name  # Placeholder - adjust if needed
                        ### update_lap_in_db(conn, lap_id, original_col, new_value)
                        updates.append(
                            update_lap_in_db_test(lap_id, original_col, new_value)
                        )
                        st.toast(f"Updated {col_name} for Lap ID {lap_id}!")
                    except Exception as e:
                        st.error(f"Failed to update {col_name}. Error: {e}")

            # Clear cache to force a re-fetch of data
            fetch_lap_data.clear()

        if updated_title != ss.activity_details[7]:
            updates.append(
                f"UPDATE public.activity SET activity_name = '{updated_title}' WHERE activity_id = {activity_id};"
            )
        if updated_category != ss.activity_details[8]:
            updates.append(
                f"UPDATE public.activity SET category = '{updated_category}' WHERE activity_id = {activity_id};"
            )
        if updated_description != (ss.activity_details[3] or ""):
            updates.append(
                f"UPDATE public.activity SET description = '{updated_description}' WHERE activity_id = {activity_id};"
            )

        if updates:
            st.subheader("SQL to run:")
            for q in updates:
                st.code(q, language="sql")
        else:
            st.info("No changes detected.")
            # Rerun the script to show the latest data from the DB
            # st.rerun()
st.write(point_df)
