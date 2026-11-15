# Anmeldung am WLO-MCP-Server — Entscheidungsgrundlage

**Stand:** 2026-08-04 · **Zweck:** Teamdiskussion · **Status:** offen

Der Server ist fertig und läuft. Offen ist **eine** Frage: wie sich Menschen mit
ihrem eigenen WLO-Konto anmelden. Alles andere in diesem Dokument ist Kontext,
damit die Frage entscheidbar wird.

---

## 1. Was gefordert ist

Drei Nutzungsarten, die **gleichzeitig** funktionieren müssen.

### Anonym — nur lesen, nur die URL

Wer nichts konfiguriert, bekommt öffentliche Inhalte. Die MCP-URL genügt.
**Das ist der Standard und die wichtigste Eigenschaft des Servers** — jede
Lösung für die dritte Nutzungsart muss das unangetastet lassen.

### Festes Konto aus der Umgebung — für eigene Anwendungen

Ein eigener Chatbot bekommt eine Identität über Umgebungsvariablen. Eine
Identität für alle seine Nutzer, kein Login-Vorgang, kein Header.

### Eigenes WLO-Konto — für Kuratierung

Wer Inhalte ändern will, muss als er selbst handeln: in der Versionshistorie
soll die Person stehen, nicht ein Sammelkonto. **Hier liegt die Entscheidung.**

---

## 2. Ist-Stand

Der Server löst die Identität **pro Anfrage** entlang einer Kette auf. Die erste
Sprosse, die greift, gewinnt.

| Sprosse | Woher | Wirkung |
|---|---|---|
| 1. Persönlich | `Authorization: Basic …` vom KI-Programm | Rechte genau dieser Person |
| 2. Dienstkonto | `WLO_SERVICE_USER` / `WLO_SERVICE_PASSWORD` | Dieselben Rechte für **alle** |
| 3. Anonym | nichts konfiguriert | Nur öffentliche Inhalte |

Alle drei sind implementiert und getestet. Nutzungsart 1 und 2 sind damit
**erledigt** — nur Nutzungsart 3 steht zur Debatte.

**Dienstkonto, zwei Feinheiten:** Es gilt nur für den MCP-Endpunkt, nicht für
die öffentliche REST-Schnittstelle und den Launcher — die sind ohne Anmeldung
aus dem Internet erreichbar und dürfen keine erhöhten Rechte erben. Und
Schreiben ist im Dienstkonto-Modus **standardmäßig aus**, weil eine Änderung
unter einem Sammelkonto niemandem zuzuordnen ist — in der Versionshistorie steht
dann nur der Kontoname. Es ist aber ein reiner Schalter: `WLO_ALLOW_SERVICE_WRITES=1`
schaltet alle 13 Kurationswerkzeuge frei; zum **Anlegen** neuer Datensätze kommt
`WLO_INBOX_ID` (nodeId des Posteingangs) dazu, für das Ändern bestehender nicht.

### So meldet man sich heute persönlich an

Aus der Anleitung, wörtlich:

```bash
printf 'nutzername:passwort' | base64
```

Das Ergebnis kommt als `Basic <blob>` in das Header-Feld der
Connector-Einstellungen des KI-Programms.

---

## 3. Was für die Sicherheit getan wurde

Alles Folgende ist implementiert und durch Tests festgehalten.

**Das Sprachmodell sieht die Zugangsdaten nie.** Sie laufen als HTTP-Header am
Modell vorbei — nie Werkzeug-Eingabe, nie Werkzeug-Ausgabe.

**Nichts wird gespeichert.** Die Identität lebt in einem Bereich, der an genau
eine Anfrage gebunden ist. Ein Server bedient alle; eine Identität in einer
Modulvariablen würde bei zwei gleichzeitigen Nutzerinnen deren Rechte
vertauschen.

**Nichts wird protokolliert.** Geloggt wird der Benutzername, nie der Header.

**Die Zugangsdaten gehen nur ans Repository.** Wikipedia und der
Textextraktionsdienst laufen durch dieselbe Fetch-Funktion — ohne diese Grenze
bekämen Dritte das Passwort. Geprüft wird Präfix *und* Grenze, damit eine
ähnlich aussehende Domain nicht passt.

**Öffentliche Flächen sind zwangsweise anonym.** Der gesamte HTTP-Handler läuft
anonym; nur der MCP-Zweig hebt die Rechte an. Anders herum — erhöht als
Standard, Ausstieg pro Fläche — hatte die erste Fassung genau einen Fehler zu
viel, und die öffentliche REST-Schnittstelle erbte das Dienstkonto.

**Ein unbrauchbarer Header leiht sich nichts.** Wer sich anmelden wollte und
scheiterte, wird anonym bedient — nicht stillschweigend mit dem Sammelkonto
ausgestattet.

**Schutz gegen Missbrauch als Rate-Relay.** Weil wir fremde Logins weiterreichen,
könnte man über uns WLO-Passwörter durchprobieren. Begrenzt wird die Zahl
**verschiedener** Logins pro Adresse — nicht die Anfragerate, denn ein echter
Nutzer schickt seinen einen Header bei jedem Aufruf. Gespeichert werden nur
gekürzte Hashwerte, keine Klartext-Header.

**Falsche Zugangsdaten sind sichtbar.** Der Server prüft seine Identität beim
Start und meldet im Log, wenn sie abgelehnt wird. Ohne diese Prüfung sähe eine
Fehlkonfiguration aus wie „es gibt eben nichts zu finden".

**Nur Basic wird akzeptiert.** edu-sharing *ignoriert* einen Bearer-Header, statt
ihn abzulehnen — weitergereicht ergäbe er einen Aufruf, der angemeldet
*aussieht* und keiner ist.

**Schreibwerkzeuge existieren nicht ohne Schreibidentität.** Sie werden gar nicht
erst registriert, statt zur Laufzeit abzulehnen.

**Reverse Proxy:** Caddy schwärzt `Authorization` in Zugriffsprotokollen
standardmäßig. → siehe offene Punkte.

---

## 4. Was gemessen wurde (und die Optionen begrenzt)

Probe gegen Staging **und** Produktion, 2026-07-30/31:

- **Keine OIDC-Discovery.** Alle drei `.well-known`-Endpunkte antworten 404.
- **Keine Dynamic Client Registration** — ein KI-Host kann sich OAuth gegen WLO
  nicht selbst einrichten.
- **Die edu-sharing-API deklariert genau zwei Verfahren:** Basic und das
  Session-Cookie. **Kein Bearer.**
- **`/oauth2/token` existiert**, ist aber edu-sharings eigene App-Registrierung
  und bräuchte einen von den WLO-Betreibern registrierten Client — und selbst
  dann nähme die REST-API das Token nicht an.

**Folge:** Es gibt kein edu-sharing-Token, das wir ausstellen oder
weiterreichen könnten. Jede „Token"-Lösung transportiert in Wahrheit die
Basic-Zugangsdaten.

---

## 5. Die Optionen für eigene WLO-Logins

### Option 0 — Ist-Stand behalten

Base64 im Terminal, Ergebnis ins Header-Feld.

| | |
|---|---|
| ✅ | Fertig, geprüft, kein neuer Code |
| ✅ | Kein Hauptschlüssel, kein Formular, kein Bestand bei uns |
| ✅ | Läuft nie ab — gut für unbeaufsichtigte Prozesse |
| ❌ | **Passwort landet in der Shell-History** (unverschlüsselt, unbefristet) |
| ❌ | Passwort liegt dauerhaft beim KI-Anbieter |
| ❌ | Terminal-Schritt — für Redakteurinnen praktisch nicht gangbar |
| ❌ | Leck ist zeitlich unbegrenzt; Widerruf nur per Passwortwechsel |

### Option 0+ — Ist-Stand plus Helfer-Seite

Eine statische Seite rechnet Base64 **im Browser**. Kein Senden, kein Server,
kein Geheimnis. Der Launcher-Mechanismus dafür existiert bereits.

| | |
|---|---|
| ✅ | Streicht Terminal **und** Shell-History |
| ✅ | Ändert Architektur und Bedrohungsmodell **nicht** |
| ✅ | Sehr kleiner Aufwand (~1 Paket) |
| ❌ | Passwort liegt weiterhin beim KI-Anbieter |
| ❌ | Header-Feld muss das KI-Programm anbieten |

### Option B — Anmeldeseite stellt einen Umschlag aus

Login-Seite bei uns, Zugangsdaten werden sofort geprüft und in einen
verschlüsselten, befristeten Umschlag verpackt. Nutzerin kopiert ihn **einmal**
ins Header-Feld — nicht in den Chat.

| | |
|---|---|
| ✅ | Passwort erreicht den KI-Anbieter nicht |
| ✅ | Kein Terminal, keine Shell-History |
| ✅ | Leck ist zeitlich gedeckelt |
| ✅ | Tippfehler fallen auf der Seite auf, nicht Tage später |
| ❌ | **Neuer Hauptschlüssel.** Wer ihn erbeutet, entschlüsselt *jeden* Umschlag zu einem lebenden Passwort |
| ❌ | **Wir hosten ein Passwortformular** — neues Angriffsziel und ein Phishing-Muster |
| ❌ | Der Umschlag *ist* ein verkleidetes Passwort, kein echtes Token |
| ❌ | Erneuerung nach Ablauf; einzeln widerrufbar nur mit zusätzlichem Zustand |
| ❌ | Mehr Code im sicherheitskritischen Pfad (~2–3 Pakete) |

### Option A — echtes OAuth, wir werden Autorisierungsserver

Nutzer trägt nur die URL ein, der Host öffnet den Browser, alles Weitere
automatisch.

| | |
|---|---|
| ✅ | Mit Abstand die beste Bedienung — nichts zu kopieren, automatische Erneuerung |
| ✅ | Passwort erreicht den KI-Anbieter nicht |
| ❌ | **Gefährdet das anonyme Lesen:** Hosts starten ihre OAuth-Oberfläche beim Verbinden, nicht auf Wunsch |
| ❌ | Der sicherheitskritischste Code im Projekt — ein Fehler in der Redirect-Prüfung ist eine Kontoübernahme |
| ❌ | Braucht trotzdem Basic dahinter (siehe §4) — also auch hier ein Hauptschlüssel |
| ❌ | ~6–8 Pakete, plus vorgelagerte Messung |

### Option A+ — WLO schaltet OIDC frei

Wenn die WLO-Betreiber einen OAuth-Client registrieren oder OIDC freischalten,
werden wir vom Autorisierungsserver zum bloßen Ressourcenserver.

| | |
|---|---|
| ✅ | Löst das Problem an der Wurzel — kein Hauptschlüssel, kein Formular bei uns |
| ✅ | Beste Bedienung **und** beste Sicherheit |
| ❌ | **Nicht von uns entscheidbar** — hängt an den WLO-Betreibern |

---

## 6. Der eigentliche Kompromiss

Options 0 und B tauschen nicht schlecht gegen gut, sondern **verteiltes gegen
konzentriertes Risiko**:

- **Option 0:** N Passwörter beim KI-Anbieter, N Shell-Historien, unbefristet.
- **Option B:** *ein* Hauptschlüssel auf unserem Server, Umschläge laufen ab.

Welche Seite gewinnt, hängt an einer Zahl — **wie viele Personen sich mit
eigenem Konto anmelden**:

- **Kleiner Kreis:** Option 0(+) gewinnt. Ein Hauptschlüssel und ein
  Passwortformular für fünf Leute sind mehr Angriffsfläche, nicht weniger.
- **Breite Öffnung an Redakteurinnen:** Kehrt sich um. Der Terminal-Schritt ist
  für die Zielgruppe unbrauchbar, und die Zahl der Passwörter beim Anbieter
  wächst linear, während ein Hauptschlüssel eine gut gehütete Sache bleibt.

---

## 7. Offene Punkte

| # | Punkt | Wer klärt |
|---|---|---|
| 1 | **Shell-History:** Unsere eigene Anleitung weist an, das Passwort durch die Shell zu schicken. Konkreteste Schwachstelle im Ist-Stand. | Team (Option 0+) |
| 2 | **Caddy:** Standardmäßig geschwärzt — aber `log_credentials` im Caddyfile des vServers ist ungeprüft. | Betrieb |
| 3 | **Header-Feld:** Ob ein KI-Programm freie Header erlaubt, ist von ihm abhängig. Nicht erhoben, welche der eingesetzten Programme das können. | Team |
| 4 | **Ungemessen:** Starten Hosts ihre OAuth-Oberfläche bei einem 401 *mitten in der Sitzung*? Entscheidet über Option A. | Probe (~1 h) |
| 5 | **Ungemessen:** Trägt edu-sharings Session-Cookie unsere Endpunkte? Wäre die Alternative zum Passwort im Umschlag. | Probe |
| 6 | **WLO-Betreiber:** OAuth-Client registrieren oder OIDC freischalten? | Anfrage nötig |
| 7 | **Datenschutz:** Betreiberidentität in `docs/PRIVACY.md` noch nicht ausgefüllt. | Team |
| 8 | **Widerruf:** In keiner Option heute einzeln möglich. Brauchen wir das? | Team |

---

## 8. Entscheidungsfragen

**F1 — Wie viele Personen sollen sich mit eigenem WLO-Konto anmelden?**
Handvoll oder Öffnung für die Redaktion? *Diese Antwort bestimmt alle anderen.*

**F2 — Bauen wir Option 0+ jetzt?**
Streicht die konkreteste Schwachstelle, ändert nichts an der Architektur, kostet
wenig. Sie ist unabhängig davon, wie F1 ausfällt — sie schadet auch dann nicht,
wenn später Option B kommt.

**F3 — Fragen wir die WLO-Betreiber nach OAuth/OIDC?**
Der einzige Hebel, der das Problem wirklich löst. Kostet uns eine E-Mail.

**F4 — Führen wir die Messungen 4 und 5 durch?**
Ohne sie ist Option A nicht bewertbar. Etwa eine Stunde.

**F5 — Falls Option B: wer betreibt und hütet den Hauptschlüssel?**
Ein Geheimnis, das jeden ausstehenden Umschlag zu einem Passwort entschlüsselt,
braucht eine benannte verantwortliche Person und ein Verfahren zum Wechsel.

**F6 — Falls Option B: akzeptieren wir ein selbstgehostetes Passwortformular?**
Wir würden Redakteurinnen beibringen, WLO-Passwörter auf einer Nicht-WLO-Seite
einzugeben — gegen dieses Muster impfen Phishing-Schulungen.

**F7 — Chatbot: Schreiben unter dem Dienstkonto ein- oder ausschalten?**
Technisch ist es ein Schalter (`WLO_ALLOW_SERVICE_WRITES=1`, zum Anlegen
zusätzlich `WLO_INBOX_ID`). Wenn ja: in welchen Posteingang, und mit welchem
möglichst gering berechtigten Konto? Zu bedenken: Bei einem öffentlich
erreichbaren Chatbot leiht sich **jeder Nutzer** die Rechte dieses Kontos.

---

## Empfehlung zur Diskussion

Kein Vorschlag zu F1 — das ist eine Produktentscheidung, keine technische.

Unabhängig davon: **F2 und F3 sofort.** Option 0+ ist billig und beseitigt die
einzige Schwachstelle, die heute nachweislich existiert. Die Anfrage an die
WLO-Betreiber kostet nichts und kann alles Übrige gegenstandslos machen.

Option B lohnt sich erst, wenn F1 „breite Öffnung" ergibt.
