# data fix: efforts that are not multiples of 10

import streamlit as st
import pandas as pd
import numpy as np
from datetime import datetime
import random
import psycopg2
import folium
from folium import plugins
import branca
from streamlit_folium import st_folium
from datetime import datetime, timedelta
from streamlit_calendar import calendar
from streamlit import session_state as ss
from db import get_connection

# --- 1. FAKE DATA GENERATION (Replaces Database Functions) ---
# Use @st.cache_data to cache the results so the fake data doesn't change on every rerun.
# @st.cache_data
# def generate_fake_activity_data(year, month):
#     """Generates a Pandas DataFrame with fake activity data for a given month and year."""

#     # Define some sample activity names and sports
#     activity_templates = {
#         "running": ["Morning Run", "City Park Loop", "Hill Sprints", "Evening Jog"],
#         "swimming": ["Lap Swim", "Open Water Practice", "Pool Drills"],
#         "cycling": ["Road Ride", "Commute to Work", "Hill Climb Challenge", "City Tour"]
#     }
#     sports = ["running", "swimming", "cycling"]

#     # List to hold our fake activities
#     fake_activities = []

#     # Start with a unique activity ID
#     activity_id_counter = year * 1000 + month * 100

#     # Generate a random number of activities for the month (e.g., between 10 and 20)
#     for _ in range(random.randint(10, 20)):
#         # Pick a random day and sport
#         day = random.randint(1, 28) # Use 28 to avoid month-end issues
#         sport = random.choice(sports)

#         # Create a timestamp for a random time on that day
#         activity_date = datetime(year, month, day, random.randint(6, 20), random.randint(0, 59))

#         # Pick a random name for the chosen sport
#         activity_name = random.choice(activity_templates[sport])

#         # Add the activity to our list
#         fake_activities.append({
#             "activity_id": activity_id_counter,
#             "activity_date": activity_date,
#             "activity_name": activity_name,
#             "sport": sport,
#         })

#         activity_id_counter += 1

#     # Convert the list of dictionaries to a Pandas DataFrame
#     return pd.DataFrame(fake_activities)

# @st.cache_data
# def generate_fake_map_data(activity_id):
#     """Generates a DataFrame of fake GPS points simulating a route in Alabama."""
#     # Starting point in Vestavia Hills, AL
#     lat_start, lon_start = 33.4487, -86.7878

#     data = []
#     current_lat, current_lon = lat_start, lon_start
#     current_time = datetime.now()
#     lap_counter = 1

#     # Generate between 200 and 500 GPS points for the route
#     num_points = random.randint(200, 500)

#     for i in range(num_points):
#         # Simulate movement with a small random step
#         current_lat += random.uniform(-0.00015, 0.00015)
#         current_lon += random.uniform(-0.00015, 0.00015)

#         # Increment lap every 75 points
#         if i > 0 and i % 75 == 0:
#             lap_counter += 1

#         data.append({
#             "timestamp": current_time,
#             "latitude": current_lat,
#             "longitude": current_lon,
#             "lap": lap_counter,
#             "altitude": random.uniform(180.0, 220.0),
#             "heart_rate": random.randint(120, 175),
#             "enhanced_speed": random.uniform(2.5, 4.5), # Speed in m/s (running pace)
#             'distance_m': random.uniform(5,12)
#         })

#         current_time += timedelta(seconds=random.randint(2, 5))

#     return pd.DataFrame(data)

# @st.cache_data
# def generate_fake_activity_details(activity_id):
#     """Generates a tuple of fake activity details."""
#     fake_details = (
#         random.uniform(5000, 15000),  # adjusted_distance (in meters)
#         random.uniform(1800, 5400),   # adjusted_duration (in seconds)
#         random.choice(["Great morning run!", "Tough hill session.", "Easy recovery jog.", None]), # description
#         random.randint(3, 5),          # workout_feel
#         random.randint(6, 9),          # effort
#         datetime.now() - timedelta(days=random.randint(1, 30)) # local_timestamp
#     )
# return fake_details


conn = get_connection()


# --- 2. DATA RETRIEVAL (Same as before) ---
@st.cache_data
def retrieve_monthly_data(_conn, year, month):
    """Fetches activity data for a given month and year from the database."""
    if _conn is None:
        return pd.DataFrame()

    # sql_query = """
    #     SELECT
    #         a.activity_id,
    #         a.timestamp AS activity_date,
    #         a.activity_name,
    #         s.sport
    #     FROM public.activity a
    #     JOIN public.session s ON a.activity_id = s.activity_id
    #     WHERE
    #         EXTRACT(YEAR FROM a.timestamp) = %s
    #         AND EXTRACT(MONTH FROM a.timestamp) = %s
    #     GROUP BY a.activity_id, s.sport;
    # """
    # try:
    #     df = pd.read_sql_query(sql_query, _conn, params=(year, month))
    #     return df
    sql_query = """
        SELECT
            a.activity_id,
            a.timestamp AS activity_date,
            a.activity_name,
            s.sport
        FROM public.activity a
        JOIN public.session s ON a.activity_id = s.activity_id
        GROUP BY a.activity_id, s.sport
		ORDER BY activity_date DESC;
    """
    try:
        df = pd.read_sql_query(sql_query, _conn)
        return df
    except Exception as e:
        st.error(f"Error executing query: {e}")
        return pd.DataFrame()


@st.cache_data
def fetch_activity_details(_conn, activity_id):
    """Fetches main details for a specific activity from the database."""
    if _conn is None:
        return None
    sql_query = """
        SELECT adjusted_distance, adjusted_duration, CAST(avg_power AS INTEGER), description, workout_feel, effort, local_timestamp, activity_name, category
        FROM public.activity JOIN public.session ON activity.activity_id = session.activity_id WHERE activity.activity_id = %s
    """
    try:
        with _conn.cursor() as cursor:
            cursor.execute(sql_query, (activity_id,))
            activity_data = cursor.fetchone()  # won't cause trouble with multisport
        # ss.activity_details = activity_data
        return activity_data
    except Exception as e:
        st.error(f"Error fetching activity details: {e}")
        return None


# --- 2. DATA FETCHING FOR MAP ---
@st.cache_data
def fetch_activity_points(_conn, activity_id):
    """Fetches GPS and other record data for a specific activity from the database."""
    if _conn is None:
        return pd.DataFrame()

    sql_query = """
        SELECT *--timestamp, latitude, longitude, lap, altitude, heart_rate, enhanced_speed
        FROM public.record
        WHERE activity_id = %s ORDER BY timestamp ASC
    """
    try:
        points_df = pd.read_sql_query(sql_query, _conn, params=(activity_id,))
        if not points_df.empty:
            # Ensure lat/lon are numeric and not null
            points_df["latitude"] = pd.to_numeric(
                points_df["latitude"], errors="coerce"
            )
            points_df["longitude"] = pd.to_numeric(
                points_df["longitude"], errors="coerce"
            )
            points_df["elapsed_time"] = points_df["timestamp"] - np.repeat(
                points_df["timestamp"].iloc[0], len(points_df)
            )
            points_df.dropna(subset=["latitude", "longitude"], inplace=True)
        return points_df
    except Exception as e:
        st.error(f"Error fetching activity points: {e}")
        return pd.DataFrame()


# --- 3. MAP CREATION (Your adapted function) ---
def create_activity_map(points_df):
    """Creates a Folium map from a DataFrame of points."""
    laps = []

    # Get coordinates for map
    coordinates = list(
        points_df[["latitude", "longitude"]].itertuples(index=False, name=None)
    )

    # Make map object
    route_map = folium.Map()

    # Add different tile layers for user to choose
    folium.TileLayer("OpenStreetMap", show=True).add_to(route_map)
    folium.TileLayer("USGS_USTopo", show=False).add_to(route_map)
    folium.TileLayer("Esri.WorldImagery", show=False).add_to(route_map)

    # Make line segments
    red_lines = folium.FeatureGroup(name="Default Line Color", show=True).add_to(
        route_map
    )
    folium.PolyLine(locations=coordinates, weight=5, color="red").add_to(red_lines)

    # Colored line based on speed
    if (
        "enhanced_speed" in points_df.columns
        and not points_df["enhanced_speed"].isnull().all()
    ):
        colored_lines = folium.FeatureGroup(name="Speed", show=False).add_to(route_map)
        folium.ColorLine(
            positions=coordinates,
            colors=points_df["enhanced_speed"],
            colormap=branca.colormap.linear.plasma.scale(
                points_df["enhanced_speed"].min(), points_df["enhanced_speed"].max()
            ),
            weight=6,
        ).add_to(colored_lines)

    # Get total number of laps
    nlaps = points_df["lap"].iloc[-1]
    # for some reason activities with latest watch that are pre defined workout has every record marked as the last lap
    # which means there are no laps to mark except for the last one aka the end marker. IDK why and how to figure out
    # the rest so I want plot markers with with one unique lap number
    ulaps = points_df["lap"].unique()

    # Find the coordinates of the first occurance of a lap i.e. the end of previous lap. markers = nlaps - 1
    # (first lap will be the start button and stop button will be lap end of final lap)
    # iterating backwards because last laps are first: i think?
    if len(ulaps) > 1:
        while nlaps > 1:  # exclude first marker (start)
            laps.append(
                points_df[["latitude", "longitude"]].iloc[
                    points_df["lap"]
                    .where(points_df["lap"] == nlaps)
                    .first_valid_index(),
                    :,
                ]
            )
            nlaps = nlaps - 1

        # Make the lap markers
        icons = folium.FeatureGroup(name="Laps", show=True).add_to(route_map)

        # Includes all laps
        for i in range(len(laps) - 1, -1, -1):
            icon_number = folium.plugins.BeautifyIcon(
                border_color="white", text_color="black", number=len(laps) - i
            )
            folium.Marker(
                location=[laps[i]["latitude"], laps[i]["longitude"]], icon=icon_number
            ).add_to(icons)

    # Get start and end points_df and plot as marker
    start = points_df[["latitude", "longitude"]].iloc[0, :]
    end = points_df[["latitude", "longitude"]].iloc[-1, :]
    start_marker = folium.plugins.BeautifyIcon(
        icon="play",
        icon_shape="marker",
        background_color="#1EB300",
        border_color="#1EB300",
        text_color="white",
    )
    end_marker = folium.plugins.BeautifyIcon(
        icon="stop",
        icon_shape="marker",
        background_color="red",
        border_color="red",
        text_color="white",
    )
    folium.Marker(
        location=[start["latitude"], start["longitude"]], icon=start_marker
    ).add_to(route_map)
    folium.Marker(location=[end["latitude"], end["longitude"]], icon=end_marker).add_to(
        route_map
    )

    # Automatic fit and zoom
    route_map.fit_bounds(route_map.get_bounds())

    folium.LayerControl(position="topright").add_to(route_map)
    return route_map


# @st.dialog("Activity Details", width='medium')
# def show_activity_dialog(activity_title, activity_id, activity_sport):
#     """
#     Displays activity details and map.
#     It fetches details, stores them in session state, and then displays them.
#     """
#     st.header(activity_title)
#     st.markdown(f"**Sport:** {activity_sport.capitalize()} | **Activity ID:** `{activity_id}`")

#     # --- Store details in Session State ---
#     # We use the fake data function here. Swap with fetch_activity_details(conn, activity_id) for real data.
#     # activity_data = generate_fake_activity_details(activity_id)
#     activity_data = fetch_activity_details(conn, activity_id)
#     if activity_data:
#         ss.activity_details = activity_data
#     else:
#         ss.activity_details = None
#     # points_df = generate_fake_map_data(activity_id) # Using fake map data
#     points_df = fetch_activity_points(conn, activity_id)
#     ss.points_df = points_df

#     # --- Map Section ---
#     if not points_df.empty:
#         activity_map = create_activity_map(points_df)
#         st_folium(activity_map, width=700, height=500)
#     else:
#         st.warning("No GPS data found for this activity.")
#     st.divider()

#     # --- Display details from Session State ---
#     if ss.activity_details:
#         st.subheader("📊 Activity Stats")
#         distance_km = ss.activity_details[0] / 1000
#         duration_min = ss.activity_details[1] / 60
#         description = ss.activity_details[2] if ss.activity_details[2] else "No description."
#         feel = ss.activity_details[3]
#         effort = ss.activity_details[4]

#         col1, col2 = st.columns(2)
#         col1.metric("Distance", f"{distance_km:.2f} km")
#         col2.metric("Duration", f"{duration_min:.1f} min")

#         st.markdown(f"**Description:** *{description}*")
#         st.markdown(f"**Workout Feel:** {feel}/5 | **Effort:** {effort}/10")

#     if st.button("View Lap Details 📈"):
#         # Store the selected activity_id in the session state
#         ss.selected_activity_id = activity_id
#         ss.selected_activity_sport = activity_sport
#         # Programmatically switch to the details page
#         st.switch_page("pages/2_Activity_Details.py")


@st.dialog("Activity Summary", width="medium")
def show_activity_dialog(activity_title, activity_id, activity_sport):
    """Displays improved activity summary dialog."""

    # Fetch activity details
    activity_data = fetch_activity_details(conn, activity_id)
    if activity_data:
        ss.activity_details = activity_data
    else:
        ss.activity_details = None

    # Fetch GPS points
    points_df = fetch_activity_points(conn, activity_id)
    ss.points_df = points_df

    # --- Header ---
    st.header(activity_title)

    if ss.activity_details:
        distance_m = ss.activity_details[0]
        duration_s = ss.activity_details[1]
        avg_power = ss.activity_details[2]
        description = ss.activity_details[3] if ss.activity_details[3] else ""
        feel = ss.activity_details[4]
        effort = ss.activity_details[5]
        local_timestamp = ss.activity_details[6]

        # Time since activity
        time_ago = datetime.now() - local_timestamp
        st.markdown(f"_{time_ago.days} days ago_")

        # --- Stats ---
        miles = distance_m * 0.0006213711922
        duration_td = timedelta(seconds=int(duration_s))
        duration_hr = duration_s / 3600
        pace_sec_per_mile = duration_s / miles if miles > 0 else 0
        pace_min, pace_sec = divmod(int(pace_sec_per_mile), 60)
        mph = miles / duration_hr if duration_hr > 0 else 0

        col1, col2, col3 = st.columns(3)
        col1.metric("Distance", f"{miles:.2f} mi")
        col2.metric("Duration", str(duration_td))
        if activity_sport == "cycling":
            if avg_power:
                col3.metric("Power", f"{avg_power} watts")
            else:
                col3.metric("Speed", f"{mph:.2f} mph")
        # elif activity_sport == 'swimming':
        #     col3.metric("Pace", f"{} /100m")
        # elif activity_sport == 'multisport'
        #     col3.metic()
        else:
            col3.metric("Pace", f"{pace_min}:{pace_sec:02d} /mi")

        # --- Map ---
        if not points_df.empty:
            activity_map = create_activity_map(points_df)
            st_folium(activity_map, width=700, height=500)
        # else:
        #     st.warning("No GPS data found for this activity.")

        # --- Description ---
        if not description in [None, "0", ""]:
            st.markdown(f"**Description:** *{description}*")

        subcol1, subcol2, subcol3 = st.columns(
            [0.65, 0.08, 0.27], vertical_alignment="center"
        )
        # --- Workout Feel + Effort --
        if feel is not None:
            # Load the SVG file not used rn
            with open(r"assets/normal.svg", "r") as f:
                svg = f.read()
            feel_map = {
                0: "very weak",
                25: "weak",
                50: "normal",
                75: "strong",
                100: "very strong",
            }
            feel_label = feel_map.get(feel, "Unknown")
            feel_string = f"{svg} "
            with subcol2:
                st.image(f"assets/{feel_label.replace(" ", "-")}.svg", width="stretch")
        else:
            feel_string = ""

        if effort is not None:
            effort_labels = {
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
            effort_index = int(effort / 10)
            effort_label = effort_labels.get(effort_index, "Unknown")
            effort_string = f"| **Effort:** {effort_index} – {effort_label}"
            with subcol3:
                st.markdown(f"{effort_string}", unsafe_allow_html=True)
        else:
            effort_string = ""

        with subcol1:
            # --- View Details Button ---
            if st.button("View Lap Details 📈"):
                ss.selected_activity_id = activity_id
                ss.selected_activity_sport = activity_sport
                st.switch_page("pages/2_Activity_Details.py")


st.set_page_config(page_title="Activity Calendar", layout="wide")

# --- Sidebar for Navigation ---
with st.sidebar:
    st.header("Navigation")
    today = datetime.now()
    # Note: Using 2025 as the default year for demonstration
    selected_year = st.selectbox("Year", range(today.year - 5, today.year + 2), index=5)
    selected_month = st.selectbox(
        "Month",
        range(1, 13),
        index=today.month - 1,
        format_func=lambda x: datetime(2000, x, 1).strftime("%B"),
    )

# --- Fetch and Format Data ---
# Call the fake data generator instead of the database function
# activities_df = generate_fake_activity_data(selected_year, selected_month)
if "activities_df" not in ss:
    ss.activities_df = retrieve_monthly_data(conn, selected_year, selected_month)

calendar_events = []
if not ss.activities_df.empty:
    for index, row in ss.activities_df.iterrows():
        sport = row["sport"]
        color_map = {"running": "#FF4B4B", "swimming": "#1F77B4", "cycling": "#2CA02C"}

        calendar_events.append(
            {
                "title": row["activity_name"],
                "color": color_map.get(sport, "#7F7F7F"),
                "start": row["activity_date"].isoformat(),
                "end": row["activity_date"].isoformat(),
                "extendedProps": {"activity_id": row["activity_id"], "sport": sport},
            }
        )

# --- Calendar Configuration ---
calendar_options = {
    "headerToolbar": {
        "left": "today prev,next",
        "center": "title",
        "right": "dayGridMonth,timeGridWeek,timeGridDay",
    },
    "initialView": "dayGridMonth",
    "initialDate": f"{selected_year}-{selected_month:02d}-01",
    "height": "700px",
}

# --- Render Calendar and Capture Callback State ---
state = calendar(
    events=calendar_events,
    options=calendar_options,
    key=f"cal-{selected_year}-{selected_month}",
)

st.divider()

# --- 4. HANDLE CLICKS and DISPLAY DIALOG ---
if state and state.get("callback") == "eventClick":
    clicked_event = state["eventClick"]["event"]

    activity_title = clicked_event.get("title", "N/A")
    extended_props = clicked_event.get("extendedProps", {})
    activity_id = extended_props.get("activity_id", "N/A")
    activity_sport = extended_props.get("sport", "N/A")

    # Call the decorated function to open the dialog
    show_activity_dialog(activity_title, activity_id, activity_sport)
