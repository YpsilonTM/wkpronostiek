import type { Handle, ServerInit } from '@sveltejs/kit';
import { building } from '$app/environment';
import { ensureDataDir } from '$lib/server/config';
import { pinoLogger } from '$lib/server/logger';
import { importLegacyDataIfNeeded, runDatabaseMigrations } from '$lib/server/migrate';
import { startScheduler } from '$lib/server/scheduler';
import { runPredictUpcoming } from '$lib/server/services/prediction-service';

export const init: ServerInit = async () => {
	if (building) return;
	await ensureDataDir();
	await runDatabaseMigrations();
	await importLegacyDataIfNeeded();
	startScheduler();

	if (!process.env.GEMINI_API_KEY?.trim()) {
		pinoLogger.warn('GEMINI_API_KEY ontbreekt — voorspellingen zullen mislukken');
	}

	runPredictUpcoming().catch(console.error);
	pinoLogger.info(`🚀 Server gestart op poort ${process.env.PORT || 3000}`);
};

/** Legacy URL rewrites for clients that omit the /api prefix. */
const legacyRewrites: Record<string, string> = {
	'/matches/upcoming': '/api/matches/upcoming',
	'/stats/accuracy': '/api/stats/accuracy',
	'/logs': '/api/logs',
};

export const handle: Handle = async ({ event, resolve }) => {
	const rewrite = legacyRewrites[event.url.pathname];
	if (rewrite) {
		event.url.pathname = rewrite;
	}

	if (event.url.pathname.startsWith('/run/predict-match/')) {
		const id = event.url.pathname.split('/').pop();
		event.url.pathname = `/api/run/predict-match/${id}`;
	} else if (event.url.pathname === '/run/auth-refresh') {
		event.url.pathname = '/api/run/auth-refresh';
	}

	return resolve(event);
};
