import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runPredictSingle } from '$lib/server/jobs';
import { getUpcomingMatchesCache, invalidateUpcomingMatchesCache } from '$lib/server/app-state';

export const POST: RequestHandler = async ({ params }) => {
	const matchId = Number(params.id);
	if (Number.isNaN(matchId)) {
		return new Response('Invalid matchId', { status: 400 });
	}

	const cache = getUpcomingMatchesCache();
	if (!cache) {
		return new Response('Match cache not ready, please refresh', { status: 409 });
	}

	const match = cache.find((m) => Number(m.matchId) === matchId);
	if (!match) {
		return new Response('Match not found or not upcoming', { status: 404 });
	}

	if (new Date(match.startTime) <= new Date()) {
		invalidateUpcomingMatchesCache();
		return new Response('Match has already started', { status: 409 });
	}

	const prediction = await runPredictSingle(match);

	if (!prediction) {
		return json({ error: 'Prediction failed' }, { status: 500 });
	}

	return json(prediction);
};
