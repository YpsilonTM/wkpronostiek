import { describe, expect, it, vi } from 'vitest';
import type { GroupSummary } from '$lib/types/standings';
import type { TacticConfig } from '$lib/types/tactic';
import {
	fetchGroupStandingsForConfig,
	isStandingsUsableForMirror,
	resolveTargetGroup,
} from './standings';

vi.mock('./auth', () => ({
	resolveApiAuthorization: vi.fn().mockResolvedValue('Bearer test-token'),
}));

function baseTacticConfig(overrides: Partial<TacticConfig> = {}): TacticConfig {
	return {
		mode: 'auto',
		groupName: '',
		groupId: '',
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

const overviewGroups: GroupSummary[] = [
	{ id: 'g-fam', name: 'Familie', rank: 1, points: 120 },
	{ id: 'g-werk', name: 'Collega\'s', rank: 3, points: 90 },
];

describe('resolveTargetGroup', () => {
	it('matches group by exact name', () => {
		const group = resolveTargetGroup(overviewGroups, baseTacticConfig({ groupName: 'Familie' }));
		expect(group?.id).toBe('g-fam');
	});

	it('matches group by partial name', () => {
		const group = resolveTargetGroup(overviewGroups, baseTacticConfig({ groupName: 'collega' }));
		expect(group?.id).toBe('g-werk');
	});

	it('prefers explicit group id', () => {
		const group = resolveTargetGroup(
			overviewGroups,
			baseTacticConfig({ groupId: 'g-werk', groupName: 'Familie' }),
		);
		expect(group?.id).toBe('g-werk');
	});

	it('falls back to first group when no name configured', () => {
		const group = resolveTargetGroup(overviewGroups, baseTacticConfig());
		expect(group?.id).toBe('g-fam');
	});
});

describe('isStandingsUsableForMirror', () => {
	it('requires complete standings with at least two members', () => {
		expect(
			isStandingsUsableForMirror({
				groupId: 'g1',
				groupName: 'Test',
				complete: true,
				source: 'standings-api',
				members: [
					{ userId: 'a', name: 'A', rank: 1, points: 10 },
					{ userId: 'b', name: 'B', rank: 2, points: 8 },
				],
			}),
		).toBe(true);

		expect(
			isStandingsUsableForMirror({
				groupId: 'g1',
				groupName: 'Test',
				complete: false,
				source: 'overview-fallback',
				members: [{ userId: 'self', name: 'Jij', rank: 1, points: 10 }],
			}),
		).toBe(false);
	});
});

describe('fetchGroupStandingsForConfig', () => {
	it('uses embedded standings when available', async () => {
		const embedded = [
			{
				groupId: 'FAM',
				groupName: 'Familie',
				groupCode: 'FAM',
				complete: true,
				source: 'overview-embedded' as const,
				members: [
					{ userId: '1', name: 'Jan', rank: 1, points: 120 },
					{ userId: '2', name: 'Piet', rank: 2, points: 115 },
				],
			},
		];

		const api = {
			fetchGroupStandingsWithFallback: async () => {
				throw new Error('should not be called');
			},
		};

		const result = await fetchGroupStandingsForConfig(
			{ tactic: baseTacticConfig({ groupName: 'Familie' }) } as import('$lib/types/settings').Settings,
			api as never,
			[{ id: 'FAM', name: 'Familie', code: 'FAM', rank: 1, points: 120 }],
			embedded,
		);

		expect(result?.source).toBe('overview-embedded');
		expect(result?.complete).toBe(true);
	});

	it('returns overview fallback when API throws', async () => {
		const api = {
			fetchGroupStandingsWithFallback: async () => {
				throw new Error('404');
			},
		};

		const standings = await fetchGroupStandingsForConfig(
			{ tactic: baseTacticConfig({ groupName: 'Familie' }) } as import('$lib/types/settings').Settings,
			api as never,
			overviewGroups,
			[],
		);

		expect(standings?.complete).toBe(false);
		expect(standings?.source).toBe('overview-fallback');
		expect(standings?.members).toHaveLength(1);
	});
});
