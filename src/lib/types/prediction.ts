import type { TacticContext } from './tactic';

export interface Prediction {
	matchId: number;
	homeTeam: string;
	awayTeam: string;
	homeScore: number;
	awayScore: number;
	shootoutWinner: 0 | 1 | null;
	reasoning: string;
	searchAnalysis: string;
	model?: string;
	escalated?: boolean;
	tactic?: 'ai' | 'ai_tactic' | 'mirror';
	tacticLabel?: string | null;
}

export interface PronoSubmission {
	matchId: number;
	homeScore: number;
	awayScore: number;
	shootoutWinner: 0 | 1 | null;
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
	tacticContext?: TacticContext;
	injectGeminiContext?: boolean;
}
