import { describe, expect, it } from 'vitest';
import type { GroupStandings } from '$lib/types/standings';
import type { TacticConfig } from '$lib/types/tactic';
import { analyzeMirrorSafety, filterCatchableChasers, maxCatchUpPoints } from './tactic-safety';

function baseConfig(overrides: Partial<TacticConfig> = {}): TacticConfig {
	return {
		mode: 'auto',
		groupName: 'Test',
		groupId: 'g1',
		groupCode: '',
		mirrorRank: 2,
		leadThreshold: 0,
		cautionLead: 40,
		criticalLead: 20,
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
	groupCode: 'TEST',
	complete: true,
	source: 'overview-embedded',
	members: [
		{ userId: 'me', name: 'Me', rank: 1, points: 120 },
		{ userId: 'rival', name: 'Rival', rank: 2, points: 115 },
		{ userId: 'third', name: 'Third', rank: 3, points: 100 },
	],
};

describe('maxCatchUpPoints', () => {
	it('is 20 points per remaining match', () => {
		expect(maxCatchUpPoints(3)).toBe(60);
	});
});

describe('filterCatchableChasers', () => {
	const chasers = [
		{ rank: 2, userId: 'b', name: 'B', leadPoints: 15 },
		{ rank: 3, userId: 'c', name: 'C', leadPoints: 45 },
		{ rank: 4, userId: 'd', name: 'D', leadPoints: 80 },
	];

	it('keeps only chasers within max catch-up range', () => {
		expect(filterCatchableChasers(chasers, 40)).toEqual([
			{ rank: 2, userId: 'b', name: 'B', leadPoints: 15 },
		]);
	});

	it('includes chaser exactly at the catch-up limit', () => {
		expect(filterCatchableChasers(chasers, 45)).toEqual([
			{ rank: 2, userId: 'b', name: 'B', leadPoints: 15 },
			{ rank: 3, userId: 'c', name: 'C', leadPoints: 45 },
		]);
	});
});

describe('analyzeMirrorSafety', () => {
	const me = standings.members[0];

	it('blocks mirror when #3 is within caution lead', () => {
		const tight = {
			...standings,
			members: [
				me,
				{ userId: 'rival', name: 'Rival', rank: 2, points: 115 },
				{ userId: 'third', name: 'Third', rank: 3, points: 101 },
			],
		};

		const safety = analyzeMirrorSafety(me, tight, 1, baseConfig(), 5);
		expect(safety.canMirror).toBe(false);
		expect(safety.dangerLevel).toBe('critical');
	});

	it('blocks mirror when #3 can mathematically catch up', () => {
		const catchable = {
			...standings,
			members: [
				me,
				{ userId: 'rival', name: 'Rival', rank: 2, points: 115 },
				{ userId: 'third', name: 'Third', rank: 3, points: 80 },
			],
		};

		const safety = analyzeMirrorSafety(me, catchable, 3, baseConfig(), 5);
		expect(safety.canMirror).toBe(false);
		expect(safety.blockReason).toContain('#3 kan nog inhalen');
	});

	it('allows mirror when comfortably ahead of all chasers', () => {
		const safe = {
			...standings,
			members: [
				me,
				{ userId: 'rival', name: 'Rival', rank: 2, points: 115 },
				{ userId: 'third', name: 'Third', rank: 3, points: 70 },
			],
		};

		const safety = analyzeMirrorSafety(me, safe, 1, baseConfig(), 5);
		expect(safety.canMirror).toBe(true);
		expect(safety.dangerLevel).toBe('safe');
	});
});
