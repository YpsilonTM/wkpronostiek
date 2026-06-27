import type { Match, MatchWithProno } from '$lib/types/match';
import { predictedMatchIds } from './app-state';
import { AUTO_PREDICT_WINDOW_MS } from './config';

export function areTeamsConfirmed(match: Pick<Match, 'homeTeamId' | 'awayTeamId'>): boolean {
	return (match.homeTeamId ?? 0) > 0 && (match.awayTeamId ?? 0) > 0;
}

export function isKnockoutMatch(match: Pick<Match, 'phaseType' | 'phaseName'>): boolean {
	if (match.phaseType === 'knockout') {
		return true;
	}

	const phase = String(match.phaseName || '').toLowerCase();
	return /finale|achtste|1\/16|1\/8|kwart|half|semi|quarter|round of 16|knockout/.test(phase);
}

export function attachCurrentPronos(
	matches: MatchWithProno[],
	userPronosByMatchId: Map<number, { homeScore: number; awayScore: number }>
): MatchWithProno[] {
	return matches.map((match) => {
		const current = userPronosByMatchId.get(Number(match.matchId));
		return {
			...match,
			currentHomeScore: current ? current.homeScore : null,
			currentAwayScore: current ? current.awayScore : null
		};
	});
}

export function enrichMatchForUi(match: MatchWithProno) {
	const startTime = new Date(match.startTime);
	const msUntil = startTime.getTime() - Date.now();
	const minutesUntilStart = Math.max(0, Math.floor(msUntil / 60_000));
	const hasProno =
		Number.isInteger(match.currentHomeScore) && Number.isInteger(match.currentAwayScore);
	const sessionPredicted = predictedMatchIds.has(Number(match.matchId));
	const submitted = hasProno || sessionPredicted;
	const inAutoWindow = msUntil > 0 && msUntil <= AUTO_PREDICT_WINDOW_MS;

	return {
		...match,
		minutesUntilStart,
		submitted,
		autoPredictScheduled: inAutoWindow && !submitted,
		autoPredictAt: new Date(startTime.getTime() - AUTO_PREDICT_WINDOW_MS).toISOString(),
		teamsConfirmed: areTeamsConfirmed(match)
	};
}

export function getUpcomingMatches<T extends { startTime: string }>(allMatches: T[]): T[] {
	const now = new Date();
	return allMatches
		.filter((m) => new Date(m.startTime) > now)
		.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}
