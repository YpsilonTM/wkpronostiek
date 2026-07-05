# Changelog

Evolution of **WK Pronostiek** based on git history (June 1 – July 3, 2026).

## Phase 1 — Initial version (June 1)

### `init`
- Bun + vanilla Node server (`server.js`)
- Sporza API integration (`pronotool-api.js`)
- Gemini AI predictions (`predictor.js`)
- Playwright browser login for VRT SSO (`browser-login.js`, `node-auth-login.mjs`)
- Bearer token auth (`auth.js`)
- Docker setup + `.env.example`

### Infrastructure fixes
- Commit `bun.lock`, update Dockerfile install fallback
- Use Ubuntu base image for Playwright `with-deps`

## Phase 2 — Prediction refinements (June 3–11)

### Per-match flow
- Refine per-match prediction flow and restore default port 3000

### Gemini improvements
- Structured output (JSON schema)
- Split debug logging
- Dynamic date, searchAnalysis chain-of-thought, and 5 key pillars for better predictions

### New features
- `runPredictTomorrow` — predict all matches for tomorrow
- Pino logging package
- SSE logging fixes, prediction cache, and log connection delay

## Phase 3 — Scheduler, dashboard & storage (June 14–18)

### Automation
- Cron every 5 minutes, predict 1 hour before kickoff
- Extract inline HTML to separate template file
- Time-based filter for upcoming matches

### Reliability
- Fix prediction race conditions and stale match cache handling
- Improve prediction quality

### Dashboard v1 (vanilla HTML)
- Show prediction results
- Accuracy statistics
- Live SSE updates (reasoning, status chips)

### Docker & data
- GitHub Actions workflow for building and pushing Docker image (later removed)
- Persistent data storage for Docker (`DATA_DIR`)
- Remove bundled compose file; `DATA_DIR` defaults via Dockerfile

## Phase 4 — Major rewrite: SvelteKit (June 24)

### Rewrite app to SvelteKit + TypeScript on Bun
The largest architectural change:

| Before | After |
|--------|-------|
| Monolithic `server.js` | SvelteKit routes + API endpoints |
| Vanilla `index.html` | Svelte 5 components (`MatchCard`, `MatchList`, `LogPanel`, `StatsBar`) |
| `.js` modules | Typed TypeScript (`lib/server/*`) |
| Inline cron | `hooks.server.ts` + `scheduler.ts` |

Preserved: Sporza API, Gemini, Playwright auth.

### Same day
- Add `ENDGAME.md` with endgame mirror-tactic plan
- Fix accuracy stats by recognizing Sporza `END` match status

## Phase 5 — Post-rewrite improvements (June 27 – July 3)

### AI & Sporza
- Upgrade Gemini defaults from 2.5 to 3.5 Flash
- Show which matches have confirmed teams vs placeholders
- Submit penalty winner for knockout draws to Sporza

### UX & reliability
- Fix false prediction failure in UI by running predictions asynchronously
- Auto-predict timing: 1 hour → 20 minutes before kickoff
- Stop manual predictions from blocking the 20-minute auto-predict run

### Database (Prisma + SQLite)
- Replace file-based auth and JSONL logs with SQLite
- Auto-import legacy data on startup
- Persist prediction analysis in the UI (collapsible match cards after refresh)

### Docker
- Fix Docker build by running `svelte-kit sync` before `prisma generate`

## Evolution at a glance

```
Vanilla Bun server + HTML
    ↓  predictions, logging, cron
Dashboard with SSE + accuracy
    ↓  major rewrite
SvelteKit + TypeScript + Svelte 5 UI
    ↓  persistence + polish
Prisma SQLite + 20-min auto-predict + Gemini 3.5
```

## Current state (July 5, 2026)

The app is a **SvelteKit dashboard** that:

- Fetches matches via the Sporza API
- Predicts scores with Gemini 3.5 Flash (with Pro escalation on low confidence)
- Submits predictions automatically 20 minutes before kickoff
- Shows live logs, accuracy stats, and manual predict buttons
- Stores auth tokens and prediction history in SQLite
- Runs in Docker with persistent data

## Phase 6 — Codebase professionalization (July 5, 2026)

- Split server logic into `services/` and `predictor/` modules
- Removed dead code, deduplicated constants and DB URL resolution
- Fixed manual predict cache dependency, error logging, and accuracy refresh hack
- Normalized `matchId` to `number` at API boundary; simplified frontend state (removed overlays)
- Optimized latest-prediction query with SQL subquery
- Added Biome lint/format, Vitest tests, and GitHub Actions CI
- Optional `ADMIN_TOKEN` guard on `/api/run/*`; documented single-instance deployment
