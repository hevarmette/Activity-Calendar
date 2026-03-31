import folium
import branca
import plotly.express as px
from streamlit import session_state as ss

# Sport → polyline colour for multisport maps
SPORT_COLOR_MAP = {
    "running": "red",
    "cycling": "green",
    "swimming": "blue",
}
SPORT_COLOR_DEFAULT = "gray"


def create_activity_map(points_df, fullscreen, auto_lap_dist=1, sessions_df=None):
    """
    Creates a Folium map from a DataFrame of points.

    For multisport activities, pass sessions_df (result of fetch_sessions_for_activity)
    and each leg will be drawn in a sport-specific colour:
      running  → red
      cycling  → green
      swimming → blue (only when GPS is present)
      other    → gray
    """
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

    # -----------------------------------------------------------------------
    # ROUTE LINE(S)
    # -----------------------------------------------------------------------
    if sessions_df is not None and not sessions_df.empty and len(sessions_df) > 1:
        # Multisport: draw one coloured segment per session leg
        multisport_lines = folium.FeatureGroup(name="Route by Sport", show=True).add_to(
            route_map
        )

        for _, session_row in sessions_df.iterrows():
            sport = (session_row["sport"] or "").lower()
            color = SPORT_COLOR_MAP.get(sport, SPORT_COLOR_DEFAULT)

            # Slice points that fall within this session's time window
            seg_start = session_row["start_time"]
            seg_end = session_row["timestamp"]  # session timestamp = end time in FIT
            mask = (points_df["timestamp"] >= seg_start) & (
                points_df["timestamp"] <= seg_end
            )
            seg_df = points_df[mask]

            if seg_df.empty:
                continue

            seg_coords = list(
                seg_df[["latitude", "longitude"]].itertuples(index=False, name=None)
            )
            folium.PolyLine(
                locations=seg_coords,
                weight=5,
                color=color,
                tooltip=sport.capitalize(),
            ).add_to(multisport_lines)

        # Single-colour fallback layer (hidden by default for multisport)
        red_lines = folium.FeatureGroup(name="Default Line Color", show=False).add_to(
            route_map
        )
        folium.PolyLine(locations=coordinates, weight=5, color="red").add_to(red_lines)
    else:
        # Make line segments
        red_lines = folium.FeatureGroup(name="Default Line Color", show=True).add_to(
            route_map
        )
        folium.PolyLine(locations=coordinates, weight=5, color="red").add_to(red_lines)

    # Colored line based on speed (available for all activity types)
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

    # -----------------------------------------------------------------------
    # LAP MARKERS
    # -----------------------------------------------------------------------
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

    # -----------------------------------------------------------------------
    # AUTO MILE MARKERS
    # -----------------------------------------------------------------------
    show_auto_miles = len(ulaps) <= 1

    mile_markers_layer = folium.FeatureGroup(
        name="Auto Mile Markers", show=show_auto_miles
    ).add_to(route_map)

    points_df["distance_auto_lap"] = (
        points_df["distance"] / ss.meters_to_miles * auto_lap_dist
    )
    max_miles = int(points_df["distance_auto_lap"].max())

    # Iterate through each whole mile and place a marker
    for unit in range(1, max_miles + 1):
        # Find the first row where the cumulative distance passes this mile mark
        mile_row = points_df[points_df["distance_auto_lap"] >= unit].iloc[0]

        mile_icon = folium.plugins.BeautifyIcon(
            border_color="white",
            text_color="black",
            number=unit,
            inner_icon_style="margin-top:0;",
        )

        folium.Marker(
            location=[mile_row["latitude"], mile_row["longitude"]],
            icon=mile_icon,
        ).add_to(mile_markers_layer)

    # -----------------------------------------------------------------------
    # START / END MARKERS
    # -----------------------------------------------------------------------
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

    if fullscreen:
        folium.plugins.Fullscreen(
            position="bottomright",
            title="Expand map",
            title_cancel="Exit full screen",
            force_separate_button=True,
        ).add_to(route_map)

    folium.LayerControl(position="topright").add_to(route_map)
    return route_map


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
