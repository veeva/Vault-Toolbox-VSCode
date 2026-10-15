import { describe, it, expect, vi } from 'vitest';
import { handleMetadataRequest, type MetadataPort } from './vqlMetadataHandler';

function makeMetadata(overrides: Partial<Record<keyof MetadataPort, ReturnType<typeof vi.fn>>> = {}): MetadataPort {
	return {
		getTargets: vi.fn().mockResolvedValue([]),
		getConfigurableObjects: vi.fn().mockResolvedValue([]),
		getFields: vi.fn().mockResolvedValue([]),
		getRelationships: vi.fn().mockResolvedValue([]),
		getPicklistFields: vi.fn().mockResolvedValue({}),
		getPicklistValues: vi.fn().mockResolvedValue([]),
		...overrides,
	} as unknown as MetadataPort;
}

describe('handleMetadataRequest — targets', () => {
	it('returns targets from the port with the requestId', async () => {
		const metadata = makeMetadata({
			getTargets: vi.fn().mockResolvedValue([{ name: 'product__v', label: 'Product' }]),
		});

		const response = await handleMetadataRequest({ type: 'queryTargetsRequest', requestId: 't0' }, metadata);

		expect(metadata.getTargets).toHaveBeenCalled();
		expect(response).toEqual({
			type: 'queryTargetsResponse',
			requestId: 't0',
			targets: [{ name: 'product__v', label: 'Product' }],
		});
	});

	it('degrades a failed fetch to an empty array — never surfaces an error', async () => {
		const metadata = makeMetadata({
			getTargets: vi.fn().mockRejectedValue(new Error('SHOW failed')),
		});

		const response = await handleMetadataRequest({ type: 'queryTargetsRequest', requestId: 't1' }, metadata);

		expect(response).toEqual({ type: 'queryTargetsResponse', requestId: 't1', targets: [] });
	});

	it('returns empty targets when metadata is absent', async () => {
		const response = await handleMetadataRequest({ type: 'queryTargetsRequest', requestId: 't2' }, undefined);

		expect(response).toEqual({ type: 'queryTargetsResponse', requestId: 't2', targets: [] });
	});
});

describe('handleMetadataRequest — configurable objects', () => {
	it('returns the configurable-object list from the port with the requestId', async () => {
		const metadata = makeMetadata({
			getConfigurableObjects: vi
				.fn()
				.mockResolvedValue([{ name: 'product__v', source: 'standard' }]),
		});

		const response = await handleMetadataRequest(
			{ type: 'queryConfigurableObjectsRequest', requestId: 'c0' },
			metadata,
		);

		expect(metadata.getConfigurableObjects).toHaveBeenCalled();
		expect(response).toEqual({
			type: 'queryConfigurableObjectsResponse',
			requestId: 'c0',
			objects: [{ name: 'product__v', source: 'standard' }],
		});
	});

	it('degrades a failed fetch to an empty array — never surfaces an error', async () => {
		const metadata = makeMetadata({
			getConfigurableObjects: vi.fn().mockRejectedValue(new Error('metadata failed')),
		});

		const response = await handleMetadataRequest(
			{ type: 'queryConfigurableObjectsRequest', requestId: 'c1' },
			metadata,
		);

		expect(response).toEqual({
			type: 'queryConfigurableObjectsResponse',
			requestId: 'c1',
			objects: [],
		});
	});

	it('returns empty objects when metadata is absent', async () => {
		const response = await handleMetadataRequest(
			{ type: 'queryConfigurableObjectsRequest', requestId: 'c2' },
			undefined,
		);

		expect(response).toEqual({
			type: 'queryConfigurableObjectsResponse',
			requestId: 'c2',
			objects: [],
		});
	});
});

describe('handleMetadataRequest — fields', () => {
	it('passes the target and echoes it in the response', async () => {
		const metadata = makeMetadata({
			getFields: vi.fn().mockResolvedValue([{ name: 'name__v', type: 'String' }]),
		});

		const response = await handleMetadataRequest(
			{ type: 'queryFieldsRequest', requestId: 'f0', target: 'product__v' },
			metadata,
		);

		expect(metadata.getFields).toHaveBeenCalledWith('product__v');
		expect(response).toEqual({
			type: 'queryFieldsResponse',
			requestId: 'f0',
			target: 'product__v',
			fields: [{ name: 'name__v', type: 'String' }],
		});
	});

	it('degrades a failed fields fetch to an empty array', async () => {
		const metadata = makeMetadata({ getFields: vi.fn().mockRejectedValue(new Error('fail')) });

		const response = await handleMetadataRequest(
			{ type: 'queryFieldsRequest', requestId: 'f1', target: 'product__v' },
			metadata,
		);

		expect(response).toEqual({ type: 'queryFieldsResponse', requestId: 'f1', target: 'product__v', fields: [] });
	});
});

describe('handleMetadataRequest — relationships', () => {
	it('passes the target and echoes it in the response', async () => {
		const rel = { name: 'manufacturer__cr', target: 'manufacturer__c', type: 'outbound' as const };
		const metadata = makeMetadata({ getRelationships: vi.fn().mockResolvedValue([rel]) });

		const response = await handleMetadataRequest(
			{ type: 'queryRelationshipsRequest', requestId: 'r0', target: 'product__v' },
			metadata,
		);

		expect(metadata.getRelationships).toHaveBeenCalledWith('product__v');
		expect(response).toEqual({
			type: 'queryRelationshipsResponse',
			requestId: 'r0',
			target: 'product__v',
			relationships: [rel],
		});
	});

	it('degrades a failed relationships fetch to an empty array', async () => {
		const metadata = makeMetadata({ getRelationships: vi.fn().mockRejectedValue(new Error('fail')) });

		const response = await handleMetadataRequest(
			{ type: 'queryRelationshipsRequest', requestId: 'r1', target: 'product__v' },
			metadata,
		);

		expect(response).toMatchObject({ type: 'queryRelationshipsResponse', relationships: [] });
	});
});

describe('handleMetadataRequest — picklist fields', () => {
	it('passes the target and echoes it in the response', async () => {
		const metadata = makeMetadata({
			getPicklistFields: vi.fn().mockResolvedValue({ status__v: 'document_status__v' }),
		});

		const response = await handleMetadataRequest(
			{ type: 'queryPicklistFieldsRequest', requestId: 'p0', target: 'product__v' },
			metadata,
		);

		expect(metadata.getPicklistFields).toHaveBeenCalledWith('product__v');
		expect(response).toEqual({
			type: 'queryPicklistFieldsResponse',
			requestId: 'p0',
			target: 'product__v',
			picklistFields: { status__v: 'document_status__v' },
		});
	});

	it('degrades a failed picklist-fields fetch to an empty map', async () => {
		const metadata = makeMetadata({ getPicklistFields: vi.fn().mockRejectedValue(new Error('fail')) });

		const response = await handleMetadataRequest(
			{ type: 'queryPicklistFieldsRequest', requestId: 'p1', target: 'product__v' },
			metadata,
		);

		expect(response).toEqual({
			type: 'queryPicklistFieldsResponse',
			requestId: 'p1',
			target: 'product__v',
			picklistFields: {},
		});
	});
});

describe('handleMetadataRequest — picklist values', () => {
	it('passes the picklist name and echoes it in the response', async () => {
		const metadata = makeMetadata({
			getPicklistValues: vi.fn().mockResolvedValue([{ name: 'active__c', label: 'Active' }]),
		});

		const response = await handleMetadataRequest(
			{ type: 'queryPicklistValuesRequest', requestId: 'v0', picklist: 'status__v' },
			metadata,
		);

		expect(metadata.getPicklistValues).toHaveBeenCalledWith('status__v');
		expect(response).toEqual({
			type: 'queryPicklistValuesResponse',
			requestId: 'v0',
			picklist: 'status__v',
			values: [{ name: 'active__c', label: 'Active' }],
		});
	});

	it('degrades a failed picklist-values fetch to an empty array', async () => {
		const metadata = makeMetadata({ getPicklistValues: vi.fn().mockRejectedValue(new Error('fail')) });

		const response = await handleMetadataRequest(
			{ type: 'queryPicklistValuesRequest', requestId: 'v1', picklist: 'status__v' },
			metadata,
		);

		expect(response).toMatchObject({ type: 'queryPicklistValuesResponse', values: [] });
	});
});
