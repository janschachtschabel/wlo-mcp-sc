# Contributing (Beitragen)

> 🇩🇪 Deutsch · 🇬🇧 [English version](CONTRIBUTING.md)

Kurzleitfaden für Änderungen an diesem Repository. Ziel: kleine, verifizierte,
gut lesbare Änderungen, die das Projekt wartbar halten.

## Workflow

1. Vor dem Coden: die betroffenen Dateien lesen, kleinste sinnvolle Änderung planen.
2. Bei neuer Logik oder Bugfixes: **Test zuerst** (`node:test`), rot sehen, dann grün.
3. Vor „fertig": `npm run build` **und** `npm test` laufen lassen — beide grün, Output ansehen.
4. Docs (README, CHANGELOG, Kommentare) in derselben Änderung mitziehen.

```bash
npm install
npm run build   # tsc (strict)
npm test        # Offline-Suite (node:test), kein Netzwerk nötig
```

## Sprache

- **Code-Bezeichner** (Variablen, Funktionen, Typen): Englisch.
- **Kommentare & Tool-/Parameter-Beschreibungen**: gemischt Deutsch/Englisch ist
  im Bestand üblich und akzeptiert. Regel: **die Sprache des umgebenden Codes
  beibehalten** — eine Datei nicht mitten im Kommentarfluss umsprachen.
  Nutzer-sichtbare Tool-Beschreibungen dürfen Deutsch sein (Zielgruppe WLO).
- Kommentare erklären **warum**, nicht was der Code offensichtlich tut.

## Tests

- Nur externe Grenzen mocken (Netzwerk via `tests/fetchMock.ts`), nie die zu
  testende Einheit selbst.
- Tests sind deterministisch (kein `Date.now()`/Zufall/Timing-Abhängigkeit ohne Not).
- Keinen Test abschwächen/skippen, nur um die Suite grün zu bekommen.

## Sicherheit

- Keine Secrets im Code — alles über Env.
- Externe Eingaben an Vertrauensgrenzen validieren (zod-Schemata der Tools).
- IDs vor der Interpolation in URLs kodieren (`encodeURIComponent`).
- Alle Upstream-Requests über `wloFetch` (erzwingt Timeout).
- Logging nur über `src/logger.ts` (JSON nach **stderr** — stdout gehört im
  stdio-Modus dem MCP-Protokoll).

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
  `refactor:`, `test:`, `docs:`, `chore:`, `ci:`, `build:`.
- Eine logische Änderung pro Commit; keine gebündelten Feature+Refactor+Format-Sweeps.
- Kein Debug-Output, keine auskommentierten Code-Reste, keine Secrets committen.

## Umgebungsvariablen

Neue Env-Variablen immer in `README.md` (Tabelle) **und** `.env.example` dokumentieren.
