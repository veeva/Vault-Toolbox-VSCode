import { describe, it, expect, vi } from 'vitest';

// The provider only touches vscode for EventEmitter; stub it so the module loads under node.
vi.mock('vscode', () => ({
	EventEmitter: class {
		event = () => {};
		fire(): void {}
	},
	Uri: {
		from: (options: { scheme: string; path: string; query: string }) => options,
	},
}));

import { CompareContentProvider, compareUri } from './compareContentProvider';
import { CompareSession } from './compareSession';
import type { CodeClass } from '../../core/compare/compareComponents';

const peer = { envId: 's', vaultDNS: 'src.veevavault.com', label: 'src' };
const targetPeer = { envId: 't', vaultDNS: 'tgt.veevavault.com', label: 'tgt' };

function sessionWithCode(source: CodeClass[], target: CodeClass[]): CompareSession {
	return new CompareSession({
		source: peer,
		target: targetPeer,
		targetIsProduction: false,
		code: { source, target },
	});
}

describe('CompareContentProvider', () => {
	it('shows the fetch-failure reason as a comment when a side errored instead of an empty document', () => {
		const session = sessionWithCode(
			[{ name: 'a.B', source: undefined, error: 'File not found.' }],
			[{ name: 'a.B', source: 'class B {}' }],
		);
		const provider = new CompareContentProvider(() => session);
		const entry = session.getEntry('', 'a.B')!;

		expect(provider.provideTextDocumentContent(compareUri(entry, 'source', peer))).toBe(
			'// Could not retrieve source: File not found.',
		);
		expect(provider.provideTextDocumentContent(compareUri(entry, 'target', targetPeer))).toBe('class B {}');
	});

	it('still shows an empty document for a side that is genuinely absent, not errored', () => {
		const session = sessionWithCode([{ name: 'a.New', source: 'class New {}' }], []);
		const provider = new CompareContentProvider(() => session);
		const entry = session.getEntry('', 'a.New')!;

		expect(provider.provideTextDocumentContent(compareUri(entry, 'target', targetPeer))).toBe('');
	});
});
