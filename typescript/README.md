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
- Lap selection by clicking a row (Shift+Click for range selection), with copy-paste intensity patterns (Ctrl+C/V) supporting cyclic repeat for bulk editing; selection actions live in a floating bottom bar that overlays content (no layout shift)
- Auto laps computed from GPS data at configurable intervals with interpolated splits, elevation, HR, and cadence
- Activity stats grid with running dynamics (vertical oscillation, ground contact time, stride length, vertical ratio) and best lap
- Interval summary with clustering algorithm that auto-detects distance or time grouping, shows deviation trends
- Editable description, title, category, workout feel (SVG icons), and perceived effort slider
- Adjustable distance and duration in summary cards
- Previous/next activity navigation and keyboard shortcut (S) to save
- Similar activities comparison (for training/racing activities, each similar-activity row shows a Compare icon that jumps straight to the Activity Comparison page against the current activity)

### Activity Report Page
- Aggregated training summary grouped by daily, weekly, monthly, or yearly periods
- Filterable by sport and selectable time frame
- Stacked bar chart for distance over time
- Tabular breakdown with pace/speed appropriate to sport (pace/mi for running, mph for cycling, pace/100m for swimming)

### Activity Search Page
- Text search by title/description with fuzzy matching (handles variations like 5x600m vs 5 x 600m)
- Browse the full activity library with no search criteria — filters and sort apply on top, so date/sport/category/distance/duration filters work on their own
- Separate title and description search with exact case-insensitive substring matching
- Search executes on Enter key press (not on every keystroke) for a responsive editing experience
- Filter by sport, sub-sport, category, date range, distance range, and duration range
- Sort controls (distance, duration, ascending/descending)
- Multi-select activities with a hover/selected circular toggle per row and a minimal "Select all" text button; bulk export actions live in a floating bottom bar that overlays content (no layout shift)
- Export selected activities, or all matching activities, as a ZIP of Garmin .fit files
- Click through to Activity Details for any result
- Select exactly two activities to reveal a Compare action (opens the Activity Comparison page); a "pick a second activity" mode (entered via `?compareWith=<id>` from Activity Details) turns results into single-select-and-go for choosing the second activity

### Activity Export
- Export any completed activity as a Garmin .fit file directly from the Activity Details page (download icon in the header)
- Export a subset of activities (multi-select) or all matching activities from the Activity Search page as a single .fit-per-activity ZIP archive
- Reconstructs full activity .fit files from stored data: GPS records (positions converted to semicircles), laps, per-session data for multisport activities, swim lengths, timer events, and the activity summary
- Uses raw recorded values (no coordinate imputation or elevation correction) to preserve original fidelity — verified via an encode→decode round-trip
- Large exports are guarded by a configurable server cap (`EXPORT_MAX_ACTIVITIES`, default 500); per-activity encoding failures are skipped and listed in an `_export_errors.txt` manifest inside the archive rather than aborting the whole export

### Activity Comparison
- Compare two activities side-by-side on a dedicated page (`/compare?a=<id>&b=<id>`)
- Synchronized map animation overlaying both GPS tracks with two color-coded moving markers driven by a single shared playback clock
- Playback controls: play/pause, a draggable timeline scrubber, and a playback-speed selector (0.5×–8×)
- Independent per-activity start offset (mm:ss input + slider) to align efforts by skipping warmups so both markers begin together from chosen starts
- Smooth motion via `requestAnimationFrame` with position interpolated between ~1 Hz GPS points using each record's pause-removed elapsed time
- Side-by-side lap comparison with a single shared Intensity pill filter (same UX and enum as the Activity Details lap table) applied to both columns; the second activity's column shows per-lap split deltas (distance, time, pace/speed) computed against the same visible lap index in the first activity — faster reads green, slower reads red, with "—" where no paired lap exists at that index
- Marker/track/lap-header colors derive from each activity's sport, falling back to a distinct color pair on collision so the two are always distinguishable
- Entry points — Search: select exactly two activities → Compare; Details: Compare icon → pick the second activity via `?compareWith=<id>` hand-off
- Activities without GPS data gracefully degrade to a lap-only comparison (map and playback controls hidden)

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
| Activity Export | [@garmin/fitsdk](https://github.com/garmin/fit-javascript-sdk) + [fflate](https://github.com/101arrowz/fflate) (ZIP) |
| Testing | [Playwright](https://playwright.dev/) |
| Linting | [Biome](https://biomejs.dev/) |

## Project Structure

```
typescript/
├── apps/
│   ├── client/             # React SPA (Vite)
│   │   ├── src/
│   │   │   ├── pages/     # CalendarPage, ActivityDetailsPage, ActivityReportPage, ActivitySearchPage, ActivityComparePage, WorkoutBuilderPage, WorkoutsListPage
│   │   │   ├── components/ # UI components (maps, charts, laps, details, compare, calendar, layout, workouts)
│   │   │   ├── api/       # TanStack Query hooks and API client
│   │   │   ├── lib/       # Client-only helpers (geo: track downsampling + interpolation)
│   │   │   └── hooks/     # Custom hooks (activity navigation)
│   │   └── public/assets/ # SVG icons for workout feel
│   └── server/             # Hono REST API
│       └── src/
│           ├── routes/    # API routes (activities, laps, records, calendar, search, report, workouts, export, etc.)
│           └── lib/       # Auto-laps computation, activity .fit encoder (activity-fit), export data access
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

## Activity Export API

Two endpoints reconstruct completed activities into Garmin `.fit` files:

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET`  | `/api/activities/:id/export` | — | Single `.fit` file (`application/octet-stream`). `404` if the activity does not exist. |
| `POST` | `/api/export` | `ActivityExportRequest` JSON | ZIP archive (`application/zip`) of one `.fit` per activity. |

`ActivityExportRequest` selection precedence (enforced server-side):

1. `activityIds: number[]` — export exactly these IDs (filters ignored).
2. Text filters `q` / `titleSearch` / `descriptionSearch` (AND-combined, same semantics as `/api/search`).
3. `all: true` — export the entire library (explicit guard required).

A request with none of the above returns `400`. An empty match set returns `404`. Non-`all` requests exceeding `EXPORT_MAX_ACTIVITIES` (default `500`) return `413`. Per-activity encoding failures are skipped and listed in an `_export_errors.txt` file inside the archive.

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
