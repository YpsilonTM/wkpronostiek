import type { Match, UserProno } from '$lib/types/match';
import type { GroupMember, GroupStandings, GroupSummary } from '$lib/types/standings';
import type { RivalProno } from '$lib/types/tactic';

function parseOptionalString(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text || null;
}

function parseInteger(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = Number(value);
	return Number.isInteger(parsed) ? parsed : null;
}

function parseFiniteNumber(value: unknown, fallback = 0): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function parseIdString(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number' && Number.isFinite(value)) {
		return String(value);
	}
	return parseOptionalString(value);
}

function unwrapPayload(payload: unknown): Record<string, unknown> {
	const record = asRecord(payload);
	if (!record) return {};

	const embedded = asRecord(record._embedded);
	let merged: Record<string, unknown> = { ...record };
	if (embedded) {
		merged = { ...merged, ...embedded };
	}

	const body = asRecord(record.body) ?? asRecord(merged.body);
	if (body) {
		merged = { ...merged, ...body };
	}

	if (asRecord(record.data)) {
		merged = { ...merged, ...(record.data as Record<string, unknown>) };
	}
	if (asRecord(record.result)) {
		merged = { ...merged, ...(record.result as Record<string, unknown>) };
	}

	return merged;
}

function extractArray(payload: unknown, keys: string[]): unknown[] {
	if (Array.isArray(payload)) {
		return payload;
	}

	const record = unwrapPayload(payload);
	for (const key of keys) {
		if (Array.isArray(record[key])) {
			return record[key] as unknown[];
		}
	}

	return [];
}

function rankMembersByPoints(members: GroupMember[]): GroupMember[] {
	const hasExplicitRanks = members.some((member, index) => member.rank !== index + 1);
	if (hasExplicitRanks) {
		return [...members].sort((a, b) => a.rank - b.rank);
	}

	return [...members]
		.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
		.map((member, index) => ({ ...member, rank: index + 1 }));
}

function findSelfInMembers(
	members: GroupMember[],
	myUserId: string | null,
): { rank: number; points: number } | null {
	if (!myUserId) return null;
	const me = members.find((member) => member.userId === myUserId);
	return me ? { rank: me.rank, points: me.points } : null;
}

function parseUserRef(row: Record<string, unknown>): {
	userId: string | null;
	name: string | null;
} {
	const user = asRecord(row.user) ?? asRecord(row.participant) ?? asRecord(row.profile);

	return {
		userId: parseIdString(
			row.userId ??
				row.id ??
				row.participantId ??
				user?.id ??
				user?.userId ??
				(user?.sub as string | undefined),
		),
		name: parseOptionalString(
			row.name ??
				row.displayName ??
				row.nickname ??
				row.userName ??
				user?.name ??
				user?.displayName ??
				user?.nickname,
		),
	};
}

function parseRank(row: Record<string, unknown>, index: number): number {
	return (
		parseInteger(row.rank) ??
		parseInteger(row.position) ??
		parseInteger(row.place) ??
		parseInteger(row.standing) ??
		index + 1
	);
}

function parsePoints(row: Record<string, unknown>): number {
	return parseFiniteNumber(row.points ?? row.score ?? row.totalPoints ?? row.totalScore ?? 0);
}

export function parseGroups(payload: unknown, myUserId: string | null = null): GroupSummary[] {
	const rawGroups = extractArray(payload, [
		'groups',
		'competitions',
		'minicompetitions',
		'miniCompetitions',
		'groupList',
	]);
	const groups: GroupSummary[] = [];

	for (const item of rawGroups) {
		const record = asRecord(item);
		if (!record) continue;

		const groupRecord = asRecord(record.group) ?? record;
		const name = parseOptionalString(
			groupRecord?.name ?? groupRecord?.title ?? groupRecord?.groupName ?? record.name,
		);
		const code = parseOptionalString(
			groupRecord?.code ?? groupRecord?.groupCode ?? record.code ?? record.groupCode,
		);
		const id = parseIdString(
			groupRecord?.id ?? record.id ?? record.groupId ?? code ?? name,
		);

		if (!id || !name) continue;

		const usersRaw = record.users ?? record.members ?? record.rankings ?? record.standings;
		const members = Array.isArray(usersRaw)
			? parseStandingsMembers(usersRaw)
			: [];
		const self = findSelfInMembers(members, myUserId);

		groups.push({
			id,
			name,
			code,
			rank: self?.rank ?? parseInteger(record.rank ?? groupRecord?.rank),
			points: self?.points ?? parseInteger(record.points ?? groupRecord?.points),
		});
	}

	if (groups.length > 0) {
		return groups;
	}

	for (const item of rawGroups) {
		const record = asRecord(item);
		if (!record) continue;

		const id = parseIdString(record.id ?? record.groupId ?? record.competitionId);
		const name = parseOptionalString(record.name ?? record.groupName ?? record.title);
		if (!id || !name) continue;

		groups.push({
			id,
			name,
			code: parseOptionalString(record.code ?? record.groupCode),
			rank: parseInteger(record.rank),
			points: parseInteger(record.points),
		});
	}

	return groups;
}

export function parseOverviewGroupStandings(payload: unknown): GroupStandings[] {
	const rawGroups = extractArray(payload, [
		'groups',
		'competitions',
		'minicompetitions',
		'miniCompetitions',
		'groupList',
	]);
	const standings: GroupStandings[] = [];

	for (const item of rawGroups) {
		const record = asRecord(item);
		if (!record) continue;

		const groupRecord = asRecord(record.group) ?? record;
		const name = parseOptionalString(
			groupRecord?.name ?? groupRecord?.title ?? groupRecord?.groupName ?? record.name,
		);
		const code = parseOptionalString(
			groupRecord?.code ?? groupRecord?.groupCode ?? record.code ?? record.groupCode,
		);
		const groupId = parseIdString(
			groupRecord?.id ?? record.id ?? record.groupId ?? code ?? name,
		);
		if (!groupId || !name) continue;

		const usersRaw = record.users ?? record.members ?? record.rankings ?? record.standings;
		if (!Array.isArray(usersRaw) || usersRaw.length === 0) continue;

		const members = rankMembersByPoints(parseStandingsMembers(usersRaw));
		if (members.length === 0) continue;

		standings.push({
			groupId,
			groupName: name,
			groupCode: code,
			members,
			complete: members.length >= 2,
			source: 'overview-embedded',
		});
	}

	return standings;
}

function overviewGroupMatches(
	record: Record<string, unknown>,
	groupId?: string,
	groupCode?: string | null,
): boolean {
	const groupRecord = asRecord(record.group) ?? record;
	const id = parseIdString(groupRecord?.id ?? record.id ?? record.groupId);
	const code = parseOptionalString(
		groupRecord?.code ?? groupRecord?.groupCode ?? record.code ?? record.groupCode,
	);

	if (groupId && (id === groupId || code === groupId)) {
		return true;
	}
	if (groupCode && code && code === groupCode) {
		return true;
	}
	return !groupId && !groupCode;
}

export function extractRivalPronosFromOverview(
	payload: unknown,
	rivalUserId: string,
	groupId?: string,
	groupCode?: string | null,
): RivalProno[] {
	const rawGroups = extractArray(payload, [
		'groups',
		'competitions',
		'minicompetitions',
		'miniCompetitions',
		'groupList',
	]);

	for (const item of rawGroups) {
		const record = asRecord(item);
		if (!record || !overviewGroupMatches(record, groupId, groupCode)) {
			continue;
		}

		const usersRaw = record.users ?? record.members ?? record.rankings ?? record.standings;
		if (!Array.isArray(usersRaw)) {
			continue;
		}

		for (const userItem of usersRaw) {
			const userRecord = asRecord(userItem);
			if (!userRecord) continue;

			const userId = parseIdString(userRecord.userId ?? userRecord.id);
			if (userId !== rivalUserId) continue;

			const pronosRaw =
				userRecord.pronos ?? userRecord.predictions ?? userRecord.userPronos ?? userRecord.prono;
			if (pronosRaw === undefined || pronosRaw === null) {
				continue;
			}

			const pronos = parseRivalPronos(
				Array.isArray(pronosRaw) ? { pronos: pronosRaw } : pronosRaw,
			);
			if (pronos.length > 0) {
				return pronos;
			}
		}
	}

	const topLevel = parseRivalPronos(payload);
	return topLevel;
}

export function parseStandingsMembers(payload: unknown): GroupMember[] {
	const raw = extractArray(payload, [
		'members',
		'standings',
		'ranking',
		'participants',
		'users',
		'leaderboard',
		'results',
	]);

	const members: GroupMember[] = [];
	for (let index = 0; index < raw.length; index += 1) {
		const row = asRecord(raw[index]);
		if (!row) continue;

		const { userId, name } = parseUserRef(row);
		if (!userId || !name) continue;

		members.push({
			userId,
			name,
			rank: parseRank(row, index),
			points: parsePoints(row),
		});
	}

	return members.sort((a, b) => a.rank - b.rank);
}

export function parseGroupStandings(
	payload: unknown,
	groupId: string,
	groupNameFallback: string,
): GroupStandings {
	const record = unwrapPayload(payload);
	const groupName =
		parseOptionalString(record.name ?? record.groupName ?? record.title) || groupNameFallback;
	const groupCode = parseOptionalString(record.code ?? record.groupCode);
	const members = parseStandingsMembers(payload);

	return {
		groupId,
		groupName,
		groupCode,
		members,
		complete: members.length >= 2,
		source: 'standings-api',
	};
}

export function parseUserOverview(payload: unknown): {
	userId: string | null;
	groups: GroupSummary[];
	embeddedStandings: GroupStandings[];
	pronos: UserProno[];
} {
	const record = unwrapPayload(payload);
	const userRecord = asRecord(record.user);
	const userId = parseIdString(record.userId ?? record.id ?? userRecord?.id);
	const pronosRaw = extractArray(payload, ['pronos', 'predictions', 'userPronos']);
	const embeddedStandings = parseOverviewGroupStandings(payload);
	const groupsParsed = parseGroups(payload, userId);

	return {
		userId,
		groups:
			groupsParsed.length > 0
				? groupsParsed
				: embeddedStandings.map((standing) => {
						const me = standing.members[0];
						return {
							id: standing.groupId,
							name: standing.groupName,
							code: standing.groupCode ?? null,
							rank: me?.rank ?? null,
							points: me?.points ?? null,
						};
					}),
		embeddedStandings,
		pronos: pronosRaw.map((item) => parseUserProno(item)).filter(Boolean) as UserProno[],
	};
}

export function parseUserProno(item: unknown): UserProno | null {
	const record = asRecord(item);
	if (!record) return null;

	const matchId = parseInteger(record.matchId);
	if (matchId === null) return null;

	const homeScore = record.homeScore;
	const awayScore = record.awayScore;

	return {
		matchId,
		homeScore: homeScore === null || homeScore === undefined ? null : Number(homeScore),
		awayScore: awayScore === null || awayScore === undefined ? null : Number(awayScore),
		modifiedTime: typeof record.modifiedTime === 'string' ? record.modifiedTime : null,
		points: parseInteger(record.points),
	};
}

function parseShootoutWinner(value: unknown): 0 | 1 | null {
	if (value === 0 || value === 1) {
		return value;
	}

	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		if (normalized === 'home' || normalized === '0') return 0;
		if (normalized === 'away' || normalized === '1') return 1;
	}

	return null;
}

export function parseRivalProno(item: unknown): RivalProno | null {
	const record = asRecord(item);
	if (!record) return null;

	const matchId = parseInteger(record.matchId);
	const homeScore = record.homeScore;
	const awayScore = record.awayScore;

	if (
		matchId === null ||
		homeScore === null ||
		homeScore === undefined ||
		awayScore === null ||
		awayScore === undefined
	) {
		return null;
	}

	return {
		matchId,
		homeScore: Number(homeScore),
		awayScore: Number(awayScore),
		shootoutWinner: parseShootoutWinner(record.shootoutWinner),
	};
}

export function parseRivalPronos(payload: unknown): RivalProno[] {
	const pronosRaw = extractArray(payload, ['pronos', 'predictions', 'userPronos', 'results']);
	const results: RivalProno[] = [];

	for (const item of pronosRaw) {
		const parsed = parseRivalProno(item);
		if (parsed) {
			results.push(parsed);
		}
	}

	return results;
}

export function parseMatchesPayload(payload: unknown): Match[] {
	const matchdays = Array.isArray(payload) ? payload : [];
	const results: Match[] = [];

	for (const day of matchdays as Array<{ matches?: unknown[]; name?: string }>) {
		for (const raw of Array.isArray(day.matches) ? day.matches : []) {
			const m = asRecord(raw);
			if (!m) continue;

			const matchId = parseInteger(m.matchId);
			if (matchId === null) continue;

			const homeTeamRaw = asRecord(m.homeTeam);
			const awayTeamRaw = asRecord(m.awayTeam);

			results.push({
				matchId,
				startTime: String(m.startTime ?? ''),
				status: String(m.status ?? ''),
				phaseName: parseOptionalString(m.phaseName),
				phaseType: parseOptionalString(m.phaseType),
				matchday: parseOptionalString(day.name),
				homeTeam: parseOptionalString(homeTeamRaw?.name),
				awayTeam: parseOptionalString(awayTeamRaw?.name),
				homeTeamId: parseInteger(homeTeamRaw?.id),
				awayTeamId: parseInteger(awayTeamRaw?.id),
				homeScore:
					parseInteger(homeTeamRaw?.score) ??
					parseInteger(m.homeScore),
				awayScore:
					parseInteger(awayTeamRaw?.score) ??
					parseInteger(m.awayScore),
			});
		}
	}

	return results;
}
