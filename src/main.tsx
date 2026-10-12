import React from "react";
import { createRoot } from "react-dom/client";
async function start() {
	const classic = new URLSearchParams(location.search).has("classic");
	if (classic) {
		await import("./globals.css");
		const { default: App } = await import("./App");
		createRoot(document.getElementById("root")!).render(<App />);
		return;
	}
	if (!window.memories && import.meta.env.DEV) {
		const { preparePreview } = await import("./simple/preview");
		preparePreview();
	}
	await import("./simple/simple.css");
	const { default: SimpleApp } = await import("./simple/SimpleApp");
	createRoot(document.getElementById("root")!).render(
		<React.StrictMode><SimpleApp /></React.StrictMode>,
	);
}
void start();
