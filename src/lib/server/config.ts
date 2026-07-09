import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { resolveDatabaseUrl } from '$lib/database-url';
import type { Settings } from '$lib/types/settings';
import { buildTacticConfig, getTacticUiSettingsSync } from './services/app-settings-service';

dotenv.config();

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
		tactic: buildTacticConfig(getTacticUiSettingsSync()),
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

export {
	AUTO_PREDICT_WINDOW_MS,
	MATCHES_CACHE_TTL_MS,
	MIRROR_FINAL_CHECK_MS,
} from '$lib/constants';
