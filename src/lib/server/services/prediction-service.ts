import type { Match, MatchWithProno } from '$lib/types/match';
import type { Prediction, PredictMatchesOptions } from '$lib/types/prediction';
import type { Settings } from '$lib/types/settings';
import type { TacticContext, TacticSnapshot } from '$lib/types/tactic';
import {
	clearPredictionInFlight,
	getPredictUpcomingRunning,
	invalidateUpcomingMatchesCache,
	markAutoPredicted,
	markPredictionInFlight,
	setPredictUpcomingRunning,
	shouldSkipAutoPredict,
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
import { rivalPronosFingerprint } from '../rival-pronos';
import {
	buildMirrorPredictions,
	buildTacticContext,
	formatTacticLabel,
	shouldInjectGeminiContext,
} from '../tactic';
import { getRivalFromSnapshot, loadTacticSnapshot } from '../tactic-service';
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
		tactic: prediction.tactic ?? null,
		tacticLabel: prediction.tacticLabel ?? null,
	});
}

function broadcastPredictionFailed(matchId: number, reason?: string): void {
	broadcastSse({ type: 'prediction-failed', matchId, reason });
}

function logPredictionDetails(prediction: Prediction, matchLabel?: string): void {
	if (prediction.tactic === 'mirror') {
		pinoLogger.info(`🪞 Tactiek${matchLabel ? ` (${matchLabel})` : ''}: ${prediction.reasoning}`);
		return;
	}

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

async function resolvePredictionsForMatches(
	settings: Settings,
	api: PronotoolApiClient,
	matches: MatchWithProno[],
	allMatches: Match[],
	snapshot?: TacticSnapshot,
): Promise<Prediction[]> {
	const loadedSnapshot = snapshot ?? (await loadTacticSnapshot(settings, api, allMatches, matches));

	const { decision } = loadedSnapshot;
	const rival = getRivalFromSnapshot(loadedSnapshot);
	const rivalName = rival?.name ?? decision.rivalName ?? `#${settings.tactic.mirrorRank}`;

	pinoLogger.info(
		{
			tactic: decision.mode,
			reason: decision.reason,
			rival: rivalName,
			lead: decision.leadPoints,
		},
		'Tactic beslissing',
	);

	if (decision.mode === 'mirror') {
		const mirrorPredictions = buildMirrorPredictions(
			matches,
			loadedSnapshot.rivalPronosByMatchId,
			rivalName,
		);

		if (mirrorPredictions.length === 0) {
			pinoLogger.warn(
				'Mirror modus: geen rival-pronos beschikbaar; wedstrijden overgeslagen tot volgende cron.',
			);
			return [];
		}

		if (mirrorPredictions.length < matches.length) {
			pinoLogger.warn(
				`Mirror modus: ${mirrorPredictions.length}/${matches.length} wedstrijden hebben rival-prono; rest wordt overgeslagen.`,
			);
		}

		return mirrorPredictions;
	}

	const apiKey = process.env.GEMINI_API_KEY || '';
	const injectContext = shouldInjectGeminiContext(decision, settings.tactic);
	const rivalForContext = getRivalFromSnapshot(loadedSnapshot);
	const tacticLabel = formatTacticLabel(injectContext ? 'ai_tactic' : 'ai', rivalForContext?.name);

	const predictions: Prediction[] = [];

	for (const match of matches) {
		let tacticContext: TacticContext | undefined;

		if (injectContext && loadedSnapshot.standings && rivalForContext) {
			tacticContext = buildTacticContext(
				loadedSnapshot.standings,
				loadedSnapshot.myUserId,
				{
					userId: rivalForContext.userId,
					name: rivalForContext.name,
					rank: rivalForContext.rank,
					points:
						loadedSnapshot.standings.members.find((m) => m.userId === rivalForContext.userId)
							?.points ?? 0,
				},
				match,
				loadedSnapshot.rivalPronosByMatchId.get(match.matchId) ?? null,
				allMatches,
			);
		} else if (injectContext) {
			pinoLogger.warn('ai_tactic zonder standings/rival; plain AI voor deze wedstrijd.');
		}

		const options: PredictMatchesOptions = {
			injectGeminiContext: injectContext && Boolean(tacticContext),
			tacticContext,
		};

		const batch = await predictMatches(apiKey, [match], options);
		for (const prediction of batch) {
			predictions.push({
				...prediction,
				tactic: injectContext && tacticContext ? 'ai_tactic' : 'ai',
				tacticLabel: injectContext && tacticContext ? tacticLabel : null,
			});
		}
	}

	return predictions;
}

export async function runPredictSingle(match: MatchWithProno): Promise<Prediction | null> {
	const matchId = match.matchId;
	markPredictionInFlight(matchId);
	const settings = getSettings();
	const api = new PronotoolApiClient(settings);

	try {
		const allMatches = await fetchMatchesCached(settings);
		const snapshot = await loadTacticSnapshot(settings, api, allMatches, [match]);

		if (snapshot.decision.mode === 'mirror') {
			pinoLogger.info(`🪞 Mirror tactiek voor ${match.homeTeam} vs ${match.awayTeam}...`);
		} else if (shouldInjectGeminiContext(snapshot.decision, settings.tactic)) {
			pinoLogger.info(
				`🤖 Gemini (klassement-context) voorspelt ${match.homeTeam} vs ${match.awayTeam}...`,
			);
		} else {
			pinoLogger.info(`🤖 Gemini voorspelt ${match.homeTeam} vs ${match.awayTeam}...`);
		}

		const predictions = await resolvePredictionsForMatches(
			settings,
			api,
			[match],
			allMatches,
			snapshot,
		);

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

		const candidateMatches = attachCurrentPronos(
			allMatches.filter((match) => isWithinAutoPredictWindow(match.startTime, now)),
			userPronosByMatchId,
		);

		const snapshot = await loadTacticSnapshot(settings, api, allMatches, candidateMatches);
		const rivalFingerprint = rivalPronosFingerprint(snapshot.rivalPronosByMatchId);

		const matchesToPredict = candidateMatches.filter((match) => {
			if (
				shouldSkipAutoPredict(
					match.matchId,
					settings.tactic.overwrite,
					snapshot.decision.mode === 'mirror' ? rivalFingerprint : undefined,
				)
			) {
				pinoLogger.debug(
					`Skipping ${match.homeTeam} vs ${match.awayTeam}: already auto-predicted in this session.`,
				);
				return false;
			}
			return true;
		});

		if (matchesToPredict.length === 0) {
			pinoLogger.debug('🤷 Geen aankomende wedstrijden gevonden binnen 20 min om te voorspellen.');
			return;
		}

		const predictions = await resolvePredictionsForMatches(
			settings,
			api,
			matchesToPredict,
			allMatches,
			snapshot,
		);

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
			markAutoPredicted(
				prediction.matchId,
				prediction.tactic ?? 'ai',
				snapshot.decision.mode === 'mirror' ? rivalFingerprint : undefined,
			);
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
