import { describe, expect, it } from 'vitest';
import { AUTO_PREDICT_WINDOW_MS, MIRROR_FINAL_CHECK_MS } from '$lib/constants';
import {
	attachCurrentPronos,
	enrichMatchForUi,
	getUpcomingMatches,
	isKnockoutMatch,
	isWithinAutoPredictWindow,
	isWithinMirrorFinalCheckWindow,
} from '$lib/server/match-enrichment';
import type { MatchWithProno } from '$lib/types/match';

function makeMatch(overrides: Partial<MatchWithProno> = {}): MatchWithProno {
	return {
		matchId: 1,
		startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
		status: 'scheduled',
		phaseName: 'Groep A',
		phaseType: 'group',
		matchday: null,
		homeTeam: 'België',
		awayTeam: 'Nederland',
		homeTeamId: 1,
		awayTeamId: 2,
		homeScore: null,
		awayScore: null,
		currentHomeScore: null,
		currentAwayScore: null,
		...overrides,
	};
}

describe('isWithinAutoPredictWindow', () => {
	it('returns true when kickoff is within the auto-predict window', () => {
		const startTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
		expect(isWithinAutoPredictWindow(startTime)).toBe(true);
	});

	it('returns false when kickoff is too far in the future', () => {
		const startTime = new Date(Date.now() + AUTO_PREDICT_WINDOW_MS + 60_000).toISOString();
		expect(isWithinAutoPredictWindow(startTime)).toBe(false);
	});

	it('returns false when kickoff is in the past', () => {
		const startTime = new Date(Date.now() - 60_000).toISOString();
		expect(isWithinAutoPredictWindow(startTime)).toBe(false);
	});
});

describe('isWithinMirrorFinalCheckWindow', () => {
	it('returns true when kickoff is within one minute', () => {
		const startTime = new Date(Date.now() + 30 * 1000).toISOString();
		expect(isWithinMirrorFinalCheckWindow(startTime)).toBe(true);
	});

	it('returns false when kickoff is more than one minute away', () => {
		const startTime = new Date(Date.now() + MIRROR_FINAL_CHECK_MS + 5_000).toISOString();
		expect(isWithinMirrorFinalCheckWindow(startTime)).toBe(false);
	});
});

describe('getUpcomingMatches', () => {
	it('filters past matches and sorts by start time', () => {
		const future1 = makeMatch({
			matchId: 1,
			startTime: new Date(Date.now() + 120 * 60 * 1000).toISOString(),
		});
		const future2 = makeMatch({
			matchId: 2,
			startTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
		});
		const past = makeMatch({
			matchId: 3,
			startTime: new Date(Date.now() - 60 * 1000).toISOString(),
		});

		expect(getUpcomingMatches([future1, past, future2]).map((m) => m.matchId)).toEqual([2, 1]);
	});
});

describe('attachCurrentPronos', () => {
	it('merges user pronos into matches', () => {
		const matches = [makeMatch({ matchId: 42 })];
		const pronos = new Map([[42, { homeScore: 2, awayScore: 1 }]]);

		const result = attachCurrentPronos(matches, pronos);
		expect(result[0].currentHomeScore).toBe(2);
		expect(result[0].currentAwayScore).toBe(1);
	});
});

describe('enrichMatchForUi', () => {
	it('marks submitted when current scores exist', () => {
		const enriched = enrichMatchForUi(makeMatch({ currentHomeScore: 1, currentAwayScore: 0 }));
		expect(enriched.submitted).toBe(true);
		expect(enriched.teamsConfirmed).toBe(true);
	});
});

describe('isKnockoutMatch', () => {
	it('detects knockout phase type', () => {
		expect(isKnockoutMatch({ phaseType: 'knockout', phaseName: 'Groep A' })).toBe(true);
		expect(isKnockoutMatch({ phaseType: 'group', phaseName: 'Groep A' })).toBe(false);
	});
});
