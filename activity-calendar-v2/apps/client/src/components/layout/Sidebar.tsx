import { NavLink } from "react-router";

const links = [
	{ to: "/", label: "Calendar" },
	{ to: "/report", label: "Report" },
	{ to: "/search", label: "Search" },
] as const;

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
	return (
		<>
			{/* Overlay for mobile */}
			{open && (
				<div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />
			)}
			<aside className={`fixed inset-y-0 left-0 z-50 w-56 border-r border-gray-700 bg-gray-950 p-4 flex flex-col gap-2 transition-transform lg:static lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
				<h1 className="text-lg font-bold mb-4">Activity Calendar</h1>
				<nav className="flex flex-col gap-1">
					{links.map(({ to, label }) => (
						<NavLink
							key={to}
							to={to}
							onClick={onClose}
							className={({ isActive }) =>
								`rounded px-3 py-2 text-sm transition-colors ${isActive ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"}`
							}
						>
							{label}
						</NavLink>
					))}
				</nav>
			</aside>
		</>
	);
}
