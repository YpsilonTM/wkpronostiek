import type { Match } from '$lib/types/match';
import type { Settings } from '$lib/types/settings';
import type { RivalProno, TacticSnapshot } from '$lib/types/tactic';
import { getMemberByRank } from '$lib/types/tactic';
import { resolveApiAuthorization } from './auth';
import { isTacticEnabled } from './services/app-settings-service';
import { pinoLogger } from './logger';
import type { PronotoolApiClient } from './pronotool-api';
import { fetchRivalPronosByMatchId } from './rival-pronos';
import { fetchGroupStandingsForConfig } from './standings';
import { decideTactic, needsRivalPronos } from './tactic';

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

	if (!isTacticEnabled()) {
		return { ...fallback, decision: { mode: 'ai', reason: 'Eindfase-tactiek uitgeschakeld' } };
	}

	try {
		const authorization = await resolveApiAuthorization(settings);
		const overview = await api.fetchUserOverview(authorization);
		const myUserId = overview.userId ?? null;
		const standings = await fetchGroupStandingsForConfig(
			settings,
			api,
			overview.groups ?? [],
			overview.embeddedStandings ?? [],
		);

		if (standings && !standings.complete) {
			pinoLogger.warn(
				{ groupId: standings.groupId, source: standings.source },
				'Onvolledig klassement — auto-mirror uitgeschakeld tot standings API werkt.',
			);
		}

		const decision = decideTactic({
			config: settings.tactic,
			standings,
			allMatches,
			myUserId,
			matchesInBatch,
		});

		let rivalPronosByMatchId = new Map<number, RivalProno>();

		const needsPronos = needsRivalPronos(decision, settings.tactic);
		const rivalUserId =
			decision.rivalUserId ??
			(standings
				? getMemberByRank(standings.members, settings.tactic.mirrorRank)?.userId
				: undefined);

		if (needsPronos && rivalUserId && standings?.groupId) {
			rivalPronosByMatchId = await fetchRivalPronosByMatchId(
				settings,
				api,
				rivalUserId,
				standings.groupId,
				standings.groupCode ?? undefined,
				overview.sourcePayload,
			);
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
	const rivalMember = snapshot.decision.rivalUserId
		? snapshot.standings?.members.find((m) => m.userId === snapshot.decision.rivalUserId)
		: snapshot.standings
			? getMemberByRank(snapshot.standings.members, 2)
			: null;

	if (!rivalMember) {
		if (snapshot.decision.rivalUserId && snapshot.decision.rivalName) {
			return {
				userId: snapshot.decision.rivalUserId,
				name: snapshot.decision.rivalName,
				rank: 2,
			};
		}
		return null;
	}

	return { userId: rivalMember.userId, name: rivalMember.name, rank: rivalMember.rank };
}
