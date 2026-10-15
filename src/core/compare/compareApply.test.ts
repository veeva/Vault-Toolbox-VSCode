import { describe, it, expect, vi } from 'vitest';
import type { MdlExecuteResult, SdkCodeResult } from '../rest/types';
import type { ApiHistoryEntry } from '../rest/apiHistory';
import type { CompareEntry, ComponentDefinition } from './compareComponents';
import {
	applyWrite,
	isApplyWriteSuccess,
	prepareBatch,
	recomputeEntry,
	reportSpecFor,
	type CompareApplyPort,
} from './compareApply';

const MDL_OK: MdlExecuteResult = { responseStatus: 'SUCCESS', statements: [] };
const MDL_FAIL: MdlExecuteResult = { responseStatus: 'FAILURE', statements: [] };
const SDK_OK: SdkCodeResult = { responseStatus: 'SUCCESS', url: 'com.veeva.vault.custom.Foo' };
const SDK_FAIL: SdkCodeResult = { responseStatus: 'FAILURE', responseMessage: 'nope' };

/** A fake target port with programmable write results and re-reads; records what it was called with. */
function fakePort(overrides: Partial<CompareApplyPort> = {}): CompareApplyPort {
	return {
		executeMdl: vi.fn(async () => MDL_OK),
		deploySource: vi.fn(async () => SDK_OK),
		deleteSource: vi.fn(async () => SDK_OK),
		retrieveComponentDefinition: vi.fn(async () => undefined),
		retrieveSourceCode: vi.fn(async () => ''),
		...overrides,
	};
}

function mdlEntry(type: string, name: string, status: CompareEntry['status'], sourceMdl?: string): CompareEntry {
	return { kind: 'mdl', type, name, status, sourceMdl };
}
function codeEntry(name: string, status: CompareEntry['status'], sourceMdl?: string): CompareEntry {
	return { kind: 'code', type: '', name, status, sourceMdl };
}
function componentDef(type: string, name: string, mdl: string): ComponentDefinition {
	return { type, name, mdl };
}

describe('applyWrite', () => {
	it('executes MDL for an execute plan', async () => {
		const port = fakePort();
		const result = await applyWrite({ operation: 'execute', script: 'RECREATE Picklist x__c();' }, port);
		expect(port.executeMdl).toHaveBeenCalledWith('RECREATE Picklist x__c();');
		expect(result).toBe(MDL_OK);
	});

	it('executes the DROP script for a drop plan', async () => {
		const port = fakePort();
		await applyWrite({ operation: 'drop', script: 'DROP Picklist x__c;' }, port);
		expect(port.executeMdl).toHaveBeenCalledWith('DROP Picklist x__c;');
	});

	it('deploys with the simple class filename and encoded source bytes', async () => {
		const port = fakePort();
		await applyWrite(
			{ operation: 'deploy', className: 'com.veeva.vault.custom.Foo', source: 'class Foo {}' },
			port,
		);
		const [fileName, bytes] = (port.deploySource as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(fileName).toBe('Foo.java');
		expect(new TextDecoder().decode(bytes)).toBe('class Foo {}');
	});

	it('deletes by fully-qualified class name for a delete plan', async () => {
		const port = fakePort();
		await applyWrite({ operation: 'delete', className: 'com.veeva.vault.custom.Foo' }, port);
		expect(port.deleteSource).toHaveBeenCalledWith('com.veeva.vault.custom.Foo');
	});
});

describe('isApplyWriteSuccess', () => {
	it('classifies MDL execute/drop success and failure', () => {
		expect(isApplyWriteSuccess('execute', MDL_OK)).toBe(true);
		expect(isApplyWriteSuccess('drop', MDL_FAIL)).toBe(false);
	});

	it('classifies SDK deploy/delete success and failure', () => {
		expect(isApplyWriteSuccess('deploy', SDK_OK)).toBe(true);
		expect(isApplyWriteSuccess('deploy', SDK_FAIL)).toBe(false);
		expect(isApplyWriteSuccess('delete', SDK_OK)).toBe(true);
		expect(isApplyWriteSuccess('delete', SDK_FAIL)).toBe(false);
	});
});

describe('reportSpecFor', () => {
	const mdlCall = { method: 'POST', url: 'https://x/api/mdl/execute' } as ApiHistoryEntry;
	const deployCall = { method: 'PUT', url: 'https://x/api/v26.1/code' } as ApiHistoryEntry;
	const deleteCall = { method: 'DELETE', url: 'https://x/api/v26.1/code/com.veeva.vault.custom.Foo' } as ApiHistoryEntry;

	it('maps MDL operations to the MDL Execute call shape and summary', () => {
		for (const op of ['execute', 'drop'] as const) {
			const spec = reportSpecFor(op);
			expect(spec.isCall(mdlCall)).toBe(true);
			expect(spec.isCall(deployCall)).toBe(false);
			expect(spec.summarize(MDL_OK).ok).toBe(true);
		}
	});

	it('maps deploy to the PUT /code shape and delete to the DELETE /code/{class} shape', () => {
		expect(reportSpecFor('deploy').isCall(deployCall)).toBe(true);
		expect(reportSpecFor('deploy').isCall(deleteCall)).toBe(false);
		expect(reportSpecFor('delete').isCall(deleteCall)).toBe(true);
		expect(reportSpecFor('delete').isCall(deployCall)).toBe(false);
		expect(reportSpecFor('deploy').summarize(SDK_FAIL).ok).toBe(false);
	});
});

describe('recomputeEntry', () => {
	it('removes a deleted code entry without any re-read', async () => {
		const port = fakePort();
		const result = await recomputeEntry(codeEntry('com.veeva.vault.custom.Foo', 'target-only'), 'delete', port);
		expect(result).toEqual({ kind: 'remove' });
		expect(port.retrieveSourceCode).not.toHaveBeenCalled();
	});

	it('removes a dropped MDL entry when the re-read finds nothing', async () => {
		const port = fakePort({ retrieveComponentDefinition: vi.fn(async () => undefined) });
		const result = await recomputeEntry(mdlEntry('Picklist', 'old__c', 'target-only'), 'drop', port);
		expect(result).toEqual({ kind: 'remove' });
	});

	it('leaves a dropped MDL entry unchanged when the component still exists', async () => {
		const port = fakePort({
			retrieveComponentDefinition: vi.fn(async () => componentDef('Picklist', 'old__c', 'X')),
		});
		const result = await recomputeEntry(mdlEntry('Picklist', 'old__c', 'target-only'), 'drop', port);
		expect(result).toEqual({ kind: 'unchanged' });
	});

	it('leaves an executed MDL entry unchanged when the target has no such component', async () => {
		const port = fakePort({ retrieveComponentDefinition: vi.fn(async () => undefined) });
		const result = await recomputeEntry(mdlEntry('Picklist', 'x__c', 'source-only', 'NEW'), 'execute', port);
		expect(result).toEqual({ kind: 'unchanged' });
	});

	it('reclassifies an executed MDL entry identical when the re-read byte-matches the source', async () => {
		const port = fakePort({
			retrieveComponentDefinition: vi.fn(async () => componentDef('Picklist', 'x__c', 'SAME')),
		});
		const result = await recomputeEntry(mdlEntry('Picklist', 'x__c', 'modified', 'SAME'), 'execute', port);
		expect(result).toMatchObject({ kind: 'replace', entry: { status: 'identical', targetMdl: 'SAME' } });
	});

	it('reclassifies an executed MDL entry modified when Vault stored it differently', async () => {
		const port = fakePort({
			retrieveComponentDefinition: vi.fn(async () => componentDef('Picklist', 'x__c', 'NORMALIZED')),
		});
		const result = await recomputeEntry(mdlEntry('Picklist', 'x__c', 'modified', 'SOURCE'), 'execute', port);
		expect(result).toMatchObject({ kind: 'replace', entry: { status: 'modified' } });
	});

	it('reclassifies a deployed code entry identical when the re-read matches the source', async () => {
		const port = fakePort({ retrieveSourceCode: vi.fn(async () => 'class Foo {}') });
		const result = await recomputeEntry(
			codeEntry('com.veeva.vault.custom.Foo', 'source-only', 'class Foo {}'),
			'deploy',
			port,
		);
		expect(result).toMatchObject({ kind: 'replace', entry: { kind: 'code', status: 'identical' } });
	});

	it('marks a deployed code entry unavailable when the source cannot be read back', async () => {
		const port = fakePort({
			retrieveSourceCode: vi.fn(async () => {
				throw new Error('File not found.');
			}),
		});
		const result = await recomputeEntry(
			codeEntry('com.veeva.vault.custom.Foo', 'modified', 'class Foo {}'),
			'deploy',
			port,
		);
		expect(result).toMatchObject({ kind: 'replace', entry: { status: 'unavailable', targetMdl: undefined } });
	});
});

describe('prepareBatch', () => {
	it('filters out identical and unavailable entries', () => {
		const batch = prepareBatch([
			mdlEntry('Picklist', 'color__c', 'identical', 'X'),
			mdlEntry('Picklist', 'size__c', 'modified', 'NEW'),
			codeEntry('com.example.Foo', 'unavailable'),
			codeEntry('com.example.Bar', 'source-only', 'class Bar {}'),
		]);
		const names = batch.map(({ entry }) => entry.name);
		expect(names).toContain('size__c');
		expect(names).toContain('com.example.Bar');
		expect(names).not.toContain('color__c');
		expect(names).not.toContain('com.example.Foo');
	});

	it('places MDL entries before code entries regardless of input order', () => {
		const batch = prepareBatch([
			codeEntry('com.example.Bar', 'source-only', 'class Bar {}'),
			mdlEntry('Picklist', 'size__c', 'modified', 'NEW'),
		]);
		expect(batch[0].entry.kind).toBe('mdl');
		expect(batch[1].entry.kind).toBe('code');
	});

	it('derives the correct operation for each entry kind', () => {
		const batch = prepareBatch([
			mdlEntry('Picklist', 'size__c', 'modified', 'RECREATE Picklist size__c();'),
			mdlEntry('Picklist', 'old__c', 'target-only'),
			codeEntry('com.example.Bar', 'source-only', 'class Bar {}'),
			codeEntry('com.example.Gone', 'target-only'),
		]);
		const ops = batch.map(({ plan }) => plan.operation);
		expect(ops).toContain('execute');
		expect(ops).toContain('drop');
		expect(ops).toContain('deploy');
		expect(ops).toContain('delete');
	});

	it('returns empty for an all-identical input', () => {
		expect(prepareBatch([mdlEntry('Picklist', 'color__c', 'identical', 'X')])).toHaveLength(0);
	});
});
