import { NavLink } from "react-router";

const links = [
	{ to: "/", label: "Calendar" },
	{ to: "/report", label: "Report" },
	{ to: "/search", label: "Search" },
] as const;

export function Sidebar() {
	return (
		<aside className="w-56 shrink-0 border-r border-gray-700 bg-gray-950 p-4 flex flex-col gap-2">
			<h1 className="text-lg font-bold mb-4">Activity Calendar</h1>
			<nav className="flex flex-col gap-1">
				{links.map(({ to, label }) => (
					<NavLink
						key={to}
						to={to}
						className={({ isActive }) =>
							`rounded px-3 py-2 text-sm transition-colors ${isActive ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"}`
						}
					>
						{label}
					</NavLink>
				))}
			</nav>
		</aside>
	);
}
