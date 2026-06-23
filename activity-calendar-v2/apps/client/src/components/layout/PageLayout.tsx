import { NavLink, Outlet, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../api/queries.js";

const links = [
	{ to: "/", label: "Activity Cal", icon: <svg width="20" height="20" className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg> },
	{ to: "/report", label: "Report", icon: <svg width="20" height="20" className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/></svg> },
	{ to: "/search", label: "Search", icon: <svg width="20" height="20" className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg> },
] as const;

export function PageLayout() {
	const [searchParams, setSearchParams] = useSearchParams();
	const queryClient = useQueryClient();
	const now = new Date();
	const year = Number(searchParams.get("year")) || Number(sessionStorage.getItem("cal_year")) || now.getFullYear();
	const month = Number(searchParams.get("month")) || Number(sessionStorage.getItem("cal_month")) || now.getMonth() + 1;

	function handleYearChange(e: React.ChangeEvent<HTMLInputElement>) {
		sessionStorage.setItem("cal_year", e.target.value);
		sessionStorage.setItem("cal_month", String(month));
		setSearchParams({ year: e.target.value, month: String(month) });
	}

	function handleMonthChange(e: React.ChangeEvent<HTMLSelectElement>) {
		sessionStorage.setItem("cal_year", String(year));
		sessionStorage.setItem("cal_month", e.target.value);
		setSearchParams({ year: String(year), month: e.target.value });
	}

	return (
		<div className="min-h-screen bg-gray-950 text-gray-100">
			<header style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }} className="w-full px-6 py-3 bg-gray-900 border-b border-gray-800">
				<div className="flex flex-row items-center gap-3">
					<input
						type="number"
						value={year}
						onChange={handleYearChange}
						className="w-20 rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
						aria-label="Year"
					/>
					<select
						value={month}
						onChange={handleMonthChange}
						className="rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
						aria-label="Month"
					>
						{Array.from({ length: 12 }, (_, i) => (
							<option key={i + 1} value={i + 1}>
								{new Date(2000, i).toLocaleString("default", { month: "long" })}
							</option>
						))}
					</select>
					<button
						onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.calendar })}
						className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-gray-700 transition-colors"
					>
						Refresh
					</button>
				</div>
				<nav style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "8px" }}>
					{links.map(({ to, label, icon }) => (
						<NavLink
							key={to}
							to={to}
							style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "6px" }}
							className={({ isActive }) =>
								isActive
									? "px-3 py-1.5 rounded-lg text-sm font-medium text-gray-50 bg-orange-500/10"
									: "px-3 py-1.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
							}
						>
							{icon}
							{label}
						</NavLink>
					))}
				</nav>
			</header>
			<main className="p-6 lg:p-8">
				<Outlet />
			</main>
		</div>
	);
}
