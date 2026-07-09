import { SPORZA_MATCH_POINTS } from '$lib/scoring';
import type { GroupMember, GroupStandings } from '$lib/types/standings';
import type { ChaserThreat, MirrorSafetyAnalysis, TacticConfig, TacticDangerLevel } from '$lib/types/tactic';

export function maxCatchUpPoints(remainingMatches: number): number {
	return Math.max(0, remainingMatches) * SPORZA_MATCH_POINTS.exactScore;
}

/** True when a chaser can still overtake #1 given remaining matches (max 20 pt per match). */
export function canChaserStillCatchUp(chaser: ChaserThreat, maxCatchUp: number): boolean {
	return chaser.leadPoints <= maxCatchUp;
}

export function filterCatchableChasers(
	chasers: ChaserThreat[],
	maxCatchUp: number,
): ChaserThreat[] {
	return chasers.filter((chaser) => canChaserStillCatchUp(chaser, maxCatchUp));
}

export function listChasers(me: GroupMember, standings: GroupStandings): ChaserThreat[] {
	return standings.members
		.filter((member) => member.rank > me.rank)
		.map((member) => ({
			rank: member.rank,
			userId: member.userId,
			name: member.name,
			leadPoints: me.points - member.points,
		}))
		.sort((a, b) => a.rank - b.rank);
}

function resolveDangerLevel(
	chasers: ChaserThreat[],
	threatsAfterMirror: ChaserThreat[],
	config: TacticConfig,
	canMirror: boolean,
): TacticDangerLevel {
	if (canMirror) {
		return 'safe';
	}
	if (threatsAfterMirror.some((chaser) => chaser.leadPoints < config.criticalLead)) {
		return 'critical';
	}
	if (chasers.some((chaser) => chaser.leadPoints < config.criticalLead)) {
		return 'critical';
	}
	if (
		threatsAfterMirror.some((chaser) => chaser.leadPoints < config.cautionLead) ||
		chasers.some((chaser) => chaser.leadPoints < config.cautionLead)
	) {
		return 'caution';
	}
	return 'caution';
}

export function analyzeMirrorSafety(
	me: GroupMember,
	standings: GroupStandings,
	remainingMatches: number,
	config: TacticConfig,
	leadOverMirror: number,
): MirrorSafetyAnalysis {
	const maxCatchUp = maxCatchUpPoints(remainingMatches);
	const chasers = listChasers(me, standings);
	const threatsAfterMirror = chasers.filter((chaser) => chaser.rank > config.mirrorRank);

	let blockReason: string | undefined;

	if (leadOverMirror < config.leadThreshold) {
		blockReason = `voorsprong op #${config.mirrorRank} (${leadOverMirror}) onder drempel ${config.leadThreshold}`;
	}

	const third = threatsAfterMirror.find((chaser) => chaser.rank === 3);
	if (third && third.leadPoints < maxCatchUp) {
		blockReason = `#3 kan nog inhalen: +${third.leadPoints} < max. swing ${maxCatchUp} (${remainingMatches}×20 pt)`;
	}

	const cautiousThreat = threatsAfterMirror.find(
		(chaser) => chaser.leadPoints < config.cautionLead,
	);
	if (cautiousThreat) {
		blockReason = `voorsprong op #${cautiousThreat.rank} (+${cautiousThreat.leadPoints}) onder voorzichtigheidsdrempel ${config.cautionLead}`;
	}

	const criticalThreat = threatsAfterMirror.find(
		(chaser) => chaser.leadPoints < config.criticalLead,
	);
	if (criticalThreat) {
		blockReason = `kritiek: slechts +${criticalThreat.leadPoints} op #${criticalThreat.rank} (${criticalThreat.name})`;
	}

	const canMirror = !blockReason;

	return {
		canMirror,
		dangerLevel: resolveDangerLevel(chasers, threatsAfterMirror, config, canMirror),
		maxCatchUpPoints: maxCatchUp,
		chasers,
		blockReason,
	};
}
