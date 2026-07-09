/** Sporza WK-pronostiek match scoring tiers (highest matching tier only). */
export const SPORZA_MATCH_POINTS = {
	exactScore: 20,
	goalDifference: 14,
	correctWinner: 10,
	participation: 1,
} as const;

export type SporzaScoreTier = 20 | 14 | 10 | 0;

export interface ScorePronoInput {
	homeScore: number;
	awayScore: number;
	shootoutWinner?: 0 | 1 | null;
}

export interface ScorePronoActual extends ScorePronoInput {
	/** Required for knockout draws when evaluating the 10-point tier. */
	actualShootoutWinner?: 0 | 1 | null;
}

export interface ScorePronoOptions {
	isKnockout: boolean;
}

function goalDifference(home: number, away: number): number {
	return home - away;
}

/** Group phase: home win / away win / draw. Knockout: advancing team (incl. penalties if level after 90 min). */
export function resolveOutcomeSide(
	scores: ScorePronoInput,
	isKnockout: boolean,
): 'home' | 'away' | 'draw' | null {
	const { homeScore, awayScore, shootoutWinner } = scores;

	if (homeScore > awayScore) return 'home';
	if (awayScore > homeScore) return 'away';

	if (!isKnockout) return 'draw';

	if (shootoutWinner === 0) return 'home';
	if (shootoutWinner === 1) return 'away';
	return null;
}

export function scoreProno(
	predicted: ScorePronoInput,
	actual: ScorePronoActual,
	options: ScorePronoOptions,
): SporzaScoreTier {
	const { homeScore: pH, awayScore: pA } = predicted;
	const { homeScore: aH, awayScore: aA } = actual;

	if (pH === aH && pA === aA) {
		return SPORZA_MATCH_POINTS.exactScore;
	}

	if (goalDifference(pH, pA) === goalDifference(aH, aA)) {
		return SPORZA_MATCH_POINTS.goalDifference;
	}

	const actualForOutcome: ScorePronoInput = {
		homeScore: aH,
		awayScore: aA,
		shootoutWinner: actual.actualShootoutWinner ?? actual.shootoutWinner ?? null,
	};

	const predictedSide = resolveOutcomeSide(predicted, options.isKnockout);
	const actualSide = resolveOutcomeSide(actualForOutcome, options.isKnockout);

	if (predictedSide && actualSide && predictedSide === actualSide) {
		return SPORZA_MATCH_POINTS.correctWinner;
	}

	return 0;
}

export function describeScoringRules(isKnockout: boolean): string {
	const base = [
		'PUNTENTELLING (per wedstrijd, hoogste passende tier telt — niet cumulatief):',
		`- ${SPORZA_MATCH_POINTS.exactScore} punten: exacte score na 90 minuten`,
		`- ${SPORZA_MATCH_POINTS.goalDifference} punten: juist doelpuntenverschil (saldo)`,
		`- ${SPORZA_MATCH_POINTS.correctWinner} punten: juiste winnende ploeg`,
		`- ${SPORZA_MATCH_POINTS.participation} punt: ingevulde prono zonder juiste tier (deelname)`,
	];

	if (isKnockout) {
		base.push(
			'Knock-out: voorspel de stand na 90 minuten. Bij gelijke stand na 90 min kies je ook de strafschoppenwinnaar.',
			'Er is geen gelijkspel als eindresultaat — 10 punten = juiste ploeg die doorgaat (incl. na strafschoppen).',
		);
	} else {
		base.push(
			'Groepsfase: gelijkspel na 90 minuten is een geldige uitslag; 10 punten = juiste uitkomst (thuiswinst / uitwinst / gelijk).',
		);
	}

	return base.join('\n');
}
