import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar.js";

export function PageLayout() {
	return (
		<div className="flex min-h-screen bg-gray-900 text-gray-100">
			<Sidebar />
			<main className="flex-1 overflow-auto p-6">
				<Outlet />
			</main>
		</div>
	);
}
