import type { Match, UserOverview } from '$lib/types/match';
import type { PronoSubmission } from '$lib/types/prediction';
import type { Settings } from '$lib/types/settings';
import type { GroupStandings } from '$lib/types/standings';
import type { RivalProno } from '$lib/types/tactic';
import { pinoLogger } from './logger';
import { getRivalPronosUrlCandidates, getStandingsUrlCandidates } from './pronotool/endpoints';
import {
	HttpStatusError,
	isForbiddenHttpError,
	isRetryableHttpError,
	isUnauthorizedHttpError,
	PronotoolParseError,
} from './pronotool/errors';
import {
	parseGroupStandings,
	parseMatchesPayload,
	parseRivalPronos,
	parseUserOverview,
} from './pronotool/parse';

export {
	HttpStatusError,
	isAuthHttpError,
	isForbiddenHttpError,
	isUnauthorizedHttpError,
	PronotoolParseError,
} from './pronotool/errors';

const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 1_000;

export class PronotoolApiClient {
	constructor(private settings: Settings) {}

	async fetchUserOverview(authorization: string): Promise<UserOverview> {
		const payload = await this.#fetchJson(
			this.settings.userOverviewApiUrl,
			{
				method: 'GET',
				headers: this.#authHeaders(authorization),
			},
			{ retryOnTransient: true },
		);

		const parsed = parseUserOverview(payload);
		return {
			userId: parsed.userId,
			groups: parsed.groups,
			embeddedStandings: parsed.embeddedStandings,
			pronos: parsed.pronos,
			sourcePayload: payload,
		};
	}

	async fetchGroupStandings(authorization: string, groupId: string): Promise<GroupStandings> {
		return this.fetchGroupStandingsWithFallback(authorization, groupId);
	}

	async fetchGroupStandingsWithFallback(
		authorization: string,
		groupId: string,
	): Promise<GroupStandings> {
		const urls = getStandingsUrlCandidates(this.settings.tactic.standingsApiUrl, groupId);
		let lastError: Error | undefined;

		for (const url of urls) {
			try {
				const payload = await this.#fetchJson(
					url,
					{
						method: 'GET',
						headers: this.#authHeaders(authorization),
					},
					{ retryOnTransient: true },
				);

				const standings = parseGroupStandings(
					payload,
					groupId,
					this.settings.tactic.groupName || groupId,
				);

				if (standings.members.length === 0) {
					lastError = new PronotoolParseError('Standings response bevat geen leden', url);
					pinoLogger.debug({ url, groupId }, 'Standings URL gaf lege ledenlijst');
					continue;
				}

				if (!standings.complete) {
					pinoLogger.debug(
						{ url, groupId, memberCount: standings.members.length },
						'Standings URL gaf onvolledig klassement; probeer volgende URL',
					);
					lastError = new PronotoolParseError(
						`Standings response bevat slechts ${standings.members.length} lid/leden`,
						url,
					);
					continue;
				}

				pinoLogger.debug(
					{ url, groupId, memberCount: standings.members.length },
					'Standings geladen',
				);
				return standings;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (isUnauthorizedHttpError(error)) {
					throw error;
				}

				if (error instanceof HttpStatusError && error.status === 404) {
					pinoLogger.debug({ url, groupId, status: error.status }, 'Standings URL niet gevonden');
					continue;
				}

				if (isForbiddenHttpError(error)) {
					pinoLogger.debug({ url, groupId }, 'Standings URL forbidden; probeer volgende');
					continue;
				}

				pinoLogger.debug(
					{ url, groupId, err: lastError.message },
					'Standings URL mislukt; probeer volgende',
				);
			}
		}

		throw lastError ?? new Error(`Geen werkende standings URL voor group ${groupId}`);
	}

	async fetchRivalPronos(
		authorization: string,
		userId: string,
		groupId: string,
	): Promise<RivalProno[]> {
		return this.fetchRivalPronosWithFallback(authorization, userId, groupId);
	}

	async fetchRivalPronosWithFallback(
		authorization: string,
		userId: string,
		groupId: string,
		groupCode?: string,
	): Promise<RivalProno[]> {
		const urls = getRivalPronosUrlCandidates(
			this.settings.tactic.rivalPronosApiUrl,
			userId,
			groupId,
			groupCode,
		);
		let lastError: Error | undefined;

		for (const url of urls) {
			try {
				const payload = await this.#fetchJson(
					url,
					{
						method: 'GET',
						headers: this.#authHeaders(authorization),
					},
					{ retryOnTransient: true },
				);

				const pronos = parseRivalPronos(payload);
				pinoLogger.debug(
					{ url, userId, groupId, pronoCount: pronos.length },
					'Rival-pronos geladen',
				);
				return pronos;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (isUnauthorizedHttpError(error)) {
					throw error;
				}

				if (error instanceof HttpStatusError && error.status === 404) {
					pinoLogger.debug({ url, userId, status: error.status }, 'Rival-pronos URL niet gevonden');
					continue;
				}

				if (isForbiddenHttpError(error)) {
					pinoLogger.debug(
						{ url, userId, groupId, groupCode },
						'Rival-pronos URL forbidden (vaak: nog niet zichtbaar); probeer volgende',
					);
					continue;
				}

				pinoLogger.debug(
					{ url, userId, err: lastError.message },
					'Rival-pronos URL mislukt; probeer volgende',
				);
			}
		}

		throw lastError ?? new Error(`Geen werkende rival-pronos URL voor user ${userId}`);
	}

	async fetchMatches(): Promise<Match[]> {
		const payload = await this.#fetchJson(
			this.settings.matchesApiUrl,
			{
				method: 'GET',
				headers: {
					accept: '*/*',
					origin: 'https://wkpronostiek.sporza.be',
					referer: 'https://wkpronostiek.sporza.be/',
				},
			},
			{ retryOnTransient: true },
		);

		return parseMatchesPayload(payload);
	}

	async isAuthorizationValid(authorization: string): Promise<boolean> {
		try {
			await this.fetchUserOverview(authorization);
			return true;
		} catch (error) {
			if (isUnauthorizedHttpError(error)) {
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

		await this.#fetchJson(
			this.settings.pronoApiUrl,
			{
				method: 'POST',
				headers: {
					...this.#authHeaders(authorization),
					'content-type': 'application/json',
				},
				body: JSON.stringify(payload),
			},
			{ retryOnTransient: true, expectJson: false },
		);

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

	async #fetchJson(
		url: string,
		options: RequestInit,
		config: { retryOnTransient?: boolean; expectJson?: boolean } = {},
	): Promise<unknown> {
		const { retryOnTransient = false, expectJson = true } = config;
		let lastError: unknown;

		for (let attempt = 0; attempt < (retryOnTransient ? 2 : 1); attempt += 1) {
			try {
				const response = await this.#fetchWithTimeout(url, options);
				await this.#raiseForStatus(response, url);

				if (!expectJson) {
					return null;
				}

				return await this.#parseJsonBody(response, url);
			} catch (error) {
				lastError = error;
				if (!retryOnTransient || attempt > 0 || !isRetryableHttpError(error)) {
					throw error;
				}
				pinoLogger.debug({ url, attempt: attempt + 1 }, 'Tijdelijke API-fout; opnieuw proberen');
				await this.#sleep(RETRY_DELAY_MS);
			}
		}

		throw lastError;
	}

	async #raiseForStatus(response: Response, url: string): Promise<void> {
		if (response.ok) {
			return;
		}

		const text = await response.text();
		throw new HttpStatusError(response.status, text || `HTTP ${response.status}`, url);
	}

	async #parseJsonBody(response: Response, url: string): Promise<unknown> {
		const text = await response.text();
		if (!text.trim()) {
			return null;
		}

		try {
			return JSON.parse(text);
		} catch {
			throw new PronotoolParseError(`Ongeldige JSON-response van ${url}`, url);
		}
	}

	async #fetchWithTimeout(
		url: string,
		options: RequestInit,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	): Promise<Response> {
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

	#sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
