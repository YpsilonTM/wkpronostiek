import type { Settings } from '$lib/types/settings';
import type { GroupStandings, GroupSummary } from '$lib/types/standings';
import { resolveApiAuthorization } from './auth';
import { pinoLogger } from './logger';
import type { PronotoolApiClient } from './pronotool-api';
import { isAuthHttpError } from './pronotool-api';

function normalizeName(value: string): string {
	return value.trim().toLowerCase();
}

export function resolveTargetGroup(
	overviewGroups: GroupSummary[],
	config: Settings['tactic'],
): GroupSummary | null {
	if (config.groupId) {
		const byId = overviewGroups.find((g) => g.id === config.groupId);
		if (byId) return byId;
		return {
			id: config.groupId,
			name: config.groupName || config.groupId,
			code: config.groupCode || null,
			rank: null,
			points: null,
		};
	}

	if (config.groupCode) {
		const normalizedCode = normalizeName(config.groupCode);
		const byCode = overviewGroups.find((g) => g.code && normalizeName(g.code) === normalizedCode);
		if (byCode) return byCode;
	}

	if (!config.groupName) {
		return overviewGroups[0] ?? null;
	}

	const normalized = normalizeName(config.groupName);
	return (
		overviewGroups.find((g) => normalizeName(g.name) === normalized) ??
		overviewGroups.find((g) => normalizeName(g.name).includes(normalized)) ??
		overviewGroups.find((g) => normalized.includes(normalizeName(g.name))) ??
		null
	);
}

function findEmbeddedStandings(
	embeddedStandings: GroupStandings[],
	targetGroup: GroupSummary | null,
	config: Settings['tactic'],
): GroupStandings | null {
	if (embeddedStandings.length === 0) {
		return null;
	}

	if (config.groupId) {
		const byId = embeddedStandings.find((standing) => standing.groupId === config.groupId);
		if (byId) return byId;
	}

	if (config.groupCode) {
		const normalizedCode = normalizeName(config.groupCode);
		const byCode = embeddedStandings.find(
			(standing) => standing.groupCode && normalizeName(standing.groupCode) === normalizedCode,
		);
		if (byCode) return byCode;
	}

	if (targetGroup) {
		const byTarget = embeddedStandings.find(
			(standing) =>
				standing.groupId === targetGroup.id ||
				(standing.groupCode &&
					targetGroup.code &&
					normalizeName(standing.groupCode) === normalizeName(targetGroup.code)) ||
				normalizeName(standing.groupName) === normalizeName(targetGroup.name),
		);
		if (byTarget) return byTarget;
	}

	if (!config.groupName && !config.groupId && !config.groupCode) {
		return embeddedStandings[0] ?? null;
	}

	return null;
}

export async function fetchGroupStandingsForConfig(
	settings: Settings,
	api: PronotoolApiClient,
	overviewGroups: GroupSummary[],
	embeddedStandings: GroupStandings[] = [],
): Promise<GroupStandings | null> {
	const targetGroup = resolveTargetGroup(overviewGroups, settings.tactic);
	const embedded = findEmbeddedStandings(embeddedStandings, targetGroup, settings.tactic);

	if (embedded?.complete) {
		pinoLogger.debug(
			{ groupId: embedded.groupId, groupName: embedded.groupName, source: embedded.source },
			'Klassement geladen uit user-overview.',
		);
		return embedded;
	}

	if (!targetGroup) {
		pinoLogger.warn(
			{
				configuredGroupName: settings.tactic.groupName || null,
				configuredGroupId: settings.tactic.groupId || null,
				configuredGroupCode: settings.tactic.groupCode || null,
				availableGroups: overviewGroups.map((group) => ({
					name: group.name,
					code: group.code ?? null,
					id: group.id,
				})),
			},
			'Geen minicompetitie gevonden in overview; tactic zonder klassement.',
		);
		return embedded && embedded.members.length > 0 ? embedded : null;
	}

	const authorization = await resolveApiAuthorization(settings);

	try {
		return await api.fetchGroupStandingsWithFallback(authorization, targetGroup.id);
	} catch (error) {
		if (isAuthHttpError(error)) {
			throw error;
		}

		pinoLogger.warn(
			{ err: error, groupId: targetGroup.id, groupName: targetGroup.name },
			'Standings API mislukt; val terug op overview-gegevens.',
		);

		if (embedded && embedded.members.length > 0) {
			return embedded;
		}

		return buildStandingsFromOverview(targetGroup);
	}
}

function buildStandingsFromOverview(targetGroup: GroupSummary): GroupStandings | null {
	if (targetGroup.rank === null || targetGroup.points === null) {
		return null;
	}

	return {
		groupId: targetGroup.id,
		groupName: targetGroup.name,
		groupCode: targetGroup.code ?? null,
		members: [
			{
				userId: 'self',
				name: 'Jij',
				rank: targetGroup.rank,
				points: targetGroup.points,
			},
		],
		complete: false,
		source: 'overview-fallback',
	};
}

export function isStandingsUsableForMirror(standings: GroupStandings | null): boolean {
	return Boolean(standings?.complete && standings.members.length >= 2);
}
