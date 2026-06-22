import { useState } from "react";
import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar.js";

export function PageLayout() {
	const [sidebarOpen, setSidebarOpen] = useState(false);

	return (
		<div className="flex min-h-screen bg-gray-900 text-gray-100">
			<Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
			<div className="flex-1 flex flex-col overflow-auto">
				<button
					onClick={() => setSidebarOpen(true)}
					className="lg:hidden fixed top-3 left-3 z-30 rounded bg-gray-800 p-2"
					aria-label="Open menu"
				>
					<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
					</svg>
				</button>
				<main className="flex-1 p-6 pt-14 lg:pt-6">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
