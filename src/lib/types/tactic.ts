import type { GroupMember, GroupStandings } from './standings';

export type TacticMode = 'ai' | 'ai_tactic' | 'mirror' | 'auto';
export type TacticAutoFallback = 'ai' | 'ai_tactic';
export type ResolvedTacticMode = 'ai' | 'ai_tactic' | 'mirror';

export interface TacticConfig {
	mode: TacticMode;
	groupName: string;
	groupId: string;
	mirrorRank: number;
	leadThreshold: number;
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
