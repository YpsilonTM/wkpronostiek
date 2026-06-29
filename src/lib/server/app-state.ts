import type { MatchWithProno } from '$lib/types/match';

export const predictedMatchIds = new Set<number>();

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
let _activeJobs = 0;
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

export function incrementActiveJobs(): void {
	_activeJobs += 1;
}

export function decrementActiveJobs(): void {
	_activeJobs -= 1;
}
