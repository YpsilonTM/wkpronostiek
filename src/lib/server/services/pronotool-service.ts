import type { Match } from '$lib/types/match';
import type { Settings } from '$lib/types/settings';
import { resolveApiAuthorization } from '../auth';
import { getSettings, MATCHES_CACHE_TTL_MS } from '../config';
import { PronotoolApiClient } from '../pronotool-api';

let _matchesCache: Match[] | null = null;
let _matchesCacheTime = 0;

export async function fetchMatchesCached(settings?: Settings): Promise<Match[]> {
	const resolvedSettings = settings ?? getSettings();
	const now = Date.now();

	if (_matchesCache && now - _matchesCacheTime <= MATCHES_CACHE_TTL_MS) {
		return _matchesCache;
	}

	const api = new PronotoolApiClient(resolvedSettings);
	const matches = await api.fetchMatches();
	_matchesCache = matches;
	_matchesCacheTime = now;
	return matches;
}

export function invalidateMatchesCache(): void {
	_matchesCache = null;
	_matchesCacheTime = 0;
}

export async function fetchUserPronosByMatchId(
	settings: Settings,
	api: PronotoolApiClient,
): Promise<Map<number, { homeScore: number; awayScore: number }>> {
	try {
		const authorization = await resolveApiAuthorization(settings);
		const overview = await api.fetchUserOverview(authorization);
		const byMatchId = new Map<number, { homeScore: number; awayScore: number }>();

		for (const prono of overview.pronos || []) {
			const matchId = prono.matchId;
			if (!Number.isInteger(matchId)) continue;
			if (
				prono.homeScore !== undefined &&
				prono.awayScore !== undefined &&
				prono.homeScore !== null &&
				prono.awayScore !== null
			) {
				byMatchId.set(matchId, {
					homeScore: Number(prono.homeScore),
					awayScore: Number(prono.awayScore),
				});
			}
		}

		return byMatchId;
	} catch {
		return new Map();
	}
}

export async function findUpcomingMatchById(
	matchId: number,
	settings?: Settings,
): Promise<Match | null> {
	const allMatches = await fetchMatchesCached(settings);
	const match = allMatches.find((m) => m.matchId === matchId);
	if (!match || new Date(match.startTime) <= new Date()) {
		return null;
	}
	return match;
}
