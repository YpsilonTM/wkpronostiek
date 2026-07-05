import { GoogleGenAI } from '@google/genai';
import type { MatchWithProno } from '$lib/types/match';
import type { Prediction, PredictMatchesOptions } from '$lib/types/prediction';
import { isKnockoutMatch } from '../match-enrichment';
import {
	compactText,
	needsEscalation,
	normalizePrediction,
	tryParsePrediction,
	validatePrediction,
} from './parse-response';
import { DEFAULT_MODEL, ESCALATION_MODEL, REPAIR_MODEL, SINGLE_PREDICTION_SCHEMA } from './schemas';

function hasCurrentProno(match: MatchWithProno): boolean {
	return Number.isInteger(match.currentHomeScore) && Number.isInteger(match.currentAwayScore);
}

function describePhaseContext(phaseName: string | null): string {
	const phase = String(phaseName || '').toLowerCase();

	if (phase.includes('groep') || phase.includes('group')) {
		return 'Groepsfase: teams kunnen roteren als kwalificatie al/zeker is. Weeg puntenbehoefte, doelsaldo en risico-afweging (veilig vs. alles op de tafel).';
	}
	if (phase.includes('achtste') || phase.includes('round of 16') || phase.includes('1/8')) {
		return 'Achtste finales (knock-out): één slechte match = uit. Verwacht voorzichtiger spel, minder open verdedigingen, en mogelijk verlenging/strafschoppen in werkelijkheid — maar jij voorspelt enkel de stand na 90 minuten.';
	}
	if (phase.includes('kwart') || phase.includes('quarter')) {
		return 'Kwartfinales: hoge druk, weinig marges. Sterke teams spelen vaak compact weg van huis.';
	}
	if (phase.includes('half') || phase.includes('semi')) {
		return 'Halve finales: extreem belangrijk, vaak tactisch gebalanceerd en lage tot middelmatige scorelijnen tenzij één team duidelijk dominant is.';
	}
	if (phase.includes('finale') || phase.includes('final')) {
		return 'Finale: maximale druk; historisch vaak krappe scorelijnen (1-0, 1-1, 2-1). Vermijd extreme scores zonder hard bewijs.';
	}

	return 'Weeg de fase van het tornooi expliciet mee in je risico-inschatting en scoreverwachting.';
}

function buildKnockoutShootoutSection(match: MatchWithProno): string {
	if (!isKnockoutMatch(match)) {
		return '';
	}

	return `
KNOCK-OUT REGEL (VERPLICHT):
- Voorspel de stand na 90 minuten (reguliere speeltijd), niet na verlenging.
- Bij een gelijke stand na 90 minuten moet je ook shootoutWinner invullen: 0 = thuisteam wint na strafschoppen, 1 = uitteam wint na strafschoppen.
- Bij een ongelijke stand na 90 minuten: zet shootoutWinner op null.
`;
}

function buildPrompt(match: MatchWithProno, todayStr: string): string {
	const currentPronoSection = hasCurrentProno(match)
		? `
HUIDIGE PRONOSTIEK OP SPORZA: ${match.currentHomeScore}-${match.currentAwayScore}
- Herbeoordeel deze score actief met de nieuwste info (laatste uren/dagen).
- Behoud de score enkel als recent nieuws die ondersteunt; pas aan als blessures, opstelling, vorm of odds dat rechtvaardigen.
`
		: `
HUIDIGE PRONOSTIEK OP SPORZA: nog geen ingevulde score.
`;

	return `
Je bent een data-gedreven voetbalanalist voor het WK 2026.
VANDAAG IS HET: ${todayStr} (gebruik deze datum als referentiepunt voor 'recente' info en lopende WK 2026 resultaten).

Werk uiterst systematisch en stap-voor-stap. Gebruik Google Search actief om de meest recente data voor DEZE ene match op te zoeken. Zoek specifiek op recente blessures, opstellingen, eerdere WK-groepswedstrijden van dit WK, en bookmaker odds.

FASE-CONTEXT (${match.phaseName || 'onbekend'}):
${describePhaseContext(match.phaseName)}
${buildKnockoutShootoutSection(match)}${currentPronoSection}
Voor deze match moet je een grondige analyse doen op basis van deze 5 pijlers:
1) Lopende WK 2026 prestaties: Hoe hebben beide teams gepresteerd in hun voorgaande poule- of knock-outmatchen op DIT WK 2026 (punten, doelpunten, vertoond spel, tactiek)?
2) Teamnieuws & Selectie: Blessures, schorsingen, fysieke paraatheid of mogelijke rotatie in de laatste 14 dagen voorafgaand aan ${todayStr}. Denk aan sleutelspelers die ontbreken.
3) Vorm & Momentum: Resultaten en doelsaldo van de laatste 5 officiële wedstrijden (inclusief pre-WK vriendschappelijke matchen of kwalificaties indien relevant).
4) Context & Omgevingsfactoren: Historische onderlinge duels (Head-to-Head), thuisvoordeel (gastlanden VS, Canada, Mexico), reistijd/hoogteverschil/klimaat, en de belangen van de wedstrijd (moeten ze winnen om door te gaan?).
5) Sterkte-indicatoren: Actuele bookmaker odds, FIFA Ranking en Elo ratings om het objectieve kwaliteitsverschil te ijken.

REALISTISCHE SCORELIJNEN (BELANGRIJK):
- Voorspel de meest waarschijnlijke score na 90 minuten, niet de meest spectaculaire.
- De meeste WK-wedstrijden eindigen met 0-3 totale goals; 0-0, 1-0, 1-1, 2-1, 2-0 komen het vaakst voor.
- Scores boven 3-3 of met één team op 4+ goals zijn zeldzaam: gebruik die enkel met sterk, recent bewijs.
- Bij twijfel: kies een conservatievere, waarschijnlijkere scorelijn.

BELANGRIJK OUTPUTCONTRACT (STRIKT VOLGEN):
- Return ALLEEN een geldig JSON object. Geen markdown, geen code fences, geen extra tekst.
- Het object moet exact deze velden bevatten: matchId, homeTeam, awayTeam, searchAnalysis, homeScore, awayScore, shootoutWinner, reasoning.
- Gebruik exact matchId ${match.matchId}, homeTeam "${match.homeTeam}" en awayTeam "${match.awayTeam}".
- Scores moeten gehele getallen >= 0 zijn (alleen reguliere speeltijd na 90 minuten, GEEN verlengingen of strafschoppen).
- In 'searchAnalysis': gedetailleerde analyse over de 5 pijlers (minimaal 4 zinnen) met concrete feiten uit je zoekopdracht.
- In 'reasoning': maximaal 2 korte zinnen die de score direct onderbouwen.

Wedstrijd om te voorspellen:
- matchId ${match.matchId}: ${match.homeTeam} vs ${match.awayTeam} (${match.phaseName}, ${match.startTime})
`.trim();
}

async function repairPrediction(
	ai: GoogleGenAI,
	malformedText: string,
): Promise<Record<string, unknown>> {
	const repairPrompt = `
Fix this output into valid JSON that matches the required schema exactly.
Return only JSON object text, no markdown and no explanation.

Malformed output:
${malformedText}
`.trim();

	const repaired = await ai.models.generateContent({
		model: REPAIR_MODEL,
		contents: repairPrompt,
		config: {
			responseFormat: {
				text: {
					mimeType: 'application/json',
					schema: SINGLE_PREDICTION_SCHEMA,
				},
			},
			temperature: 0,
		} as Record<string, unknown>,
	});

	return tryParsePrediction(repaired.text ?? '');
}

async function generatePrediction(
	ai: GoogleGenAI,
	model: string,
	prompt: string,
	debug: (message: string) => void,
): Promise<string> {
	const response = await ai.models.generateContent({
		model,
		contents: prompt,
		config: {
			tools: [{ googleSearch: {} }],
			responseFormat: {
				text: {
					mimeType: 'application/json',
					schema: SINGLE_PREDICTION_SCHEMA,
				},
			},
			temperature: 0.1,
		} as Record<string, unknown>,
	});
	debug(`Gemini raw response (${model}): ${compactText(response.text ?? '')}`);
	return response.text ?? '';
}

async function parseAndValidatePrediction(
	ai: GoogleGenAI,
	rawText: string,
	matchId: number,
	match: MatchWithProno,
	debug: (message: string) => void,
) {
	let parsed: Record<string, unknown>;
	try {
		parsed = tryParsePrediction(rawText);
	} catch (err) {
		debug(`Primary parse failed: ${err instanceof Error ? err.message : String(err)}`);
		parsed = await repairPrediction(ai, rawText);
		debug('Repair parse succeeded after primary parse failure.');
	}

	const normalized = normalizePrediction(parsed);
	validatePrediction(normalized, matchId, match);
	return normalized;
}

async function predictOneMatch(
	apiKey: string,
	match: MatchWithProno,
	options: PredictMatchesOptions = {},
): Promise<Prediction | null> {
	const ai = new GoogleGenAI({ apiKey });
	const matchId = match.matchId;
	const onDebug = options.onDebug;
	const debug = (message: string) => {
		if (!onDebug) return;
		try {
			onDebug(message);
		} catch {
			// Ignore logger errors; prediction flow should keep running.
		}
	};

	const todayStr = new Date().toLocaleDateString('nl-BE', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'Europe/Brussels',
	});

	const prompt = buildPrompt(match, todayStr);
	let model = DEFAULT_MODEL;

	try {
		let rawText = await generatePrediction(ai, model, prompt, debug);
		let prediction = await parseAndValidatePrediction(ai, rawText, matchId, match, debug);

		if (needsEscalation(prediction)) {
			debug(`Low confidence detected, retrying with ${ESCALATION_MODEL}.`);
			model = ESCALATION_MODEL;
			const escalationPrompt = `${prompt}

Extra instructie: je vorige analyse was te onzeker of te extreem. Wees grondiger in je zoekopdracht, wees conservatiever in je score, en kies de meest waarschijnlijke scorelijn.${
				isKnockoutMatch(match)
					? ' Bij een gelijke stand na 90 minuten: geef ook shootoutWinner (0 of 1).'
					: ''
			}`.trim();
			rawText = await generatePrediction(ai, model, escalationPrompt, debug);
			prediction = await parseAndValidatePrediction(ai, rawText, matchId, match, debug);
			return { ...prediction, escalated: true, model };
		}

		return { ...prediction, model };
	} catch (err) {
		debug(
			`Prediction failed for match ${matchId}: ${err instanceof Error ? err.message : String(err)}`,
		);
		return null;
	}
}

export async function predictMatches(
	apiKey: string,
	matches: MatchWithProno[],
	options: PredictMatchesOptions = {},
): Promise<Prediction[]> {
	const predictions: Prediction[] = [];

	for (const match of matches) {
		const prediction = await predictOneMatch(apiKey, match, options);
		if (prediction) {
			predictions.push(prediction);
		}
	}

	return predictions;
}
