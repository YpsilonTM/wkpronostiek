import { building } from '$app/environment';
import type { Handle, ServerInit } from '@sveltejs/kit';
import { ensureDataDir } from '$lib/server/config';
import { startScheduler } from '$lib/server/scheduler';
import { runPredictUpcoming } from '$lib/server/jobs';
import { pinoLogger } from '$lib/server/logger';

export const init: ServerInit = async () => {
	if (building) return;
	await ensureDataDir();
	startScheduler();
	runPredictUpcoming().catch(console.error);
	pinoLogger.info(`🚀 Server gestart op poort ${process.env.PORT || 3000}`);
};

const legacyRewrites: Record<string, string> = {
	'/matches/upcoming': '/api/matches/upcoming',
	'/stats/accuracy': '/api/stats/accuracy',
	'/logs': '/api/logs'
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
