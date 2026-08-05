# Design: OAuth 2.1 — ein Anmeldeweg für alle MCP-Clients

**Status:** in Umsetzung — P1 fertig und live, offener Punkt 1 positiv gemessen · **Datum:** 2026-08-05

## Goal

Eine Person trägt in ihrem KI-Programm **nur die MCP-URL** ein, klickt einmal auf
„Anmelden", meldet sich mit ihrem WLO-Konto auf einer Seite dieses Servers an —
und arbeitet ab dann mit ihren eigenen Rechten. Ohne Header-Feld, ohne Kopieren,
ohne dass ihr Passwort den KI-Anbieter je erreicht.

**Anonymes Lesen bleibt unberührt:** wer nur die URL einträgt und sich nicht
anmeldet, bekommt weiterhin die 25 öffentlichen Lesewerkzeuge, ohne jede Hürde.

## Context — was heute gemessen wurde

Der bisherige Weg (verschlüsselter Zugangsblock im `Authorization`-Header) ist
fertig, live und funktioniert — **aber nur mit Clients, die ein Header-Feld
anbieten.** Am 2026-08-05 gegen die produktive Instanz gemessen:

| Beobachtung | Beleg |
|---|---|
| ChatGPT bietet **kein** Header- oder API-Key-Feld | Connector-Dialog: nur „OAuth", „Keine Authentifizierung", „Gemischt" |
| ChatGPT prüft den Server auf OAuth | Fehlermeldung `MCP server … does not implement OAuth` |
| ChatGPT erwartet: Auth-URL, Token-URL, Registrierungs-URL, Basis-URL, Ressource, Scopes | Feldliste unter „Erweiterte OAuth-Einstellungen"; Token-Endpunkt-Methode `none` (öffentlicher Client + PKCE) |
| Unser Server bietet nichts davon | `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/register`, `/authorize`, `/token` → **alle 404** |
| Unser Server löst die Discovery-Kette nie aus | ungültiger Bearer am `/mcp` → **200**, nicht 401 |

Der letzte Punkt ist kein Fehler, sondern eine dokumentierte Entscheidung
(`http-app.ts`): ein unbrauchbarer Header degradiert auf anonym, damit die
Anfrage funktioniert. **Genau diese Entscheidung macht OAuth-Discovery
unmöglich** — das ist der eigentliche Zielkonflikt dieses Vorhabens.

### Referenzimplementierung

`C:\Users\jan\github\mcp-wiki-js-ai` (MCP für Wiki.js, vom selben Betreiber)
löst dasselbe Problem produktiv und belegt: **OAuth 2.1 mit Dynamic Client
Registration funktioniert mit Claude *und* ChatGPT.** Gemessener Umfang dort:
1.331 Zeilen über 13 Dateien, ohne neue Abhängigkeit (`node:sqlite`).

Übernommen wird von dort: die Discovery-Dokumente (RFC 8414 + RFC 9728), der
Endpunkt-Zuschnitt, PKCE S256, öffentliche Clients, DCR, port-agnostische
Loopback-Redirects (RFC 8252, nötig für CLI-Clients).

**Nicht** übernommen wird der Sitzungsspeicher — siehe Approach.

## Scope

**In scope**
- Discovery: `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource[/mcp]`
- `GET /oauth/authorize` — Anmeldung mit WLO-Konto, Einwilligung, Ausgabe eines Codes
- `POST /oauth/token` — Code + PKCE-Verifier gegen Access-Token
- `POST /oauth/register` — Dynamic Client Registration (RFC 7591)
- `401` + `WWW-Authenticate` **nur** für einen präsentierten, aber unbrauchbaren OAuth-Token
- Wiederverwendung von `/auth` als Anmeldebildschirm und von `/auth-revoke.html` als Widerruf

**Out of scope**
- Refresh-Token-Rotation (siehe Approach: der Token läuft nicht ab, Widerruf ersetzt ihn)
- Serverseitige Sitzungsspeicherung von Zugangsdaten (ausdrücklich verworfen, siehe unten)
- Scopes mit unterschiedlichen Rechten — ein Scope, der die Kontorechte spiegelt
- Ablösung des bestehenden Header-Wegs; Basic und Zugangsblock bleiben unverändert

## Approach

### Die eine Zeile, die anders lauten muss

Die Referenz entscheidet pro Anfrage (`lib/oauth/routing.ts`, 23 Zeilen):

```
wiki-js:  nichts mitgeschickt → OAuth-Pfad → 401 + Discovery
wir:      nichts mitgeschickt → anonym, 200
```

Für Wiki.js ist anonymer Zugriff kein Anwendungsfall. Für uns ist er
Anforderung Nummer eins. Unsere Regel:

| Was ankommt | Weg |
|---|---|
| kein `Authorization` | **anonym, 200** — unverändert |
| `Bearer wlo2.…` | bestehender Zugangsblock-Pfad |
| `Basic …` | bestehender Pfad |
| `Bearer` mit unbrauchbarem OAuth-Token | **401 + `WWW-Authenticate`** → Discovery |

Damit ist OAuth *auffindbar*, aber nie *erzwungen*.

### Der Access-Token IST der Zugangsblock

Der entscheidende Unterschied zur Referenz. Dort hält ein SQLite-Speicher pro
Sitzung den **verschlüsselten Wiki-JWT**. Übertragen auf uns hieße das: das
**WLO-Passwort verschlüsselt auf unserer Platte** — edu-sharing hat kein JWT,
nur Basic (P0-Messung 2026-07-30). Das ist exakt die Tresor-Variante, die
`2026-08-04-mcp-access-token-design.md` verworfen hat: *ein Einbruch liefert
alle Zugangsdaten rückwirkend auf einmal.*

Der Ausweg liegt fertig vor: **`/oauth/token` gibt denselben `wlo2.…`-Block
aus, den `/auth` heute ausgibt.** Er ist selbsttragend, mit unserem
öffentlichen Schlüssel verschlüsselt, und die Positivliste macht ihn
widerrufbar. Folgen:

- **Kein Credential ruht auf der Platte** — die Eigenschaft, die das ganze
  bisherige Design trägt, bleibt erhalten.
- **Kein Sitzungsspeicher, kein SQLite, keine Refresh-Rotation.** Der einzige
  Zustand ist der Autorisierungscode: kurzlebig (60 s), einmalig, im Speicher.
- **Kein Ablauf** — wie beim Zugangsblock ersetzt der Widerruf ihn
  (Nutzerentscheidung 2026-08-04). `expires_in` entfällt oder wird großzügig
  gesetzt; ein Client, der erneuern will, durchläuft den Ablauf neu.
- **Ein Widerruf wirkt für beide Wege**, weil beide dieselbe Positivliste
  benutzen.

### Der Ablauf

```
Client            trägt nur die MCP-URL ein
  │
  ├─ (a) ohne Anmeldung ─────────────────────► anonym, 25 Lesewerkzeuge
  │
  └─ (b) „Anmelden"
       ├─ GET /.well-known/oauth-protected-resource   → Autorisierungsserver = wir
       ├─ GET /.well-known/oauth-authorization-server → authorize/token/register
       ├─ POST /oauth/register (DCR)                  → client_id
       ├─ Browser: GET /oauth/authorize?…&code_challenge=…
       │     └─ unsere /auth-Seite: WLO-Konto, Passwort IM BROWSER verschlüsselt
       │        → Login gegen WLO geprüft (Autorität, nicht Statuscode)
       │        → jti in die Positivliste, Code an redirect_uri
       ├─ POST /oauth/token (code + verifier)         → access_token = wlo2.…
       └─ ab jetzt: Authorization: Bearer wlo2.…      → bestehender Pfad
```

Schritt für Schritt ist alles rechts vom `/oauth/authorize` **bereits gebaut und
live**. Es kommt der OAuth-Rahmen davor, kein zweites Anmeldesystem.

## Architecture

| Datei (neu) | Verantwortung |
|---|---|
| `src/auth/oauth-metadata.ts` | Die zwei Discovery-Dokumente + Herkunftsauflösung. Rein, ohne HTTP. |
| `src/auth/oauth-codes.ts` | Autorisierungscodes: erzeugen, einmalig einlösen, TTL. Nur im Speicher. |
| `src/auth/oauth-clients.ts` | DCR: `redirect_uri`-Prüfung inkl. Loopback-Regel (RFC 8252), `client_id` zustandslos. |
| `src/auth/access-issue.ts` | Die aus `rest/auth-pages.ts` **herausgelöste** Ausgabe eines Blocks. |
| `src/rest/oauth-pages.ts` | HTTP-Adapter für `/oauth/authorize\|token\|register` + Discovery, wie `rest/auth-pages.ts`. |
| `public/authorize.html` + `.js` | Die Anmeldeseite im OAuth-Rahmen — teilt CSS und `access-block.js` mit `/auth`. |

Geändert: `src/http-app.ts` (Routen + die Vier-Wege-Entscheidung oben),
`src/rest/static.ts` (die neue Seite), `src/rest/auth-pages.ts` (nutzt die
herausgelöste Ausgabe), `src/http.ts` (die neue Umgebungsvariable).

**Richtung:** `auth/oauth-*` sind Blattmodule ohne Import aus `rest/` oder
`tools/` — dieselbe Regel, die `tests/shared-rule-discipline.test.ts` erzwingt.

### Drei Festlegungen, die der Entwurf offen ließ

**1. `client_id` ist zustandslos, nicht gespeichert.** Die Referenz legt
registrierte Clients in SQLite ab. Das geht hier aus zwei Gründen nicht: die
Positivliste ist der einzige Schreiber auf Platte (von
`tests/shared-rule-discipline.test.ts` erzwungen), und ein Speicher nur im
Arbeitsspeicher verlöre bei **jedem Neustart** alle Registrierungen — jeder
Deploy bräche jede bestehende Verbindung.

Stattdessen **trägt die `client_id` ihren Inhalt selbst**: `wloc1.<iv>.<ct>`,
AES-256-GCM über `{redirect_uris, name}`, mit einem aus dem vorhandenen privaten
Schlüssel abgeleiteten Schlüssel (`hkdfSync`, eigene `info`-Zeichenkette). Kein
Speicher, kein Ablauf, neustartfest. Dass jeder sich registrieren kann, ist kein
Verlust — DCR ist laut Spezifikation offen, und eine Registrierung gewährt für
sich genommen nichts: es folgt immer noch eine Anmeldung im Browser.

**2. Die Ausgabe eines Blocks wird herausgelöst, nicht kopiert.** Der
Einwilligungsschritt braucht genau, was `/auth/issue` heute tut: Block
entschlüsseln, beide Begrenzer, Login gegen WLO an der **Autorität** prüfen,
`jti` in die Positivliste. Das sind die sicherheitskritischsten vierzig Zeilen
des Projekts, und eine zweite Fassung davon ist exakt der Fehler, für den
`shared-rule-discipline.test.ts` existiert. `src/auth/access-issue.ts` wird die
eine Fassung; beide Endpunkte rufen sie.

**3. Die Herkunft kommt aus der Umgebung, nicht aus dem `Host`-Kopf.** Die
Discovery-Dokumente nennen unsere eigenen Endpunkte. Würden wir sie aus dem
`Host`-Kopf bauen, könnte ein gefälschter Kopf einen Client auf eine fremde
Anmeldeseite schicken. `WLO_PUBLIC_BASE_URL` ist deshalb die Quelle; ohne sie
wird nur dann aus `Host` abgeleitet, wenn `TRUST_PROXY` gesetzt ist — dieselbe
Bedingung, unter der dieser Server schon heute Proxy-Köpfen glaubt.

**Kein Ablauf im Token-Antwortkörper.** `expires_in` wird **weggelassen**, weil
der Block nicht abläuft und eine behauptete Frist, die niemand durchsetzt, nur
Neuanmeldungen erzeugt, die die Positivliste füllen. Ob ein Client das
akzeptiert, ist Messpunkt in Paket 5.

## Non-functional

**Sicherheit** — der sicherheitskritischste Code im Projekt. Ein Fehler in der
Redirect-Prüfung ist eine Kontoübernahme.

| Bedrohung | Gegenmaßnahme |
|---|---|
| Offener Redirect → Code an fremde Adresse | `redirect_uri` exakt gegen die registrierte prüfen; Loopback nur port-agnostisch nach RFC 8252, sonst zeichengenau. **Test-gepinnt.** |
| Abgefangener Code | PKCE S256 verpflichtend, `plain` abgelehnt; Code einmalig, 60 s |
| Code-Einlösung durch fremden Client | `client_id` und `redirect_uri` beim Token-Tausch erneut prüfen |
| CSRF auf der Einwilligungsseite | `state` durchreichen; Einwilligung nur per POST mit eigenem Token |
| Erraten von WLO-Logins über `/oauth/authorize` | dieselben zwei Begrenzer wie `/auth/issue` |
| Discovery-Dokumente als Angriffsfläche | statisch, ohne Eingaben, `Cache-Control` |
| Token im Log | wie bisher: nie geloggt, nur der Kontoname (sanitisiert) |
| Credential auf Platte | findet nicht statt — der Token ist selbsttragend |

**CORS:** Die Discovery-Dokumente brauchen `Access-Control-Allow-Origin: *` —
sie sind öffentliche, geheimnisfreie Metadaten, und Clients holen sie
herkunftsfremd. Das ist **kein** Widerspruch zur Regel, dass `/auth*` keinen
CORS-Header bekommt: dort wird ein Passwort geprüft, hier steht nichts drin,
was nicht ohnehin öffentlich ist.

**Anonymes Lesen:** durch die Vier-Wege-Entscheidung geschützt. Ein Test muss
pinnen, dass eine Anfrage ohne `Authorization` weiterhin 200 und die volle
Werkzeugliste bekommt — das ist die Eigenschaft, die dieses Vorhaben am
leichtesten kaputt macht.

## Offene Punkte

| # | Frage | Wie zu klären |
|---|---|---|
| 1 | ~~Findet ein Client OAuth ohne 401?~~ | **BEANTWORTET 2026-08-05: ja.** Gemessen an der produktiven Instanz — siehe unten. |
| 2 | Akzeptiert Claude denselben Weg? Die Referenz sagt ja, aber dort antwortet `/mcp` immer 401. | Nach Paket 1 live probieren |
| 3 | Welche Scopes erwartet ChatGPT? Die Felder „Basis-Scopes"/„Standard-Scopes" sind Pflichtfelder-artig. | Aus dem Experiment |
| 4 | `expires_in` ohne Ablauf — verweigern Clients einen Token ohne Ablaufzeit? | Aus dem Experiment |

**Punkt 1 ist ein Entscheidungspunkt, kein Detail.** Fällt er negativ aus,
stehen nur zwei Wege offen: OAuth erzwingen (anonymes Lesen fällt) oder eine
zweite URL anbieten, auf der `/mcp` mit 401 antwortet, während die
Haupt-URL anonym bleibt.

**Entschieden am 2026-08-05, gemessen statt geschätzt.** Nach dem Deploy von
Paket 1 wurde ein ChatGPT-Connector auf `…/mcp` gezeigt, Authentifizierung
`OAuth`, alle vier Endpunkt-Felder **leer**. Ergebnis:

```
Dynamic client registration failed: registration endpoint returned 404
(Not found. Use POST /mcp)
```

Der Text in Klammern ist unsere eigene 404-Antwort. Die Kette lautet also:
`does not implement OAuth` ist verschwunden → ChatGPT hat
`/.well-known/oauth-authorization-server` **von sich aus** gelesen, ohne dass ein
401 es dorthin geschickt hätte → daraus `registration_endpoint` entnommen →
`POST /oauth/register` versucht → dieser Endpunkt ist Paket 2.

**Damit fällt der Zielkonflikt weg.** Anonymes Lesen und OAuth stehen
nebeneinander auf derselben URL; welcher Weg gilt, entscheidet der Nutzer im
Auswahlfeld seines Clients. Weder eine zweite URL noch ein erzwungener 401 ist
nötig. Pakete 2–5 sind freigegeben.

**Zum Unterschied gegenüber der Referenz**, der beim Testen auffiel: dort wählt
man „keine Authentifizierung" und landet trotzdem in der Anmeldung — weil jener
Server anonymen Zugriff nicht kennt und mit 401 antwortet
(`lib/oauth/routing.ts`). Bei uns heißt „keine Authentifizierung" wirklich
anonym. Das ist dieselbe eine Zeile, die dieses Design von Anfang an umdreht,
und sie kostet nichts: die Discovery funktioniert ohne sie.

## Aufwand

Geschätzt **350–450 Zeilen plus Tests**, deutlich unter den 1.331 der Referenz —
weil SQLite, Refresh-Rotation, Reuse-Erkennung, verschlüsselte Sitzungen und
eine eigene Verwaltungsseite alle entfallen. Vier bis fünf Pakete:

1. Discovery-Dokumente + die Vier-Wege-Entscheidung + 401-Kette
2. `/oauth/register` mit Redirect-Prüfung (der sicherheitskritische Teil)
3. `/oauth/authorize` + Anmeldeseite
4. `/oauth/token`
5. Live-Durchlauf gegen ChatGPT und Claude, Doku

Euer Entscheidungspapier schätzte „6–8 Pakete"; die Referenz und die
stateless-Variante senken das.
