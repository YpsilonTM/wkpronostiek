# WK Pronostiek Automation

SvelteKit + TypeScript app die WK Pronostiek automatiseert: Sporza API, Gemini AI-voorspellingen, browser login en een live dashboard.

## Wat deze app doet

- Haalt aankomende wedstrijden op via de Sporza API
- Voorspelt scores met Google Gemini (inclusief escalatie naar Pro bij lage zekerheid)
- Dient pronostieken automatisch in 1 uur voor aanvang (cron elke 5 minuten)
- Toont live logs, accuratesse en handmatige voorspel-knoppen in een Svelte dashboard
- Gebruikt bearer token uit `.env`, lokale cache, of Playwright login als fallback

## Stack

- **SvelteKit 2** + **Svelte 5** + **TypeScript**
- **Bun** runtime (`svelte-adapter-bun`)
- **croner** voor geplande runs
- **Playwright** (via Node helper onder Bun) voor VRT SSO login

## Installatie

```bash
bun install
bunx playwright install chromium
bun run build:auth-helper
```

## Config

```bash
cp .env.example .env
```

Belangrijkste variabelen:

- `GEMINI_API_KEY` — verplicht voor AI-voorspellingen
- `VRT_EMAIL` / `VRT_PASSWORD` — voor browser login fallback
- `PRONOTOOL_AUTHORIZATION` — optionele directe bearer token
- `DATA_DIR` — data map (default: cwd; Docker: `/app/data`)
- `PORT` — server poort (default: 3000)

## Gebruik

Development:

```bash
bun run dev
```

Production build + start:

```bash
bun run build
bun run start
```

Open http://localhost:3000

## API endpoints

| Endpoint | Beschrijving |
|----------|--------------|
| `GET /api/matches/upcoming` | Aankomende wedstrijden met UI-metadata |
| `GET /api/stats/accuracy` | Pronostiek-accuratesse |
| `GET /api/logs` | SSE log stream |
| `POST /api/run/predict-match/[id]` | Handmatige voorspelling |
| `POST /api/run/auth-refresh` | Auth token vernieuwen |

Legacy paden zonder `/api` prefix worden via `hooks.server.ts` doorgestuurd.

## Docker

```bash
docker build -t wkpronostiek .
docker run -p 3000:3000 --env-file .env -v wkpronostiek-data:/app/data wkpronostiek
```

## Data bestanden

- `.pronotool_auth.json` — gecachte bearer token
- `.prediction_log.jsonl` — pronostiek log voor accuratesse

Beide staan standaard in `DATA_DIR`.
