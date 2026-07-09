import type { TacticStatus } from '$lib/types/tactic-status';
import { getSettings } from '../config';
import { isTacticEnabled } from './app-settings-service';
import { attachCurrentPronos, isWithinAutoPredictWindow } from '../match-enrichment';
import { PronotoolApiClient } from '../pronotool-api';
import { countRemainingMatches } from '../tactic';
import { filterCatchableChasers, maxCatchUpPoints } from '../tactic-safety';
import { getRivalFromSnapshot, loadTacticSnapshot } from '../tactic-service';
import { isStandingsUsableForMirror } from '../standings';
import { fetchMatchesCached, fetchUserPronosByMatchId } from './pronotool-service';

let _cache: TacticStatus | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60_000;

export async function getTacticStatus(forceRefresh = false): Promise<TacticStatus> {
	const now = Date.now();
	if (!forceRefresh && _cache && now - _cacheTime <= CACHE_TTL_MS) {
		return _cache;
	}

	const settings = getSettings();
	const tacticDisabled = !isTacticEnabled();

	if (tacticDisabled) {
		_cache = {
			enabled: false,
			configuredMode: settings.tactic.mode,
			resolvedMode: 'ai',
			reason: 'Eindfase-tactiek uitgeschakeld',
			groupId: null,
			groupName: null,
			standingsComplete: false,
			standingsSource: null,
			myRank: null,
			myPoints: null,
			rivalName: null,
			rivalRank: null,
			rivalPoints: null,
			leadPoints: null,
		remainingMatches: null,
		dangerLevel: null,
		chasers: [],
		maxCatchUpPoints: null,
		mirrorReady: false,
			mirrorCoverage: { withRivalProno: 0, total: 0 },
		};
		_cacheTime = now;
		return _cache;
	}

	const api = new PronotoolApiClient(settings);
	const allMatches = await fetchMatchesCached(settings);
	const userPronosByMatchId = await fetchUserPronosByMatchId(settings, api);
	const upcomingInWindow = attachCurrentPronos(
		allMatches.filter((match) => isWithinAutoPredictWindow(match.startTime, now)),
		userPronosByMatchId,
	);

	const snapshot = await loadTacticSnapshot(settings, api, allMatches, upcomingInWindow);
	const rival = getRivalFromSnapshot(snapshot);
	const standings = snapshot.standings;

	const myMember =
		standings && snapshot.myUserId
			? standings.members.find((m) => m.userId === snapshot.myUserId)
			: standings?.members.find((m) => m.rank === (standings.members[0]?.rank ?? 1));

	const rivalMember =
		rival && standings ? standings.members.find((m) => m.userId === rival.userId) : null;

	let mirrorCoverage = { withRivalProno: 0, total: upcomingInWindow.length };
	if (snapshot.decision.mode === 'mirror' && upcomingInWindow.length > 0) {
		mirrorCoverage = {
			total: upcomingInWindow.length,
			withRivalProno: upcomingInWindow.filter((match) =>
				snapshot.rivalPronosByMatchId.has(match.matchId),
			).length,
		};
	}

	const leadPoints =
		myMember && rivalMember ? myMember.points - rivalMember.points : (snapshot.decision.leadPoints ?? null);

	const remainingMatches = countRemainingMatches(allMatches);
	const maxCatchUp = snapshot.decision.maxCatchUpPoints ?? maxCatchUpPoints(remainingMatches);
	const allChasers = snapshot.decision.chasers ?? [];
	const catchableChasers = filterCatchableChasers(allChasers, maxCatchUp);

	_cache = {
		enabled: true,
		configuredMode: settings.tactic.mode,
		resolvedMode: snapshot.decision.mode,
		reason: snapshot.decision.reason,
		groupId: standings?.groupId ?? null,
		groupName: standings?.groupName ?? null,
		standingsComplete: isStandingsUsableForMirror(standings),
		standingsSource: standings?.source ?? null,
		myRank: myMember?.rank ?? snapshot.decision.myRank ?? null,
		myPoints: myMember?.points ?? null,
		rivalName: rival?.name ?? snapshot.decision.rivalName ?? null,
		rivalRank: rival?.rank ?? null,
		rivalPoints: rivalMember?.points ?? null,
		leadPoints,
		remainingMatches,
		dangerLevel: snapshot.decision.dangerLevel ?? null,
		chasers: catchableChasers,
		maxCatchUpPoints: maxCatchUp,
		mirrorReady:
			snapshot.decision.mode === 'mirror' &&
			mirrorCoverage.total > 0 &&
			mirrorCoverage.withRivalProno === mirrorCoverage.total,
		mirrorCoverage,
	};
	_cacheTime = now;
	return _cache;
}

export function invalidateTacticStatusCache(): void {
	_cache = null;
	_cacheTime = 0;
}
