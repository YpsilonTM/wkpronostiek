import type { AccuracyStats } from './prediction';

export interface SseLogEvent {
	type: 'log';
	level: number;
	message: string;
}

export interface SsePredictionEvent {
	type: 'prediction';
	matchId: number;
	homeTeam: string | null;
	awayTeam: string | null;
	homeScore: number;
	awayScore: number;
	reasoning: string;
	searchAnalysis: string;
	model: string | null;
	escalated: boolean;
	autoPredicted: boolean;
}

export interface SseAccuracyEvent extends AccuracyStats {
	type: 'accuracy';
}

export interface SsePredictionFailedEvent {
	type: 'prediction-failed';
	matchId: number;
	reason?: string;
}

export type SseEvent =
	| SseLogEvent
	| SsePredictionEvent
	| SsePredictionFailedEvent
	| SseAccuracyEvent;
