# Vorschlag zur Diskussion: Anmeldung aus der Redaktion übernehmen, und MCP ↔ Chatbot hinter der b-api (2026-11-21)

Für das Gespräch mit dem Chatbot-Team. Fasst die Pläne vom 15.11.
(`2026-11-15-chatbot-anmeldung-aus-der-sitzung.md`, `2026-11-15-b-api-betrieb.md`) mit dem zusammen, was
seither dazukam: die Umstellung der b-api auf Delegation (10.11.), der b-api-Proxy des Repositorys
(`/edu-sharing/rest/bapi/**`, gemessen 17./18.11.) und der Leitfaden „Dienste übergeben“ (17.11.).
Stand des MCP: 1.6.0.

Jede Aussage ist gekennzeichnet: **gebaut** (im MCP vorhanden), **gemessen** (gegen Staging), **Entwurf**
(nicht gebaut) oder **offen** (zu entscheiden oder zu messen).

## Teil A — Die Anmeldung aus der Redaktionsumgebung übernehmen

### A.1 Ziel

Wer in der edu-sharing-Redaktion (WLO) angemeldet ist, arbeitet im Chatbot-Widget mit **seinen** Rechten:
suchen, was er sehen darf, und schreiben unter seinem Namen — ohne zweite Anmeldung, ohne dass ein Passwort
oder das Sitzungs-Cookie den Browser Richtung Chatbot verlässt.

### A.2 Das Prinzip (gebaut seit 1.3.0)

```
Seite der Redaktion (Browser)
  │ 1. Sitzung oder Ticket ──► MCP  POST /auth/session | /auth/ticket ──► Zugangsblock (12 h)
  │ 2. Chat-Anfrage + Block ──► Chatbot-Backend
  │                               │ 3. POST /mcp   Authorization: Bearer <Block>
  │                               ▼
  │                              MCP ──► Repository, als diese Person
```

Der **Zugangsblock** ist die eine Währung: ein verschlüsseltes Paket, das nur der MCP öffnen kann,
12 Stunden gültig, widerrufbar (`POST /auth/revoke`), an seine Eintragung gebunden (ein Abmelden hält,
auch wenn dieselbe Sitzung erneut getauscht wird). Mit ihm laufen **alle** Werkzeuge als die Person — auch
die Kuratier-Werkzeuge, `wlo_start_flow` und `wlo_delete_own_content`. Ohne ihn liest der MCP anonym.

### A.3 Drei Wege zum Block — alle gebaut

| Weg | Was das Widget hat | Aufruf | Voraussetzung | Stand |
|---|---|---|---|---|
| **A Ticket** | ein edu-sharing-Ticket von der Seite | `POST {MCP}/auth/ticket` `{ticket}` — von jeder Seite (CORS) | `WLO_AUTH_PRIVATE_KEY`; optional `TICKET_ALLOWED_ORIGINS` | in Betrieb seit August |
| **B1 Sitzung, eingehängt** | nichts — nur die Sitzung der Seite | `POST /edu-sharing/services/wlo-mcp/auth/session` `{}` mit `credentials: 'same-origin'` | der Pfad liegt auf dem **Host des Repositorys** und zeigt auf den MCP (`sessionIngress`); der MCP läuft im Cluster des Repositorys | gebaut, gemessen mit echter Sitzung |
| **B2 Sitzung, weitergereicht** | nichts — nur die Sitzung der Seite | derselbe Aufruf, aber der Pfad auf dem Repository-Host gehört dem **Chatbot-Backend**; es reicht `Cookie` + `Origin` von Server zu Server an `{MCP}/auth/session` weiter, mit `X-WLO-Client-Key` und `X-WLO-Client-Address` | Schlüssel in `TRUSTED_CLIENT_KEYS`; `WLO_SESSION_EXCHANGE=1` | gebaut (1.4.0); **Ende-zu-Ende-Test mit eurem Backend steht aus** |

Gemeinsame Regeln für B1/B2 (gebaut): nur von einer Seite mit der Herkunft des Repositorys (`Origin`
Pflicht; mit `WLO_SESSION_ALLOWED_ORIGINS` ersetzt die Liste diese Herkunft), nur JSON, keine
CORS-Kopfzeilen, gelesen werden nur `JSESSIONID` und `INGRESSCOOKIE`, jeder Repository-Aufruf mit
`DisableGuest: true` — eine beendete Sitzung liest nie still als Gast (gemessen). Genau diese Bedingungen
nennt der Leitfaden (Kap. 2.2, „Sicherheit“) als zulässige Ausnahme vom Verbot, Sitzungen weiterzugeben.

### A.4 Vorschlag: so nutzt das Widget es automatisch

1. **Beim Öffnen des Widgets** (und nach jedem 401 vom MCP): Ticket vorhanden → Weg A; sonst Weg B.
   Antwort `200 {ok, block, authority, displayName?}`.
2. **`authority` gegen die Seite prüfen:** stimmt sie nicht mit der Person überein, die die Redaktion als
   angemeldet kennt, Block verwerfen.
3. **Block nur im Arbeitsspeicher** des Widgets halten (kein `localStorage`), je Chat-Anfrage ans Backend
   mitgeben, dort **je Anfrage** verwenden — nie in einem gemeinsamen Zustand, nie im Log.
4. **Backend → MCP:** `Authorization: Bearer <Block>` + `X-WLO-Client-Key`. Der MCP erledigt den Rest:
   Rechte, Vorschau/Bestätigung, Rücklesen.
5. **Ende erkennen:** `401` an `/mcp` (abgelaufen, widerrufen) oder ein Werkzeug meldet die Anmeldung als
   abgelehnt (Sitzung beendet) → einmal neu tauschen; bei `400` anonym weiter. `503` sagt nichts über die
   Sitzung — Block behalten, später erneut.
6. **Abmelden im Chatbot:** `POST {MCP}/auth/revoke` mit dem Block.

Statuscodes und Einzelheiten unverändert wie im Plan vom 15.11., Abschnitte 1 und 4.

### A.5 Zu entscheiden (offen)

| # | Frage | Unser Vorschlag |
|---|---|---|
| A-1 | **B1 oder B2?** Hängt daran, ob der MCP im Cluster des Repositorys laufen wird (offen bei T6). | Bis das feststeht: **B2** — braucht am Repository-Ingress nur euren Pfad und funktioniert unabhängig davon, wo der MCP läuft. |
| A-2 | Liefert die Einbindung in der Redaktion dem Widget ein **Ticket**? | Wenn ja, ist Weg A der einfachste und bleibt Rückfall; B deckt Seiten ohne Ticket. |
| A-3 | **Ende-zu-Ende-Test** B2 auf Staging: Tausch von zwei Anschlüssen, wir lesen im Log die Pseudonyme und die Warnung `named no usable address` (Antwort 4 vom 15.11.). | Termin vereinbaren; vorher nennen wir die Version aus `/health`. |
| A-4 | Euer Schlüssel in `TRUSTED_CLIENT_KEYS` (`boerdi:500:<Schlüssel>`) und die Herkünfte für die Zielumgebung. | Vom Betrieb zu setzen. |

### A.6 Geprüft und verworfen: die Person über den b-api-Proxy des Repositorys beziehen

Seit dem 10.11. bürgt das Repository über `/edu-sharing/rest/bapi/**` für die angemeldete Person
(User-Assertion); so starten wir heute die Kestra-Flows (gemessen 18.11.). Als Ersatz für den Zugangsblock
taugt das **nicht**:

- Der Proxy reicht das Sitzungs-Cookie nicht weiter; was beim Dienst ankommt, ist ein Delegations-Token
  (`bdt_…`).
- Mit diesem Token kann ein Dienst nur über die b-api lesen (zehn Repository-Pfade) — **nicht schreiben,
  nichts hochladen, keine Jobs starten**, und es endet mit dem Aufruf (Leitfaden Kap. 2.2).
- Der MCP braucht für seine Werkzeuge weit mehr als die zehn Pfade (Kinderlisten, Verwendungen, Workflow,
  Rechte, Löschen, Verschieben, Vorschläge …) und für jedes Schreiben eine Anmeldung, die das Repository
  selbst annimmt.

Der Block bleibt also der Weg für die Person. Der Repository-Proxy bleibt der Weg, auf dem der **MCP**
für die Person b-api-Aufträge startet.

## Teil B — MCP und Chatbot, wenn sie als Dienste hinter der b-api laufen

Heute nutzt der Chatbot die b-api nur für LLM-Aufrufe und ruft den MCP direkt. Drei Ausbaustufen:

### B.1 Stufe 0 — wie heute (gebaut, in Betrieb)

```
Widget ──► Chatbot-Backend ──► MCP (direkt)      Chatbot-Backend ──► b-api (LLM)
```

Nichts zu tun. `Authorization: Bearer <Block>` und `X-WLO-Client-Key` gehen direkt an den MCP.

### B.2 Stufe 1 — der Chatbot hinter der b-api, der MCP direkt (kein Bau am MCP)

```
Widget ──► b-api  /api/v1/proxy/badboerdichat/…  ──► Chatbot-Backend ──► MCP (direkt)
```

- Hinter dem Proxy ist `Authorization` belegt: Dort steht das Delegations-Token der b-api. **Dieses Token
  gehört nicht an den MCP** — es gilt nur gegenüber der b-api.
- Der Block braucht deshalb einen eigenen Platz in eurer Chat-Anfrage:
  **im JSON-Körper** (etwa `wloAccess`) — ohne jede Einstellung am Proxy, unsere Empfehlung — oder in einer
  eigenen Kopfzeile, die der b-api-Admin in `allowedRequestHeaders` freigibt.
- Backend → MCP unverändert direkt, mit `Bearer <Block>` und `X-WLO-Client-Key`. Der MCP ist dann nur aus
  dem Cluster erreichbar zu machen oder bleibt öffentlich (für ChatGPT, Claude und andere MCP-Clients ist
  er es ohnehin).
- Für eure LLM-Rückrufe gilt Kap. 2.2 des Leitfadens: Token aus `Authorization` unverändert an die b-api
  zurück, kein eigener Schlüssel.

Das ist der Weg, den wir empfehlen: Er kostet am MCP nichts und trennt sauber, was wem gehört — die b-api
kennt den Aufrufer und die Kosten, der Block kennt die Person im Repository.

### B.3 Stufe 2 — auch der MCP hinter der b-api (Entwurf, nicht gebaut)

```
Chatbot-Backend ──► b-api  /api/v1/proxy/wlo-mcp/mcp ──► MCP
```

Heute scheitert das: Der MCP liest das `Bearer bdt_…` der b-api als unbrauchbare Anmeldung und antwortet
**401**; und der Block hätte keinen Platz, weil `Authorization` belegt ist.

Was dafür zu bauen und einzustellen wäre:

| Wo | Was |
|---|---|
| MCP | ein `Bearer bdt_…` als „Aufruf über die b-api, keine Person“ lesen — anonym statt 401; der Wert geht nirgends hin |
| MCP | eine **zweite Kopfzeile für den Block**, Vorschlag `X-WLO-Authorization: Bearer <Block>` — wird Teil der Schnittstelle nach außen |
| b-api (Admin) | Proxy-Eintrag `wlo-mcp`: `baseUrl`, `responseTimeout`, `allowedRequestHeaders` (`X-WLO-Authorization`, `X-WLO-Client-Key`, `X-WLO-Client-Address`, `Accept`), `allowedResponseContentTypes` |
| Betrieb | `MCP_SSE` aus (JSON statt Stream), solange ungeprüft ist, ob der Proxy Streams nach rund 30 s abbricht; NetworkPolicy: öffentlicher Port nur für die b-api |
| Chatbot | Aufruf über die b-api statt direkt; Block in `X-WLO-Authorization` |

**Automatische Erkennung:** Die ersten beiden Punkte können ohne Schalter laufen — der MCP erkennt je
Anfrage an der Form des Tokens, dass er über die b-api gerufen wurde, und niemand bekommt dadurch mehr
Rechte. Am MCP wäre dann nichts einzustellen; nötig ist nur der Proxy-Eintrag. Erst wenn der MCP das Token
selbst an die b-api **weiterreichen** soll (etwa für die Textextraktion), braucht es einen Schalter
(`B_API_BASE_URL`), sonst gäbe ein direkt erreichbarer MCP jeden fremden `Bearer` weiter.

**Was Stufe 2 bringt:** ein Eingang für alles, Kontingente und Nutzung am b-api-Schlüssel, der MCP ist
nicht direkt erreichbar. **Was sie nicht bringt:** eine Anmeldung der Person — die kommt weiter aus dem
Block (A.6). Und externe MCP-Clients (ChatGPT, Claude) brauchen weiter den direkten Eingang mit OAuth,
anonymem Lesen und SSE; der MCP hätte dann beide Eingänge.

Offen und nur mit einem Proxy-Eintrag auf Staging messbar:

- Kommt eine freigegebene eigene Kopfzeile unverändert durch? Kommt `x-client-trace-id` / B3 an?
- Trägt der Proxy `text/event-stream`, und wie lange?
- Darf ein Dienst hinter der b-api mit seinem Delegations-Token einen **anderen Proxy-Dienst** rufen
  (Chatbot → `proxy/wlo-mcp`)? Der Leitfaden zeigt das für die Textextraktion; welche `delegationScopes`
  es dafür braucht, ist zu klären.
- Das Token endet mit dem ursprünglichen Aufruf: Alles, was der Chatbot über die b-api beim MCP auslöst,
  muss **innerhalb** dieser einen Chat-Anfrage fertig werden. Unsere Stapel-Werkzeuge arbeiten in Stücken
  je Aufruf (bis ~40 s) — passt, wenn euer `responseTimeout` das trägt.

### B.4 Empfehlung

- **Jetzt:** Stufe 0/1 und Weg B2 (oder A, wo ein Ticket da ist). Kein Bau am MCP.
- **Stufe 2 nur, wenn T6 verlangt, dass der MCP nicht direkt erreichbar ist.** Dann zuerst messen
  (Proxy-Eintrag auf Staging), danach das kleine Paket am MCP. Vorab von euch und dem Betreiber zu
  entscheiden: der Name der zweiten Kopfzeile.

## Fragen für das Gespräch

1. Welcher Weg zum Block im Widget — Ticket (A), eingehängt (B1) oder weitergereicht (B2)? (A-1, A-2)
2. Wann testen wir B2 Ende-zu-Ende auf Staging? (A-3)
3. Läuft euer Backend künftig hinter der b-api (Stufe 1)? Dann: Block im JSON-Körper oder eigene Kopfzeile?
4. Gibt es einen Grund, auch den MCP hinter die b-api zu stellen (Stufe 2)? Wenn ja: Name der Kopfzeile,
   und wer bittet den b-api-Admin um den Proxy-Eintrag zum Messen?
5. Ruft ihr über die b-api andere Proxy-Dienste mit dem Delegations-Token — habt ihr Erfahrung mit den
   nötigen `delegationScopes`?
