# WK Pronostiek Automation

SvelteKit + TypeScript app die WK Pronostiek automatiseert: Sporza API, Gemini AI-voorspellingen, browser login en een live dashboard.

## Wat deze app doet

- Haalt aankomende wedstrijden op via de Sporza API
- Voorspelt scores met Google Gemini (inclusief escalatie naar Pro bij lage zekerheid)
- Dient pronostieken automatisch in 20 min voor aanvang (cron elke 5 minuten)
- Toont live logs, accuratesse en handmatige voorspel-knoppen in een Svelte dashboard
- Gebruikt bearer token uit `.env`, lokale cache, of Playwright login als fallback

## Stack

- **SvelteKit 2** + **Svelte 5** + **TypeScript**
- **Bun** runtime (`svelte-adapter-bun`)
- **Prisma** + **SQLite** (`@prisma/adapter-libsql`) voor auth token en pronostiekgeschiedenis
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
- `DATA_DIR` — data map (default: project root lokaal; Docker: `/app/data`)
- `DATABASE_URL` — optioneel; default `file:{DATA_DIR}/wkpronostiek.db` (lokaal: `./wkpronostiek.db`)
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

De entrypoint (`scripts/docker-entrypoint.sh`) zorgt bij containerstart voor:

1. `DATA_DIR=/app/data` en `DATABASE_URL=file:/app/data/wkpronostiek.db` (tenzij overschreven)
2. `prisma migrate deploy` — schema op het gemounte volume
3. App start — server `init` importeert daarna legacy JSONL/auth indien nodig

**Persistente data** zit op het volume (`/app/data`): `wkpronostiek.db`, eventueel legacy `.prediction_log.jsonl` vóór eerste import, en `.prediction_log.jsonl.bak` na import. Zonder `-v …:/app/data` gaat data verloren bij container verwijderen.

## Data opslag

De app gebruikt één SQLite-bestand via Prisma. Je hoeft `DATABASE_URL` meestal **niet** te zetten:

| Omgeving | `DATA_DIR` | Databasebestand |
|----------|------------|-----------------|
| Lokaal (`bun run dev` / `bun run start`) | niet gezet → project root | `./wkpronostiek.db` |
| Docker | `/app/data` (image default) | `/app/data/wkpronostiek.db` |

Zet alleen `DATA_DIR` of `DATABASE_URL` als je een andere locatie wilt (bv. `DATA_DIR=./data` lokaal).

- **AuthToken** — gecachte Sporza bearer token
- **Prediction** — ingediende pronos inclusief `reasoning` en `searchAnalysis`
- **MigrationMeta** — eenmalige legacy-import status

### Legacy migratie (live server)

Bij de eerste start na upgrade importeert de server automatisch:

- `.prediction_log.jsonl` → `Prediction` (reasoning blijft leeg voor oude rijen)
- `.pronotool_auth.json` → `AuthToken` (als DB nog leeg is)

Daarna wordt JSONL hernoemd naar `.prediction_log.jsonl.bak`. Herstart is idempotent via `MigrationMeta`.

Handmatig (zelfde logica):

```bash
bun run db:import-legacy
```

**Aanbevolen deploy op live Docker-host:**

1. Backup volume (optioneel):
   ```bash
   docker run --rm -v wkpronostiek-data:/data -v $(pwd):/backup alpine \
     tar czf /backup/wkpronostiek-data-$(date +%Y%m%d).tar.gz -C /data .
   ```
2. Deploy nieuwe image en herstart container.
3. Controleer logs op `Legacy import: N predictions imported`.
4. Verifieer `GET /api/stats/accuracy` — zelfde resultaten als vóór migratie.

**Rollback:** stop container, herstel volume-backup, draai oude image. Hernoem `.prediction_log.jsonl.bak` terug indien nodig.

### Database scripts

```bash
bun run db:migrate          # dev: nieuwe migratie
bun run db:migrate:deploy   # productie: migraties toepassen
bun run db:import-legacy    # legacy JSONL/auth importeren
```

## Data bestanden (legacy)

- `.pronotool_auth.json` — alleen nog gelezen bij eerste legacy-import
- `.prediction_log.jsonl` — alleen nog gelezen bij eerste legacy-import; daarna `.bak`

Nieuwe data staat in `wkpronostiek.db` in `DATA_DIR`.
