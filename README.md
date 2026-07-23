# Activity Calendar

A personal fitness activity dashboard for visualizing, analyzing, and managing workout data stored in a PostgreSQL database. It renders activities on an interactive calendar and provides deep drill-down into lap data, GPS routes, performance graphs, and training metrics.

The real benefit of having my own database and UI, compared to Garmin Connect and Strava, is that I can quickly find past activities and compare workouts against each other. This helps to build my training plan.

> **Note:** Database setup and FIT file parsing are handled by the companion [Fitness-File-Parser](https://github.com/hevarmette/Fitness-File-Parser) repository.

## Versions

This repository contains two implementations of the same application:

### [Streamlit (Python)](./streamlit/)

The original dashboard built with Streamlit, Folium, and Plotly. Mature and fully featured.

```bash
cd streamlit
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
streamlit run Activity_Calendar.py
```

### [TypeScript (React + Bun)](./typescript/)

A modern rewrite using React, Hono, and Bun. Currently in active development with full feature parity.

```bash
cd typescript
bun install
bun run dev
```

## Shared Database

Both versions connect to the same PostgreSQL database populated by the [Fitness-File-Parser](https://github.com/hevarmette/Fitness-File-Parser). Only tested with `.fit` files downloaded from [Garmin Connect](https://connect.garmin.com/).

## Repository Structure

```
├── streamlit/          # Python/Streamlit dashboard (original)
├── typescript/         # TypeScript/React rewrite (Bun monorepo)
├── .gitignore
└── README.md           # This file
```
