import { describe, expect, it } from 'vitest';
import { normalizePrediction, tryParsePrediction } from '$lib/server/predictor/parse-response';

describe('tryParsePrediction', () => {
	it('parses plain JSON objects', () => {
		const parsed = tryParsePrediction('{"matchId":1,"homeScore":2,"awayScore":1}');
		expect(parsed.matchId).toBe(1);
	});

	it('strips markdown code fences', () => {
		const parsed = tryParsePrediction('```json\n{"matchId":5,"homeScore":0,"awayScore":0}\n```');
		expect(parsed.matchId).toBe(5);
	});

	it('extracts JSON embedded in text', () => {
		const parsed = tryParsePrediction(
			'Here is the result: {"matchId":9,"homeScore":1,"awayScore":2} done',
		);
		expect(parsed.matchId).toBe(9);
	});
});

describe('normalizePrediction', () => {
	it('normalizes numeric scores from strings', () => {
		const normalized = normalizePrediction({
			matchId: 1,
			homeTeam: 'A',
			awayTeam: 'B',
			homeScore: '2',
			awayScore: '1',
			reasoning: 'test',
			searchAnalysis: 'analysis',
		});

		expect(normalized.homeScore).toBe(2);
		expect(normalized.awayScore).toBe(1);
	});
});
