# Für das Chatbot-Team: die Anmeldung aus der WLO-Sitzung übernehmen (2026-11-15)

Ziel: Der Chatbot sitzt als Widget in der Redaktionsumgebung. Wer dort angemeldet ist, soll über
den Chatbot mit **seinen** Rechten suchen und schreiben, ohne ein Passwort ein zweites Mal
einzugeben. Euer Backend läuft künftig hinter dem Proxy der B-API; das Frontend spricht mit ihm
über dessen Proxy-Pfad.

Kurz: Das **Frontend** holt beim MCP einmal einen Zugangsblock, gibt ihn dem **Backend** mit, und
das Backend schickt ihn bei jedem MCP-Aufruf als `Authorization: Bearer` mit. Es gibt zwei Wege
zum Block; welcher gilt, hängt nur davon ab, was die Einbindung dem Widget mitgibt.

```
Browser (Seite der Redaktionsumgebung)
  │ 1. Block holen ── POST …/auth/session  (Weg B)  oder  POST …/auth/ticket  (Weg A) ──► MCP
  │ 2. Chat-Anfrage mit dem Block ──► B-API-Proxy ──► euer Backend
  │                                                      │ 3. POST /mcp, Authorization: Bearer <Block>
  │                                                      ▼
  │                                                     MCP ──► Repository (als diese Person)
```

## 1. Den Block holen (Frontend)

### Weg A — die Seite gibt dem Widget ein Ticket (seit August in Betrieb)

```js
const r = await fetch(`${MCP}/auth/ticket`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ticket }),
});
```

Geht von jeder Seite aus; der Pfad sendet CORS-Kopfzeilen. Mit `TICKET_ALLOWED_ORIGINS` am MCP nur
von den dort genannten Seiten.

### Weg B — die Sitzung selbst (neu, am MCP ohne Vorgabe aus)

Braucht kein Ticket. Voraussetzung ist die Einrichtung in Abschnitt 5: Der Pfad `/auth/session`
des MCP ist auf dem **Host des Repositorys unterhalb von `/edu-sharing`** erreichbar. Nur dorthin
schickt der Browser das Sitzungs-Cookie.

Der Aufruf muss **von einer Seite desselben Hosts** kommen — dem Widget, wie es in der Seite der
Redaktionsumgebung läuft, oder einem iframe, das selbst von diesem Host geladen wird. Ein iframe
vom Host des Chatbots kann Weg B nicht nutzen: Der Pfad sendet keine CORS-Kopfzeilen, der Browser
bricht den Aufruf vor dem Absenden ab, und am MCP kommt nichts an. Dort bleibt Weg A.

```js
const r = await fetch('/edu-sharing/services/wlo-mcp/auth/session', {   // Pfad laut Betrieb
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});
```

Das Cookie selbst seht ihr nie; es ist für JavaScript nicht lesbar und muss es nicht sein.

### Die Antwort, bei beiden Wegen gleich

| Status | Körper | Bedeutung | Was tun |
|---|---|---|---|
| 200 | `{ok, block, authority, displayName?}` | angemeldet | `block` im Speicher halten |
| 400 | `{error}` | keine Sitzung, Sitzung beendet, Ticket ungültig, oder zwei verschiedene Sitzungs-Cookies in einer Anfrage | ohne Anmeldung weiter (nur lesen) |
| 403 | `{error, code: "origin_not_allowed"}` | diese Seite darf nicht | Betrieb fragen |
| 404 | `{error}` | der Weg ist an diesem MCP nicht eingeschaltet | den anderen Weg nehmen oder ohne Anmeldung weiter |
| 415 | `{error}` | `Content-Type` ist nicht `application/json` | Kopfzeile setzen |
| 429 | `{error, code, retryAfter}` | zu viele Anmeldungen von dieser Adresse | nach `retryAfter` Sekunden erneut |
| 503 | `{error, code: "upstream_unreachable", retryAfter}` | das Repository hat nicht geantwortet — **keine** Aussage über die Sitzung | nach `retryAfter` erneut, Block nicht verwerfen |

Empfohlene Reihenfolge im Widget: Ticket vorhanden → Weg A; sonst Weg B versuchen; bei 400, 403 oder 404
anonym weiterarbeiten. Zur Sicherheit `authority` mit der Person vergleichen, die die Seite selbst als
angemeldet kennt, und bei Abweichung den Block verwerfen.

## 2. Den Block ans Backend geben (Frontend → Backend, über den B-API-Proxy)

Hinter dem Proxy der B-API ist `Authorization` vom Schlüssel der B-API belegt. Der Block braucht
deshalb einen eigenen Platz. Zwei Möglichkeiten:

- **im JSON-Körper** eurer Chat-Anfrage, etwa als Feld `wloAccess` — geht ohne jede Einstellung am
  Proxy, unsere Empfehlung;
- in einer eigenen Kopfzeile, etwa `X-WLO-Access` — dann muss der Administrator der B-API sie am
  Proxy-Eintrag freigeben (`allowedRequestHeaders`).

Regeln für den Block, im Frontend wie im Backend:

- nur im Arbeitsspeicher halten, nicht in `localStorage`, nicht in einer Datenbank, nicht im Log;
- nur an den MCP weitergeben, an keinen anderen Dienst;
- je Anfrage mitgeben, nicht in einem gemeinsamen Zustand des Backends ablegen — sonst arbeitet eine
  Person mit dem Block einer anderen.

## 3. Den MCP aufrufen (Backend)

```
POST {MCP}/mcp
Authorization: Bearer <block>
Content-Type: application/json
Accept: application/json, text/event-stream
X-WLO-Client-Key: <euer Schlüssel>        (wie bisher, für euer eigenes Budget)
```

Ohne `Authorization` antwortet der MCP anonym und nur lesend, wie heute. Mit dem Block laufen alle
Werkzeuge als die angemeldete Person, die Kuratier-Werkzeuge eingeschlossen. Der MCP selbst steht
dabei **nicht** hinter der B-API; ihr ruft ihn direkt.

## 4. Lebensdauer, Abmelden, Fehler

- **Der Block endet 12 Stunden nach dem ersten Tausch** dieser Sitzung am MCP — und früher, sobald die
  Sitzung im Repository endet (Abmelden, Zeitablauf). Ein weiterer Tausch vor Ablauf verlängert **nicht**;
  nach Ablauf antwortet `POST /mcp` mit 401, und ein neuer Tausch derselben, noch lebenden Sitzung gilt
  wieder 12 Stunden.
- **Woran ihr das Ende erkennt:** `POST /mcp` antwortet 401 (Block abgelaufen oder widerrufen), oder
  ein Werkzeug meldet einen Fehler mit `forbidden` bzw. die Anmeldung als abgelehnt (Sitzung beendet).
  In beiden Fällen: Block verwerfen, im Frontend einmal neu tauschen, bei 400 anonym weiter.
- **Status in einem Aufruf:** `GET {MCP}/auth/status` mit dem Block, oder das Werkzeug
  `wlo_auth_status`. Die Art der Anmeldung steht dort als `credential`: `ticket` oder `session`.
  `/auth/status` antwortet 200, solange der Block selbst gilt; ob das Repository die Anmeldung
  annimmt, steht dann in `authenticated` (bis zu 60 Sekunden alt — für „gerade abgemeldet“ zählt der
  Fehler am Werkzeug). **401** heißt: der Block ist abgelaufen oder widerrufen — neu tauschen. **429**
  heißt: zu viele Abfragen — nach `retryAfter` erneut.
- **Abmelden im Chatbot:** `POST {MCP}/auth/revoke` mit `Authorization: Bearer <block>`; danach gilt
  der Block nicht mehr — **bis zum nächsten Tausch derselben Sitzung**, der dieselbe Kennung wieder
  einträgt. Endgültig ist nur das Abmelden im Repository; das gehört der Redaktionsumgebung.
- **Eine beendete Sitzung liest nicht still als Gast.** Jeder Aufruf mit einem Sitzungs-Block wird
  vom Repository abgelehnt, sobald die Sitzung endet (gemessen am 15.11.2026). „Nichts gefunden“
  bleibt also „nichts gefunden“.

## 5. Was der Betrieb dafür einstellt (nur für Weg B)

1. Am MCP: `WLO_AUTH_PRIVATE_KEY` (wie für Weg A) und **`WLO_SESSION_EXCHANGE=1`**.
2. Am Ingress des Repository-Hosts: ein Pfad unterhalb von `/edu-sharing`, der auf
   `POST /auth/session` des MCP zeigt und den Pfad dabei umschreibt, etwa
   `/edu-sharing/services/wlo-mcp/auth/session` → `/auth/session`. Mehr als dieser eine Pfad muss
   dort nicht liegen. Die Kopfzeilen `Cookie` und `Origin` müssen durchkommen.
3. Die aufrufende Seite muss die Herkunft des Repositorys haben, so wie der MCP es kennt
   (`WLO_REPOSITORY_URL`). Weicht die Adresse im Browser davon ab, kommt sie in
   `WLO_SESSION_ALLOWED_ORIGINS` (eine eigene Liste, nicht die für Tickets).
4. `TRUST_PROXY` am MCP muss zur Proxy-Kette des Repository-Ingress passen: Die Anfragen kommen über
   ihn, und sonst teilen sich alle Personen eine Adresse in den Begrenzungen.

Ohne Punkt 1 antwortet der MCP 404. Ohne Punkt 2 gibt es den Pfad auf dem Repository-Host nicht (404
vom Repository); ein direkter Aufruf des MCP von der Seite aus scheitert schon im Browser, weil der
Pfad keine CORS-Kopfzeilen sendet. Ohne Punkt 3 antwortet der MCP 403.

## 6. Testen

- Ohne Einbindung, gegen einen lokalen MCP (`WLO_SESSION_EXCHANGE=1`, Schlüssel gesetzt): im
  Browser am Repository anmelden, den Wert von `JSESSIONID` aus den Entwicklerwerkzeugen nehmen und

  ```bash
  curl -s -X POST http://localhost:3000/auth/session -H 'Content-Type: application/json' -H 'Origin: https://repository.staging.openeduhub.net' -H 'Cookie: JSESSIONID=<wert>' -d '{}'
  ```

  Erwartet: 200 mit `block` und eurem Kontonamen als `authority`.
- Danach mit dem Block `GET /auth/status` (`authenticated: true`) und ein Lese-Werkzeug; nach dem
  Abmelden im Repository muss das Werkzeug einen Fehler melden statt weniger Treffer zu liefern.
- Der Wert von `JSESSIONID` ist eine gültige Anmeldung: nicht in Tickets, Chats oder Dateien
  kopieren.

## 7. Was noch nicht geht

- Der MCP selbst hinter dem Proxy der B-API (er liest dort heute nichts, was er braucht).
- Eine Person über die B-API ausweisen lassen: Die edu-sharing-Pfade der B-API sind noch nicht in
  Betrieb; sobald sie es sind, prüfen wir diesen Weg.
