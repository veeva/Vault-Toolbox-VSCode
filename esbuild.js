// esbuild config for four bundles: the extension host (Node/CJS), the webview React app
// (browser/IIFE), Monaco's base editor worker, and Monaco's JSON language worker (both browser/IIFE).
// Single toolchain per plan G2 — no webpack, so `monacoEnvironment.getWorker` routes each worker by
// language label instead of relying on the monaco-editor-webpack-plugin.
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

// Monaco ships its icon font as a .ttf and its styles as .css; inline both into the bundle
// (dataurl fonts, a sibling main.css) so no extra asset-path/CSP wiring is needed in the webview.
const webviewLoader = { '.css': 'css', '.ttf': 'dataurl' };

/** @type {import('esbuild').BuildOptions} */
const hostOptions = {
	entryPoints: ['src/extension/extension.ts'],
	bundle: true,
	outfile: 'dist/extension.js',
	platform: 'node',
	format: 'cjs',
	target: 'node20',
	// vscode is provided by the Extension Host at runtime, never bundled.
	external: ['vscode'],
	sourcemap: !production,
	minify: production,
	logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
	entryPoints: ['src/webview/index.tsx'],
	bundle: true,
	outfile: 'dist/webview/main.js',
	platform: 'browser',
	format: 'iife',
	target: 'es2020',
	jsx: 'automatic',
	loader: webviewLoader,
	sourcemap: !production,
	minify: production,
	logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const workerOptions = {
	entryPoints: ['src/webview/editor.worker.ts'],
	bundle: true,
	outfile: 'dist/webview/editor.worker.js',
	platform: 'browser',
	format: 'iife',
	target: 'es2020',
	loader: webviewLoader,
	sourcemap: !production,
	minify: production,
	logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const jsonWorkerOptions = {
	entryPoints: ['monaco-editor/esm/vs/language/json/json.worker.js'],
	bundle: true,
	outfile: 'dist/webview/json.worker.js',
	platform: 'browser',
	format: 'iife',
	target: 'es2020',
	loader: webviewLoader,
	sourcemap: !production,
	minify: production,
	logLevel: 'info',
};

async function main() {
	if (watch) {
		const contexts = await Promise.all([
			esbuild.context(hostOptions),
			esbuild.context(webviewOptions),
			esbuild.context(workerOptions),
			esbuild.context(jsonWorkerOptions),
		]);
		await Promise.all(contexts.map((c) => c.watch()));
		console.log('esbuild: watching host + webview + workers…');
	} else {
		await Promise.all([
			esbuild.build(hostOptions),
			esbuild.build(webviewOptions),
			esbuild.build(workerOptions),
			esbuild.build(jsonWorkerOptions),
		]);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
