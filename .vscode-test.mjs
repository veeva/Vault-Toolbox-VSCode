import { defineConfig } from '@vscode/test-cli';

/**
 * Extension-host integration tier. Launches a real VS Code (headed on macOS — no xvfb needed) with
 * this extension loaded from `dist/`, and runs the compiled Mocha suites in `dist/test-integration/`.
 *
 * Run with `npm run test:integration`, which first builds `dist/` (the launched host loads
 * `dist/extension.js`) and compiles the tests to `dist/`.
 *
 * CAVEAT: close all other VS Code windows first — the Electron test runner cannot attach while
 * another VS Code instance is open.
 */
export default defineConfig({
	files: 'dist/test-integration/**/*.test.js',
	// A stable recent VS Code; matches the `engines.vscode` floor in package.json.
	version: 'stable',
	extensionDevelopmentPath: '.',
	// Open a stable fixtures workspace so activation runs against a known folder (also hosts the
	// `.mdl` fixture the deploy journey uses). It lives in `src` (committed), not the generated `dist`.
	workspaceFolder: './src/test-integration/fixtures',
	mocha: {
		// TDD interface (`suite`/`test`) — matches every file under `test-integration/` and the
		// `@vscode/test-cli` runner's own default. Must not be `bdd`, or `suite` is undefined at load.
		ui: 'tdd',
		timeout: 60000,
		color: true,
	},
});
