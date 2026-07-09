import { describe, expect, it } from 'vitest';
import { expandApiUrl, getRivalPronosUrlCandidates, getStandingsUrlCandidates } from './endpoints';

describe('expandApiUrl', () => {
	it('replaces placeholders with encoded values', () => {
		const url = expandApiUrl('https://api.example/groups/{groupId}/users/{userId}', {
			groupId: 'abc 123',
			userId: 'user/1',
		});

		expect(url).toBe('https://api.example/groups/abc%20123/users/user%2F1');
	});
});

describe('getStandingsUrlCandidates', () => {
	it('puts configured URL first and deduplicates fallbacks', () => {
		const configured =
			'https://api.sporza.be/pronotool/1/groups/{groupId}/standings';
		const urls = getStandingsUrlCandidates(configured, 'g1');

		expect(urls[0]).toBe('https://api.sporza.be/pronotool/1/groups/g1/standings');
		expect(new Set(urls).size).toBe(urls.length);
		expect(urls.length).toBeGreaterThan(1);
	});
});

describe('getRivalPronosUrlCandidates', () => {
	it('includes configured and fallback rival-pronos URLs', () => {
		const configured =
			'https://api.sporza.be/pronotool/1/users/{userId}/pronos?groupId={groupId}';
		const urls = getRivalPronosUrlCandidates(configured, 'u1', 'g1');

		expect(urls[0]).toContain('users/u1');
		expect(urls.some((url) => url.includes('groups/g1'))).toBe(true);
	});
});
