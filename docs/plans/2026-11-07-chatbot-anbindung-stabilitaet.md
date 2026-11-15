# Chatbot-Anbindung: Budget, Überlast-Codes, sichere Wiederholung, Status-Endpunkte

Stand 2026-11-07 · Auftrag des Chatbot-Teams (BOERDi), Gegenstück zu dessen Plan
`plans/2026-11-07-stabilitaet-mcp-anbindung.md` · Entwurf **und** Aufgaben in
einer Datei, wie `2026-11-06-boerdi-wunschliste.md`.

## Ziel

Der Chatbot ist für alle seine Nutzerinnen EINE Adresse und muss unter Last
verlässlich bleiben: ein Budget, das nur echte Arbeit zählt; Überlast als Code mit
genauer Wartezeit; bestätigte Schreibaufrufe, die man nach einem Netzfehler
gefahrlos wiederholen kann; und zwei billige Endpunkte für Anmeldestand und
Bereitschaft.

## Was gemessen ist (2026-11-07)

| # | Messung | Ergebnis | Folge |
|---|---|---|---|
| M1 | `tools/list` und `tools/call` als ERSTER POST, ohne `initialize` (echter HTTP-Server, `createHttpRequestHandler`, SDK 1.32.2) | **200**, vollständige Antwort | **F2: ja.** Ein Werkzeugaufruf = ein POST. B1 löst der Chatbot selbst; S1 macht es zusätzlich unschädlich |
| M2 | Lese-Anfrage an Staging (`ngsearch`, maxItems 1): frisch / sofort / nach 5 s / nach 35 s / sofort | 387 / 102 / 208 / 228 / 119 ms | Verbindungsaufbau kostet 0,1–0,3 s. **Die 22 s aus B7 kommen nicht von TLS/Keep-Alive** — ein Keep-Alive-Agent spart höchstens diese 0,3 s |
| M3 | `docker-compose.yml` | `RATE_LIMIT_RPM` leer → Code-Standard **120**; `TRUST_PROXY` Standard **1** | F1: Ab Werk 120/min, Proxy vertraut. Die LIVE-Werte stehen in der `.env` des vServers — nur der Betrieb kann sie nennen |

## Antworten auf F1–F4

- **F1** Ab Werk `RATE_LIMIT_RPM=120`, `TRUST_PROXY=1` (M3). **Live: 300 Anfragen
  je Minute** (Nutzer, 2026-11-07). Mit Phase 1 zählt dieser Wert nur noch
  `tools/call`; alle POSTs zusammen dürfen 900. Ob vor dem Container ein weiterer
  Limiter sitzt (Hostinger/Traefik), ist nicht bekannt.
  `TRUST_PROXY=1` ist richtig, solange genau EIN Proxy davor steht; dann zählt der
  Server die Adresse, die der Proxy anhängt.
- **F2** Ja (M1). Gilt für SDK 1.32.2; ein Test hält es fest, damit ein SDK-Update,
  das `initialize` erzwingt, auffällt.
- **F3** Ein Limit von edu-sharing ist nicht gemessen und nicht dokumentiert.
  Daher: S1 hebt nur das Budget des Chatbot-Schlüssels, nicht das aller; und S2
  meldet ein 429/503 von edu-sharing als `upstream_busy`, statt es zu
  verschleiern. Eine Warteschlange im MCP bauen wir erst, wenn `upstream_busy` im
  Betrieb tatsächlich auftritt (Log-Zeile vorhanden).
- **F4** Im Prozess, wie Pläne. Nach einem Neustart antwortet ein Schlüssel wie
  heute (`confirm_unknown`).

## Entscheidungen

| # | Frage | Entscheidung | Warum |
|---|---|---|---|
| E1 | Was zählt das Werkzeug-Budget? | Nur `tools/call` (je Element eines Batches). Alle POSTs zählen zusätzlich gegen ein **Protokoll-Budget** von 3 × Werkzeug-Budget, geprüft vor dem Lesen des Rumpfs | `initialize`/`notifications/*` erreichen edu-sharing nie; ganz ohne Grenze wären sie ein billiger Flutweg. 3 × deckt den heutigen Ablauf (drei POSTs je Aufruf) |
| E2 | Vertrauter Client | Kopf `X-WLO-Client-Key`; `TRUSTED_CLIENT_KEYS="name:rpm:schlüssel,…"`; Schlüssel ≥ 32 Zeichen, gespeichert nur als SHA-256; Bucket `client:<name>` statt Adresse | Adressen wechseln, ein Schlüssel nicht. Ein unbekannter oder zu kurzer Schlüssel = kein Schlüssel (alles wie heute), ein Warn-Log je Start bei zu kurzen |
| E3 | Rumpf des 429 | JSON-RPC: `{"jsonrpc":"2.0","id":null,"error":{"code":-32029,"message":…,"data":{"code":"rate_limited","retryAfter":n}}}`, dazu `Retry-After: n` = Rest des Fensters (≥ 1) | B3: ein Programm erkennt JSON-RPC, keinen freien Text. −32029 liegt im Bereich für Server-Fehler (−32000 … −32099) |
| E4 | Überlast von edu-sharing | 429/503 von oben → `upstream_busy` mit `retryAfter` = Wert aus dem `Retry-After` von oben, sonst **10 s** | edu-sharing schickt nicht nachweislich einen; 10 s ist eine Schätzung und als solche dokumentiert |
| E5 | Sichere Wiederholung — woran gebunden? | An **Identität + Hash der Aufrufargumente**, nicht an die Änderungsmenge | Nach dem ersten Schreiben liest die Vorschau den NEUEN Stand: die Änderungsmenge des zweiten Aufrufs ist leer oder anders. Nur die Argumente sind dieselben — dieselbe Regel wie bei Plänen |
| E6 | Was wird wiederholt? | Jede Antwort, nachdem der Schlüssel eingelöst wurde, auch ein Fehler oder `timeout` — mit `structuredContent.replayed: true` | Der Schlüssel ist verbraucht; dieselbe Antwort ist die ehrliche. Ein offener Ausgang bleibt offen |
| E7 | `/auth/status` | GET, Kopf wie `/mcp`; Antwort `{mode, authenticated, authority, displayName?, credential}`; **kein `expiresAt`**; Ergebnis je Kopf 60 s im Speicher; am Protokoll-Budget und am Abuse-Limiter | Ein Block hat keine Frist; ein Ticket-Block endet mit der edu-sharing-Sitzung, deren Ablauf der Server nicht kennt (gemessen 2026-08-13: tot = 404/500, nie eine Ansage vorher). Ein erfundenes `expiresAt` wäre falsch. **Für Ticket- und Widget-Blöcke ersetzt durch R1 (Phase 7):** dort nennt `expiresAt` die Frist der Allow-Liste |
| E8 | `/ready` | Probe = `ngsearch` mit 1 Treffer (wärmt den Suchpfad mit); gecacht 30 s; einzeln laufend (single-flight); 503 `unreachable` bei Fehler, `slow` ab 5 s; Hintergrund-Probe alle 30 s, gestartet NUR aus `http.ts` | Kein Budget nötig: höchstens eine Anfrage an edu-sharing je 30 s, egal wie oft gefragt wird. Die Hintergrund-Probe ist zugleich S6s Aufwärmaufruf |
| E9 | S6 | Kein Keep-Alive-Umbau (M2: Nutzen ≤ 0,3 s). Stattdessen: Aufwärmen durch die Probe (E8) und eine Log-Zeile `slow upstream` mit Dauer je Endpunkt ab 5 s, damit die 22 s im Betrieb zuordenbar werden | Ursache ist nicht der Transport; raten hilft nicht |
| E10 | S7 | **Entschieden (2026-11-07):** die Empfehlung des Chatbot-Teams, siehe unten. Reihenfolge R4 → R2 → R1, jeweils nach S1–S4 | Nutzer: „rest müsste im Hinweis von vorhin stehen“ — der Hinweis ist die Empfehlung des Chatbot-Teams |

## Architektur

| Datei | Neu/Ändern | Verantwortung |
|---|---|---|
| `src/rate-limit.ts` | ändern | `RateLimiter.retryAfterSeconds(key, now)` — Rest des Fensters |
| `src/client-budget.ts` | neu | `parseTrustedClientKeys(env)`, `budgetBucket(headers, ip)`, `countToolCalls(body)`, `rateLimitedBody(retryAfter)` |
| `src/http-app.ts` | ändern | Protokoll-Budget vor dem Rumpf, Werkzeug-Budget nach dem Parsen; Routen `/auth/status`, `/ready` |
| `src/http.ts` | ändern | Limiter je Bucket aus `TRUSTED_CLIENT_KEYS`; Readiness-Probe starten |
| `src/services/failure-code.ts` | ändern | `upstream_busy` + `retryAfterOf(err)` |
| `src/wlo-search.ts`, `src/wlo-node.ts` | ändern | Fehlertext trägt `Retry-After` von oben, wenn vorhanden (`… 503 … retry-after=12`) |
| `src/tools/shared.ts` | ändern | `toolError`: `upstream_busy` mit `retryAfter` |
| `src/services/node-details.ts` + drei Schemata | ändern | `upstream_busy` als `missing`-Code zulassen |
| `src/services/write/confirm-replay.ts` | neu | Ergebnis-Speicher: `withReplayContext`, `lookupReplay`, `markRedeemed`, `completeReplay` |
| `src/services/write/confirm.ts` | ändern | `consumeToken` markiert eingelöst; ein schon eingelöster Schlüssel → `'replay'` |
| `src/tools/curation-shared.ts` | ändern | `registerCurationTool`: Wiederholung vor dem Handler; `replay: false` für die zwei Plan-Werkzeuge |
| `src/auth/auth-status.ts` | neu | `authStatusPayload(cred, identity)` — EINE Quelle für Werkzeug und Endpunkt |
| `src/rest/auth-status.ts` | neu | `GET /auth/status` |
| `src/services/upstream-readiness.ts` | neu | Probe, Cache, single-flight, Timer |
| `src/rest/ready.ts` | neu | `GET /ready` |

Richtung: `rest/` und `services/` importieren nie aus `tools/` (Wächter vorhanden).
`http-app.ts` hat 490 Zeilen — neue Logik kommt in eigene Module, dort nur die
Verdrahtung.

## Nicht-funktional

- **Sicherheit:** Client-Schlüssel nie geloggt, nur als Hash gehalten, Vergleich
  über den Hash. `/auth/status` liegt unter `/auth*` und sendet daher keinen
  CORS-Kopf (bestehende Regel). Ein vertrauter Schlüssel hebt NUR das Budget,
  nie den Abuse-Limiter für Anmeldungen.
- **Speicher:** Ergebnis-Speicher ≤ 500 Einträge, 30 min; Status-Cache ≤ 1000
  Einträge, 60 s; Probe-Zustand konstant.
- **Beobachtbarkeit:** Log bei 429 mit Bucket-Art (`client`/`address`, nie der
  Schlüssel), bei `upstream_busy`, bei `slow upstream`.

## Risiken

| Risiko | Gegenmittel |
|---|---|
| Ein Client verlässt sich auf den alten 429-Rumpf `{"error": "…"}` | Der Text steht weiter in `error.message`; im CHANGELOG als Änderung markiert |
| Das SDK verlangt künftig `initialize` | Test aus M1 schlägt dann fehl |
| Wiederholung liefert eine Antwort an eine andere Person | Gebunden an `currentIdentity()`; fremde Identität → Verhalten wie heute (`confirm_unknown`) |
| Hintergrund-Probe erzeugt Last oben | 1 Anfrage je 30 s, `WLO_READY_PROBE_MS=0` schaltet sie ab |

## S7 — Anmeldung, zweite Stufe: ENTSCHIEDEN (2026-11-07)

Gewählt ist die Empfehlung des Chatbot-Teams. Sie ersetzt die Optionen der
ursprünglichen Vorlage (darunter, nur noch zur Nachvollziehbarkeit). Grundlage:
Das Widget meldet sich direkt im Browser an (OAuth oder Ticket-Tausch), der Block
liegt im Speicher der einbettenden Seite, „Abmelden“ löscht ihn nur dort.

- **R1 — Frist in der Allow-Liste, nicht im Token.** Der Registry-Eintrag bekommt
  beim Ausstellen ein Ablaufdatum: **12 h für Ticket- und Widget-Blöcke**;
  eingefügte Blöcke (KI-Hosts) bleiben ohne Frist. Ein abgelaufener Block wird
  behandelt wie ein widerrufener (401 auf `/mcp`). Das Token BLEIBT der Block —
  kein Wrapper, kein Refresh-Token; die Regel „das Token IST der Block“ gilt
  weiter, nur „kein Ablauf“ ändert sich. Abwägung des Chatbot-Teams: kurzlebige
  Token mit Refresh hätten die Regel aufgehoben und jeder Client bräuchte
  Erneuerungslogik, ohne Gewinn — edu-sharing kennt ohnehin kein Token.
  Folge: im Widget mit Passwort angemeldet = alle 12 h neu; über das Ticket
  geschieht es automatisch.
- **R2 — Selbst-Widerruf durch Besitz.** `POST /auth/revoke` nimmt den Block
  zusätzlich als `Authorization: Bearer` und widerruft genau ihn. Besitz ist der
  Nachweis. Aufruf server-zu-server aus dem Chatbot-Backend; `/auth*` bleibt ohne
  CORS.
- **R4 — `TICKET_ALLOWED_ORIGINS`.** Nur eingetragene Herkünfte dürfen aus dem
  Browser ein Ticket tauschen, andere 403; Anfragen ohne `Origin` (Server zu
  Server) unberührt; leere Liste = wie heute. Im Betrieb dieselbe Liste wie
  `CORS_ORIGINS` des Chatbots.

Gegenstück im Chatbot: CB-9 (Anmeldung vor Ablauf neu anbieten, Abmelden über das
Backend, gleiche Herkunftslisten, später Block an die Sitzung binden).

### Ursprüngliche Vorlage (ersetzt)

| Punkt | Option A | Option B | Empfehlung |
|---|---|---|---|
| **R1** Block ohne Frist | OAuth-Token mit `expires_in` + `refresh_token`; der Block bleibt der Refresh-Schlüssel, das Zugangstoken ist ein kurzlebiger, signierter Abkömmling (z. B. 1 h) | Frist IM Block (`exp` in der AEAD), Erneuerung = neuer Block über `/auth` bzw. erneute Anmeldung | **A** — ChatGPT/Claude erneuern selbst; B zwingt Personen regelmäßig zur Passworteingabe. Kostet: ein zweites Tokenformat, Refresh-Endpunkt; die Regel „das Token IST der Block" (CLAUDE.md, OAuth P4) wird bewusst aufgehoben — Nutzerentscheidung |
| **R2** Abmelden widerruft nicht | Neuer Endpunkt `POST /auth/revoke-self` mit dem eigenen Block als `Authorization` (kein Passwort nötig) — das Widget/Backend ruft ihn beim Abmelden | Nur dokumentieren: Widerruf über `/auth/revoke` mit Passwort | **A** — wer den Block hat, darf ihn beenden; das ist kein neues Recht |
| **R4** `/auth/ticket` für jede Herkunft | `WLO_TICKET_ALLOWED_ORIGINS` (Liste); leer = wie heute | Feste Liste im Code | **A**, Standard leer (kein Bruch); im Deployment auf die edu-sharing-Herkunft setzen |

Diese drei Zeilen brauchen eine Wahl des Nutzers, bevor ein Paket entsteht.

---

## Aufgaben

### Phase 1 — Budget und 429 (S1, S2a)

Schritt 0: `/better-coding-workflow` aufrufen.

**T1.1 Rest des Fensters** — `src/rate-limit.ts`, Test `tests/rate-limit.test.ts`.
`retryAfterSeconds(key: string, now: number): number` = `ceil((windowStart + windowMs - now)/1000)`, mindestens 1; für einen unbekannten Schlüssel 1.
Test zuerst: Fenster 60 s, Anfrage bei t=0, Abfrage bei t=45 s → 15; bei t=59,5 s → 1.

**T1.2 Client-Schlüssel** — `src/client-budget.ts` (neu), Test `tests/client-budget.test.ts`.
`parseTrustedClientKeys(raw: string | undefined): { clients: Map<string /*sha256*/, { name: string; rpm: number }>; rejected: string[] /*names*/ }`; Format `name:rpm:key`, Kommas trennen, Schlüssel ≥ 32 Zeichen, `rpm` positive Ganzzahl, sonst abgelehnt (Name in `rejected`, nie der Schlüssel).
`budgetBucket(header: string | string[] | undefined, ip: string, clients): { key: string; rpm?: number; kind: 'client' | 'address' }`.
Tests: gültiger Schlüssel → `client:boerdi`/360; unbekannter → Adresse; zu kurzer → abgelehnt; Schlüssel steht nirgends im Ergebnis.

**T1.3 Werkzeugaufrufe zählen** — `src/client-budget.ts`.
`countToolCalls(body: unknown): number` — Anzahl der Elemente mit `method === 'tools/call'` (Objekt oder Array).
Tests: `initialize` → 0, `tools/call` → 1, Batch aus 2 × `tools/call` + 1 Notification → 2.

**T1.4 429 als JSON-RPC** — `rateLimitedBody(retryAfter: number, message: string): string` (E3). Test: parsebar, `error.data.code === 'rate_limited'`, `retryAfter` übernommen.

**T1.5 Verdrahtung** — `src/http-app.ts`, `src/http.ts`, Test `tests/http-app.test.ts`.
Optionen: `toolLimiterFor(bucket)` und `protocolLimiterFor(bucket)` (je Bucket ein Limiter; für Clients mit eigenem `rpm`). Vor dem Rumpf: Protokoll-Budget (3 × rpm). Nach dem Parsen: Werkzeug-Budget je `tools/call`. 429 mit `Retry-After` = `retryAfterSeconds` und Rumpf aus T1.4. `/api/*` bekommt dieselbe genaue Wartezeit, aber einen REST-Rumpf `{error, code: "rate_limited", retryAfter}` — dort spricht niemand JSON-RPC (beim Bauen entschieden).
Tests (echter Server): bei rpm 2 laufen 5 × `initialize` durch, der 3. `tools/call` → 429 mit `Retry-After` ≤ 60 und JSON-RPC-Rumpf; mit gültigem `X-WLO-Client-Key` (rpm 5) gehen 5 `tools/call` durch; ohne Schlüssel greift weiter die Adresse; F2-Test: erster POST `tools/call` → 200.

**T1.6 Doku** — `DEPLOYMENT.md` (`TRUSTED_CLIENT_KEYS`, Erzeugen eines Schlüssels: `openssl rand -hex 32`), `.env.example`, `docker-compose.yml`, `MCP-REFERENZ.md` §3/§6, `INTEGRATION.md` §3.5, CHANGELOG, STATUS.

### Phase 2 — `upstream_busy` (S2b)

Schritt 0: `/better-coding-workflow` aufrufen.

**T2.1** `src/wlo-search.ts:84`, `src/wlo-node.ts:78`: bei `!res.ok` den `Retry-After`-Kopf in den Fehlertext (`… retry-after=N`). Test: Mock mit 503 + `Retry-After: 12` → Fehlertext enthält `retry-after=12`.
**T2.2** `src/services/failure-code.ts`: `FailureCode` + `'upstream_busy'` bei `\b(429|503)\b`; `retryAfterOf(err): number` (aus `retry-after=N`, sonst 10). `codeOfStatus` (`services/node-details.ts`): 429/503 → `upstream_busy`. Tests je Fall.
**T2.3** `toolError` (`tools/shared.ts`): bei `upstream_busy` zusätzlich `retryAfter`. Schemata mit `missing`-Codes (`node-details.ts`, `collection-overview.ts`, `content-count.ts`) um `upstream_busy` erweitern. Test: Werkzeug gegen 503 → `error.code = upstream_busy`, `retryAfter = 10`.
**T2.4** Doku: Codetabelle (`MCP-REFERENZ.md` §2, HTML-Referenz), CHANGELOG, STATUS.

### Phase 3 — Sichere Wiederholung (S3)

Schritt 0: `/better-coding-workflow` aufrufen.

**T3.1 Speicher** — `src/services/write/confirm-replay.ts` (neu), Test `tests/write-confirm-replay.test.ts`.
`withReplayContext<T>(ctx: { token: string; argsHash: string }, fn: () => Promise<T>): Promise<T>` (AsyncLocalStorage); `markRedeemed(): void` (legt `running` an, Identität = `currentIdentity()`); `lookupReplay(token, argsHash): { kind: 'none' } | { kind: 'running' } | { kind: 'done'; result: unknown } | { kind: 'mismatch' }`; `completeReplay(result: unknown): void`. 30 min, ≤ 500 Einträge, Schlüssel nur als SHA-256. `argsHash(args)` = SHA-256 über JSON mit sortierten Schlüsseln.
Tests: done nach complete; andere Argumente → mismatch; andere Identität → none; abgelaufen → none.
**T3.2 Einlösen** — `confirm.ts`: `consumeToken` → bei `ok` `markRedeemed()`; ist der Schlüssel schon eingelöst und `lookupReplay` ≠ `none` → neues Ergebnis `'replay'`. `confirmOrExplain` (`curation-shared.ts`) gibt für `'replay'` die gespeicherte Antwort bzw. `inProgress` zurück.
**T3.3 Werkzeug-Schicht** — `registerCurationTool`: mit `confirmToken` erst `lookupReplay` (done → gespeicherte Antwort mit `structuredContent.replayed = true`; running → `{inProgress: true}`, kein Fehler; mismatch → `confirm_mismatch`), sonst Handler in `withReplayContext`, danach `completeReplay`. Option `replay: false` in `curation-tree.ts` und `curation-add-many.ts` (eigene Fortsetzung).
Tests (`tests/tools-curation-replay.test.ts`): (a) Antwort verloren → derselbe Aufruf → gleiche Antwort, `replayed: true`, **ein** POST an `/children`; (b) zweimal parallel (Upstream verzögert) → einmal geschrieben, der zweite `inProgress` oder `replayed`; (c) anderer Titel mit demselben Schlüssel → `confirm_mismatch`; (d) Plan-Werkzeug unverändert (bestehende Tests grün).
**T3.4** Doku: `MCP-REFERENZ.md` §2 (`replayed`, `inProgress`), `INTEGRATION.md` §3.4, CHANGELOG, STATUS.

### Phase 4 — `/auth/status`, `/ready`, Aufwärmen (S4, S5, S6)

Schritt 0: `/better-coding-workflow` aufrufen.

**T4.1** `src/auth/auth-status.ts`: `authStatusPayload(cred, identity)` aus `tools/auth.ts` herausziehen (Verhalten unverändert, bestehende Tests grün) + Feld `credential: 'access-block' | 'ticket' | 'basic' | 'service' | 'none'`.
**T4.2** `src/rest/auth-status.ts` + Route: Kopf wie `/mcp` (unbrauchbarer Bearer → 401 mit Challenge; unbrauchbares Basic → anonym), Abuse-Limiter, Protokoll-Budget, Cache 60 s je Kopf-Hash. Tests: mit Block 200 `mode: user`; widerrufener Block 401; ohne Kopf `mode: anonymous`; zwei Abfragen in 60 s → ein Upstream-Aufruf; kein CORS-Kopf.
**T4.3** `src/services/upstream-readiness.ts`: `probeUpstream(now)`, `readiness(now): Promise<{ ok: boolean; upstream: 'ok'|'slow'|'unreachable'; checkedAt; latencyMs }>`, `startReadinessProbe()/stopReadinessProbe()` (nur aus `http.ts`; Wächter in `shared-rule-discipline` wie beim Registry-Cache), `WLO_READY_PROBE_MS` (Standard 30000, 0 = aus). Tests: Cache 30 s, single-flight (zwei gleichzeitige → ein Upstream-Aufruf), Fehler → unreachable, > 5 s → slow.
**T4.4** `src/rest/ready.ts` + Route `GET /ready` (200/503, kein Budget). `slow upstream`-Log in `wloFetch` ab 5 s (Endpunkt-Pfad ohne Query, Dauer).
**T4.5** Doku: `DEPLOYMENT.md` (§5 Verify: `/ready`), `MCP-REFERENZ.md`, `INTEGRATION.md` §2, CHANGELOG, STATUS; `wlo_auth_status`-Beschreibung verweist auf `/auth/status` für Programme.

### Phase 5 — R4 Herkunftsliste für `/auth/ticket`

Schritt 0: `/better-coding-workflow` aufrufen.

Name: `TICKET_ALLOWED_ORIGINS` (so in der Entscheidung, passt zu
`TICKET_CREDENTIAL_LIMIT`), kommagetrennt. Zwei Stellen, eine Regel: der Server
verweigert eine fremde Herkunft (403), UND die CORS-Antwort nennt nur eine
eingetragene — sonst ginge die Vorabfrage eines fremden Browsers weiter durch
und erst der POST scheiterte. Mit Liste ersetzt der Spiegel der Herkunft
(`Access-Control-Allow-Origin: <origin>`, `Vary: Origin`) das `*`.

**T5.1** `src/auth/ticket-origins.ts` (rein): `parseAllowedOrigins(raw)` →
`{ origins: ReadonlySet<string>, rejected: string[] }` — jeder Eintrag über
`new URL(x).origin` normalisiert (Groß-/Kleinschreibung, Schrägstrich), nur
`http:`/`https:`, `*` und Unlesbares abgelehnt; `ticketOriginAllowed(origin,
allowed)` — leere Liste → ja, fehlende `Origin` → ja (Server zu Server),
eingetragen → ja, sonst nein (auch `null`). Tests zuerst.
**T5.2** `rest/auth-pages.ts`: `AuthEndpointDeps.ticketAllowedOrigins?`; auf
`/auth/ticket` nach dem Adress-Budget (Review: sonst unbegrenzte Logzeilen
mit gefälschtem `Origin`) und VOR dem Rumpf → 403
`origin_not_allowed`, Logzeile mit der Herkunft (kein Geheimnis). Tests: fremd
→ 403 ohne Upstream-Aufruf, erlaubt/fehlend → Tausch wie heute, leere Liste →
wie heute.
**T5.3** `http-app.ts`: Option durchreichen; CORS für `/auth/ticket` mit Liste
nur für eine eingetragene Herkunft (Spiegel + `Vary: Origin`), ohne Liste `*`.
Tests: Vorabfrage fremd ohne ACAO, erlaubt mit Spiegel, ohne Liste `*`.
**T5.4** `http.ts` (Umgebung lesen, Abgelehntes warnen), `.env.example`,
`docker-compose.yml`, `DEPLOYMENT.md`, `MCP-REFERENZ.md` (+ HTML), `INTEGRATION.md`,
`AUTH.md` §5c, CHANGELOG, STATUS.

### Phase 6 — R2 Selbst-Widerruf

Schritt 0: `/better-coding-workflow` aufrufen. `POST /auth/revoke` mit
`Authorization: Bearer <Block>` → genau dieser Block aus der Allow-Liste; danach
401 auf `/mcp`. Fremder oder ungültiger Block → keine Auskunft, welcher Fall.

Der Rumpf-Weg (`{token}`) bleibt unverändert; er ist schon „Besitz als
Nachweis“, nur verlangt er JSON. Der Bearer-Weg braucht keinen Rumpf und kein
JSON — der `Authorization`-Kopf macht die Anfrage ohnehin vorabfragepflichtig,
und `/auth*` antwortet keiner fremden Herkunft (genau der Grund, aus dem der
415 existiert, ist also schon erfüllt). Antwort: 200 `{revoked: true}` wenn er
gelistet war, sonst 200 `{revoked: false}` — gleich für unlesbar, fremd,
ungelistet und schon widerrufen, weil Abmelden idempotent ist und eine
Unterscheidung niemandem hilft, der den Block nicht hat. Kopf schlägt Rumpf.

**T6.1** Tests (`tests/auth-endpoints.test.ts`): Bearer ohne Rumpf widerruft und
`credentialFromHeader` liefert danach `null` (= 401 auf `/mcp`); unlesbar und
ungelistet → identische Antworten; Kopf schlägt Rumpf; ein `Basic`-Kopf ist kein
Bearer-Widerruf. **T6.2** `rest/auth-pages.ts`: Bearer-Zweig vor der
415-Prüfung. **T6.3** Doku: `AUTH.md`, `MCP-REFERENZ.md` (+ HTML),
`INTEGRATION.md`, CHANGELOG, STATUS.

### Phase 7 — R1 Frist in der Allow-Liste

Schritt 0: `/better-coding-workflow` aufrufen. Registry-Eintrag um `exp`
erweitern (alte Einträge ohne `exp` = ohne Frist), Ticket- und Widget-Blöcke
12 h, Prüfung an der einen Stelle, die den Block öffnet; `/auth/status` nennt
dann `expiresAt` (ersetzt E7 für diese Blöcke).

**Wie ein Widget-Block erkannt wird (beim Bauen entschieden, 2026-11-07).** Ein
Ticket-Block trägt `k: 'ticket'` — eindeutig. Ein Widget meldet sich mit Passwort
dagegen über OAuth an, und über OAuth kommen auch ChatGPT und Claude, deren
Blöcke laut Entscheidung OHNE Frist bleiben. Was die beiden unterscheidet, ist
das GEPRÜFTE `redirect_uri` des Clients (die Registrierung ist offen,
`client_name` ist Selbstauskunft — dieselbe Rangfolge wie auf der Zustimmungsseite).
Deshalb eine Betreiber-Liste `WIDGET_OAUTH_ORIGINS`: ein Block, der über OAuth an
einen Client mit `redirect_uri` aus einer dieser Herkünfte geht, bekommt 12 h.
Leer (Standard) = kein OAuth-Block bekommt eine Frist, also keine Änderung für
KI-Hosts. Im Betrieb: die Herkunft, auf die das Chatbot-Widget umleitet.

**T7.1** `access-registry.ts`: `RegistryEntry.exp?` (Sekunden, wie `iat`);
`isEntry` lehnt ein `exp`, das keine Zahl ist, ab (schließt zu wie ein
unbekanntes `k`); `has(jti, nowMs = Date.now())` ist falsch für einen
abgelaufenen Eintrag; `expiresAt(jti)` liefert `exp` oder `undefined`. Kein
Formatwechsel (optionales Feld, beide Richtungen — ein alter Build ignoriert
`exp`, was beim Zurückrollen die Frist aufhebt, nicht den Zugang).
`SESSION_BLOCK_TTL_S = 12 h`. Tests zuerst.
**T7.2** `ticket-exchange.ts`: `exp = iat + 12 h`; ein abgelaufener Eintrag gilt
als nicht gelistet und wird mit neuer Frist neu geschrieben (Erneuerung über das
Ticket geschieht so automatisch). `access-issue.ts`: optionales `ttlSeconds`.
`oauth-consent.ts`: `ttlSeconds` nur für eine Herkunft aus `WIDGET_OAUTH_ORIGINS`.
Tests: Ticket 12 h, Erneuerung, OAuth mit/ohne Liste.
**T7.3** Prüfung: `credentialFromHeader` fragt `registry.has` — die eine Stelle;
Test: abgelaufener Block → `null` → 401 auf `/mcp`.
**T7.4** `/auth/status` und `wlo_auth_status`: `expiresAt` (ISO) für einen Block
mit Frist; sonst weggelassen. Schema deklariert.
**T7.5** `http.ts` (`WIDGET_OAUTH_ORIGINS` über `parseAllowedOrigins`),
`.env.example`, `docker-compose.yml`, `DEPLOYMENT.md`, `MCP-REFERENZ.md` (+HTML),
`INTEGRATION.md`, `AUTH.md`, CHANGELOG, STATUS, CLAUDE.md.

## Abnahme

| Anforderung | Nachweis |
|---|---|
| S1: Schlüssel ≥ 360/min, ohne Schlüssel 120 | T1.5-Tests; der Lasttest mit 30 Personen über 5 min läuft im Studio des Chatbot-Teams (nicht hier messbar) |
| S2: `Retry-After` ≤ Rest des Fensters; `upstream_busy` | T1.1, T1.5, T2.3 |
| S3: verlorene Antwort → gleiches Ergebnis, ein Datensatz; parallel → einmal geschrieben | T3.3 (a)(b) |
| S4: 200 / 401 / anonymous | T4.2 |
| S5: 200 / 503 | T4.3, T4.4 |
| S6: Ursache eingegrenzt | M2 + Log-Zeile T4.4; die echte Ursache zeigt erst der Betrieb |
| Keine Regression | `npm test`, Typprüfung, Lint, Build nach jeder Phase |
