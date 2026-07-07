import type { MatchWithProno } from '$lib/types/match';

/** Match IDs auto-predicted this session; manual predictions are not tracked here. */
export const autoPredictedMatchIds = new Set<number>();

/** Last submitted tactic per match (for overwrite detection). */
export const autoPredictedTactics = new Map<
	number,
	{ mode: 'ai' | 'ai_tactic' | 'mirror'; rivalFingerprint?: string }
>();

export function clearAutoPredictionTracking(matchId: number): void {
	autoPredictedMatchIds.delete(matchId);
	autoPredictedTactics.delete(matchId);
}

export function shouldSkipAutoPredict(
	matchId: number,
	overwrite: boolean,
	rivalFingerprint?: string,
): boolean {
	if (!autoPredictedMatchIds.has(matchId)) {
		return false;
	}
	if (!overwrite) {
		return true;
	}
	const prev = autoPredictedTactics.get(matchId);
	if (!prev) {
		return false;
	}
	if (rivalFingerprint && prev.rivalFingerprint !== rivalFingerprint) {
		return false;
	}
	return true;
}

export function markAutoPredicted(
	matchId: number,
	mode: 'ai' | 'ai_tactic' | 'mirror',
	rivalFingerprint?: string,
): void {
	autoPredictedMatchIds.add(matchId);
	autoPredictedTactics.set(matchId, { mode, rivalFingerprint });
}

let _upcomingMatchesCache: MatchWithProno[] | null = null;
let _cacheTime = 0;

export function getUpcomingMatchesCache(): MatchWithProno[] | null {
	return _upcomingMatchesCache;
}

export function getCacheTime(): number {
	return _cacheTime;
}

export function setUpcomingMatchesCache(cache: MatchWithProno[]): void {
	_upcomingMatchesCache = cache;
	_cacheTime = Date.now();
}

export function invalidateUpcomingMatchesCache(): void {
	_upcomingMatchesCache = null;
	_cacheTime = 0;
}

let _predictUpcomingRunning = false;
const _inFlightPredictions = new Set<number>();

export function isPredictionInFlight(matchId: number): boolean {
	return _inFlightPredictions.has(matchId);
}

export function markPredictionInFlight(matchId: number): void {
	_inFlightPredictions.add(matchId);
}

export function clearPredictionInFlight(matchId: number): void {
	_inFlightPredictions.delete(matchId);
}

export function getPredictUpcomingRunning(): boolean {
	return _predictUpcomingRunning;
}

export function setPredictUpcomingRunning(value: boolean): void {
	_predictUpcomingRunning = value;
}
