import type { Settings } from '$lib/types/settings';
import type { RivalProno } from '$lib/types/tactic';
import { resolveApiAuthorization } from './auth';
import type { PronotoolApiClient } from './pronotool-api';

export async function fetchRivalPronosByMatchId(
	settings: Settings,
	api: PronotoolApiClient,
	userId: string,
	groupId: string,
): Promise<Map<number, RivalProno>> {
	const authorization = await resolveApiAuthorization(settings);
	const pronos = await api.fetchRivalPronos(authorization, userId, groupId);
	const byMatchId = new Map<number, RivalProno>();
	for (const prono of pronos) {
		byMatchId.set(prono.matchId, prono);
	}
	return byMatchId;
}

export function rivalPronosFingerprint(pronos: Map<number, RivalProno>): string {
	const entries = [...pronos.entries()]
		.sort(([a], [b]) => a - b)
		.map(([matchId, p]) => `${matchId}:${p.homeScore}-${p.awayScore}:${p.shootoutWinner ?? 'x'}`);
	return entries.join('|');
}
