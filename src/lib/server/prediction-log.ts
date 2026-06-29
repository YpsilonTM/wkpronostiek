import { prisma } from './db';
import type { Match } from '$lib/types/match';
import type { AccuracyStats, Prediction, PredictionLogEntry } from '$lib/types/prediction';

export interface StoredPredictionSummary {
	matchId: number;
	homeScore: number;
	awayScore: number;
	reasoning: string;
	searchAnalysis: string;
	model: string | null;
	escalated: boolean;
	submittedAt: string;
}

async function readLatestStoredPredictions(): Promise<Map<number, StoredPredictionSummary>> {
	const rows = await prisma.prediction.findMany({
		orderBy: [{ matchId: 'asc' }, { submittedAt: 'desc' }]
	});

	const latestByMatchId = new Map<number, StoredPredictionSummary>();
	for (const row of rows) {
		if (latestByMatchId.has(row.matchId)) {
			continue;
		}
		latestByMatchId.set(row.matchId, {
			matchId: row.matchId,
			homeScore: row.homeScore,
			awayScore: row.awayScore,
			reasoning: row.reasoning,
			searchAnalysis: row.searchAnalysis,
			model: row.model,
			escalated: row.escalated,
			submittedAt: row.submittedAt.toISOString()
		});
	}

	return latestByMatchId;
}

export async function getLatestStoredPredictionsByMatchId(): Promise<
	Map<number, StoredPredictionSummary>
> {
	return readLatestStoredPredictions();
}

export async function logPrediction(prediction: Prediction, match: Match): Promise<void> {
	await prisma.prediction.create({
		data: {
			matchId: Number(prediction.matchId),
			homeTeam: match.homeTeam,
			awayTeam: match.awayTeam,
			phaseName: match.phaseName ?? null,
			startTime: match.startTime ?? null,
			homeScore: prediction.homeScore,
			awayScore: prediction.awayScore,
			shootoutWinner: prediction.shootoutWinner,
			reasoning: prediction.reasoning || '',
			searchAnalysis: prediction.searchAnalysis || '',
			model: prediction.model ?? null,
			escalated: Boolean(prediction.escalated)
		}
	});
}

function isFinishedMatch(match: Match): boolean {
	const status = String(match.status || '').toLowerCase();
	return (
		status === 'end' ||
		status.includes('finished') ||
		status.includes('gespeeld') ||
		status.includes('ended') ||
		status.includes('closed')
	);
}

function getActualScore(match: Match): { home: number; away: number } | null {
	const home = match.homeScore ?? null;
	const away = match.awayScore ?? null;
	if (!Number.isInteger(home) || !Number.isInteger(away)) {
		return null;
	}
	return { home: home as number, away: away as number };
}

function outcome(home: number, away: number): 'home' | 'away' | 'draw' {
	if (home > away) return 'home';
	if (away > home) return 'away';
	return 'draw';
}

async function readLatestLogEntries(): Promise<PredictionLogEntry[]> {
	const stored = await readLatestStoredPredictions();
	return [...stored.values()].map((row) => ({
		loggedAt: row.submittedAt,
		matchId: row.matchId,
		homeTeam: null,
		awayTeam: null,
		phaseName: null,
		startTime: null,
		predictedHome: row.homeScore,
		predictedAway: row.awayScore,
		model: row.model,
		escalated: row.escalated
	}));
}

export async function computePredictionAccuracy(allMatches: Match[]): Promise<AccuracyStats | null> {
	const entries = await readLatestLogEntries();
	if (entries.length === 0) {
		return null;
	}

	const latestByMatchId = new Map<number, PredictionLogEntry>();
	for (const entry of entries) {
		latestByMatchId.set(Number(entry.matchId), entry);
	}

	let evaluated = 0;
	let exactHits = 0;
	let outcomeHits = 0;

	for (const match of allMatches) {
		if (!isFinishedMatch(match)) continue;

		const actual = getActualScore(match);
		if (!actual) continue;

		const predicted = latestByMatchId.get(Number(match.matchId));
		if (!predicted) continue;

		evaluated += 1;
		if (predicted.predictedHome === actual.home && predicted.predictedAway === actual.away) {
			exactHits += 1;
		}
		if (
			outcome(predicted.predictedHome, predicted.predictedAway) === outcome(actual.home, actual.away)
		) {
			outcomeHits += 1;
		}
	}

	if (evaluated === 0) {
		return null;
	}

	const exactPct = Math.round((exactHits / evaluated) * 100);
	const outcomePct = Math.round((outcomeHits / evaluated) * 100);

	return { evaluated, exactHits, outcomeHits, exactPct, outcomePct };
}

export async function reportPredictionAccuracy(
	allMatches: Match[],
	logFn?: (message: string) => void
): Promise<AccuracyStats | null> {
	const stats = await computePredictionAccuracy(allMatches);
	if (!stats || typeof logFn !== 'function') {
		return stats;
	}

	logFn(
		`📊 Pronostiek-accuratesse: ${stats.exactHits}/${stats.evaluated} exact (${stats.exactPct}%), ${stats.outcomeHits}/${stats.evaluated} juiste uitslag (${stats.outcomePct}%)`
	);
	return stats;
}
