import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { resolveDatabaseUrl } from '$lib/database-url';
import type { Settings } from '$lib/types/settings';
import type { TacticAutoFallback, TacticMode } from '$lib/types/tactic';

dotenv.config();

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

export function getDataDir(): string {
	const dir = process.env.DATA_DIR || '';
	return dir ? path.resolve(dir) : process.cwd();
}

/** SQLite file URL; defaults to wkpronostiek.db inside getDataDir(). */
export function getDatabaseUrl(): string {
	return resolveDatabaseUrl({ dataDir: process.env.DATA_DIR, cwd: process.cwd() });
}

export function getDataPath(filename: string): string {
	return path.join(getDataDir(), filename);
}

export async function ensureDataDir(): Promise<void> {
	await fs.mkdir(getDataDir(), { recursive: true });
}

export function getSettings(): Settings {
	return {
		vrtEmail: process.env.VRT_EMAIL || '',
		vrtPassword: process.env.VRT_PASSWORD || '',
		pronotoolAuthorization: process.env.PRONOTOOL_AUTHORIZATION || '',
		headless: (process.env.HEADLESS || 'true').toLowerCase() !== 'false',
		vrtLoginUrl: 'https://wkpronostiek.sporza.be/login',
		vrtDashboardUrl: 'https://wkpronostiek.sporza.be/',
		sporzaSsoLoginUrl:
			'https://sporza.be/sso/login?scope=openid,mid&resumePage=https%3A%2F%2Fwkpronostiek.sporza.be%2Flogin',
		userOverviewApiUrl: 'https://api.sporza.be/pronotool/1/user-overview/overview',
		pronoApiUrl: 'https://api.sporza.be/pronotool/1/prono',
		matchesApiUrl: 'https://api.sporza.be/spapp/1/matchdays/soccer/competition/8',
		pronotoolAuthCacheFile: '.pronotool_auth.json',
		slowMoMs: 0,
		timezone: 'Europe/Brussels',
		tactic: {
			mode: parseTacticMode(process.env.TACTIC_MODE),
			groupName: process.env.TACTIC_GROUP_NAME || '',
			groupId: process.env.TACTIC_GROUP_ID || '',
			mirrorRank: parseIntEnv(process.env.TACTIC_MIRROR_RANK, 2),
			leadThreshold: parseIntEnv(process.env.TACTIC_LEAD_THRESHOLD, 0),
			remainingMatches: parseIntEnv(process.env.TACTIC_REMAINING_MATCHES, 8),
			knockoutOnly: parseBool(process.env.TACTIC_KNOCKOUT_ONLY, false),
			autoFallback: parseAutoFallback(process.env.TACTIC_AUTO_FALLBACK),
			geminiContext: parseBool(process.env.TACTIC_GEMINI_CONTEXT, false),
			overwrite: parseBool(process.env.TACTIC_OVERWRITE, true),
			standingsApiUrl:
				process.env.TACTIC_STANDINGS_API_URL ||
				'https://api.sporza.be/pronotool/1/groups/{groupId}/standings',
			rivalPronosApiUrl:
				process.env.TACTIC_RIVAL_PRONOS_API_URL ||
				'https://api.sporza.be/pronotool/1/users/{userId}/pronos?groupId={groupId}',
		},
	};
}

/** Legacy JSON auth file path — used only by one-time legacy import in migrate.ts. */
export function getAuthCachePath(settings: Settings): string {
	const file = settings.pronotoolAuthCacheFile || '.pronotool_auth.json';
	if (path.isAbsolute(file)) {
		return file;
	}
	return getDataPath(path.basename(file));
}

export { AUTO_PREDICT_WINDOW_MS, MATCHES_CACHE_TTL_MS } from '$lib/constants';
