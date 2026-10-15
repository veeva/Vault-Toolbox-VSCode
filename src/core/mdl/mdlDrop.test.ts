import { describe, it, expect } from 'vitest';
import { buildMdlDropStatement } from './mdlDrop';

describe('buildMdlDropStatement', () => {
	it('drops an object component read from a RECREATE header', () => {
		const parse = buildMdlDropStatement('RECREATE Object custom__c (\n  active(true)\n);');

		expect(parse).toEqual({
			ok: true,
			target: {
				componentType: 'Object',
				componentName: 'custom__c',
				statement: 'DROP Object custom__c;',
			},
		});
	});

	it('keeps a dotted Atomic Security name intact', () => {
		const name = 'trained_model__sys.trained_model_lifecycle__sys.archived_state__sys.atomic_security__sys';
		const parse = buildMdlDropStatement(`RECREATE Atomicsecurity ${name} ();`);

		expect(parse).toEqual({
			ok: true,
			target: {
				componentType: 'Atomicsecurity',
				componentName: name,
				statement: `DROP Atomicsecurity ${name};`,
			},
		});
	});

	it('reads the name even when the definition opens with no space before the paren', () => {
		const parse = buildMdlDropStatement('CREATE Picklist color__c(\n);');

		expect(parse).toMatchObject({ ok: true, target: { statement: 'DROP Picklist color__c;' } });
	});

	it('tolerates leading whitespace before the header', () => {
		const parse = buildMdlDropStatement('\n\n  ALTER Docfield name__v ADD field ();');

		expect(parse).toMatchObject({ ok: true, target: { statement: 'DROP Docfield name__v;' } });
	});

	it('fails on an empty body', () => {
		const parse = buildMdlDropStatement('   \n  ');

		expect(parse.ok).toBe(false);
	});

	it('fails when the body does not start with a component definition', () => {
		const parse = buildMdlDropStatement('# just a comment, no statement');

		expect(parse.ok).toBe(false);
	});
});
