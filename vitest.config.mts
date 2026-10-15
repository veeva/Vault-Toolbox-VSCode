import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: 'node',
					environment: 'node',
					// `src` holds the core/host suites and the webview (under `src/webview`); the
					// webview's framework-free units (e.g. the MetadataStore) are node-safe, so the single
					// `src` glob collects them too. jsdom component tests use the `.browser.test.tsx`
					// suffix and are excluded here.
					include: ['src/**/*.test.ts'],
					// The extension-host integration tests (`vscode` + Mocha) and the ExTester E2E suites
					// (`vscode-extension-tester` + Mocha) run in a launched VS Code, never Vitest — keep
					// both out of the node project.
					exclude: ['src/test-integration/**', 'src/test-e2e/**'],
				},
			},
			{
				test: {
					name: 'web',
					environment: 'jsdom',
					include: ['src/webview/**/*.browser.test.tsx'],
					setupFiles: ['src/webview/test/setup.ts'],
				},
			},
			{
				// Opt-in, real-browser tier for the handful of things jsdom can't fake: Monaco (needs
				// canvas/DOMMatrix), true portal stacking, real keyboard/focus. Kept out of `npm test`
				// and `test:web`; run explicitly via `npm run test:browser` (needs a one-time
				// `npx playwright install chromium`). Uses a distinct `.chromium.test.tsx` suffix so the
				// jsdom `web` project never collects these.
				test: {
					name: 'browser',
					include: ['src/webview/**/*.chromium.test.tsx'],
					setupFiles: ['src/webview/test/browserSetup.ts'],
					browser: {
						enabled: true,
						provider: playwright(),
						headless: true,
						instances: [{ browser: 'chromium' }],
					},
				},
			},
		],
	},
});
