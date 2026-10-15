import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { formatVql } from '../../core/vql/vqlFormat';
import { VQL_LANGUAGE_ID } from './vqlLanguage';

let registered = false;

/**
 * Register the VQL document formatter with Monaco (once), backing the built-in `editor.action.
 * formatDocument` action and its Shift+Alt+F keybinding. The formatting logic is the vscode-free
 * core `formatVql`; here we just wrap its output as a single full-range text edit.
 */
export function registerVqlFormatting(): void {
	if (registered) {
		return;
	}
	registered = true;
	monaco.languages.registerDocumentFormattingEditProvider(VQL_LANGUAGE_ID, {
		provideDocumentFormattingEdits(model) {
			return [{ range: model.getFullModelRange(), text: formatVql(model.getValue()) }];
		},
	});
}
