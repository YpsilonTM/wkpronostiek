import fs from "node:fs/promises";
import path from "node:path";
import { getDataPath, ensureDataDir } from "./config.js";

const LOG_FILENAME = process.env.PREDICTION_LOG_FILE
  ? path.basename(process.env.PREDICTION_LOG_FILE)
  : ".prediction_log.jsonl";

function getLogPath() {
  const file = process.env.PREDICTION_LOG_FILE || LOG_FILENAME;
  if (path.isAbsolute(file)) {
    return file;
  }
  return getDataPath(path.basename(file));
}

export async function logPrediction(prediction, match) {
    const entry = {
        loggedAt: new Date().toISOString(),
        matchId: Number(prediction.matchId),
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        phaseName: match.phaseName ?? null,
        startTime: match.startTime ?? null,
        predictedHome: prediction.homeScore,
        predictedAway: prediction.awayScore,
        model: prediction.model ?? null,
        escalated: Boolean(prediction.escalated)
    };

    await ensureDataDir();
    await fs.appendFile(getLogPath(), `${JSON.stringify(entry)}\n`, "utf8");
}

function isFinishedMatch(match) {
    const status = String(match.status || "").toLowerCase();
    return status.includes("finished") || status.includes("gespeeld") || status.includes("ended") || status.includes("closed");
}

function getActualScore(match) {
    const home = match.homeScore ?? match.homeTeamScore ?? null;
    const away = match.awayScore ?? match.awayTeamScore ?? null;
    if (!Number.isInteger(home) || !Number.isInteger(away)) {
        return null;
    }
    return { home, away };
}

function outcome(home, away) {
    if (home > away) return "home";
    if (away > home) return "away";
    return "draw";
}

async function readLogEntries() {
  try {
    const raw = await fs.readFile(getLogPath(), "utf8");
    return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export async function computePredictionAccuracy(allMatches) {
    const entries = await readLogEntries();
    if (entries.length === 0) {
        return null;
    }

    const latestByMatchId = new Map();
    for (const entry of entries) {
        latestByMatchId.set(Number(entry.matchId), entry);
    }

    let evaluated = 0;
    let exactHits = 0;
    let outcomeHits = 0;

    for (const match of allMatches) {
        if (!isFinishedMatch(match)) continue;

        const actual = getActualScore(match);
        if (!actual) continue;

        const predicted = latestByMatchId.get(Number(match.matchId));
        if (!predicted) continue;

        evaluated += 1;
        if (predicted.predictedHome === actual.home && predicted.predictedAway === actual.away) {
            exactHits += 1;
        }
        if (outcome(predicted.predictedHome, predicted.predictedAway) === outcome(actual.home, actual.away)) {
            outcomeHits += 1;
        }
    }

    if (evaluated === 0) {
        return null;
    }

    const exactPct = Math.round((exactHits / evaluated) * 100);
    const outcomePct = Math.round((outcomeHits / evaluated) * 100);

    return { evaluated, exactHits, outcomeHits, exactPct, outcomePct };
}

export async function reportPredictionAccuracy(allMatches, logFn) {
    const stats = await computePredictionAccuracy(allMatches);
    if (!stats || typeof logFn !== "function") {
        return stats;
    }

    logFn(`📊 Pronostiek-accuratesse: ${stats.exactHits}/${stats.evaluated} exact (${stats.exactPct}%), ${stats.outcomeHits}/${stats.evaluated} juiste uitslag (${stats.outcomePct}%)`);
    return stats;
}
