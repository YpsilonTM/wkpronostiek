import type { Match, UserOverview, UserProno } from '$lib/types/match';
import type { PronoSubmission } from '$lib/types/prediction';
import type { Settings } from '$lib/types/settings';

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
			pronos: pronosRaw
				.map((item: unknown) => this.#parseProno(item))
				.filter(Boolean) as UserProno[],
		};
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
}
