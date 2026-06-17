#!/usr/bin/env bun

import { getSettings, ensureDataDir } from "./config.js";
import { resolveApiAuthorization } from "./auth.js";
import { PronotoolApiClient } from "./pronotool-api.js";
import { predictMatches } from "./predictor.js";
import { logPrediction, reportPredictionAccuracy } from "./prediction-log.js";
import { pinoLogger, sseClients, encoder } from "./logger.js";
import { Cron } from "croner";

const predictedMatchIds = new Set();
let upcomingMatchesCache = null;
let cacheTime = 0;

function invalidateUpcomingMatchesCache() {
    upcomingMatchesCache = null;
    cacheTime = 0;
}

const PORT = Number(process.env.PORT || 3000);
const SCHEDULE_HOUR = Number(process.env.SCHEDULE_HOUR || 11);

// ── Utilities ────────────────────────────────────────────────────────────────

function dateKeyLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function tomorrowKeyLocal() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return dateKeyLocal(d);
}

function getUpcomingMatches(allMatches) {
    const now = new Date();
    return allMatches
        .filter((m) => new Date(m.startTime) > now)
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
}

function getMatchesForDate(matches, dateKey) {
    return matches.filter((m) => dateKeyLocal(new Date(m.startTime)) === dateKey);
}

async function submitPredictions(api, settings, predictions, matchesById) {
    const authorization = await resolveApiAuthorization(settings);
    await api.setPronos(
        authorization,
        predictions.map((p) => ({
            matchId: p.matchId,
            homeScore: p.homeScore,
            awayScore: p.awayScore,
            modifiedTime: null,
            points: null
        }))
    );

    for (const prediction of predictions) {
        const match = matchesById.get(Number(prediction.matchId));
        if (match) {
            await logPrediction(prediction, match);
        }
    }
}

function attachCurrentPronos(matches, userPronosByMatchId) {
    return matches.map((match) => {
        const current = userPronosByMatchId.get(Number(match.matchId));
        return {
            ...match,
            currentHomeScore: current ? current.homeScore : null,
            currentAwayScore: current ? current.awayScore : null
        };
    });
}

function logPredictionDetails(prediction, matchLabel) {
    pinoLogger.info(`🧠 Reden${matchLabel ? ` voor ${matchLabel}` : ""}: ${prediction.reasoning}`);
    if (prediction.searchAnalysis) {
        pinoLogger.info(`🔍 Analyse${matchLabel ? ` (${matchLabel})` : ""}: ${prediction.searchAnalysis}`);
    }
    if (prediction.escalated) {
        pinoLogger.info(`⬆️ Heranalyse uitgevoerd met ${prediction.model} wegens lage zekerheid.`);
    }
}

async function fetchUserPronosByMatchId(settings, api) {
    try {
        const authorization = await resolveApiAuthorization(settings);
        const overview = await api.fetchUserOverview(authorization);
        const byMatchId = new Map();

        for (const prono of overview.pronos || []) {
            const matchId = Number(prono.matchId);
            if (!Number.isInteger(matchId)) continue;
            // The API returns homeScore and awayScore, which might be undefined/null if not filled in
            if (prono.homeScore !== undefined && prono.awayScore !== undefined && 
                prono.homeScore !== null && prono.awayScore !== null) {
                byMatchId.set(matchId, {
                    homeScore: Number(prono.homeScore),
                    awayScore: Number(prono.awayScore)
                });
            }
        }

        return byMatchId;
    } catch {
        return new Map();
    }
}



// ── Jobs ─────────────────────────────────────────────────────────────────────

let activeJobs = 0;
let predictUpcomingRunning = false;

async function runPredictSingle(match) {
    activeJobs++;
    const settings = getSettings();
    const api = new PronotoolApiClient(settings);
    const apiKey = process.env.GEMINI_API_KEY || "";

    try {
        pinoLogger.info(`🤖 Gemini voorspelt ${match.homeTeam} vs ${match.awayTeam}...`);
        const predictions = await predictMatches(apiKey, [match], {
            onDebug: (message) => pinoLogger.debug(message)
        });
        if (predictions.length === 0) {
            pinoLogger.info(`No prediction recieved, try again.`);
            return null;
        }

        const prediction = predictions[0];
        logPredictionDetails(prediction);
        pinoLogger.info(`📤 Indienen: ${match.homeTeam} ${prediction.homeScore}-${prediction.awayScore} ${match.awayTeam}...`);
        await submitPredictions(api, settings, [prediction], new Map([[Number(match.matchId), match]]));
        predictedMatchIds.add(Number(match.matchId));
        invalidateUpcomingMatchesCache();
        pinoLogger.info(`✅ Pronostiek ingediend voor ${match.homeTeam} vs ${match.awayTeam}.`);
        return prediction;
    } catch (err) {
        pinoLogger.info(`No prediction recieved, try again.`);
        return null;
    } finally {
        activeJobs--;
    }
}


async function runPredictUpcoming() {
    if (predictUpcomingRunning) {
        pinoLogger.debug(`Skipping overlapping automatic prediction run.`);
        return;
    }

    predictUpcomingRunning = true;
    activeJobs++;
    const settings = getSettings();
    const api = new PronotoolApiClient(settings);
    const apiKey = process.env.GEMINI_API_KEY || "";
    try {
        pinoLogger.debug(`🤖 Automatische voorspelling gestart voor aankomende wedstrijden...`);
        const allMatches = await api.fetchMatches();
        await reportPredictionAccuracy(allMatches, (message) => pinoLogger.info(message));
        const userPronosByMatchId = await fetchUserPronosByMatchId(settings, api);
        const now = new Date();
        const ONE_HOUR = 60 * 60 * 1000;

        const matchesToPredict = attachCurrentPronos(
            allMatches.filter((match) => {
                const startTime = new Date(match.startTime);
                const timeUntilMatch = startTime.getTime() - now.getTime();

                // Match is starting within the next hour and is in the future
                const shouldPredict = timeUntilMatch > 0 && timeUntilMatch <= ONE_HOUR;
                if (!shouldPredict) return false;

                const matchId = Number(match.matchId);

                if (predictedMatchIds.has(matchId)) {
                    pinoLogger.debug(`Skipping ${match.homeTeam} vs ${match.awayTeam}: already predicted in this session.`);
                    return false;
                }

                return true;
            }),
            userPronosByMatchId
        );

        if (matchesToPredict.length === 0) {
            pinoLogger.debug(`🤷 Geen aankomende wedstrijden gevonden binnen 1 uur om te voorspellen.`);
            return;
        }

        const predictions = await predictMatches(apiKey, matchesToPredict, {
            onDebug: (message) => pinoLogger.debug(message)
        });

        if (predictions.length === 0) {
            pinoLogger.info(`No prediction recieved, try again.`);
            return;
        }

        pinoLogger.info(`📤 Indienen van ${predictions.length} pronostieken...`);
        const matchesById = new Map(matchesToPredict.map((m) => [Number(m.matchId), m]));
        for (const prediction of predictions) {
            const match = matchesById.get(Number(prediction.matchId));
            if (match) {
                logPredictionDetails(prediction, `${match.homeTeam} vs ${match.awayTeam}`);
            }
        }
        await submitPredictions(api, settings, predictions, matchesById);
        for (const prediction of predictions) {
            predictedMatchIds.add(Number(prediction.matchId));
        }
        invalidateUpcomingMatchesCache();
        pinoLogger.info(`✅ Automatische voorspelling voltooid.`);
    } catch (err) {
        pinoLogger.info(`❌ Automatische voorspelling mislukt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        activeJobs--;
        predictUpcomingRunning = false;
    }
}

async function runAuthRefresh() {
    pinoLogger.info(`🔑 Auth token vernieuwen...`);
    const settings = getSettings();
    try {
        await resolveApiAuthorization(settings, { forceRefresh: true });
        pinoLogger.info(`✅ Auth token vernieuwd.`);
    } catch (err) {
        pinoLogger.info(`❌ Auth fout: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// ── Scheduler ────────────────────────────────────────────────────────────────

function startCronScheduler() {
    pinoLogger.info(`🕐 Automatische check ingepland via Cron (elke 5 minuten - */5 * * * *).`);
    new Cron("*/5 * * * *", async () => {
        try {
            await runPredictUpcoming();
        } catch (err) {
            pinoLogger.info(`❌ Fout tijdens automatische run: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
}

// ── HTML UI ──────────────────────────────────────────────────────────────────

const HTML_FILE = Bun.file(new URL("./index.html", import.meta.url));

// ── HTTP Server ───────────────────────────────────────────────────────────────

Bun.serve({
    port: PORT,
    idleTimeout: 0,
    async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/") {
            return new Response(HTML_FILE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }

        if (url.pathname === "/matches/upcoming") {
            if (!upcomingMatchesCache || Date.now() - cacheTime > 5 * 60 * 1000) {
                const settings = getSettings();
                const api = new PronotoolApiClient(settings);
                const allMatches = await api.fetchMatches();
                const upcoming = getUpcomingMatches(allMatches);
                const userPronosByMatchId = await fetchUserPronosByMatchId(settings, api);

                upcomingMatchesCache = upcoming.map((match) => {
                    const current = userPronosByMatchId.get(Number(match.matchId));
                    return {
                        ...match,
                        currentHomeScore: current ? current.homeScore : null,
                        currentAwayScore: current ? current.awayScore : null
                    };
                });
                cacheTime = Date.now();
            }
            return new Response(JSON.stringify(upcomingMatchesCache), {
                headers: { "Content-Type": "application/json" }
            });
        }

        if (url.pathname === "/logs") {
            let controller;
            let heartbeat;
            const stream = new ReadableStream({
                start(c) {
                    controller = c;
                    sseClients.add(controller);
                    
                    // Force the stream to flush headers immediately so EventSource fires onopen
                    try {
                        controller.enqueue(encoder.encode(": connected\n\n"));
                    } catch {}

                    // Keep connection alive
                    heartbeat = setInterval(() => {
                        try {
                            controller.enqueue(encoder.encode(": heartbeat\n\n"));
                        } catch {
                            clearInterval(heartbeat);
                            sseClients.delete(controller);
                        }
                    }, 20_000);
                },
                cancel() {
                    clearInterval(heartbeat);
                    sseClients.delete(controller);
                }
            });
            return new Response(stream, {
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive"
                }
            });
        }

        if (req.method === "POST" && url.pathname.startsWith('/run/predict-match/')) {
            const matchId = Number(url.pathname.split('/').pop());
            if (isNaN(matchId)) return new Response("Invalid matchId", { status: 400 });

            if (!upcomingMatchesCache) {
                return new Response("Match cache not ready, please refresh", { status: 409 });
            }
            const match = upcomingMatchesCache.find(m => Number(m.matchId) === matchId);
            if (!match) return new Response("Match not found or not upcoming", { status: 404 });

            if (new Date(match.startTime) <= new Date()) {
                invalidateUpcomingMatchesCache();
                return new Response("Match has already started", { status: 409 });
            }

            const prediction = await runPredictSingle(match);

            if (!prediction) {
                return new Response(JSON.stringify({ error: "Prediction failed" }), {
                    headers: { "Content-Type": "application/json" },
                    status: 500
                });
            }

            // Return prediction result
            return new Response(JSON.stringify(prediction), {
                headers: { "Content-Type": "application/json" }
            });
        }

        if (req.method === "POST" && url.pathname === "/run/auth-refresh") {
            runAuthRefresh().catch(console.error);
            return new Response("ok");
        }

        return new Response("Not found", { status: 404 });
    }
});

pinoLogger.info(`🚀 Server draait op http://localhost:${PORT}`);
ensureDataDir().catch(console.error);
runPredictUpcoming().catch(console.error); // Check immediately on startup
startCronScheduler();

