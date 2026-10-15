/// <reference types="vite/client" />

// Vite's `?worker` import suffix (used in browserSetup.ts to hand Monaco a real bundled worker)
// resolves to a default-exported Worker constructor. `vite/client` declares this, but the webview
// tsconfig doesn't pull Vite's ambient types globally, so re-declare the one form we use.
declare module '*?worker' {
	const WorkerFactory: {
		new (): Worker;
	};
	export default WorkerFactory;
}
