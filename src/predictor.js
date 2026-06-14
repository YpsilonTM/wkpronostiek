import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.1-flash-lite";
const PREDICTION_SCHEMA = {
    type: "array",
    items: {
        type: "object",
        properties: {
            matchId: { type: "integer", description: "Unique match id from the input list." },
            homeTeam: { type: "string", description: "Home team name." },
            awayTeam: { type: "string", description: "Away team name." },
            searchAnalysis: { type: "string", description: "Detailed step-by-step analysis of recent news, H2H, current form, 2026 World Cup matches, and odds." },
            homeScore: { type: "integer", minimum: 0, description: "Predicted home goals after 90 minutes." },
            awayScore: { type: "integer", minimum: 0, description: "Predicted away goals after 90 minutes." },
            reasoning: { type: "string", description: "Short, 1-2 sentence final summary reasoning for the predicted score." }
        },
        required: ["matchId", "homeTeam", "awayTeam", "searchAnalysis", "homeScore", "awayScore", "reasoning"],
        additionalProperties: false
    }
};

function tryParsePredictions(rawText) {
    const raw = String(rawText || "").trim();
    const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    try {
        return JSON.parse(json);
    } catch {
        // Some tool-grounded responses can include leading/trailing prose.
        const start = json.indexOf("[");
        const end = json.lastIndexOf("]");
        if (start !== -1 && end !== -1 && end > start) {
            return JSON.parse(json.slice(start, end + 1));
        }
        throw new Error("Gemini returned malformed JSON.");
    }
}

async function repairPredictions(ai, malformedText) {
    const repairPrompt = `
Fix this output into valid JSON that matches the required schema exactly.
Return only JSON array text, no markdown and no explanation.

Malformed output:
${malformedText}
`.trim();

    const repaired = await ai.models.generateContent({
        model: MODEL,
        contents: repairPrompt,
        config: {
            responseFormat: {
                text: {
                    mimeType: "application/json",
                    schema: PREDICTION_SCHEMA
                }
            },
            temperature: 0
        }
    });

    return tryParsePredictions(repaired.text);
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

function normalizePredictions(parsed) {
    if (!Array.isArray(parsed)) {
        throw new Error("Gemini returned invalid structured output: expected an array.");
    }

    return parsed.map((item) => {
        let homeScore = parseScore(item.homeScore);
        let awayScore = parseScore(item.awayScore);

        if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) {
            const mergedText = [item.homeScore, item.awayScore, item.prediction, item.score, item.reasoning]
                .filter(Boolean)
                .join(" ");
            const pair = extractScorePair(mergedText);
            if (pair) {
                homeScore = pair.home;
                awayScore = pair.away;
            }
        }

        return {
            matchId: Number(item.matchId),
            homeTeam: String(item.homeTeam || "").trim(),
            awayTeam: String(item.awayTeam || "").trim(),
            homeScore,
            awayScore,
            reasoning: String(item.reasoning || "").trim(),
            searchAnalysis: String(item.searchAnalysis || "").trim()
        };
    });
}

function validatePredictions(predictions, expectedIds) {
    const hasUnknownMatch = predictions.some((p) => !expectedIds.has(p.matchId));
    if (hasUnknownMatch) {
        throw new Error("Gemini returned a prediction for an unknown matchId.");
    }

    const hasMissingMatch = [...expectedIds].some((id) => !predictions.some((p) => p.matchId === id));
    if (hasMissingMatch) {
        throw new Error("Gemini returned an incomplete set of predictions.");
    }

    const hasInvalidScores = predictions.some(
        (p) => !Number.isInteger(p.homeScore) || !Number.isInteger(p.awayScore)
    );
    if (hasInvalidScores) {
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

/**
 * @param {string} apiKey
 * @param {Array} matches - output van fetchMatches(), gefilterd op nog te spelen wedstrijden
 * @returns {Promise<Array<{ matchId: number, homeTeam: string, awayTeam: string, homeScore: number, awayScore: number, reasoning: string }>>}
 */
export async function predictMatches(apiKey, matches, options = {}) {
    const ai = new GoogleGenAI({ apiKey });
    const expectedIds = new Set(matches.map((m) => Number(m.matchId)));
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

    const matchList = matches
        .map((m) => `- matchId ${m.matchId}: ${m.homeTeam} vs ${m.awayTeam} (${m.phaseName}, ${m.startTime})`)
        .join("\n");

    const prompt = `
Je bent een data-gedreven voetbalanalist voor het WK 2026.
VANDAAG IS HET: ${todayStr} (gebruik deze datum als referentiepunt voor 'recente' info en lopende WK 2026 resultaten).

Werk uiterst systematisch en stap-voor-stap. Gebruik Google Search actief om de meest recente data per match op te zoeken. Zoek specifiek op recente blessures, opstellingen, eerdere WK-groepswedstrijden van dit WK, en bookmaker odds.

Voor ELKE match moet je een grondige analyse doen op basis van deze 5 pijlers:
1) Lopende WK 2026 prestaties: Hoe hebben beide teams gepresteerd in hun voorgaande poule- of knock-outmatchen op DIT WK 2026 (punten, doelpunten, vertoond spel, tactiek)?
2) Teamnieuws & Selectie: Blessures, schorsingen, fysieke paraatheid of mogelijke rotatie in de laatste 14 dagen voorafgaand aan ${todayStr}. Denk aan sleutelspelers die ontbreken.
3) Vorm & Momentum: Resultaten en doelsaldo van de laatste 5 officiële wedstrijden (inclusief pre-WK vriendschappelijke matchen of kwalificaties indien relevant).
4) Context & Omgevingsfactoren: Historische onderlinge duels (Head-to-Head), thuisvoordeel (gastlanden VS, Canada, Mexico), reistijd/hoogteverschil/klimaat, en de belangen van de wedstrijd (moeten ze winnen om door te gaan?).
5) Sterkte-indicatoren: Actuele bookmaker odds, FIFA Ranking en Elo ratings om het objectieve kwaliteitsverschil te ijken.

BELANGRIJK OUTPUTCONTRACT (STRIKT VOLGEN):
- Return ALLEEN een geldige JSON array. Geen markdown, geen code fences (zoals \`\`\`json), geen titel, geen extra tekst of inleiding.
- De array moet exact ${matches.length} item(s) bevatten.
- Elk item moet exact deze velden bevatten: matchId, homeTeam, awayTeam, searchAnalysis, homeScore, awayScore, reasoning.
- Gebruik exact de matchId, homeTeam en awayTeam uit de invoer.
- Scores moeten gehele getallen >= 0 zijn (alleen reguliere speeltijd na 90 minuten voorspellen, GEEN verlengingen of strafschoppen).
- In 'searchAnalysis' schrijf je jouw gedetailleerde stap-voor-stap analyse en zoekbevindingen over de 5 pijlers uit (minimaal 3 zinnen). Dit is je "Chain of Thought".
- In 'reasoning' geef je een krachtige, finale samenvatting van maximaal 2 korte zinnen die de voorspelde score direct onderbouwt (bijv. "Team A mist hun topspits door een blessure opgelopen in de vorige WK-match, terwijl Team B in vorm is en met 2-0 won van Team C. We verwachten een krappe overwinning voor Team B.").
- Als recente info beperkt is: geef toch 1 realistische/conservatieve score op basis van de historische sterkte en laat geen item weg.

Gebruik dit formaat exact:
[
    {
        "matchId": 123,
        "homeTeam": "Team A",
        "awayTeam": "Team B",
        "searchAnalysis": "Gedetailleerde analyse van WK-vorm, blessures, H2H, vermoeidheid en odds voor deze specifieke match.",
        "homeScore": 1,
        "awayScore": 0,
        "reasoning": "Korte finale samenvatting van de score op basis van de belangrijkste factoren."
    }
]

Wedstrijden om te voorspellen:
${matchList}
`.trim();

    let response;
    try {
        response = await ai.models.generateContent({
            model: MODEL,
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }],
                responseFormat: {
                    text: {
                        mimeType: "application/json",
                        schema: PREDICTION_SCHEMA
                    }
                },
                temperature: 0.1
            }
        });
        debug(`Gemini raw response: ${compactText(response.text)}`);
    } catch (err) {
        debug(`Gemini request failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
    }

    let parsed;
    try {
        parsed = tryParsePredictions(response.text);
    } catch (err) {
        debug(`Primary parse failed: ${err instanceof Error ? err.message : String(err)}`);
        try {
            parsed = await repairPredictions(ai, response.text);
            debug("Repair parse succeeded after primary parse failure.");
        } catch (repairErr) {
            debug(`Repair parse failed: ${repairErr instanceof Error ? repairErr.message : String(repairErr)}`);
            return [];
        }
    }

    let normalized;
    try {
        normalized = normalizePredictions(parsed);
    } catch (err) {
        debug(`Normalization failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
    }

    let filtered = normalized.filter((p) => expectedIds.has(p.matchId));

    try {
        validatePredictions(filtered, expectedIds);
        return filtered;
    } catch (err) {
        debug(`Validation failed: ${err instanceof Error ? err.message : String(err)}`);
        try {
            const repairedParsed = await repairPredictions(ai, response.text || JSON.stringify(parsed));
            normalized = normalizePredictions(repairedParsed);
            filtered = normalized.filter((p) => expectedIds.has(p.matchId));
            validatePredictions(filtered, expectedIds);
            debug("Validation succeeded after repair.");
            return filtered;
        } catch (repairErr) {
            debug(`Validation repair failed: ${repairErr instanceof Error ? repairErr.message : String(repairErr)}`);
            return [];
        }
    }
}
