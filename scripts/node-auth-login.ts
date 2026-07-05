import { captureAuthorizationWithPlaywright } from '../src/lib/server/auth-browser';
import type { Settings } from '../src/lib/types/settings';

function parseSettings(): Settings {
	const raw = process.env.WKP_SETTINGS_JSON || '';
	if (!raw) {
		throw new Error('WKP_SETTINGS_JSON is missing');
	}
	const parsed = JSON.parse(raw) as Settings;
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('Invalid WKP_SETTINGS_JSON payload');
	}
	return parsed;
}

async function run() {
	const settings = parseSettings();
	const authorization = await captureAuthorizationWithPlaywright(settings);
	process.stdout.write(authorization);
}

run().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(message);
	process.exit(1);
});
