import streamlit as st
import psycopg2
from streamlit import session_state as ss
import pandas as pd
import numpy as np
from pyhigh import get_elevation_batch


def get_connection(local=True):
    if local:
        return psycopg2.connect(
            host=st.secrets["postgresql"]["host"],
            port=st.secrets["postgresql"]["port"],
            dbname=st.secrets["postgresql"]["database"],
            user=st.secrets["postgresql"]["username"],
            password=st.secrets["postgresql"]["password"],
        )
    else:
        return psycopg2.connect(st.secrets["postgresql_cloud"]["db_url"])


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
            (total_distance * {1 / ss.meters_to_miles}) AS distance_mi
        FROM {ss.schema}.lap
        WHERE activity_id = %s
        ORDER BY number ASC
    """
    df = pd.read_sql_query(sql_query, _conn, params=(activity_id,))
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

    # sql_query = f"""
    #     SELECT
    #         a.activity_id,
    #         a.timestamp AS activity_date,
    #         a.activity_name,
    #         s.sport
    #     FROM {ss.schema}.activity a
    #     JOIN {ss.schema}.session s ON a.activity_id = s.activity_id
    #     WHERE
    #         EXTRACT(YEAR FROM a.timestamp) = %s
    #         AND EXTRACT(MONTH FROM a.timestamp) = %s
    #     GROUP BY a.activity_id, s.sport;
    # """
    # try:
    #     df = pd.read_sql_query(sql_query, _conn, params=(year, month))
    #     return df
    sql_query = f"""
        SELECT
            a.activity_id,
            a.timestamp AS activity_date,
            a.activity_name,
            s.sport
        FROM {ss.schema}.activity a
        JOIN {ss.schema}.session s ON a.activity_id = s.activity_id
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
    sql_query = f"""
        SELECT adjusted_distance, adjusted_duration, CAST(avg_power AS INTEGER), description, workout_feel, effort, local_timestamp, activity_name, category
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
        points_df = pd.read_sql_query(sql_query, _conn, params=(activity_id,))
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
                        points_df["corrected_altitude"] = 0

            # timestamp, by definition, is included in the records table.
            points_df["elapsed_time"] = points_df["timestamp"] - np.repeat(
                points_df["timestamp"].iloc[0], len(points_df)
            )

            # points_df.dropna(subset=["latitude", "longitude"], inplace=True) TODO: this was uncommented, why?

            if "cadence" in pcols and "fractional_cadence" in pcols:
                ss.cadence = True
                points_df["total_cadence"] = (
                    points_df["cadence"] + points_df["fractional_cadence"]
                )

            if "heart_rate" in pcols:
                ss.hr = True

        return points_df

    except Exception as e:
        st.error(f"Error fetching activity points: {e}")
        return pd.DataFrame()
