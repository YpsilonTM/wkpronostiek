import type { TacticUiSettings } from '$lib/types/tactic-settings';
import { TACTIC_UI_MODES } from '$lib/types/tactic-settings';
import type { TacticAutoFallback, TacticConfig, TacticMode } from '$lib/types/tactic';
import { prisma } from '../db';

const TACTIC_SETTINGS_KEY = 'tactic';

let cachedUiSettings: TacticUiSettings | null = null;

function parseTacticMode(value: string | undefined): TacticMode {
	const mode = (value || 'ai').toLowerCase();
	if (mode === 'ai_tactic' || mode === 'mirror' || mode === 'auto') {
		return mode;
	}
	return 'ai';
}

function parseAutoFallback(value: string | undefined): TacticAutoFallback {
	return (value || 'ai_tactic').toLowerCase() === 'ai' ? 'ai' : 'ai_tactic';
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
	if (value === undefined || value === '') {
		return defaultValue;
	}
	return value.toLowerCase() === 'true';
}

function parseIntEnv(value: string | undefined, defaultValue: number): number {
	const parsed = Number.parseInt(value || '', 10);
	return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function getDefaultTacticUiSettings(): TacticUiSettings {
	return {
		enabled: false,
		mode: 'auto',
		groupName: '',
		groupId: '',
		groupCode: '',
	};
}

function tacticUiSettingsFromEnv(): TacticUiSettings | null {
	const envMode = process.env.TACTIC_MODE?.trim();
	const envGroup =
		process.env.TACTIC_GROUP_NAME?.trim() ||
		process.env.TACTIC_GROUP_ID?.trim() ||
		process.env.TACTIC_GROUP_CODE?.trim();
	const envGeminiContext = parseBool(process.env.TACTIC_GEMINI_CONTEXT, false);

	if (!envMode && !envGroup && !envGeminiContext) {
		return null;
	}

	const parsedMode = parseTacticMode(envMode);
	const enabled = parsedMode !== 'ai' || envGeminiContext;

	return {
		enabled,
		mode: enabled && parsedMode !== 'ai' ? parsedMode : 'auto',
		groupName: process.env.TACTIC_GROUP_NAME?.trim() || '',
		groupId: process.env.TACTIC_GROUP_ID?.trim() || '',
		groupCode: process.env.TACTIC_GROUP_CODE?.trim() || '',
	};
}

function normalizeUiMode(mode: string): TacticMode {
	const parsed = parseTacticMode(mode);
	if (parsed === 'ai') {
		return 'auto';
	}
	return parsed;
}

function parseStoredSettings(value: string): TacticUiSettings {
	try {
		const parsed = JSON.parse(value) as Partial<TacticUiSettings>;
		return {
			enabled: Boolean(parsed.enabled),
			mode: normalizeUiMode(String(parsed.mode ?? 'auto')),
			groupName: String(parsed.groupName ?? '').trim(),
			groupId: String(parsed.groupId ?? '').trim(),
			groupCode: String(parsed.groupCode ?? '').trim(),
		};
	} catch {
		return getDefaultTacticUiSettings();
	}
}

async function migrateLegacyFlatSettings(): Promise<TacticUiSettings | null> {
	const rows = await prisma.appSetting.findMany({
		where: {
			key: {
				in: [
					'tacticEnabled',
					'tacticMode',
					'tacticGroupName',
					'tacticGroupId',
					'tacticGroupCode',
				],
			},
		},
	});

	if (rows.length === 0) {
		return null;
	}

	const byKey = new Map(rows.map((row) => [row.key, row.value]));
	const settings: TacticUiSettings = {
		enabled: byKey.get('tacticEnabled') === 'true',
		mode: normalizeUiMode(byKey.get('tacticMode') ?? 'auto'),
		groupName: (byKey.get('tacticGroupName') ?? '').trim(),
		groupId: (byKey.get('tacticGroupId') ?? '').trim(),
		groupCode: (byKey.get('tacticGroupCode') ?? '').trim(),
	};

	await prisma.appSetting.upsert({
		where: { key: TACTIC_SETTINGS_KEY },
		create: { key: TACTIC_SETTINGS_KEY, value: JSON.stringify(settings) },
		update: { value: JSON.stringify(settings) },
	});

	await prisma.appSetting.deleteMany({
		where: {
			key: {
				in: [
					'tacticEnabled',
					'tacticMode',
					'tacticGroupName',
					'tacticGroupId',
					'tacticGroupCode',
				],
			},
		},
	});

	return settings;
}

export function getTacticUiSettingsSync(): TacticUiSettings {
	return cachedUiSettings ?? getDefaultTacticUiSettings();
}

export function isTacticEnabled(ui: TacticUiSettings = getTacticUiSettingsSync()): boolean {
	return ui.enabled;
}

export function buildTacticConfig(ui: TacticUiSettings = getTacticUiSettingsSync()): TacticConfig {
	const advancedDefaults = {
		mirrorRank: parseIntEnv(process.env.TACTIC_MIRROR_RANK, 2),
		leadThreshold: parseIntEnv(process.env.TACTIC_LEAD_THRESHOLD, 0),
		cautionLead: parseIntEnv(process.env.TACTIC_CAUTION_LEAD, 40),
		criticalLead: parseIntEnv(process.env.TACTIC_CRITICAL_LEAD, 20),
		remainingMatches: parseIntEnv(process.env.TACTIC_REMAINING_MATCHES, 8),
		knockoutOnly: parseBool(process.env.TACTIC_KNOCKOUT_ONLY, false),
		autoFallback: parseAutoFallback(process.env.TACTIC_AUTO_FALLBACK),
		overwrite: parseBool(process.env.TACTIC_OVERWRITE, true),
		standingsApiUrl:
			process.env.TACTIC_STANDINGS_API_URL ||
			'https://api.sporza.be/pronotool/1/groups/{groupId}/standings',
		rivalPronosApiUrl:
			process.env.TACTIC_RIVAL_PRONOS_API_URL ||
			'https://api.sporza.be/pronotool/1/users/{userId}/pronos?groupId={groupId}',
	};

	if (!ui.enabled) {
		return {
			mode: 'ai',
			groupName: '',
			groupId: '',
			groupCode: '',
			geminiContext: false,
			...advancedDefaults,
		};
	}

	return {
		mode: ui.mode,
		groupName: ui.groupName,
		groupId: ui.groupId,
		groupCode: ui.groupCode,
		geminiContext: false,
		...advancedDefaults,
	};
}

export async function initAppSettings(): Promise<TacticUiSettings> {
	const existing = await prisma.appSetting.findUnique({ where: { key: TACTIC_SETTINGS_KEY } });
	if (existing) {
		cachedUiSettings = parseStoredSettings(existing.value);
		return cachedUiSettings;
	}

	const migrated = await migrateLegacyFlatSettings();
	if (migrated) {
		cachedUiSettings = migrated;
		return migrated;
	}

	const seeded = tacticUiSettingsFromEnv() ?? getDefaultTacticUiSettings();
	await prisma.appSetting.create({
		data: {
			key: TACTIC_SETTINGS_KEY,
			value: JSON.stringify(seeded),
		},
	});
	cachedUiSettings = seeded;
	return cachedUiSettings;
}

export async function getTacticUiSettings(): Promise<TacticUiSettings> {
	if (!cachedUiSettings) {
		return initAppSettings();
	}
	return cachedUiSettings;
}

export function validateTacticUiSettings(input: unknown): TacticUiSettings {
	if (!input || typeof input !== 'object') {
		throw new Error('Ongeldige tactiek-instellingen.');
	}

	const record = input as Record<string, unknown>;
	const enabled = Boolean(record.enabled);
	const mode = normalizeUiMode(String(record.mode ?? 'auto'));

	if (enabled && !TACTIC_UI_MODES.includes(mode as (typeof TACTIC_UI_MODES)[number])) {
		throw new Error('Ongeldige tactiekmodus.');
	}

	const groupName = String(record.groupName ?? '').trim();
	const groupId = String(record.groupId ?? '').trim();
	const groupCode = String(record.groupCode ?? '').trim();

	if (enabled && !groupName && !groupId && !groupCode) {
		throw new Error('Kies een minicompetitie om eindfase-tactiek in te schakelen.');
	}

	return {
		enabled,
		mode: enabled ? mode : 'auto',
		groupName,
		groupId,
		groupCode,
	};
}

export async function saveTacticUiSettings(settings: TacticUiSettings): Promise<TacticUiSettings> {
	const saved = await prisma.appSetting.upsert({
		where: { key: TACTIC_SETTINGS_KEY },
		create: {
			key: TACTIC_SETTINGS_KEY,
			value: JSON.stringify(settings),
		},
		update: {
			value: JSON.stringify(settings),
		},
	});

	cachedUiSettings = parseStoredSettings(saved.value);
	return cachedUiSettings;
}
