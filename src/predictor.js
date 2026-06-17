import { GoogleGenAI } from "@google/genai";

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ESCALATION_MODEL = process.env.GEMINI_ESCALATION_MODEL || "gemini-2.5-pro";
const REPAIR_MODEL = "gemini-3.1-flash-lite";

const SINGLE_PREDICTION_SCHEMA = {
    type: "object",
    properties: {
        matchId: { type: "integer", description: "Unique match id from the input." },
        homeTeam: { type: "string", description: "Home team name." },
        awayTeam: { type: "string", description: "Away team name." },
        searchAnalysis: { type: "string", description: "Detailed step-by-step analysis of recent news, H2H, current form, 2026 World Cup matches, and odds." },
        homeScore: { type: "integer", minimum: 0, description: "Predicted home goals after 90 minutes." },
        awayScore: { type: "integer", minimum: 0, description: "Predicted away goals after 90 minutes." },
        reasoning: { type: "string", description: "Short, 1-2 sentence final summary reasoning for the predicted score." }
    },
    required: ["matchId", "homeTeam", "awayTeam", "searchAnalysis", "homeScore", "awayScore", "reasoning"],
    additionalProperties: false
};

function tryParsePrediction(rawText) {
    const raw = String(rawText || "").trim();
    const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    try {
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed)) {
            return parsed[0] ?? null;
        }
        return parsed;
    } catch {
        const start = json.indexOf("{");
        const end = json.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) {
            return JSON.parse(json.slice(start, end + 1));
        }
        throw new Error("Gemini returned malformed JSON.");
    }
}

async function repairPrediction(ai, malformedText) {
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
                    mimeType: "application/json",
                    schema: SINGLE_PREDICTION_SCHEMA
                }
            },
            temperature: 0
        }
    });

    return tryParsePrediction(repaired.text);
}

function parseScore(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(0, Math.round(value));
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (/^\d+$/.test(trimmed)) {
            return Number(trimmed);
        }
        const pair = trimmed.match(/(\d+)\s*[-:]\s*(\d+)/);
        if (pair) {
            return Number(pair[1]);
        }
    }

    return Number.NaN;
}

function extractScorePair(text) {
    const source = String(text || "");
    const match = source.match(/(\d+)\s*[-:]\s*(\d+)/);
    if (!match) {
        return null;
    }
    return {
        home: Number(match[1]),
        away: Number(match[2])
    };
}

function normalizePrediction(parsed) {
    if (!parsed || typeof parsed !== "object") {
        throw new Error("Gemini returned invalid structured output: expected an object.");
    }

    let homeScore = parseScore(parsed.homeScore);
    let awayScore = parseScore(parsed.awayScore);

    if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) {
        const mergedText = [parsed.homeScore, parsed.awayScore, parsed.prediction, parsed.score, parsed.reasoning]
            .filter(Boolean)
            .join(" ");
        const pair = extractScorePair(mergedText);
        if (pair) {
            homeScore = pair.home;
            awayScore = pair.away;
        }
    }

    return {
        matchId: Number(parsed.matchId),
        homeTeam: String(parsed.homeTeam || "").trim(),
        awayTeam: String(parsed.awayTeam || "").trim(),
        homeScore,
        awayScore,
        reasoning: String(parsed.reasoning || "").trim(),
        searchAnalysis: String(parsed.searchAnalysis || "").trim()
    };
}

function validatePrediction(prediction, matchId) {
    if (Number(prediction.matchId) !== matchId) {
        throw new Error("Gemini returned a prediction for the wrong matchId.");
    }

    if (!Number.isInteger(prediction.homeScore) || !Number.isInteger(prediction.awayScore)) {
        throw new Error("Gemini returned invalid score values.");
    }
}

function compactText(value, maxLength = 700) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) {
        return "<leeg antwoord>";
    }
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength)}...`;
}

function hasCurrentProno(match) {
    return Number.isInteger(match.currentHomeScore) && Number.isInteger(match.currentAwayScore);
}

function describePhaseContext(phaseName) {
    const phase = String(phaseName || "").toLowerCase();

    if (phase.includes("groep") || phase.includes("group")) {
        return "Groepsfase: teams kunnen roteren als kwalificatie al/zeker is. Weeg puntenbehoefte, doelsaldo en risico-afweging (veilig vs. alles op de tafel).";
    }
    if (phase.includes("achtste") || phase.includes("round of 16") || phase.includes("1/8")) {
        return "Achtste finales (knock-out): één slechte match = uit. Verwacht voorzichtiger spel, minder open verdedigingen, en mogelijk verlenging/strafschoppen in werkelijkheid — maar jij voorspelt enkel de stand na 90 minuten.";
    }
    if (phase.includes("kwart") || phase.includes("quarter")) {
        return "Kwartfinales: hoge druk, weinig marges. Sterke teams spelen vaak compact weg van huis.";
    }
    if (phase.includes("half") || phase.includes("semi")) {
        return "Halve finales: extreem belangrijk, vaak tactisch gebalanceerd en lage tot middelmatige scorelijnen tenzij één team duidelijk dominant is.";
    }
    if (phase.includes("finale") || phase.includes("final")) {
        return "Finale: maximale druk; historisch vaak krappe scorelijnen (1-0, 1-1, 2-1). Vermijd extreme scores zonder hard bewijs.";
    }

    return "Weeg de fase van het tornooi expliciet mee in je risico-inschatting en scoreverwachting.";
}

function buildPrompt(match, todayStr) {
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

FASE-CONTEXT (${match.phaseName || "onbekend"}):
${describePhaseContext(match.phaseName)}
${currentPronoSection}
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
- Het object moet exact deze velden bevatten: matchId, homeTeam, awayTeam, searchAnalysis, homeScore, awayScore, reasoning.
- Gebruik exact matchId ${match.matchId}, homeTeam "${match.homeTeam}" en awayTeam "${match.awayTeam}".
- Scores moeten gehele getallen >= 0 zijn (alleen reguliere speeltijd na 90 minuten, GEEN verlengingen of strafschoppen).
- In 'searchAnalysis': gedetailleerde analyse over de 5 pijlers (minimaal 4 zinnen) met concrete feiten uit je zoekopdracht.
- In 'reasoning': maximaal 2 korte zinnen die de score direct onderbouwen.

Wedstrijd om te voorspellen:
- matchId ${match.matchId}: ${match.homeTeam} vs ${match.awayTeam} (${match.phaseName}, ${match.startTime})
`.trim();
}

function needsEscalation(prediction) {
    const combined = `${prediction.searchAnalysis} ${prediction.reasoning}`.toLowerCase();
    const uncertaintyPattern = /beperkt|onduidelijk|weinig info|moeilijk te voorspellen|onbekend|uncertain|unclear|limited info|hard to predict/;
    if (uncertaintyPattern.test(combined)) {
        return true;
    }
    if ((prediction.searchAnalysis || "").trim().length < 80) {
        return true;
    }
    const totalGoals = prediction.homeScore + prediction.awayScore;
    if (totalGoals > 5 || prediction.homeScore > 3 || prediction.awayScore > 3) {
        return true;
    }
    return false;
}

async function generatePrediction(ai, model, prompt, debug) {
    const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
            tools: [{ googleSearch: {} }],
            responseFormat: {
                text: {
                    mimeType: "application/json",
                    schema: SINGLE_PREDICTION_SCHEMA
                }
            },
            temperature: 0.1
        }
    });
    debug(`Gemini raw response (${model}): ${compactText(response.text)}`);
    return response.text;
}

async function parseAndValidatePrediction(ai, rawText, matchId, debug) {
    let parsed;
    try {
        parsed = tryParsePrediction(rawText);
    } catch (err) {
        debug(`Primary parse failed: ${err instanceof Error ? err.message : String(err)}`);
        parsed = await repairPrediction(ai, rawText);
        debug("Repair parse succeeded after primary parse failure.");
    }

    const normalized = normalizePrediction(parsed);
    validatePrediction(normalized, matchId);
    return normalized;
}

async function predictOneMatch(apiKey, match, options = {}) {
    const ai = new GoogleGenAI({ apiKey });
    const matchId = Number(match.matchId);
    const onDebug = typeof options.onDebug === "function" ? options.onDebug : null;
    const debug = (message) => {
        if (!onDebug) return;
        try {
            onDebug(message);
        } catch {
            // Ignore logger errors; prediction flow should keep running.
        }
    };

    const todayStr = new Date().toLocaleDateString("nl-BE", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "Europe/Brussels"
    });

    const prompt = buildPrompt(match, todayStr);
    let model = DEFAULT_MODEL;

    try {
        let rawText = await generatePrediction(ai, model, prompt, debug);
        let prediction = await parseAndValidatePrediction(ai, rawText, matchId, debug);

        if (needsEscalation(prediction)) {
            debug(`Low confidence detected, retrying with ${ESCALATION_MODEL}.`);
            model = ESCALATION_MODEL;
            const escalationPrompt = `${prompt}

Extra instructie: je vorige analyse was te onzeker of te extreem. Wees grondiger in je zoekopdracht, wees conservatiever in je score, en kies de meest waarschijnlijke scorelijn.`.trim();
            rawText = await generatePrediction(ai, model, escalationPrompt, debug);
            prediction = await parseAndValidatePrediction(ai, rawText, matchId, debug);
            prediction.escalated = true;
        }

        prediction.model = model;
        return prediction;
    } catch (err) {
        debug(`Prediction failed for match ${matchId}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}

/**
 * @param {string} apiKey
 * @param {Array} matches - output van fetchMatches(), gefilterd op nog te spelen wedstrijden
 * @returns {Promise<Array<{ matchId: number, homeTeam: string, awayTeam: string, homeScore: number, awayScore: number, reasoning: string, searchAnalysis: string, model: string, escalated?: boolean }>>}
 */
export async function predictMatches(apiKey, matches, options = {}) {
    const predictions = [];

    for (const match of matches) {
        const prediction = await predictOneMatch(apiKey, match, options);
        if (prediction) {
            predictions.push(prediction);
        }
    }

    return predictions;
}
