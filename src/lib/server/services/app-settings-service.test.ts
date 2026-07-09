import { describe, expect, it } from 'vitest';
import {
	buildTacticConfig,
	getDefaultTacticUiSettings,
	validateTacticUiSettings,
} from './app-settings-service';

describe('validateTacticUiSettings', () => {
	it('requires a group when enabled', () => {
		expect(() =>
			validateTacticUiSettings({
				enabled: true,
				mode: 'auto',
				groupName: '',
				groupId: '',
				groupCode: '',
			}),
		).toThrow(/minicompetitie/i);
	});

	it('accepts valid enabled settings', () => {
		expect(
			validateTacticUiSettings({
				enabled: true,
				mode: 'mirror',
				groupName: 'Acrylzuur',
				groupId: '',
				groupCode: 'pKJEJD0pYB',
			}),
		).toEqual({
			enabled: true,
			mode: 'mirror',
			groupName: 'Acrylzuur',
			groupId: '',
			groupCode: 'pKJEJD0pYB',
		});
	});
});

describe('buildTacticConfig', () => {
	it('returns plain ai config when disabled', () => {
		const config = buildTacticConfig(getDefaultTacticUiSettings());
		expect(config.mode).toBe('ai');
		expect(config.geminiContext).toBe(false);
		expect(config.groupName).toBe('');
	});

	it('maps enabled ui settings to tactic config', () => {
		const config = buildTacticConfig({
			enabled: true,
			mode: 'auto',
			groupName: 'Acrylzuur',
			groupId: 'g1',
			groupCode: 'CODE',
		});
		expect(config.mode).toBe('auto');
		expect(config.groupName).toBe('Acrylzuur');
		expect(config.groupCode).toBe('CODE');
	});
});
