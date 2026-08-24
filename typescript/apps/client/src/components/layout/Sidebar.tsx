import { NavLink } from "react-router";

const links = [
	{ to: "/", label: "Calendar", icon: <svg width="20" height="20" className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg> },
	{ to: "/report", label: "Report", icon: <svg width="20" height="20" className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/></svg> },
	{ to: "/search", label: "Search", icon: <svg width="20" height="20" className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg> },
] as const;

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
	return (
		<>
			{open && (
				<div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />
			)}
			<aside className={`fixed inset-y-0 left-0 z-50 w-60 bg-gray-900 border-r border-gray-800 flex flex-col transition-transform duration-200 ease-out lg:static lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
				<div className="flex items-center gap-3 px-5 py-5 border-b border-gray-800">
					<div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center text-white text-sm font-bold">AC</div>
					<span className="text-base font-bold text-gray-50">Activity Cal</span>
				</div>
				<nav className="flex-1 px-3 py-4 space-y-1">
					{links.map(({ to, label, icon }) => (
						<NavLink
							key={to}
							to={to}
							onClick={onClose}
							className={({ isActive }) =>
								isActive
									? "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-50 bg-orange-600/10"
									: "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
							}
						>
							{icon}
							{label}
						</NavLink>
					))}
				</nav>
			</aside>
		</>
	);
}
