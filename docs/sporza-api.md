# Sporza Pronotool API (reverse-engineered)

Internal JSON API used by [wkpronostiek.sporza.be](https://wkpronostiek.sporza.be). Not officially documented.

Base URL: `https://api.sporza.be/pronotool/1/`

All authenticated requests need:

```
Authorization: Bearer <token>
Origin: https://wkpronostiek.sporza.be
Referer: https://wkpronostiek.sporza.be/
```

## Known endpoints (implemented)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/user-overview/overview` | Own pronos, groups, user id |
| POST | `/prono` | Submit pronos |
| GET | `/spapp/1/matchdays/soccer/competition/8` | Match schedule (no auth) |

### GET `/user-overview/overview`

Response fields used by wkpronostiek:

```json
{
  "user": { "id": 12345 },
  "groups": [
    {
      "group": { "name": "Familie", "code": "ABC123" },
      "users": [
        { "id": 12345, "name": "Jan", "points": 120, "rank": 1 }
      ]
    }
  ],
  "pronos": [{ "matchId": 1, "homeScore": 2, "awayScore": 1, "modifiedTime": "...", "points": 20 }]
}
```

The full klassement is often **embedded** in `groups[].users[]` — no separate standings call needed.

Legacy flat shape still supported:

```json
{
  "userId": "abc123",
  "pronos": [...],
  "groups": [{ "id": "group-uuid", "name": "Familie", "rank": 1, "points": 120 }]
}
```

`groups` may also appear under `_embedded`, `body`, `data`, or alternate keys — client parses flexibly.

## Tactic endpoints (configurable)

Standings and rival pronos URLs vary by Sporza release. Override via `.env`:

```env
TACTIC_STANDINGS_API_URL=https://api.sporza.be/pronotool/1/groups/{groupId}/standings
TACTIC_RIVAL_PRONOS_API_URL=https://api.sporza.be/pronotool/1/users/{userId}/pronos?groupId={groupId}
```

Placeholders: `{groupId}`, `{userId}`.

The client tries the configured URL first, then a built-in list of fallback paths (see `src/lib/server/pronotool/endpoints.ts`). A standings response is only considered **complete** when it contains at least two members; otherwise mirror tactic stays disabled and the app may fall back to overview rank/points only.

Transient HTTP errors (`429`, `502`, `503`, `504`) are retried once per URL.

### Discovering endpoints

1. Log in at wkpronostiek.sporza.be
2. Open DevTools → Network → filter `api.sporza.be/pronotool`
3. Open minicompetitie **klassement** → copy standings XHR URL and response shape
4. Click **bekijk pronos** for another player → copy rival pronos URL

Document any differences below.

### Standings response (expected shape)

```json
{
  "members": [
    { "userId": "...", "name": "Jan", "rank": 1, "points": 120 }
  ]
}
```

Also accepts top-level arrays or `standings` / `ranking` keys.

### Rival pronos response

Same shape as own pronos: `{ "pronos": [...] }` or a bare array.

## Auth

Bearer token from browser login (Playwright) or `PRONOTOOL_AUTHORIZATION` in `.env`.
