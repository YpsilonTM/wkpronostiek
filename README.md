# WK Pronostiek Automation (Minimal)

Dit is een bewust minimale codebase met alleen:
- auth token ophalen/vernieuwen
- huidige pronos ophalen
- prono zetten voor een match

## Wat deze versie doet

- gebruikt een bestaande bearer token als die in `.env` staat
- gebruikt anders een lokaal gecachte token uit `.pronotool_auth.json`
- doet alleen als fallback een headless browser login met `VRT_EMAIL` + `VRT_PASSWORD`

Opmerking bij Bun:
- de CLI draait met Bun
- de browser fallback voor login draait via een kleine Node helper met Playwright (voor stabiliteit)

Geen daemon, geen FastAPI service, geen predictor, geen Docker tooling.

## Installatie

```powershell
bun install
bunx playwright install chromium
```

## Config

```powershell
Copy-Item .env.example .env
```

Belangrijkste variabelen in `.env`:
- `VRT_EMAIL`
- `VRT_PASSWORD`
- `PRONOTOOL_AUTHORIZATION` (optioneel)
- `PRONOTOOL_AUTH_CACHE_FILE` (optioneel, standaard `.pronotool_auth.json`)

## Gebruik

Huidige pronos ophalen:

```powershell
bun run pronos
```

Eén prono zetten:

```powershell
bun run set-prono --match-id 3332961 --home 2 --away 3
```

Auth cache bewust vernieuwen (force login + nieuwe token):

```powershell
bun run auth-refresh
```

Met limit parameter:

```powershell
bun run pronos -- --limit 1
```

## Structuur

- `src/cli.js`: CLI entrypoint
- `src/auth.js`: token kiezen/valideren/vernieuwen
- `src/browser-login.js`: headless login fallback
- `src/node-auth-login.mjs`: Node helper voor Playwright browser login (stabiel op Bun)
- `src/pronotool-api.js`: API client voor user overview en prono updates
- `src/config.js`: `.env` instellingen
