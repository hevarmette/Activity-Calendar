# Activity Calendar

A Streamlit-based fitness activity dashboard for visualizing, analyzing, and managing workout data stored in a PostgreSQL database (I have my own files to parse the info I want in a sister repository [file-parser](https://github.com/hevarmette/Fitness-File-Parser), so make sure your schema has the required columns and tables). It renders activities on an interactive calendar and provides deep drill-down into lap data, GPS routes, performance graphs, and training metrics.

> **Note:** This app has only been tested with `.fit` files downloaded from [Garmin Connect](https://connect.garmin.com/). Database setup and FIT file parsing are handled by a separate companion repository.

## Purpose

Activity Calendar serves as a personal training log and analysis tool. It reads activity data from a PostgreSQL database and presents it through four main views — a calendar overview, detailed per-activity analysis with editable lap data, an aggregated activity report, and a searchable activity index.

## Features

### Calendar View (Home Page)

- Interactive monthly calendar displaying all activities, color-coded by sport (running, cycling, swimming, multisport)
- Click any event to open a summary dialog with distance, duration, pace/speed, and an embedded GPS map
- Multisport activities show per-leg breakdowns (e.g., Swim → Bike → Run) with sport-colored route segments
- Year/month navigation via sidebar controls
- One-click cache refresh to pull newly synced activities

### Activity Details Page

- Full-screen interactive Folium map with lap markers, auto mile markers, start/end icons, and multiple tile layers (OpenStreetMap, USGS Topo, Esri Satellite)
- Speed-colored route overlay as a toggleable layer
- Multisport activities render a color-coded overview map plus individual tabs per leg
- Performance graphs (Plotly) plotted against distance or time:
  - Running: pace, heart rate, altitude, cadence (SPM)
  - Cycling: speed, heart rate, altitude, cadence (RPM)
- Editable lap table with inline editing for distance, time, heart rate, and intensity (warm up / active / recovery / rest / cooldown)
- Auto laps computed from GPS data at configurable intervals (1 mi for running, 5 mi for cycling), with interpolated splits, elevation, HR, and cadence
- Activity details tab showing distance, duration, pace/speed, heart rate stats, elevation gain/loss, running dynamics (vertical oscillation, ground contact time, stride length, vertical ratio), and best lap
- Editable description, title, category, workout feel (5-level scale with SVG icons), and perceived effort (1–10 slider)
- Sidebar inputs to adjust total distance and duration
- Previous/next activity navigation
- Save button that generates and executes SQL updates for all modified fields

### Activity Report Page

- Aggregated training summary grouped by daily, weekly, monthly, or yearly periods
- Filterable by sport with multi-select
- Summary metrics: total activities, distance, time, and calories
- Stacked bar chart (Plotly) for distance, time, activity count, or calories over time
- Tabular breakdown with per-period distance, duration, avg pace/speed, avg distance, calories, elevation gain, and heart rate stats

### Activity Search Page

- Filter across all activities by sport, sub-sport, category, date range, distance range, and duration range
- Paginated results (20 per page) with activity cards showing key metrics
- Click through to the Activity Details page for any result
- Filters move to sidebar after initial search for more screen space

## Tech Stack

- **Frontend:** [Streamlit](https://streamlit.io/) with `streamlit-calendar` and `streamlit-folium`
- **Maps:** [Folium](https://python-visualization.github.io/folium/) with BeautifyIcon markers and ColorLine overlays
- **Charts:** [Plotly Express](https://plotly.com/python/plotly-express/)
- **Database:** PostgreSQL via [psycopg](https://www.psycopg.org/) (v3)
- **Elevation:** [pyhigh](https://github.com/jannismain/pyhigh) for corrected altitude from GPS coordinates
- **Data:** [pandas](https://pandas.pydata.org/)

## Project Structure

```
Activity-Calendar/
├── calendar_test_8.py          # Main entry point — calendar view and activity dialog
├── db.py                       # Database connection and all SQL queries
├── plotting.py                 # Folium map builder and Plotly chart factory
├── lap_processing.py           # Lap data processing, auto lap generation
├── utils.py                    # Session state init, time formatting, helpers
├── pages/
│   ├── 2_Activity_Details.py   # Detailed activity view with maps, graphs, lap editor
│   ├── 3_Activity_Report.py    # Aggregated training report with charts
│   └── 4_Activity_Search.py    # Searchable activity index with filters
├── assets/                     # SVG icons for workout feel indicators
├── .streamlit/
│   ├── config.toml             # Dark theme configuration
│   └── secrets.toml            # Database credentials (gitignored)
└── requirements.txt            # Python dependencies
```

## Setup

### Prerequisites

- Python 3.12+
- PostgreSQL database populated with parsed activity data (see the companion repo for database setup and FIT file ingestion)

### Installation

```bash
git clone https://github.com/hevarmette/Activity-Calendar.git
cd Activity-Calendar
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Configuration

Create `.streamlit/secrets.toml` with your database credentials. I just have a local copy for testing and on online database provider I use for real:

```toml
schema = "your_schema_name"

[postgresql]
host = "localhost"
port = "your_port"
database = "your_database"
username = "your_user"
password = "your_password"

[postgresql_cloud]
db_url = "postgresql://user:password@host:port/database"
```

### Running

```bash
streamlit run calendar_test_8.py
```
