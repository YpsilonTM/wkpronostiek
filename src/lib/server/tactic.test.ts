import { describe, expect, it } from 'vitest';
import type { Match } from '$lib/types/match';
import type { GroupStandings } from '$lib/types/standings';
import type { TacticConfig } from '$lib/types/tactic';
import { buildMirrorPredictions, countRemainingMatches, decideTactic } from './tactic';

function baseMatch(overrides: Partial<Match> = {}): Match {
	return {
		matchId: 1,
		startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
		status: 'SCHEDULED',
		phaseName: 'Achtste finales',
		phaseType: 'knockout',
		matchday: null,
		homeTeam: 'A',
		awayTeam: 'B',
		homeTeamId: 1,
		awayTeamId: 2,
		homeScore: null,
		awayScore: null,
		...overrides,
	};
}

function baseConfig(overrides: Partial<TacticConfig> = {}): TacticConfig {
	return {
		mode: 'auto',
		groupName: 'Test',
		groupId: 'g1',
		mirrorRank: 2,
		leadThreshold: 0,
		remainingMatches: 8,
		knockoutOnly: false,
		autoFallback: 'ai_tactic',
		geminiContext: false,
		overwrite: true,
		standingsApiUrl: '',
		rivalPronosApiUrl: '',
		...overrides,
	};
}

const standings: GroupStandings = {
	groupId: 'g1',
	groupName: 'Test',
	members: [
		{ userId: 'me', name: 'Me', rank: 1, points: 120 },
		{ userId: 'rival', name: 'Rival', rank: 2, points: 115 },
		{ userId: 'third', name: 'Third', rank: 3, points: 100 },
	],
};

describe('decideTactic', () => {
	it('mirrors in auto mode when #1 with lead and few matches left', () => {
		const decision = decideTactic({
			config: baseConfig(),
			standings,
			allMatches: [baseMatch()],
			myUserId: 'me',
			matchesInBatch: [baseMatch()],
		});

		expect(decision.mode).toBe('mirror');
		expect(decision.rivalUserId).toBe('rival');
	});

	it('falls back when not rank 1', () => {
		const behind = {
			...standings,
			members: [
				{ userId: 'rival', name: 'Rival', rank: 1, points: 120 },
				{ userId: 'me', name: 'Me', rank: 2, points: 115 },
			],
		};

		const decision = decideTactic({
			config: baseConfig(),
			standings: behind,
			allMatches: [baseMatch()],
			myUserId: 'me',
			matchesInBatch: [baseMatch()],
		});

		expect(decision.mode).toBe('ai_tactic');
	});

	it('uses ai_tactic when configured', () => {
		const decision = decideTactic({
			config: baseConfig({ mode: 'ai_tactic' }),
			standings,
			allMatches: [baseMatch()],
			myUserId: 'me',
			matchesInBatch: [baseMatch()],
		});

		expect(decision.mode).toBe('ai_tactic');
	});
});

describe('buildMirrorPredictions', () => {
	it('copies rival scores', () => {
		const rivalPronos = new Map([
			[1, { matchId: 1, homeScore: 0, awayScore: 2, shootoutWinner: null }],
		]);

		const predictions = buildMirrorPredictions(
			[{ ...baseMatch(), currentHomeScore: null, currentAwayScore: null }],
			rivalPronos,
			'Rival',
		);

		expect(predictions).toHaveLength(1);
		expect(predictions[0].homeScore).toBe(0);
		expect(predictions[0].awayScore).toBe(2);
		expect(predictions[0].tactic).toBe('mirror');
	});
});

describe('countRemainingMatches', () => {
	it('ignores finished matches', () => {
		const count = countRemainingMatches([
			baseMatch({ status: 'END' }),
			baseMatch({ matchId: 2, startTime: new Date(Date.now() + 3600_000).toISOString() }),
		]);
		expect(count).toBe(1);
	});
});
