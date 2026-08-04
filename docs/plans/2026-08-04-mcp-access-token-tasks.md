# Tasks: MCP-Zugang per WLO-Konto

Entwurf: [`2026-08-04-mcp-access-token-design.md`](2026-08-04-mcp-access-token-design.md)
**18 Aufgaben in 7 Phasen.** Abhängigkeitsgeordnet. Jede Phase beginnt mit der
Skill-Auffrischung, weil Skills im Sitzungsverlauf aus dem Kontext fallen.

| Phase | Inhalt | Aufgaben | Status |
|---|---|---|---|
| P0 | Messung (Entscheidungspunkt) | 1 | ✅ 2026-08-04 |
| P1 | Krypto-Kern | 4 | ✅ 2026-08-04 |
| P2 | Positivliste | 3 | ✅ 2026-08-04 |
| P3 | Auth-Verdrahtung | 2 | ✅ 2026-08-04 |
| P4 | Seiten (UI) | 3 | ✅ 2026-08-04 |
| P5 | HTTP-Endpunkte | 3 (+Ausliefern) | ✅ 2026-08-04 |
| P6 | Doku & Deployment | 2 (+Start-Verdrahtung) | ✅ 2026-08-04 |
| R  | Review-Runde über P0–P6 | 7 Befunde behoben | ✅ 2026-08-04 |

> **Review-Runde (2026-08-04), 7 Befunde, alle behoben — 1186 → 1193 Tests.**
> Zwei davon waren reproduzierbare Defekte, keine Vermutungen: die serialisierte
> Schreibkette trug **eine** abgelehnte Schreiboperation dauerhaft weiter (jedes
> spätere `add` *und jeder Widerruf* scheiterte bis zum Neustart, ohne es zu
> versuchen), und ein Schreibfehler entkam als Rejection aus `handleAuthEndpoint`
> in einen Zweig ohne Fehlergrenze — der Aufrufer bekam **gar keine Antwort**, 30 s
> lang, direkt nachdem jemand sein Passwort eingegeben hatte.
> Sicherheitsrelevant außerdem: `/auth*` trug `Access-Control-Allow-Origin: *`,
> womit eine fremde Seite die Rateversuche gegen WLO über die Adressen ihrer
> Besucher verteilen und das Ergebnis lesen konnte — beide Begrenzer zählen pro
> Adresse, also war genau die Gegenmaßnahme aus der Bedrohungstabelle umgangen.
> Dazu: Obergrenze pro Konto im Register (vorher unbegrenzt, verlorene Blöcke galten
> ewig), `GET /auth/revoke` liefert die Sperrseite statt 405, Benutzername
> sanitisiert vor dem Log, Ausstellzeitpunkt vom Server statt aus der Browser-Uhr.
> Die Bedrohungstabelle im Design-Dokument hat die zwei fehlenden Zeilen bekommen.

---

## P0 — Messung · Entscheidungspunkt

> **Step 0:** `/better-coding-workflow`

### T1 — Trägt die Sitzungskennung unsere Endpunkte?

Gegen **Staging**, nie Produktion. Anmelden, `JSESSIONID` einsammeln, damit je
einen Aufruf gegen `/iam/v1/people/-home-/-me-`, den ngsearch-Endpunkt und einen
Schreibpfad machen. Notieren: trägt sie, und wie lange gilt sie?

**Ergebnis in den Entwurf** unter „Verified facts" eintragen.

- **Trägt sie** ⇒ `secret` im Block ist die Sitzungskennung. Ein Schlüssel-Leck
  gibt dann Sitzungen statt Passwörter, und WLO kann sie serverseitig beenden.
- **Trägt sie nicht** ⇒ `secret` ist das Passwort. Alles Weitere unverändert.

**Verifikation:** Messwerte im Entwurfsdokument, mit Datum.
**Rollback:** entfällt (nur Lesen).

> ✅ **Ausgeführt 2026-08-04.** Das Cookie trägt unsere Endpunkte — taugt aber
> nicht als Blockinhalt: reines Sitzungs-Cookie ohne `Max-Age`/`Expires`, dessen
> Gültigkeit das Repository bestimmt (Leerlauf, Neustart entwertet alle).
> **Entscheidung: `secret` = Passwort.** Messwerte und ein Nebenbefund, der T14
> betrifft, stehen im Entwurf unter „Verified facts".

---

## P1 — Krypto-Kern

> **Step 0:** `/better-coding-workflow`

Reine Funktionen, kein HTTP, kein Register, kein Dateisystem.

### T2 — Schlüssel laden

`src/auth/access-token.ts` · Test `tests/access-token-keys.test.ts`

`loadAuthKeys({current, previous})` → `AuthKeys | null`. Leitet den öffentlichen
Schlüssel per `crypto.createPublicKey` ab. Ungültiges PEM ⇒ `null` plus Log, nie
Absturz beim Start.

**Test zuerst:** gültiges PEM ⇒ Schlüssel; leer ⇒ `null`; Müll ⇒ `null`;
`previous` optional.

### T3 — Block kodieren (nur Testhilfe + Referenz)

Serverseitiges Gegenstück zur Browser-Verschlüsselung, damit T4 gegen echte
Blöcke prüft statt gegen selbstgebaute. Hybrid: AES-256-GCM + RSA-OAEP-SHA256.

**Test zuerst:** kodieren → dekodieren ergibt dieselbe Nutzlast.

### T4 — Block dekodieren

`decodeAccessToken(raw, keys)` → `AccessPayload | null`.

**Test zuerst, jeder Fall einzeln rot gesehen:** falsches Präfix; kaputtes
base64; falsche Segmentzahl; **verändertes Chiffrat ⇒ GCM-Signatur schlägt fehl
⇒ `null`**; **vertauschte `jti` ⇒ `null`** (das ist die Sperr-Umgehung);
fremder Schlüssel ⇒ `null`; `v` ≠ 2 ⇒ `null`.

### T5 — Zweitschlüssel-Fenster

Dekodieren probiert `current`, dann `previous`.

**Test zuerst:** Block mit altem Schlüssel gilt, solange `previous` gesetzt ist;
ohne `previous` nicht mehr.

> ✅ **P1 ausgeführt 2026-08-04.** `src/auth/access-token.ts` (176 Zeilen),
> `tests/access-token.test.ts` (12 Tests). Rot gesehen, dann grün.
>
> **Ein Test war zunächst wertlos.** Der Splice-Test kombinierte `mine`s IV mit
> `other`s Chiffrat — das scheitert schon an der IV-Paarung, unabhängig vom
> Schlüssel. Eine Mutation (fester AES-Schlüssel statt `randomBytes`) ließ ihn
> grün. Korrigiert: IV **und** Chiffrat werden zusammen verpflanzt; dieselbe
> Mutation färbt ihn jetzt rot. Zweite Mutation (Zweitschlüssel verworfen)
> trifft Test 11. Beide zurückgenommen.

---

## P2 — Positivliste

> **Step 0:** `/better-coding-workflow`

### T6 — Register laden

`src/auth/access-registry.ts` · Test `tests/access-registry.test.ts`

`openRegistry(path)` → `AccessRegistry | null`.

**Test zuerst:** Datei fehlt ⇒ leeres Register (kein Fehler, Erststart);
gültige Datei ⇒ Einträge geladen; **kaputtes JSON ⇒ `null`** (fail-closed);
Verzeichnis statt Datei ⇒ `null`.

### T7 — Eintragen und streichen, atomar

`add` / `remove`, Schreiben über temp + `rename`.

**Test zuerst:** eintragen ⇒ `has` wahr und Datei enthält den Eintrag; streichen
⇒ `has` falsch; zweimal streichen ⇒ zweites Mal `false`; **nach dem Schreiben
existiert keine temp-Datei mehr**; ein Eintrag enthält **niemals** `secret` oder
Passwortfeld (explizite Zusicherung).

### T8 — Register-Disziplin im Quelltext

Ergänzung in `tests/shared-rule-discipline.test.ts`: kein Modul außer
`access-registry.ts` schreibt in den Registerpfad, und kein Registereintrag-Typ
trägt ein Geheimnisfeld.

**Mutation:** ein Testfeld `secret` in den Typ ⇒ Test rot.

> ✅ **P2 ausgeführt 2026-08-04.** `src/auth/access-registry.ts` (129 Zeilen),
> `tests/access-registry.test.ts` (8 Tests), vierter Guard in
> `tests/shared-rule-discipline.test.ts`.
>
> **Eine Zusicherung ist nicht testbar, und das steht jetzt dort.** Die
> Schreib-Serialisierung schützt davor, dass ein Schreiber die temporäre Datei
> eines anderen halbfertig an ihren Platz schiebt. Sie zu entfernen lässt die
> Suite grün — der Nebenläufigkeitstest fixiert das *Ergebnis* (nichts geht
> verloren), nicht den Mechanismus. Die Lücke ist in Modul und Test benannt,
> statt sie mit einem zeitabhängigen und damit flatterhaften Test zu kaschieren.
>
> **Der Guard war zuerst zu grob:** `rename` traf Fließtext über das Umbenennen
> von *Sammlungen* — drei Fehlalarme. Verengt auf „Bezeichner gefolgt von `(`".
> Mutation (Schreibzugriff in `logger.ts`) nennt Datei und Zeile.

---

## P3 — Auth-Verdrahtung

> **Step 0:** `/better-coding-workflow`

### T9 — Bearer-Zweig in `credentialFromHeader`

`src/auth/credential.ts` · Test `tests/auth-bearer-access.test.ts`

Bearer `wlo2.…` ⇒ dekodieren ⇒ `jti` im Register? ⇒ `WloCredential{source:'user'}`.
Bleibt **synchron**. Basic bleibt unverändert.

**Test zuerst:** gültiger Block ⇒ `source:'user'`, `label` = Benutzername;
**gesperrte `jti` ⇒ `null`**; unbekannter Block ⇒ `null`; Bearer ohne
konfigurierten Schlüssel ⇒ `null`; Basic funktioniert unverändert (Regression).

### T10 — Abgelehnter Block landet anonym, nicht beim Dienstkonto

**Test zuerst:** Anfrage mit gesperrtem Bearer ⇒ `isUnusableAuthorization` greift
⇒ anonym, **nie** das Dienstkonto, mit Warn-Log. Das ist die bestehende Regel
aus `http-app.ts`; hier wird sie für den neuen Zweig festgenagelt.

> ✅ **P3 ausgeführt 2026-08-04.** Bearer-Zweig in `credential.ts` (224 Zeilen),
> `tests/auth-bearer-access.test.ts` (8 Tests), ein Test in `http-app.test.ts`.
>
> **Die alte Regel wurde nicht gebrochen, sondern präzisiert.** „Bearer wird
> abgelehnt" war nie Selbstzweck — verboten ist das *Weiterreichen* nach oben,
> weil edu-sharing einen Bearer ignoriert statt ihn abzulehnen. Der neue Zweig
> reicht keinen weiter: er entschlüsselt zu einem **Basic**-Credential, und ein
> Test nagelt genau das fest (`^Basic `). Docstring entsprechend korrigiert.
>
> **Zwei Gegenproben.** Registrierungs-Check umgangen ⇒ 3 Tests rot. Auf
> HTTP-Ebene: dieselbe ID *gelistet* ⇒ `anonymous` schlägt zu `user` um — ohne
> das wäre die Zusicherung leer gewesen, weil `anonymous` auch aus ganz anderen
> Gründen hätte herauskommen können.

---

## P4 — Seiten

> **Step 0:** `/better-coding-workflow` **und** `/better-coding-frontend`

### T11 — Ausgabeseite `public/auth.html`

„Hol dir deinen MCP-Zugang mit deinem WLO-Konto." Formular
(Benutzername/Passwort, `autocomplete`), WebCrypto verschlüsselt **im Browser**,
POST an `/auth/issue`, Anzeige des Blocks mit Kopierknopf und der Anleitung, wo
er einzutragen ist.

Selbsttragend: keine externen Assets, keine Schriften von fremden Servern.
Zustände: Ruhe, Sendet, Fehler (falsche Zugangsdaten), Erfolg.

### T12 — Sperrseite `public/auth-revoke.html`

Block einfügen, sperren, Bestätigung. Hinweistext: bei verlorenem Block hilft der
WLO-Passwortwechsel, er entwertet alle Blöcke.

### T13 — a11y- und Datenschutzprüfung beider Seiten

Tastaturbedienung vollständig, sichtbarer Fokus, `<label>`-Bindung, Kontrast AA,
320 px und 200 % Zoom, keine Fremdanfragen (im Netzwerk-Panel belegt), kein
Passwort in URL, Speicher oder Log.

> ✅ **P4 ausgeführt 2026-08-04.** `public/access-block.js` (+ `.d.ts`),
> `auth.css`, `auth.html`/`auth.js`, `auth-revoke.html`/`auth-revoke.js`,
> `tests/access-block-browser.test.ts` (5 Tests).
>
> **Browser und Server sind gegeneinander getestet.** Der Test importiert die
> Datei, die die Seite lädt, und übergibt ihre Ausgabe dem echten Server-Decoder
> — möglich, weil `crypto.subtle` in Node 20 global ist. Vorher gemessen:
> WebCrypto hängt den GCM-Tag an, genau wie der Server ihn abspaltet.
>
> **Zwei Funde aus der eigenen Prüfung.** (1) `--border` aus dem Launcher
> erreicht gegen Weiß nur **1,75:1** — verwendet an *Eingabefeldern*, also
> genau der Fall von WCAG 1.4.11 (3:1). Neues Token `--border-control` (3,30:1
> hell / 4,05:1 dunkel) für alles Bedienbare; `--border` bleibt für Dekoratives.
> **Der Launcher trägt den Fehler weiterhin** — eigener Befund, nicht Teil
> dieses Pakets. (2) Ich hatte `style=`-Attribute benutzt; die geplante strenge
> CSP ohne `unsafe-inline` hätte sie verworfen und das Layout still verschoben.
> Entfernt, Abstände in `auth.css`.
>
> **Belegt:** keine Fremdressourcen (kein `https://`, kein `@import`, kein
> `url()`), kein `localStorage`/`sessionStorage`/Cookie, kein Passwort in der
> URL. Accessibility-Baum geprüft: Landmarks, ein `h1`, gebundene Labels,
> `role="status"`. Kontrast für **17** Token-Paare in beiden Themes gerechnet.
>
> **Noch nicht geprüft** (braucht die Endpunkte aus P5): der Ablauf im Browser
> end-to-end, Tastaturdurchlauf am laufenden Server, 200 % Zoom im Rendering.

---

## P5 — HTTP-Endpunkte

> **Step 0:** `/better-coding-workflow`

### T14 — `POST /auth/issue`

`src/rest/auth-pages.ts` · Test `tests/auth-endpoints.test.ts`

Chiffretext entgegennehmen, dekodieren, `checkIdentity()` unter diesem Konto,
bei Erfolg eintragen.

**Test zuerst:** gültige Zugangsdaten ⇒ 200 und Eintrag im Register;
**abgelehnte Zugangsdaten ⇒ 400, kein Eintrag**; undekodierbarer Block ⇒ 400;
Schlüssel nicht konfiguriert ⇒ 404; **die Antwort enthält nie das Passwort**.

### T15 — `POST /auth/revoke`

**Test zuerst:** gültiger Block ⇒ 200 und `has` danach falsch; unbekannte `jti`
⇒ 200 mit `revoked: false` (kein Orakel darüber, welche IDs existieren);
undekodierbarer Block ⇒ 400.

### T16 — Ratenbegrenzung auf `/auth/issue`

`/auth/issue` prüft Zugangsdaten und ist damit ein Brute-Force-Ziel. Es greifen
`apiRateLimiter` **und** `authAbuseLimiter` (verschiedene Logins pro Adresse).

**Test zuerst:** über dem Limit ⇒ 429; verschiedene Logins von einer Adresse ⇒
429 nach dem Schwellwert.

> ✅ **P5 ausgeführt 2026-08-04.** `src/rest/auth-pages.ts` (160 Zeilen),
> `tests/auth-endpoints.test.ts` (15), `tests/auth-pages-static.test.ts` (5),
> ein Test in `http-app.test.ts`. Static-Routen und Einhängung in `http-app.ts`.
>
> **Umfang:** das Ausliefern der Seiten stand nicht in T14–T16, ist aber die
> Verdrahtung, ohne die P4 wirkungslos bleibt. Als Teil des Pakets ausgewiesen.
>
> **Der P0-Nebenbefund ist jetzt Code und Test.** `/auth/issue` prüft die
> gemeldete `authority`, nicht `res.ok`. Mutation („Endpunkt hat geantwortet"
> statt „ist angemeldet") färbt genau den Test rot, der `esguest` einspeist.
> Ohne das würden wir Zugangsblöcke für Logins ausstellen, die nicht
> funktionieren.
>
> **Eine Annahme, die kein Unit-Test geprüft hätte.** Im Betrieb läuft der
> Handler in `runAnonymous`; die Ausstellung muss darin einen *eigenen*
> Credential-Scope öffnen. Trüge die Verschachtelung nicht, schlüge jede
> Ausstellung mit „Zugangsdaten nicht akzeptiert" fehl — und kein Unit-Test
> würde es zeigen, weil keiner den anonymen Scope betritt. Eigener Test in
> `http-app.test.ts`.
>
> **CSP der Seiten ist strenger als die des Launchers:** kein `unsafe-inline`
> für Skript und Stil, `form-action 'none'`. Ein Test prüft die Policy, ein
> zweiter, dass die Auszeichnung sie einhält — sonst wäre sie eine Zusicherung
> über Markup, das ihr widerspricht.

---

## P6 — Doku & Deployment

> **Step 0:** `/better-coding-workflow`

### T17 — Deployment

`docker-compose.yml`: benanntes Volume auf `/data`, `read_only: true` **bleibt**;
`WLO_AUTH_PRIVATE_KEY`, `WLO_AUTH_PRIVATE_KEY_PREVIOUS`, `WLO_AUTH_REGISTRY_PATH`
durchreichen. `.env.example` mit Begründung je Variable, inklusive Anleitung zum
Schlüssel-Erzeugen und -Wechseln.

**Verifikation:** `tests/deploy-env-passthrough.test.ts` bleibt grün — es
erzwingt, dass jede dokumentierte Variable den Container erreicht.

### T18 — Dokumentation

README ×2 (Variablentabelle + Abschnitt „MCP-Zugang holen"), `docs/DEPLOYMENT.md`
(§3-Tabelle, Volume, Sicherung, fail-closed-Verhalten), `docs/TOOLS.md`
(Anmeldeabschnitt ersetzt die `printf`-Anleitung), `docs/PRIVACY.md`
(**das Register führt Benutzernamen** — neu, der Server speicherte bisher
nichts), `CHANGELOG.md`.

> ✅ **P6 ausgeführt 2026-08-04.**
>
> **Eine Lücke, die der Plan nicht hatte:** `setAccessSupport` wurde produktiv
> nirgends aufgerufen — die ganze Funktion wäre tot gewesen. `http.ts` schaltet
> sie jetzt **vor** `listen` ein (nicht wie die Credential-Prüfung
> fire-and-forget), sonst sähe eine früh eintreffende Anfrage sie als „aus".
> Die Entscheidung liegt in `src/auth/access-setup.ts`, weil `http.ts` beim
> Import zu lauschen beginnt und nicht importierbar ist — dieselbe Falle, durch
> die dort einmal fünf rohe `parseInt` überlebt haben. 5 Tests.
>
> **Rot-Grün am Deployment-Guard:** die drei Variablen erst in `.env.example`
> → `deploy-env-passthrough` rot → Compose ergänzt → grün. Genau der Fehler,
> gegen den dieser Guard geschrieben wurde.
>
> **`PRIVACY.md` behauptete an zwei Stellen, der Server speichere nichts.** Mit
> der Positivliste ist das falsch. Korrigiert: eigene Tabellenzeile, und die
> Betroffenenrechte nennen jetzt den Selbstbedienungs-Weg (Block auf
> `/auth-revoke.html` einfügen; ohne Block hilft der Passwortwechsel).
>
> **`docs/TOOLS.md`** führt nicht mehr mit `printf … | base64`. Der Zugangsblock
> steht voran; Basic bleibt als Fallback, jetzt mit der Warnung vor der
> Shell-History.
>
> **Verifikation:** typecheck sauber · build sauber (4 Widgets) · `npm test`
> **1186 grün** · `npm audit --omit=dev` 0 · `docker compose config` gültig.

---

## Abnahmekriterien

| # | Kriterium | Nachweis |
|---|---|---|
| 1 | Anonymes Lesen unverändert | Bestehende Suite grün, insbesondere `auth-public-surface.test.ts` |
| 2 | Dienstkonto unverändert | Bestehende Dienstkonto-Tests grün |
| 3 | Basic funktioniert weiter | Regressionstest in T9 |
| 4 | Gesperrter Block wirkt nicht mehr | T9 + T15 |
| 5 | Vertauschte `jti` umgeht die Sperre nicht | T4 |
| 6 | Kein Credential auf Platte | T7 + T8 |
| 7 | Register verloren ⇒ nichts gilt | T6 |
| 8 | Kein Klartext-Passwort auf der Leitung | T11 (Netzwerk-Panel) + T14 |
| 9 | Keine neue Laufzeit-Abhängigkeit | `package.json` unverändert bei `dependencies` |
| 10 | Kein Modul über ~300 Zeilen | `wc -l` der neuen Dateien |

**Regressionsprüfung vor jeder Freigabe:** `npm test` (aktuell 1125 grün),
`npm run typecheck`, `npm run build`, `npm audit --omit=dev`.
