import streamlit as st
import pandas as pd
from streamlit import session_state as ss
from db import get_connection, fetch_search_data
from utils import init_session_state, convert_seconds_to_hms, render_activity_card

init_session_state()

# --- Session state for search lifecycle ---
if "search_submitted" not in ss:
    ss.search_submitted = False





def _aggregate_activities(df):
    """Aggregate session-level rows into one row per activity."""
    agg = (
        df.groupby("activity_id")
        .agg(
            local_timestamp=("local_timestamp", "first"),
            activity_name=("activity_name", "first"),
            category=("category", "first"),
            num_sessions=("num_sessions", "first"),
            sport=("sport", lambda x: ",".join(x)),
            sub_sport=("sub_sport", lambda x: ",".join(x.dropna().unique())),
            total_distance=("total_distance", "sum"),
            total_timer_time=("total_timer_time", "sum"),
            total_calories=("total_calories", "sum"),
            total_ascent=("total_ascent", "sum"),
            total_descent=("total_descent", "sum"),
            avg_heart_rate=("avg_heart_rate", "mean"),
            max_heart_rate=("max_heart_rate", "max"),
        )
        .reset_index()
    )
    return agg.sort_values("local_timestamp", ascending=False)


def _canonical_sport(sport_str, num_sessions):
    """Determine canonical sport label from comma-separated sport string."""
    sports = [s.strip() for s in sport_str.split(",")]
    if (num_sessions or 1) > 1 or len(set(sports)) > 1:
        return "multisport"
    return sports[0] if sports else "other"


def _render_filters(container, available_sports, available_sub_sports, available_categories,
                    min_date, max_date):
    """Render all search filter widgets into the given container. Returns filter values."""

    default_sport = 'running' if 'running' in available_sports else available_sports

    with container:
        selected_sports = st.multiselect(
            "Sport",
            options=available_sports,
            default=default_sport,
            format_func=lambda x: x.capitalize(),
            key="filter_sport",
        )

        selected_sub_sports = st.multiselect(
            "Sub Sport",
            options=available_sub_sports,
            format_func=lambda x: x.replace("_", " ").capitalize(),
            key="filter_sub_sport",
        )

        selected_categories = st.multiselect(
            "Category",
            options=available_categories,
            format_func=lambda x: x.strip().capitalize(),
            key="filter_category",
        )

        st.markdown("**Date Range**")
        date_col1, date_col2 = st.columns(2)
        with date_col1:
            start_date = st.date_input("From", value=min_date, min_value=min_date,
                                       max_value=max_date, key="filter_date_from")
        with date_col2:
            end_date = st.date_input("To", value=max_date, min_value=min_date,
                                     max_value=max_date, key="filter_date_to")

        st.markdown("**Distance (miles)**")
        dist_col1, dist_col2 = st.columns(2)
        with dist_col1:
            min_distance = st.number_input("Min", min_value=0.0, value=0.0, step=0.5,
                                           key="filter_min_dist")
        with dist_col2:
            max_distance = st.number_input("Max", min_value=0.0, value=0.0, step=0.5,
                                           key="filter_max_dist", help="0 = no limit")

        st.markdown("**Duration (minutes)**")
        dur_col1, dur_col2 = st.columns(2)
        with dur_col1:
            min_duration = st.number_input("Min", min_value=0.0, value=0.0, step=5.0,
                                           key="filter_min_dur")
        with dur_col2:
            max_duration = st.number_input("Max", min_value=0.0, value=0.0, step=5.0,
                                           key="filter_max_dur", help="0 = no limit")

    return {
        "sports": selected_sports,
        "sub_sports": selected_sub_sports,
        "categories": selected_categories,
        "start_date": start_date,
        "end_date": end_date,
        "min_distance": min_distance,
        "max_distance": max_distance,
        "min_duration": min_duration,
        "max_duration": max_duration,
    }


def _apply_filters(raw_df, f):
    """Apply all filters and return aggregated activity-level DataFrame."""
    filtered = raw_df.copy()

    if f["sports"]:
        filtered = filtered[filtered["sport"].isin(f["sports"])]
    if f["sub_sports"]:
        filtered = filtered[filtered["sub_sport"].isin(f["sub_sports"])]
    if f["categories"]:
        filtered = filtered[filtered["category"].str.strip().isin(f["categories"])]

    # Date filter
    if pd.notna(f["start_date"]):
        filtered = filtered[filtered["local_timestamp"].dt.date >= f["start_date"]]
    if pd.notna(f["end_date"]):
        filtered = filtered[filtered["local_timestamp"].dt.date <= f["end_date"]]

    # Aggregate to activity level before distance/duration filters
    activities = _aggregate_activities(filtered)
    if activities.empty:
        return activities

    activities["_distance_mi"] = activities["total_distance"] / ss.meters_to_miles
    activities["_duration_min"] = activities["total_timer_time"] / 60

    if f["min_distance"] > 0:
        activities = activities[activities["_distance_mi"] >= f["min_distance"]]
    if f["max_distance"] > 0:
        activities = activities[activities["_distance_mi"] <= f["max_distance"]]
    if f["min_duration"] > 0:
        activities = activities[activities["_duration_min"] >= f["min_duration"]]
    if f["max_duration"] > 0:
        activities = activities[activities["_duration_min"] <= f["max_duration"]]

    return activities


RESULTS_PER_PAGE = 100


def _render_results(activities, conn):
    """Render activity result cards with pagination."""
    total = len(activities)
    total_pages = max(1, -(-total // RESULTS_PER_PAGE))  # ceil division

    if "search_page" not in ss:
        ss.search_page = 1
    ss.search_page = min(ss.search_page, total_pages)

    start = (ss.search_page - 1) * RESULTS_PER_PAGE
    end = min(start + RESULTS_PER_PAGE, total)
    page_df = activities.iloc[start:end]

    st.caption(f"{total} activities found — showing {start + 1}–{end}")

    # Pagination controls (top)
    _render_pagination(total_pages, position="top")

    for _, row in page_df.iterrows():
        canonical_sport = _canonical_sport(row["sport"], row["num_sessions"])
        render_activity_card(row, canonical_sport, conn, key_prefix="search")

    # Pagination controls (bottom)
    _render_pagination(total_pages, position="bottom")


def _render_pagination(total_pages, position="bottom"):
    """Render prev/page/next pagination controls."""
    if total_pages <= 1:
        return
    prev_col, info_col, next_col = st.columns([1, 2, 1])
    with prev_col:
        if st.button("← Previous", key=f"prev_{position}", disabled=ss.search_page <= 1,
                      width='stretch'):
            ss.search_page -= 1
            st.rerun()
    with info_col:
        st.markdown(
            f"<div style='text-align:center;padding-top:6px'>Page {ss.search_page} of {total_pages}</div>",
            unsafe_allow_html=True,
        )
    with next_col:
        if st.button("Next →", key=f"next_{position}", disabled=ss.search_page >= total_pages,
                      width='stretch'):
            ss.search_page += 1
            st.rerun()


# --- Page Config ---
st.set_page_config(page_title="Activity Search", layout="wide")
title_col, secondary_col = st.columns([0.8, 0.2], vertical_alignment='bottom', gap="xxlarge")
with title_col:
    st.title("Activity Search")
with secondary_col:
    with st.popover("Sort Options", width="stretch"):
        sort_options = {"Distance": "total_distance", "Duration": "total_timer_time"}
        sort_keys = st.segmented_control("Values to sort by", sort_options.keys(), selection_mode="multi")
        sort_selection = [sort_options[key] for key in sort_keys] if sort_keys else []
        sort_direction = st.pills(
            "Sort direction — selected = ascending, unselected = descending",
            options=sort_selection,
            selection_mode="multi",
        )

        # Build the boolean list aligned with sort_columns
        sort_direction = [col in sort_direction for col in sort_selection]

conn = get_connection(local=True)
raw_df = fetch_search_data(conn)

if raw_df.empty:
    st.warning("No activity data found.")
    st.stop()

# Clean nulls
raw_df["total_distance"] = raw_df["total_distance"].fillna(0)
raw_df["total_timer_time"] = raw_df["total_timer_time"].fillna(0)
raw_df["sport"] = raw_df["sport"].fillna("other")
raw_df["sub_sport"] = raw_df["sub_sport"].fillna("")
raw_df["category"] = raw_df["category"].str.strip().fillna("uncategorized")
raw_df["activity_name"] = raw_df["activity_name"].fillna("Untitled")

available_sports = sorted(raw_df["sport"].unique().tolist())
available_sub_sports = sorted([s for s in raw_df["sub_sport"].unique().tolist() if s])
available_categories = sorted(raw_df["category"].unique().tolist())

# Date bounds from data
min_date = raw_df["local_timestamp"].min().date()
max_date = raw_df["local_timestamp"].max().date()

# --- Layout depends on whether a search has been submitted ---
if not ss.search_submitted:
    # Filters on main page
    st.subheader("Search Filters")
    filters = _render_filters(st.container(), available_sports, available_sub_sports,
                              available_categories, min_date, max_date)

    if st.button("Search", type="primary"):
        ss.search_submitted = True
        ss.search_page = 1
        st.rerun()

else:
    # Filters move to sidebar
    with st.sidebar:
        st.header("Search Filters")
        filters = _render_filters(st.container(), available_sports, available_sub_sports,
                                  available_categories, min_date, max_date)

        st.divider()
        col1, col2 = st.columns(2)
        with col1:
            if st.button("Update Results", type="primary", width='stretch'):
                ss.search_page = 1
                st.rerun()
        with col2:
            if st.button("Clear Results", width='stretch'):
                ss.search_submitted = False
                st.rerun()

        st.divider()
        if st.button("Refresh Data", help="Clear cache and reload"):
            fetch_search_data.clear()
            st.rerun()

    # Apply filters and show results
    activities = _apply_filters(raw_df, filters)

    # Sort activities
    activities = activities.sort_values(by=sort_selection, ascending=sort_direction)

    if activities.empty:
        st.info("No activities match the current filters.")
        st.stop()

    _render_results(activities, conn)
