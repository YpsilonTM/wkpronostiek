import { json } from '@sveltejs/kit';
import { assertAdminAuthorized } from '$lib/server/admin-auth';
import { jsonError } from '$lib/server/api-response';
import {
	getUpcomingMatchesCache,
	invalidateUpcomingMatchesCache,
	isPredictionInFlight,
} from '$lib/server/app-state';
import { getSettings } from '$lib/server/config';
import { attachCurrentPronos } from '$lib/server/match-enrichment';
import { PronotoolApiClient } from '$lib/server/pronotool-api';
import { runPredictSingle } from '$lib/server/services/prediction-service';
import {
	fetchUserPronosByMatchId,
	findUpcomingMatchById,
} from '$lib/server/services/pronotool-service';
import type { MatchWithProno } from '$lib/types/match';
import type { RequestHandler } from './$types';

async function resolveMatchForPrediction(matchId: number): Promise<MatchWithProno | null> {
	const cache = getUpcomingMatchesCache();
	const cached = cache?.find((m) => m.matchId === matchId);
	if (cached) {
		if (new Date(cached.startTime) <= new Date()) {
			invalidateUpcomingMatchesCache();
			return null;
		}
		return cached;
	}

	const settings = getSettings();
	const rawMatch = await findUpcomingMatchById(matchId, settings);
	if (!rawMatch) {
		return null;
	}

	const api = new PronotoolApiClient(settings);
	const userPronosByMatchId = await fetchUserPronosByMatchId(settings, api);
	const [match] = attachCurrentPronos([rawMatch as MatchWithProno], userPronosByMatchId);
	return match;
}

export const POST: RequestHandler = async ({ params, request }) => {
	const denied = assertAdminAuthorized(request);
	if (denied) return denied;

	const matchId = Number(params.id);
	if (Number.isNaN(matchId)) {
		return jsonError('Ongeldige wedstrijd-id', 400);
	}

	const match = await resolveMatchForPrediction(matchId);
	if (!match) {
		return jsonError('Wedstrijd niet gevonden of niet meer aankomend', 404);
	}

	if (isPredictionInFlight(matchId)) {
		return json({ status: 'accepted', matchId, alreadyRunning: true }, { status: 202 });
	}

	void runPredictSingle(match);

	return json({ status: 'accepted', matchId }, { status: 202 });
};
