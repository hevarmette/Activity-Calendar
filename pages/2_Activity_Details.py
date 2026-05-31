import streamlit as st
import time
import pandas as pd
from streamlit import session_state as ss
from datetime import timedelta
from calendar_test_8 import (
    fetch_activity_details,
    fetch_activity_points,
)
from streamlit_folium import st_folium
from db import (
    get_connection,
    fetch_lap_data,
    fetch_lap_data_for_session,
    fetch_sessions_for_activity,
    get_lap_update_query,
    get_length_update_query,
    combine_lengths,
    retrieve_monthly_data,
    fetch_activity_events,
    fetch_similar_activities,
    fetch_length_data,
)
from utils import (
    convert_seconds_to_hms,
    parse_hms_to_seconds,
    weighted_average_if_present,
    get_svg_markdown,
    format_effort,
    init_session_state,
    render_activity_card,
)
from plotting import create_activity_map, create_plot
from lap_processing import (
    process_cycling_laps,
    process_lap_data,
    create_auto_laps,
    build_running_auto_laps,
    build_cycling_auto_laps,
    compute_interval_summary,
    process_swimming_lengths,
)

init_session_state()

# Keys = Database Column Names
# Values = UI Display Names
# This is used to map database column names with display column names
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
# This is to convert edited columns to db name
UI_TO_DB_MAP = {v: k for k, v in LAP_COLUMN_MAPPING.items()}


# =============================================================================
# HELPERS
# =============================================================================


def _render_summary_metrics(sport, distance_m, duration_s, avg_power):
    """Render Distance, Duration, Pace/Speed as display-only metrics."""
    miles = distance_m / ss.meters_to_miles
    duration_td = timedelta(seconds=int(duration_s))

    col1, col2, col3 = st.columns(3)
    col1.metric("Distance", f"{miles:.2f} mi")
    col2.metric("Duration", str(duration_td))

    if sport == "cycling":
        if avg_power:
            col3.metric("Power", f"{avg_power} watts")
        else:
            duration_hr = duration_s / 3600
            mph = miles / duration_hr if duration_hr > 0 else 0
            col3.metric("Speed", f"{mph:.2f} mph")
    else:
        pace_sec_per_mile = duration_s / miles if miles > 0 else 0
        pace_min, pace_sec = divmod(int(pace_sec_per_mile), 60)
        col3.metric("Pace", f"{pace_min}:{pace_sec:02d} /mi")


def _render_sidebar_adjustments(distance_m, duration_s, key_suffix):
    """Render editable distance/duration inputs in the sidebar. Returns updated values in meters/seconds."""
    miles = distance_m / ss.meters_to_miles
    with st.sidebar:
        st.subheader("Adjust Activity")
        new_miles = st.number_input(
            "Distance (miles)", value=miles, step=0.01,
            format="%.2f", key=f"edit_dist_{key_suffix}",
        )
        dur_str = convert_seconds_to_hms(duration_s)
        new_dur_str = st.text_input(
            "Duration (H:MM:SS or M:SS)", value=dur_str,
            key=f"edit_dur_{key_suffix}",
        )
    parsed_dur = parse_hms_to_seconds(new_dur_str)
    updated_duration_s = parsed_dur if parsed_dur is not None else duration_s
    return new_miles * ss.meters_to_miles, updated_duration_s


def _set_ss_flags_for_points(points_df):
    """
    Re-evaluate ss.hr, ss.cadence, ss.coordinates for a sub-sliced points_df.
    This is needed when rendering individual legs of a multisport activity.
    """
    if points_df.empty:
        ss.hr = False
        ss.cadence = False
        ss.coordinates = False
        return

    ss.coordinates = (
        "latitude" in points_df.columns
        and "longitude" in points_df.columns
        and not points_df["latitude"].isna().all()
    )
    ss.hr = (
        "heart_rate" in points_df.columns and not points_df["heart_rate"].isna().all()
    )
    ss.cadence = (
        "cadence" in points_df.columns
        and "fractional_cadence" in points_df.columns
        and not points_df["cadence"].isna().all()
    )
    if ss.cadence and "total_cadence" not in points_df.columns:
        points_df["total_cadence"] = points_df["cadence"] + points_df[
            "fractional_cadence"
        ].astype(float)


def _render_session_content(
    conn,
    activity_id,
    session_row,
    points_df,
    updated_category,
    session_key_suffix,
    map_col=None,
    show_summary_metrics=True,
    is_multisport=False,
):
    """
    Renders map, graphs, lap table, auto laps, and stats for one session.

    session_row         — a Series from sessions_df, or None for single-sport
                          (falls back to ss.activity_details)
    points_df           — already filtered to this session's time window
    session_key_suffix  — appended to all widget keys to avoid collisions
    show_summary_metrics- toggle to show or hide the top level metrics (Distance, Duration, Pace/Speed)
    is_multisport       — boolean flag indicating if this is part of a multisport activity
    """
    sport = (
        (session_row["sport"] or "").lower()
        if session_row is not None
        else ss.selected_activity_sport
    )

    # ---- derive metrics for this session ------------------------------------
    if is_multisport and session_row is not None:
        distance_m = session_row["total_distance"] or 0
        duration_s = session_row["total_timer_time"] or 0
        avg_power = session_row.get("avg_power")
    else:
        distance_m = ss.activity_details[0]
        duration_s = ss.activity_details[1]
        avg_power = ss.activity_details[2]

    miles = distance_m / ss.meters_to_miles
    duration_td = timedelta(seconds=int(duration_s))
    duration_hr = duration_s / 3600
    pace_sec_per_mile = duration_s / miles if miles > 0 else 0
    pace_min, pace_sec = divmod(int(pace_sec_per_mile), 60)
    mph = miles / duration_hr if duration_hr > 0 else 0

    # ---- top summary metrics ------------------------------------------------
    if show_summary_metrics:
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

    # ---- map (per-session, no sport colouring needed within a single leg) ---
    if not points_df.empty and ss.coordinates:
        if map_col is not None:
            with map_col:
                activity_map = create_activity_map(points_df, fullscreen=True, auto_lap_dist=ss.auto_lap_distances.get(sport, ss.auto_lap_distances["default"]))
                st_folium(activity_map, width="stretch", key=f"map_{session_key_suffix}")
        else:
            activity_map = create_activity_map(points_df, fullscreen=True, auto_lap_dist=ss.auto_lap_distances.get(sport, ss.auto_lap_distances["default"]))
            st_folium(activity_map, width="stretch", key=f"map_{session_key_suffix}")



    # ---- performance graphs -------------------------------------------------
    st.subheader("📈 Performance Graphs")

    point_df = points_df.copy() if not points_df.empty else pd.DataFrame()

    if point_df is not None and not point_df.empty:
        if (
            "enhanced_speed" in point_df.columns
            and point_df["enhanced_speed"].notnull().any()
        ):
            speed_mps = point_df["enhanced_speed"].replace(0, pd.NA)
            if sport == "cycling":
                # mph for cycling
                point_df["speed_mph"] = speed_mps * 2.23694
            else:
                # pace (min/mile) for running
                point_df["pace_min_per_mile"] = ss.meters_to_miles / 60 / speed_mps

        x_axis_choice = st.radio(
            "Plot against:",
            ("Distance", "Time"),
            horizontal=True,
            label_visibility="collapsed",
            key=f"x_axis_{session_key_suffix}",
        )

        if x_axis_choice == "Distance":
            if "distance" in point_df.columns:
                point_df = point_df.copy()
                point_df["distance_miles"] = point_df["distance"] / ss.meters_to_miles
                x_col, x_label = "distance_miles", "Distance (miles)"
            else:
                x_col, x_label = None, None
        else:
            point_df["plot_time"] = pd.Timestamp(0) + points_df["elapsed_time"] # this is to format the timestamp properly
            x_col, x_label = "plot_time", "Time"

        if not x_col or x_col not in point_df.columns:
            st.warning(f"Data for '{x_label}' is not available.")
        else:
            # -----------------------------------------------------------------
            # CYCLING GRAPHS: Speed, HR, Altitude, Cadence (RPM)
            # -----------------------------------------------------------------
            if sport == "cycling":
                # Speed
                if (
                    "speed_mph" in point_df.columns
                    and point_df["speed_mph"].notnull().any()
                ):
                    speed_fig = create_plot(
                        df=point_df,
                        x_col=x_col,
                        y_col="speed_mph",
                        x_label=x_label,
                        y_label="Speed (mph)",
                        title="Speed over " + x_axis_choice,
                        color="blue",
                    )
                    if speed_fig:
                        avg_spd = point_df["speed_mph"].dropna().mean()
                        speed_fig.update_traces(
                            hovertemplate=(
                                "Distance: %{x:.2f} mi<br>"
                                "Speed: %{y:.1f} mph<br>"
                                "<extra></extra>"
                            )
                        )
                        speed_fig.add_hline(
                            y=avg_spd,
                            line_dash="dash",
                            line_color="gray",
                            annotation_text=f"Avg: {avg_spd:.1f} mph",
                            annotation_position="top right",
                        )
                        st.plotly_chart(speed_fig, width="stretch")

                # Heart Rate
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
                    st.plotly_chart(hr_fig, width="stretch")

                # Altitude
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
                    st.plotly_chart(alt_fig, width="stretch")

                # Cadence (RPM) — raw cadence for cycling, no doubling
                if (
                    "cadence" in point_df.columns
                    and point_df["cadence"].notnull().any()
                ):
                    cad_fig = create_plot(
                        df=point_df,
                        x_col=x_col,
                        y_col="cadence",
                        x_label=x_label,
                        y_label="Cadence (rpm)",
                        title="Cadence over " + x_axis_choice,
                        color="purple",
                        is_scatter=True,
                    )
                    if cad_fig:
                        st.plotly_chart(cad_fig, width="stretch")

            # -----------------------------------------------------------------
            # RUNNING GRAPHS: Pace, HR, Altitude, Cadence (SPM)
            # -----------------------------------------------------------------
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
                        if updated_category == "training":
                            p_pace = min(pace_series.quantile(0.85), 12)
                        else:
                            p_pace = pace_series.quantile(0.95) + 3
                        fastest_pace = pace_series.min()

                        top_bound = 5 if fastest_pace >= 5 else fastest_pace
                        bottom_bound = 11 if p_pace > 11 else p_pace

                        avg_pace = pace_series.mean()
                        avg_min = int(avg_pace)
                        avg_sec = int(round((avg_pace - avg_min) * 60))

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
                        pace_fig.update_traces(
                            hovertemplate=(
                                "Distance: %{x:.2f} mi<br>"
                                "Pace: %{y:.2f} min/mi<br>"
                                "<extra></extra>"
                            )
                        )
                        pace_fig.add_hline(
                            y=avg_pace,
                            line_dash="dash",
                            line_color="gray",
                            annotation_text=f"Avg: {avg_min:02d}:{avg_sec:02d} /mi",
                            annotation_position="top right",
                        )

                    st.plotly_chart(pace_fig, width="stretch")

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
                    st.plotly_chart(hr_fig, width="stretch")

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
                    st.plotly_chart(alt_fig, width="stretch")

                # Running cadence: raw cadence × 2 = steps per minute
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
                        st.plotly_chart(cad_fig, width="stretch")
    else:
        st.info("No point-by-point data available to generate graphs.")

    # ---- lap table + sub-tabs -----------------------------------------------
    # Detect pool swimming — show length data instead of standard laps
    sub_sport = (session_row["sub_sport"] or "").lower() if session_row is not None else ""
    is_pool_swimming = sub_sport == "lap_swimming"

    if is_pool_swimming:
        pool_length_m = session_row.get("pool_length") or 25
        raw_lengths_df = fetch_length_data(conn, activity_id)
        lengths_df = process_swimming_lengths(raw_lengths_df, pool_length_m=pool_length_m)

        if lengths_df.empty:
            st.info("No length data found for this pool swim.")
        else:
            st.subheader("Lengths")
            stroke_options = ["Freestyle", "Backstroke", "Breaststroke", "Butterfly", "Mixed", "Drill"]
            column_config = {
                "length_id": None,
                "Stroke": st.column_config.SelectboxColumn("Stroke", options=stroke_options),
                "SWOLF": st.column_config.NumberColumn(format="%.0f"),
            }
            disabled_cols = ["Length", "Type", "Distance (m)", "Pace /100m", "SWOLF"]
            st.data_editor(
                lengths_df,
                hide_index=True,
                use_container_width=True,
                column_config=column_config,
                disabled=disabled_cols,
                key=f"length_editor_{session_key_suffix}",
            )
            st.session_state[f"lengths_df_{session_key_suffix}"] = lengths_df

            # --- Combine Lengths ---
            active_lengths = lengths_df[lengths_df["Type"] == "Active"]
            length_numbers = active_lengths["Length"].tolist()
            selected = st.multiselect(
                "Select consecutive lengths to combine",
                options=length_numbers,
                key=f"combine_select_{session_key_suffix}",
            )
            if selected and len(selected) >= 2:
                sorted_sel = sorted(selected)
                is_consecutive = all(
                    sorted_sel[i + 1] - sorted_sel[i] == 1
                    for i in range(len(sorted_sel) - 1)
                )
                if not is_consecutive:
                    st.warning("Selected lengths must be consecutive.")
                elif st.button("Combine Selected Lengths", key=f"combine_btn_{session_key_suffix}"):
                    ids_to_combine = active_lengths[active_lengths["Length"].isin(sorted_sel)]["length_id"].tolist()
                    if combine_lengths(conn, ids_to_combine):
                        st.success("Lengths combined.")
                        st.rerun()

        return pd.DataFrame()

    st.markdown("You can edit values in the table below.")

    # ONLY fetch session-specific laps if it's explicitly a multisport session
    if is_multisport and session_row is not None and pd.notna(session_row.get("first_lap_index")) and pd.notna(session_row.get("num_laps")):
        # Fetch only the laps belonging to this session
        raw_laps_df = fetch_lap_data_for_session(
            conn,
            activity_id,
            int(session_row["first_lap_index"]),
            int(session_row["num_laps"]),
        )
    else:
        # Fallback: Called if the session length is < 2 (single-sport) or missing indices
        raw_laps_df = fetch_lap_data(conn, activity_id)

    if sport == "cycling":
        processed_laps_df = process_cycling_laps(raw_laps_df.copy())
    elif sport == "running":
        processed_laps_df = process_lap_data(raw_laps_df.copy())
    else:
        processed_laps_df = pd.DataFrame()

    filtered_df = processed_laps_df  # default; overwritten below by pill filter

    if processed_laps_df.empty:
        st.info("No lap data found for this session.")
    else:
        laps_tab, details_tab, auto_laps_tab = st.tabs(
            ["↩  Laps", "📊 Activity Details", "↻ Auto Laps"]
        )

        st.session_state[f"processed_laps_df_{session_key_suffix}"] = (
            processed_laps_df.copy()
        )

        # -----------------------------------------------------------------
        # LAPS TAB
        # -----------------------------------------------------------------
        with laps_tab:
            st.markdown("You can edit values in the table below.")

            intensity_options = ["warm up", "active", "recovery", "rest", "cooldown"]

            # st.pills returns the selected string, or None if deselected
            selected_intensity = st.pills(
                "Filter by Intensity",
                options=intensity_options,
                default=None,
                key=f"intensity_pills_{session_key_suffix}",
            )

            # 3. If a pill is selected, filter. If None, show all.
            if selected_intensity:
                filtered_df = st.session_state[
                    f"processed_laps_df_{session_key_suffix}"
                ][
                    st.session_state[f"processed_laps_df_{session_key_suffix}"][
                        "Intensity"
                    ]
                    == selected_intensity
                ]
            else:
                filtered_df = st.session_state[
                    f"processed_laps_df_{session_key_suffix}"
                ]

            if sport == "cycling":
                column_config = {
                    "Intensity": st.column_config.SelectboxColumn(
                        "Intensity",
                        options=intensity_options,
                        required=False,
                    ),
                    "Lap Id": None,
                    "Distance (miles)": st.column_config.NumberColumn(format="%.2f"),
                    "Avg Speed (mph)": st.column_config.NumberColumn(format="%.1f"),
                    "avg_power": "Avg Power",
                    "max_power": "Max Power",
                    "Avg Heart Rate": st.column_config.NumberColumn(
                        step=1, format="%d"
                    ),
                    "Max Heart Rate": st.column_config.NumberColumn(
                        step=1, format="%d"
                    ),
                    "Cumulative Distance": st.column_config.NumberColumn(format="%.2f"),
                }
                disabled_cols = ["Lap", "Avg Speed (mph)", "Cumulative Distance", "Cumulative Time"]
            else:
                column_config = {
                    "Intensity": st.column_config.SelectboxColumn(
                        "Intensity",
                        help="Select the intensity type for the lap",
                        options=intensity_options,
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
                        "Avg Heart Rate", step=1, format="%d"
                    ),
                    "Max Heart Rate": st.column_config.NumberColumn(
                        "Max Heart Rate", step=1, format="%d"
                    ),
                    "Cumulative Distance": st.column_config.NumberColumn(format="%.2f"),
                }
                disabled_cols = ["Lap", "Pace (min/mile)", "Cumulative Distance", "Cumulative Time"]

            # TODO: Recalc pace min/mile on_callback when data is edited
            edited_df = st.data_editor(
                filtered_df,
                hide_index=True,
                column_config=column_config,
                disabled=disabled_cols,
                key=f"lap_editor_{session_key_suffix}",
            )

            if not edited_df.equals(filtered_df):
                st.session_state[f"processed_laps_df_{session_key_suffix}"].update(
                    edited_df
                )

            # Interval summary for training activities
            if updated_category == "training" and (ss[f"processed_laps_df_{session_key_suffix}"]["Intensity"] == "active").sum() >= 2:
                active_laps = ss[f"processed_laps_df_{session_key_suffix}"][
                    ss[f"processed_laps_df_{session_key_suffix}"]["Intensity"] == "active"
                ]
                dist_mean = active_laps["Distance (miles)"].mean()
                time_secs = active_laps["Time (formatted)"].apply(parse_hms_to_seconds)
                time_mean = time_secs.mean()
                dist_cv = active_laps["Distance (miles)"].std() / dist_mean if dist_mean else 1
                time_cv = time_secs.std() / time_mean if time_mean else 1
                default_group = "Time" if time_cv < dist_cv else "Distance"

                group_by = st.pills(
                    "Group intervals by",
                    options=["Distance", "Time"],
                    default=default_group,
                    key=f"interval_group_by_{session_key_suffix}",
                )
                interval_sets = compute_interval_summary(
                    ss[f"processed_laps_df_{session_key_suffix}"],
                    sport,
                    group_by=(group_by or "Distance").lower(),
                )
                if interval_sets:
                    by_time = (group_by or "Distance").lower() == "time"
                    for s in interval_sets:
                        st.header(f"{s['count']}×{s['label']}")
                        has_hr = s.get("avg_hr")
                        has_power = s.get("avg_power")
                        cols = st.columns(4 if has_hr else 3)
                        if by_time:
                            cols[0].metric("Avg Distance (mi)", s['avg_dist_label'], delta=s.get("dist_dev_trend"))
                            if has_power:
                                cols[1].metric("Avg Power (W)", s['avg_power'])
                            else:
                                cols[1].metric("Avg Speed (mph)" if sport == "cycling" else "Avg Pace (min/mi)", s.get("avg_pace_label", "—"))
                            cols[2].metric("Farthest Split (mi)", s['farthest_split'])
                        else:
                            cols[0].metric("Avg Time", s['avg_duration'], delta=s.get("time_dev_trend"), delta_color="inverse")
                            if has_power:
                                cols[1].metric("Avg Power (W)", s['avg_power'])
                            else:
                                cols[1].metric("Avg Speed (mph)" if sport == "cycling" else "Avg Pace (min/mi)", s.get("avg_pace_label", "—"))
                            cols[2].metric("Fastest Split", s['fastest_split'])
                        if has_hr:
                            cols[3].metric("Avg HR (bpm)", s['avg_hr'])


        # -----------------------------------------------------------------
        # ACTIVITY DETAILS TAB
        # -----------------------------------------------------------------
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
                    and not point_df.empty
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

                    elapsed_s = session_row["total_elapsed_time"] if session_row is not None else None
                    if elapsed_s:
                        elapsed_td = timedelta(seconds=int(elapsed_s))
                        st.markdown("**Elapsed Time**")
                        st.write(str(elapsed_td))

            # --------------------
            # Column 3
            # --------------------
            with c3:
                elevation_valid = (
                    "coordinates" in ss
                    and ss.coordinates
                    and not point_df.empty
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

                if sport == "cycling":
                    # Best lap by speed
                    if "Avg Speed (mph)" in processed_laps_df.columns:
                        if elevation_valid:
                            st.markdown("---")
                        fastest_idx = processed_laps_df["Avg Speed (mph)"].idxmax()
                        fastest_lap_num = processed_laps_df.loc[fastest_idx, "Lap"]
                        fastest_lap_spd = processed_laps_df.loc[
                            fastest_idx, "Avg Speed (mph)"
                        ]
                        st.markdown("**Best Speed**")
                        st.write(
                            f"Fastest lap: lap {fastest_lap_num} at {fastest_lap_spd:.1f} mph"
                        )
                else:
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
                            fastest_lap_pace = f"{pace_min}:{pace_sec:02d} /mi"

                        st.markdown("**Best Pace / Speed**")
                        st.write(
                            f"Fastest lap: lap {fastest_lap} " f"at {fastest_lap_pace}"
                        )

            # --------------------
            # Column 4
            # --------------------
            with c4:
                if sport == "cycling":
                    # Cadence in RPM (no doubling)
                    cadence_valid = (
                        not point_df.empty
                        and "cadence" in point_df.columns
                        and not point_df["cadence"].isna().all()
                    )
                    if cadence_valid:
                        avg_cadence_rpm = point_df["cadence"].mean()
                        max_cadence_rpm = point_df["cadence"].max()
                        st.markdown("**Cadence**")
                        st.write(f"Avg cadence: {avg_cadence_rpm:.1f} rpm")
                        st.write(f"Max cadence: {int(max_cadence_rpm)} rpm")

                    # Max speed from record data
                    if (
                        not point_df.empty
                        and "enhanced_speed" in point_df.columns
                        and point_df["enhanced_speed"].notnull().any()
                    ):
                        max_speed_mph = point_df["enhanced_speed"].max() * 2.23694
                        if cadence_valid:
                            st.markdown("---")
                        st.markdown("**Max Speed**")
                        st.write(f"{max_speed_mph:.1f} mph")

                else:
                    cadence_valid = (
                        "cadence" in ss
                        and ss.cadence
                        and not point_df.empty
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
                            st.write(
                                f"Stance time balance: {avg_stance_time_balance:.2f}"
                            )

                        if avg_stance_time is not None:
                            st.write(
                                f"Average ground contact time: {avg_stance_time:.0f} ms"
                            )

                        if avg_vertical_oscillation is not None:
                            st.write(
                                f"Average vertical oscillation: {avg_vertical_oscillation / 10:.1f} cm"
                            )

        # -----------------------------------------------------------------
        # AUTO LAPS TAB
        # -----------------------------------------------------------------
        with auto_laps_tab:
            auto_lap_dist = ss.auto_lap_distances.get(sport, ss.auto_lap_distances["default"])

            auto_laps_result = None
            try:
                auto_laps_result = create_auto_laps(
                    points_df, events_df=fetch_activity_events(conn, activity_id),
                    auto_lap_dist=auto_lap_dist,
                )
            except AttributeError:
                st.error("Make sure timestamps are in datetime format before trying to convert")

            # create_auto_laps now returns a tuple (laps_df, target_dists)
            if isinstance(auto_laps_result, tuple):
                raw_auto_laps_df, target_dists = auto_laps_result

                if sport == "cycling":
                    auto_laps_config = {
                        "Distance (miles)": st.column_config.NumberColumn(
                            format="%.2f"
                        ),
                        "Avg Speed (mph)": st.column_config.NumberColumn(format="%.1f"),
                        "Max Speed (mph)": st.column_config.NumberColumn(format="%.1f"),
                    }
                    auto_laps = build_cycling_auto_laps(raw_auto_laps_df)
                else:
                    auto_laps_config = {
                        "Distance (miles)": st.column_config.NumberColumn(
                            format="%.2f"
                        ),
                    }
                    auto_laps = build_running_auto_laps(raw_auto_laps_df)

                st.dataframe(auto_laps, column_config=auto_laps_config, hide_index=True)
            else:
                # Fallback: empty or unexpected return
                st.info("No auto lap data available.")

    return filtered_df  # returned so the save handler can reference edited rows


def _render_single_sport(
    conn, activity_id, sport, sessions_df, updated_category, feel, effort
):
    """Renders the standard single-sport detail page (description box + session content + save)."""
    # Use the first session row so sub_sport/pool_length are available downstream
    session_row = sessions_df.iloc[0] if sessions_df is not None and not sessions_df.empty else None
    points_df = ss.points_df if "points_df" in ss else pd.DataFrame()

    # ---- derive metrics for this session to display above the map -----------
    distance_m = ss.activity_details[0]
    duration_s = ss.activity_details[1]
    avg_power = ss.activity_details[2]

    updated_distance_m, updated_duration_s = _render_sidebar_adjustments(
        distance_m, duration_s, key_suffix=str(activity_id),
    )
    _render_summary_metrics(sport, distance_m, duration_s, avg_power)

    # different columns so I can alilgn the values to the top of the columns.
    # So the map and description can be vertically aligned
    map_col, description_col = st.columns([0.7, 0.3])
    with description_col:
        if ss.activity_details and ss.activity_details[3]:
            description = ss.activity_details[3]
        else:
            description = ""
        updated_description = st.text_area(
            "Description",
            description,
            width="stretch",
            height=200,
            key=f"desc_input_{activity_id}",
        )

    filtered_df = _render_session_content(
        conn=conn,
        activity_id=activity_id,
        session_row=session_row,
        points_df=points_df,
        updated_category=updated_category,
        session_key_suffix=str(activity_id),
        map_col=map_col,
        show_summary_metrics=False,
        is_multisport=False, # Enforces that fetch_lap_data is called
    )

    _render_feel_effort_save(
        conn=conn,
        activity_id=activity_id,
        feel=feel,
        effort=effort,
        filtered_df=filtered_df,
        updated_description=updated_description,
        updated_category=updated_category,
        updated_distance_m=updated_distance_m,
        updated_duration_s=updated_duration_s,
        session_key_suffix=str(activity_id),
    )


def _render_multisport(
    conn, activity_id, sessions_df, full_points_df, updated_category, feel, effort
):
    """
    Renders the multisport detail page.

    Top section: colour-coded full-activity map + description + total summary metrics.
    Below: one st.tab per session, each delegating to _render_session_content.
    """
    # Total summary metrics across all legs — rendered above the map
    total_distance_m = sessions_df["total_distance"].sum()
    total_duration_s = sessions_df["total_timer_time"].sum()
    updated_distance_m, updated_duration_s = _render_sidebar_adjustments(
        total_distance_m, total_duration_s, key_suffix=f"multi_{activity_id}",
    )
    _render_summary_metrics("multisport", total_distance_m, total_duration_s, None)

    map_col, description_col = st.columns([0.7, 0.3])

    # Colour-coded overview map — segments coloured by sport
    if not full_points_df.empty and ss.coordinates:
        with map_col:
            full_map = create_activity_map(
                full_points_df, fullscreen=True, sessions_df=sessions_df
            )
            st_folium(full_map, width="stretch", key=f"full_map_{activity_id}")

    with description_col:
        if ss.activity_details and ss.activity_details[3]:
            description = ss.activity_details[3]
        else:
            description = ""
        updated_description = st.text_area(
            "Description",
            description,
            width="stretch",
            height=200,
            key=f"desc_input_{activity_id}",
        )

    # ---- one st.tab per session ---------------------------------------------
    # Build labels — repeated sport names get a counter: Run, Bike, Run 2
    tab_labels = []
    sport_counts = {}
    for _, row in sessions_df.iterrows():
        sport_name = (row["sport"] or "unknown").capitalize()
        sport_counts[sport_name] = sport_counts.get(sport_name, 0) + 1
        count = sport_counts[sport_name]
        label = sport_name if count == 1 else f"{sport_name} {count}"
        tab_labels.append(label)

    session_tabs = st.tabs(tab_labels)

    for tab, (_, session_row) in zip(session_tabs, sessions_df.iterrows()):
        with tab:
            # Slice the full points_df to only this session's time window
            seg_start = session_row["start_time"]
            seg_end = seg_start + timedelta(seconds=float(session_row["total_timer_time"] or 0))
            if not full_points_df.empty:
                # Normalize tz-awareness so the comparison doesn't silently
                # produce an all-False mask when one side is tz-aware and the
                # other is tz-naive.
                ts_col = full_points_df["timestamp"]
                if ts_col.dt.tz is not None and seg_start.tzinfo is None:
                    ts_col = ts_col.dt.tz_localize(None)
                elif ts_col.dt.tz is None and getattr(seg_start, "tzinfo", None) is not None:
                    seg_start = seg_start.replace(tzinfo=None)
                    seg_end = seg_end.replace(tzinfo=None)
                mask = (ts_col >= seg_start) & (ts_col <= seg_end)
                session_points_df = full_points_df[mask].copy()
                # Re-anchor elapsed_time to the start of this leg
                if not session_points_df.empty:
                    session_points_df["elapsed_time"] = (
                        session_points_df["elapsed_time"]
                        - session_points_df["elapsed_time"].iloc[0]
                    )
            else:
                session_points_df = pd.DataFrame()

            # Re-evaluate ss data flags for this leg's slice
            _set_ss_flags_for_points(session_points_df)

            session_key = f"{activity_id}_{session_row['session_id']}"
            _render_session_content(
                conn=conn,
                activity_id=activity_id,
                session_row=session_row, # Iterated session row used here
                points_df=session_points_df,
                updated_category=updated_category,
                session_key_suffix=session_key,
                is_multisport=True, # Enforces that fetch_lap_data_for_session is called
            )

    _render_feel_effort_save(
        conn=conn,
        activity_id=activity_id,
        feel=feel,
        effort=effort,
        filtered_df=pd.DataFrame(),  # lap edits handled per-tab via keyed editors
        updated_description=updated_description,
        updated_category=updated_category,
        updated_distance_m=updated_distance_m,
        updated_duration_s=updated_duration_s,
        session_key_suffix=str(activity_id),
    )


def _render_feel_effort_save(
    conn,
    activity_id,
    feel,
    effort,
    filtered_df,
    updated_description,
    updated_category,
    updated_distance_m,
    updated_duration_s,
    session_key_suffix,
):
    """Renders the feel/effort widgets and the Save button."""
    feel_col, effort_col = st.columns([0.3, 0.7])

    with feel_col:
        # The widget options are the raw integers (Values from the db)
        feel_options = list(ss.feel_map.keys())
        if feel is not None:
            current_feel_index = feel_options.index(feel)
        else:
            current_feel_index = None

        updated_feel = st.radio(
            label="How did you feel?",
            options=feel_options,
            index=current_feel_index,
            # The format_func takes the integer, finds the string, and adds the SVG
            format_func=lambda x: get_svg_markdown(ss.feel_map.get(x, "Unknown")),
            # captions=list(ss.feel_map.values()),
            key=f"feel_radio_{session_key_suffix}",
        )

    with effort_col:
        effort_options = [None] + [i * 10 for i in range(1, 11)]
        updated_effort = st.select_slider(
            label="Perceived Effort",
            options=effort_options,
            value=effort,
            # The format_func divides by 10 to fetch the correct string from the dictionary
            format_func=format_effort,
            key=f"effort_slider_{session_key_suffix}",
        )

    if st.button("Save", shortcut="s", key=f"save_{session_key_suffix}"):
        updates = []

        lap_editor_key = f"lap_editor_{session_key_suffix}"
        if lap_editor_key in ss and ss[lap_editor_key].get("edited_rows"):
            # st.info("Changes detected. Saving to database...")

            # The edited_rows dict tells us exactly what changed
            for row_idx, changes in ss[lap_editor_key]["edited_rows"].items():
                # Get the lap_id using the row index from the ORIGINAL dataframe
                # Note: Ensure processed_laps_df aligns with the editor's data source
                try:
                    lap_id = filtered_df.iloc[int(row_idx)]["Lap Id"]
                except IndexError:
                    st.error("Could not find Lap ID. Did the sort order change?")
                    continue

                for ui_col_name, new_value in changes.items():

                    # REVERSE LOOKUP: Check if this UI column maps to a real DB column
                    if ui_col_name in UI_TO_DB_MAP:
                        db_col_name = UI_TO_DB_MAP[ui_col_name]

                        if db_col_name == "distance_mi":
                            # Convert Miles -> Meters
                            new_value = new_value * ss.meters_to_miles
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

        # --- Length editor (pool swimming) ---
        length_editor_key = f"length_editor_{session_key_suffix}"
        if length_editor_key in ss and ss[length_editor_key].get("edited_rows"):
            lengths_df = st.session_state.get(f"lengths_df_{session_key_suffix}")
            if lengths_df is not None:
                LENGTH_UI_TO_DB = {
                    "Time": "total_timer_time",
                    "Strokes": "total_strokes",
                    "Stroke": "swim_stroke",
                }
                for row_idx, changes in ss[length_editor_key]["edited_rows"].items():
                    try:
                        length_id = lengths_df.iloc[int(row_idx)]["length_id"]
                    except IndexError:
                        st.error("Could not find length ID.")
                        continue
                    for ui_col, new_value in changes.items():
                        if ui_col in LENGTH_UI_TO_DB:
                            db_col = LENGTH_UI_TO_DB[ui_col]
                            if db_col == "total_timer_time":
                                seconds_value = parse_hms_to_seconds(new_value)
                                if seconds_value is None:
                                    st.error(f"Invalid time format '{new_value}'.")
                                    continue
                                new_value = seconds_value
                            elif db_col == "swim_stroke":
                                new_value = new_value.lower().replace(" ", "_")
                            updates.append(get_length_update_query(length_id, db_col, new_value))
                fetch_length_data.clear()

        set_clauses = []
        query_params = []

        # Check Description
        if updated_description != (ss.activity_details[3]):
            if updated_description == "":
                updated_description = None
            set_clauses.append("description = %s")
            query_params.append(updated_description)

        # Check Title (Activity Name)
        updated_title = ss.get(f"title_input_{activity_id}", ss.activity_details[7])
        if updated_title != ss.activity_details[7]:
            if updated_title == "":
                updated_title = None
            set_clauses.append("activity_name = %s")
            query_params.append(updated_title)

        # Check Category
        if updated_category != ss.activity_details[8]:
            set_clauses.append("category = %s")
            query_params.append(updated_category)

        # Check adjusted distance
        if updated_distance_m != ss.activity_details[0]:
            set_clauses.append("adjusted_distance = %s")
            query_params.append(updated_distance_m)

        # Check adjusted duration
        if updated_duration_s != ss.activity_details[1]:
            set_clauses.append("adjusted_duration = %s")
            query_params.append(updated_duration_s)

        # Check Feel
        if updated_feel != ss.activity_details[4]:
            set_clauses.append("workout_feel = %s")
            query_params.append(updated_feel)

        # Check Effort
        if updated_effort != ss.activity_details[5]:
            set_clauses.append("effort = %s")
            query_params.append(updated_effort)

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
                with conn.transaction():
                    conn.execute(readable_sql)
            st.toast("Updates have been saved!")
            # deleting the info to requery from the database. because this is quicker to code
            # than updating the existing variables
            st.cache_data.clear()
            if "activities_df" in ss:
                del ss["activities_df"]
            # Re-fetch activity details and rerun to reflect changes
            ss.activity_details = fetch_activity_details(conn, activity_id)
            ss.points_df = fetch_activity_points(conn, activity_id)
            time.sleep(5)
            st.rerun()
        else:
            st.info("No changes detected.")
            # Rerun the script to show the latest data from the DB
            # st.rerun()


# --- PAGE LAYOUT ---
st.set_page_config(page_title="Activity Details", layout="wide")

# Check if an activity has been selected
if "selected_activity_id" not in ss:
    st.warning("Please select an activity from the calendar page first.")
    st.page_link("calendar test 8.py", label="Back to Calendar")
else:
    activity_id = ss.selected_activity_id
    sport = ss.selected_activity_sport
    # conn = init_connection()
    conn = get_connection(local=True)
    if "activities_df" not in ss:
        ss.activities_df = retrieve_monthly_data(conn)

    st.title(f"Lap Data for Activity ID: {activity_id}")

    if ss.activity_details:
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
        st.markdown(f"_{local_timestamp.strftime('%B %d, %Y @ %I:%M %p')}_")
    else:
        st.warning(f"No activity details for activity {activity_id}")

    title_col, category_col, nav_col = st.columns(
        [0.7, 0.25, 0.05], vertical_alignment="bottom"
    )
    # Title
    with title_col:
        title = ss.activity_details[7]
        if title is None:
            title = ""
        # with title_col:
        updated_title = st.text_input(
            label=" ", value=title, key=f"title_input_{activity_id}"
        )
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
            "---",
            options=category_options,
            index=cat_index,
            key=f"category_select_{activity_id}",
        )
    with nav_col:
        back_col, forward_col = st.columns(2, gap=None)
        idx = ss.activities_df.index[ss.activities_df["activity_id"] == activity_id][0]
        with back_col:
            if st.button(r"\<", key="prev_activity"):
                if idx < len(ss.activities_df) - 1:
                    prev_row = ss.activities_df.iloc[idx + 1]
                    prev_id = int(prev_row["activity_id"])
                    ss.selected_activity_id = prev_id
                    ss.selected_activity_sport = prev_row["sport"].split(",")[0]
                    ss.activity_details = fetch_activity_details(conn, prev_id)
                    ss.points_df = fetch_activity_points(conn, prev_id)
                    st.rerun()
        with forward_col:
            if st.button(r"\>", key="next_activity"):
                if idx > 0:
                    next_row = ss.activities_df.iloc[idx - 1]
                    next_id = int(next_row["activity_id"])
                    ss.selected_activity_id = next_id
                    ss.selected_activity_sport = next_row["sport"].split(",")[0]
                    ss.activity_details = fetch_activity_details(conn, next_id)
                    ss.points_df = fetch_activity_points(conn, next_id)
                    st.rerun()

    # -------------------------------------------------------------------------
    # FETCH SESSIONS — determines single-sport vs multisport rendering path
    # -------------------------------------------------------------------------
    sessions_df = fetch_sessions_for_activity(conn, activity_id)
    is_multisport = sport == "multisport" or (
        sessions_df is not None and len(sessions_df) > 1
    )

    full_points_df = ss.points_df if "points_df" in ss else pd.DataFrame()

    if is_multisport:
        _render_multisport(
            conn,
            activity_id,
            sessions_df,
            full_points_df,
            updated_category,
            feel,
            effort,
        )
    else:
        _render_single_sport(
            conn,
            activity_id,
            sport,
            sessions_df,
            updated_category,
            feel,
            effort,
        )

    # -------------------------------------------------------------------------
    # SIMILAR ACTIVITIES — shown for training activities with a name
    # -------------------------------------------------------------------------
    if (updated_category == "training" or updated_category == 'race') and updated_title: # category is training and has a title
        similar_df = fetch_similar_activities(
            conn, activity_id, updated_title, sport
        )
        if not similar_df.empty:
            st.divider()
            st.subheader("Similar Activities")

            for _, row in similar_df.iterrows():
                render_activity_card(row, sport, conn, key_prefix="sim", on_same_page=True)
