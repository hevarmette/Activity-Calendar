# Remaining Implementation Items

## Server (3)

- [x] **Auto-laps computation endpoint** — Port `create_auto_laps`, `build_running_auto_laps`, `build_cycling_auto_laps` with interpolation logic (~150 lines of NumPy). The `/api/activities/:id/auto-laps` route exists but needs the computation.
- [x] **Elevation correction in records route** — Currently returns raw altitude. Need to batch-call an elevation API (Open-Elevation or Open-Meteo) and return `corrected_altitude` in the response.
- [x] **Pause-removed elapsed time in records route** — Fetch timer events, compute cumulative paused duration, subtract from `elapsed_time`. Same logic as `fetch_activity_points` in `db.py`.

## Client Features (8)

- [x] **Swimming lengths table** — `SwimLengthTable` component with editable strokes/stroke type, multi-select + combine button calling `POST /api/lengths/combine`.
- [x] **Auto-laps tab display** — `AutoLapTable` component fetching from `/api/activities/:id/auto-laps` and displaying computed splits with interpolated elevation, HR, cadence.
- [x] **Running dynamics in Details tab** — Component computing weighted averages of `avgVerticalOscillation`, `avgStanceTime`, `avgStepLength`, `avgVerticalRatio` from lap data.
- [x] **Workout feel SVG icons** — Copy `assets/*.svg` to `public/assets/` and render as `<img>` in the feel radio buttons instead of text labels.
- [x] **SpeedColorLine layer toggle fix** — Wrap the Polyline segments in a `FeatureGroup` so `LayersControl.Overlay` toggle works correctly.
- [x] **Keyboard shortcut 'S' to save** — `useEffect` with keydown listener for 's' key to trigger `handleSave` on Activity Details page.
- [x] **Best lap display** — Compute fastest pace (running) or highest speed (cycling) from laps and display in the Details tab.
- [x] **Multisport per-session tabs** — Render `Tabs` with one tab per session leg, each with scoped points/laps/map/charts.

## Client Polish (3)

- [x] **Report week aggregation** — Fix `periodKey` for Weekly to match Python's `W-SAT` (Sun-Sat weeks) using proper `startOfWeek` Sunday logic.
- [x] **Search sort options** — Add sort controls (distance, duration, ascending/descending) and apply client-side sorting.
- [x] **Responsive sidebar collapse** — Add toggle button, hide sidebar on small screens.

## Infrastructure & Testing (2)

- [x] **docker-compose.yml** — Add PostgreSQL service for local development (`docker compose up` spins up full stack).
- [x] **E2E tests with Playwright** — Config + test files covering: calendar navigation, activity detail view + save, search + filter, report grouping.

  ## Completed During Review/Refinement (2026-06-24)

  ### Critical Fix
  - [x] **Tailwind CSS not generating utilities** — `@tailwindcss/vite` plugin was never installed. Added `@tailwindcss/vite@4.1.8` to
        devDependencies and configured in `vite.config.ts`. All utility classes now generate correctly.

  ### Activity Details Page Restructure
  - [x] **Title row layout** — Combined title input + category dropdown + prev/next nav into one row: title (flex-1, left), category +
        nav (right, justify-between).
  - [x] **Title as heading** — Enlarged to `text-4xl font-bold` for visual prominence.
  - [x] **Summary metrics as horizontal cards** — Changed from `flex` to `grid grid-cols-3` for equal-width metric blocks.
  - [x] **Map + Description side-by-side** — Grid `[7fr_3fr]` at `md` breakpoint. Added `min-h-[500px]` to map container.
  - [x] **Feel/Effort proportions** — Changed grid to `[3fr_7fr]` matching Streamlit's `[0.3, 0.7]`.
  - [x] **Vertical spacing** — `space-y-8` with `w-full` on outer container.

  ### Feel & Effort UX
  - [x] **Immediate UI feedback** — Local `useState` for instant visual updates on feel/effort changes.
  - [x] **SVG sizing fix** — Removed inline `style="width:100%; height:100%"` from all SVGs. Increased img to `w-8 h-8`.

  ### Interval Summary (Feature Parity)
  - [x] **Full clustering algorithm** — Ported `compute_interval_summary` with scaling tolerance clustering.
  - [x] **Category gate** — Only shows when category is "training" AND ≥2 active laps.
  - [x] **Group by toggle** — Auto-selects Distance vs Time by coefficient of variation.
  - [x] **TRACK_DISTANCES constant** — Added to `packages/shared/src/constants.ts`.
  - [x] **Per-set display** — "N×label" with avg time, avg pace/speed, fastest split, avg HR.

  ### Multi-select Intensity Pills
  - [x] **Multi-select filter** — Intensity pills now support toggling multiple selections.

  ### Calendar Navigation Persistence
  - [x] **SessionStorage fallback** — CalendarPage reads `cal_year`/`cal_month` from sessionStorage.

  ***

  ## Known Issues / Future Work
  - [x] **Hardcoded timezone** — `'America/Chicago'` in server SQL. Needs env var.
  - [x] **Elevation API caching** — Cache on Open-Meteo calls per request. Maybe find a better solution because it seems i am getting rate limited or hitting the request limit
  - [x] **useEffect missing deps** — Keyboard shortcut re-registers every render.
  - [x] **defaultValue won't reset on nav** — Needs `key={id}` on page wrapper.
  - [x] **No save error feedback** — Silent failure, edits cleared.
  - [x] **Accessibility gaps** — Missing aria-labels and tab roles.
  - [x] **Sidebar distance/duration adjustment** — Not yet ported from Streamlit.
  - [x] **Perceived effort default value** should not show in the slider if it is null
  - [x] **Get all old comments and notes from streamlit code into here**
  - [x] **Have the graphs/plots match the colors from streamlit** - blue for pace, green for elevation, red for HR, etc.
  - [x] **Feel buttons be equally spaced**
  - [x] **back and next buttons do not work** - they are always disabled for some reason
  - [x] **make the maps load faster** - somehow
  - [x] **the category is not properly being fetched or displayed from the database**
  - [x] **show cumulative distance for auto laps in streamlit app and this one**
  - [x] **being able to select x axis range on graphs and it can filter for all other graphs and the map**
  - [x] **auto laps should have precision to the hundreths place** not just the tenths place. on activity details page
  - [x] **show elapsed time for the acitivty details page**
  - [x] **re render the auto lap markers on the map when the auto lap distance changes**
  - [] show swim activity dialog in meters and pace is time/100m
  - [] the search page is not working at all, null pointer error
  - [] the report page sport selection widget is a bad widget
