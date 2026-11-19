import { Component, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
	state = { hasError: false };
	static getDerivedStateFromError() {
		return { hasError: true };
	}
	render() {
		if (!this.state.hasError) return this.props.children;
		return (
			<main className="reader-main">
				<p className="footnotes-subtitle">Something went wrong rendering this page.</p>
				<button
					type="button"
					className="quick-inline-chip active"
					onClick={() => window.location.reload()}
				>
					Reload
				</button>
			</main>
		);
	}
}

const rootElement = document.getElementById("root");
if (rootElement) {
	createRoot(rootElement).render(
		<StrictMode>
			<ErrorBoundary>
				<App />
			</ErrorBoundary>
		</StrictMode>,
	);
}
