import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runPredictSingle } from '$lib/server/jobs';
import {
	getUpcomingMatchesCache,
	invalidateUpcomingMatchesCache,
	isPredictionInFlight
} from '$lib/server/app-state';

export const POST: RequestHandler = async ({ params }) => {
	const matchId = Number(params.id);
	if (Number.isNaN(matchId)) {
		return json({ error: 'Ongeldige wedstrijd-id' }, { status: 400 });
	}

	const cache = getUpcomingMatchesCache();
	if (!cache) {
		return json({ error: 'Wedstrijden nog niet geladen, ververs de pagina' }, { status: 409 });
	}

	const match = cache.find((m) => Number(m.matchId) === matchId);
	if (!match) {
		return json({ error: 'Wedstrijd niet gevonden of niet meer aankomend' }, { status: 404 });
	}

	if (new Date(match.startTime) <= new Date()) {
		invalidateUpcomingMatchesCache();
		return json({ error: 'Wedstrijd is al begonnen' }, { status: 409 });
	}

	if (isPredictionInFlight(matchId)) {
		return json({ status: 'accepted', matchId, alreadyRunning: true }, { status: 202 });
	}

	void runPredictSingle(match);

	return json({ status: 'accepted', matchId }, { status: 202 });
};
