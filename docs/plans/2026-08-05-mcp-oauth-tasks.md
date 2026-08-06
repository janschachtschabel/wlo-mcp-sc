# Tasks: OAuth 2.1 — ein Anmeldeweg für alle MCP-Clients

Ausführungsplan zu `2026-08-05-mcp-oauth-design.md`. **Das Design ist der
Vertrag** — was hier nicht steht, wird nicht gebaut; was sich als falsch
erweist, ändert zuerst das Design.

17 Aufgaben in 5 Paketen. Jedes Paket beginnt mit Schritt 0.

| Paket | Inhalt | Zustand |
|---|---|---|
| P1 | Discovery-Dokumente + Vier-Wege-Entscheidung + 401-Kette | **fertig 2026-08-05** (T1.6 offen: Messung) |
| P2 | `/oauth/register` — die Redirect-Prüfung | **fertig 2026-08-05** |
| P3 | `/oauth/authorize` + Anmeldeseite | **fertig 2026-08-05** |
| P4 | `/oauth/token` | **fertig 2026-08-05** |
| P5 | Live-Durchlauf, Doku, Abschluss | **ChatGPT live bestätigt 2026-08-05**; Claude offen |

**Die Sperre ist am 2026-08-05 aufgehoben.** Die Messung (T1.6) fiel positiv
aus: ChatGPT findet die Discovery-Dokumente ohne 401 und scheitert erst an
`/oauth/register` — dem ersten Stück von Paket 2.

---

## Was durchgehend gilt

- **Kein Commit, kein Push.** Der Nutzer lädt hoch. Aufgaben enden mit
  „Dateien bereit", nie mit `git commit`.
- **ESM:** projektinterne Importe tragen `.js`, auch wenn die Quelle `.ts` ist.
- **Sprache:** Code, Bezeichner, Kommentare englisch. Nutzertext auf
  `/oauth/authorize` deutsch (die Seite sehen WLO-Redakteure).
- **Reine Module lesen `process.env` nicht** — `http.ts` liest, gibt weiter
  (`access-setup.ts` ist das Muster; `env-parsing-discipline.test.ts` erzwingt es).
- **Testlauf:** `npm test`. Einzeln: `node --import tsx --test tests/<datei>.test.ts`
  (ohne Netzwerk-Wächter — der volle Lauf hat ihn).
- **OAuth ist an, wenn Zugangsblöcke an sind.** `currentAccessSupport()` ist der
  eine Schalter; ohne Schlüsselmaterial antwortet jeder `/oauth`- und
  `/.well-known`-Pfad **404**, wie `/auth/issue` es heute tut.

---

# P1 — Discovery + Routing (das Experiment)

**Schritt 0: `/better-coding-workflow` aufrufen** (Skills entladen sich).

Ziel: Ein Client, der diesen Server einträgt, **findet** den OAuth-Rahmen —
und wer nichts mitschickt, liest weiter anonym.

---

### T1.1 — `oauth-metadata.ts`: Herkunft und die zwei Dokumente

**Dateien**
- Neu: `src/auth/oauth-metadata.ts`
- Neu: `tests/oauth-metadata.test.ts`

**Schnittstellen**

```ts
export interface IssuerEnv {
  /** WLO_PUBLIC_BASE_URL — die verbindliche Quelle. */
  configured?: string;
  /** `Host`-Kopf der Anfrage; nur mit trustProxy benutzt. */
  host?: string;
  /** `X-Forwarded-Proto`; nur mit trustProxy benutzt. */
  forwardedProto?: string | string[];
  trustProxy: boolean;
}
export function resolveIssuer(env: IssuerEnv): string | null;
export function authorizationServerMetadata(issuer: string): Record<string, unknown>;
export function protectedResourceMetadata(issuer: string): Record<string, unknown>;
```

**Was**

`resolveIssuer` liefert die öffentliche Herkunft (`https://host`, ohne Pfad) oder
`null`. Reihenfolge: `configured` (über `new URL(...).origin` normalisiert, bei
Unparsbarkeit `null`), sonst — **nur wenn `trustProxy`** — aus `host` +
`forwardedProto` (Vorgabe `https`), sonst `null`. `host` mit einem Zeichen außer
`[A-Za-z0-9.\-:\[\]]` wird verworfen: der Kopf kommt vom Aufrufer.

`null` bedeutet: OAuth ist nicht bedienbar, alle Endpunkte 404.

Die Dokumente:

```ts
// RFC 8414
{ issuer,
  authorization_endpoint: `${issuer}/oauth/authorize`,
  token_endpoint:         `${issuer}/oauth/token`,
  registration_endpoint:  `${issuer}/oauth/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['wlo'] }

// RFC 9728
{ resource: `${issuer}/mcp`,
  authorization_servers: [issuer],
  scopes_supported: ['wlo'],
  bearer_methods_supported: ['header'] }
```

`grant_types_supported` trägt **kein** `refresh_token` — wir geben keines aus,
und ein angekündigter Grant, den der Token-Endpunkt ablehnt, ist eine Lüge im
Vertrag.

**Schritte**

- [x] Test zuerst; er muss rot sein, weil das Modul fehlt
  (`ERR_MODULE_NOT_FOUND`). Fälle:
  - `configured: 'https://a.example/pfad'` → `'https://a.example'` (Pfad fällt weg)
  - `configured` unparsbar → `null`
  - ohne `configured`, `trustProxy: false`, `host` gesetzt → `null`
  - ohne `configured`, `trustProxy: true`, `host: 'a.example'` → `'https://a.example'`
  - `forwardedProto: 'http'` mit trustProxy → `'http://a.example'`
  - `host: 'a.example/evil'` bzw. `'a.example\n'` mit trustProxy → `null`
  - `forwardedProto: ['https','http']` (Array) → erster Wert zählt
  - beide Dokumente: jeder Endpunkt beginnt mit dem Issuer;
    `grant_types_supported` enthält `refresh_token` **nicht**;
    `code_challenge_methods_supported` ist genau `['S256']`
- [x] Modul schreiben, Test grün
- [x] `npm test` — keine Regression

**Nachweis:** `node --import tsx --test tests/oauth-metadata.test.ts` → alle grün.
**Rücknahme:** beide Dateien löschen; nichts importiert sie noch.

---

### T1.2 — `rest/oauth-pages.ts`: die vier Discovery-Pfade

**Dateien**
- Neu: `src/rest/oauth-pages.ts`
- Neu: `tests/oauth-discovery.test.ts`

**Schnittstellen**

```ts
export interface OAuthEndpointDeps {
  ip: string;
  maxBodyBytes: number;
  rateLimiter: RateLimiter;
  authAbuseLimiter: DistinctValueLimiter;
  /** Öffentliche Herkunft dieser Instanz, pro Anfrage aufgelöst; null = aus. */
  issuer: string | null;
}
export async function handleOAuthEndpoint(
  req: OAuthReq, res: OAuthRes, deps: OAuthEndpointDeps,
): Promise<boolean>;
```

Gleicher Zuschnitt wie `handleAuthEndpoint`: `false` für einen fremden Pfad,
Fehlergrenze außen herum (`try/catch` → 500 mit allgemeinem Text, Grund ins Log).

**Was**

In P1 bedient das Modul genau vier `GET`-Pfade — alle mit demselben Körper, weil
Clients uneinheitlich raten:

| Pfad | Dokument |
|---|---|
| `/.well-known/oauth-authorization-server` | RFC 8414 |
| `/.well-known/oauth-authorization-server/mcp` | RFC 8414 |
| `/.well-known/oauth-protected-resource` | RFC 9728 |
| `/.well-known/oauth-protected-resource/mcp` | RFC 9728 |

Antwort: `200`, `Content-Type: application/json`, `Cache-Control: max-age=300`,
`X-Content-Type-Options: nosniff`. Ohne `currentAccessSupport()` **oder** ohne
Issuer: `404` mit `{ error: 'OAuth ist auf diesem Server nicht eingerichtet.' }`.
Anderes Verfahren als `GET`: `405` mit `Allow: GET`. Vor der Antwort
`deps.rateLimiter` — die Dokumente sind billig, aber öffentlich.

**Schritte**

- [x] Test zuerst (rot: Modul fehlt). Fälle:
  - ohne `setAccessSupport` → 404 auf allen vier Pfaden
  - mit Support, `issuer: null` → 404
  - mit Support und Issuer → 200, Körper gleich `authorizationServerMetadata(issuer)`
    bzw. `protectedResourceMetadata(issuer)`; `cache-control` gesetzt
  - `POST` auf einen der vier → 405 mit `Allow: GET`
  - unbekannter Pfad `/.well-known/openid-configuration` → `false` (fällt durch)
  - erschöpfter Begrenzer → 429
- [x] Modul schreiben, Test grün
- [x] `npm test`

**Nachweis:** neue Datei grün, voller Lauf ohne Regression.
**Rücknahme:** beide Dateien löschen — noch ist nichts verdrahtet.

---

### T1.3 — Einhängen in `http-app.ts`, ohne CORS zu verschenken

**Dateien**
- Ändern: `src/http-app.ts`
- Ändern: `tests/http-app.test.ts` (ergänzen)

**Was**

1. `import { handleOAuthEndpoint } from './rest/oauth-pages.js'` und
   `resolveIssuer` aus `auth/oauth-metadata.js`.
2. `HttpAppOptions` erhält `publicBaseUrl?: string` (aus `WLO_PUBLIC_BASE_URL`,
   gelesen in `http.ts`).
3. Aufruf **vor** `handleStaticRequest` und vor dem 404, hinter dem
   `/auth`-Block:
   ```ts
   if (await handleOAuthEndpoint(req, res, {
     ip: clientKey(req.headers['x-forwarded-for'], req.socket.remoteAddress, trustProxy),
     maxBodyBytes,
     rateLimiter: apiRateLimiter,
     authAbuseLimiter,
     issuer: resolveIssuer({
       configured: publicBaseUrl,
       host: req.headers['host'],
       forwardedProto: req.headers['x-forwarded-proto'],
       trustProxy,
     }),
   })) return;
   ```
4. **CORS-Ausnahme erweitern.** Heute: `if (!path.startsWith('/auth'))`. Neu:
   ```ts
   const noCors = path.startsWith('/auth') || path.startsWith('/oauth/authorize');
   ```
   Begründung als Kommentar direkt daneben: `/oauth/authorize` prüft ab P3 ein
   WLO-Passwort und ist damit dasselbe Rateorakel wie `/auth/issue` — beide
   Begrenzer zählen pro **Adresse**, also gäbe eine Wildcard-Herkunft einer
   fremden Seite jedes Besuchers Kontingent zum Raten und ließe sie das Ergebnis
   lesen. Die Discovery-Dokumente und `/oauth/register|token` behalten die
   Wildcard: sie enthalten nichts, was nicht ohnehin öffentlich ist, und Clients
   holen sie herkunftsfremd.
   **Die Regel kommt jetzt, nicht in P3** — sie in P3 nachzureichen hieße, die
   Ausnahme genau dann zu brauchen, wenn niemand mehr an sie denkt.
5. `http.ts`: `publicBaseUrl: process.env['WLO_PUBLIC_BASE_URL']` durchreichen.

**Schritte**

- [x] Tests ergänzen (rot, weil die Route noch nicht hängt):
  - `GET /.well-known/oauth-protected-resource` → 404 ohne Support (Vorgabe im Test)
  - `GET /oauth/authorize` trägt **keinen** `access-control-allow-origin`
  - `GET /.well-known/oauth-authorization-server` trägt `access-control-allow-origin: *`
  - `GET /auth` trägt weiterhin keinen — Regression der bestehenden Regel
- [x] Verdrahten, Tests grün
- [x] `npm test`

**Nachweis:** `node --import tsx --test tests/http-app.test.ts` grün + voller Lauf.
**Rücknahme:** die vier Änderungen in `http-app.ts` zurücknehmen.

---

### T1.4 — Die Vier-Wege-Entscheidung und der 401

**Dateien**
- Ändern: `src/http-app.ts` (MCP-Zweig)
- Neu: `tests/oauth-routing.test.ts`

**Was**

Heute degradiert ein unbrauchbarer `Authorization`-Kopf auf anonym. Neu, und nur
für `Bearer`:

| Was ankommt | Weg |
|---|---|
| kein `Authorization` | anonym, 200 — **unverändert** |
| `Basic …` brauchbar | bestehender Pfad |
| `Basic …` unbrauchbar (kaputtes base64, kein Doppelpunkt) | anonym, 200 — **unverändert** |
| `Bearer wlo2.…` gültig und gelistet | bestehender Pfad |
| `Bearer …` sonst (gefälscht, gesperrt, fremder Schlüssel) | **401 + `WWW-Authenticate`** |

Der Kopf:

```
WWW-Authenticate: Bearer error="invalid_token",
  error_description="The access token is invalid or has been revoked.",
  resource_metadata="<issuer>/.well-known/oauth-protected-resource"
```

Ohne Issuer entfällt nur `resource_metadata`; der 401 bleibt.

**Warum nur `Bearer`:** ein `Basic` mit falschem Passwort ist eine WLO-Anmeldung,
die WLO ablehnt — nicht unser Token. Ihm einen OAuth-401 zu geben, schickte
jemanden mit Tippfehler im Passwort in einen Anmeldeablauf, der sein Problem
nicht löst. Ein gesperrter Block dagegen **soll** genau dorthin: „hol dir einen
neuen" ist die richtige Auskunft.

`isUnusableAuthorization` bleibt, wie es ist; die Unterscheidung ist neu und
gehört daneben:

```ts
/** A Bearer we could not turn into a credential — forged, revoked, foreign key. */
export function isUnusableBearer(raw: string | undefined): boolean {
  const value = (raw ?? '').trim();
  return /^Bearer\s+/i.test(value) && credentialFromHeader(value) === null;
}
```
(in `src/auth/credential.ts`, neben `isUnusableAuthorization`)

**Schritte**

- [x] Test zuerst, gegen einen echten `node:http`-Server wie `http-app.test.ts`:
  - **ohne `Authorization` → 200 und die volle Werkzeugliste.** Diese Zusicherung
    zuerst und namentlich: sie ist die Eigenschaft, die dieses Vorhaben am
    leichtesten kaputt macht. `tools/list` zählen, nicht nur den Status.
  - `Bearer nonsense` → 401, `www-authenticate` beginnt mit `Bearer `, enthält
    `error="invalid_token"` und die `resource_metadata`-URL
  - gültiger, gelisteter Block → 200
  - gültiger, **gesperrter** Block → 401
  - `Basic <kaputt>` → 200 (anonym), **kein** 401
  - `Basic <gültig>` → 200
  - ohne Issuer: `Bearer nonsense` → 401 ohne `resource_metadata`
- [x] `isUnusableBearer` ergänzen, Zweig umbauen, Tests grün
- [x] `npm test` — besonders `auth-bearer-access.test.ts`, `auth-per-user.test.ts`,
      `auth-public-surface.test.ts`. Ändert eine davon ihre Erwartung, ist das
      **eine Verhaltensänderung, die begründet gehört** — nicht ein Test, der
      angepasst wird.

**Nachweis:** voller Lauf grün; der Zähler der Werkzeugliste im anonymen Fall
steht im Testausgang.
**Rücknahme:** den Zweig auf `runAnonymous` zurücksetzen, `isUnusableBearer`
entfernen.

---

### T1.5 — Umgebung und Doku

**Dateien**
- Ändern: `.env.example`, `docker-compose.yml`, `README.md`, `README.de.md`,
  `docs/DEPLOYMENT.md`
- Ändern: `tests/deploy-env-passthrough.test.ts`

**Was**

`WLO_PUBLIC_BASE_URL` in Abschnitt 5 („Netz") beider Vorlagen, mit dem Satz, der
zählt: *ohne sie ist OAuth aus, es sei denn `TRUST_PROXY=1` — und der `Host`-Kopf
kommt vom Aufrufer.* Im Compose-Block als `${WLO_PUBLIC_BASE_URL-}`.

`deploy-env-passthrough.test.ts` prüft, dass jede Variable aus `.env.example`
im Compose ankommt — die neue Variable muss also **beidseitig** stehen, sonst
wird der bestehende Test rot. Das ist beabsichtigt: er ist genau dafür da.

**Schritte**

- [x] `npm test` **vor** der Änderung an `.env.example` allein → `deploy-env-passthrough`
      rot (der Beleg, dass der Test wirkt)
- [x] Compose ergänzen → grün
- [x] README (beide Sprachen) + DEPLOYMENT: ein Absatz „OAuth-Anmeldung", der
      sagt, dass P1 nur die Auffindbarkeit liefert und der Ablauf ab P3 steht
- [x] `npm test`

**Nachweis:** voller Lauf grün.

---

### T1.6 — Messung (Nutzer) — das Tor zu P2

Nicht von mir ausführbar: braucht den Deploy und einen echten Client.

- [ ] Nutzer lädt hoch, baut, startet neu
- [ ] `curl -s https://…/.well-known/oauth-protected-resource` → das Dokument
- [ ] ChatGPT-Connector auf die MCP-URL zeigen, **ohne** Endpunkte von Hand
- [ ] Beobachtung festhalten:
  - verschwindet `does not implement OAuth`?
  - welche Pfade fragt der Client ab (Caddy-Zugriffslog)?
  - verlangt er einen 401?
- [ ] Dasselbe mit Claude
- [ ] Ergebnis in `STATUS.md` **und** in den offenen Punkt 1 des Designs

**Entscheidung danach:** gefunden → P2. Nicht gefunden → Design-Änderung
(zweite URL mit 401, oder OAuth erzwingen), **nicht** P2.

---

# P2 — `/oauth/register`

**Schritt 0: `/better-coding-workflow` aufrufen.**

Der sicherheitskritische Teil: hier entscheidet sich, wohin ein Code je gesendet
werden darf. Ein Fehler ist eine Kontoübernahme.

---

### T2.1 — `oauth-clients.ts`: Redirect-Regel und zustandslose `client_id`

**Dateien**
- Neu: `src/auth/oauth-clients.ts`
- Neu: `tests/oauth-clients.test.ts`

**Schnittstellen**

```ts
export interface OAuthClient { redirectUris: string[]; name: string }
export function isValidRedirectUri(uri: string): boolean;
export function redirectUriMatches(registered: string, presented: string): boolean;
export function encodeClientId(client: OAuthClient, keys: AuthKeys): string;
export function decodeClientId(clientId: string, keys: AuthKeys): OAuthClient | null;
export const MAX_REDIRECT_URIS = 10;
```

**Was**

`isValidRedirectUri`: absolut, ohne Fragment, ohne Zugangsdaten
(`user`/`password` leer); `https:` immer erlaubt; `http:` **nur** bei
`localhost`, `127.0.0.1`, `::1`; jedes andere Schema (`javascript:`, `data:`,
`file:`, eigene App-Schemata) abgelehnt.

`redirectUriMatches`: zeichengenau — **außer** beide Seiten sind Loopback, dann
zählen Schema, Pfad und Query, der Port nicht (RFC 8252 §7.3: CLI-Clients
wählen pro Sitzung einen zufälligen Port). Loopback-Namen sind untereinander
gleichwertig (`localhost` ↔ `127.0.0.1`), weil Clients bei der Registrierung und
beim Rückruf verschiedene schreiben.

`encodeClientId` / `decodeClientId`: `wloc1.<b64u(iv)>.<b64u(ct||tag)>`,
AES-256-GCM. Schlüssel aus dem vorhandenen privaten Schlüssel:
```ts
hkdfSync('sha256', pkcs8Der, Buffer.alloc(0), 'wlo-oauth-client-id-v1', 32)
```
Die eigene `info`-Zeichenkette trennt diesen Zweck von jedem anderen, der dasselbe
Material je benutzt. `decodeClientId` liefert bei allem Ungültigen `null` — ohne
Unterschied zwischen „falsches Präfix", „Tag passt nicht", „kein JSON": jede
Auskunft darüber wäre ein Orakel.

**Schritte**

- [x] Test zuerst (rot). Die Prüfungen, die zählen:
  - `isValidRedirectUri`: `https://a.example/cb` ✓ · `http://localhost:1234/cb` ✓
    · `http://127.0.0.1/cb` ✓ · `http://a.example/cb` ✗ · `https://a.example/cb#x` ✗
    · `javascript:alert(1)` ✗ · `data:text/html,x` ✗ · `/relativ` ✗
    · `https://u:p@a.example/cb` ✗ · `http://[::1]/cb` ✓
  - `redirectUriMatches`:
    - gleich → wahr
    - `https://a.example/cb` vs `https://a.example/cb2` → **falsch**
    - `https://a.example/cb` vs `https://b.example/cb` → **falsch**
    - `https://a.example/cb` vs `https://a.example/cb?x=1` → **falsch**
    - `http://localhost:1111/cb` vs `http://127.0.0.1:2222/cb` → wahr
    - `http://localhost:1111/cb` vs `http://localhost:2222/andere` → **falsch**
    - `https://a.example:443/cb` vs `https://a.example:8443/cb` → **falsch**
      (Port frei gilt **nur** für Loopback)
  - `client_id`: Rundlauf erhält `redirectUris` und `name`; ein Zeichen im
    Chiffrat gekippt → `null`; unter einem **anderen** Schlüssel erzeugt → `null`;
    `'wloc1.aaa.bbb'` → `null`; leerer String → `null`
- [x] Modul schreiben, grün
- [x] `npm test` (auch `shared-rule-discipline` — das Modul schreibt nicht auf Platte)

**Nachweis:** `node --import tsx --test tests/oauth-clients.test.ts` grün.

---

### T2.2 — `POST /oauth/register`

**Dateien**
- Ändern: `src/rest/oauth-pages.ts`
- Ändern: `tests/oauth-discovery.test.ts` → umbenennen in `tests/oauth-endpoints.test.ts`

**Was**

RFC 7591, offen wie die MCP-Spezifikation es erwartet. Körper JSON:
`{ redirect_uris: string[], client_name?: string }`. Prüfung: 1 bis
`MAX_REDIRECT_URIS` Einträge, jeder `isValidRedirectUri`. Name auf 100 Zeichen
gekappt und durch `flattenText` (`text-sanitize.ts`) geführt — er ist fremder
Text, der später auf der Einwilligungsseite steht.

Antwort `201`:
```json
{ "client_id": "wloc1.…", "client_name": "…", "redirect_uris": ["…"],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code"], "response_types": ["code"] }
```
Fehler `400` `{ "error": "invalid_redirect_uri" | "invalid_client_metadata",
"error_description": "…" }`. Kein `client_secret` — öffentliche Clients, PKCE.

`deps.rateLimiter` vorweg; `maxBodyBytes` über `readBodyWithLimit`.

**Schritte**

- [x] Tests zuerst (rot):
  - ohne Support → 404
  - gültige Registrierung → 201, `client_id` beginnt `wloc1.`, kein
    `client_secret` im Körper
  - `redirect_uris: []` → 400 `invalid_redirect_uri`
  - `redirect_uris: ['http://boese.example/cb']` → 400
  - 11 URIs → 400
  - kein JSON → 400 `invalid_client_metadata`
  - `GET /oauth/register` → 405
  - der zurückgegebene `client_id` überlebt `decodeClientId` mit denselben URIs
- [x] Umsetzen, grün
- [x] `npm test`

---

# P3 — `/oauth/authorize` + Anmeldeseite

**Schritt 0: `/better-coding-workflow` **und** `/better-coding-frontend`
aufrufen** (dieses Paket enthält eine Seite, auf der jemand sein Passwort tippt).

---

### T3.1 — `oauth-codes.ts`: der einzige Zustand

**Dateien**
- Neu: `src/auth/oauth-codes.ts`
- Neu: `tests/oauth-codes.test.ts`

**Schnittstellen**

```ts
export interface CodeRecord {
  clientId: string; redirectUri: string; challenge: string;
  /** Der `wlo2.…`-Block — Chiffrat, das wir hier nicht öffnen. */
  block: string;
  label: string; expiresAt: number;
}
export interface CodeStore {
  mint(record: Omit<CodeRecord, 'expiresAt'>, now: number): string;
  consume(code: string, now: number): CodeRecord | null;
  size(): number;
}
export function createCodeStore(ttlMs?: number, max?: number): CodeStore;
export const CODE_TTL_MS = 60_000;
export const MAX_CODES = 1_000;
```

**Was**

`Map` im Arbeitsspeicher. `mint` erzeugt `mcp_ac_` + 32 Zufallsbytes base64url,
speichert unter dem **SHA-256** des Codes (ein Speicherabbild soll den Code nicht
verraten), räumt Abgelaufenes auf und wirft bei `MAX_CODES` das Älteste weg.
`consume` entfernt **immer** zuerst — auch wenn danach eine Prüfung scheitert,
ist der Code verbraucht — und liefert `null`, wenn er unbekannt oder abgelaufen ist.

`now` als Argument statt `Date.now()` im Modul: so ist Ablauf ohne Warten
prüfbar. Der Block liegt als **Chiffrat** darin; wir könnten ihn öffnen, tun es
aber nicht — das ist der Unterschied zum verworfenen Tresor, und er gehört als
Kommentar hinein.

**Schritte**

- [x] Test zuerst (rot):
  - `mint` → `consume` liefert den Satz zurück
  - zweites `consume` → `null` (Einmaligkeit)
  - `consume` bei `now > expiresAt` → `null`
  - unbekannter Code → `null`
  - `MAX_CODES + 1` Prägungen → `size() === MAX_CODES`, die älteste weg
  - zwei Prägungen liefern verschiedene Codes
  - der rohe Code taucht in `JSON.stringify` des internen Zustands **nicht** auf
- [x] Modul, grün
- [x] `npm test`

---

### T3.2 — `access-issue.ts` herauslösen (verhaltenserhaltend)

**Dateien**
- Neu: `src/auth/access-issue.ts`
- Ändern: `src/rest/auth-pages.ts`
- Ändern: `tests/auth-endpoints.test.ts` (unverändert grün — das ist der Nachweis)

**Schnittstellen**

```ts
export type IssueOutcome =
  | { ok: true; label: string; jti: string }
  | { ok: false; status: 400 | 429; error: string };

export async function issueAccessBlock(
  token: string,
  deps: { ip: string; authAbuseLimiter: DistinctValueLimiter; support: AccessSupport },
  now: number,
): Promise<IssueOutcome>;
```

**Was**

Der Rumpf von `route()` ab `decodeAccessToken` bis `registry.add` **wird
verschoben, nicht neu geschrieben**: Block entschlüsseln → Begrenzer für
verschiedene Anmeldungen → Login an der **Autorität** prüfen (nicht am
Statuscode) → `jti` eintragen. Deutsche Fehlertexte bleiben Zeichen für Zeichen
erhalten. `/auth/issue` ruft es fortan auf; `/oauth/authorize` (T3.4) ebenfalls.

**Schritte**

- [x] `npm test` **vorher** → `auth-endpoints.test.ts` grün, Ausgang notieren
- [x] Verschieben, `auth-pages.ts` ruft auf
- [x] `npm test` **nachher** → **derselbe** Ausgang. Kein Test angefasst.
      Muss einer angepasst werden, war es kein Verschieben, sondern eine
      Änderung — dann anhalten und sagen, welche.
- [x] Regel ergänzen in `tests/shared-rule-discipline.test.ts`: `checkIdentity(` in
      `src/**` nur in `auth/identity.ts` und `auth/access-issue.ts`. Begründung als
      Kommentar: die Autoritätsprüfung ist die Regel, an der „200 heißt nicht
      angemeldet" hängt; eine zweite Fassung würde genau die vergessen.
      Erst prüfen, ob heute schon weitere Aufrufer bestehen — falls ja, gehören
      sie in die Eigentümerliste, nicht in den Verstoß.

**Nachweis:** zwei `npm test`-Ausgänge, vorher und nachher gleich.
**Rücknahme:** Rumpf zurückschieben, neue Datei löschen.

---

### T3.3 — `GET /oauth/authorize`: erst prüfen, dann fragen

**Dateien**
- Ändern: `src/rest/oauth-pages.ts`, `src/rest/static.ts`
- Ändern: `tests/oauth-endpoints.test.ts`

**Was**

Reihenfolge ist der Punkt: **die Parameter werden geprüft, bevor irgendwem ein
Passwortfeld gezeigt wird.** Query: `client_id`, `redirect_uri`,
`code_challenge`, `code_challenge_method`, `response_type=code`, `state?`,
`scope?`.

- `client_id` nicht dekodierbar → `400`, Seite mit deutschem Text, **kein**
  Redirect (wir schicken niemanden an eine Adresse, die wir nicht anerkannt haben)
- `redirect_uri` passt zu keiner registrierten → `400`, **kein** Redirect
- `code_challenge_method !== 'S256'` oder `code_challenge` nicht `[A-Za-z0-9\-_]{43}`
  → `400`. `plain` wird abgelehnt, nicht geduldet.
- `response_type !== 'code'` → `400`
- alles gut → `200` mit `public/authorize.html`, CSP `AUTH_CSP`

`rest/static.ts` bekommt dafür `export async function sendAsset(res, asset)` —
den Rumpf, den `handleStaticRequest` heute inline hat. `handleStaticRequest`
ruft ihn ebenfalls: eine Fassung, nicht zwei (dieselbe Regel wie T3.2).

**Schritte**

- [x] Tests zuerst (rot): jeder Ablehnungsfall oben → 400 **und** `location`-Kopf
      fehlt; gültige Anfrage → 200, `content-type` HTML, CSP-Kopf gesetzt
- [x] `sendAsset` herauslösen, `handleStaticRequest` darauf umstellen,
      `rest-static.test.ts` muss unverändert grün bleiben
- [x] Umsetzen, grün
- [x] `npm test`

---

### T3.4 — `POST /oauth/authorize`: Einwilligung und Code

**Dateien**
- Ändern: `src/rest/oauth-pages.ts`
- Ändern: `tests/oauth-endpoints.test.ts`

**Was**

Körper JSON (nicht Formular — `form-action 'none'` steht in der CSP, und ein
JSON-Körper kann herkunftsfremd ohne Vorabfrage gar nicht erst gesendet werden,
was CSRF hier ohne eigenes Token schließt; `/oauth/authorize` trägt seit T1.3
keinen CORS-Kopf):

```json
{ "token": "wlo2.…", "client_id": "wloc1.…", "redirect_uri": "…",
  "code_challenge": "…", "code_challenge_method": "S256", "state": "…" }
```

Ablauf, in dieser Reihenfolge:
1. Parameter prüfen wie in T3.3 → Fehler ⇒ `400` **ohne** Redirect
2. `issueAccessBlock` (T3.2) → `400`/`429` mit dessen Text
3. `codeStore.mint` mit `block`, `clientId`, `redirectUri`, `challenge`
4. `200` `{ "redirect": "<redirect_uri>?code=…&state=…" }` — die Seite navigiert

`state` wird unverändert durchgereicht, auch leer. Der Code wandert in die
Query, wie die Spezifikation es vorschreibt; der **Block** niemals — er bleibt
im Speicher und verlässt uns erst über `/oauth/token`.

**Schritte**

- [x] Tests zuerst (rot):
  - gültiger Ablauf (gefälschtes WLO wie in `auth-endpoints.test.ts`, Autorität
    gesetzt) → 200, `redirect` beginnt mit der registrierten URI, trägt `code`
    und `state`
  - WLO lehnt ab (Gast-Autorität) → 400, **kein** Code geprägt (`store.size() === 0`)
  - fremde `redirect_uri` → 400, kein Redirect, kein Code
  - `code_challenge_method: 'plain'` → 400
  - kein `token` → 400
  - `state` fehlt → `redirect` ohne `state`
  - der geprägte Satz trägt den Block, und der Antwortkörper trägt ihn **nicht**
- [x] Umsetzen, grün
- [x] `npm test`

---

> **Abweichungen von diesem Paket, bewusst und gemessen (2026-08-05):**
>
> 1. **`GET /oauth/authorize` beantwortet `Accept: application/json` mit den
>    geprüften Anzeigedaten** (`{client_name, redirect_uri}`). Der Entwurf ließ
>    offen, woher die Seite den Namen nimmt — sie kann ihn nicht selbst haben:
>    `client_id` ist ein Chiffrat, das nur der Server öffnet. Die Alternativen
>    waren, den Namen in die Seite zu schreiben (Templating auf genau der Seite,
>    auf der jemand sein Passwort tippt) oder ihn aus der Query zu übernehmen
>    (dann sagt die Einwilligungsseite, was der Aufrufer will). Beides schlechter
>    als eine zweite Darstellung desselben Endpunkts.
> 2. **T3.5 wurde vor T3.3 gebaut.** Der 200-Fall von T3.3 liefert diese Datei
>    aus; ohne sie hätte der Test rot bleiben müssen, bis T3.5 kam.
> 3. **Die Prüfung liegt in `src/auth/oauth-authorize.ts`**, nicht in
>    `oauth-pages.ts`: GET und POST prüfen dieselbe Anfrage, und zwei Fassungen
>    sind genau die Stelle, an der die PKCE-Pflicht auf dem Pfad, der den Code
>    wirklich ausgibt, still verschwindet.
> 4. **`src/rest/static.ts` exportiert `AUTH_CSP` und `AUTHORIZE_ASSET`**, damit
>    Ablehnungsseite und Einwilligungsseite unter derselben Richtlinie stehen.

### T3.5 — Die Anmeldeseite

**Dateien**
- Neu: `public/authorize.html`, `public/authorize.js`
- Ändern: `src/rest/static.ts` (`/authorize.js` in die Zuordnung)
- Neu: `tests/oauth-authorize-page.test.ts`

**Was**

Zwillingsseite zu `auth.html`: dieselbe `auth.css`, dasselbe `access-block.js`,
kein Inline-Skript (die CSP verbietet es). Sie zeigt **wer fragt** — den
registrierten `client_name`, durch `flattenText` geführt — und was gleich
passiert, dann Benutzername/Passwort, dann „Anmelden und erlauben" neben
„Ablehnen".

Ablauf in `authorize.js`: Parameter aus `location.search`, Schlüssel von
`/auth/public-key`, `encodeAccessBlock(user, secret, key)`, `POST` auf
`/oauth/authorize`, dann `location.assign(data.redirect)`. „Ablehnen"
navigiert direkt auf `redirect_uri?error=access_denied&state=…`.

Qualitätsgrenze (aus `/better-coding-frontend`, wie bei `auth.html`): Zustände
lade/leer/Fehler ausgewiesen, `aria-live` für die Statuszeile, Beschriftungen an
den Feldern (kein Platzhalter als Beschriftung), `autocomplete="username"` /
`"current-password"`, sichtbarer Fokus, Kontrast ≥ 4,5:1 (Text) und ≥ 3:1
(Rahmen) in beiden Farbschemata, bedienbar bei 320 px und 200 % Zoom.

**Schritte**

- [x] Tests zuerst (rot):
  - `tests/launcher-contrast.test.ts` um `authorize.html` erweitern, falls es
    eigene Farben mitbringt — sonst erbt es `auth.css` und ist abgedeckt;
    **nachsehen, nicht annehmen**
  - `authorize.html` enthält kein `<script>` mit Rumpf (CSP-Zusicherung)
  - jedes Eingabefeld hat ein `<label for>`
  - `authorize.js` sendet an `/oauth/authorize` und nirgends sonst
    (Quelltext-Prüfung wie in `access-block-browser.test.ts`)
- [x] Seite und Skript schreiben, in `static.ts` eintragen, grün
- [x] `npm test`

---

# P4 — `/oauth/token`

**Schritt 0: `/better-coding-workflow` aufrufen.**

---

> **Abweichung, bewusst (2026-08-05):** der Endpunkt liegt in
> `src/rest/oauth-token.ts`, nicht in `oauth-pages.ts`. Der Plan wurde vor der
> Teilung in P3 geschrieben; „Metadaten veröffentlichen", „ein Passwort
> entgegennehmen" und „einen Einmal-Code einlösen" sind drei verschiedene Dinge,
> die man falsch machen kann.

### T4.1 — Der Tausch

**Dateien**
- Ändern: `src/rest/oauth-pages.ts`
- Ändern: `tests/oauth-endpoints.test.ts`

**Was**

`POST /oauth/token`, `application/x-www-form-urlencoded` (was OAuth-Clients
senden). Felder: `grant_type=authorization_code`, `code`, `client_id`,
`redirect_uri`, `code_verifier`.

Reihenfolge:
1. `grant_type !== 'authorization_code'` → `400 unsupported_grant_type`
2. `consume(code)` → nicht da ⇒ `400 invalid_grant`. **Verbraucht ist verbraucht**,
   auch wenn 3–5 danach scheitern.
3. `record.clientId !== client_id` → `400 invalid_grant`
4. `redirectUriMatches(record.redirectUri, redirect_uri)` falsch → `400 invalid_grant`
5. PKCE: `base64url(sha256(code_verifier)) === record.challenge`, Vergleich mit
   `timingSafeEqual` über gleich lange Puffer → sonst `400 invalid_grant`
6. `200` `{ "access_token": "<der Block>", "token_type": "Bearer", "scope": "wlo" }`
   mit `Cache-Control: no-store`, `Pragma: no-cache`

**Kein `expires_in`** (Design). **Kein `refresh_token`.**

**Schritte**

- [x] Tests zuerst (rot):
  - vollständiger Ablauf: register → authorize → token → `access_token` ist
    genau der geprägte Block
  - derselbe Code ein zweites Mal → 400 `invalid_grant`
  - falscher `code_verifier` → 400; und danach ist der Code **auch** weg
  - fremde `client_id` → 400
  - abweichende `redirect_uri` → 400
  - Loopback mit **anderem Port** → **200** (RFC 8252, der Fall, für den die Regel da ist)
  - `grant_type=refresh_token` → 400 `unsupported_grant_type`
  - Antwort trägt `cache-control: no-store` und kein `expires_in`
- [x] Umsetzen, grün
- [x] `npm test`

---

### T4.2 — Der ganze Weg, durch einen echten Server

**Dateien**
- Neu: `tests/oauth-flow.test.ts`

**Was**

Ein `node:http`-Server mit `createHttpRequestHandler`, echtem Schlüsselmaterial,
echter Positivliste in einem temporären Verzeichnis, gefälschtem WLO. Der Ablauf
so, wie ein Client ihn geht — und am Ende der Beleg, auf den es ankommt:

```
GET  /.well-known/oauth-protected-resource   → 200
GET  /.well-known/oauth-authorization-server → 200
POST /oauth/register                         → 201, client_id
POST /oauth/authorize (Block + Verifier-Hash)→ 200, redirect mit code
POST /oauth/token                            → 200, access_token
POST /mcp  Authorization: Bearer <access_token> → 200, Werkzeugliste MIT Kuration
POST /auth/revoke mit demselben Block         → 200
POST /mcp  mit demselben Token                → 401   ← Widerruf wirkt für beide Wege
POST /mcp  ohne Kopf                          → 200, anonyme Liste  ← unverändert
```

Die letzten zwei Zeilen sind der eigentliche Zweck des Tests: die eine Zusicherung,
die das Design verspricht (ein Widerruf wirkt für beide Wege), und die eine, die
dieses Vorhaben am leichtesten kaputt macht.

**Schritte**

- [x] Test schreiben; er muss an der Stelle rot sein, die noch nicht steht
- [x] Grün bekommen, ohne eine Zusicherung abzuschwächen
- [x] `npm test`

---

# P5 — Live, Doku, Abschluss

**Schritt 0: `/better-coding-workflow` aufrufen. Vor jeder Fertig-Aussage
zusätzlich `/better-coding-verify`.**

### T5.1 — Live gegen ChatGPT und Claude
- [x] Nutzer lädt hoch und startet neu
- [x] Verbinden **ohne** manuelle Endpunkte; Anmeldung mit einem echten WLO-Konto
      gegen **Staging**
- [x] Prüfen: Werkzeugliste enthält die Kurationswerkzeuge; ein Lesewerkzeug
      liefert; Widerruf auf `/auth-revoke.html` beendet den Zugang
- [ ] Dasselbe mit Claude
- [ ] Die offenen Punkte 2–4 des Designs mit dem **gemessenen** Ergebnis
      beantworten — besonders, ob ein Client ohne `expires_in` zufrieden ist

### T5.2 — Doku
- [x] README/README.de: Abschnitt „Anmelden per OAuth" mit den drei Schritten,
      die eine Person wirklich tut
- [x] `docs/DEPLOYMENT.md`: `WLO_PUBLIC_BASE_URL`, und warum ohne sie nichts geht
- [x] `CHANGELOG.md`
- [x] `CLAUDE.md`: Entwurfs-Eintrag → umgesetzt, mit den bindenden Regeln
      (kein Credential auf Platte · anonym bleibt 200 · Redirect zeichengenau
      außer Loopback · Code einmalig)
- [x] `docs/plans/STATUS.md`

### T5.3 — Abschluss
- [ ] `/better-coding-review` über den gesamten Diff
- [ ] `/better-coding-verify` mit echtem Testausgang
- [ ] Bericht an den Nutzer; **kein Commit**

---

## Was hiervon fehlschlagen kann

| Risiko | Woran man es merkt | Antwort |
|---|---|---|
| Client findet OAuth ohne 401 nicht | T1.6 | Design ändern, nicht weiterbauen |
| Der 401 bricht bestehende Nutzung | `auth-*`-Tests in T1.4 werden rot | Prüfen, ob die alte Erwartung richtig war; notfalls nur für `wlo2.`-Präfixe auslösen |
| Ein Client verlangt `expires_in` | T5.1 | Große Frist ausgeben und Design um den Neuanmeldeweg ergänzen |
| `client_id` zu lang für ein Eingabefeld | T5.1 | `redirect_uris` im Chiffrat kürzen (nur Herkunft + Pfad) |
| Schlüsselwechsel entwertet Registrierungen | nach Rotation | Hinnehmbar und dokumentieren: Clients registrieren neu, Blöcke bleiben gültig |
