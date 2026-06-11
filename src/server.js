#!/usr/bin/env bun

import { getSettings } from "./config.js";
import { resolveApiAuthorization } from "./auth.js";
import { PronotoolApiClient } from "./pronotool-api.js";
import { predictMatches } from "./predictor.js";
import { pinoLogger, sseClients, encoder } from "./logger.js";

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
    return allMatches
        .filter((m) => m.status === "AFTER_TODAY")
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
        pinoLogger.info(`✅ Pronostiek ingediend voor ${match.homeTeam} vs ${match.awayTeam}.`);
        return prediction;
    } catch (err) {
        pinoLogger.info(`No prediction recieved, try again.`);
        return null;
    } finally {
        activeJobs--;
    }
}


async function runPredictTomorrow() {
    activeJobs++;
    const settings = getSettings();
                const api = new PronotoolApiClient(settings);
    const apiKey = process.env.GEMINI_API_KEY || "";
                        try {
        pinoLogger.info(`🤖 Automatische dagelijkse voorspelling gestart voor morgen...`);
        const allMatches = await api.fetchMatches();
        const tomorrowMatches = getMatchesForDate(allMatches, tomorrowKeyLocal());

        if (tomorrowMatches.length === 0) {
            pinoLogger.info(`🤷 Geen wedstrijden gevonden voor morgen.`);
            return;
                        }

        const userPronosByMatchId = await fetchUserPronosByMatchId(settings, api);
        const matchesToPredict = tomorrowMatches.filter(match => {
            const hasPrediction = userPronosByMatchId.has(Number(match.matchId));
            if (hasPrediction) {
                pinoLogger.debug(`Skipping ${match.homeTeam} vs ${match.awayTeam}: already has a prediction.`);
            }
            return !hasPrediction;
        });

        if (matchesToPredict.length === 0) {
            pinoLogger.info(`✅ Alle wedstrijden voor morgen hebben al een pronostiek.`);
            return;
                }

        const predictions = await predictMatches(apiKey, matchesToPredict, {
            onDebug: (message) => pinoLogger.debug(message)
            });

        if (predictions.length === 0) {
            pinoLogger.info(`No prediction recieved, try again.`);
            return;
        }

        pinoLogger.info(`📤 Indienen van ${predictions.length} pronostieken voor morgen...`);
        for (const prediction of predictions) {
            const match = matchesToPredict.find(m => Number(m.matchId) === Number(prediction.matchId));
            if (match) {
                pinoLogger.info(`🧠 Reden voor ${match.homeTeam} vs ${match.awayTeam}: ${prediction.reasoning}`);
            }
        }
        await submitPredictions(api, settings, predictions);
        pinoLogger.info(`✅ Automatische dagelijkse voorspelling voltooid voor morgen.`);
    } catch (err) {
        pinoLogger.info(`❌ Dagelijkse voorspelling mislukt: ${err instanceof Error ? err.message : String(err)}`);
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

function scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(SCHEDULE_HOUR, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const delay = next - now;
    const nextStr = next.toLocaleString("nl-BE", { timeZone: "Europe/Brussels" });
    pinoLogger.info(`🕐 Volgende automatische run: ${nextStr}`);

    setTimeout(async () => {
        pinoLogger.info(`⏰ Automatische dagelijkse run gestart.`);
        await runPredictTomorrow();
scheduleNext();
    }, delay);
}

// ── HTML UI ──────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WK Pronostiek</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; padding: 2rem; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.25rem; }
    .subtitle { color: #94a3b8; font-size: 0.9rem; margin-bottom: 2rem; }
    #top-controls { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; align-items: center; }
    button {
      padding: 0.5rem 1rem; border: none; border-radius: 0.5rem;
      font-size: 0.9rem; font-weight: 600; cursor: pointer; transition: opacity .15s;
    }
    button:hover { opacity: 0.85; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-secondary { background: #475569; color: #fff; }
    .log-box {
      background: #1e293b; border-radius: 0.75rem; padding: 1rem;
            height: 32vh; overflow-y: auto; font-family: monospace; font-size: 0.85rem;
            line-height: 1.6; border: 1px solid #334155; margin-bottom: 1.25rem;
    }
    .log-line { padding: 0.1rem 0; }
    #status { font-size: 0.85rem; color: #64748b; }
    #matches { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 1rem; }
    .match-card {
        background: #1e293b; border-radius: 0.75rem; padding: 1.25rem;
        border: 1px solid #334155;
        display: flex;
        flex-direction: column;
        min-height: 148px;
    }
    .match-header { margin-bottom: 0.35rem; }
    .match-teams { font-weight: 600; font-size: 1.02rem; line-height: 1.25; }
    .match-meta { font-size: 0.78rem; color: #94a3b8; margin-bottom: 0.75rem; }
    .match-actions {
        margin-top: auto;
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 0.75rem;
    }
    .match-result {
        font-weight: 600;
        font-size: 0.92rem;
        color: #eab308;
        line-height: 1.2;
        word-break: break-word;
    }
    .predict-btn { margin-left: auto; }
  </style>
</head>
<body>
  <h1>⚽ WK Pronostiek</h1>
  <p class="subtitle">Automatische dagelijkse run om ${SCHEDULE_HOUR}:00</p>

  <div id="top-controls">
    <button class="btn-secondary" onclick="trigger('/run/auth-refresh')">🔑 Auth vernieuwen</button>
    <p id="status">Verbinden met log stream...</p>
  </div>

  <div class="log-box" id="log"></div>

    <div id="matches">Laden...</div>

  <script>
    const logBox = document.getElementById('log');
    const statusEl = document.getElementById('status');
    const matchesEl = document.getElementById('matches');

    function createMatchCard(match) {
        const card = document.createElement('div');
        card.className = 'match-card';
        card.id = 'match-' + match.matchId;

        const startTime = new Date(match.startTime).toLocaleString('nl-BE', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });

        const hasCurrentPrediction = Number.isInteger(match.currentHomeScore) && Number.isInteger(match.currentAwayScore);
        const resultHtml = hasCurrentPrediction
            ? '<div class="match-result" id="score-' + match.matchId + '">Huidig: ' + match.currentHomeScore + ' - ' + match.currentAwayScore + '</div>'
            : '<div class="match-result" id="score-' + match.matchId + '">Nog geen voorspelling</div>';
        const predictButtonHtml = '<button class="btn-primary" onclick="predictMatch(' + match.matchId + ')">🔮 Voorspel</button>';

        card.innerHTML = \`
            <div class="match-header">
                <div class="match-teams">\${match.homeTeam} vs \${match.awayTeam}</div>
            </div>
            <div class="match-meta">\${match.phaseName} • \${startTime}</div>
            <div class="match-actions">\${resultHtml}<span class="predict-btn">\${predictButtonHtml}</span></div>
        \`;
        return card;
    }

    async function loadMatches() {
        try {
            const res = await fetch('/matches/upcoming');
            if (!res.ok) throw new Error('Kon wedstrijden niet laden.');
            const matches = await res.json();
            matchesEl.innerHTML = '';
            matches.forEach(m => matchesEl.appendChild(createMatchCard(m)));
        } catch (err) {
            matchesEl.innerHTML = 'Kon wedstrijden niet laden: ' + err.message;
        }
    }

    async function predictMatch(matchId) {
        const button = document.querySelector('#match-' + matchId + ' button');
        if (button) button.disabled = true;

        const res = await fetch('/run/predict-match/' + matchId, { method: 'POST' });
        if (res.ok) {
            const result = await res.json();
            if (result && typeof result.homeScore === 'number') {
                const scoreEl = document.getElementById('score-' + matchId);
                if (scoreEl) {
                    scoreEl.textContent = 'Huidig: ' + result.homeScore + ' - ' + result.awayScore;
                }
                if (button) button.disabled = false;
            } else if (button) {
                // Re-enable button on failure
                button.disabled = false;
            }
        } else if (button) {
            button.disabled = false;
        }
    }

    const es = new EventSource('/logs');
    es.onopen = () => { statusEl.textContent = '🟢 Verbonden'; };
    es.onerror = () => { statusEl.textContent = '🔴 Verbinding verbroken'; };
    es.onmessage = (e) => {
      const line = document.createElement('div');
      line.className = 'log-line';
      line.textContent = JSON.parse(e.data);
      logBox.appendChild(line);
      logBox.scrollTop = logBox.scrollHeight;
    };

    async function trigger(path) {
      document.querySelectorAll('button').forEach(b => b.disabled = true);
      try {
        await fetch(path, { method: 'POST' });
      } finally {
        setTimeout(() => document.querySelectorAll('button').forEach(b => b.disabled = false), 1000);
      }
    }

    loadMatches();
  </script>
</body>
</html>`;

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
            return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
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
scheduleNext();

