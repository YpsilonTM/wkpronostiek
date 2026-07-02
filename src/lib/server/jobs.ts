import { getSettings } from './config';
import { resolveApiAuthorization } from './auth';
import { PronotoolApiClient } from './pronotool-api';
import { predictMatches } from './predictor';
import { logPrediction, reportPredictionAccuracy, computePredictionAccuracy } from './prediction-log';
import { pinoLogger, broadcastSse } from './logger';
import {
	autoPredictedMatchIds,
	getPredictUpcomingRunning,
	setPredictUpcomingRunning,
	incrementActiveJobs,
	decrementActiveJobs,
	invalidateUpcomingMatchesCache,
	markPredictionInFlight,
	clearPredictionInFlight
} from './app-state';
import { attachCurrentPronos, isKnockoutMatch } from './match-enrichment';
import { AUTO_PREDICT_WINDOW_MS } from './config';
import type { Match, MatchWithProno } from '$lib/types/match';
import type { Prediction } from '$lib/types/prediction';
import type { Settings } from '$lib/types/settings';

async function submitPredictions(
	api: PronotoolApiClient,
	settings: Settings,
	predictions: Prediction[],
	matchesById: Map<number, Match>
): Promise<void> {
	const authorization = await resolveApiAuthorization(settings);
	await api.setPronos(
		authorization,
		predictions.map((p) => {
			const match = matchesById.get(Number(p.matchId));
			const isKnockoutDraw =
				match &&
				isKnockoutMatch(match) &&
				p.homeScore === p.awayScore;

			return {
				matchId: p.matchId,
				homeScore: p.homeScore,
				awayScore: p.awayScore,
				shootoutWinner: isKnockoutDraw ? p.shootoutWinner : null,
				modifiedTime: null,
				points: null
			};
		})
	);

	for (const prediction of predictions) {
		const match = matchesById.get(Number(prediction.matchId));
		if (match) {
			await logPrediction(prediction, match);
		}
	}
}

function formatSubmissionScore(prediction: Prediction, match: Match): string {
	const score = `${prediction.homeScore}-${prediction.awayScore}`;
	if (
		isKnockoutMatch(match) &&
		prediction.homeScore === prediction.awayScore &&
		(prediction.shootoutWinner === 0 || prediction.shootoutWinner === 1)
	) {
		const winner = prediction.shootoutWinner === 0 ? match.homeTeam : match.awayTeam;
		return `${score} (${winner} wint na strafschoppen)`;
	}
	return score;
}

function broadcastPredictionResult(
	prediction: Prediction,
	match: Match,
	autoPredicted: boolean
): void {
	broadcastSse({
		type: 'prediction',
		matchId: Number(prediction.matchId),
		homeTeam: match.homeTeam,
		awayTeam: match.awayTeam,
		homeScore: prediction.homeScore,
		awayScore: prediction.awayScore,
		reasoning: prediction.reasoning || '',
		searchAnalysis: prediction.searchAnalysis || '',
		model: prediction.model || null,
		escalated: Boolean(prediction.escalated),
		autoPredicted
	});
}

function broadcastPredictionFailed(matchId: number, reason?: string): void {
	broadcastSse({ type: 'prediction-failed', matchId, reason });
}

function logPredictionDetails(prediction: Prediction, matchLabel?: string): void {
	pinoLogger.info(`🧠 Reden${matchLabel ? ` voor ${matchLabel}` : ''}: ${prediction.reasoning}`);
	if (prediction.searchAnalysis) {
		pinoLogger.info(`🔍 Analyse${matchLabel ? ` (${matchLabel})` : ''}: ${prediction.searchAnalysis}`);
	}
	if (prediction.escalated) {
		pinoLogger.info(`⬆️ Heranalyse uitgevoerd met ${prediction.model} wegens lage zekerheid.`);
	}
}

export async function fetchUserPronosByMatchId(
	settings: Settings,
	api: PronotoolApiClient
): Promise<Map<number, { homeScore: number; awayScore: number }>> {
	try {
		const authorization = await resolveApiAuthorization(settings);
		const overview = await api.fetchUserOverview(authorization);
		const byMatchId = new Map<number, { homeScore: number; awayScore: number }>();

		for (const prono of overview.pronos || []) {
			const matchId = Number(prono.matchId);
			if (!Number.isInteger(matchId)) continue;
			if (
				prono.homeScore !== undefined &&
				prono.awayScore !== undefined &&
				prono.homeScore !== null &&
				prono.awayScore !== null
			) {
				byMatchId.set(matchId, {
					homeScore: Number(prono.homeScore),
					awayScore: Number(prono.awayScore)
				});
			}
		}

		return byMatchId;
	} catch {
		return new Map();
	}
}

export async function fetchAccuracyStats() {
	const settings = getSettings();
	const api = new PronotoolApiClient(settings);
	const allMatches = await api.fetchMatches();
	return computePredictionAccuracy(allMatches);
}

export async function runPredictSingle(match: MatchWithProno): Promise<Prediction | null> {
	const matchId = Number(match.matchId);
	incrementActiveJobs();
	markPredictionInFlight(matchId);
	const settings = getSettings();
	const api = new PronotoolApiClient(settings);
	const apiKey = process.env.GEMINI_API_KEY || '';

	try {
		pinoLogger.info(`🤖 Gemini voorspelt ${match.homeTeam} vs ${match.awayTeam}...`);
		const predictions = await predictMatches(apiKey, [match], {
			onDebug: (message) => pinoLogger.debug(message)
		});
		if (predictions.length === 0) {
			pinoLogger.info('No prediction recieved, try again.');
			broadcastPredictionFailed(matchId, 'Geen voorspelling ontvangen');
			return null;
		}

		const prediction = predictions[0];
		logPredictionDetails(prediction);
		pinoLogger.info(
			`📤 Indienen: ${match.homeTeam} ${formatSubmissionScore(prediction, match)} ${match.awayTeam}...`
		);
		await submitPredictions(api, settings, [prediction], new Map([[matchId, match]]));
		invalidateUpcomingMatchesCache();
		broadcastPredictionResult(prediction, match, false);
		pinoLogger.info(`✅ Pronostiek ingediend voor ${match.homeTeam} vs ${match.awayTeam}.`);
		return prediction;
	} catch (err) {
		pinoLogger.info('No prediction recieved, try again.');
		broadcastPredictionFailed(
			matchId,
			err instanceof Error ? err.message : 'Onbekende fout'
		);
		return null;
	} finally {
		clearPredictionInFlight(matchId);
		decrementActiveJobs();
	}
}

export async function runPredictUpcoming(): Promise<void> {
	if (getPredictUpcomingRunning()) {
		pinoLogger.debug('Skipping overlapping automatic prediction run.');
		return;
	}

	setPredictUpcomingRunning(true);
	incrementActiveJobs();
	const settings = getSettings();
	const api = new PronotoolApiClient(settings);
	const apiKey = process.env.GEMINI_API_KEY || '';

	try {
		pinoLogger.debug('🤖 Automatische voorspelling gestart voor aankomende wedstrijden...');
		const allMatches = await api.fetchMatches();
		const accuracyStats = await reportPredictionAccuracy(allMatches, (message) =>
			pinoLogger.info(message)
		);
		if (accuracyStats) {
			broadcastSse({ type: 'accuracy', ...accuracyStats });
		}
		const userPronosByMatchId = await fetchUserPronosByMatchId(settings, api);
		const now = new Date();

		const matchesToPredict = attachCurrentPronos(
			allMatches.filter((match) => {
				const startTime = new Date(match.startTime);
				const timeUntilMatch = startTime.getTime() - now.getTime();
				const shouldPredict = timeUntilMatch > 0 && timeUntilMatch <= AUTO_PREDICT_WINDOW_MS;
				if (!shouldPredict) return false;

				const matchId = Number(match.matchId);
				if (autoPredictedMatchIds.has(matchId)) {
					pinoLogger.debug(
						`Skipping ${match.homeTeam} vs ${match.awayTeam}: already auto-predicted in this session.`
					);
					return false;
				}

				return true;
			}) as MatchWithProno[],
			userPronosByMatchId
		);

		if (matchesToPredict.length === 0) {
			pinoLogger.debug('🤷 Geen aankomende wedstrijden gevonden binnen 20 min om te voorspellen.');
			return;
		}

		const predictions = await predictMatches(apiKey, matchesToPredict, {
			onDebug: (message) => pinoLogger.debug(message)
		});

		if (predictions.length === 0) {
			pinoLogger.info('No prediction recieved, try again.');
			return;
		}

		pinoLogger.info(`📤 Indienen van ${predictions.length} pronostieken...`);
		const matchesById = new Map(matchesToPredict.map((m) => [Number(m.matchId), m]));
		for (const prediction of predictions) {
			const match = matchesById.get(Number(prediction.matchId));
			if (match) {
				logPredictionDetails(prediction, `${match.homeTeam} vs ${match.awayTeam}`);
			}
		}
		await submitPredictions(api, settings, predictions, matchesById);
		for (const prediction of predictions) {
			autoPredictedMatchIds.add(Number(prediction.matchId));
			const match = matchesById.get(Number(prediction.matchId));
			if (match) {
				broadcastPredictionResult(prediction, match, true);
			}
		}
		invalidateUpcomingMatchesCache();
		pinoLogger.info('✅ Automatische voorspelling voltooid.');
	} catch (err) {
		pinoLogger.info(
			`❌ Automatische voorspelling mislukt: ${err instanceof Error ? err.message : String(err)}`
		);
	} finally {
		decrementActiveJobs();
		setPredictUpcomingRunning(false);
	}
}

export async function runAuthRefresh(): Promise<void> {
	pinoLogger.info('🔑 Auth token vernieuwen...');
	const settings = getSettings();
	try {
		await resolveApiAuthorization(settings, { forceRefresh: true });
		pinoLogger.info('✅ Auth token vernieuwd.');
	} catch (err) {
		pinoLogger.info(`❌ Auth fout: ${err instanceof Error ? err.message : String(err)}`);
	}
}
