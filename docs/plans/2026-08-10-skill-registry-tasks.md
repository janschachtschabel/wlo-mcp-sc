# Aufgaben: Skill-Registry pro Inhaltssammlung

Entwurf: [`2026-08-10-skill-registry-design.md`](2026-08-10-skill-registry-design.md)

12 Aufgaben in 4 Phasen. Jede Phase beginnt mit Schritt 0.

| Phase | Aufgaben | Ergebnis | Stand |
|---|---|---|---|
| P0 — Messung | T1 | Die Annahmen stimmen (oder der Entwurf wird korrigiert) | **fertig 2026-08-10** — drei Korrekturen am Entwurf |
| P1 — Dienst | T2–T5 | `loadSkillRegistry` funktioniert | **fertig 2026-08-10** — 21 Tests |
| P2 — Werkzeug | T6–T8 | `get_skill_registry` + `WLO_DISABLE_SKILL_SEARCH` | **fertig 2026-08-10** — 9 Tests, 28. Lesewerkzeug |
| P3 — Suche & Doku | T9–T12 | Katalog in der Suche (opt-in) + kostenloser Hinweis, Doku, Live-Lauf | **T9–T11 fertig 2026-08-10** · T12 teilweise (siehe unten) |

---

## P0 — Messung zuerst

> **Schritt 0:** `/better-coding-workflow` aufrufen.

Diese Phase existiert, weil das Projekt zweimal teuer gelernt hat, dass ein
Test gegen `fetchMock` nur beweist, dass wir senden, was wir uns ausgedacht
haben. **Vor** dem Bauen wird gemessen.

### T1: Annahmen gegen Staging prüfen — **ERLEDIGT 2026-08-10**

**Dateien:** keine (Wegwerf-Skript im Scratchpad)

| Frage | Ergebnis |
|---|---|
| 1. `mimetype` in der Kinderliste? | **Ja**, in jeder Projektion (Knotenfeld) |
| 2. `ccm:oeh_extendedType` in der Kinderliste? | **Nur mit `SKILL_PROPS`** — mit `DISPLAY_PROPS` leer, gleicher Knoten |
| 3. Medientyp einer SKILL.md? | **`text/x-web-markdown`** (25/25), `mediatype: file-markdown` |
| 4. Registry vorhanden? | **Nein** (`SKILL_REGISTRY` → 0) |

Drei Zusatzbefunde, die in den Entwurf eingearbeitet sind: 28/28 Dateien heißen
`SKILL.md` (Namensregel unterscheidet heute nichts), 0/28 sind
Sammlungsverweise (Skills liegen noch nicht in Sammlungen), 0/28 Dokumente
enthalten `:::` (roh geprüft — das Format ist auf Staging ungeübt).

**Folge für den Plan:** T2 nimmt den gemessenen Medientyp, T3 muss `SKILL_PROPS`
mitgeben, T12 hängt an Redaktionsarbeit statt an Code.

**Rollback:** entfällt (nur Lesen).

---

## P1 — Der Dienst

> **Schritt 0:** `/better-coding-workflow` aufrufen.

### T2: Erkennungsregel als reine Funktion

**Dateien:** Neu `src/services/skill-registry.ts` · Test `tests/skill-registry.test.ts`

**Was:** `pickRegistryNode(nodes: WloNode[]): { node: WloNode; candidates: number } | null`
— filtert auf `ai_prompt` + Markdown (Medientyp `text/x-web-markdown`,
`text/markdown`, `text/x-markdown` **oder** `mediatype === 'file-markdown'`, siehe
T1), wendet den Tie-Break an (`SKILL_REGISTRY.md` in `cm:name` **oder**
`SKILL REGISTRY` im Titel, case-insensitiv), sortiert den Rest nach `nodeId` und
nimmt den ersten. Rein, ohne Netz.

**Tests zuerst:** ein Kandidat → gewählt · zwei, einer heißt `SKILL_REGISTRY.md`
→ dieser · zwei ohne Kennzeichen → stabil derselbe, `candidates: 2` ·
`ai_prompt` ohne Markdown → nicht gewählt · Markdown ohne `ai_prompt` → nicht
gewählt · leer → `null`.

**Verifikation:** `node --import tsx --test tests/skill-registry.test.ts`

### T3: Registry finden (Netz-Anbindung)

**Dateien:** `src/services/skill-registry.ts` · `tests/skill-registry.test.ts`

**Was:** die Registry-Suche (intern `scanForRegistry`) — Kinderliste mit **`SKILL_PROPS`**
holen (T1: ohne diese Projektion ist `ccm:oeh_extendedType` leer),
`pickRegistryNode` anwenden, `{ registryNodeId, registryTitle }` oder `null`.
Ein fehlgeschlagener Abruf ergibt `null`, wirft nicht.

**Tests zuerst:** Sammlung mit Registry → Marker · ohne → `null` · 503 → `null`,
kein Wurf · die Anfrage trägt `ccm:oeh_extendedType` in der Projektion (sonst
misst der Test eine Bedingung, die live nie greift).

### T4: Katalog bauen — zwei Stufen

**Dateien:** `src/services/skill-registry.ts` · `tests/skill-registry.test.ts`

**Was:** `loadSkillRegistry(collectionId, { resolveHeads = true })` — Marker aus
T3, dann den Text über `getNodeDownloadText` (nicht `getSkill`: der Marker trägt
den Knoten schon), `parseSkillReferences` darauf, `filter(kind === 'ki-skill')`.

- **Immer:** Titel + nodeId direkt aus dem Block — null Zusatzabrufe.
- **Nur bei `resolveHeads`:** die IDs über `mapPool(…, 5)` auf Beschreibung und
  Schlagwörter auflösen; nicht lesbare landen in `unresolved`.

Kappung bei `REGISTRY_MAX = 30`, im Ergebnis genannt.

**Tests zuerst:** drei `ki-skill`-Blöcke → drei Einträge mit Titel und nodeId ·
`resolveHeads: false` → **kein** Metadatenabruf (am Mock gezählt), Einträge ohne
Beschreibung · `resolveHeads: true` → Beschreibung + Schlagwörter ·
`wlo-material`-Block wird ignoriert · ein Verweis nicht lesbar → `unresolved`,
die anderen bleiben · Reihenfolge = Dokumentreihenfolge · 31 Verweise → 30
Einträge + Kappungshinweis.

### T5: Fehlerfälle benennen

**Dateien:** `src/services/skill-registry.ts` · `tests/skill-registry.test.ts`

**Was:** `reason` sauber setzen: `collection_not_found`, `no_registry`,
`unreadable`. Nie eine leere Antwort ohne Grund.

**Tests zuerst:** je ein Test pro `reason`.

---

## P2 — Das Werkzeug

> **Schritt 0:** `/better-coding-workflow` aufrufen.

### T6: `get_skill_registry` registrieren

**Dateien:** `src/tools/skills.ts` · Neu `tests/tools-skill-registry.test.ts`

**Was:** Werkzeug mit einem Parameter `collectionId` (Pflicht) plus
`outputFormat`. Ausgabe in dieser Reihenfolge:

1. **Katalog** (servergebildet): je Eintrag Titel, nodeId, Beschreibung,
   Schlagwörter — jeder Titel durch `oneLine`.
2. Hinweis, wie es weitergeht: „mit `get_skill` und der nodeId laden".
3. Offenlegungen: `unresolved`, `ambiguous`, Kappung.
4. **Dann** das Registry-Markdown, unverändert.

**Tests zuerst:** Katalog steht **vor** dem Dokument · ein Titel mit `\n` fälscht
keine zweite Zeile · `reason` wird als Text gemeldet, nicht als Fehler.

### T7: Env-Schalter für `search_skill`

**Dateien:** `src/tools/skills.ts` · `tests/tools-skill-registry.test.ts` · `.env.example`

**Was:** `WLO_DISABLE_SKILL_SEARCH` (Werte wie die übrigen Flags:
`1`/`true`/`yes`/`on`) — `search_skill` wird nicht registriert; `get_skill` und
`get_skill_registry` bleiben. Ohne Wirkung im `one-tool`-Modus, wo
`get_skill_for_task` die Suche IST. Beim Start eine Log-Zeile, die es nennt.

> **Planänderung während P2:** der zweite Schalter
> `WLO_REGISTRY_IN_SEARCH` (damals noch `WLO_DISABLE_…`) ist nach **T9** gewandert. Er schaltet die
> Anreicherung der Suche ab — Verhalten, das es vor T9 nicht gibt, und ein
> Schalter für nichts ist genau die spekulative Konfiguration, die der Workflow
> verbietet. Er wird dort gebaut und dort getestet.

**Tests zuerst:** ohne Variable → `search_skill` in `tools/list` · mit dem
Schalter → nicht enthalten, `get_skill` und `get_skill_registry` weiterhin da.
Die Werteregel („false" schaltet nicht ein) sitzt im Parser in `wlo-config.ts`;
die Registrierung nimmt einen **Parameter**, damit sie ohne Env-Gefummel testbar
bleibt — dasselbe Muster wie `mode`.

### T8: Werkzeugbeschreibung

**Dateien:** `src/tools/skills.ts` · `tests/tool-descriptions.test.ts`

**Was:** Beschreibung nennt zuerst die Auslöser („welche Skills gelten für diese
Sammlung", „was darf ich hier verwenden"), dann die Abgrenzung zu `search_skill`
und `get_skill`. Unter 1024 Zeichen.

---

## P3 — Suche, Doku, Live-Lauf

> **Schritt 0:** `/better-coding-workflow` aufrufen.

### T9: Registry-Katalog im Sammlungs-Ergebnis

**Dateien:** `src/services/search.ts` · `src/apps/outputSchemas.ts` · `tests/…`

**Was:** Im vorhandenen Anreicherungs-Block (neben `enrichTextContent` /
`enrichCompendium`) ein `enrichSkillRegistry(collectionsFmt)`: je Sammlung
`loadSkillRegistry(id, { resolveHeads: false })` über `mapPool` (Grenze 5) —
also **2 Abrufe je Sammlung**, nicht mehr. Nur die Sammlungen, nicht die
Themenseiten. Feld nur setzen, wenn eine Registry existiert; ein Fehlschlag
lässt es weg und bricht die Suche nie ab.

Dazu der Schalter **`WLO_REGISTRY_IN_SEARCH`** (aus T7 hierher
verschoben, weil er erst hier etwas abschaltet): gesetzt → keine Anreicherung,
kein Zusatzabruf; das Werkzeug bleibt. Beim Start eine Log-Zeile.

**Tests zuerst:** Sammlung mit Registry → Feld mit Einträgen (Titel + nodeId) ·
ohne → Feld fehlt · Abruf wirft → Suche liefert trotzdem Ergebnisse · **die
Anzahl der Upstream-Abrufe je Sammlung ist 2** (am Mock gezählt — die
Kostenzusage ist Teil des Vertrags, nicht eine Absicht) · Themenseiten-Ergebnisse
werden nicht angereichert · mit dem Schalter → kein Feld und **kein**
zusätzlicher Abruf.

### T10: Katalog rendern

**Dateien:** `src/tools/collections.ts` · `src/tools/content-search.ts` · `tests/…`

**Was:** In der Markdown-Ausgabe je Sammlung mit Registry: eine Kopfzeile
(Registry-Titel + nodeId), darunter die Einträge als Titel + nodeId, dazu der
Hinweis „Volltext mit `get_skill`, ganze Registry mit `get_skill_registry`".
Jeder Wert aus dem Repository durch `oneLine`.

### T11: Dokumentation

**Dateien:** `docs/SKILLS.md`, `docs/TOOLS.md`, `docs/INTEGRATION.md`,
`README.md`, `README.de.md`, `CHANGELOG.md`, `.env.example`

**Was:** `SKILLS.md` bekommt einen Redaktionsabschnitt „Registry anlegen" mit
**Beispiel-Dokument** (Kopf, `::: ki-skill`-Blöcke, Verwendungshinweise) und der
Namensregel. Werkzeugzahlen überall nachziehen (**42** statt 41; mit
`WLO_DISABLE_SKILL_SEARCH` → 41).

### T12: Live-Lauf gegen Staging

**Dateien:** `docs/plans/STATUS.md`

**Was:** Echte Registry in einer Staging-Sammlung anlegen (**Redaktionsarbeit** —
T1 hat gemessen, dass es heute weder eine Registry noch einen Skill in einer
Sammlung noch ein Dokument mit `:::`-Blöcken gibt) und den ganzen Weg messen:
Katalog in der Suche → `get_skill_registry` → `get_skill`. Dazu die
**Suchdauer mit und ohne** `WLO_REGISTRY_IN_SEARCH`, damit die
Kostenzusage eine Zahl hat. Die zwei Live-Läufe dieses Projekts fanden je
Defekte, die kein Mock sah.

**Verifikation:** Messbericht in `STATUS.md`; erst danach gilt das Paket als fertig.
Bis dahin gilt der `:::`-Pfad als **ungemessen**, nicht als gruen.

**Stand 2026-08-10 — teilweise erledigt, was ohne Registry messbar war:**

| Geprueft | Ergebnis |
|---|---|
| Kosten der Anreicherung | **~1,0–1,4 s** je Suche (2 Sammlungen parallel), nicht die geschaetzten 0,5 s |
| Was die Dauer treibt | die **Kindzahl** der groessten Sammlung, nicht die Projektion und nicht die Zahl der Sammlungen |
| `reason: no_registry` an einer echten Sammlung | korrekt |
| `reason: collection_not_found` an einer unbekannten id | korrekt (HTTP 404) |
| unlesbare Kinderliste | degradiert, statt zu werfen |

**Offen und nur mit Redaktionsarbeit erreichbar:** der ganze `:::`-Pfad — ein
Registry-Dokument anlegen, den Katalog in der Suche sehen, `get_skill_registry`
und dann `get_skill` durchlaufen. Solange das aussteht, ist dieser Pfad durch
Unit-Tests gedeckt und durch **keinen** echten Datensatz.

---

## Abnahmekriterien

| Anforderung | Nachweis |
|---|---|
| Registry wird per Position + Namensregel gefunden | T2, T3 |
| Katalog trägt Titel, Beschreibung, Schlagwörter | T4 |
| Registry-Prosa kommt mit | T6 |
| Katalog steht vor dem fremden Dokument | T6 |
| Nicht auflösbare Verweise werden genannt | T4, T5 |
| ~~Katalog erscheint **automatisch** bei der Sammlungssuche~~ → **auf Anforderung**, plus kostenloser Hinweis | T9, T10 · geändert 2026-08-10 nach der Kostenmessung (~1,0–1,4 s je Suche) |
| Die Anreicherung kostet 2 Abrufe je Sammlung | T9 (am Mock gezählt), T12 (live gemessen) |
| Ein Aufrufer kann sie je Aufruf anfordern (`includeSkillRegistry`) | `tests/tools-registry-param.test.ts` — an `search_wlo_all` und `search_wlo_collections` |
| Die Kosten stehen in der Parameterbeschreibung | ebd. — ein Modell kann keine Rundreise abwägen, von der es nichts weiß |
| Ohne Anforderung wird **nichts** abgerufen | ebd. (Aufrufe am Mock gezählt) |
| `search_skill` per Env abschaltbar, Rest bleibt | T7 |
| Anreicherung per Env betriebsweit **einschaltbar** (`WLO_REGISTRY_IN_SEARCH`) | `tests/search-registry-enabled.test.ts` |
| Keine stille Obergrenze | T4 |

> **Warum das erste Kriterium umgeschrieben wurde.** Der Plan verlangte den
> Katalog automatisch in jeder Sammlungssuche. Der Live-Lauf hat gemessen, was
> das kostet — ~1,0–1,4 s je Suche, bezahlt über den `/children`-Aufruf, auch
> wenn gar keine Registry existiert. Der Nutzer hat daraufhin entschieden:
> standardmäßig aus, Abruf über das Werkzeug, Mitlieferung über einen optionalen
> Parameter. Ein Plan, der der Messung widerspricht, wird korrigiert — nicht der
> Code an den Plan angepasst.

## Regressionsrisiko

`tests/tools-skills.test.ts`, `tests/services-skills.test.ts`,
`tests/server.test.ts` (Werkzeugliste), `tests/tools-license-filter.test.ts`
(Sammlungssuche) müssen grün bleiben. Volle Suite als Gate.
