#!/usr/bin/env bun

import { getSettings } from "./config.js";
import { resolveApiAuthorization } from "./auth.js";
import { PronotoolApiClient } from "./pronotool-api.js";
import { predictMatches } from "./predictor.js";

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

// ── SSE log bus ──────────────────────────────────────────────────────────────

const encoder = new TextEncoder();
const sseClients = new Set();

function log(msg) {
    const line = `[${new Date().toLocaleTimeString("nl-BE")}] ${msg}`;
    console.error(line);
    const payload = encoder.encode(`data: ${JSON.stringify(line)}\n\n`);
    for (const controller of sseClients) {
        try {
            controller.enqueue(payload);
        } catch {
            sseClients.delete(controller);
        }
    }
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

let jobRunning = false;

async function runPredictTomorrow() {
    if (jobRunning) {
        log("⚠️ Al een job bezig, probeer later opnieuw.");
        return;
    }
    jobRunning = true;
    const settings = getSettings();
    const api = new PronotoolApiClient(settings);
    const apiKey = process.env.GEMINI_API_KEY || "";

    try {
        const targetDay = tomorrowKeyLocal();
        log(`🔍 Wedstrijden ophalen voor morgen (${targetDay})...`);

        const allMatches = await api.fetchMatches();
        const upcoming = getUpcomingMatches(allMatches);
        const tomorrowMatches = getMatchesForDate(upcoming, targetDay);

        if (tomorrowMatches.length === 0) {
            log(`ℹ️ Geen wedstrijden gevonden voor morgen (${targetDay}).`);
            return;
        }

        log(`🤖 Gemini voorspelt ${tomorrowMatches.length} wedstrijd(en)...`);
        const predictions = await predictMatches(apiKey, tomorrowMatches);

        log(`📤 Indienen...`);
        await submitPredictions(api, settings, predictions);
        log(`✅ ${predictions.length} pronostieken ingediend voor ${targetDay}.`);
    } catch (err) {
        log(`❌ Fout: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        jobRunning = false;
    }
}

async function runPredictAll() {
    if (jobRunning) {
        log("⚠️ Al een job bezig, probeer later opnieuw.");
        return;
    }
    jobRunning = true;
    const settings = getSettings();
    const api = new PronotoolApiClient(settings);
    const apiKey = process.env.GEMINI_API_KEY || "";

    try {
        log(`🔍 Alle openstaande wedstrijden ophalen...`);
        const allMatches = await api.fetchMatches();
        const upcoming = getUpcomingMatches(allMatches);

        if (upcoming.length === 0) {
            log(`ℹ️ Geen openstaande wedstrijden gevonden.`);
            return;
        }

        // Batch per speeldag
        const grouped = new Map();
        for (const m of upcoming) {
            const label = String(m.matchday || "").trim() || `Dag ${dateKeyLocal(new Date(m.startTime))}`;
            if (!grouped.has(label)) grouped.set(label, []);
            grouped.get(label).push(m);
        }

        const batches = [...grouped.entries()];
        log(`🤖 ${upcoming.length} wedstrijden in ${batches.length} speeldagen — Gemini aan het werk...`);

        const allPredictions = [];
        for (let i = 0; i < batches.length; i++) {
            const [label, matches] = batches[i];
            log(`  Batch ${i + 1}/${batches.length}: ${label} (${matches.length} match(es))...`);
            const preds = await predictMatches(apiKey, matches);
            allPredictions.push(...preds);
        }

        log(`📤 Indienen...`);
        await submitPredictions(api, settings, allPredictions);
        log(`✅ ${allPredictions.length} pronostieken ingediend.`);

        const byDay = new Map();
        for (const p of allPredictions) {
            const match = upcoming.find((m) => Number(m.matchId) === p.matchId);
            const label = match ? String(match.matchday || dateKeyLocal(new Date(match.startTime))) : "Onbekend";
            byDay.set(label, (byDay.get(label) ?? 0) + 1);
        }
        log(`📊 Samenvatting:`);
        for (const [day, count] of byDay.entries()) {
            log(`  ${day}: ${count} ingediend`);
        }
    } catch (err) {
        log(`❌ Fout: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        jobRunning = false;
    }
}

async function runAuthRefresh() {
    log(`🔑 Auth token vernieuwen...`);
    const settings = getSettings();
    try {
        await resolveApiAuthorization(settings, { forceRefresh: true });
        log(`✅ Auth token vernieuwd.`);
    } catch (err) {
        log(`❌ Auth fout: ${err instanceof Error ? err.message : String(err)}`);
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
    log(`🕐 Volgende automatische run: ${nextStr}`);

    setTimeout(async () => {
        log(`⏰ Automatische dagelijkse run gestart.`);
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
    .buttons { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 2rem; }
    button {
      padding: 0.6rem 1.2rem; border: none; border-radius: 0.5rem;
      font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: opacity .15s;
    }
    button:hover { opacity: 0.85; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-warning { background: #f59e0b; color: #000; }
    .btn-secondary { background: #475569; color: #fff; }
    .log-box {
      background: #1e293b; border-radius: 0.75rem; padding: 1rem;
      height: 60vh; overflow-y: auto; font-family: monospace; font-size: 0.85rem;
      line-height: 1.6; border: 1px solid #334155;
    }
    .log-line { padding: 0.1rem 0; border-bottom: 1px solid #1e293b; }
    .log-line:last-child { border: none; }
    #status { margin-bottom: 0.75rem; font-size: 0.85rem; color: #64748b; }
  </style>
</head>
<body>
  <h1>⚽ WK Pronostiek</h1>
  <p class="subtitle">Automatische dagelijkse run om ${SCHEDULE_HOUR}:00</p>

  <div class="buttons">
    <button class="btn-primary" onclick="trigger('/run/tomorrow')">🔮 Voorspel morgen</button>
    <button class="btn-warning" onclick="trigger('/run/all')">🚀 Voorspel alles open</button>
    <button class="btn-secondary" onclick="trigger('/run/auth-refresh')">🔑 Auth vernieuwen</button>
  </div>

  <p id="status">Verbinden met log stream...</p>
  <div class="log-box" id="log"></div>

  <script>
    const logBox = document.getElementById('log');
    const status = document.getElementById('status');

    const es = new EventSource('/logs');
    es.onopen = () => { status.textContent = '🟢 Verbonden'; };
    es.onerror = () => { status.textContent = '🔴 Verbinding verbroken — pagina herladen om opnieuw te verbinden'; };
    es.onmessage = (e) => {
      const line = document.createElement('div');
      line.className = 'log-line';
      line.textContent = JSON.parse(e.data);
      logBox.appendChild(line);
      logBox.scrollTop = logBox.scrollHeight;
    };

    async function trigger(path) {
      const buttons = document.querySelectorAll('button');
      buttons.forEach(b => b.disabled = true);
      try {
        await fetch(path, { method: 'POST' });
      } finally {
        setTimeout(() => buttons.forEach(b => b.disabled = false), 1000);
      }
    }
  </script>
</body>
</html>`;

// ── HTTP Server ───────────────────────────────────────────────────────────────

Bun.serve({
    port: PORT,
    idleTimeout: 0,
    async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/") {
            return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }

        if (url.pathname === "/logs") {
            let controller;
            let heartbeat;
            const stream = new ReadableStream({
                start(c) {
                    controller = c;
                    sseClients.add(controller);
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

        if (req.method === "POST" && url.pathname === "/run/tomorrow") {
            runPredictTomorrow().catch(console.error);
            return new Response("ok");
        }

        if (req.method === "POST" && url.pathname === "/run/all") {
            runPredictAll().catch(console.error);
            return new Response("ok");
        }

        if (req.method === "POST" && url.pathname === "/run/auth-refresh") {
            runAuthRefresh().catch(console.error);
            return new Response("ok");
        }

        return new Response("Not found", { status: 404 });
    }
});

log(`🚀 Server draait op http://localhost:${PORT}`);
scheduleNext();
