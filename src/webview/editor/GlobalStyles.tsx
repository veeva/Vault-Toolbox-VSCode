/**
 * All editor CSS in one injected `<style>` block. The panel CSP allows `style-src 'unsafe-inline'`
 * (see `vqlEditorPanel`), so this covers what inline styles can't: the spinner keyframes, sticky
 * table header, hover states, and scroll container. Everything is driven by VSCode theme CSS vars so
 * the editor tracks the active theme.
 */
const CSS = `
:root { color-scheme: light dark; }
body { margin: 0; overflow-x: hidden; }

.vt-shell { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

.vt-tabbar {
  display: flex;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: transparent;
}
.vt-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 40px;
  height: 36px;
  padding: 0;
  border: none;
  border-bottom: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  opacity: 0.7;
  color: var(--vscode-icon-foreground, var(--vscode-foreground));
}
.vt-tab:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, transparent); }
.vt-tab.active {
  opacity: 1;
  color: var(--vscode-foreground);
  border-bottom-color: var(--vscode-panelTitle-activeBorder, var(--vscode-focusBorder));
}
.vt-tab:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
/* Left-align the tab tooltip to the icon's left edge instead of centering it. The 18px icon is
   centered in the 40px tab, so its left edge sits at (40 - 18) / 2 = 11px. The arrow (::before)
   stays centered over the icon. */
.vt-tab[data-tooltip]::after {
  left: 11px;
  transform: none;
}
.vt-tab--settings { margin-left: auto; }
/* The settings button is at the far right — right-align its tooltip so it doesn't clip. */
.vt-tab--settings[data-tooltip]::after { left: auto; right: 0; transform: none; }

/* min-width:0 + overflow lets these flex items shrink to their parent instead of growing to fit
   content — without it Monaco's automaticLayout ratchets the editor ever wider each layout poll. */
.vt-tabpanel { flex: 1 1 auto; min-height: 0; min-width: 0; display: flex; overflow: hidden; }
.vt-tabpanel[hidden] { display: none; }
.vt-fill { flex: 1 1 auto; min-height: 0; min-width: 0; display: flex; }
.vt-fill[hidden] { display: none; }

.vt-placeholder {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
  color: var(--vscode-descriptionForeground);
}

.vt-editor {
  box-sizing: border-box;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  /* Scroll the whole editor when its stacked regions (Monaco + an expanded Query Builder + results)
     don't fit the viewport — otherwise the fixed-size builder overflows and is clipped, unreachable.
     When there IS room, no overflow occurs and the results grid fills + scrolls internally instead. */
  min-height: 0;
  min-width: 0;
  /* Vertical scroll only. overflow-y:auto would otherwise force overflow-x to compute to auto (per
     spec, a non-visible value on one axis promotes visible on the other to auto), giving a stray
     horizontal scrollbar on any minor child overflow. Monaco, the grid, and the JSON view each scroll
     horizontally on their own, so the outer editor never needs to. */
  overflow-x: hidden;
  overflow-y: auto;
  padding: 12px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
}

.vt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  flex: 0 0 auto;
  min-height: 28px;
  width: 100%;
}
.vt-header-left,
.vt-header-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.vt-header .title {
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  flex-shrink: 0;
}
.vt-header-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 4px;
  box-sizing: border-box;
  border: none;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}
.vt-header-action-btn:hover:not([aria-disabled="true"]) {
  background: var(--vscode-list-hoverBackground);
  color: var(--vscode-foreground);
}
.vt-header-action-btn:disabled, .vt-header-action-btn[aria-disabled="true"] { cursor: default; }
.vt-header-action-btn:disabled > *, .vt-header-action-btn[aria-disabled="true"] > * { opacity: 0.4; }
.vt-header-action-btn.download { --_bg: #2F855A; --_bg-hover: #276749; color: #ffffff; background: var(--_bg); }
.vscode-dark .vt-header-action-btn.download { --_bg: #276749; --_bg-hover: #22543D; }
.vt-header-action-btn.download:hover:not(:disabled) { background: var(--_bg-hover); color: #ffffff; }
.vt-header-action-btn.download:disabled { background: color-mix(in srgb, var(--_bg) 40%, transparent); }
.vt-header-action-btn:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
/* This button sits at the header's right edge — right-align its tooltip so it doesn't clip past
   the panel in narrow (sidebar) widths. */
.vt-header-action-btn[data-tooltip]::after { left: auto; right: 0; transform: none; }
.vt-header-right [data-tooltip]::after { left: auto; right: 0; transform: none; }
.vt-badge {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
  background: var(--vscode-inputValidation-warningBackground, rgba(255, 170, 0, 0.25));
  border: 1px solid var(--vscode-inputValidation-warningBorder, transparent);
  flex-shrink: 0;
  white-space: nowrap;
}

.vt-monaco-wrapper {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 4px;
  overflow: hidden;
}

.vt-monaco {
  /* Height is set inline by MonacoEditor, growing with the query's line count (see editorHeightForValue). */
  width: 100%;
}

.vt-monaco-resize-handle {
  height: 18px;
  flex-shrink: 0;
  cursor: ns-resize;
  background: transparent;
  border-top: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vscode-descriptionForeground);
  opacity: 0.45;
  transition: background 0.1s ease, opacity 0.1s ease;
}

.vt-monaco-resize-handle:hover {
  background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.05));
  opacity: 0.8;
}

/* ── Query Builder ───────────────────────────────────────────────────────── */
.vt-builder {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vscode-panel-border, var(--vscode-input-border));
  border-radius: 4px;
}
.vt-builder-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: transparent;
  color: var(--vscode-foreground);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  border-radius: 4px;
}
.vt-builder-toggle:hover { background: var(--vscode-list-hoverBackground); }
.vt-builder-toggle:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
.vt-builder-caret {
  display: flex;
  align-items: center;
  transition: transform 0.12s ease;
  color: var(--vscode-descriptionForeground);
}
.vt-builder-caret.open { transform: rotate(90deg); }
.vt-builder-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 8px;
  min-width: 0;
  border-top: 1px solid var(--vscode-panel-border, var(--vscode-input-border));
}
.vt-builder-clause { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.vt-builder-clause-label { font-size: 12px; font-weight: 600; }
.vt-builder-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
.vt-builder-control-error {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--vscode-errorForeground);
  font-size: 12px;
}

/* The Query Builder comboboxes (FROM / SELECT / WHERE field, operator, value) are react-select,
   themed in webview/editor/builder/VtSelect.tsx via the --vscode-* palette rather than here. */

.vt-chip-tray {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}
.vt-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 1px 2px 1px 8px;
  font-size: 12px;
  color: var(--vscode-badge-foreground);
  background: var(--vscode-badge-background);
  border-radius: 10px;
}
.vt-chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vt-subquery-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}
.vt-subquery-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border, transparent));
  border-radius: 4px;
}
.vt-subquery-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-descriptionForeground);
}
.vt-subquery-block .vt-chip-tray { margin: 0; }
.vt-chip-remove, .vt-subquery-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.vt-chip-remove:hover, .vt-subquery-clear:hover {
  background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.15));
}
.vt-builder-pagesize {
  box-sizing: border-box;
  width: 100%;
  min-height: 26px;
  padding: 3px 6px;
  font: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
  -moz-appearance: textfield;
}
.vt-builder-pagesize::-webkit-outer-spin-button,
.vt-builder-pagesize::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.vt-builder-pagesize:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
.vt-builder-build { display: flex; min-width: 0; }
.vt-builder-build .vt-btn { flex: 1; min-width: 0; white-space: normal; }

.vt-builder-clause-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.vt-builder-clause-head .vt-btn { padding: 2px 8px; font-size: 11px; }
.vt-filter-row-wrap {
  display: flex;
  align-items: stretch;
  min-width: 0;
}
.vt-filter-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  flex: 1 1 auto;
  min-width: 0;
  border: 1px solid var(--vscode-panel-border, var(--vscode-input-border));
  border-radius: 4px 0 0 4px;
}
.vt-filter-row-controls { display: flex; align-items: flex-start; gap: 4px; min-width: 0; }
.vt-filter-field { flex: 1 1 auto; min-width: 0; }
.vt-filter-op { flex: 0 1 108px; min-width: 0; }
.vt-builder-value:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
.vt-filter-row-remove {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  padding: 0;
  border: 1px solid var(--vscode-panel-border, var(--vscode-input-border));
  border-left: none;
  border-radius: 0 4px 4px 0;
  background: transparent;
  color: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.vt-filter-row-remove:hover {
  background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.15));
}
.vt-builder-value {
  box-sizing: border-box;
  width: 100%;
  padding: 3px 6px;
  font: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
}
.vt-filter-actions { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
/* Let the action buttons shrink/wrap in a narrow panel instead of overflowing the clause
   (they inherit .vt-btn's white-space:nowrap + flex-shrink:0). */
.vt-filter-actions .vt-btn { flex-shrink: 1; min-width: 0; white-space: normal; }
.vt-filter-add { padding: 3px 10px; font-size: 12px; }
.vt-filter-prev { padding: 3px 10px; font-size: 12px; }

.vt-toolbar {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  margin-top: 6px;
}
.vt-toolbar-left,
.vt-toolbar-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.vt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 4px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-size: inherit;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  white-space: nowrap;
  flex-shrink: 0;
}
.vt-btn:hover:not(:disabled):not(.disabled) { background: var(--vscode-button-hoverBackground); }
.vt-btn:disabled { opacity: 0.5; cursor: default; }
/* Class-based disabled state for buttons that gate via aria-disabled (kept hoverable so their
   tooltip still fires). Dim the content, not the button — a button-level opacity would cap the
   tooltip pseudo-element's opacity too, rendering the bubble see-through. */
.vt-btn.disabled { cursor: default; }
.vt-btn.disabled > * { opacity: 0.5; }
.vt-btn.secondary {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
}
.vt-btn.secondary:hover:not(:disabled):not(.disabled) { background: var(--vscode-button-secondaryHoverBackground); }
.vt-btn.icon-only {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  vertical-align: middle;
}

/* Instant Custom Tooltips (VS Code theme-consistent) */
[data-tooltip] {
  position: relative;
}
[data-tooltip]::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--vscode-editorHoverWidget-background, #252526);
  color: var(--vscode-editorHoverWidget-foreground, #cccccc);
  border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
  padding: 3px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-family: var(--vscode-font-family), sans-serif;
  font-weight: normal;
  text-transform: none;
  white-space: nowrap;
  z-index: 100;
  pointer-events: none;
  opacity: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: opacity 0.05s ease;
}
[data-tooltip]::before {
  content: "";
  position: absolute;
  bottom: calc(100% + 1px);
  left: 50%;
  transform: translateX(-50%);
  border-width: 5px;
  border-style: solid;
  border-color: var(--vscode-editorHoverWidget-border, #454545) transparent transparent transparent;
  z-index: 100;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.05s ease;
}
[data-tooltip]:hover::after,
[data-tooltip]:hover::before,
[data-tooltip]:focus-visible::after,
[data-tooltip]:focus-visible::before {
  opacity: 1;
}

/* Wrapping tooltip — for longer help text (e.g. field descriptions) that would overflow the
   narrow panel as a single nowrap line. */
[data-tooltip-wrap]::after {
  white-space: normal;
  width: max-content;
  /* Cap at 220px, but never wider than the viewport (minus a small margin) so the bubble stays
     fully readable in a narrow panel instead of clipping past the right edge. */
  max-width: min(220px, calc(100vw - 16px));
  text-align: left;
  line-height: 1.4;
}

/* Left-anchored tooltip — for buttons at the left edge, whose centered tooltip would
   otherwise overflow off the left side of the webview. Anchors both the bubble and its
   arrow to the button's left edge instead of its center. */
[data-tooltip-align="left"]::after {
  left: 0;
  transform: none;
}
/* Arrow offset to sit roughly under the center of a compact icon button, rather than the
   button's far-left corner where a left:0 bubble would otherwise point. */
[data-tooltip-align="left"]::before {
  left: 10px;
  transform: none;
}

/* Tooltip positioned below the element */
[data-tooltip-dir="below"]::after {
  bottom: auto;
  top: calc(100% + 6px);
}
[data-tooltip-dir="below"]::before {
  bottom: auto;
  top: calc(100% + 1px);
  border-color: transparent transparent var(--vscode-editorHoverWidget-border, #454545) transparent;
}

.vt-hint { color: var(--vscode-descriptionForeground); }
.vt-warning { color: var(--vscode-editorWarning-foreground); }

.vt-history { position: relative; display: inline-flex; }

.vt-history-menu {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 20;
  box-sizing: border-box;
  width: max-content;
  min-width: min(320px, calc(100vw - 24px));
  max-width: min(480px, calc(100vw - 24px));
  max-height: 320px;
  display: flex;
  flex-direction: column;
  padding: 4px;
  border-radius: 4px;
  border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
  background: var(--vscode-menu-background, var(--vscode-dropdown-background));
  color: var(--vscode-menu-foreground, var(--vscode-foreground));
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}

.vt-history-items {
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
}

.vt-history-item {
  display: block;
  width: 100%;
  padding: 5px 10px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.vt-history-item:hover { background: var(--vscode-list-hoverBackground); }
.vt-history-item:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}

/* The separator and Clear button are the menu's sticky footer: they must keep their natural
   height so that when max-height clamps the flex column, only the scrollable .vt-history-items
   area shrinks. Without flex-shrink:0 the footer gets squished and its text is clipped. */
.vt-history-sep {
  flex: 0 0 auto;
  height: 1px;
  margin: 4px 2px;
  background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border));
}

.vt-history-clear { flex: 0 0 auto; color: var(--vscode-errorForeground); }

.vt-saved-row { display: flex; align-items: stretch; gap: 4px; border-radius: 3px; }
.vt-saved-row:hover { background: var(--vscode-list-hoverBackground); }
.vt-saved-row .vt-history-item { flex: 1 1 auto; }
.vt-saved-row .vt-history-item:hover { background: transparent; }
.vt-saved-del {
  flex: 0 0 auto;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  font: inherit;
  cursor: pointer;
  padding: 0 8px;
}
.vt-saved-del:hover { color: var(--vscode-errorForeground); }

.vt-saved-search-wrap { padding: 4px 4px 2px; flex: 0 0 auto; }
.vt-saved-search {
  box-sizing: border-box;
  width: 100%;
  padding: 3px 8px;
  font: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 3px;
}
.vt-saved-search:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.vt-saved-no-results {
  margin: 0;
  padding: 8px 10px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.vt-result-area {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.vt-result-controls {
  display: flex;
  align-items: flex-start;
  flex: 0 0 auto;
  margin-top: auto;
}
.vt-result-controls-right {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px 8px;
  padding: 0 10px 6px;
  margin-left: auto;
}
.vt-meta { color: var(--vscode-descriptionForeground); font-size: 12px; }

/* Segmented control for Table / JSON toggle. */
.vt-viewtoggle {
  display: inline-flex;
  box-sizing: border-box;
  max-width: 100%;
  height: 28px;
  padding: 2px;
  border-radius: 4px;
  background: var(--vscode-editorWidget-background, var(--vscode-input-background));
  border: 1px solid var(--vscode-panel-border);
}
.vt-viewtab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 3px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  font-family: inherit;
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.1s ease, background-color 0.1s ease;
}
.vt-viewtab:hover { color: var(--vscode-foreground); }
.vt-viewtab.active {
  color: var(--vscode-button-foreground, var(--vscode-foreground));
  background: var(--vscode-button-background, var(--vscode-list-activeSelectionBackground));
  font-weight: 600;
}
.vt-viewtab:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }

.vt-json {
  flex: 1 1 auto;
  /* Stay usable rather than collapsing to nothing when the editor is squeezed and scrolls as a whole. */
  min-height: 120px;
  overflow: auto;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--vscode-panel-border);
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 12px;
  white-space: pre;
  color: var(--vscode-foreground);
}

/* Read-only Monaco JSON viewer. Fit mode sizes its own height inline (API History card); the is-fill
   modifier flexes to fill the parent's scroll area (VQL results panel). */
.vt-json-viewer {
  width: 100%;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  overflow: hidden;
}
.vt-json-viewer.is-fill { flex: 1 1 auto; min-height: 120px; }

.vt-error {
  flex: 0 0 auto;
  padding: 8px 10px;
  border-radius: 2px;
  overflow-wrap: anywhere;
  border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
  background: var(--vscode-inputValidation-errorBackground, transparent);
}
.vt-error .type { font-weight: 600; color: var(--vscode-errorForeground); }

.vt-pager { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; flex: 0 0 auto; }
.vt-page-chip {
  display: inline-flex;
  align-items: center;
  height: 28px;
  box-sizing: border-box;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 12px;
  background: var(--vscode-input-background);
  color: var(--vscode-descriptionForeground);
  border: 1px solid var(--vscode-panel-border);
  white-space: nowrap;
}

.vt-grid-wrap {
  flex: 1 1 auto;
  /* Keep a usable grid (with its sticky header + internal scroll) instead of collapsing to zero when
     the editor is squeezed short and scrolls as a whole. */
  min-height: 120px;
  overflow: auto;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
}
table.vt-grid { border-collapse: collapse; width: 100%; font-size: 12px; }
.vt-grid th, .vt-grid td {
  padding: 3px 8px;
  text-align: left;
  vertical-align: top;
  white-space: nowrap;
  border: 1px solid var(--vscode-panel-border);
}
.vt-grid th {
  position: sticky;
  top: 0;
  font-weight: 600;
  /* Must be opaque: this sits above scrolling rows, and theme colors like
     keybindingTable.headerBackground can carry alpha, letting row text show through. */
  background: var(--vscode-editor-background);
}
.vt-grid thead tr:first-child th:first-child { border-top-left-radius: 3px; }
.vt-grid thead tr:first-child th:last-child { border-top-right-radius: 3px; }
.vt-grid tbody tr:hover { background: var(--vscode-list-hoverBackground); }

.vt-spinner {
  display: inline-block;
  width: 11px;
  height: 11px;
  vertical-align: -1px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: vt-spin 0.7s linear infinite;
}
@keyframes vt-spin { to { transform: rotate(360deg); } }

.vt-env-panel {
  box-sizing: border-box;
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 12px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
}

.vt-actions-panel {
  box-sizing: border-box;
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 12px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
}
.vt-actions-panel .vt-header { margin-bottom: 12px; }

.vt-tree { display: flex; flex-direction: column; }
.vt-tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  width: 100%;
  padding: 3px 8px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.vt-tree-row:hover:not(.disabled) { background: var(--vscode-list-hoverBackground); }
.vt-tree-row:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
/* Dim the row's content (icon + label), not the whole button — a parent opacity would cap the
   tooltip pseudo-element's opacity too, rendering the bubble see-through. The child selector
   matches the flow children but not the ::after/::before tooltip. */
.vt-tree-row.disabled { cursor: default; }
.vt-tree-row.disabled > * { opacity: 0.5; }
/* Keep the row's icons at their intrinsic size in a narrow panel — only the label truncates. */
.vt-tree-row > svg { flex: 0 0 auto; }
/* Row tooltips (a disabled leaf's gating hint, or any row's full label when truncated) size to their
   content (left-anchored via align-left) but are capped at the row width, so they stay on one line
   when they fit and wrap within the panel only when too long. */
.vt-tree-row[data-tooltip]::after { width: max-content; max-width: 100%; }
.vt-tree-label { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vt-tree-chevron {
  flex: 0 0 auto;
  color: var(--vscode-icon-foreground, var(--vscode-foreground));
  transition: transform 0.1s ease;
}
.vt-tree-chevron.expanded { transform: rotate(90deg); }
.vt-tree-chevron-spacer { flex: 0 0 auto; width: 12px; }

.vt-env-list { display: flex; flex-direction: column; gap: 16px; }

.vt-env-section { display: flex; flex-direction: column; gap: 8px; }
.vt-env-section-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vscode-descriptionForeground);
}
.vt-env-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.vt-env-section-current {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.vt-env-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  background: var(--vscode-sideBarSectionHeader-background, transparent);
  transition: border-color 0.2s ease;
}
.vt-env-card.status-connected {
  border-color: var(--vscode-testing-iconPassed, #3fb950);
}
.vt-env-card.status-connected:not(.current) {
  border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, #3fb950) 45%, var(--vscode-panel-border));
}
.vt-env-card.status-error {
  border-color: var(--vscode-errorForeground);
}

.vt-env-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.vt-icon-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-icon-foreground, var(--vscode-foreground));
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.vt-icon-btn:hover:not(:disabled) {
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}
.vt-icon-btn.danger:hover:not(:disabled) {
  color: var(--vscode-errorForeground);
}
.vt-icon-btn:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
.vt-tooltip {
  position: fixed;
  z-index: 1000;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--vscode-editorHoverWidget-background, #252526);
  color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground, #ccc));
  border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-contrastBorder, #454545));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  font-size: 11px;
  font-weight: 400;
  line-height: 1.5;
  white-space: nowrap;
  pointer-events: none;
}

.vt-env-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.vt-env-title-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1 1 auto;
}
.vt-env-label {
  font-weight: 600;
  overflow-wrap: anywhere;
  min-width: 0;
}
.vt-env-dns {
  color: var(--vscode-descriptionForeground);
  overflow-wrap: anywhere;
  min-width: 0;
  font-size: 11px;
}
.vt-env-status { font-size: 12px; color: var(--vscode-descriptionForeground); }
.vt-env-card.status-connected .vt-env-status { color: var(--vscode-testing-iconPassed, #3fb950); }
.vt-env-card.status-connecting .vt-env-status { color: var(--vscode-testing-iconQueued, #d29922); }
.vt-env-card.status-error .vt-env-status { color: var(--vscode-errorForeground); }

.vt-badge.neutral {
  color: var(--vscode-badge-foreground);
  background: var(--vscode-badge-background);
  border-color: transparent;
  flex-shrink: 0;
}

.vt-badge.production {
  color: #f8972b;
  background: rgba(248, 151, 43, 0.12);
  border: 1px solid rgba(248, 151, 43, 0.35);
  flex-shrink: 0;
}

/* Light theme overrides: slightly darker orange text for readability/contrast on light backgrounds */
body.vscode-light .vt-badge.production,
.vscode-light .vt-badge.production {
  color: #c35400;
  background: rgba(248, 151, 43, 0.15);
  border: 1px solid rgba(248, 151, 43, 0.4);
}

/* High contrast theme overrides */
body.vscode-high-contrast .vt-badge.production,
.vscode-high-contrast .vt-badge.production {
  color: var(--vscode-foreground);
  background: transparent;
  border: 1px solid var(--vscode-contrastActiveBorder, currentColor);
}

.vt-status-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: var(--vscode-descriptionForeground); }
.vt-status-dot.connected { background: var(--vscode-testing-iconPassed, #3fb950); }
.vt-status-dot.connecting { background: var(--vscode-testing-iconQueued, #d29922); }
.vt-status-dot.error { background: var(--vscode-errorForeground); }

.vt-env-info { margin-top: 8px; border-top: 1px solid var(--vscode-panel-border); padding-top: 8px; }
.vt-env-info > summary {
  display: flex;
  align-items: center;
  gap: 6px;
  list-style: none;
  cursor: pointer;
  color: var(--vscode-foreground);
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 6px;
  user-select: none;
}
.vt-env-info > summary::-webkit-details-marker { display: none; }
.vt-env-info-caret {
  display: flex;
  align-items: center;
  transition: transform 0.12s ease;
  color: var(--vscode-descriptionForeground);
}
details[open].vt-env-info > summary .vt-env-info-caret { transform: rotate(90deg); }
.vt-info-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  width: 100%;
  padding: 6px 8px;
}
.vt-info-row-link {
  border: none;
  border-radius: 4px;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.vt-info-row-link:hover { background: var(--vscode-list-hoverBackground); }
.vt-info-label {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.vt-info-value {
  font-size: 12px;
  color: var(--vscode-foreground);
  overflow-wrap: anywhere;
  word-break: break-all;
}
.vt-info-link {
  color: var(--vscode-textLink-foreground);
}
.vt-info-link-icon {
  display: inline-block;
  margin-left: 4px;
  vertical-align: middle;
}
.vt-info-row-link:hover .vt-info-link,
.vt-info-row-link:focus-visible .vt-info-link {
  color: var(--vscode-textLink-activeForeground);
  text-decoration: underline;
}

.vt-env-form { display: flex; flex-direction: column; gap: 4px; }
.vt-compare-selector { display: flex; flex-direction: column; gap: 10px; }
/* Deliberately not vt-field: that rule styles bare inputs and would clobber react-select's input. */
.vt-compare-field { display: flex; flex-direction: column; gap: 2px; }
.vt-compare-field > span:first-child { font-size: 12px; }
.vt-compare-swap { align-self: center; }
.vt-compare-kinds { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px 10px; margin: 0; }
.vt-compare-kinds legend { font-size: 12px; padding: 0 4px; }

.vt-config-report-form,
.vt-api-usage-log-form,
.vt-sdk-runtime-log-form { display: flex; flex-direction: column; gap: 10px; padding: 6px; }
.vt-developer-logs-header { margin: 0 0 8px; font-size: 13px; font-weight: 600; }
.vt-config-report-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.vt-config-report-header-row .vt-developer-logs-header { margin-bottom: 0; }
.vt-config-report-header-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
/* Buttons sit at the panel's right edge — right-align their tooltips so they don't clip past the
   panel in narrow (sidebar) widths. */
.vt-config-report-header-actions [data-tooltip]::after { left: auto; right: 0; transform: none; }
.vt-config-report-location, .vt-developer-logs-location {
  display: flex;
  flex-flow: row wrap;
  align-items: baseline;
  gap: 4px 8px;
}
.vt-config-report-location .vt-hint, .vt-developer-logs-location .vt-hint { font-size: 11px; }
/* Specificity beats the later .vt-link-button font:inherit rule, so the button matches the 11px
   hint text; baseline keeps it aligned with the text when they share a line. */
.vt-config-report-location .vt-config-report-location-btn,
.vt-developer-logs-location .vt-developer-logs-location-btn { font-size: 11px; align-self: baseline; }
.vt-config-report-location code, .vt-developer-logs-location code {
  font-family: var(--vscode-editor-font-family, monospace);
  word-break: break-all;
}
.vt-checkbox-group { display: flex; flex-direction: column; gap: 6px; }
.vt-checkbox-field { display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; }
.vt-checkbox-field input { margin: 0; cursor: pointer; }
.vt-checkbox-field.disabled { opacity: 0.5; cursor: default; }
.vt-checkbox-field.disabled input { cursor: default; }
.vt-form-field { display: flex; flex-direction: column; gap: 2px; }
.vt-form-field > label { font-size: 12px; }
.vt-field-label-row { display: flex; align-items: center; gap: 6px; }
.vt-field-label-row > label { font-size: 12px; }
.vt-info-hint {
  display: inline-flex;
  align-items: center;
  color: var(--vscode-descriptionForeground);
  cursor: help;
  flex: 0 0 auto;
}
.vt-input {
  box-sizing: border-box;
  width: 100%;
  padding: 3px 6px;
  font: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
}
.vt-input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.vt-link-button {
  align-self: flex-start;
  padding: 0;
  font: inherit;
  color: var(--vscode-textLink-foreground);
  background: none;
  border: none;
  cursor: pointer;
}
.vt-link-button:hover:not(:disabled) { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
.vt-link-button:disabled { opacity: 0.5; cursor: default; }

.vt-field { display: flex; flex-direction: column; gap: 2px; }
.vt-field > span:first-child { font-size: 12px; }
.vt-field input, .vt-field select {
  box-sizing: border-box;
  width: 100%;
  padding: 3px 6px;
  font: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
}
.vt-field input:focus, .vt-field select:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
.vt-field-error { min-height: 14px; font-size: 11px; color: var(--vscode-errorForeground); }

/* Calendar grid shared by both Developer Log forms and the Config Report date popover
   (webview/actions/DateCalendar.tsx). */
.vt-calendar {
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 4px;
  padding: 6px;
  min-width: 210px;
  max-width: 240px;
}
.vt-calendar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.vt-calendar-title { font-size: 12px; font-weight: 600; }
.vt-calendar-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-foreground);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.vt-calendar-nav:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
.vt-calendar-nav:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.vt-calendar-nav:disabled { opacity: 0.5; cursor: default; }
.vt-calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.vt-calendar-weekday {
  text-align: center;
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  padding: 2px 0;
}
.vt-calendar-day {
  aspect-ratio: 1;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-foreground);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.vt-calendar-day:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
.vt-calendar-day:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.vt-calendar-day.selected {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}
.vt-calendar-day.selected:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
.vt-calendar-day:disabled { opacity: 0.35; cursor: default; }

/* Config Report's single-date popover (webview/actions/DatePopoverField.tsx): a field-styled button
   that opens the shared vt-calendar grid below it, in place of a native date input. */
.vt-date-field { position: relative; }
.vt-date-trigger {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 26px;
  padding: 3px 6px;
  font: inherit;
  text-align: left;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
  cursor: pointer;
}
.vt-date-trigger:disabled { opacity: 0.6; cursor: default; }
.vt-date-trigger:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.vt-date-trigger-icon { flex: 0 0 auto; display: inline-flex; color: var(--vscode-descriptionForeground); }
.vt-date-trigger-value { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vt-date-trigger-placeholder { color: var(--vscode-input-placeholderForeground); }
/* Reserves room for the sibling .vt-input-toggle clear button (see .vt-input-with-toggle below). */
.vt-input-with-toggle .vt-date-trigger { padding-right: 28px; }
.vt-date-popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 100;
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  border-radius: 4px;
}

/* Wraps a field-like control plus an absolutely-positioned .vt-input-toggle button (show/hide
   password, clear). Usually the control is an <input> (see the rule below); .vt-date-trigger above is
   the one consumer where it's a <button> instead, so its own padding-right rule stands in for this one. */
.vt-input-with-toggle { position: relative; display: flex; }
.vt-input-with-toggle input { padding-right: 28px; }
.vt-input-toggle {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--vscode-icon-foreground, var(--vscode-foreground));
  cursor: pointer;
}
.vt-input-toggle:hover { color: var(--vscode-foreground); }
.vt-input-toggle:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -2px; }

/* ── API History ─────────────────────────────────────────────────────────── */
/* flex:1 + min-width:0 so the panel fills the tab area's width (the view), not just its content —
   the tab area is a flex row, so without this the panel would shrink to its content and leave the
   rest of a widened view empty. */
.vt-apihistory {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
}
.vt-apihistory-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.vt-apihistory-filter {
  flex: 1 1 auto;
  min-width: 0;
  box-sizing: border-box;
  min-height: 26px;
  padding: 3px 8px;
  font: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
}
.vt-apihistory-filter:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
/* These icon buttons sit at the bar's right edge — right-align their tooltips so they don't clip
   past the panel in narrow (sidebar) widths. */
.vt-apihistory-bar [data-tooltip]::after { left: auto; right: 0; transform: none; }

.vt-apihistory-count {
  padding: 6px 10px 4px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.vt-apihistory-empty {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 24px 16px;
  text-align: center;
  color: var(--vscode-foreground);
}
.vt-apihistory-empty-hint { font-size: 12px; color: var(--vscode-descriptionForeground); }

.vt-apihistory-list { flex: 1 1 auto; overflow-y: auto; }
.vt-apihistory-item { border-bottom: 1px solid var(--vscode-panel-border); }
.vt-apihistory-summary {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 7px 10px;
  cursor: pointer;
}
.vt-apihistory-summary:hover { background: var(--vscode-list-hoverBackground); }
.vt-apihistory-summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.vt-apihistory-item.is-expanded { background: var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground)); }
.vt-apihistory-item.is-expanded > .vt-apihistory-summary:hover { background: transparent; }

.vt-apihistory-primary { display: flex; align-items: center; gap: 6px; min-width: 0; }
.vt-apihistory-endpoint {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 12px;
  color: var(--vscode-foreground);
}
.vt-apihistory-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}
.vt-apihistory-dot { opacity: 0.6; }
.vt-apihistory-env {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.vt-apihistory-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px;
  border-top: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
}

/* Request / Response segmented control: two equal, always-visible buttons. */
.vt-seg {
  display: inline-flex;
  align-self: flex-start;
  padding: 2px;
  border-radius: 6px;
  background: var(--vscode-editorWidget-background, var(--vscode-input-background));
  border: 1px solid var(--vscode-panel-border);
}
.vt-seg-btn {
  padding: 3px 14px;
  font: inherit;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.vt-seg-btn:hover { color: var(--vscode-foreground); }
.vt-seg-btn.is-active {
  color: var(--vscode-button-foreground, var(--vscode-foreground));
  background: var(--vscode-button-background, var(--vscode-list-activeSelectionBackground));
}
.vt-seg-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }

.vt-apihistory-section { display: flex; flex-direction: column; gap: 5px; }
.vt-apihistory-section-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
  width: 100%;
  text-align: left;
}
.vt-apihistory-section-toggle:hover .vt-apihistory-section-label { color: var(--vscode-foreground); }
.vt-apihistory-section-toggle:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; border-radius: 2px; }
.vt-apihistory-section-chevron { transition: transform 0.15s ease; flex-shrink: 0; color: var(--vscode-descriptionForeground); }
.vt-apihistory-section-chevron.is-collapsed { transform: rotate(-90deg); }
.vt-apihistory-section-label {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vscode-descriptionForeground);
}
.vt-apihistory-empty-line { margin: 0; font-size: 12px; color: var(--vscode-descriptionForeground); }

/* Bound the payload's own <pre> so its horizontal + vertical scrollbars stay on the visible viewport;
   .vt-json already sets white-space:pre + overflow:auto, so long lines scroll. */
.vt-apihistory-section .vt-json { max-height: 360px; }
.vt-apihistory-headers { border-collapse: collapse; width: 100%; font-size: 12px; }
.vt-apihistory-headers td { padding: 2px 8px 2px 0; vertical-align: top; }
.vt-apihistory-header-name { font-weight: 600; white-space: nowrap; color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-foreground)); }
.vt-apihistory-header-value { font-family: var(--vscode-editor-font-family, monospace); word-break: break-all; }

/* Method + status badges: pill-shaped, semantic colors, no border, sized to their content. */
.vt-apihistory-primary .vt-badge {
  border: none;
  border-radius: 4px;
  letter-spacing: 0.02em;
  flex: 0 0 auto;
}
/* Method colors follow the Postman theme. */
.vt-method-get { color: #fff; background: #0265DC; }
.vt-method-post { color: #fff; background: #0CBB52; }
.vt-method-put { color: #fff; background: #E57500; }
.vt-method-patch { color: #fff; background: #9B51E0; }
.vt-method-delete { color: #fff; background: #FF4D4F; }
.vt-status-ok { color: #fff; background: #2f9e58; }
.vt-status-redirect { color: #1e1e1e; background: #cfa60f; }
.vt-status-client-error { color: #1e1e1e; background: #d98a2b; }
.vt-status-server-error { color: #fff; background: #c93b3b; }
.vt-status-error { color: #fff; background: #c93b3b; }
`;

export function GlobalStyles(): JSX.Element {
	return <style>{CSS}</style>;
}
