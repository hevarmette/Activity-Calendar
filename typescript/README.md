# Activity Calendar — TypeScript Version

A modern rewrite of the Activity Calendar using React, Hono, and Bun. This is a monorepo managed with Bun workspaces, providing the same features as the [Streamlit version](../streamlit/) with a faster, more interactive UI.

## Features

### Calendar View
- Interactive monthly calendar displaying all activities, color-coded by sport
- Scheduled workouts displayed on the calendar alongside activities (dashed violet border, distinct from activity events)
- Click any scheduled workout to open a dialog with workout details, step summary, .fit download, edit link, and unschedule option
- Click any event to open a summary dialog with distance, duration, pace/speed, and an embedded GPS map with start/end markers and lap markers
- Click any empty date cell to create a manual activity (no GPS data) with that date pre-filled
- Manual activity creation dialog with title, sport, sub-sport, category, duration, lap splits (distance + time + intensity per lap), workout feel, and perceived effort
- Year/month navigation

### Activity Details Page
- Full-screen interactive Leaflet map with lap markers, auto mile markers, start/end icons, speed-colored route overlay, and fullscreen mode
- Multisport activities render per-session tabs with scoped maps, charts, laps, and per-leg summary cards (distance, duration, pace/speed/power)
- Performance charts (Recharts) plotted against distance: pace, heart rate, altitude, cadence, power
- Synchronized chart range selection that filters the map view
- Editable lap table with inline editing for distance, time, and intensity
- Lap selection with copy-paste intensity patterns (Ctrl+C/V) supporting cyclic repeat for bulk editing
- Auto laps computed from GPS data at configurable intervals with interpolated splits, elevation, HR, and cadence
- Activity stats grid with running dynamics (vertical oscillation, ground contact time, stride length, vertical ratio) and best lap
- Interval summary with clustering algorithm that auto-detects distance or time grouping, shows deviation trends
- Editable description, title, category, workout feel (SVG icons), and perceived effort slider
- Adjustable distance and duration in summary cards
- Previous/next activity navigation and keyboard shortcut (S) to save
- Similar activities comparison

### Activity Report Page
- Aggregated training summary grouped by daily, weekly, monthly, or yearly periods
- Filterable by sport and selectable time frame
- Stacked bar chart for distance over time
- Tabular breakdown with pace/speed appropriate to sport (pace/mi for running, mph for cycling, pace/100m for swimming)

### Activity Search Page
- Text search by title/description with fuzzy matching (handles variations like 5x600m vs 5 x 600m)
- Separate title and description search with exact case-insensitive substring matching
- Search executes on Enter key press (not on every keystroke) for a responsive editing experience
- Filter by sport, sub-sport, category, date range, distance range, and duration range
- Sort controls (distance, duration, ascending/descending)
- Click through to Activity Details for any result

### Workout Builder
- Create structured workouts with warmup, interval, rest, recovery, cooldown, and other step types
- Repeat groups to define interval sets (e.g., 4×1mi with 2min recovery)
- Drag-and-drop step reordering with grip handle
- Per-step distance unit selector (mi, km, m) — each step independently chooses its display unit
- Sport-specific step labels: "Run" for running, "Bike" for cycling, "Swim" for swimming
- Sport-specific target units: pace (min/mi) for running, mph for cycling, pace (min/100m) for swimming
- Target types: speed, heart rate, power, cadence, or open
- Duration types: time (minutes), distance (mi/km/m), or lap button (manual press)
- Warmup and cooldown default to lap button press
- Smart step insertion: new steps insert before the cooldown
- Visual preview bar showing workout structure color-coded by intensity
- Estimated total time and distance calculation
- Export as Garmin .fit file for direct upload to a watch (tested with Forerunner 570)
- Move, duplicate, and remove steps with always-visible action buttons
- Save/update workouts to the database with persistent URL (?id=N)
- Schedule workouts on specific calendar dates (optional scheduled_date field)
- Keyboard shortcut: S to save (matches activity details pattern)
- Load saved workouts from URL for editing

### Workout Library
- Browse all saved workouts in a compact list view
- Filter by sport (Running, Cycling, Swimming)
- Each row shows name, sport badge, created date, scheduled date (if any), and description
- Quick schedule/unschedule button with inline date picker on each workout row
- Edit saved workouts (navigates to builder with ?id=N)
- Download .fit files directly from the list
- Delete workouts with confirmation dialog
- "+ New Workout" button to create from scratch

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh/) |
| Client | React 19, Vite, TailwindCSS 4 |
| Server | [Hono](https://hono.dev/) |
| Database | PostgreSQL via [`postgres`](https://github.com/porsager/postgres) |
| Maps | [Leaflet](https://leafletjs.com/) / react-leaflet |
| Charts | [Recharts](https://recharts.org/) |
| Calendar | [FullCalendar](https://fullcalendar.io/) |
| State | [TanStack Query](https://tanstack.com/query) |
| Workout Encoding | [@garmin/fitsdk](https://github.com/garmin/fit-javascript-sdk) |
| Testing | [Playwright](https://playwright.dev/) |
| Linting | [Biome](https://biomejs.dev/) |

## Project Structure

```
typescript/
├── apps/
│   ├── client/             # React SPA (Vite)
│   │   ├── src/
│   │   │   ├── pages/     # CalendarPage, ActivityDetailsPage, ActivityReportPage, ActivitySearchPage, WorkoutBuilderPage, WorkoutsListPage
│   │   │   ├── components/ # UI components (maps, charts, laps, details, calendar, layout, workouts)
│   │   │   ├── api/       # TanStack Query hooks and API client
│   │   │   └── hooks/     # Custom hooks (activity navigation)
│   │   └── public/assets/ # SVG icons for workout feel
│   └── server/             # Hono REST API
│       └── src/
│           ├── routes/    # API routes (activities, laps, records, calendar, search, report, workouts, etc.)
│           └── lib/       # Auto-laps computation
├── packages/
│   └── shared/             # Shared types, constants, enums, formatting utilities, workout types
├── tests/
│   └── e2e/               # Playwright end-to-end tests
├── docker-compose.yml      # PostgreSQL + full stack
├── biome.json              # Linter/formatter config
├── playwright.config.ts    # E2E test config
└── package.json            # Bun workspace root
```

## Prerequisites

- [Bun](https://bun.sh/) 1.2+
- PostgreSQL database populated with parsed activity data (see [Fitness-File-Parser](https://github.com/hevarmette/Fitness-File-Parser))

## Setup

```bash
bun install
cp apps/server/.env.example apps/server/.env
```

Edit `apps/server/.env` with your database credentials:

```env
DATABASE_URL=postgresql://user:password@host:port/database
SCHEMA=your_schema_name
```

## Development

```bash
bun run dev          # Starts client (port 5173) and server (port 3000)
```

## Docker

Build and run the application as a single container:

```bash
docker compose build            # Build the image
docker compose up -d            # Start in background
docker compose logs -f server   # Watch logs
docker compose down             # Stop
```

The app reads database credentials from `apps/server/.env`. After code changes, rebuild and restart:

```bash
docker compose up -d --build
```

The application is accessible at `http://<your-ip>:3000` from any machine on your network.

## Testing

```bash
bunx playwright test  # End-to-end tests
```

## Linting & Formatting

```bash
bunx biome check .   # Lint
bunx biome format .  # Format
```
