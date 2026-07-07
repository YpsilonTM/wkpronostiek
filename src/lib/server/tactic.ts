import type { Match, MatchWithProno } from '$lib/types/match';
import type { Prediction } from '$lib/types/prediction';
import type { GroupMember, GroupStandings } from '$lib/types/standings';
import type {
	ResolvedTacticMode,
	RivalProno,
	TacticConfig,
	TacticContext,
	TacticDecision,
} from '$lib/types/tactic';
import { getMemberByRank } from '$lib/types/tactic';
import { isKnockoutMatch } from './match-enrichment';

function isPlayableMatch(match: Match): boolean {
	const status = String(match.status || '').toUpperCase();
	return status !== 'END' && status !== 'FINISHED' && status !== 'CANCELLED';
}

export function countRemainingMatches(allMatches: Match[]): number {
	return allMatches.filter((match) => {
		if (!isPlayableMatch(match)) return false;
		return new Date(match.startTime) > new Date();
	}).length;
}

export interface DecideTacticInput {
	config: TacticConfig;
	standings: GroupStandings | null;
	allMatches: Match[];
	myUserId: string | null;
	matchesInBatch: Match[];
}

function shouldMirrorByAutoCriteria(input: DecideTacticInput): TacticDecision | null {
	const { config, standings, allMatches, myUserId, matchesInBatch } = input;

	if (!standings || standings.members.length === 0) {
		return null;
	}

	const me =
		(myUserId ? standings.members.find((m) => m.userId === myUserId) : undefined) ??
		getMemberByRank(standings.members, 1);

	if (me?.rank !== 1) {
		return null;
	}

	const rival = getMemberByRank(standings.members, config.mirrorRank);
	if (!rival) {
		return null;
	}

	const lead = me.points - rival.points;
	if (lead < config.leadThreshold) {
		return null;
	}

	const remaining = countRemainingMatches(allMatches);
	if (remaining > config.remainingMatches) {
		return null;
	}

	if (config.knockoutOnly) {
		const allKnockout = matchesInBatch.every((m) => isKnockoutMatch(m));
		if (!allKnockout) {
			return null;
		}
	}

	return {
		mode: 'mirror',
		reason: `#1 met +${lead} op #${config.mirrorRank}, ${remaining} wedstrijd(en) resterend`,
		rivalUserId: rival.userId,
		rivalName: rival.name,
		leadPoints: lead,
		myRank: me.rank,
	};
}

export function decideTactic(input: DecideTacticInput): TacticDecision {
	const { config } = input;

	if (config.mode === 'mirror') {
		const rival = input.standings
			? getMemberByRank(input.standings.members, config.mirrorRank)
			: undefined;
		return {
			mode: 'mirror',
			reason: 'TACTIC_MODE=mirror',
			rivalUserId: rival?.userId,
			rivalName: rival?.name,
		};
	}

	if (config.mode === 'ai_tactic') {
		return { mode: 'ai_tactic', reason: 'TACTIC_MODE=ai_tactic' };
	}

	if (config.mode === 'ai') {
		if (config.geminiContext && input.standings) {
			return { mode: 'ai_tactic', reason: 'TACTIC_GEMINI_CONTEXT=true' };
		}
		return { mode: 'ai', reason: 'TACTIC_MODE=ai' };
	}

	const autoMirror = shouldMirrorByAutoCriteria(input);
	if (autoMirror) {
		return autoMirror;
	}

	return {
		mode: config.autoFallback,
		reason: `Auto: criteria niet voldaan, fallback=${config.autoFallback}`,
	};
}

export function buildMirrorPredictions(
	matches: MatchWithProno[],
	rivalPronos: Map<number, RivalProno>,
	rivalName: string,
): Prediction[] {
	const predictions: Prediction[] = [];

	for (const match of matches) {
		const rival = rivalPronos.get(match.matchId);
		if (!rival) continue;

		predictions.push({
			matchId: match.matchId,
			homeTeam: match.homeTeam ?? '',
			awayTeam: match.awayTeam ?? '',
			homeScore: rival.homeScore,
			awayScore: rival.awayScore,
			shootoutWinner: rival.shootoutWinner,
			reasoning: `Endgame mirror: gekopieerd van ${rivalName}`,
			searchAnalysis: '',
			model: 'mirror',
			tactic: 'mirror',
			tacticLabel: `Spiegelt ${rivalName}`,
		});
	}

	return predictions;
}

export function buildTacticContext(
	standings: GroupStandings,
	myUserId: string | null,
	rival: GroupMember,
	_match: Match,
	rivalProno: RivalProno | null,
	allMatches: Match[],
): TacticContext {
	const me =
		(myUserId ? standings.members.find((m) => m.userId === myUserId) : undefined) ??
		getMemberByRank(standings.members, 1);
	const third = getMemberByRank(standings.members, 3);

	const myRank = me?.rank ?? 0;
	const myPoints = me?.points ?? 0;
	const leadOverRival = me ? me.points - rival.points : null;
	const leadOverThird = me && third ? me.points - third.points : null;

	return {
		groupName: standings.groupName,
		myRank,
		myPoints,
		leadOverRival,
		leadOverThird,
		rivalRank: rival.rank,
		rivalName: rival.name,
		rivalUserId: rival.userId,
		rivalPronoForMatch: rivalProno,
		remainingMatches: countRemainingMatches(allMatches),
	};
}

export function shouldInjectGeminiContext(decision: TacticDecision, config: TacticConfig): boolean {
	if (decision.mode === 'ai_tactic') return true;
	if (decision.mode === 'ai' && config.geminiContext) return true;
	return false;
}

export function formatTacticLabel(mode: ResolvedTacticMode, rivalName?: string): string | null {
	if (mode === 'mirror') {
		return rivalName ? `Spiegelt ${rivalName}` : 'Spiegelt rival';
	}
	if (mode === 'ai_tactic') {
		return 'AI + klassement';
	}
	return null;
}
