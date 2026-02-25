import pandas as pd
import base64


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


# NOTE: Not used right now
# This is for the to do to recalculate paces as user edits data. requires processed lap data to be in the session state
def recalculate_pace(df):
    non_zero_dist = df["Distance (miles)"] > 0
    # get seconds per lap
    df["Time"] = df["Time (formatted)"].apply(parse_hms_to_seconds())
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


def format_pace(x):
    """pace formatting logic."""
    if pd.notna(x):
        return "{:d}:{:02d}".format(*divmod(int(round(x * 60)), 60))
    return None


def get_svg_markdown(label):
    """Reads an SVG and converts it to a markdown image string."""
    filename = f"assets/{label.replace(' ', '-')}.svg"
    try:
        with open(filename, "rb") as f:
            b64_encoded = base64.b64encode(f.read()).decode("utf-8")
        # Creates a markdown image tag followed by the label text
        return f"![{label}](data:image/svg+xml;base64,{b64_encoded}) {label}"
    except FileNotFoundError:
        return label  # Fallback to plain text if the SVG is missing
