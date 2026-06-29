import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSettings } from '$lib/server/config';
import { PronotoolApiClient } from '$lib/server/pronotool-api';
import { fetchUserPronosByMatchId } from '$lib/server/jobs';
import { getUpcomingMatches, enrichMatchForUi } from '$lib/server/match-enrichment';
import { getLatestStoredPredictionsByMatchId } from '$lib/server/prediction-log';
import { getUpcomingMatchesCache, getCacheTime, setUpcomingMatchesCache } from '$lib/server/app-state';
import type { MatchWithProno } from '$lib/types/match';

const CACHE_TTL_MS = 5 * 60 * 1000;

export const GET: RequestHandler = async () => {
	let cache = getUpcomingMatchesCache();
	const time = getCacheTime();

	if (!cache || Date.now() - time > CACHE_TTL_MS) {
		const settings = getSettings();
		const api = new PronotoolApiClient(settings);
		const allMatches = await api.fetchMatches();
		const upcoming = getUpcomingMatches(allMatches);
		const userPronosByMatchId = await fetchUserPronosByMatchId(settings, api);

		cache = upcoming.map((match) => {
			const current = userPronosByMatchId.get(Number(match.matchId));
			return {
				...match,
				currentHomeScore: current ? current.homeScore : null,
				currentAwayScore: current ? current.awayScore : null
			} satisfies MatchWithProno;
		});

		setUpcomingMatchesCache(cache);
	}

	const storedPredictions = await getLatestStoredPredictionsByMatchId();

	const enriched = cache.map((match) => {
		const ui = enrichMatchForUi(match);
		const stored = storedPredictions.get(Number(match.matchId));
		if (!stored) {
			return ui;
		}
		return {
			...ui,
			reasoning: stored.reasoning,
			searchAnalysis: stored.searchAnalysis
		};
	});
	return json(enriched);
};
