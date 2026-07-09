import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/api-response';
import {
	getCacheTime,
	getUpcomingMatchesCache,
	setUpcomingMatchesCache,
} from '$lib/server/app-state';
import { getSettings, MATCHES_CACHE_TTL_MS } from '$lib/server/config';
import {
	attachCurrentPronos,
	enrichMatchForUi,
	getUpcomingMatches,
} from '$lib/server/match-enrichment';
import { getLatestStoredPredictionsByMatchId } from '$lib/server/prediction-log';
import { PronotoolApiClient } from '$lib/server/pronotool-api';
import { fetchUserPronosByMatchId } from '$lib/server/services/pronotool-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		let cache = getUpcomingMatchesCache();
		const time = getCacheTime();

		if (!cache || Date.now() - time > MATCHES_CACHE_TTL_MS) {
			const settings = getSettings();
			const api = new PronotoolApiClient(settings);
			const allMatches = await api.fetchMatches();
			const upcoming = getUpcomingMatches(allMatches);
			const userPronosByMatchId = await fetchUserPronosByMatchId(settings, api);

			cache = attachCurrentPronos(upcoming, userPronosByMatchId);
			setUpcomingMatchesCache(cache);
		}

		const storedPredictions = await getLatestStoredPredictionsByMatchId();

		const enriched = cache.map((match) => {
			const ui = enrichMatchForUi(match);
			const stored = storedPredictions.get(match.matchId);
			if (!stored) {
				return ui;
			}

			const isMirror = stored.model === 'mirror';
			const mirrorNameMatch = stored.reasoning.match(/gekopieerd van (.+)$/i);

			return {
				...ui,
				reasoning: stored.reasoning,
				searchAnalysis: stored.searchAnalysis,
				tactic: isMirror ? 'mirror' : stored.model ? 'ai' : null,
				tacticLabel: isMirror
					? mirrorNameMatch
						? `Spiegelt ${mirrorNameMatch[1]}`
						: 'Spiegelt rival'
					: null,
			};
		});
		return json(enriched);
	} catch (err) {
		return jsonError(err instanceof Error ? err.message : String(err));
	}
};
