# Eindfase-tactiek (Endgame)

Plan voor toekomstige uitbreiding van wkpronostiek: strategisch pronostiek-gedrag aan het einde van het tornooi, wanneer pronos van andere spelers zichtbaar worden.

## Probleem

In de Sporza WK-pronostiek kun je in je minicompetitie de pronos van andere deelnemers zien (meestal na de deadline of vlak voor aftrap). Aan het einde van het tornooi is het vaak niet meer de bedoeling om “de beste voetbalvoorspelling” te doen, maar om **het klassement te optimaliseren**.

De huidige app voorspelt altijd via Gemini en kijkt niet naar het klassement of naar pronos van tegenstanders.

## Kernidee: spiegel-tactiek als leider

Als jij **#1** bent met voorsprong op **#2**, en je zet voor alle **resterende wedstrijden** exact dezelfde score als #2, dan:

- Jullie scoren op elke resterende wedstrijd **evenveel punten**
- Jullie voorsprong **verandert niet meer**
- #2 kan je op die wedstrijden **niet meer inhalen**

Formeel: met voorsprong `L = punten_jij − punten_nr2` blijft `L` constant over alle wedstrijden die nog gespeeld moeten worden.

```
Nu:     Jij 120 pt  |  Nr 2: 115 pt  →  voorsprong +5
Rest:   Wedstrijd A, B, C nog open
Tactiek: kopieer pronos van nr 2 op A, B, C
Resultaat: +5 voorsprong blijft, titel veiliggesteld
```

## Wanneer wel / niet spiegelen

| Situatie | Aanbevolen modus |
|----------|------------------|
| Duidelijke #1 met voorsprong, weinig wedstrijden over | Spiegel #2 |
| Nog vroeg in tornooi, veel punten te verdienen | Gemini / eigen inschatting |
| Gelijk met #1, of #3 kan ook nog winnen | Spiegel alleen #2 is onvoldoende |
| #2 heeft nog geen prono ingevuld | Wachten tot zichtbaar, dan kopiëren |
| Je bent #2 en wilt inhalen | **Niet** spiegelen — juist afwijken van #1 |

## Risico’s en aandachtspunten

1. **Timing** — Pronos van anderen worden pas zichtbaar rond deadline. De bot moet vlak voor aftrap opnieuw controleren; #2 kan op het laatste moment nog wijzigen.
2. **Meerdere groepen** — Klassement en tactiek gelden per minicompetitie. Config moet groep expliciet maken.
3. **Spiegel-patstelling** — Als #2 jou spiegelt terwijl jij achterloopt, ontstaat een patstelling. Als leider is spiegelen juist rationeel.
4. **Bonusvragen** — Als Sporza aparte bonusronden heeft, geldt deze tactiek alleen voor wedstrijdpronos tenzij we die ook meenemen.
5. **Gelijkspel op punten** — Bij ex-aequo op punten telt vaak een tiebreaker (bv. exacte scores). Spiegelen garandeert geen winst bij gelijke stand.

## Gewenste modi (toekomst)

| Modus | Gedrag |
|-------|--------|
| `ai` | Altijd Gemini (huidig gedrag) |
| `mirror` | Altijd pronos van gekozen tegenstander kopiëren |
| `auto` | Gemini tot eindfase-criteria voldaan, daarna spiegelen |

### Auto-modus criteria (voorstel)

Activeer spiegel-tactiek wanneer **alle** voorwaarden waar zijn:

- Rank in gekozen groep = 1
- Voorsprong op #2 ≥ `TACTIC_LEAD_THRESHOLD` (default: 0 — elke voorsprong telt)
- Resterende speelbare wedstrijden ≤ `TACTIC_REMAINING_MATCHES` (bv. 8)
- Optioneel: alleen in knock-outfase (`phaseName` bevat “achtste”, “kwart”, etc.)

## Technische hiaten (huidige codebase)

De app gebruikt vandaag:

- `GET …/user-overview/overview` — eigen pronos en groepsnamen
- `POST …/prono` — eigen pronos indienen
- `GET …/matchdays/…` — wedstrijden en uitslagen

**Nog niet geïmplementeerd** (API-endpoints moeten worden ontdekt via network tab op wkpronostiek.sporza.be):

- Klassement per groep (rank, userId, punten, naam)
- Pronos van een andere speler per wedstrijd of als lijst
- Eventueel userId koppeling binnen een groep

## Voorgestelde architectuur

```
hooks.server.ts / cron (1u voor match)
        │
        ▼
  tactic.ts ──► fetchGroupStandings(groupId)
        │              │
        │              ▼
        │       ben ik #1? resterende wedstrijden ≤ drempel?
        │
        ├── nee ──► predictor.ts (Gemini)
        │
        └── ja ──► fetchRivalPronos(userId=#2)
                      │
                      ▼
                 setPronos (kopieer scores)
```

### Nieuwe modules (indicatief)

```
src/lib/
  types/
    standings.ts      # GroupStanding, GroupMember
    tactic.ts         # TacticMode, TacticDecision
  server/
    standings.ts      # klassement ophalen
    rival-pronos.ts   # pronos andere speler
    tactic.ts         # beslissingslogica auto/mirror/ai
```

### Config (.env)

```env
# Tactiek (toekomst)
TACTIC_MODE=auto          # ai | mirror | auto
TACTIC_GROUP_NAME=        # naam minicompetitie (of GROUP_ID)
TACTIC_MIRROR_RANK=2      # welke rank spiegelen (default: 2)
TACTIC_LEAD_THRESHOLD=0   # min. voorsprong om te spiegelen
TACTIC_REMAINING_MATCHES=8
TACTIC_KNOCKOUT_ONLY=false
```

## Implementatiestappen

1. **API-onderzoek** — Op wkpronostiek.sporza.be: netwerk-tab bij klassement en bij “pronos van X bekijken”. Endpoints en response-shapes documenteren in dit bestand of in `docs/sporza-api.md`.
2. **Types + client** — `fetchGroupStandings`, `fetchUserPronos(userId)` in `pronotool-api.ts` of aparte module.
3. **Tactic engine** — Pure functie `decideTactic(standings, matches, config) → 'ai' | 'mirror'`.
4. **Integratie in jobs** — In `runPredictSingle` / `runPredictUpcoming`: vóór Gemini eerst tactic check; bij `mirror` rival-pronos indienen.
5. **UI** — Dashboard: huidige rank, voorsprong, actieve modus, “spiegelt nr 2”-badge op match cards.
6. **Logging** — In prediction-log en SSE: `{ tactic: 'mirror', rivalUserId, … }` voor traceerbaarheid.
7. **Tests** — Unit tests voor `decideTactic` met fictieve standen (leider +5, gelijk, achterstand, etc.).

## Open vragen

- [ ] Welk exact API-endpoint levert het groepsklassement?
- [ ] Kan je pronos van willekeurige deelnemers ophalen, of alleen van buren in het klassement?
- [ ] Op welk moment worden pronos zichtbaar (deadline, T−1u, …)?
- [ ] Zijn er meerdere groepen tegelijk actief — welke heeft prioriteit?
- [ ] Moet de app pronos **overschrijven** als we al een Gemini-prono hebben en #2 later wijzigt?

## Referentie: huidig predictie-pad

Vandaag (`src/lib/server/jobs.ts`):

1. Cron elke 5 min → wedstrijden binnen 1 uur
2. `predictMatches` (Gemini)
3. `setPronos` + log

Toekomstig pad met endgame:

1. Cron → wedstrijden binnen 1 uur
2. **`decideTactic`** → ai of mirror
3a. mirror → `fetchRivalPronos` → `setPronos`
3b. ai → `predictMatches` → `setPronos`
4. log inclusief tactic metadata

---

*Status: plan — nog niet geïmplementeerd. Laatste update: juni 2026.*
