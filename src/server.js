#!/usr/bin/env bun

import { getSettings } from "./config.js";
import { resolveApiAuthorization } from "./auth.js";
import { PronotoolApiClient } from "./pronotool-api.js";
import { predictMatches } from "./predictor.js";
import { pinoLogger, sseClients, encoder } from "./logger.js";
import { Cron } from "croner";

const predictedMatchIds = new Set();

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

async function submitPredictions(api, settings, predictions) {
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
        pinoLogger.info(`🧠 Reden: ${prediction.reasoning}`);
        pinoLogger.info(`📤 Indienen: ${match.homeTeam} ${prediction.homeScore}-${prediction.awayScore} ${match.awayTeam}...`);
        await submitPredictions(api, settings, [prediction]);
        predictedMatchIds.add(Number(match.matchId));
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
    activeJobs++;
    const settings = getSettings();
    const api = new PronotoolApiClient(settings);
    const apiKey = process.env.GEMINI_API_KEY || "";
    try {
        pinoLogger.debug(`🤖 Automatische voorspelling gestart voor aankomende wedstrijden...`);
        const allMatches = await api.fetchMatches();
        const now = new Date();
        const ONE_HOUR = 60 * 60 * 1000;

        const matchesToPredict = allMatches.filter(match => {
            const startTime = new Date(match.startTime);
            const timeUntilMatch = startTime.getTime() - now.getTime();

            // Match is starting within the next hour and is in the future
            const shouldPredict = timeUntilMatch > 0 && timeUntilMatch <= ONE_HOUR;
            if (!shouldPredict) return false;

            // Skip only if already predicted in this session
            const alreadyPredicted = predictedMatchIds.has(Number(match.matchId));
            if (alreadyPredicted) {
                pinoLogger.debug(`Skipping ${match.homeTeam} vs ${match.awayTeam}: already predicted in this session.`);
                return false;
            }
            return true;
        });

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
        for (const prediction of predictions) {
            const match = matchesToPredict.find(m => Number(m.matchId) === Number(prediction.matchId));
            if (match) {
                pinoLogger.info(`🧠 Reden voor ${match.homeTeam} vs ${match.awayTeam}: ${prediction.reasoning}`);
                predictedMatchIds.add(Number(match.matchId));
            }
        }
        await submitPredictions(api, settings, predictions);
        pinoLogger.info(`✅ Automatische voorspelling voltooid.`);
    } catch (err) {
        pinoLogger.info(`❌ Automatische voorspelling mislukt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        activeJobs--;
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

// Cache matches for 5 minutes
let upcomingMatchesCache = null;
let cacheTime = 0;

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
            const match = upcomingMatchesCache.find(m => m.matchId === matchId);
            if (!match) return new Response("Match not found or not upcoming", { status: 404 });

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
runPredictUpcoming().catch(console.error); // Check immediately on startup
startCronScheduler();

