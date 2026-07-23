import { Component, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false, error: null };

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	render() {
		if (this.state.hasError) {
			return (
				this.props.fallback ?? (
					<div className="rounded-lg border border-red-800 bg-red-950/50 p-6 text-center">
						<h2 className="text-lg font-semibold text-red-300 mb-2">Something went wrong</h2>
						<p className="text-sm text-red-400">{this.state.error?.message}</p>
						<button
							onClick={() => this.setState({ hasError: false, error: null })}
							className="mt-4 rounded bg-red-700 px-4 py-1 text-sm hover:bg-red-600"
						>
							Try again
						</button>
					</div>
				)
			);
		}
		return this.props.children;
	}
}
