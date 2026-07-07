export interface Match {
	matchId: number;
	startTime: string;
	status: string;
	phaseName: string | null;
	phaseType: string | null;
	matchday: string | null;
	homeTeam: string | null;
	awayTeam: string | null;
	homeTeamId: number | null;
	awayTeamId: number | null;
	homeScore: number | null;
	awayScore: number | null;
}

export interface MatchWithProno extends Match {
	currentHomeScore: number | null;
	currentAwayScore: number | null;
}

export interface EnrichedMatch extends MatchWithProno {
	minutesUntilStart: number;
	submitted: boolean;
	autoPredictScheduled: boolean;
	autoPredictAt: string;
	teamsConfirmed: boolean;
	reasoning?: string;
	searchAnalysis?: string;
	tactic?: 'ai' | 'ai_tactic' | 'mirror' | null;
	tacticLabel?: string | null;
}

export interface UserOverview {
	userId?: string | null;
	pronos: UserProno[];
	groups?: import('./standings').GroupSummary[];
}

export interface UserProno {
	matchId: number;
	homeScore: number | null;
	awayScore: number | null;
	modifiedTime: string | null;
	points: number | null;
}
