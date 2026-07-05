import { describe, expect, it } from 'vitest';
import { formatMatchDateTime } from '$lib/utils/format';

describe('formatMatchDateTime', () => {
	it('returns empty string for empty input', () => {
		expect(formatMatchDateTime('')).toBe('');
	});

	it('formats a valid ISO date in nl-BE locale', () => {
		const formatted = formatMatchDateTime('2026-06-15T18:00:00.000Z');
		expect(formatted.length).toBeGreaterThan(0);
		expect(formatted).toMatch(/\d/);
	});
});
