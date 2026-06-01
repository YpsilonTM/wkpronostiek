import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.5-flash";
const PREDICTION_SCHEMA = {
    type: "array",
    items: {
        type: "object",
        properties: {
            matchId: { type: "integer", description: "Unique match id from the input list." },
            homeTeam: { type: "string", description: "Home team name." },
            awayTeam: { type: "string", description: "Away team name." },
            homeScore: { type: "integer", minimum: 0, description: "Predicted home goals after 90 minutes." },
            awayScore: { type: "integer", minimum: 0, description: "Predicted away goals after 90 minutes." },
            reasoning: { type: "string", description: "Short evidence-based explanation using search results." }
        },
        required: ["matchId", "homeTeam", "awayTeam", "homeScore", "awayScore", "reasoning"],
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
            reasoning: String(item.reasoning || "").trim()
        };
    });
}

function validatePredictions(predictions, expectedIds) {
    const hasUnknownMatch = predictions.some((p) => !expectedIds.has(p.matchId));
    if (hasUnknownMatch) {
        throw new Error("Gemini returned a prediction for an unknown matchId.");
    }

    const hasInvalidScores = predictions.some(
        (p) => !Number.isInteger(p.homeScore) || !Number.isInteger(p.awayScore)
    );
    if (hasInvalidScores) {
        throw new Error("Gemini returned invalid score values.");
    }
}

/**
 * @param {string} apiKey
 * @param {Array} matches - output van fetchMatches(), gefilterd op nog te spelen wedstrijden
 * @returns {Promise<Array<{ matchId: number, homeTeam: string, awayTeam: string, homeScore: number, awayScore: number, reasoning: string }>>}
 */
export async function predictMatches(apiKey, matches) {
    const ai = new GoogleGenAI({ apiKey });
    const expectedIds = new Set(matches.map((m) => Number(m.matchId)));

    const matchList = matches
        .map((m) => `- matchId ${m.matchId}: ${m.homeTeam} vs ${m.awayTeam} (${m.phaseName}, ${m.startTime})`)
        .join("\n");

    const prompt = `
Je bent een voetbalanalist die WK 2026 wedstrijden voorspelt.
Gebruik Google Search om actueel nieuws te zoeken over blessures, schorsingen, vorm en opstelling van elk team.
Houd ook rekening met recente resultaten: voorbije WK-wedstrijden en vriendschappelijke interlands.

Voorspel de eindstand na 90 minuten (geen verlengingen/penalties) voor elk van deze wedstrijden:
${matchList}

Geef exact 1 voorspelling per matchId uit de lijst.
Gebruik in reasoning maximaal 2 korte zinnen.
`.trim();

    const response = await ai.models.generateContent({
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
            temperature: 0.4
        }
    });

    let parsed;
    try {
        parsed = tryParsePredictions(response.text);
    } catch {
        parsed = await repairPredictions(ai, response.text);
    }

    let normalized = normalizePredictions(parsed);
    try {
        validatePredictions(normalized, expectedIds);
    } catch {
        const repairedParsed = await repairPredictions(ai, response.text || JSON.stringify(parsed));
        normalized = normalizePredictions(repairedParsed);
        validatePredictions(normalized, expectedIds);
    }

    return normalized;
}
