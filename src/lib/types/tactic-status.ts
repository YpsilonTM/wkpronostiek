import type { GroupStandingsSource } from '$lib/types/standings';
import type {
	ChaserThreat,
	ResolvedTacticMode,
	TacticDangerLevel,
	TacticMode,
} from '$lib/types/tactic';

export interface TacticStatus {
	enabled: boolean;
	configuredMode: TacticMode;
	resolvedMode: ResolvedTacticMode;
	reason: string;
	groupId: string | null;
	groupName: string | null;
	standingsComplete: boolean;
	standingsSource: GroupStandingsSource | null;
	myRank: number | null;
	myPoints: number | null;
	rivalName: string | null;
	rivalRank: number | null;
	rivalPoints: number | null;
	leadPoints: number | null;
	remainingMatches: number | null;
	dangerLevel: TacticDangerLevel | null;
	chasers: ChaserThreat[];
	maxCatchUpPoints: number | null;
	mirrorReady: boolean;
	mirrorCoverage: {
		withRivalProno: number;
		total: number;
	};
}
