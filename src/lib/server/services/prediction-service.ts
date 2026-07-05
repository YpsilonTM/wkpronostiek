import type { Match, MatchWithProno } from '$lib/types/match';
import type { Prediction } from '$lib/types/prediction';
import type { Settings } from '$lib/types/settings';
import {
	autoPredictedMatchIds,
	clearPredictionInFlight,
	getPredictUpcomingRunning,
	invalidateUpcomingMatchesCache,
	markPredictionInFlight,
	setPredictUpcomingRunning,
} from '../app-state';
import { resolveApiAuthorization } from '../auth';
import { getSettings } from '../config';
import { broadcastSse, pinoLogger } from '../logger';
import {
	attachCurrentPronos,
	isKnockoutMatch,
	isWithinAutoPredictWindow,
} from '../match-enrichment';
import { logPrediction, reportPredictionAccuracy } from '../prediction-log';
import { predictMatches } from '../predictor';
import { PronotoolApiClient } from '../pronotool-api';
import {
	fetchMatchesCached,
	fetchUserPronosByMatchId,
	invalidateMatchesCache,
} from './pronotool-service';

async function submitPredictions(
	api: PronotoolApiClient,
	settings: Settings,
	predictions: Prediction[],
	matchesById: Map<number, Match>,
): Promise<void> {
	const authorization = await resolveApiAuthorization(settings);
	await api.setPronos(
		authorization,
		predictions.map((p) => {
			const match = matchesById.get(p.matchId);
			const isKnockoutDraw = match && isKnockoutMatch(match) && p.homeScore === p.awayScore;

			return {
				matchId: p.matchId,
				homeScore: p.homeScore,
				awayScore: p.awayScore,
				shootoutWinner: isKnockoutDraw ? p.shootoutWinner : null,
				modifiedTime: null,
				points: null,
			};
		}),
	);

	for (const prediction of predictions) {
		const match = matchesById.get(prediction.matchId);
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
	autoPredicted: boolean,
): void {
	broadcastSse({
		type: 'prediction',
		matchId: prediction.matchId,
		homeTeam: match.homeTeam,
		awayTeam: match.awayTeam,
		homeScore: prediction.homeScore,
		awayScore: prediction.awayScore,
		reasoning: prediction.reasoning || '',
		searchAnalysis: prediction.searchAnalysis || '',
		model: prediction.model || null,
		escalated: Boolean(prediction.escalated),
		autoPredicted,
	});
}

function broadcastPredictionFailed(matchId: number, reason?: string): void {
	broadcastSse({ type: 'prediction-failed', matchId, reason });
}

function logPredictionDetails(prediction: Prediction, matchLabel?: string): void {
	pinoLogger.info(`🧠 Reden${matchLabel ? ` voor ${matchLabel}` : ''}: ${prediction.reasoning}`);
	if (prediction.searchAnalysis) {
		pinoLogger.info(
			`🔍 Analyse${matchLabel ? ` (${matchLabel})` : ''}: ${prediction.searchAnalysis}`,
		);
	}
	if (prediction.escalated) {
		pinoLogger.info(`⬆️ Heranalyse uitgevoerd met ${prediction.model} wegens lage zekerheid.`);
	}
}

export async function runPredictSingle(match: MatchWithProno): Promise<Prediction | null> {
	const matchId = match.matchId;
	markPredictionInFlight(matchId);
	const settings = getSettings();
	const api = new PronotoolApiClient(settings);
	const apiKey = process.env.GEMINI_API_KEY || '';

	try {
		pinoLogger.info(`🤖 Gemini voorspelt ${match.homeTeam} vs ${match.awayTeam}...`);
		const predictions = await predictMatches(apiKey, [match], {
			onDebug: (message) => pinoLogger.debug(message),
		});
		if (predictions.length === 0) {
			pinoLogger.error({ matchId }, 'No prediction received, try again.');
			broadcastPredictionFailed(matchId, 'Geen voorspelling ontvangen');
			return null;
		}

		const prediction = predictions[0];
		logPredictionDetails(prediction);
		pinoLogger.info(
			`📤 Indienen: ${match.homeTeam} ${formatSubmissionScore(prediction, match)} ${match.awayTeam}...`,
		);
		await submitPredictions(api, settings, [prediction], new Map([[matchId, match]]));
		invalidateUpcomingMatchesCache();
		invalidateMatchesCache();
		broadcastPredictionResult(prediction, match, false);
		pinoLogger.info(`✅ Pronostiek ingediend voor ${match.homeTeam} vs ${match.awayTeam}.`);
		return prediction;
	} catch (err) {
		pinoLogger.error({ err, matchId }, 'Prediction failed');
		broadcastPredictionFailed(matchId, err instanceof Error ? err.message : 'Onbekende fout');
		return null;
	} finally {
		clearPredictionInFlight(matchId);
	}
}

export async function runPredictUpcoming(): Promise<void> {
	if (getPredictUpcomingRunning()) {
		pinoLogger.debug('Skipping overlapping automatic prediction run.');
		return;
	}

	setPredictUpcomingRunning(true);
	const settings = getSettings();
	const api = new PronotoolApiClient(settings);
	const apiKey = process.env.GEMINI_API_KEY || '';

	try {
		pinoLogger.debug('🤖 Automatische voorspelling gestart voor aankomende wedstrijden...');
		const allMatches = await fetchMatchesCached(settings);
		const accuracyStats = await reportPredictionAccuracy(allMatches, (message) =>
			pinoLogger.info(message),
		);
		if (accuracyStats) {
			broadcastSse({ type: 'accuracy', ...accuracyStats });
		}
		const userPronosByMatchId = await fetchUserPronosByMatchId(settings, api);
		const now = Date.now();

		const matchesToPredict = attachCurrentPronos(
			allMatches.filter((match) => {
				if (!isWithinAutoPredictWindow(match.startTime, now)) return false;

				if (autoPredictedMatchIds.has(match.matchId)) {
					pinoLogger.debug(
						`Skipping ${match.homeTeam} vs ${match.awayTeam}: already auto-predicted in this session.`,
					);
					return false;
				}

				return true;
			}),
			userPronosByMatchId,
		);

		if (matchesToPredict.length === 0) {
			pinoLogger.debug('🤷 Geen aankomende wedstrijden gevonden binnen 20 min om te voorspellen.');
			return;
		}

		const predictions = await predictMatches(apiKey, matchesToPredict, {
			onDebug: (message) => pinoLogger.debug(message),
		});

		if (predictions.length === 0) {
			pinoLogger.error('No prediction received, try again.');
			return;
		}

		pinoLogger.info(`📤 Indienen van ${predictions.length} pronostieken...`);
		const matchesById = new Map(matchesToPredict.map((m) => [m.matchId, m]));
		for (const prediction of predictions) {
			const match = matchesById.get(prediction.matchId);
			if (match) {
				logPredictionDetails(prediction, `${match.homeTeam} vs ${match.awayTeam}`);
			}
		}
		await submitPredictions(api, settings, predictions, matchesById);
		for (const prediction of predictions) {
			autoPredictedMatchIds.add(prediction.matchId);
			const match = matchesById.get(prediction.matchId);
			if (match) {
				broadcastPredictionResult(prediction, match, true);
			}
		}
		invalidateUpcomingMatchesCache();
		invalidateMatchesCache();
		pinoLogger.info('✅ Automatische voorspelling voltooid.');
	} catch (err) {
		pinoLogger.error({ err }, 'Automatische voorspelling mislukt');
	} finally {
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
		pinoLogger.error({ err }, 'Auth refresh failed');
	}
}
