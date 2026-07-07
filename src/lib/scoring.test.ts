import { describe, expect, it } from 'vitest';
import { resolveOutcomeSide, SPORZA_MATCH_POINTS, scoreProno } from './scoring';

describe('scoreProno', () => {
	it('awards 20 for exact score', () => {
		expect(
			scoreProno(
				{ homeScore: 2, awayScore: 1 },
				{ homeScore: 2, awayScore: 1 },
				{ isKnockout: false },
			),
		).toBe(SPORZA_MATCH_POINTS.exactScore);
	});

	it('awards 14 for correct goal difference', () => {
		expect(
			scoreProno(
				{ homeScore: 3, awayScore: 1 },
				{ homeScore: 2, awayScore: 0 },
				{ isKnockout: false },
			),
		).toBe(SPORZA_MATCH_POINTS.goalDifference);
	});

	it('awards 10 for correct winner in group phase', () => {
		expect(
			scoreProno(
				{ homeScore: 3, awayScore: 0 },
				{ homeScore: 2, awayScore: 0 },
				{ isKnockout: false },
			),
		).toBe(SPORZA_MATCH_POINTS.correctWinner);
	});

	it('awards 10 for knockout when correct advancing team but wrong margin', () => {
		expect(
			scoreProno(
				{ homeScore: 2, awayScore: 0 },
				{ homeScore: 1, awayScore: 0 },
				{ isKnockout: true },
			),
		).toBe(SPORZA_MATCH_POINTS.correctWinner);
	});

	it('awards 0 when knockout draw predicted without shootout winner', () => {
		expect(
			scoreProno(
				{ homeScore: 1, awayScore: 1, shootoutWinner: null },
				{ homeScore: 2, awayScore: 1 },
				{ isKnockout: true },
			),
		).toBe(0);
	});
});

describe('resolveOutcomeSide', () => {
	it('returns draw in group phase', () => {
		expect(resolveOutcomeSide({ homeScore: 1, awayScore: 1 }, false)).toBe('draw');
	});

	it('returns home via shootout in knockout', () => {
		expect(resolveOutcomeSide({ homeScore: 0, awayScore: 0, shootoutWinner: 0 }, true)).toBe(
			'home',
		);
	});
});
