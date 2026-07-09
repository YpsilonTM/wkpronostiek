import { describe, expect, it } from 'vitest';
import type { MatchWithProno } from '$lib/types/match';
import type { TacticSnapshot } from '$lib/types/tactic';
import { autoPredictedTactics, markAutoPredicted } from '../app-state';
import { selectMirrorFinalRecheckMatches } from './prediction-service';

function makeMatch(matchId: number): MatchWithProno {
	return {
		matchId,
		startTime: new Date(Date.now() + 30_000).toISOString(),
		status: 'scheduled',
		phaseName: 'Groep A',
		phaseType: 'group',
		matchday: null,
		homeTeam: 'A',
		awayTeam: 'B',
		homeTeamId: 1,
		awayTeamId: 2,
		homeScore: null,
		awayScore: null,
		currentHomeScore: null,
		currentAwayScore: null,
	};
}

describe('selectMirrorFinalRecheckMatches', () => {
	const snapshot = {
		decision: { mode: 'mirror' as const, reason: 'test' },
		standings: null,
		rivalPronosByMatchId: new Map([
			[1, { matchId: 1, homeScore: 2, awayScore: 1, shootoutWinner: null }],
		]),
		myUserId: null,
	} satisfies TacticSnapshot;

	it('includes matches with rival prono that were never auto-predicted', () => {
		autoPredictedTactics.clear();
		const matches = selectMirrorFinalRecheckMatches([makeMatch(1)], snapshot, '1:2-1:x');
		expect(matches).toHaveLength(1);
	});

	it('re-includes mirror matches when rival fingerprint changed', () => {
		autoPredictedTactics.clear();
		markAutoPredicted(1, 'mirror', '1:1-0:x');
		const matches = selectMirrorFinalRecheckMatches([makeMatch(1)], snapshot, '1:2-1:x');
		expect(matches).toHaveLength(1);
	});

	it('skips mirror matches when rival fingerprint is unchanged', () => {
		autoPredictedTactics.clear();
		markAutoPredicted(1, 'mirror', '1:2-1:x');
		const matches = selectMirrorFinalRecheckMatches([makeMatch(1)], snapshot, '1:2-1:x');
		expect(matches).toHaveLength(0);
	});
});
