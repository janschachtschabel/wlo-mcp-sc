# Audit-Nacharbeit (Audit vom 2026-11-12)

Stand 2026-11-12 · Grundlage: Audit über alle Dimensionen (vier unabhängige
Prüfer, Bericht außerhalb des Repositorys) · Entwurf und Aufgaben in einer Datei.

## Ziel

Die Befunde des Audits abarbeiten, in der Reihenfolge seines Fahrplans. Jedes
Paket: `/better-coding-workflow` → Test zuerst → Umsetzung → unabhängiger Review
→ Befunde beheben → STATUS. Nach mehreren zusammenhängenden Paketen ein
paketübergreifender Review.

## Regel für Rückfragen (Nutzerentscheidung 2026-11-12)

Ohne Rückfrage arbeiten, solange der Server **nach außen kompatibel** bleibt:
Werkzeugnamen, Parameter, Antwortformen, Fehlercodes, Routen, Anmeldewege.
Zusätze sind erlaubt. Vor einer Änderung, die bestehende Clients bricht:
anhalten und fragen. Kein Commit, kein Push ohne Zuruf.

## Pakete

Kennungen (S-1, K-1 …) sind die des Auditberichts.

**Phase 1 — Blocker**
- [x] P1 Zugang: S-1 Block an Konto binden · S-2 bestätigter Benutzername in
      der Zugangsliste · S-6 ein Zählschlüssel der Anmeldesperre
- [x] P2 Schreibziel: K-1 Typprüfung beim Löschen · K-11 dieselbe Zielprüfung
      für Einordnen, Umbenennen, Kompendium
- [x] P3 Grenzen: P-2 Deckel für `get_skill` · S-3 kleines Body-Limit für
      Anmelde- und OAuth-Routen
- [x] P4 Herunterfahren: B-1 `SIGTERM`, Init-Prozess, Wartefrist
- [x] Review über Phase 1

**Phase 2 — Fundament**
- [x] P5 P-1 Gesamtlimit und Abbruchsignal in `wloFetch`
- [x] P6 B-3 Image in der CI bauen und testen · T-1 Starttest · B-6 Adresse
      beim Start prüfen
- [x] P7 A-4 ein Plan-Gerüst · K-7 `outcomeOpen` bei Plan- und Stapel-Fehlern ·
      K-4 Verbindungsabbruch als offen · K-5 Zurücklesen entscheidet
- [x] P8 A-1 Inhaltssuche und Knotendetails je ein Dienst · K-2 Weiterblättern ·
      P-5 Volltext-Deckel in der Suche
- [x] Review über Phase 2

**Phase 3 — Verbesserung**
- [x] P9 K-3 / K-15 „nicht erreichbar“ von „leer“ trennen
- [x] P10 A-2 alle Werkzeuge über die gemeinsame Registrierung
- [x] P11 K-8 bis K-10 Vorschlags-Werkzeuge · K-6 ID in der Fehlerantwort
      · offene ENTSCHEIDUNG aus dem Review über Phase 1: sollen
      `wlo_update_content[s]`, Vorschläge und `wlo_submit_content` eine Sammlung
      oder einen Ordner ablehnen? (ändert bestehendes Verhalten — Nutzer fragen)
- [x] P12 B-5 Log-Begrenzung, Anfrage-Kennung, Metriken
- [x] P13 übrige Sicherheitsbefunde S-4, S-5, S-7 bis S-13
- [x] Review über Phase 3

**Phase 4 — laufend**
- [x] P14 übrige geringe Befunde (offene Entscheidungen: A-3, A-2-Rest, D-2, S-11 hart, Metadaten auf Sammlungen — siehe STATUS) · dazu aus P10: Ausgabeschemata für die zwölf
      umgestellten Lesewerkzeuge (A-2-Rest, je Werkzeug ein Vertrag) · dazu aus P8: Einzelfall-Handler von
      `get_node_details` mit dem Dienst zusammenlegen (A-1-Rest, gehört zu A-5) (K-12 bis K-14, K-16, P-3, P-4, A-3, A-5 bis
      A-7, D-1 bis D-3, X-1, F-1, F-2, T-2)

Nicht Teil dieses Plans, weil Arbeitsweise bzw. Serverzustand und kein Code:
B-2 (Arbeitskopie an `wlo-mcp-sc` binden), B-4 (Compose-Hülle auf dem Server).

## Abnahme je Paket

`npm test`, `tsc`, `npm run lint`, `npm run build` grün; jede neue Prüfung per
eingespielter Verletzung rot gesehen; Doku und CHANGELOG im selben Paket.
