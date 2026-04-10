import streamlit as st
import pandas as pd
import plotly.express as px
from streamlit import session_state as ss
from db import get_connection, fetch_report_data
from utils import init_session_state, convert_seconds_to_hms, format_pace

init_session_state()

SPORT_COLORS = {
    "running": "#FF4B4B",
    "cycling": "#2CA02C",
    "swimming": "#1F77B4",
    "multisport": "#FF8C00",
}

GROUPING_OPTIONS = {
    "Daily": "D",
    "Weekly": "W",
    "Monthly": "MS",
    "Yearly": "YS",
}


def aggregate_data(df, freq, sports):
    """Group raw session rows by time period and sport."""
    filtered = df[df["sport"].isin(sports)].copy()
    if filtered.empty:
        return pd.DataFrame()

    filtered["period"] = filtered["local_timestamp"].dt.to_period(
        {"D": "D", "W": "W", "MS": "M", "YS": "Y"}[freq]
    )

    agg = (
        filtered.groupby(["period", "sport"])
        .agg(
            activities=("activity_id", "nunique"),
            total_distance_m=("total_distance", "sum"),
            total_time_s=("total_timer_time", "sum"),
            total_calories=("total_calories", "sum"),
            total_ascent=("total_ascent", "sum"),
            total_descent=("total_descent", "sum"),
            avg_hr=("avg_heart_rate", "mean"),
            max_hr=("max_heart_rate", "max"),
        )
        .reset_index()
    )

    agg["distance_mi"] = agg["total_distance_m"] / ss.meters_to_miles
    agg["avg_distance_mi"] = agg["distance_mi"] / agg["activities"]
    agg["avg_time_s"] = agg["total_time_s"] / agg["activities"]
    agg["period_label"] = agg["period"].astype(str)

    return agg


def _format_pace_speed(row):
    """Return a sport-appropriate pace or speed string for an aggregated row."""
    dist_m = row["total_distance_m"]
    time_s = row["total_time_s"]
    sport = row["sport"]

    if dist_m <= 0 or time_s <= 0:
        return ""

    if sport == "cycling":
        miles = dist_m / ss.meters_to_miles
        hours = time_s / 3600
        return f"{miles / hours:.1f} mph"

    if sport == "swimming":
        # pace per 100 meters: seconds per 100m -> M:SS /100m
        pace_s_per_100m = time_s / (dist_m / 100)
        mins, secs = divmod(int(round(pace_s_per_100m)), 60)
        return f"{mins}:{secs:02d} /100m"

    # running and everything else: pace per mile
    miles = dist_m / ss.meters_to_miles
    pace_min_per_mile = (time_s / 60) / miles
    return f"{format_pace(pace_min_per_mile)} /mi"


def build_summary_table(agg):
    """Format the aggregated dataframe for display."""
    display = pd.DataFrame()
    display["Period"] = agg["period_label"]
    display["Sport"] = agg["sport"].str.capitalize()
    display["Activities"] = agg["activities"]
    display["Distance (mi)"] = agg["distance_mi"].round(2)
    display["Total Time"] = agg["total_time_s"].apply(convert_seconds_to_hms)
    display["Avg Pace / Speed"] = agg.apply(_format_pace_speed, axis=1)
    display["Avg Distance (mi)"] = agg["avg_distance_mi"].round(2)
    display["Avg Time"] = agg["avg_time_s"].apply(convert_seconds_to_hms)
    display["Calories"] = agg["total_calories"].fillna(0).astype(int)
    display["Elevation Gain (ft)"] = (agg["total_ascent"].fillna(0) * 3.28084).astype(int)
    display["Avg HR"] = agg["avg_hr"].round(0).fillna(0).astype(int)
    display["Max HR"] = agg["max_hr"].fillna(0).astype(int)
    return display


# --- Page Config ---
st.set_page_config(page_title="Activity Report", layout="wide")

conn = get_connection(local=True)
raw_df = fetch_report_data(conn)

if raw_df.empty:
    st.warning("No activity data found.")
    st.stop()

# Clean up nulls in key columns
raw_df["total_distance"] = raw_df["total_distance"].fillna(0)
raw_df["total_timer_time"] = raw_df["total_timer_time"].fillna(0)
raw_df["sport"] = raw_df["sport"].fillna("other")

available_sports = sorted(raw_df["sport"].unique().tolist())

# --- Sidebar Controls ---
with st.sidebar:
    st.header("Report Settings")

    default_sports = ["running"] if "running" in available_sports else available_sports
    selected_sports = st.multiselect(
        "Sports",
        options=available_sports,
        default=default_sports,
        format_func=lambda x: x.capitalize(),
    )

    grouping = st.selectbox("Group By", options=list(GROUPING_OPTIONS.keys()), index=2)

    chart_metric = st.selectbox(
        "Chart Metric",
        options=["Distance (mi)", "Time (hours)", "Activities", "Calories"],
    )

    st.divider()
    if st.button("Refresh Data", help="Clear cache and reload"):
        fetch_report_data.clear()
        st.rerun()

if not selected_sports:
    st.info("Select at least one sport to view the report.")
    st.stop()

freq = GROUPING_OPTIONS[grouping]
agg = aggregate_data(raw_df, freq, selected_sports)

if agg.empty:
    st.info("No data for the selected filters.")
    st.stop()

# --- Summary Metrics ---
st.title("Activity Report")

total_activities = agg["activities"].sum()
total_distance = agg["distance_mi"].sum()
total_time_s = agg["total_time_s"].sum()
total_calories = agg["total_calories"].sum()

col1, col2, col3, col4 = st.columns(4)
col1.metric("Total Activities", f"{total_activities:,}")
col2.metric("Total Distance", f"{total_distance:,.1f} mi")
col3.metric("Total Time", convert_seconds_to_hms(total_time_s))
col4.metric("Total Calories", f"{total_calories:,.0f}")

st.divider()

# --- Aggregated Table (primary focus) ---
st.subheader(f"{grouping} Summary by Sport")
display_df = build_summary_table(agg)
st.dataframe(
    display_df.sort_values(["Period", "Sport"], ascending=[False, True]),
    width='stretch',
    hide_index=True,
)

st.divider()

# --- Bar Chart ---
chart_df = agg.copy()
chart_df = chart_df[chart_df["period"].apply(lambda p: p.start_time) <= pd.Timestamp.now()]
chart_df["time_hours"] = chart_df["total_time_s"] / 3600

metric_map = {
    "Distance (mi)": "distance_mi",
    "Time (hours)": "time_hours",
    "Activities": "activities",
    "Calories": "total_calories",
}

y_col = metric_map[chart_metric]

fig = px.bar(
    chart_df.sort_values("period"),
    x="period_label",
    y=y_col,
    color="sport",
    color_discrete_map={**SPORT_COLORS, **{s: "#7F7F7F" for s in available_sports if s not in SPORT_COLORS}},
    barmode="stack",
    labels={
        "period_label": "Period",
        y_col: chart_metric,
        "sport": "Sport",
    },
    title=f"{chart_metric} by {grouping} Period",
)
fig.update_layout(
    xaxis_tickangle=-45,
    plot_bgcolor="rgba(0,0,0,0)",
    paper_bgcolor="rgba(0,0,0,0)",
    font_color="white",
    legend_title_text="Sport",
)
fig.update_traces(
    texttemplate=None,
)

st.plotly_chart(fig, width='stretch')
