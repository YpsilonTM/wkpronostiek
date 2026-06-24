export interface Prediction {
	matchId: number;
	homeTeam: string;
	awayTeam: string;
	homeScore: number;
	awayScore: number;
	reasoning: string;
	searchAnalysis: string;
	model?: string;
	escalated?: boolean;
}

export interface PronoSubmission {
	matchId: number | string;
	homeScore: number;
	awayScore: number;
	modifiedTime: string | null;
	points: number | null;
}

export interface PredictionLogEntry {
	loggedAt: string;
	matchId: number;
	homeTeam: string | null;
	awayTeam: string | null;
	phaseName: string | null;
	startTime: string | null;
	predictedHome: number;
	predictedAway: number;
	model: string | null;
	escalated: boolean;
}

export interface AccuracyStats {
	evaluated: number;
	exactHits: number;
	outcomeHits: number;
	exactPct: number;
	outcomePct: number;
}

export interface PredictMatchesOptions {
	onDebug?: (message: string) => void;
}
