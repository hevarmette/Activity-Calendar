import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { calendarRoutes } from "./routes/calendar.js";
import { activitiesRoutes } from "./routes/activities.js";
import { lapsRoutes } from "./routes/laps.js";
import { recordsRoutes } from "./routes/records.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { lengthsRoutes } from "./routes/lengths.js";
import { eventsRoutes } from "./routes/events.js";
import { reportRoutes } from "./routes/report.js";
import { searchRoutes } from "./routes/search.js";
import { similarRoutes } from "./routes/similar.js";
import { autoLapsRoutes } from "./routes/auto-laps.js";

const app = new Hono();

app.use("*", cors({
	origin: process.env.NODE_ENV === "production"
		? "*"
		: (process.env.CLIENT_ORIGIN || "http://localhost:5173"),
}));

app.route("/api/calendar", calendarRoutes);
app.route("/api/activities", activitiesRoutes);
app.route("/api/laps", lapsRoutes);
app.route("/api/records", recordsRoutes);
app.route("/api/sessions", sessionsRoutes);
app.route("/api/lengths", lengthsRoutes);
app.route("/api/events", eventsRoutes);
app.route("/api/report", reportRoutes);
app.route("/api/search", searchRoutes);
app.route("/api/similar", similarRoutes);
app.route("/api/activities", autoLapsRoutes);

app.get("/health", (c) => c.json({ status: "ok" }));

// Serve static client build in production
if (process.env.NODE_ENV === "production") {
	app.use("/*", serveStatic({ root: "../client/dist" }));
	app.get("*", serveStatic({ path: "../client/dist/index.html" }));
}

const port = Number(process.env.PORT) || 3000;
console.log(`Server listening on port ${port}`);

export default { port, fetch: app.fetch };
