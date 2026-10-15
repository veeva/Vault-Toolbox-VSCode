// Side-effect import: registers Monaco's built-in JSON language — its tokenizer (identical to VS
// Code's highlighting), folding, and bracket matching — plus the worker manager backing them. We use
// the native language rather than a hand-written Monarch grammar so the result is exactly VS Code's,
// with no edge cases to get wrong. Its `json.worker` is bundled by esbuild and routed in
// `monacoEnvironment.getWorker`. Validation stays on but never surfaces markers: every value we show
// comes from `JSON.stringify`, so it is always well-formed.
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js';

export const JSON_LANGUAGE_ID = 'json';
