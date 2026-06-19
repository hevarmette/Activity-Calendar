# Migration Plan: Activity Calendar — Streamlit/Python → TypeScript/React/Bun

## 1. Architecture Overview

**Split:** Monorepo with a Bun-powered API server and a React SPA client.

```
┌─────────────────────┐         ┌─────────────────────────┐
│   React SPA (Vite)  │ ──────▶ │  Bun/Hono API Server    │
│   Port 5173 (dev)   │  HTTP   │  Port 3000              │
└─────────────────────┘         └────────────┬────────────┘
                                             │ SQL
                                             ▼
                                   ┌──────────────────┐
                                   │   PostgreSQL DB   │
                                   └──────────────────┘
```

- **Client:** React SPA served statically in production. Handles all rendering, maps, charts, and user interactions.
- **Server:** Hono framework on Bun runtime. Thin JSON API layer — accepts requests, runs parameterized SQL, returns JSON. No business logic beyond query composition.
- **Shared:** TypeScript types, constants, and unit conversion utilities shared between client and server via a `packages/shared` workspace package.
- **Communication:** REST JSON API. The client uses TanStack Query for data fetching, caching, and mutations.

---

## 2. Tech Stack Decisions

### Server

| Package | Version | Rationale |
|---------|---------|-----------|
| `bun` | 1.2+ | Runtime — fast startup, native TS, built-in test runner |
| `hono` | 4.7.4 | Lightweight web framework with excellent Bun support, middleware ecosystem |
| `postgres` | 3.4.5 | (`postgresjs/postgres`) — zero-dep Postgres client with tagged template queries, connection pooling |
| `zod` | 3.24.4 | Request validation and type inference |

### Client

| Package | Version | Rationale |
|---------|---------|-----------|
| `react` | 19.1.0 | UI framework |
| `react-dom` | 19.1.0 | DOM renderer |
| `react-router` | 7.6.2 | Client-side routing (4 pages) |
| `@tanstack/react-query` | 5.75.2 | Server state management, caching, background refetch |
| `leaflet` | 1.9.4 | Map rendering (replaces Folium) |
| `react-leaflet` | 5.0.0 | React bindings for Leaflet |
| `recharts` | 2.15.3 | Charting library (replaces Plotly — lighter, React-native) |
| `@fullcalendar/react` | 6.1.17 | Calendar component (replaces streamlit-calendar) |
| `@fullcalendar/daygrid` | 6.1.17 | Month grid view |
| `@fullcalendar/interaction` | 6.1.17 | Click events on calendar |
| `tailwindcss` | 4.1.8 | Utility-first CSS (dark theme) |
| `vite` | 6.3.5 | Build tool |
| `typescript` | 5.8.3 | Type safety |
| `@types/leaflet` | 1.9.18 | Leaflet type definitions |

### Dev/Tooling

| Package | Version | Rationale |
|---------|---------|-----------|
| `biome` | 1.9.4 | Linter + formatter (replaces eslint+prettier, fast) |
| `concurrently` | 9.1.2 | Run client+server in dev |

---

## 3. Project Structure

```
activity-calendar/
├── package.json                    # Workspace root
├── bun.lock
├── biome.json
│
├── packages/
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── constants.ts        # METERS_PER_MILE, MPS_TO_MPH, METERS_TO_FEET
│       │   ├── types.ts            # Activity, Lap, Session, Record, Event types
│       │   ├── enums.ts            # Sport, Intensity enums
│       │   └── formatting.ts       # convertSecondsToHms, formatPace, parseHmsToSeconds
│
├── apps/
│   ├── server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts            # Hono app entry, listen on 3000
│   │   │   ├── db.ts               # postgres client, connection config
│   │   │   ├── routes/
│   │   │   │   ├── activities.ts   # GET /api/activities, GET /api/activities/:id
│   │   │   │   ├── calendar.ts     # GET /api/calendar
│   │   │   │   ├── laps.ts         # GET /api/activities/:id/laps, PATCH /api/laps/:id
│   │   │   │   ├── records.ts      # GET /api/activities/:id/records
│   │   │   │   ├── sessions.ts     # GET /api/activities/:id/sessions
│   │   │   │   ├── lengths.ts      # GET /api/activities/:id/lengths, PATCH, POST combine
│   │   │   │   ├── events.ts       # GET /api/activities/:id/events
│   │   │   │   ├── report.ts       # GET /api/report
│   │   │   │   ├── search.ts       # GET /api/search
│   │   │   │   └── similar.ts      # GET /api/activities/:id/similar
│   │   │   ├── middleware/
│   │   │   │   └── cors.ts
│   │   │   └── lib/
│   │   │       ├── auto-laps.ts    # Auto lap computation (port of lap_processing.py)
│   │   │       └── elevation.ts    # Elevation correction via external API
│   │   └── .env                    # DB credentials
│   │
│   └── client/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── index.html
│       ├── public/
│       │   └── assets/             # SVG feel icons
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx             # Router setup
│       │   ├── api/
│       │   │   ├── client.ts       # fetch wrapper, base URL config
│       │   │   └── queries.ts      # TanStack Query hooks
│       │   ├── pages/
│       │   │   ├── CalendarPage.tsx
│       │   │   ├── ActivityDetailsPage.tsx
│       │   │   ├── ActivityReportPage.tsx
│       │   │   └── ActivitySearchPage.tsx
│       │   ├── components/
│       │   │   ├── layout/
│       │   │   │   ├── Sidebar.tsx
│       │   │   │   └── PageLayout.tsx
│       │   │   ├── calendar/
│       │   │   │   ├── ActivityCalendar.tsx
│       │   │   │   └── ActivityDialog.tsx
│       │   │   ├── maps/
│       │   │   │   ├── ActivityMap.tsx
│       │   │   │   ├── SpeedColorLine.tsx
│       │   │   │   ├── LapMarkers.tsx
│       │   │   │   └── MileMarkers.tsx
│       │   │   ├── charts/
│       │   │   │   ├── PaceChart.tsx
│       │   │   │   ├── HeartRateChart.tsx
│       │   │   │   ├── AltitudeChart.tsx
│       │   │   │   ├── CadenceChart.tsx
│       │   │   │   └── ReportBarChart.tsx
│       │   │   ├── laps/
│       │   │   │   ├── LapTable.tsx
│       │   │   │   ├── AutoLapTable.tsx
│       │   │   │   ├── IntervalSummary.tsx
│       │   │   │   └── SwimLengthTable.tsx
│       │   │   ├── details/
│       │   │   │   ├── ActivityHeader.tsx
│       │   │   │   ├── ActivityMetrics.tsx
│       │   │   │   ├── RunningDynamics.tsx
│       │   │   │   ├── WorkoutFeel.tsx
│       │   │   │   └── EffortSlider.tsx
│       │   │   ├── search/
│       │   │   │   ├── SearchFilters.tsx
│       │   │   │   └── ActivityCard.tsx
│       │   │   └── ui/
│       │   │       ├── MetricCard.tsx
│       │   │       ├── Dialog.tsx
│       │   │       └── Pagination.tsx
│       │   ├── hooks/
│       │   │   ├── useActivityNavigation.ts
│       │   │   └── useLapEditor.ts
│       │   ├── lib/
│       │   │   └── lap-processing.ts
│       │   └── styles/
│       │       └── globals.css
│       └── .env                     # VITE_API_URL=http://localhost:3000
```

---

## 4. Component Hierarchy

```
App
├── PageLayout
│   ├── Sidebar (navigation, year/month selector on calendar page)
│   └── <Outlet/> (page content)
│
├── CalendarPage                         ← Activity_Calendar.py
│   ├── ActivityCalendar                 ← streamlit-calendar widget
│   └── ActivityDialog (modal)           ← show_activity_dialog()
│       ├── ActivityMetrics (distance/duration/pace)
│       ├── MultisportLegs (conditional)
│       ├── ActivityMap (mini, no fullscreen)
│       ├── WorkoutFeel + EffortSlider (display only)
│       └── "View Details" link
│
├── ActivityDetailsPage                  ← pages/2_Activity_Details.py
│   ├── ActivityHeader (title, description, category editors)
│   ├── ActivityMetrics (editable distance/duration in sidebar)
│   ├── ActivityMap (fullscreen, layers, markers)
│   │   ├── SpeedColorLine
│   │   ├── LapMarkers
│   │   └── MileMarkers
│   ├── Tabs
│   │   ├── Tab: Laps
│   │   │   ├── LapTable (editable) OR CyclingLapTable OR SwimLengthTable
│   │   │   ├── AutoLapTable
│   │   │   └── IntervalSummary
│   │   ├── Tab: Graphs
│   │   │   ├── PaceChart / SpeedChart (conditional on sport)
│   │   │   ├── HeartRateChart
│   │   │   ├── AltitudeChart
│   │   │   └── CadenceChart
│   │   ├── Tab: Details
│   │   │   ├── RunningDynamics (conditional)
│   │   │   ├── WorkoutFeel (editable)
│   │   │   └── EffortSlider (editable)
│   │   └── Tab: Similar Activities
│   │       └── ActivityCard[]
│   ├── SaveButton (mutation)
│   └── PrevNext navigation
│
├── ActivityReportPage                   ← pages/3_Activity_Report.py
│   ├── Filters (sport multiselect, grouping period)
│   ├── Summary metrics (totals)
│   ├── ReportBarChart (stacked)
│   └── ReportTable
│
└── ActivitySearchPage                   ← pages/4_Activity_Search.py
    ├── SearchFilters (sport, sub-sport, category, date, distance, duration)
    ├── ActivityCard[] (paginated)
    └── Pagination
```

---

## 5. Data Layer

### API Routes

| Method | Path | Maps to (db.py) | Response |
|--------|------|-----------------|----------|
| GET | `/api/calendar` | `retrieve_monthly_data()` | `CalendarEvent[]` |
| GET | `/api/activities/:id` | `fetch_activity_details()` | `ActivityDetails` |
| GET | `/api/activities/:id/records` | `fetch_activity_points()` | `RecordPoint[]` |
| GET | `/api/activities/:id/sessions` | `fetch_sessions_for_activity()` | `Session[]` |
| GET | `/api/activities/:id/laps` | `fetch_lap_data()` | `Lap[]` |
| GET | `/api/activities/:id/laps?first_lap_index=N&num_laps=M` | `fetch_lap_data_for_session()` | `Lap[]` |
| GET | `/api/activities/:id/auto-laps?sport=running&dist=1` | `create_auto_laps()` | `AutoLap[]` |
| GET | `/api/activities/:id/lengths` | `fetch_length_data()` | `SwimLength[]` |
| GET | `/api/activities/:id/events` | `fetch_activity_events()` | `TimerEvent[]` |
| GET | `/api/activities/:id/similar` | `fetch_similar_activities()` | `SimilarActivity[]` |
| GET | `/api/report` | `fetch_report_data()` | `ReportRow[]` |
| GET | `/api/search` | `fetch_search_data()` | `SearchRow[]` |
| PATCH | `/api/activities/:id` | UPDATE activity | `{ success: true }` |
| PATCH | `/api/laps/:id` | `get_lap_update_query()` | `{ success: true }` |
| PATCH | `/api/lengths/:id` | `get_length_update_query()` | `{ success: true }` |
| POST | `/api/lengths/combine` | `combine_lengths()` | `{ success: true }` |

### Database Client Setup (`apps/server/src/db.ts`)

```typescript
import postgres from "postgres";

const sql = postgres({
  host: process.env.DB_HOST!,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME!,
  username: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  max: 10,
  idle_timeout: 20,
  transform: { column: { from: postgres.toCamel } },
});

export const SCHEMA = process.env.DB_SCHEMA || "public";
export default sql;
```

### Caching Strategy

| Layer | Mechanism | TTL / Invalidation |
|-------|-----------|-------------------|
| **Client** | TanStack Query `staleTime` | 5 min for lists, `Infinity` for immutable detail data |
| **Client** | TanStack Query `gcTime` | 30 min — keeps inactive data for fast back-navigation |
| **Client** | Manual invalidation | After PATCH mutations, invalidate specific query keys |
| **Server** | HTTP `Cache-Control` | `max-age=300` on list endpoints, `no-cache` on editable endpoints |
| **Server** | Connection pooling | `postgres` lib handles with `max: 10` connections |

---

## 6. Routing

| Streamlit Page | React Route | URL Params / Search Params |
|---|---|---|
| `Activity_Calendar.py` | `/` | `?year=2025&month=6` |
| `pages/2_Activity_Details.py` | `/activity/:activityId` | `?sport=running` |
| `pages/3_Activity_Report.py` | `/report` | `?sports=running,cycling&group=monthly&metric=distance` |
| `pages/4_Activity_Search.py` | `/search` | `?sports=running&categories=training&from=2024-01-01&to=2025-06-19&minDist=3&maxDist=10&page=1&sort=total_distance&dir=desc` |

### Route Definitions

```tsx
<Routes>
  <Route path="/" element={<CalendarPage />} />
  <Route path="/activity/:activityId" element={<ActivityDetailsPage />} />
  <Route path="/report" element={<ActivityReportPage />} />
  <Route path="/search" element={<ActivitySearchPage />} />
</Routes>
```

### Key Decisions

- `selected_activity_id` → URL param `:activityId` — deep-links work directly
- `selected_activity_sport` → search param `?sport=` — rendering hint
- `selected_year`/`selected_month` → search params `?year=&month=` — shareable calendar URLs
- All search/report filters → search params — bookmarkable, back/forward works
- Prev/next navigation → `router.navigate(`/activity/${nextId}?sport=${nextSport}`)` — no session state

---

## 7. State Management

### URL State (via `useSearchParams`)

| Python `ss.*` | React Equivalent |
|---|---|
| `ss.selected_year` | `searchParams.get("year")` |
| `ss.selected_month` | `searchParams.get("month")` |
| `ss.selected_activity_id` | Route param `:activityId` |
| `ss.selected_activity_sport` | `searchParams.get("sport")` |
| `ss.search_submitted` | Implicit — presence of search params |
| All search/report filter state | URL search params |

### TanStack Query Cache (server state)

| Python `ss.*` | Query Key |
|---|---|
| `ss.activities_df` | `["activities", "monthly"]` |
| `ss.activity_details` | `["activity", activityId, "details"]` |
| `ss.points_df` | `["activity", activityId, "points"]` |
| Lap data | `["activity", activityId, "laps"]` |
| Sessions | `["activity", activityId, "sessions"]` |
| Events | `["activity", activityId, "events"]` |
| Lengths | `["activity", activityId, "lengths"]` |
| Similar activities | `["activity", activityId, "similar"]` |
| Report data | `["activities", "report"]` |
| Search data | `["activities", "search"]` |

### Component-Local State (`useState`)

All editable form fields (lap edits, title, description, category, feel, effort, distance/duration overrides, axis toggles, intensity filter).

### Global Constants (module exports)

`METERS_PER_MILE`, `FEEL_MAP`, `EFFORT_LABELS`, `AUTO_LAP_DISTANCES` — no store needed.

---

## 8. Migration Phases

### Phase 1: Project Scaffolding & API Layer (12–16 hours)
- Monorepo setup (Bun workspaces, tsconfig, biome)
- Shared types & constants package
- Hono server with all API route stubs
- Port all `db.py` queries to TypeScript
- Auto-lap computation on server side

### Phase 2: React Shell & Routing (6–8 hours)
- Vite + React + React Router setup
- TanStack Query client configuration
- API client with typed fetch wrappers
- Layout component with sidebar navigation
- Utility functions port (time formatting, pace)

### Phase 3: Calendar Page (10–14 hours)
- FullCalendar integration with sport color-coding
- Activity dialog modal with metrics + mini map
- Year/month navigation via URL params

### Phase 4: Activity Details Page (24–32 hours) — Critical Path
- Full Leaflet map (layers, markers, speed-colored polyline)
- Performance charts (pace/speed, HR, altitude, cadence)
- Editable lap table with dirty tracking
- Auto-laps display
- Activity metadata editing (title, description, feel, effort)
- Save mutation with cache invalidation
- Prev/next navigation
- Similar activities
- Swimming lengths editor
- Multisport tabs

### Phase 5: Activity Report Page (8–10 hours)
- Client-side aggregation by period/sport
- Stacked bar chart
- Summary metrics + data table

### Phase 6: Activity Search Page (8–10 hours)
- Filter controls from URL params
- Paginated activity cards
- Sidebar layout after search

### Phase 7: Polish & Deployment (8–12 hours)
- Dark theme (match current Streamlit theme)
- Loading states, error boundaries
- Responsive layout
- Docker deployment config

**Total Estimated Effort: 76–102 hours**

**Dependency Graph:**
```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──┐
                    │              │
                    ├──→ Phase 4 ──┤
                    │              │
                    ├──→ Phase 5 ──┼──→ Phase 7
                    │              │
                    └──→ Phase 6 ──┘
```

Phases 3–6 can run in parallel after Phase 2. Phase 4 is critical path.

---

## 9. Feature Parity Checklist

### Calendar Page (9 features)
- ✅ Monthly calendar with color-coded sport events → FullCalendar `dayGridMonth`
- ✅ Click event → summary dialog → `eventClick` → Dialog component
- ✅ Dialog metrics (distance/duration/pace) → MetricCard components
- ✅ Dialog GPS map → react-leaflet mini map
- ✅ Multisport per-leg breakdown → fetch sessions, render in dialog
- ✅ "View Lap Details" → `<Link to="/activity/:id">`
- ✅ Year/month navigation → URL search params
- ✅ "Fetch New Activities" → `queryClient.invalidateQueries()`
- ✅ Sport color map → shared constants

### Activity Details Page (41 features)
- ✅ Full-screen map with tile layers → react-leaflet + LayersControl
- ✅ Speed-colored route overlay → custom SpeedColorLine component
- ✅ Lap markers (numbered) → leaflet-beautify-marker
- ✅ Auto mile markers → computed from distance data
- ✅ Start/end markers → BeautifyIcon play/stop
- ✅ Multisport sport-colored segments → per-session Polyline
- ✅ Fullscreen button → leaflet.fullscreen plugin
- ✅ Performance graphs vs Distance/Time → Recharts with toggle
- ✅ Pace chart (inverted Y) → Recharts reversed YAxis
- ✅ Speed chart (cycling) → Recharts line
- ✅ Heart rate / Altitude / Cadence charts
- ✅ Average line on charts → ReferenceLine component
- ✅ Editable lap table → custom table with inline editing
- ✅ Intensity filter pills → toggle group component
- ✅ Interval summary → computed from auto-laps
- ✅ Activity details tab (stats grid)
- ✅ Running dynamics
- ✅ Best lap display
- ✅ Auto laps (1mi running, 5mi cycling)
- ✅ Swimming lengths (editable)
- ✅ Combine consecutive lengths
- ✅ Editable title/description/category
- ✅ Workout feel (SVG radio)
- ✅ Effort slider (1-10)
- ✅ Sidebar distance/duration adjustment
- ✅ Save button → PATCH mutations
- ✅ Previous/next activity navigation
- ✅ Similar activities section
- ✅ Multisport tabs per session
- ✅ Pause-removed elapsed time → server computation

### Report Page (10 features)
- ✅ Aggregated by daily/weekly/monthly/yearly → client-side grouping
- ✅ Sport multi-select filter
- ✅ Chart metric selector (distance/time/activities/calories)
- ✅ Summary metrics row
- ✅ Stacked bar chart → Recharts/Plotly
- ✅ Tabular breakdown
- ✅ Week aggregation Sun-Sat

### Search Page (11 features)
- ✅ Filter by sport/sub-sport/category/date/distance/duration
- ✅ Paginated results
- ✅ Activity cards with metrics
- ✅ Filters move to sidebar after search
- ✅ Sort options
- ✅ "Refresh Data" button

---

## 10. Risk Assessment

### High Complexity Hotspots

| Area | Risk | Mitigation |
|------|------|------------|
| Auto-laps with interpolation (~150 lines NumPy) | High | Port carefully with unit tests; use simple-statistics or typed arrays |
| Elevation service (replacing pyhigh) | High | Use Open-Elevation API or self-host; batch requests; fallback to raw altitude |
| ColorLine (speed-colored polyline) | Medium | Custom Leaflet layer splitting route into colored segments (~80 lines) |
| Editable lap table with dirty tracking | Medium | TanStack Table + custom cell renderers; track per-cell changes |
| Interval summary clustering | Medium | Straightforward TS port; unit test with known inputs |
| Similar activities (pg_trgm) | Low | SQL stays the same; ensure extension is enabled |

### Potential Blockers

| Blocker | Resolution |
|---------|------------|
| `leaflet-beautify-marker-icon` not ESM | Fork/reimplement with custom DivIcon CSS circles |
| Open-Elevation API rate limits | Self-host Docker container; fallback to Garmin altitude |
| FullCalendar bundle size (~45KB gz) | Lazy-load with React.lazy on calendar route |
| `pg_trgm` extension unavailable | Install extension or replace with LIKE-based query |

### Improvements Over Streamlit (Free Wins)

1. **URL-based state** — shareable links to specific activities
2. **No full-page reruns** — React only re-renders what changed
3. **Concurrent data loading** — fetch points, laps, sessions in parallel
4. **Offline caching** — TanStack Query persists for instant stale data
5. **Better mobile experience** — responsive Tailwind layout
6. **Faster navigation** — SPA routing, no server round-trip
