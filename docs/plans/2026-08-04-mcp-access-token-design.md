# Design: MCP-Zugang per WLO-Konto (verschlüsselter Zugangsblock)

**Status:** Entwurf, wartet auf Freigabe · **Datum:** 2026-08-04

## Goal

Eine Nutzerin holt sich auf einer Seite des MCP-Servers mit ihrem WLO-Konto
einen **verschlüsselten Zugangsblock**, trägt ihn einmal in ihr KI-Programm ein
und kann ihn auf derselben Seite jederzeit wieder sperren — ohne dass ihr
WLO-Passwort jemals im Klartext den Server erreicht oder beim KI-Anbieter
lesbar liegt.

## Context

Heute lautet die Anleitung `printf 'nutzername:passwort' | base64`. Das schreibt
das Klartext-Passwort in die Shell-History und legt es dauerhaft und lesbar beim
KI-Anbieter ab. Der Header ist keine Verschleierung: base64 ist umkehrbar, der
Wert ist das Passwort und funktioniert gegen **ganz WLO**, nicht nur gegen uns.

Gemessen (P0, 2026-07-30, Staging + Produktion): edu-sharing bietet keine
OIDC-Discovery, keine Dynamic Client Registration und deklariert nur `basicAuth`
und `cookieAuth`. **Es gibt kein edu-sharing-Token, das wir weiterreichen
könnten** — jede Token-Lösung transportiert die Zugangsdaten selbst.

## Scope

**In scope**
- Ausgabeseite `GET /auth` — Browser-seitige Verschlüsselung, kein Klartext auf der Leitung
- Sperrseite `GET /auth/revoke`
- Endpunkte `POST /auth/issue` und `POST /auth/revoke`
- Positivliste ausgestellter Zugangs-IDs (Datei, eigenes Volume)
- Bearer-Zweig in `credentialFromHeader`
- Schlüsselwechsel-Fenster (zwei akzeptierte Schlüssel)
- Doku (README ×2, DEPLOYMENT, TOOLS, `.env.example`, `docker-compose.yml`, PRIVACY)

**Out of scope**
- OAuth / OIDC in jeder Form (gemessen unmöglich, siehe Context)
- **Zeitlicher Ablauf.** Widerruf ersetzt ihn (Nutzerentscheidung 2026-08-04).
  `iat` wird gespeichert, aber nicht erzwungen — der Haken für später bleibt.
- Admin-Oberfläche für die Betreiberin (die Datei ist editierbar)
- Rechte-Einschränkung pro Werkzeug (der Block trägt die vollen Kontorechte)
- Änderungen an anonymem Lesen und Dienstkonto — beide bleiben **unberührt**

## Approach

Drei Wege wurden erwogen:

| | Wie | Warum nicht / warum |
|---|---|---|
| **A — Server verschlüsselt** | Formular sendet Klartext, Server verschlüsselt | Klartext-Passwort auf der Leitung, durch Caddy, in jedem Zwischenlog. Verworfen. |
| **B — Tresor** | Zufalls-Token, Server speichert Zugangsdaten | Ein Einbruch liefert **alle** Zugangsdaten rückwirkend auf einmal. Verworfen. |
| **C — Browser verschlüsselt (gewählt)** | Browser chiffriert mit unserem öffentlichen Schlüssel, Server entschlüsselt pro Anfrage | Chiffretext auf der Leitung; der Server speichert nie ein Credential; ein Einbruch liefert den Schlüssel, aber die Blöcke liegen verteilt bei den Anbietern. |

**Ehrlich zu C:** Weil die Zugangs-ID auf die Positivliste muss, gibt es ein
POST — also ein Formular. Der Gewinn gegenüber A ist nicht „kein Formular",
sondern: über die Leitung geht Chiffretext, und der Block beim KI-Anbieter ist
für ihn unlesbar und nur gegen **unseren** Server verwendbar.

**Vertrauensanker:** Browser-Krypto ist nur so gut wie das ausgelieferte
JavaScript. Wer die Seite manipuliert, greift vor der Verschlüsselung ab. TLS,
strikte CSP und keine externen Assets mindern das; beseitigen können sie es
nicht. Das gilt für A genauso.

## Global constraints (aus CLAUDE.md)

TypeScript ESM/NodeNext, `.js`-Importendungen, Node ≥ 20, **keine neue
Laufzeit-Abhängigkeit** (Krypto = `node:crypto`, Browser = WebCrypto),
env-basierte Konfiguration, Tests über `node:test` + tsx mit `tests/fetchMock.ts`,
deutsche Nutzertexte / englischer Code und englische Doku, keine Commits durch
den Agenten.

## Architecture

### Token-Format

```
wlo2.<b64u(wrappedKey)>.<b64u(iv)>.<b64u(ciphertext||tag)>
```

**Hybrid, nicht reines RSA.** RSA-2048-OAEP-SHA256 fasst nur 190 Byte Klartext;
ein langes Passwort plus Zugangs-ID kann darüber liegen — ein Fehler, der nur
manche Nutzerinnen träfe und erst live auffiele. Der Browser erzeugt daher einen
AES-256-GCM-Schlüssel, verschlüsselt damit die Nutzlast und verpackt **nur den
AES-Schlüssel** per RSA-OAEP.

Die GCM-Signatur deckt die **gesamte** Nutzlast ab, also auch die Zugangs-ID.
Ohne diese Authentisierung könnte ein Angreifer die ID austauschen und damit den
Widerruf umgehen.

Nutzlast (JSON): `{ v: 2, jti, u, secret, iat }` — `secret` ist das Passwort
oder (nach P0) die Sitzungskennung.

### Schlüsselmaterial

- `WLO_AUTH_PRIVATE_KEY` — PKCS#8-PEM aus der Umgebung. Nicht gesetzt ⇒ die
  gesamte Funktion ist aus: Seiten antworten 404, Bearer wird abgelehnt. Dasselbe
  Muster wie `WLO_SKILLS_COLLECTION_ID`, das sein Werkzeug gatet.
- Der öffentliche Schlüssel wird beim Start daraus **abgeleitet**
  (`crypto.createPublicKey`) — keine zweite Variable, die auseinanderdriften kann.
- `WLO_AUTH_PRIVATE_KEY_PREVIOUS` — optional. Entschlüsseln probiert erst den
  aktuellen, dann den vorherigen; **ausgestellt wird immer mit dem aktuellen**.
  Das Überlappungsfenster existiert damit, bevor es gebraucht wird.

### Positivliste

Datei unter `WLO_AUTH_REGISTRY_PATH` (Vorgabe `/data/access-registry.json`), im
Container ein eigenes beschreibbares Volume — **`read_only: true` bleibt für den
Rest des Dateisystems**.

- Einträge: `{ jti, label, iat }`. **Nie ein Credential.**
- Beim Start in eine `Map` geladen; pro Anfrage nur ein Nachschlagen im Speicher.
- Geschrieben nur beim Ausstellen und Sperren, atomar (temp + `rename`).
- **Datei fehlt** ⇒ leeres Register, normaler Erststart.
- **Datei vorhanden, aber unlesbar/kaputt** ⇒ Funktion aus, lautes Log. Niemals
  „im Zweifel alles akzeptieren".
- Volume verloren ⇒ **fail-closed**: nichts gilt mehr, alle holen neu.

### Dateien

| Datei | Verantwortung |
|---|---|
| `src/auth/access-token.ts` (neu) | Kodieren/Dekodieren des Blocks, Schlüssel laden. Reine Funktionen, kein HTTP, kein Register. |
| `src/auth/access-registry.ts` (neu) | Positivliste: laden, prüfen, eintragen, streichen, atomar schreiben. |
| `src/auth/credential.ts` | Bearer-Zweig in `credentialFromHeader` |
| `src/rest/auth-pages.ts` (neu) | HTTP-Adapter für `/auth`, `/auth/issue`, `/auth/revoke` |
| `public/auth.html`, `public/auth-revoke.html` (neu) | Die zwei Seiten inkl. WebCrypto |
| `src/http-app.ts` | Einhängen der Route, Ratenbegrenzung |

**Richtung:** `auth/access-token.ts` und `auth/access-registry.ts` sind
Blattmodule ohne Import aus `rest/` oder `tools/` — dieselbe Regel, die
`tests/shared-rule-discipline.test.ts` erzwingt. Kein Modul überschreitet ~300
Zeilen.

### Datenfluss

**Ausstellen**
```
Browser: Formular → WebCrypto verschlüsselt → POST /auth/issue { token }
Server:  entschlüsseln → WloCredential → checkIdentity() unter diesem Konto
         → nicht angemeldet? 400 mit deutscher Meldung (Tippfehler fällt HIER auf)
         → angemeldet: jti + label eintragen → 200
Browser: zeigt den Block mit Kopierknopf
```

**Nutzen**
```
Authorization: Bearer wlo2.… → credentialFromHeader → entschlüsseln
  → jti im Register? nein ⇒ unbrauchbar ⇒ anonym (bestehender Pfad, mit Warnung)
  → ja ⇒ WloCredential{source:'user'} ⇒ Kurationswerkzeuge werden registriert
```

**Sperren**
```
POST /auth/revoke { token } → entschlüsseln → jti → streichen → 200
```

Verliert die Nutzerin den Block, bleibt der WLO-Passwortwechsel: er entwertet
**jeden** Block, der dieses Passwort enthält.

### Schnittstellen

```ts
// access-token.ts
export interface AccessPayload { v: 2; jti: string; u: string; secret: string; iat: number }
export function decodeAccessToken(raw: string, keys: DecryptKeys): AccessPayload | null;
export function loadAuthKeys(env: { current?: string; previous?: string }): AuthKeys | null;

// access-registry.ts
export interface RegistryEntry { jti: string; label: string; iat: number }
export interface AccessRegistry {
  has(jti: string): boolean;
  add(e: RegistryEntry): Promise<void>;
  remove(jti: string): Promise<boolean>;
}
export function openRegistry(path: string): Promise<AccessRegistry | null>; // null = fail-closed
```

`credentialFromHeader` bleibt **synchron** — Entschlüsseln ist synchron, das
Register liegt im Speicher. Keine Signaturänderung, keine Anpassung der Aufrufer.

## Non-functional

**Sicherheit**

| Bedrohung | Gegenmaßnahme |
|---|---|
| Klartext-Passwort auf der Leitung | Browser verschlüsselt; der Server sieht nur Chiffretext bis zur Entschlüsselung im Speicher |
| Manipulierte Seite greift ab | TLS, strikte CSP, keine externen Assets. **Restrisiko, dokumentiert.** |
| Vertauschte Zugangs-ID umgeht Sperre | GCM authentisiert die gesamte Nutzlast |
| Erraten von WLO-Logins über `/auth/issue` | Der Endpunkt prüft Zugangsdaten ⇒ Brute-Force-Ziel. `apiRateLimiter` **und** `authAbuseLimiter` |
| Erraten **über fremde Besucher** (Review 2026-08-04) | Beide Begrenzer zählen pro Client-Adresse — ein `Access-Control-Allow-Origin: *` verteilt die Versuche also auf beliebig viele Adressen und macht die Antwort lesbar. `/auth*` bekommt deshalb **keinen** CORS-Header; die eigenen Seiten sind gleichherkünftig und brauchen keinen |
| Register wächst unbegrenzt (Review 2026-08-04) | Nichts entfernt je einen Eintrag außer dem Widerruf, und der verlangt den Block. Obergrenze **pro Konto** (`MAX_BLOCKS_PER_LABEL`), älteste zuerst — nie global, sonst verdrängt ein Konto die anderen |
| Register verloren | fail-closed |
| Schlüssel-Leck | Betrifft nur Blöcke, die der Angreifer anderswo erbeutet; wer den Server hat, liest ohnehin alles Durchlaufende mit. Wechselverfahren liegt bereit. |
| Credential auf Platte | Findet nicht statt — das Register hält nur IDs |

**Privatsphäre:** Das Register führt Benutzernamen. Das ist neu (der Server
speicherte bisher nichts) und gehört in `docs/PRIVACY.md`.

**Bedienbarkeit / a11y:** Seiten deutsch mit englischer Hinweiszeile, semantisches
HTML, `<label>`-gebundene Felder, `autocomplete` für Passwortmanager, sichtbarer
Fokus, WCAG-AA-Kontrast, Kopierknopf auch ohne JS markierbar.
`/better-coding-frontend` begleitet die Seiten-Pakete.

**Observability:** Ausstellen, Sperren und abgelehnte Blöcke werden geloggt —
Benutzername ja, Block und Passwort **nie**.

## Risks

- **P0 misslingt** (Sitzungskennung trägt unsere Endpunkte nicht) ⇒ das Passwort
  wandert in den Block, wie heute. Kein Blocker, nur ein schlechteres Leck-Profil.
- **Ein KI-Programm erlaubt keinen freien Header** ⇒ diese Nutzerin bleibt bei
  Modus 1 oder 2. Unverändert zur heutigen Lage.
- **Volume falsch eingehängt** ⇒ fail-closed statt stiller Fehlfunktion; der
  Start-Log benennt es.

## Verified facts (P0/T1 ausgeführt 2026-08-04, Staging)

Gemessen gegen `repository.staging.openeduhub.net`, nur lesend.

- [x] **Ein Basic-Login stellt eine `JSESSIONID` aus**, und diese **trägt unsere
      Endpunkte**: nur mit dem Cookie, ohne Basic-Header, meldet
      `/iam/v1/people/-home-/-me-` die echte Kennung (`WLO-Upload`); ngsearch
      antwortet 200. Kontrolllauf ohne jede Anmeldung: `esguest`. Der
      Unterscheider ist damit die `authority`, nicht der Statuscode.
- [x] **Das Cookie ist dennoch als Blockinhalt ungeeignet.** Der `Set-Cookie`
      trägt **weder `Max-Age` noch `Expires`** — ein reines Sitzungs-Cookie.
      Lebensdauer und Gültigkeit liegen beim Repository: Leerlauf-Zeitüberschreitung,
      und ein Neustart der Gegenstelle entwertet **alle** Sitzungen auf einmal.
      Ein bis zum Widerruf gültiger Block kann darauf nicht aufbauen.
- [x] **Neben `JSESSIONID` wird ein `INGRESSCOOKIE` gesetzt** (Lastverteiler-
      Bindung). Die Probe kam ohne es durch; bei mehreren Replikaten wäre das
      nicht verlässlich.

**Entscheidung:** `secret` im Block ist **das Passwort**, nicht die
Sitzungskennung — der Fallback-Zweig aus T1. Die Nutzlast bleibt unverändert.

> **Nebenbefund aus derselben Probe, wichtig für die Seiten:** Ein anonymer
> Aufruf von `/node/v1/nodes/-home-/-userhome-/children` antwortet **200**, nicht
> 401. „Endpunkt antwortet" ist an dieser API also kein Anmeldebeweis — nur die
> gemeldete `authority` ist einer. Der erste Anlauf der Probe hat genau daran
> ein falsches Ergebnis fast bestätigt. `POST /auth/issue` (T14) muss deshalb
> `checkIdentity()` auf `authenticated` prüfen und darf sich nie auf `res.ok`
> verlassen.

## Open questions

Keine. Widerruf statt Ablauf, „erst messen" und der Blockinhalt sind
entschieden (2026-08-04).
