import { describe, it, expect } from 'vitest';
import { AuthType } from '../../core/models/environment';
import type { EnvironmentFormSubmit } from '../../shared/environmentsProtocol';
import { mapFormSubmit } from './environmentForm';

const ADD: EnvironmentFormSubmit = {
	mode: 'add',
	vaultDNS: 'MyCo.veevavault.com',
	username: 'admin',
	authType: AuthType.Basic,
	secret: 'hunter2',
};

describe('mapFormSubmit', () => {
	it('seeds the label from the normalized DNS when adding with no custom label', () => {
		const { input, secret } = mapFormSubmit(ADD, undefined);

		expect(input).toEqual({
			label: 'myco.veevavault.com',
			hasCustomLabel: false,
			vaultDNS: 'MyCo.veevavault.com',
			username: 'admin',
			authType: AuthType.Basic,
		});
		expect(secret).toBe('hunter2');
	});

	it('uses a custom label and marks it sticky when the label field is filled', () => {
		const { input } = mapFormSubmit({ ...ADD, label: 'Ryan\'s Sandbox' }, undefined);

		expect(input.label).toBe('Ryan\'s Sandbox');
		expect(input.hasCustomLabel).toBe(true);
	});

	it('trims whitespace from a custom label', () => {
		const { input } = mapFormSubmit({ ...ADD, label: '  My Vault  ' }, undefined);

		expect(input.label).toBe('My Vault');
		expect(input.hasCustomLabel).toBe(true);
	});

	it('treats a whitespace-only label as absent (falls back to DNS)', () => {
		const { input } = mapFormSubmit({ ...ADD, label: '   ' }, undefined);

		expect(input.label).toBe('myco.veevavault.com');
		expect(input.hasCustomLabel).toBe(false);
	});

	it('treats an explicit undefined label the same as an absent label (falls back to DNS)', () => {
		const { input } = mapFormSubmit({ ...ADD, label: undefined }, undefined);

		expect(input.label).toBe('myco.veevavault.com');
		expect(input.hasCustomLabel).toBe(false);
	});

	it('preserves the vault-adopted label when editing with no custom label provided', () => {
		const edit: EnvironmentFormSubmit = { ...ADD, mode: 'edit', id: 'e1', secret: 'new-secret' };

		const { input, secret } = mapFormSubmit(edit, 'Production');

		expect(input.label).toBe('Production');
		expect(input.hasCustomLabel).toBe(false);
		expect(secret).toBe('new-secret');
	});

	it('uses a custom label over the vault-adopted label when editing', () => {
		const edit: EnvironmentFormSubmit = {
			...ADD,
			mode: 'edit',
			id: 'e1',
			label: 'My Custom Name',
			secret: '',
		};

		const { input } = mapFormSubmit(edit, 'Production');

		expect(input.label).toBe('My Custom Name');
		expect(input.hasCustomLabel).toBe(true);
	});

	it('reverts to DNS when editing with blank label and no existing label (DNS placeholder was never replaced)', () => {
		// The caller (environmentActions) passes undefined when label === vaultDNS, meaning the
		// environment was never connected and the Vault's own name was never adopted.
		const edit: EnvironmentFormSubmit = {
			...ADD,
			mode: 'edit',
			id: 'e1',
			vaultDNS: 'NewCo.veevavault.com',
			secret: '',
		};

		const { input } = mapFormSubmit(edit, undefined);

		expect(input.label).toBe('newco.veevavault.com');
		expect(input.hasCustomLabel).toBe(false);
	});

	it('treats a blank secret on edit as keep-existing', () => {
		const edit: EnvironmentFormSubmit = { ...ADD, mode: 'edit', id: 'e1', secret: '' };

		expect(mapFormSubmit(edit, 'Production').secret).toBeUndefined();
	});
});
