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
  "userId": "abc123",
  "pronos": [{ "matchId": 1, "homeScore": 2, "awayScore": 1, "modifiedTime": "...", "points": 20 }],
  "groups": [{ "id": "group-uuid", "name": "Familie", "rank": 1, "points": 120 }]
}
```

`groups` may also appear nested or under alternate keys — client parses flexibly.

## Tactic endpoints (configurable)

Standings and rival pronos URLs vary by Sporza release. Override via `.env`:

```env
TACTIC_STANDINGS_API_URL=https://api.sporza.be/pronotool/1/groups/{groupId}/standings
TACTIC_RIVAL_PRONOS_API_URL=https://api.sporza.be/pronotool/1/users/{userId}/pronos?groupId={groupId}
```

Placeholders: `{groupId}`, `{userId}`.

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
