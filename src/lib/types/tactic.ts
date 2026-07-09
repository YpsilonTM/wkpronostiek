import type { GroupMember, GroupStandings } from './standings';

export type TacticMode = 'ai' | 'ai_tactic' | 'mirror' | 'auto';
export type TacticAutoFallback = 'ai' | 'ai_tactic';
export type ResolvedTacticMode = 'ai' | 'ai_tactic' | 'mirror';

export interface TacticConfig {
	mode: TacticMode;
	groupName: string;
	groupId: string;
	groupCode: string;
	mirrorRank: number;
	leadThreshold: number;
	/** Min. voorsprong op achtervolgers (#3+) om blind te spiegelen (default 40) */
	cautionLead: number;
	/** Kritieke drempel — onder deze voorsprong op elke achtervolger: geen spiegel (default 20) */
	criticalLead: number;
	remainingMatches: number;
	knockoutOnly: boolean;
	autoFallback: TacticAutoFallback;
	geminiContext: boolean;
	overwrite: boolean;
	standingsApiUrl: string;
	rivalPronosApiUrl: string;
}

export interface TacticDecision {
	mode: ResolvedTacticMode;
	reason: string;
	rivalUserId?: string;
	rivalName?: string;
	leadPoints?: number;
	myRank?: number;
	dangerLevel?: TacticDangerLevel;
	chasers?: ChaserThreat[];
	maxCatchUpPoints?: number;
}

export type TacticDangerLevel = 'safe' | 'caution' | 'critical';

export interface ChaserThreat {
	rank: number;
	userId: string;
	name: string;
	leadPoints: number;
}

export interface MirrorSafetyAnalysis {
	canMirror: boolean;
	dangerLevel: TacticDangerLevel;
	maxCatchUpPoints: number;
	chasers: ChaserThreat[];
	blockReason?: string;
}

export interface RivalProno {
	matchId: number;
	homeScore: number;
	awayScore: number;
	shootoutWinner: 0 | 1 | null;
}

export interface TacticContext {
	groupName: string;
	myRank: number;
	myPoints: number;
	leadOverRival: number | null;
	leadOverThird: number | null;
	rivalRank: number;
	rivalName: string;
	rivalUserId: string;
	rivalPronoForMatch: RivalProno | null;
	remainingMatches: number;
	dangerLevel: TacticDangerLevel;
	maxCatchUpPoints: number;
	chasers: ChaserThreat[];
}

export interface TacticSnapshot {
	decision: TacticDecision;
	standings: GroupStandings | null;
	rivalPronosByMatchId: Map<number, RivalProno>;
	myUserId: string | null;
}

export function getMemberByRank(members: GroupMember[], rank: number): GroupMember | undefined {
	return members.find((m) => m.rank === rank);
}

/** Resolve the current user in standings, falling back to #1 when userId is unknown. */
export function resolveMyMember(
	standings: GroupStandings,
	myUserId: string | null,
): GroupMember | undefined {
	if (myUserId) {
		const byId = standings.members.find((m) => m.userId === myUserId);
		if (byId) return byId;
	}
	return getMemberByRank(standings.members, 1);
}
