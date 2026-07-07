import type { Settings } from '$lib/types/settings';
import type { GroupStandings, GroupSummary } from '$lib/types/standings';
import { resolveApiAuthorization } from './auth';
import type { PronotoolApiClient } from './pronotool-api';

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
			rank: null,
			points: null,
		};
	}

	if (!config.groupName) {
		return overviewGroups[0] ?? null;
	}

	const normalized = config.groupName.trim().toLowerCase();
	return (
		overviewGroups.find((g) => g.name.trim().toLowerCase() === normalized) ??
		overviewGroups.find((g) => g.name.toLowerCase().includes(normalized)) ??
		null
	);
}

export async function fetchGroupStandingsForConfig(
	settings: Settings,
	api: PronotoolApiClient,
	overviewGroups: GroupSummary[],
): Promise<GroupStandings | null> {
	const targetGroup = resolveTargetGroup(overviewGroups, settings.tactic);
	if (!targetGroup) {
		return null;
	}

	try {
		const authorization = await resolveApiAuthorization(settings);
		return await api.fetchGroupStandings(authorization, targetGroup.id);
	} catch {
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
		members: [
			{
				userId: 'self',
				name: 'Jij',
				rank: targetGroup.rank,
				points: targetGroup.points,
			},
		],
	};
}

export function findMyMember(
	standings: GroupStandings,
	myUserId: string | null,
): (typeof standings.members)[number] | undefined {
	if (!myUserId) return undefined;
	return standings.members.find((m) => m.userId === myUserId);
}
