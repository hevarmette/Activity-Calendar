import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router";
import { PageLayout } from "./components/layout/PageLayout.js";
import { ErrorBoundary } from "./components/ui/ErrorBoundary.js";

const CalendarPage = lazy(() => import("./pages/CalendarPage.js"));
const ActivityDetailsPage = lazy(() => import("./pages/ActivityDetailsPage.js"));
const ActivityReportPage = lazy(() => import("./pages/ActivityReportPage.js"));
const ActivitySearchPage = lazy(() => import("./pages/ActivitySearchPage.js"));
const WorkoutBuilderPage = lazy(() => import("./pages/WorkoutBuilderPage.js"));
const WorkoutsListPage = lazy(() => import("./pages/WorkoutsListPage.js"));

function Loading() {
	return <div className="flex items-center justify-center py-20 text-gray-400">Loading…</div>;
}

export function App() {
	return (
		<ErrorBoundary>
			<Routes>
				<Route element={<PageLayout />}>
					<Route
						path="/"
						element={
							<Suspense fallback={<Loading />}>
								<CalendarPage />
							</Suspense>
						}
					/>
					<Route
						path="/activity/:activityId"
						element={
							<Suspense fallback={<Loading />}>
								<ActivityDetailsPage />
							</Suspense>
						}
					/>
					<Route
						path="/report"
						element={
							<Suspense fallback={<Loading />}>
								<ActivityReportPage />
							</Suspense>
						}
					/>
					<Route
						path="/search"
						element={
							<Suspense fallback={<Loading />}>
								<ActivitySearchPage />
							</Suspense>
						}
					/>
					<Route
						path="/workouts/builder"
						element={
							<Suspense fallback={<Loading />}>
								<WorkoutBuilderPage />
							</Suspense>
						}
					/>
					<Route
						path="/workouts"
						element={
							<Suspense fallback={<Loading />}>
								<WorkoutsListPage />
							</Suspense>
						}
					/>
				</Route>
			</Routes>
		</ErrorBoundary>
	);
}
