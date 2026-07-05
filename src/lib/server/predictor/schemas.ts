export const SINGLE_PREDICTION_SCHEMA = {
	type: 'object',
	properties: {
		matchId: { type: 'integer', description: 'Unique match id from the input.' },
		homeTeam: { type: 'string', description: 'Home team name.' },
		awayTeam: { type: 'string', description: 'Away team name.' },
		searchAnalysis: {
			type: 'string',
			description:
				'Detailed step-by-step analysis of recent news, H2H, current form, 2026 World Cup matches, and odds.',
		},
		homeScore: {
			type: 'integer',
			minimum: 0,
			description: 'Predicted home goals after 90 minutes.',
		},
		awayScore: {
			type: 'integer',
			minimum: 0,
			description: 'Predicted away goals after 90 minutes.',
		},
		shootoutWinner: {
			anyOf: [{ type: 'integer', enum: [0, 1] }, { type: 'null' }],
			description:
				'Penalty shootout winner when scores are tied after 90 minutes in knockout: 0 = home, 1 = away. Null otherwise.',
		},
		reasoning: {
			type: 'string',
			description: 'Short, 1-2 sentence final summary reasoning for the predicted score.',
		},
	},
	required: [
		'matchId',
		'homeTeam',
		'awayTeam',
		'searchAnalysis',
		'homeScore',
		'awayScore',
		'reasoning',
	],
	additionalProperties: false,
};

export const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
export const ESCALATION_MODEL = process.env.GEMINI_ESCALATION_MODEL || 'gemini-3.1-pro-preview';
export const REPAIR_MODEL = 'gemini-3.1-flash-lite';
