import type { Match, UserOverview, UserProno } from '$lib/types/match';
import type { PronoSubmission } from '$lib/types/prediction';
import type { Settings } from '$lib/types/settings';
import type { GroupMember, GroupStandings, GroupSummary } from '$lib/types/standings';
import type { RivalProno } from '$lib/types/tactic';

class HttpStatusError extends Error {
	status: number;

	constructor(status: number, message?: string) {
		super(message || `HTTP ${status}`);
		this.name = 'HttpStatusError';
		this.status = status;
	}
}

export class PronotoolApiClient {
	constructor(private settings: Settings) {}

	async fetchUserOverview(authorization: string): Promise<UserOverview> {
		const response = await this.#fetchWithTimeout(this.settings.userOverviewApiUrl, {
			method: 'GET',
			headers: this.#authHeaders(authorization),
		});
		await this.#raiseForStatus(response);

		const payload = await response.json();
		const pronosRaw = Array.isArray(payload?.pronos) ? payload.pronos : [];

		return {
			userId: this.#parseOptionalString(payload?.userId ?? payload?.user?.id),
			groups: this.#parseGroups(payload),
			pronos: pronosRaw
				.map((item: unknown) => this.#parseProno(item))
				.filter(Boolean) as UserProno[],
		};
	}

	async fetchGroupStandings(authorization: string, groupId: string): Promise<GroupStandings> {
		const url = this.#expandUrl(this.settings.tactic.standingsApiUrl, { groupId });
		const response = await this.#fetchWithTimeout(url, {
			method: 'GET',
			headers: this.#authHeaders(authorization),
		});
		await this.#raiseForStatus(response);

		const payload = await response.json();
		const groupName =
			this.#parseOptionalString(payload?.name ?? payload?.groupName) ||
			this.settings.tactic.groupName ||
			groupId;
		const members = this.#parseStandingsMembers(payload);

		return { groupId, groupName, members };
	}

	async fetchRivalPronos(
		authorization: string,
		userId: string,
		groupId: string,
	): Promise<RivalProno[]> {
		const url = this.#expandUrl(this.settings.tactic.rivalPronosApiUrl, { userId, groupId });
		const response = await this.#fetchWithTimeout(url, {
			method: 'GET',
			headers: this.#authHeaders(authorization),
		});
		await this.#raiseForStatus(response);

		const payload = await response.json();
		const pronosRaw = Array.isArray(payload?.pronos)
			? payload.pronos
			: Array.isArray(payload)
				? payload
				: [];

		const results: RivalProno[] = [];
		for (const item of pronosRaw) {
			const parsed = this.#parseRivalProno(item);
			if (parsed) {
				results.push(parsed);
			}
		}
		return results;
	}

	async fetchMatches(): Promise<Match[]> {
		const response = await this.#fetchWithTimeout(this.settings.matchesApiUrl, {
			method: 'GET',
			headers: {
				accept: '*/*',
				origin: 'https://wkpronostiek.sporza.be',
				referer: 'https://wkpronostiek.sporza.be/',
			},
		});
		await this.#raiseForStatus(response);

		const payload = await response.json();
		const matchdays = Array.isArray(payload) ? payload : [];

		const results: Match[] = [];

		for (const day of matchdays as Array<{ matches?: unknown[]; name?: string }>) {
			for (const raw of Array.isArray(day.matches) ? day.matches : []) {
				const m = raw as Record<string, unknown>;
				const matchId = Number(m.matchId);
				if (!Number.isInteger(matchId)) {
					continue;
				}
				const homeTeamRaw = m.homeTeam as { id?: number; name?: string } | null;
				const awayTeamRaw = m.awayTeam as { id?: number; name?: string } | null;

				results.push({
					matchId,
					startTime: m.startTime as string,
					status: m.status as string,
					phaseName: (m.phaseName as string) ?? null,
					phaseType: (m.phaseType as string) ?? null,
					matchday: (day.name as string) ?? null,
					homeTeam: homeTeamRaw?.name ?? null,
					awayTeam: awayTeamRaw?.name ?? null,
					homeTeamId: homeTeamRaw?.id ?? null,
					awayTeamId: awayTeamRaw?.id ?? null,
					homeScore: Number.isInteger((m.homeTeam as { score?: number })?.score)
						? ((m.homeTeam as { score: number }).score as number)
						: Number.isInteger(m.homeScore)
							? (m.homeScore as number)
							: null,
					awayScore: Number.isInteger((m.awayTeam as { score?: number })?.score)
						? ((m.awayTeam as { score: number }).score as number)
						: Number.isInteger(m.awayScore)
							? (m.awayScore as number)
							: null,
				});
			}
		}

		return results;
	}

	async isAuthorizationValid(authorization: string): Promise<boolean> {
		try {
			await this.fetchUserOverview(authorization);
			return true;
		} catch (error) {
			if (error instanceof HttpStatusError && (error.status === 401 || error.status === 403)) {
				return false;
			}
			throw error;
		}
	}

	async setPronos(authorization: string, pronos: PronoSubmission[]): Promise<number> {
		const payload = pronos.map((prono) => ({
			matchId: prono.matchId,
			modifiedTime: prono.modifiedTime ?? null,
			homeScore: Number(prono.homeScore),
			awayScore: Number(prono.awayScore),
			shootoutWinner: prono.shootoutWinner ?? null,
			points: prono.points ?? null,
		}));

		const response = await this.#fetchWithTimeout(this.settings.pronoApiUrl, {
			method: 'POST',
			headers: {
				...this.#authHeaders(authorization),
				'content-type': 'application/json',
			},
			body: JSON.stringify(payload),
		});

		await this.#raiseForStatus(response);
		return payload.length;
	}

	#authHeaders(authorization: string): Record<string, string> {
		return {
			accept: '*/*',
			authorization,
			origin: 'https://wkpronostiek.sporza.be',
			referer: 'https://wkpronostiek.sporza.be/',
		};
	}

	#expandUrl(template: string, params: Record<string, string>): string {
		let url = template;
		for (const [key, value] of Object.entries(params)) {
			url = url.replaceAll(`{${key}}`, encodeURIComponent(value));
		}
		return url;
	}

	async #raiseForStatus(response: Response): Promise<void> {
		if (response.ok) {
			return;
		}

		const text = await response.text();
		throw new HttpStatusError(response.status, text || `HTTP ${response.status}`);
	}

	async #fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 30000): Promise<Response> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			return await fetch(url, {
				...options,
				signal: controller.signal,
			});
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
			}
			throw error;
		} finally {
			clearTimeout(timer);
		}
	}

	#parseOptionalString(value: unknown): string | null {
		if (value === null || value === undefined) return null;
		const text = String(value).trim();
		return text || null;
	}

	#parseGroups(payload: Record<string, unknown>): GroupSummary[] {
		const rawGroups = payload.groups ?? payload.competitions ?? payload.minicompetitions;
		if (!Array.isArray(rawGroups)) {
			return [];
		}

		const groups: GroupSummary[] = [];
		for (const item of rawGroups) {
			if (!item || typeof item !== 'object') continue;
			const record = item as Record<string, unknown>;
			const id = this.#parseOptionalString(record.id ?? record.groupId);
			const name = this.#parseOptionalString(record.name ?? record.groupName);
			if (!id || !name) continue;

			groups.push({
				id,
				name,
				rank: Number.isInteger(record.rank) ? (record.rank as number) : null,
				points: Number.isInteger(record.points) ? (record.points as number) : null,
			});
		}
		return groups;
	}

	#parseStandingsMembers(payload: unknown): GroupMember[] {
		const record =
			payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
		const raw =
			record.members ??
			record.standings ??
			record.ranking ??
			record.participants ??
			(Array.isArray(payload) ? payload : []);

		if (!Array.isArray(raw)) {
			return [];
		}

		const members: GroupMember[] = [];
		for (let index = 0; index < raw.length; index += 1) {
			const item = raw[index];
			if (!item || typeof item !== 'object') continue;
			const row = item as Record<string, unknown>;
			const userId = this.#parseOptionalString(
				row.userId ?? row.id ?? (row.user as { id?: string } | undefined)?.id,
			);
			const name = this.#parseOptionalString(
				row.name ?? row.displayName ?? (row.user as { name?: string } | undefined)?.name,
			);
			const points = Number(row.points ?? row.score ?? row.totalPoints ?? 0);
			const rank = Number.isInteger(row.rank)
				? (row.rank as number)
				: Number.isInteger(row.position)
					? (row.position as number)
					: index + 1;

			if (!userId || !name) continue;
			members.push({ userId, name, rank, points: Number.isFinite(points) ? points : 0 });
		}

		return members.sort((a, b) => a.rank - b.rank);
	}

	#parseProno(item: unknown): UserProno | null {
		if (!item || typeof item !== 'object') {
			return null;
		}

		const record = item as Record<string, unknown>;
		const homeScore = record.homeScore ?? null;
		const awayScore = record.awayScore ?? null;
		const matchId = Number(record.matchId);

		if (!Number.isInteger(matchId)) {
			return null;
		}

		return {
			matchId,
			homeScore: homeScore === null ? null : Number(homeScore),
			awayScore: awayScore === null ? null : Number(awayScore),
			modifiedTime: typeof record.modifiedTime === 'string' ? record.modifiedTime : null,
			points: Number.isInteger(record.points) ? (record.points as number) : null,
		};
	}

	#parseRivalProno(item: unknown): RivalProno | null {
		if (!item || typeof item !== 'object') {
			return null;
		}

		const record = item as Record<string, unknown>;
		const matchId = Number(record.matchId);
		const homeScore = record.homeScore;
		const awayScore = record.awayScore;

		if (
			!Number.isInteger(matchId) ||
			homeScore === null ||
			homeScore === undefined ||
			awayScore === null ||
			awayScore === undefined
		) {
			return null;
		}

		const shootoutRaw = record.shootoutWinner;
		const shootoutWinner = shootoutRaw === 0 || shootoutRaw === 1 ? (shootoutRaw as 0 | 1) : null;

		return {
			matchId,
			homeScore: Number(homeScore),
			awayScore: Number(awayScore),
			shootoutWinner,
		};
	}
}
