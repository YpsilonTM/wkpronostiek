import type { Settings } from '$lib/types/settings';
import type { RivalProno } from '$lib/types/tactic';
import { extractRivalPronosFromOverview } from './pronotool/parse';
import { resolveApiAuthorization } from './auth';
import { pinoLogger } from './logger';
import type { PronotoolApiClient } from './pronotool-api';
import { isUnauthorizedHttpError } from './pronotool-api';

export function rivalPronosToMap(pronos: RivalProno[]): Map<number, RivalProno> {
	const byMatchId = new Map<number, RivalProno>();
	for (const prono of pronos) {
		byMatchId.set(prono.matchId, prono);
	}
	return byMatchId;
}

export async function fetchRivalPronosByMatchId(
	settings: Settings,
	api: PronotoolApiClient,
	userId: string,
	groupId: string,
	groupCode?: string,
	overviewPayload?: unknown,
): Promise<Map<number, RivalProno>> {
	if (overviewPayload) {
		const fromOverview = extractRivalPronosFromOverview(
			overviewPayload,
			userId,
			groupId,
			groupCode,
		);
		if (fromOverview.length > 0) {
			pinoLogger.debug(
				{ userId, groupId, pronoCount: fromOverview.length },
				'Rival-pronos geladen uit user-overview.',
			);
			return rivalPronosToMap(fromOverview);
		}
	}

	const authorization = await resolveApiAuthorization(settings);

	try {
		const pronos = await api.fetchRivalPronosWithFallback(
			authorization,
			userId,
			groupId,
			groupCode,
		);
		return rivalPronosToMap(pronos);
	} catch (error) {
		if (isUnauthorizedHttpError(error)) {
			throw error;
		}

		pinoLogger.warn(
			{ err: error, userId, groupId, groupCode },
			'Rival-pronos niet beschikbaar (nog niet zichtbaar of geen werkende URL).',
		);
		return new Map();
	}
}

export function rivalPronosFingerprint(pronos: Map<number, RivalProno>): string {
	const entries = [...pronos.entries()]
		.sort(([a], [b]) => a - b)
		.map(([matchId, p]) => `${matchId}:${p.homeScore}-${p.awayScore}:${p.shootoutWinner ?? 'x'}`);
	return entries.join('|');
}
