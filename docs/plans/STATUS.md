# WLO MCP Server — Stand

Kurzer, aktueller Stand. Ein neuer Kontext liest: `CLAUDE.md` → diese Datei → die Regeldatei des
Bereichs in [`docs/rules/`](../rules/README.md). Der Verlauf steht im Archiv und wird hier nicht
fortgeschrieben; je Paket kommt **ein Absatz** dazu, und ältere Absätze wandern ins Archiv, sobald
diese Datei über rund 100 Zeilen wächst.

**Arbeitsverzeichnis:** `C:\Users\jan\staging\Windsurf\wlo-mcp-server-sc` · **Ziel-Repository:** Staging ·
**Veröffentlicht nach:** `janschachtschabel/wlo-mcp-sc` (nie ins lokale `origin`).

## Was es gibt

- 34 Lese-Werkzeuge, 26 Kuratier-Werkzeuge (60; mit `WLO_BATCH_UPLOAD_ENABLED` 64), REST unter `/api`,
  `/auth`, `/oauth`; Widgets für Suche, Baum, Themenseite, Detail.
- Abgeschlossene Pläne (Entwurf und Aufgaben je in `docs/plans/`): Apps-SDK-Umbau (P0–P8), Schreiben und
  Kuratieren, `get_url_text`, Zugangsblock, OAuth 2.1, Skill-Abruf, Lizenzfilter, Skill-Registry mit Cache
  und Kontexten, Sammlungssuche über beide Indizes, Vokabular-Abgleich, Ticket-Tausch, Schreibziel
  Original, Kompendium mit Passagen, BOERDi-Wunschliste, Chatbot-Anbindung (S1–S7), Volltext und
  Sammelmetadaten (W1–W4), Audit-Nacharbeit vom 12.11., Sammlungsstrukturen (S1–S10, vier Pakete).

## Offen

- **Entscheidungen des Nutzers:** Termin für das Staging-Deployment, Registry der Plattform. Nicht gebaut und so entschieden: einheitlicher Vertrag (A-3), Ausgabeschemas für die
  übrigen Werkzeuge, `wlo_register_usage` (braucht eine App-Signatur), Sitzungs-Zugang P2.
- **Ungemessen:** wie die WLO-Oberfläche Vorschläge für eine Sammlung zeigt und in welcher Reihenfolge
  sie Untersammlungen darstellt.
- **Beim Chatbot-Team:** siehe die Antworten `2026-11-14-…` und `2026-11-15-…` in `docs/plans/`.

## Letzte Pakete

- **2026-11-14 — Sammlungsstrukturen (S1–S10), vier Pakete, je mit Review.** Gespeicherte Reihenfolge
  lesen und setzen, flache Baumliste, Stapel-Einreichen, Baum-Metadaten, Entfernen und Umhängen im
  Stapel, leere Sammlungen löschen, Sammlung umhängen, Vorschläge für eine Sammlung, „noch nicht
  öffentlich“. Plan und drei Messtabellen: `2026-11-14-sammlungsstrukturen.md`.
- **2026-11-14 — Voll-Audit (77/100, bedingt produktionsreif), alle Befunde behoben.** Vier Bereiche
  (Schreiben, Lesen, Sicherheit mit Testgerüst, Betrieb mit Oberflächen und Doku), dazu die zwei Funde
  des Chatbot-Teams. Erstes Review (drei Prüfer): 0 kritisch, 7 groß, 19 klein, 10 Randnotizen. Zweites
  Review über den ganzen Stand (zwei Prüfer): 0 kritisch, 4 groß, 14 klein, 7 Randnotizen — darunter
  ein Fehler, den die erste Behebung selbst eingeführt hatte. Alles behoben, je mit Gegenprobe.
  Was bleibt und so hingenommen ist: Unbewiesene `Basic`-Anmeldungen können einander in den
  Schreib-Speichern verdrängen (`docs/rules/auth.md`, letzter Block). Was ein Client anders sieht:
  `CHANGELOG.md` und `2026-11-14-antwort-sammlungsstrukturen-2.md`.
- **2026-11-14 — Steuerdokumente.** `CLAUDE.md` von 2154 auf rund 250 Zeilen; die Regelblöcke wortgleich
  nach `docs/rules/` (acht Dateien nach Bereich); diese Datei von 5243 Zeilen auf den Stand gekürzt.
- **2026-11-15 — Wünsche S11–S13 des Chatbot-Teams.** `order: "position"` an den drei Baum-Werkzeugen,
  das Merkmal `childrenPositioned`, schlanker Zählabruf (Physik mit Zahlen 7,0 statt 11,4 s),
  `unreadParents` / `refusedParents`. Vorher gemessen (`npm run measure:tree`); ein Review (0 kritisch,
  1 groß, 6 klein, 4 Randnotizen), behoben. Dazu: `openWorldHint` nur noch an den zwei Werkzeugen, die
  das Repository verlassen; alle übrigen Dokumente gegen den Code gelesen;
  `docs/STECKBRIEF-UEBERGABE.md` nach der Übergabe-Vorlage. Antwort ans Team:
  `2026-11-15-antwort-sammlungsstrukturen-3.md`.
- **2026-11-15 — `idempotentHint` angeglichen.** Je Schreibwerkzeug gelesen, was ein zweiter gleicher Durchlauf
  sendet; `true` bei 19, `false` bei den fünf, die erneut etwas anlegen oder senden. Lesewerkzeuge tragen das
  Merkmal nicht mehr. Technischer Owner im Übergabe-Steckbrief: T4.
- **2026-11-15 — Version 1.2.0.** Tag `v1.2.0` baut Image und Chart (`release.yml`, ghcr.io); `GET /openapi.yaml`;
  eigener B3-Trace, wenn keiner ankommt; Chart-Version = Dienst-Version; CI rendert den Chart. Abgleich mit dem
  Leitfaden in `docs/STECKBRIEF-UEBERGABE.md`.
- **2026-11-15 — Betrieb hinter der B-API: gemessen und entworfen, nichts gebaut.**
  `2026-11-15-b-api-betrieb.md`. Offen: Proxy-Eintrag `wlo-mcp` auf Staging, Name der zusätzlichen Kopfzeile.
- **2026-11-15 — Sitzungs-Tausch `POST /auth/session` gebaut**, ohne Vorgabe aus (`WLO_SESSION_EXCHANGE`).
  Vorher gemessen (`scripts/session-disableguest-probe.mjs`), Live-Test mit echter Sitzung grün. Plan fürs
  Chatbot-Team: `2026-11-15-chatbot-anmeldung-aus-der-sitzung.md`. B-API-Betrieb bleibt Entwurf: dort läuft
  bisher nur das Lesen von Metadaten.
- **2026-11-15 — Rückmeldung des Chatbot-Teams zum Sitzungs-Tausch:** Sitzungs-Block an seine Eintragung
  gebunden (Widerruf und Ablauf bleiben bestehen), Helm-Regel `sessionIngress`. Antwort:
  `2026-11-15-antwort-chatbot-sitzung.md`. Offen beim Nutzer/T6: ob der MCP im Cluster des Repositorys läuft.
- **2026-11-15 — zweites Review des Sitzungs-Tauschs** (1 groß: Rollback-Sicherheit der Registry; 5 klein,
  9 Randnotizen), alles behoben. Dazu `docs/WERKZEUGE.md` (alle 64 Werkzeuge, eine Zeile je Werkzeug) und
  `docs/architektur-grafik.html` (Archify).
- **2026-11-15 — zweite Antwort des Chatbot-Teams: Weiterreicher und Ticket-Bindung.** Ein vertrautes Backend
  darf den Sitzungs-Tausch weiterreichen: Mit seinem Schlüssel zahlen `/auth/session` und `/auth/revoke` aus
  seinem Protokoll-Budget, und der Sitzungs-Schutz zählt je Adresse, die es nennt. Ticket-Blöcke sind jetzt an
  ihre Eintragung gebunden wie Sitzungs-Blöcke (beim Einspielen einmal 401 für per Neuladen ausgestellte
  Blöcke). Antwort: `2026-11-15-antwort-chatbot-sitzung-2.md`. Offen beim Nutzer: Der Staging-Server läuft
  noch mit 1.0.0 und braucht den neuen Stand plus `WLO_SESSION_EXCHANGE=1`.
- **2026-11-15 — Version 1.3.0.** Tag `v1.3.0`: Image und Chart mit Sitzungs-Tausch, Weiterreicher-Budget und
  Ticket-Bindung (`release.yml`).
- **2026-11-15 — dritte Antwort des Chatbot-Teams: `X-WLO-Client-Address`.** Traefik verwirft ab Werk
  `X-Forwarded-For` von nicht vertrauten Absendern; ein vertrauter Client nennt die Adresse der Person deshalb
  in einer eigenen Kopfzeile (nur mit Schlüssel). Jeder Tausch loggt die gezählte Adresse als Pseudonym, ein
  Client ohne Adresse wird gewarnt. Antwort: `2026-11-15-antwort-chatbot-sitzung-3.md` (Vorschlag `rpm` 500).
- **2026-11-15 — Version 1.4.0.** Tag `v1.4.0`: `X-WLO-Client-Address` und die Behebung der Zonen-Kennung. Der
  Stand liegt auch im ursprünglichen Repo `wlo-mcp-server` (Merge-Commit, Vercel vorher getrennt); beide Repos
  teilen dieselbe `main`.
- **Entschieden 2026-11-15: die Werkzeugliste bleibt vorerst, wie sie ist.** `tools/list` misst rund 235 000 Zeichen für 60 Werkzeuge (Test hält das
  als Obergrenze). Kleiner wird es nur durch eine andere Form des veröffentlichten Schemas —
  gemeinsame Datensatz-Definition je Werkzeug per `$ref`, Qualitätsparameter als ein Objekt — und das
  ändert, was Clients einlesen.

## Archiv

- [archive/STATUS-2026-07-15-bis-2026-08-14.md](archive/STATUS-2026-07-15-bis-2026-08-14.md)
- [archive/STATUS-2026-08-15-bis-2026-11-14.md](archive/STATUS-2026-08-15-bis-2026-11-14.md) — enthält auch
  die Fortschrittstabelle des ersten Umbaus und alle Review-Protokolle bis zu den Sammlungsstrukturen.
