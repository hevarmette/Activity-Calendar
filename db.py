import streamlit as st
import psycopg
from streamlit import session_state as ss
import pandas as pd
from pyhigh import get_elevation_batch


def get_connection(local=True):
    if local:
        return psycopg.connect(
            host=st.secrets["postgresql"]["host"],
            port=st.secrets["postgresql"]["port"],
            dbname=st.secrets["postgresql"]["database"],
            user=st.secrets["postgresql"]["username"],
            password=st.secrets["postgresql"]["password"],
        )
    else:
        return psycopg.connect(st.secrets["postgresql_cloud"]["db_url"])


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
            (total_distance * {1 / ss.meters_to_miles}) AS distance_mi,
            avg_power,
            max_power
        FROM {ss.schema}.lap
        WHERE activity_id = %s
        ORDER BY number ASC
    """
    with _conn.cursor() as cursor:
        cursor.execute(sql_query, (activity_id,))
        columns = [desc.name for desc in cursor.description]
        data = cursor.fetchall()

    df = pd.DataFrame(data, columns=columns)
    return df


@st.cache_data
def fetch_lap_data_for_session(_conn, activity_id, first_lap_index, num_laps):
    """Fetches lap data for a specific session within a multisport activity."""
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
            (total_distance * {1 / ss.meters_to_miles}) AS distance_mi,
            avg_power,
            max_power
        FROM {ss.schema}.lap
        WHERE activity_id = %s
          AND number >= %s
          AND number < %s
        ORDER BY number ASC
    """
    last_lap = first_lap_index + num_laps
    with _conn.cursor() as cursor:
        cursor.execute(sql_query, (activity_id, first_lap_index, last_lap))
        columns = [desc.name for desc in cursor.description]
        data = cursor.fetchall()

    df = pd.DataFrame(data, columns=columns)
    return df


def get_lap_update_query(lap_id, db_column, new_value):
    """
    Returns a safe (query, params) tuple for updating a single value.
    """
    # Use %s for the value to handle quotes/types safely
    # We inject db_column directly because we validate it against our map first (safe whitelist)
    query = f"UPDATE {ss.schema}.lap SET {db_column} = %s WHERE lap_id = %s;"
    params = (new_value, lap_id)
    return query, params


# --- 2. DATA RETRIEVAL (Same as before) ---
@st.cache_data
def retrieve_monthly_data(_conn):  # , year, month):
    """Fetches activity data for a given month and year from the database."""
    if _conn is None:
        return pd.DataFrame()

    # Aggregate sessions so multisport activities appear as a single calendar row.
    # STRING_AGG collects all sport types; SUM aggregates distance and time across legs.
    sql_query = f"""
        SELECT
            a.activity_id,
            a.timestamp AS activity_date,
            a.activity_name,
            a.num_sessions,
            STRING_AGG(s.sport, ',' ORDER BY s.start_time) AS sport,
            SUM(s.total_distance) AS total_distance,
            SUM(s.total_timer_time) AS total_timer_time
        FROM {ss.schema}.activity a
        JOIN {ss.schema}.session s ON a.activity_id = s.activity_id
        GROUP BY a.activity_id, a.timestamp, a.activity_name, a.num_sessions
        ORDER BY activity_date DESC;
    """
    try:
        with _conn.cursor() as cursor:
            cursor.execute(sql_query)
            columns = [desc.name for desc in cursor.description]
            data = cursor.fetchall()

        df = pd.DataFrame(data, columns=columns)
        return df
    except Exception as e:
        st.error(f"Error executing query: {e}")
        return pd.DataFrame()


@st.cache_data
def fetch_sessions_for_activity(_conn, activity_id):
    """
    Fetches all sessions for an activity, ordered by start_time.
    Returns a DataFrame with one row per session — used for multisport tab rendering.
    """
    if _conn is None:
        return pd.DataFrame()

    sql_query = f"""
        SELECT
            session_id,
            activity_id,
            start_time,
            "timestamp",
            sport,
            sub_sport,
            total_distance,
            total_timer_time,
            avg_power,
            avg_heart_rate,
            max_heart_rate,
            enhanced_avg_speed,
            avg_speed,
            total_ascent,
            total_descent,
            first_lap_index,
            num_laps
        FROM {ss.schema}.session
        WHERE activity_id = %s
        ORDER BY start_time ASC
    """
    try:
        with _conn.cursor() as cursor:
            cursor.execute(sql_query, (activity_id,))
            columns = [desc.name for desc in cursor.description]
            data = cursor.fetchall()

        return pd.DataFrame(data, columns=columns)
    except Exception as e:
        st.error(f"Error fetching sessions: {e}")
        return pd.DataFrame()


@st.cache_data
def fetch_activity_details(_conn, activity_id):
    """Fetches main details for a specific activity from the database."""
    if _conn is None:
        return None
    sql_query = f"""
        SELECT adjusted_distance, adjusted_duration, CAST(avg_power AS INTEGER), description, workout_feel, effort, COALESCE(local_timestamp, activity.timestamp), activity_name, category
        FROM {ss.schema}.activity JOIN {ss.schema}.session ON activity.activity_id = session.activity_id WHERE activity.activity_id = %s
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
    ss.hr = False
    ss.coordinates = False
    ss.cadence = False

    if _conn is None:
        return pd.DataFrame()

    # In rare cases, I was receiving an NA error when plotting some maps, so
    # this query will impute missing values by taking the next available, and
    # previous lat and long. will not work if missing value is at the start or
    # end. for that see if the session table has the start and end lat and longs
    sql_query = f"""
        WITH groups AS (
            SELECT 
                record_id,
                activity_id,
                "timestamp",
                latitude,
                longitude,
                lap,
                altitude,
                heart_rate,
                cadence,
                fractional_cadence,
                enhanced_speed,
                distance,
                -- Create group IDs for forward and backward fills
                COUNT(latitude) OVER (ORDER BY "timestamp" ASC) as fwd_grp,
                COUNT(latitude) OVER (ORDER BY "timestamp" DESC) as bwd_grp
            FROM {ss.schema}.record
            WHERE activity_id = %s
        ),
        imputed_bounds AS (
            SELECT 
                *,
                -- Previous valid value (forward fill)
                FIRST_VALUE(latitude) OVER (PARTITION BY fwd_grp ORDER BY "timestamp" ASC) as prev_lat,
                FIRST_VALUE(longitude) OVER (PARTITION BY fwd_grp ORDER BY "timestamp" ASC) as prev_long,
                
                -- Next valid value (backward fill)
                FIRST_VALUE(latitude) OVER (PARTITION BY bwd_grp ORDER BY "timestamp" DESC) as next_lat,
                FIRST_VALUE(longitude) OVER (PARTITION BY bwd_grp ORDER BY "timestamp" DESC) as next_long
            FROM groups
        )
        SELECT 
            record_id,
            activity_id,
            COALESCE(
                latitude,                                    -- Use actual value if not null
                (prev_lat + next_lat) / 2.0,                -- Average if both bounds exist
                next_lat,                                    -- Use next if at start (no previous)
                prev_lat                                     -- Use previous if at end (no next)
            ) as latitude,
            COALESCE(
                longitude,
                (prev_long + next_long) / 2.0,
                next_long,                                   -- Use next if at start
                prev_long                                    -- Use previous if at end
            ) as longitude,
            lap,
            altitude,
            "timestamp",
            heart_rate,
            cadence,
            fractional_cadence,
            enhanced_speed,
            distance
        FROM imputed_bounds
        ORDER BY "timestamp" ASC;
    """
    try:
        with _conn.cursor() as cursor:
            cursor.execute(sql_query, (activity_id,))
            columns = [desc.name for desc in cursor.description]
            data = cursor.fetchall()

        points_df = pd.DataFrame(data, columns=columns)
        pcols = points_df.columns
        if not points_df.empty:
            # Ensure lat/lon are numeric and not null
            if "latitude" in pcols and "longitude" in pcols:
                ss.coordinates = True
                points_df["latitude"] = pd.to_numeric(
                    points_df["latitude"], errors="coerce"
                )
                points_df["longitude"] = pd.to_numeric(
                    points_df["longitude"], errors="coerce"
                )

                # Getting elevation data from 3rd party package because the garmin data is bad
                # if "latitude" in points_df.columns and "longitude" in points_df.columns:
                coordinates = list(
                    points_df[["latitude", "longitude"]].itertuples(
                        index=False, name=None
                    )
                )
                try:
                    points_df["corrected_altitude"] = (
                        get_elevation_batch(coordinates) * 3.28084
                    )  # Converting meters to feet
                except Exception as e:
                    # st.warning(f"Network error getting elevation: {e}") # Optional logging
                    print(e)
                    if "altitude" in points_df.columns:
                        points_df["corrected_altitude"] = (
                            points_df["altitude"] * 3.28084
                        )  # converting from meters to feet
                    else:
                        points_df["corrected_altitude"] = 0.0

            # timestamp, by definition, is included in the records table.
            points_df["elapsed_time"] = points_df["timestamp"] - points_df["timestamp"].iloc[0]

            # Compute pause-removed elapsed time using timer events
            # so time-based graphs don't show gaps during paused periods.
            events_df = fetch_activity_events(_conn, activity_id)
            if events_df is not None and not events_df.empty:
                timer_events = events_df[events_df["event"] == "timer"]
                stops = timer_events.loc[timer_events["event_type"] == "stop_all", "timestamp"].reset_index(drop=True)
                if not stops.empty:
                    starts = timer_events.loc[
                        (timer_events["event_type"] == "start") & (timer_events["timestamp"] > stops.iloc[0]),
                        "timestamp",
                    ].reset_index(drop=True)
                    pair_count = min(len(stops), len(starts))
                    if pair_count > 0:
                        # Build cumulative paused time at each point's timestamp
                        paused_cumulative = pd.Series(pd.Timedelta(0), index=points_df.index)
                        for i in range(pair_count):
                            pause_duration = starts.iloc[i] - stops.iloc[i]
                            if pause_duration > pd.Timedelta(0):
                                paused_cumulative = paused_cumulative.where(
                                    points_df["timestamp"] < starts.iloc[i],
                                    paused_cumulative + pause_duration,
                                )
                        points_df["elapsed_time"] = points_df["elapsed_time"] - paused_cumulative

            # points_df.dropna(subset=["latitude", "longitude"], inplace=True) TODO: this was uncommented, why?

            if "cadence" in pcols and "fractional_cadence" in pcols:
                ss.cadence = True
                points_df["total_cadence"] = points_df["cadence"] + points_df[
                    "fractional_cadence"
                ].astype(float)

            if "heart_rate" in pcols:
                ss.hr = True

        return points_df

    except Exception as e:
        st.error(f"Error fetching activity points: {e}")
        return pd.DataFrame()


@st.cache_data
def fetch_activity_events(_conn, activity_id):
    """Fetches timer events to calculate paused time."""
    if _conn is None:
        return pd.DataFrame()

    sql_query = f"""
        SELECT timestamp, event, event_type
        FROM {ss.schema}.event
        WHERE activity_id = %s AND event = 'timer'
        ORDER BY timestamp ASC;
    """
    try:
        with _conn.cursor() as cursor:
            cursor.execute(sql_query, (activity_id,))
            columns = [desc.name for desc in cursor.description]
            data = cursor.fetchall()

        return pd.DataFrame(data, columns=columns)
    except Exception as e:
        st.error(f"Error fetching activity events: {e}")
        return pd.DataFrame()


@st.cache_data
def fetch_report_data(_conn):
    """Fetches per-session rows for the activity report page."""
    if _conn is None:
        return pd.DataFrame()

    sql_query = f"""
        SELECT
            a.activity_id,
            a.local_timestamp,
            s.sport,
            s.total_distance,
            s.total_timer_time,
            s.total_calories,
            s.total_ascent,
            s.total_descent,
            s.avg_heart_rate,
            s.max_heart_rate
        FROM {ss.schema}.activity a
        JOIN {ss.schema}.session s ON a.activity_id = s.activity_id
        ORDER BY a.local_timestamp DESC;
    """
    try:
        with _conn.cursor() as cursor:
            cursor.execute(sql_query)
            columns = [desc.name for desc in cursor.description]
            data = cursor.fetchall()

        return pd.DataFrame(data, columns=columns)
    except Exception as e:
        st.error(f"Error fetching report data: {e}")
        return pd.DataFrame()


@st.cache_data
def fetch_search_data(_conn):
    """Fetches per-session rows for the activity search page."""
    if _conn is None:
        return pd.DataFrame()

    sql_query = f"""
        SELECT
            a.activity_id,
            a.local_timestamp,
            a.activity_name,
            a.category,
            a.num_sessions,
            s.sport,
            s.sub_sport,
            s.total_distance,
            s.total_timer_time,
            s.total_calories,
            s.total_ascent,
            s.total_descent,
            s.avg_heart_rate,
            s.max_heart_rate,
            s.enhanced_avg_speed
        FROM {ss.schema}.activity a
        JOIN {ss.schema}.session s ON a.activity_id = s.activity_id
        ORDER BY a.local_timestamp DESC;
    """
    try:
        with _conn.cursor() as cursor:
            cursor.execute(sql_query)
            columns = [desc.name for desc in cursor.description]
            data = cursor.fetchall()

        return pd.DataFrame(data, columns=columns)
    except Exception as e:
        st.error(f"Error fetching search data: {e}")
        return pd.DataFrame()
