export interface Match {
	matchId: number | string;
	startTime: string;
	status: string;
	phaseName: string | null;
	matchday: string | null;
	homeTeam: string | null;
	awayTeam: string | null;
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
}

export interface UserProno {
	matchId: string;
	homeScore: number | null;
	awayScore: number | null;
	modifiedTime: string | null;
	points: number | null;
}

export interface UserOverview {
	pronos: UserProno[];
	userName: string | null;
	groupNames: string[];
}
