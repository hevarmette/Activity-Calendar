# remove stopped time in auto laps
# TODO: Pills to sort laps by intensity
# when using the arrows to change activity for the second page
# ss.sport type or whatever it is doesn't get changed
import streamlit as st
from datetime import datetime
from streamlit_folium import st_folium
from datetime import timedelta
from streamlit_calendar import calendar
from streamlit import session_state as ss
from db import (
    get_connection,
    retrieve_monthly_data,
    fetch_activity_details,
    fetch_activity_points,
)
from plotting import create_activity_map

ss.schema = st.secrets.postgresql.schema


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
        miles = distance_m / ss.meters_to_miles
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
        if description not in [None, "0", ""]:
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
            feel_string = ""  # not used rn. might display the label with the image

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

        with subcol3:
            # --- View Details Button ---
            if st.button("View Lap Details 📈"):
                ss.selected_activity_id = activity_id
                ss.selected_activity_sport = activity_sport
                st.switch_page("pages/2_Activity_Details.py")


# --- Callbacks ---
def year_cb():
    """Called when there is a change in Year selectbox."""
    ss["selected_year"] = ss["yeark"]


def month_cb():
    """Called when there is a change in Month selectbox."""
    ss["selected_month"] = ss["monthk"]


if __name__ == "__main__":
    st.set_page_config(page_title="Activity Calendar", layout="wide")

    conn = get_connection(local=False)

    # --- Fetch and Format Data ---
    # Call the fake data generator instead of the database function
    # activities_df = generate_fake_activity_data(selected_year, selected_month)
    if "activities_df" not in ss:
        ss.activities_df = retrieve_monthly_data(conn)
    if "meters_to_miles" not in ss:
        ss.meters_to_miles = 1609.344

    # --- Sidebar for Navigation ---
    with st.sidebar:
        st.header("Navigation")
        today = datetime.now()

        # --- Initialize defaults if not in session ---
        if "selected_year" not in ss:
            ss["selected_year"] = today.year

        if "selected_month" not in ss:
            ss["selected_month"] = today.month

        # --- Year Selectbox ---
        st.number_input(
            "Year",
            value=ss["selected_year"],  # defaults to current year if unset
            step=1,
            key="yeark",
            on_change=year_cb,
        )

        # --- Month Selectbox ---
        month_options = list(range(1, 13))
        st.selectbox(
            "Month",
            options=month_options,
            index=month_options.index(ss["selected_month"]),
            key="monthk",  # key for widget value
            on_change=month_cb,
            format_func=lambda x: datetime(2000, x, 1).strftime("%B"),
        )

        st.divider()

        if st.button(
            "Fetch New Activities", help="This will clear the cache and reload the page"
        ):
            retrieve_monthly_data.clear()
            del ss["activities_df"]
            st.toast("Fetching new activities")

    calendar_events = []
    if "activities_df" in ss:
        if not ss.activities_df.empty:
            for index, row in ss.activities_df.iterrows():
                sport = row["sport"]
                color_map = {
                    "running": "#FF4B4B",
                    "swimming": "#1F77B4",
                    "cycling": "#2CA02C",
                }

                calendar_events.append(
                    {
                        "title": row["activity_name"],
                        "color": color_map.get(sport, "#7F7F7F"),
                        "start": row["activity_date"].isoformat(),
                        "end": row["activity_date"].isoformat(),
                        "extendedProps": {
                            "activity_id": row["activity_id"],
                            "sport": sport,
                        },
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
        "initialDate": f"{ss.selected_year}-{ss.selected_month:02d}-01",
        "height": "700px",
    }

    # --- Render Calendar and Capture Callback State ---
    state = calendar(
        events=calendar_events,
        options=calendar_options,
        key=f"cal-{ss.selected_year}-{ss.selected_month}",
    )

    st.divider()

    # --- 4. HANDLE CLICKS and DISPLAY DIALOG ---
    if state and state.get("callback") == "eventClick":
        clicked_event = state["eventClick"]["event"]

        activity_title = clicked_event.get("title", "N/A")
        extended_props = clicked_event.get("extendedProps", {})
        activity_id = extended_props.get("activity_id", "N/A")
        activity_sport = extended_props.get("sport", "N/A")

        show_activity_dialog(activity_title, activity_id, activity_sport)
