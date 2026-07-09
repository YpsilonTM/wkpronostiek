import { describe, expect, it } from 'vitest';
import {
	extractRivalPronosFromOverview,
	parseGroupStandings,
	parseGroups,
	parseOverviewGroupStandings,
	parseRivalProno,
	parseRivalPronos,
	parseStandingsMembers,
	parseUserOverview,
} from './parse';

describe('parseGroups', () => {
	it('parses top-level groups array', () => {
		const groups = parseGroups({
			groups: [{ id: 'g1', name: 'Familie', rank: 2, points: 110 }],
		});

		expect(groups).toEqual([{ id: 'g1', name: 'Familie', code: null, rank: 2, points: 110 }]);
	});

	it('parses sporza nested groups with embedded users', () => {
		const groups = parseGroups(
			{
				user: { id: 42 },
				groups: [
					{
						group: { name: 'Familie', code: 'FAM' },
						users: [
							{ id: 42, name: 'Jan', points: 120, rank: 1 },
							{ id: 99, name: 'Piet', points: 115, rank: 2 },
						],
					},
				],
			},
			'42',
		);

		expect(groups).toEqual([{ id: 'FAM', name: 'Familie', code: 'FAM', rank: 1, points: 120 }]);
	});

	it('parses nested data.groups', () => {
		const groups = parseGroups({
			data: {
				minicompetitions: [{ groupId: 'g2', title: 'Werk', position: 1, score: 95 }],
			},
		});

		expect(groups).toEqual([{ id: 'g2', name: 'Werk', code: null, rank: null, points: null }]);
	});
});

describe('parseStandingsMembers', () => {
	it('parses members with nested user objects', () => {
		const members = parseStandingsMembers({
			members: [
				{ user: { id: 'u1', displayName: 'Jan' }, rank: 1, totalPoints: 120 },
				{ user: { id: 'u2', displayName: 'Piet' }, rank: 2, totalPoints: 115 },
			],
		});

		expect(members).toEqual([
			{ userId: 'u1', name: 'Jan', rank: 1, points: 120 },
			{ userId: 'u2', name: 'Piet', rank: 2, points: 115 },
		]);
	});

	it('parses bare array with position fallback', () => {
		const members = parseStandingsMembers([
			{ userId: 'a', name: 'A', place: 2, score: 50 },
			{ userId: 'b', name: 'B', place: 1, score: 60 },
		]);

		expect(members.map((m) => m.rank)).toEqual([1, 2]);
	});

	it('accepts standings key alias', () => {
		const members = parseStandingsMembers({
			standings: [
				{ userId: 'x', name: 'X', rank: 1, points: 10 },
				{ userId: 'y', name: 'Y', rank: 2, points: 8 },
			],
		});

		expect(members).toHaveLength(2);
	});
});

describe('parseGroupStandings', () => {
	it('marks complete when at least two members are present', () => {
		const standings = parseGroupStandings(
			{
				name: 'Familie',
				ranking: [
					{ userId: 'me', name: 'Me', rank: 1, points: 120 },
					{ userId: 'rival', name: 'Rival', rank: 2, points: 115 },
				],
			},
			'g1',
			'fallback',
		);

		expect(standings.complete).toBe(true);
		expect(standings.source).toBe('standings-api');
		expect(standings.groupName).toBe('Familie');
	});

	it('marks incomplete for single-member responses', () => {
		const standings = parseGroupStandings(
			{
				members: [{ userId: 'solo', name: 'Solo', rank: 1, points: 50 }],
			},
			'g1',
			'fallback',
		);

		expect(standings.complete).toBe(false);
	});
});

describe('parseOverviewGroupStandings', () => {
	it('builds complete standings from sporza overview groups', () => {
		const standings = parseOverviewGroupStandings({
			groups: [
				{
					group: { name: 'Familie', code: 'FAM' },
					users: [
						{ id: 1, name: 'Jan', points: 120 },
						{ id: 2, name: 'Piet', points: 115 },
					],
				},
			],
		});

		expect(standings).toHaveLength(1);
		expect(standings[0].complete).toBe(true);
		expect(standings[0].source).toBe('overview-embedded');
		expect(standings[0].members).toHaveLength(2);
	});
});

describe('parseUserOverview', () => {
	it('parses userId and pronos from nested payload', () => {
		const overview = parseUserOverview({
			data: {
				user: { id: 'abc' },
				pronos: [{ matchId: 10, homeScore: 2, awayScore: 1, points: 20 }],
				groups: [{ id: 'g1', name: 'Test', rank: 1, points: 100 }],
			},
		});

		expect(overview.userId).toBe('abc');
		expect(overview.pronos).toHaveLength(1);
		expect(overview.groups).toHaveLength(1);
	});
});

describe('extractRivalPronosFromOverview', () => {
	it('reads pronos embedded on group users', () => {
		const pronos = extractRivalPronosFromOverview(
			{
				groups: [
					{
						group: { name: 'Acrylzuur', code: 'pKJEJD0pYB' },
						users: [
							{
								id: 32014,
								name: 'Rival',
								points: 115,
								pronos: [{ matchId: 9, homeScore: 1, awayScore: 2, shootoutWinner: null }],
							},
						],
					},
				],
			},
			'32014',
			'pKJEJD0pYB',
			'pKJEJD0pYB',
		);

		expect(pronos).toHaveLength(1);
		expect(pronos[0].awayScore).toBe(2);
	});
});

describe('parseRivalPronos', () => {
	it('parses pronos array and string shootoutWinner', () => {
		const pronos = parseRivalPronos({
			pronos: [
				{ matchId: 1, homeScore: 1, awayScore: 1, shootoutWinner: 'home' },
				{ matchId: 2, homeScore: 0, awayScore: 2, shootoutWinner: null },
			],
		});

		expect(pronos).toEqual([
			{ matchId: 1, homeScore: 1, awayScore: 1, shootoutWinner: 0 },
			{ matchId: 2, homeScore: 0, awayScore: 2, shootoutWinner: null },
		]);
	});

	it('parses bare predictions array', () => {
		const pronos = parseRivalPronos([
			{ matchId: 5, homeScore: 3, awayScore: 0, shootoutWinner: 1 },
		]);

		expect(pronos).toHaveLength(1);
	});
});

describe('parseRivalProno', () => {
	it('rejects incomplete scores', () => {
		expect(parseRivalProno({ matchId: 1, homeScore: null, awayScore: 1 })).toBeNull();
	});
});
