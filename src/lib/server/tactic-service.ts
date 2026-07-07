import type { Match } from '$lib/types/match';
import type { Settings } from '$lib/types/settings';
import type { RivalProno, TacticSnapshot } from '$lib/types/tactic';
import { getMemberByRank } from '$lib/types/tactic';
import { resolveApiAuthorization } from './auth';
import { pinoLogger } from './logger';
import type { PronotoolApiClient } from './pronotool-api';
import { fetchRivalPronosByMatchId } from './rival-pronos';
import { fetchGroupStandingsForConfig } from './standings';
import { decideTactic } from './tactic';

export async function loadTacticSnapshot(
	settings: Settings,
	api: PronotoolApiClient,
	allMatches: Match[],
	matchesInBatch: Match[],
): Promise<TacticSnapshot> {
	const fallback: TacticSnapshot = {
		decision: { mode: 'ai', reason: 'Tactic disabled or unavailable' },
		standings: null,
		rivalPronosByMatchId: new Map(),
		myUserId: null,
	};

	if (settings.tactic.mode === 'ai' && !settings.tactic.geminiContext) {
		return { ...fallback, decision: { mode: 'ai', reason: 'TACTIC_MODE=ai' } };
	}

	try {
		const authorization = await resolveApiAuthorization(settings);
		const overview = await api.fetchUserOverview(authorization);
		const myUserId = overview.userId ?? null;
		const standings = await fetchGroupStandingsForConfig(settings, api, overview.groups ?? []);

		const decision = decideTactic({
			config: settings.tactic,
			standings,
			allMatches,
			myUserId,
			matchesInBatch,
		});

		let rivalPronosByMatchId = new Map<number, RivalProno>();

		const rivalUserId =
			decision.rivalUserId ??
			(standings
				? getMemberByRank(standings.members, settings.tactic.mirrorRank)?.userId
				: undefined);

		if (rivalUserId && standings?.groupId) {
			try {
				rivalPronosByMatchId = await fetchRivalPronosByMatchId(
					settings,
					api,
					rivalUserId,
					standings.groupId,
				);
			} catch (err) {
				pinoLogger.warn(
					{ err, rivalUserId },
					'Kon rival-pronos niet ophalen; tactic gaat verder zonder.',
				);
			}
		}

		return {
			decision,
			standings,
			rivalPronosByMatchId,
			myUserId,
		};
	} catch (err) {
		pinoLogger.warn({ err }, 'Tactic snapshot laden mislukt; val terug op plain AI.');
		return fallback;
	}
}

export function getRivalFromSnapshot(snapshot: TacticSnapshot): {
	userId: string;
	name: string;
	rank: number;
} | null {
	const rank = snapshot.decision.rivalUserId
		? snapshot.standings?.members.find((m) => m.userId === snapshot.decision.rivalUserId)
		: snapshot.standings
			? getMemberByRank(snapshot.standings.members, 2)
			: null;

	if (!rank) {
		if (snapshot.decision.rivalUserId && snapshot.decision.rivalName) {
			return {
				userId: snapshot.decision.rivalUserId,
				name: snapshot.decision.rivalName,
				rank: 2,
			};
		}
		return null;
	}

	return { userId: rank.userId, name: rank.name, rank: rank.rank };
}
