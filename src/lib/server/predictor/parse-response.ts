import type { MatchWithProno } from '$lib/types/match';
import { isKnockoutMatch } from '../match-enrichment';

export function tryParsePrediction(rawText: string): Record<string, unknown> {
	const raw = String(rawText || '').trim();
	const json = raw
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();

	try {
		const parsed = JSON.parse(json) as Record<string, unknown> | Record<string, unknown>[];
		if (Array.isArray(parsed)) {
			return parsed[0] ?? {};
		}
		return parsed;
	} catch {
		const start = json.indexOf('{');
		const end = json.lastIndexOf('}');
		if (start !== -1 && end !== -1 && end > start) {
			return JSON.parse(json.slice(start, end + 1)) as Record<string, unknown>;
		}
		throw new Error('Gemini returned malformed JSON.');
	}
}

function parseScore(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.max(0, Math.round(value));
	}

	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (/^\d+$/.test(trimmed)) {
			return Number(trimmed);
		}
		const pair = trimmed.match(/(\d+)\s*[-:]\s*(\d+)/);
		if (pair) {
			return Number(pair[1]);
		}
	}

	return Number.NaN;
}

function extractScorePair(text: string): { home: number; away: number } | null {
	const source = String(text || '');
	const match = source.match(/(\d+)\s*[-:]\s*(\d+)/);
	if (!match) {
		return null;
	}
	return {
		home: Number(match[1]),
		away: Number(match[2]),
	};
}

function parseShootoutWinner(value: unknown): 0 | 1 | null {
	if (value === 0 || value === '0') return 0;
	if (value === 1 || value === '1') return 1;
	return null;
}

export function normalizePrediction(parsed: Record<string, unknown>) {
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('Gemini returned invalid structured output: expected an object.');
	}

	let homeScore = parseScore(parsed.homeScore);
	let awayScore = parseScore(parsed.awayScore);

	if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) {
		const mergedText = [
			parsed.homeScore,
			parsed.awayScore,
			parsed.prediction,
			parsed.score,
			parsed.reasoning,
		]
			.filter(Boolean)
			.join(' ');
		const pair = extractScorePair(mergedText);
		if (pair) {
			homeScore = pair.home;
			awayScore = pair.away;
		}
	}

	return {
		matchId: Number(parsed.matchId),
		homeTeam: String(parsed.homeTeam || '').trim(),
		awayTeam: String(parsed.awayTeam || '').trim(),
		homeScore,
		awayScore,
		shootoutWinner: parseShootoutWinner(parsed.shootoutWinner),
		reasoning: String(parsed.reasoning || '').trim(),
		searchAnalysis: String(parsed.searchAnalysis || '').trim(),
	};
}

export function validatePrediction(
	prediction: ReturnType<typeof normalizePrediction>,
	matchId: number,
	match?: MatchWithProno,
): void {
	if (Number(prediction.matchId) !== matchId) {
		throw new Error('Gemini returned a prediction for the wrong matchId.');
	}

	if (!Number.isInteger(prediction.homeScore) || !Number.isInteger(prediction.awayScore)) {
		throw new Error('Gemini returned invalid score values.');
	}

	const isDraw = prediction.homeScore === prediction.awayScore;
	if (match && isKnockoutMatch(match) && isDraw) {
		if (prediction.shootoutWinner !== 0 && prediction.shootoutWinner !== 1) {
			throw new Error('Knockout draw requires shootoutWinner (0 or 1).');
		}
	} else if (prediction.shootoutWinner !== null) {
		throw new Error('shootoutWinner must be null unless knockout ends in a draw.');
	}
}

export function needsEscalation(prediction: ReturnType<typeof normalizePrediction>): boolean {
	const combined = `${prediction.searchAnalysis} ${prediction.reasoning}`.toLowerCase();
	const uncertaintyPattern =
		/beperkt|onduidelijk|weinig info|moeilijk te voorspellen|onbekend|uncertain|unclear|limited info|hard to predict/;
	if (uncertaintyPattern.test(combined)) {
		return true;
	}
	if ((prediction.searchAnalysis || '').trim().length < 80) {
		return true;
	}
	const totalGoals = prediction.homeScore + prediction.awayScore;
	if (totalGoals > 5 || prediction.homeScore > 3 || prediction.awayScore > 3) {
		return true;
	}
	return false;
}

export function compactText(value: string, maxLength = 700): string {
	const text = String(value || '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!text) {
		return '<leeg antwoord>';
	}
	if (text.length <= maxLength) {
		return text;
	}
	return `${text.slice(0, maxLength)}...`;
}
