import * as vscode from 'vscode';
import type { CompareEntry } from '../../core/compare/compareComponents';
import type { CompareSession, ComparePeer } from './compareSession';

/** Custom URI scheme for read-only virtual MDL documents backing the Compare diff editor. */
export const COMPARE_SCHEME = 'vault-compare';

/** Which Vault a virtual document represents. */
export type CompareSide = 'source' | 'target';

/**
 * Build the virtual-document URI for one side of an entry. The lookup key (type, name, side) rides in
 * the query so the provider can resolve content regardless of the display path; the path carries the
 * Vault DNS (so the file basename in breadcrumbs/peek names its Vault). The extension picks the grammar:
 * an `mdl` entry ends in `.mdl` (MDL grammar, `language id: mdl`), a `code` entry ends in `.java` (VSCode's
 * built-in Java grammar). A code entry's identity is its fully-qualified class name (`type` is empty).
 */
export function compareUri(entry: CompareEntry, side: CompareSide, peer: ComparePeer): vscode.Uri {
	const query = new URLSearchParams({ type: entry.type, name: entry.name, side });
	const extension = entry.kind === 'code' ? 'java' : 'mdl';
	const label = entry.kind === 'code' ? entry.name : `${entry.type}/${entry.name}`;
	return vscode.Uri.from({
		scheme: COMPARE_SCHEME,
		path: `/${label} @ ${peer.vaultDNS}.${extension}`,
		query: query.toString(),
	});
}

/**
 * Serves each side's MDL for the Compare diff editor from the current in-memory comparison snapshot —
 * no temp files, no cleanup. A source-only or target-only component returns an empty document on its
 * missing side, so the diff still reads as a pure add or remove. A code entry whose source GET failed
 * (an `unavailable` side) instead shows the failure reason as a comment, so the diff explains itself
 * rather than looking like an empty add/remove. `refresh` re-emits a change for a side so an open diff
 * picks up a post-apply recompute.
 */
export class CompareContentProvider implements vscode.TextDocumentContentProvider {
	private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this.onDidChangeEmitter.event;

	constructor(private readonly getSession: () => CompareSession | undefined) {}

	provideTextDocumentContent(uri: vscode.Uri): string {
		const params = new URLSearchParams(uri.query);
		// `type` is empty for a code entry (identity is the class name alone), so only name + side are required.
		const type = params.get('type') ?? '';
		const name = params.get('name');
		const side = params.get('side') as CompareSide | null;
		if (!name || !side) {
			return '';
		}
		const entry = this.getSession()?.getEntry(type, name);
		if (!entry) {
			return '';
		}
		const content = side === 'source' ? entry.sourceMdl : entry.targetMdl;
		if (content !== undefined) {
			return content;
		}
		const error = side === 'source' ? entry.sourceError : entry.targetError;
		return error ? `// Could not retrieve source: ${error}` : '';
	}

	/** Signal that a side's content changed (e.g. after an apply recompute), so an open diff refreshes. */
	refresh(uri: vscode.Uri): void {
		this.onDidChangeEmitter.fire(uri);
	}

	dispose(): void {
		this.onDidChangeEmitter.dispose();
	}
}

/**
 * Renders each diff side's full Vault DNS as a non-clickable header above line 0 — a CodeLens, not
 * document text, so it labels the source/target without entering the diff (no changed line, no
 * line-number shift) and can never reach the apply path, which reads `entry.sourceMdl`, not this
 * display. The DNS is resolved from the live session rather than the URI, so it always matches the
 * Environment the user picked. The tab carries the shorter Vault *name*; the full host lives here.
 */
export class CompareCodeLensProvider implements vscode.CodeLensProvider {
	constructor(private readonly getSession: () => CompareSession | undefined) {}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const side = new URLSearchParams(document.uri.query).get('side') as CompareSide | null;
		const session = this.getSession();
		if (!side || !session) {
			return [];
		}
		const peer = side === 'source' ? session.source : session.target;
		const role = side === 'source' ? 'Source' : 'Target';
		return [
			new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
				title: `${role}: ${peer.vaultDNS}`,
				command: '',
			}),
		];
	}
}
