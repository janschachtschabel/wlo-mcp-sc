# WLO MCP Apps-SDK Rebuild — Status

Living progress tracker for the [design](2026-07-15-wlo-mcp-apps-sdk-rebuild.md)
+ [tasks](2026-07-15-wlo-mcp-apps-sdk-tasks.md). Updated at the end of each
package (phase). A fresh context resumes from: CLAUDE.md → this file → the
design/tasks docs.

**Working directory:** `C:\Users\jan\staging\Windsurf\wlo-mcp-server-sc`
**Process:** one package = one phase; after each, update this file + hand off for
a context reset (see the workflow block in CLAUDE.md).

> **Superseded on 2026-08-02 — Vercel is gone.** `api/mcp.ts`, `vercel.json` and
> `tests/api-mcp.test.ts` were deleted; the self-hosted Docker/Caddy deployment
> is the only target and `stdio.ts` + `http.ts` the only entry points. Every
> mention of Vercel, `api/mcp.ts`, `@vercel/node` or serverless constraints below
> is a record of what was true at the time — **do not act on it**. In particular
> the `@vercel/node` dependency findings and the "bundle dist-widgets for Vercel"
> follow-ups are closed by the removal, not outstanding.

---

## Progress

| Phase | Status | Notes |
|-------|--------|-------|
| P0 Groundwork & baseline | ✅ done (2026-07-15) | baseline green; esbuild + widget-build stub wired |
| P1 Internal enablers | ✅ done (2026-07-15) | DISPLAY_PROPS, fuzzy suggestions, swimlane service, skipCount — 114 tests |
| P2 New tools + bundling | ✅ done (2026-07-15) | +3 tools (wikipedia/compendium/within_collection), search_wlo_all +6 flags, topic-pages/browse params — 148 tests |
| P3 Apps-SDK foundation | ✅ done (2026-07-15) | seam + outputSchemas, structuredContent on 6 display tools, readOnlyHint on all, server instructions, `search`/`fetch` — 165 tests, 17 tools. **3.6 dev-mode gate = manual (user)** |
| P4 Widget suite | ✅ done (2026-07-15) | build pipeline + `ui://` resources, W3 tile, W1/W4/W2 widgets, seam `widgetUri` wiring — 201 tests |
| P5 REST layer | ✅ done (2026-07-15) | `GET /api/{search,compendium,topic-page,wikipedia}` over services, validated + rate-limited — 219 tests |
| P6 Launcher | ✅ done (2026-07-15) | knowledge-instruction launcher (Claude/ChatGPT/Copilot/Gemini) + static route + `/api/skills[/<id>]` + bookmarklet — 236 tests |
| P7 Optional tools | ✅ done (2026-07-15) | +4 tools: publishers/related/breadcrumb/stats — 251 tests, 21 tools; live-smoked |
| P8 Deployment | ✅ done (2026-07-15) | MCP_SSE flag + Docker bundles widgets/public + compose + submission docs + audit — 254 tests; image smoke-verified |

---

> **Ältere Einträge (2026-07-15 bis 2026-08-14)** stehen unverändert in
> [archive/STATUS-2026-07-15-bis-2026-08-14.md](archive/STATUS-2026-07-15-bis-2026-08-14.md) — ausgelagert am 2026-11-05.
> Die Fortschrittstabelle oben bleibt vollständig.

## 2026-08-15 — Aktivierungszeile beim Skill-Abruf (Paket abgeschlossen)

**Was fehlte.** Ein Skill wirkte unsichtbar. `get_skill` liefert die Anleitung,
das Modell arbeitet danach — und in der Antwort steht nichts darüber, dass ein
hochgeladenes Dokument sie gerade mitsteuert, geschweige denn welches. Bei den
Skills eines Hosts löst das die `SKILL.md` selbst, mit einer Zeile ganz oben.
Für WLO-Skills wäre das dieselbe Zeile in 28 Dokumenten, von Hand gepflegt und
vom Dokument bestimmt.

**Gebaut.** `src/services/skill-activation.ts` (neu, 47 Zeilen) baut die Zeile
server-seitig aus `cclom:title`:

```
[ edu-sharing Skill ] Unterrichtsstunde planen - aktiv
```

Sie hängt als Feld `activation` an `SkillDocument`, nicht im Renderer — deshalb
tragen der Markdown-Kopf UND die JSON-Ausgabe dieselbe Zeile aus einer Quelle,
und ein Client, der die Antwort selbst zeichnet, ist nicht auf das Wohlwollen
des Modells angewiesen. `renderActivation` in `tools/skills.ts` bittet um die
wörtliche Ausgabe; beide Abrufwerkzeuge gehen durch denselben Renderer, also
gilt es auch für `get_skill_for_task`.

**Drei Entscheidungen, die bindend sind.**

*Die Zeile ruht auf der Inhaltsart, nicht auf dem Werkzeugaufruf.* `get_skill`
liefert auch die Begleitdateien eines Skills aus — `getSkill` prüft die
Inhaltsart bewusst nicht nach, damit ein Repository ohne gepflegtes Feld nicht
„kein solcher Skill" auf einen sichtbar vorhandenen Datensatz antwortet. Eine
bedingungslose Meldung hätte eine Vorlage zum aktiven Skill erklärt. Die
Inhaltsart liegt in `SKILL_PROPS`, ist also ohne Zusatzabruf prüfbar.

*Der Titel geht durch `sanitizeText`, nicht durch `oneLine`.* Der Unterschied
steht im Quelltext von `formatter.ts` selbst: `oneLine` schützt die Trenner des
Renderers, es sanitisiert nicht. Hier landet Repository-Text in einer Anweisung,
die das Modell wörtlich an einen Menschen ausgibt — die Grenze, für die
`text-sanitize.ts` existiert. Ein Titel mit Zeilenumbruch hätte sonst eine
zweite, gefälschte Zeile geöffnet.

*Sie steht vor der Trennlinie*, aus demselben Grund wie das Dateimanifest — und
der Block sagt es ausdrücklich, weil er dem Modell gerade beigebracht hat, Zeilen
genau dieser Form auszugeben.

**Erzwingbar ist es nicht**, und das steht in allen drei Dokumenten. Es ist eine
Bitte an das Modell, mit derselben Verbindlichkeit wie die Aktivierungszeile
eines Host-Skills. Das Feld `activation` ist der Weg daran vorbei, wo ein Client
die Darstellung selbst in der Hand hat.

**Nachweis:** `npm test` → **1864 Tests, 1864 pass, 0 fail** (1858 + 6) ·
`npm run typecheck` → 0 Fehler · `npx eslint .` → 0 Probleme · `npm run build` →
exit 0. Fünf der sechs neuen Tests wurden vor der Umsetzung rot gesehen; der
sechste („aktiviert nichts für einen nicht markierten Datensatz") ging vorher
leer durch, weil es noch gar keine Zeile gab — er ist als Wächter geschrieben,
nicht als Rot-Grün-Beleg, und wird erst mit der Umsetzung aussagekräftig.

**Angefasst:** `src/services/skill-activation.ts` (neu), `src/services/skills.ts`,
`src/tools/skills.ts` · `tests/tools-skills.test.ts` · `docs/SKILL-TRIGGER.md`,
`docs/SKILLS.md`, `docs/TOOLS.md`, `CLAUDE.md`, `CHANGELOG.md`, diese Datei.

**Offen / bewusst nicht gemacht.** Der Text nennt nur den Titel — die
Beschreibung bleibt draussen (Entscheidung des Nutzers, „erstmal nur Titel").
Ein Apps-SDK-Widget, das die Zeile in ChatGPT selbst zeichnet statt sie zu
erbitten, ist der nächste Ausbauschritt und war hier ausdrücklich nicht im
Auftrag; das Feld `activation` ist die Vorarbeit dafür. `src/tools/skills.ts`
steht jetzt bei ~385 Zeilen und war schon vorher über der Schwelle — ein Schnitt
gehört in eine eigene Änderung, nicht in diese.

---

## 2026-08-15 — Skill-Registry an allen Sammlungs-Werkzeugen, Deckel 100 (Paket abgeschlossen)

**Der Bestand war zur Hälfte anders als angenommen.** Die Aufgabe nannte
`get_collection_contents` als „liefert nichts mit"; tatsächlich rief es
`ensureRegistries` — nur über die **Kinder**. Bei `contentFilter="files"` sind
das Materialien, also passierte nichts. Das war das Muster hinter allem:
Werkzeuge, die Sammlungen **zurückgeben**, hängten den Katalog an; Werkzeuge,
die **auf einer** Sammlung arbeiten, meldeten deren eigene Registry nie — und
genau die ist die gesuchte, weil sie in den Argumenten steht und nie im Ergebnis.

**P1 — ein Deckel statt zweier.** `REGISTRY_SEARCH_MAX` ist jetzt
`REGISTRY_MAX` (100), als Konstante geschrieben und nicht als wiederholte Zahl.
Zwei Stufen bedeuteten, dass eine Suchliste und `get_skill_registry`
Unterschiedliches über dieselbe Freigabeliste sagten. Es kostet keinen Abruf:
die günstige Stufe liest Titel und nodeId aus dem `:::`-Block, die Antwort sind
zwei Aufrufe, egal wie viele Skills.

Damit wurde ein **Satz falsch**, und das ist der Teil, den nichts sonst gefunden
hätte: „hier die ersten 30, mehr mit `get_skill_registry`" stimmte nur, solange
das Werkzeug die höhere Stufe war. Bei Gleichstand ist es ein Angebot, das es
nicht halten kann. Die gekappte Zeile zeigt jetzt auf das Registry-**Dokument**,
das `get_skill_registry` unverändert mit ausgibt. Ein Test hält die Gleichheit
fest, weil das Anheben einer der beiden Zahlen den Satz stillschweigend wieder
wahr oder falsch macht.

**P2 — die Sammlung, um die es geht.** `ensureRegistryFor` (eine Sammlung, ein
Cache, dieselbe Asymmetrie) und `subjectRegistryText` in `tools/shared.ts` als
die eine Stelle, die diese Frage beantwortet — festgehalten durch einen neuen
Wächter-Test. Angeschlossen: `get_collection_contents`,
`search_wlo_within_collection`, `get_topic_page_content` (dort die
**Sammlungs-ID**, nie die Varianten-ID) und `get_node_details`, wo die Registry
an den Datensatz selbst gehört statt daneben.

Jedes Negative — keine Registry, unlesbar, unbekannte ID, Cache aus — rendert
**nichts**. `ensureRegistryFor` kann die vier nicht unterscheiden, also wäre
jeder Satz eine Behauptung über Daten, die niemand hat.

**P3 — Übersichten markieren, statt zu listen.** `browse_collection_tree`,
`get_subject_portals` und `search_wlo_topic_pages` rendern einen Block je Knoten;
hundert Skills darunter zerstören die Form, für die es sie gibt. Sie tragen die
Kopfzeile über `registrySummaryLines(…, {entries:false})` — dieselbe Funktion,
kein zweites Format — und lesen **nur den Cache** (`cachedRegistriesFor`):
dreißig Portale oder fünfzig Zweige mit je einer Kinderliste sind der Rundlauf,
den dieser Cache verhindern soll.

`get_related_content` bleibt bewusst draußen: beide Listen dort stammen aus
`FILES`-Abfragen und können keine Sammlung enthalten. Nebenbefund, nicht
geändert: die `registryHintFor`-Zeile dort kann aus demselben Grund nie feuern.

**Zwei Dinge fand erst das Ausführen.** Der Registry-Block landete direkt unter
dem letzten Datensatz und las sich als dessen Registry — bei einem Material
etwas, das es nicht geben kann; er benennt seine Sammlung jetzt im Text, und ein
Test hält das fest. Und der bestehende Themenseiten-Test
(`tools-topic-pages.test.ts`) **prüft nichts**: seine Schleife läuft bei null
Treffern leer durch, und genau das tut sie mit ihrem Mock. Mein Test nimmt
deshalb den `collectionId`-Pfad, dessen Kette messbar ist.

**Nachweis:** `npm test` → **1876 Tests, 1876 pass, 0 fail** (1864 + 12) ·
`npm run typecheck` → 0 Fehler · `npx eslint .` → 0 Probleme · `npm run build` →
exit 0.

**Rot-Grün, genau:** 9 der 12 wurden vor der Umsetzung rot gesehen. Beim
Themenseiten-Listen-Test, dessen Verdrahtung beim Schreiben schon stand, durch
vorübergehendes Abklemmen der Übergabe nachgewiesen — sonst hätte er auch aus
einer anderen Quelle grün sein können. Die restlichen drei sind **Wächter, die
vorher leer durchgegangen wären** und das auch offen tun: „keine Registry → keine
Zeile" und „kalte Sammlung wird nur vorgemerkt" behaupten eine Abwesenheit, die
es vor der Änderung ohnehin gab, und die Zusicherung auf die benennende Zeile
entstand nach dem Fehler — den ich an der echten Ausgabe gesehen und dann behoben
habe, nicht an einem Test.

**Angefasst:** `src/formatter.ts`, `src/services/skill-registry.ts`,
`src/services/skill-registry-cache.ts`, `src/tools/shared.ts`,
`src/tools/collections.ts`, `src/tools/node-details.ts`, `src/tools/browse.ts`,
`src/tools/topic-page-content.ts`, `src/tools/topic-pages.ts`,
`src/tools/topic-pages-present.ts` · `tests/tools-registry-cache.test.ts`,
`tests/formatter.test.ts`, `tests/skill-registry.test.ts`,
`tests/shared-rule-discipline.test.ts` · `docs/SKILL-TRIGGER.md`,
`docs/SKILLS.md`, `docs/TOOLS.md`, `CLAUDE.md`, `CHANGELOG.md`, diese Datei.

**Offen.** Der Nutzen von 100 statt 30 ist auf Staging nicht messbar: dort
existiert genau **eine** Registry (Optik, 28 Einträge), also unter beiden
Deckeln vollständig. Der Unterschied zeigt sich erst an einer Registry mit mehr
als 30 Freigaben. Ebenfalls unverändert offen: `npm run test:live` ist nie
gelaufen.

### Nachtrag 2026-08-15 — Review desselben Pakets, 8 Befunde, alle behoben

**Der schwere:** beide Browse-Werkzeuge berechneten die Registries **nach** ihrer
`outputFormat === 'json'`-Weiche. JSON-Aufrufer bekamen nichts, Markdown-Aufrufer
die Kopfzeile — und die Doku-Tabellen, in derselben Änderung geschrieben,
versprachen es beiden. Behoben, indem der Katalog **an den Knoten** gehängt wird,
vor jeder Formatweiche. Das ist zugleich weniger Code: `CollectionTreeNode` *ist*
ein `FormattedNode`, beide Browse-Schemata erweitern `formattedNodeSchema` — Feld
und zod-Eintrag existierten längst — und `renderThemePages` ist den Map-Parameter
wieder los, den ich ihm angebaut hatte.

**Drei Ausgänge statt zwei.** `ensureRegistryFor` unterscheidet jetzt Katalog /
„geprüft, keine da" / „nicht geprüft". Die beiden letzten in ein `null` zu
falten hieß, einen fehlgeschlagenen Abruf als Sammlung zu zeigen, die nichts
freigibt — genau die Behauptung, für die es auf der Ergebnisseite
`registryHintFor` gibt. Die Subjekt-Seite hat ihren eigenen Satz bekommen.

**Die Warteschlangen-Lücke.** Ein Abruf, der nichts lernte, wurde weder gemerkt
noch vorgemerkt: der Tick wärmte die Sammlung nie, jeder Folgeaufruf zahlte
erneut live. Der Kommentar behauptete „stays queued" — das tat es nie. Jetzt tut
es das, und der Kommentar stimmt.

Dazu: Registry-Block **unter** Lizenz- und Leer-Hinweis (die sagen, warum ein
Ergebnis kurz ist, und dürfen nicht unter hundert Katalogzeilen rutschen);
`get_node_details` wirbt nicht mehr mit „~0,3 s", ohne den Sammlungs-Abruf zu
nennen; ein Docstring, der Aufrufstellen zählte, zählt jetzt keine mehr; die
verworfene `reach`-Berechnung im Kopfzeilen-Fall aufgelöst; und die bedingte
Zusicherung aus der Schleife in einen eigenen `get_node_details`-Test gelöst,
der zusätzlich `structuredContent` prüft.

**Einen Fehler haben die Korrekturen selbst erzeugt**, gefunden beim erneuten
Lesen des Diffs: bei leerer Sammlungs-ID — `get_topic_page_content` übergibt
`collectionId ?? ''`, wenn eine Suche nichts traf — meldete der neue Satz „Ob die
angefragte Sammlung  …", benannte nichts und bot einen Aufruf an, den niemand
machen kann.

**Testlücke geschlossen**, die Befund 1 durchgelassen hatte: alle 12 Tests des
Pakets lasen `toolText`, also nur Markdown. Jetzt prüfen zwei Tests die
JSON-Nutzlast **und** `structuredContent` — Letzteres ist der Teil, der beweist,
dass das Feld deklariert ist, denn zod entfernt unbekannte Schlüssel lautlos.

**Nachweis:** `npm test` → **1881 Tests, 1881 pass, 0 fail** (1876 + 5) ·
`npm run typecheck` → 0 · `npx eslint .` → 0 · `npm run build` → exit 0. Alle
fünf neuen Tests vor der Korrektur rot gesehen. Die Ausgabe beider geänderten
Pfade zusätzlich einmal angesehen: JSON trägt `skillRegistry`, und die
Blockreihenfolge stimmt.

**Angefasst (nur Korrekturen):** `src/formatter.ts`,
`src/services/skill-registry-cache.ts`, `src/tools/shared.ts`,
`src/tools/browse.ts`, `src/tools/collections.ts`, `src/tools/node-details.ts`,
`src/tools/topic-pages.ts`, `src/tools/topic-pages-present.ts` ·
`tests/tools-registry-cache.test.ts` · `CHANGELOG.md`, diese Datei.

### Nachtrag 2026-08-15 (2) — offene Punkte abgeräumt

**`get_related_content` fragte etwas, das nie eine Antwort haben konnte.** Es
rief `registryHintFor` über die Vereinigung seiner beiden Ergebnislisten — und
beide stammen aus `FILES`-Abfragen, können also keine Sammlung enthalten. Die
Zeile war unerreichbar. Statt sie zu löschen ist sie jetzt beantwortet: das
Werkzeug LIEST eine Sammlung, nämlich den Primärelternteil des Ausgangsknotens,
um „Aus derselben Sammlung" zu füllen. Der Dienst gibt sie als
`siblingCollectionId` heraus, und nur wenn `includeSiblings` gefragt war — ohne
Geschwister ist die Anfrage über EIN Material, und die Elternsammlung zu nennen
beantwortete etwas, das niemand gefragt hat, auf Kosten eines Abrufs.

Damit ist die Abdeckung vollständig: **jedes** Werkzeug, das eine Sammlung
zurückgibt oder auf einer arbeitet, liefert ihren Katalog mit.

**Zwei Stellen in CLAUDE.md waren durch die eigenen Änderungen falsch geworden**
— die Regel „`get_related_content` ist bewusst ausgenommen" und die
Aufzählung der zusammengesetzten Antworten, die es als zweiten Fall führte. Beide
korrigiert, und die beiden Regeln des Reviews (Feld am KNOTEN vor jeder
Formatweiche; drei Ausgänge statt zwei) sind jetzt dort festgehalten statt nur
im CHANGELOG.

**Nutzerdoku:** die Subjekt-Sammlung hat dieselben drei Zustände wie die
Ergebnisseite (Katalog / geprüft, keiner / nicht geprüft) — jetzt als eigene
Tabelle in `SKILL-TRIGGER.md`; und beide Tabellen sagen ausdrücklich, dass es in
**beiden** Ausgabeformaten gilt, was vor dem Review nicht stimmte.

**Nachweis:** `npm test` → **1883 Tests, 1883 pass, 0 fail** (1881 + 2) ·
`npm run typecheck` → 0 · `npx eslint .` → 0 · `npm run build` → exit 0. Der
Positivtest war vor der Änderung rot; der Negativtest („ohne Geschwister keine
Sammlung") ging vorher leer durch und ist als Wächter geschrieben.

**Angefasst:** `src/services/related.ts`, `src/tools/node-relations.ts` ·
`tests/tools-registry-cache.test.ts` · `CLAUDE.md`, `docs/SKILL-TRIGGER.md`,
`docs/TOOLS.md`, diese Datei.

### Nachtrag 2026-08-15 (3) — zweites Review, 6 Befunde, alle behoben

**Der schwere war ein Dokument, kein Code.** `CHANGELOG.md` behauptete im
Abschnitt desselben Tages, `get_related_content` sei „deliberately left out" —
das hatte ich eine Stunde später umgekehrt und nur in DIESER Datei nachgetragen.
Ein Changelog, der das Gegenteil des Codes sagt, ist schlimmer als keiner, weil
er begründet klingt.

**Ein echter Zielfehler.** `siblingCollectionId` war korrekt benannt — es war der
Ort, aus dem die Geschwister kamen — aber das ist nicht immer die Sammlung, um
die es geht. Das Werkzeug nimmt laut eigener Beschreibung „eine nodeId eines
Inhalts ODER einer Sammlung", und bei einer Sammlung ist
`virtual:primaryparent_nodeid` die Ebene DARÜBER. `get_related_content` auf
„Optik" meldete also die Registry von „Physik". Das Feld heißt jetzt
`registryCollectionId` und trägt die Regel statt der Herkunft: Sammlung als
Ausgangsknoten → sie selbst; Material → die Elternsammlung, und nur mit
`includeSiblings`.

**Zwei Beschreibungen, die Modelle in die Irre schicken.**
`search_wlo_within_collection` verwies für die freigegebenen Skills auf
`get_skill_registry` — die Antwort trägt sie inzwischen selbst; das ist genau der
Rundlauf, den `registryLines` im Code schon vermeidet. Und
`get_related_content` nannte seinen Parameter „`siblings`", er heißt
`includeSiblings` — ein Modell, das der Beschreibung folgt, bekommt keine
Geschwister. Letzteres war vorbestehend und ist mit erledigt.

Dazu: JSON-Abdeckung von `get_related_content` in den vorhandenen Test gezogen
(die Lücke, die eine Runde zuvor den schweren Befund durchgelassen hatte), und
der Doppeldurchlauf über den Sammlungsbaum zu einem zusammengefasst.

**Beim Gegenlesen zwei weitere veraltete Stellen gefunden**, beide aus dem
Deckel-Umbau: `SKILL-TRIGGER.md` führte in der Redaktions-Checkliste weiterhin
„(in der Suchliste 30)", und der CLAUDE.md-Block vom 2026-08-11 beschrieb die
zwei Stufen als geltend. Beide korrigiert bzw. als abgelöst markiert — die
Begründung von damals bleibt lesbar, weil sie erklärt, warum es die Stufen gab.

**Nachweis:** `npm test` → **1884 Tests, 1884 pass, 0 fail** (1883 + 1) ·
`npm run typecheck` → 0 · `npx eslint .` → 0 · `npm run build` → exit 0. Der
Test zum Sammlungs-Ausgangsknoten war vor der Änderung rot; die JSON-Zusicherung
ging sofort grün und belegt damit, was sie belegen soll — beide Zweige hängen
denselben Block im selben Ausdruck an.

**Angefasst:** `src/services/related.ts`, `src/tools/node-relations.ts`,
`src/tools/collections.ts`, `src/tools/browse.ts` ·
`tests/tools-registry-cache.test.ts` · `CHANGELOG.md`, `CLAUDE.md`,
`docs/SKILL-TRIGGER.md`, `docs/TOOLS.md`, diese Datei.

### Nachtrag 2026-08-16 — Ein Katalog sagt, dass er nicht die Anleitung ist

**Auftrag (Nutzer):** Jede ausgelieferte Skill-Übersicht bzw. Registry soll am
Schluss hartkodiert sagen, dass dies nur die Beschreibungen sind und die
Anweisungen mit `get_skill` über die nodeId geholt werden müssen — „prüfe wo dies
überall rein gearbeitet werden muss".

**Ein Satz, ein Ort.** `DESCRIPTIONS_ONLY_NOTE` in `formatter.ts`, neben
`registrySummaryLines` — dem Ort, der entscheidet, für welche Stufe er überhaupt
wahr ist. Zwei der drei Oberflächen trugen bereits einen eigenen Schlusszeiger
(„Lade die passende Anleitung mit get_skill und der nodeId"), zweimal geschrieben
und nur zufällig gleich; die dritte trug gar keinen. Gepinnt durch
`tests/shared-rule-discipline.test.ts`.

**Wo er landet (5 Stellen):** `registrySummaryLines` — damit Suchergebnisse,
`subjectRegistryText` (die Sammlung, auf der ein Werkzeug arbeitet),
`get_node_details`, Themenseiten; `get_skill_registry` Markdown und JSON;
`search_skill` Markdown und JSON. Im JSON als Feld `hint`, aus demselben Grund,
aus dem die Registry ihre Untrusted-Warnung in beiden Formaten führt.

**Wo er bewusst NICHT landet, und es ist dreimal derselbe Grund — dort steht
keine Skill-nodeId:** die Kopfzeilen-Stufe (`browse_collection_tree`,
`get_subject_portals`, `search_wlo_topic_pages`), eine Registry ohne auflösbare
Einträge, ein leerer `search_skill`-Katalog. Eine Liste, die einen Schritt
verspricht, den ihr eigener Inhalt nicht trägt, ist schlechter als eine, die
nichts verspricht. Dazu die Alternativen-Liste von `get_skill_for_task`: unter
`WLO_SKILL_TOOL_MODE=one-tool` ist `get_skill` nicht registriert, ein Zeiger
darauf ginge ins Leere. Und die HTML-Suchseite — ein Mensch im Browser ruft kein
Tool auf.

**Zwei Defekte fand erst das Rendern der echten Ausgabe, kein Test.** (1) Der
erste Entwurf nannte die Felder — „nur Titel und Beschreibungen" — und war damit
auf der Oberfläche falsch, die am meisten davon zeigt: der Katalog am Knoten
trägt absichtlich nur Titel und nodeId (Beschreibungen kosten einen Abruf pro
Skill), `get_skill_registry` trägt beides. Der Satz sagt jetzt, was die Liste
NICHT ist, und nie, was sie enthält. (2) Bündig links landete er zwischen der
letzten `  Skill:`-Zeile und dem `Typ:`-Feld des Datensatzes und las sich als
Aussage über den DATENSATZ; er ist jetzt mit den Einträgen eingerückt, die er
abschließt. Beides ist mit einer Zusicherung festgehalten.

**Nachweis:** `npm test` → **1893 Tests, 1893 pass, 0 fail** (1884 + 9) ·
typecheck → exit 0 · `npx eslint .` → exit 0 · `npm run build` → exit 0.
Fünf Zusicherungen vor der Umsetzung rot gesehen. Die drei Negativ-Tests
(Kopfzeilen-Stufe, leerer Katalog, `browse`) waren von Anfang an grün — sie
wurden per Mutation als tragend nachgewiesen: ohne die `if (shown.length)`-Bedingung
werden vier davon rot. Der Wächter in `shared-rule-discipline.test.ts` ist
ebenfalls vakuum-grün und wird es erst durch eine künftige Kopie rot.

**Nachtrag am selben Tag (Nutzer):** Der Satz nannte das Werkzeug, aber nicht,
WELCHE der sichtbaren Kennungen es nimmt. Im gerenderten Block stehen drei —
die der Sammlung, die des Registry-Dokuments, die des Skills — und die dem Satz
nächstgelegene ist die falsche. Er schließt jetzt mit „nicht mit der einer
Registry oder Sammlung". Unbestimmter Artikel, weil der Katalog von
`search_skill` weder das eine noch das andere führt: „der" zeigte dort auf
Dinge, die seine Antwort nicht enthält. Test vorher rot gesehen; er belegt
zuerst, dass alle drei Kennungen im Block stehen, und pinnt dann den Satz.

**Review desselben Pakets (2026-08-16), 3 Befunde, alle behoben.** Es war ein
Befund an zwei Stellen — und ausgerechnet die Regel, die diese Änderung selbst
aufstellt. Beide JSON-Zweige legten `hint` bedingungslos in die Antwort, während
das Markdown ihn korrekt zurückhielt. Bei `get_skill_registry` läuft der
JSON-Zweig sogar **vor** der `!registry`-Prüfung, also stand „das ist nur die
Übersicht" neben `registry: null`: eine Anleitung zum Laden aus einem Katalog,
den dieselbe Antwort verneint. Der dritte Befund erklärt die beiden — die
Positiv-Tests deckten beide Formate ab, die Negativ-Tests nur Markdown. Genau
diese Schieflage in der Abdeckung hat es unsichtbar gehalten; jetzt gibt es für
beide Werkzeuge einen JSON-Leerfall, beide vorher rot gesehen.

Beim Beheben geprüft und **kein** vierter Fix: die JSON-Ausgabe der Suchwerkzeuge
trägt den Satz nicht — das ist Konvention, kein Versehen. Prosa-Hinweise laufen
im Markdown-Zweig (`registryHintFor`), `renderToJson` trägt gar keine, und der
Umschlag sagt dasselbe über `registryChecked`, `licenseFilter`, `skillRegistry`.
Die zwei Skill-Werkzeuge bauen ihre Nutzlast von Hand — deshalb gehört `hint`
dorthin und sonst nirgends.

**Angefasst:** `src/formatter.ts`, `src/tools/skills.ts`,
`src/tools/skill-registry.ts` · `tests/formatter.test.ts`,
`tests/tools-skills.test.ts`, `tests/tools-skill-registry.test.ts`,
`tests/tools-registry-cache.test.ts`, `tests/shared-rule-discipline.test.ts` ·
`CHANGELOG.md`, `CLAUDE.md`, `docs/SKILL-TRIGGER.md`, `docs/TOOLS.md`, diese Datei.

### Nachtrag 2026-08-16 (2) — `get_skill` in JEDEM Modus registriert

**Auftrag (Nutzer):** den offenen Befund aus dem Review wie empfohlen beheben.

`WLO_SKILL_TOOL_MODE=one-tool` ersetzte `search_skill` UND `get_skill` durch
`get_skill_for_task`, das eine Aufgabenbeschreibung nimmt und keine nodeId.
Damit gab es in dem Modus kein Werkzeug mehr, das eine nodeId annimmt — während
`get_skill_registry` unbedingt registriert ist und GENAU eine Liste von nodeIds
ist, jedes Sammlungs-Ergebnis diese Liste mitträgt und die Antwort eines Skills
seine Verweise und Begleitdateien per id nennt. Die Freigabeliste war dort also
unbenutzbar. Der Schalter ersetzt jetzt die SUCHE, nie den Lader.

**Zwei Folgen, die der Fix mitnimmt.** (1) Die Werkzeugzahl bleibt bei 42, der
Tausch ist 1:1 — `docs/TOOLS.md` und `docs/INTEGRATION.md` sagten 41, und der
Zähltest konnte es nicht merken, weil er die Erwartung aus einem KOMMENTAR über
den Code ableitete (`names.length - 1`) statt aus dem Code. Er misst jetzt beide
Modi über `registerSkillTools`. (2) Eine Markdown-Begleitdatei wird wieder auf
`get_skill` gezeigt statt auf `get_wlo_content_text`: der Ausweichpfad lieferte
den Text-EXTRAKT des Repositories, während ein Skill die Datei wörtlich braucht.
`readerFor` nimmt keinen Modus mehr; das Argument ist aus den drei Funktionen
verschwunden, die es nur durchgereicht haben.

**Selbst verursachter Fehler, und er hat etwas Älteres freigelegt.** Ein
Python-Schreibvorgang stellte `.env.example` von LF auf CRLF um; der Parser in
`deploy-env-passthrough.test.ts` splittet auf `
` und prüft `[^
]*$`, also
matchte keine Zeile mehr und zwei Tests meldeten „die Einstellung fehlt". Der
Kommentar dort dokumentiert genau diese Falle als am 2026-08-10 behoben — die
Behebung wirkte nie: die Zeichenklasse kann das abschließende `
` nicht
schlucken, `$` matcht trotzdem nicht. Gemessen mit `node -e` (Muster → `null`).
Jetzt `split(/
?
/)`; belegt, indem die Datei absichtlich auf CRLF gesetzt
wurde — 8/8 grün — und danach auf LF zurück. Betrifft jede Windows-Bearbeitung
dieser Datei, nicht nur mein Versehen.

**Nachweis:** `npm test` → **1896 Tests, 1896 pass, 0 fail** · typecheck 0 ·
eslint 0 · build 0. Drei Zusicherungen vorher rot; zwei bestehende ändern
ausdrücklich ihren Vertrag (One-Tool nennt `get_skill` jetzt, statt es zu
verschweigen) und sind als CONTRACT CHANGED markiert.

**Angefasst:** `src/tools/skills.ts` · `tests/tools-skills.test.ts`,
`tests/docs-claims.test.ts`, `tests/deploy-env-passthrough.test.ts` ·
`.env.example`, `docs/TOOLS.md`, `docs/INTEGRATION.md`, `CHANGELOG.md`,
`CLAUDE.md`, diese Datei.

### 2026-08-17 — Live-Vertragstest Referenz/Original + Plan für das Schreibziel

**Gemessen (neu, `tests/live/reference-write.test.ts`, 4 Tests grün):** Ein
Metadaten-Schreibvorgang auf eine Sammlungs-Verknüpfung wird DORT gespeichert,
erreicht das Original nicht, und die Verknüpfung erbt danach nicht mehr — ein
stiller, dauerhafter Override, den `verifyWrite` nicht bemerkt, weil es denselben
Knoten zurückliest. Inhalts-Uploads verhalten sich umgekehrt und treffen ohnehin
das Original; ein Upload benennt den Datensatz NICHT um (`cm:name` bleibt — damit
ist das Risiko für die SKILL.md-Migration ausgeräumt).

**Das widerlegt den Projekt-Skill `wlo-collections-references`**, der
„verpufft STILLSCHWEIGEND (200 OK ohne Effekt)“ behauptet. Nicht ohne neue
Messung zurückdrehen.

**Ebenfalls gemessen:** eine Verknüpfung erkennt man am DTO-Feld `node.originalId`
(vorhanden = Verknüpfung); `ccm:original` zeigt beim Original auf sich selbst und
ist die Falle.

**`tests/live/guard.ts`** herausgezogen — der Staging-Wächter darf nicht in zwei
Dateien stehen.

**Nebenbefund, nicht behoben:** `npm run test:live` lief hier zum ersten Mal.
Test 6 (`write-contract.test.ts`, vorbestehend) ist rot — ein Timeout, keine
Ablehnung: `WLO_FETCH_TIMEOUT_MS` = 20 s, das Anlegen eines `ccm:wwwurl`-Datensatzes
braucht auf Staging 16,8 s. Trifft auch `wlo_create_content` im Alltag.

**Plan fertig, nicht begonnen:**
`docs/plans/2026-08-17-original-id-und-metadatenflaeche.md` — 6 Phasen, 18
Aufgaben, mit einem Abschnitt „Gemessene Fakten“ (F1–F9), damit er einen
Kontext-Reset übersteht. Phase 0 blockiert alles: was `wlo_delete_content` auf
eine Verknüpfung tut, ist ungemessen. Phase 3 blockiert Phase 4: dass es
`ccm:oeh_quality_*` überhaupt gibt, ist ANGENOMMEN und auf einem Datensatz mit 86
Properties nicht gefunden worden.

**Stand:** `npm test` → 1896 pass, 0 fail · `npm run test:live` → 5/6 (s. o.) ·
typecheck, eslint, build je exit 0.

### 2026-08-17 — Phase 0 des Schreibziel-Plans: Löschverhalten gemessen

Erledigt den Satz aus dem Abschnitt darüber („was `wlo_delete_content` auf eine
Verknüpfung tut, ist ungemessen"). **T0.1 und T0.2 abgeschlossen; Phase 1 ist
entsperrt.**

**Gemessen (Staging, `tests/live/reference-delete.test.ts`, grün):**
`deleteContentNode(referenceId)` meldet `ok`; die Verknüpfung antwortet danach
**404**, das Original **200** und ist lesbar. Ein Löschvorgang auf eine
Sammlungs-Verknüpfung trifft **nur die Verknüpfung**.

Drei Folgerungen, alle als **F10** im Plandokument:

1. **Kein Datenverlust** — die Dringlichkeit von Phase 1 bleibt, wie sie war.
2. **Die Auflösung darf nicht aufs Löschen angewandt werden.** Ein umgeleitetes
   `wlo_delete_content` würde aus dem heute harmlosen Verhalten genau den
   Datenverlust machen, nach dem diese Messung gesucht hat. `resolveWriteTarget`
   gehört ausschließlich in den Metadatenpfad.
3. **Die Meldung ist wahr über den Knoten und falsch über das Material.** Das
   Werkzeug meldet Erfolg, während der Datensatz unter eigener id und in jeder
   anderen Sammlung weiterlebt — faktisch ein `remove_from_collection` mit dem
   Wort „gelöscht". T2.3 wurde um diesen Satz erweitert.

Der Test wurde bewusst **zweistufig** geschrieben: erst eine Fassung, die beide
Knoten ausliest und das Ergebnis nur meldet, dann die Zusicherungen und der Name
nach dem gemessenen Ergebnis. Die Erwartung war offen — eine zuerst geschriebene
Zusicherung hätte festgehalten, was ich vermutet habe, nicht was das Repository
tut.

**`tests/live/fixtures.ts` herausgezogen** (`withReference`, `markdownFile`) —
zweiter Verbraucher, dieselbe Begründung wie bei `guard.ts` am Vortag: ein
Fixture, das echte Datensätze auf Staging anlegt und wieder aufräumt, darf nicht
in zwei Fassungen existieren. Was eine Kopie verliert, ist kein roter Test,
sondern Müll in Staging, den niemand zuordnen kann. Die Extraktion wurde vor der
neuen Messung durch einen eigenen Lauf als verhaltensgleich belegt (unverändert
5/6).

**Stand:** `npm test` → 1896 pass, 0 fail · `npm run test:live` → **7 Tests,
6 pass, 1 fail** — derselbe vorbestehende F7-Timeout, jetzt als Test 7 gezählt ·
typecheck, eslint je exit 0.

### 2026-08-17 — Phase 1: Metadaten-Schreibvorgänge treffen das Original

`resolveWriteTarget` (`services/write/nodes.ts`) leitet einen Metadaten-Write von
einer Sammlungs-Verknüpfung auf das Original um; die Umleitung steht **in** der
Änderungsmenge, wird in der Vorschau als erste Zeile genannt und der
Bestätigungsschlüssel bindet daran. Verdrahtet in `wlo_update_content`,
`wlo_update_compendium` und `wlo_decide_suggestion`.

**Drei Abweichungen vom Entwurf, alle im Plandokument begründet.** (1) Die
Funktion ist **synchron** und nimmt den bereits gelesenen Knoten — jeder
Schreibpfad liest den Datensatz ohnehin, und ein zweiter Abruf könnte dem ersten
widersprechen, aus dem die bestätigte Vorschau stammt. Damit entfällt der
einzige nicht-funktionale Preis des Entwurfs. (2) Die Auflösung sitzt an den
Werkzeug-Einstiegen, **nicht** in `updateNodeMetadata`: der Schlüssel bindet an
die Vorschau, also muss das Ziel feststehen, bevor geschrieben wird — eine
Auflösung im Schreibaufruf fände ein zweites Mal statt und könnte vom bestätigten
Ziel abweichen. (3) `verifyWrite` hat seinen `nodeId`-Parameter **verloren** und
liest `cs.nodeId`; alle vier Aufrufstellen übergaben ohnehin denselben Wert, und
mit Umleitung wäre genau dieser Parameter die Stelle, an der still gegen den
genannten statt den geschriebenen Knoten geprüft würde.

**Zwei Wächter, beide durch injizierte Verletzung rot gesehen** (jeweils mit
Datei und Zeile in der Fehlermeldung): `originalId`/`ccm:original` darf im
Schreibpfad nur in `nodes.ts` und `collections.ts` gelesen werden (die
Lesepfade brauchen das Feld weiterhin, deshalb ist der Wächter auf
`services/write/` + `tools/curation-*.ts` beschränkt), und ein Kuratier-Werkzeug
übergibt `updateNodeMetadata` ausschließlich `cs.nodeId`.

**Bewusst nicht geändert:** `wlo_rename_collection` (Collections-REST-API) und
`wlo_submit_content` (Workflow-Endpunkt) schreiben über andere Endpunkte, deren
Verhalten bei Verknüpfungen ungemessen ist. `wlo_update_compendium` wurde
einbezogen, weil die Auflösung dort nur greift, wenn das Repository den Knoten
selbst als Verknüpfung ausweist, und weil die Alternative der stille Override
ohne Anzeige wäre.

**Nebenbefund für T2.3:** die Beschreibung von `wlo_delete_content` behauptet, das
Werkzeug „zerstört das Material für alle Sammlungen, in denen es vorkommt". Über
eine Verknüpfungs-id ist das nach F10 falsch.

**Stand:** `npm test` → **1907 pass, 0 fail** · `npm run test:live` → **8/8** ·
typecheck, eslint je exit 0. Der F7-Timeout lief diesmal knapp durch und ist
damit nicht behoben, nur nicht getroffen.

### 2026-08-17 — Phase 2: Ergebnisse sagen, wenn eine nodeId eine Verknüpfung ist

Jeder Trefferknoten trägt jetzt `originalId` — **genau dann**, wenn er eine
Verknüpfung ist. Im Text als `nodeId: … (Verknüpfung; Original: …)`, als Feld in
`structuredContent`. Bisher sagte keine Ausgabe das: eine Aufruferin konnte
nicht erkennen, dass die erhaltene id nicht der Datensatz ist, und hatte keinen
Weg zu der, die es ist.

**Abweichung vom Entwurf:** das Feld fehlt am Original, statt gleich `nodeId` zu
sein — so hält es das Repository-DTO selbst. Damit bleibt jede bestehende
Antwort unverändert und das Feld steht dort, wo es etwas aussagt. Die Textzeile
entsteht in `nodeIdLine` (`formatter.ts`), geteilt mit den Skill-Werkzeugen, die
diesen Satz seit langem rendern; zwei Formulierungen für dieselbe Tatsache wären
dem Aufrufer nicht zuzumuten. `formattedNodeSchema` bekam das Feld in einer
**eigenen** Aufgabe mit eigener Zusicherung: zod verwirft Unbekanntes, ein Feld
kann den Text erreichen und aus `structuredContent` verschwinden, ohne dass
irgendetwas fehlschlägt.

**Die Beschreibung von `wlo_delete_content` war nachweislich falsch** („zerstört
das Material für alle Sammlungen, in denen es vorkommt") — wahr über eine
Datensatz-id, falsch über eine Verknüpfungs-id, und letztere ist das, was
Sammlungslisten liefern. Beschreibung korrigiert; zusätzlich sagt die **Vorschau**
jetzt, welcher der beiden Fälle vorliegt, und nennt den Datensatz, der bleibt.
Sie hatte den Knoten ohnehin gelesen — es war der einzige Satz, den jemand vor
einem unumkehrbaren Schritt liest, und er war falsch.

**Der Wächter aus P1 hat dabei gearbeitet:** der erste Entwurf las
`node.originalId` direkt in `curation-delete.ts` und fiel auf. Jetzt geht die
Frage „ist das eine Verknüpfung" durch `resolveWriteTarget` — dieselbe Funktion
wie im Schreibpfad, hier ausschließlich zum Beschreiben. Ein zweiter Lauf war
ein **Fehlalarm der eigenen Benennung** (ein Parameter hieß `originalId`); er
heißt jetzt `recordId`, was an der Stelle ohnehin der treffendere Name ist —
gemeint ist der Datensatz, der die Löschung überlebt.

**Stand:** `npm test` → **1916 pass, 0 fail** · typecheck, eslint je exit 0.

### 2026-08-17 — Phase 3: die Metadatenfläche gemessen, und sie ist kleiner als gedacht

`npm run survey:metadata` (`scripts/survey-metadata.mjs`) fragt eine echte
Instanz, welche Felder sie in drei Bereichen anbietet und wie der Korpus sie
füllt. Zwei Beine, weil keines die Frage des anderen beantwortet: der volle
Metadatensatz (17,3 MB, **1,0 s** — die Warnung im Skill gilt der Größe, nicht
der Latenz) sagt, welche Felder es gibt und welches ein Vokabular hat; eine
Facette je Feld sagt, ob jemand sie pflegt. Meldet und schreibt nie, Muster
`sync-vocabs.mjs`. Ergebnis: `docs/plans/2026-08-17-metadatenfelder-erhebung.md`.

**F9 ist beantwortet: `ccm:oeh_quality_*` gibt es, 14 Felder.** F9 bleibt trotzdem
richtig — die vier Rechtsprüfungs-Felder tragen 80–86 Belegungen bei **590 186**
Datensätzen, und ein Feld, das fast niemand pflegt, fehlt auf einem beliebigen
Datensatz.

**Der Befund, der Phase 4 zusammenstreicht:** bei **11 der 14** Qualitätsfelder
liegen die gespeicherten Werte teils oder ganz außerhalb des Vokabulars, das
dasselbe Feld deklariert — und es ist kein Müll, sondern **dieselbe Skala in
zwei Schreibweisen**, URI und nackte Ziffer, nebeneinander im selben Feld.
`ccm:oeh_quality_correctness` deklariert das Befund-Vokabular
(`no_human_findings` …) und speichert zu **100 %** Sternebewertungen; das Feld
hat die Bedeutung gewechselt und die Altdaten sind nie migriert worden.
`ccm:oeh_quality_protection_of_minors` ist mit 3 432 Belegungen das bestgefüllte
Prüffeld — davon sind 3 389 die nackte `"0"`, in einem Befund-Vokabular ohne
numerische Mitglieder ein Wert ohne jede Bedeutung.

Das ist ein **zweiter, unabhängiger** Grund gegen das Schreiben: er gilt auch für
jemanden, der das Prüfsiegel-Argument des Entwurfs nicht teilt. Und er trifft
zusätzlich das *Lesen* — ein Feld, dessen Inhalt wir nicht beschriften können,
reicht `"0"` an ein Modell weiter.

Übrig bleiben **drei Felder statt dreier Feldgruppen**, alle vokabular-rein, alle
nur lesend: `ccm:conditionsOfAccess` (198 699), `ccm:accessibilitySummary`
(3 475), `ccm:license_oer` (1 121). `QUALITY_PROPS` entfällt, **T4.3 entfällt**.
`ccm:oeh_quality_login` ist das einzige saubere Qualitätsfeld und wird trotzdem
nicht gelesen: `ccm:conditionsOfAccess` sagt dieselbe Sache dreiwertig und auf
mehr als der doppelten Datenmenge.

**Zwei Nebenbefunde am Facetten-Pfad, nicht behoben** (§7 des Messdokuments,
sie betreffen `services/license-search.ts`):

1. **`facetLimit` ist keine Bucket-Obergrenze.** `wlo-search.ts` dokumentiert
   `FACET_LIMIT = 20` als „how many buckets a facet aggregation may return";
   gemessen liefert der Server bei Limit 20 **47** Buckets für `ccm:license_to`
   und bei Limit 5 noch 25. Ab 20 sättigt die Antwort (100/1 000/10 000 gleich).
   Damit ist `buckets.length >= FACET_LIMIT` kein Abschneide-Test: er schlägt bei
   einer vollständigen Liste von 23 an und schwiege bei einer echt
   abgeschnittenen von 18. Zusatz: **`facetMinCount` ist erforderlich** — ohne
   ihn null Buckets, unabhängig vom Limit.
2. **Staging hält 23 Lizenzschlüssel, nicht die gepinnten 16.** Der Kommentar
   „Staging holds 16, so this does not fire there" stimmt nicht mehr. Sechs der
   sieben neuen sind **Freitext im Lizenzfeld** (ein Copyright-Vermerk, ein
   Firmenname, ein ganzer UrhG-Satz), zusammen 15 nicht auflösbare Datensätze —
   für die Filterung bedeutungslos, aber die Ursache dafür, dass die Bucket-Zahl
   über 20 gestiegen ist und (1) praktisch greift.

**Stand:** unverändert `npm test` → **1916 pass, 0 fail** · typecheck, eslint je
exit 0 — Phase 3 hat kein Laufzeitverhalten angefasst. Der Nachweis ist die
Skriptausgabe (7–8 s, drei Läufe) und das Messdokument.

### 2026-08-17 — Phase 4: drei Felder statt einer Fläche, plus drei Reparaturen

**`includeAccessInfo`** an `get_node_details` und `get_nodes_details`, in beiden
Ausgabeformaten: **Zugang** (Login nötig?), **Barrierefreiheit** (A/AA/AAA,
BITV, WCAG) und **OER-Status**. Standardmäßig aus; die Ausgabe ohne den Parameter
enthält keine der drei Zeilen, und das ist zugesichert.

**T4.1 hat sich in Luft aufgelöst, und zwar durch Messen statt durch Bauen.**
Der Plan sah Property-Gruppen in `wlo-config.ts` und ein `vocabs-quality.ts` für
die Label-Auflösung vor. Beides ist überflüssig:

1. **Das Repository beschriftet alle drei Felder selbst** —
   `ccm:accessibilitySummary_DISPLAYNAME = ["A (am niedrigsten)"]`,
   `ccm:license_oer_DISPLAYNAME = ["kein OER"]`,
   `ccm:conditionsOfAccess_DISPLAYNAME = ["ohne Anmeldung"]`, an echten
   Datensätzen belegt. Dieselbe Quelle, die `formatter.ts` für die
   Vokabularfelder ohnehin bevorzugt. Eine eigene Tabelle wäre eine dritte
   gewesen, die mit einer Instanz Schritt halten muss.
2. **Die Felder sind schon da:** die Detail-Werkzeuge lesen `-all-`. Eine
   Property-Gruppe hätte nichts verengt und nichts geholt — `includeAccessInfo`
   kostet deshalb **keinen** zusätzlichen Abruf.

`src/node-access.ts` hält, was die Felder sind; die Werkzeuge halten Schema und
Verdrahtung. **T4.3 (Schreibfläche) entfällt** wie in Phase 3 begründet.

**Neu gemessen:** alle drei Felder antworten als ngsearch-**Kriterium** mit
HTTP 400 — ablesbar, aber nicht suchbar. „Zeig mir Material ohne Login" gibt es
nicht, und das steht jetzt in der Doku. Derselbe 400 verhinderte auch die
Messung, ob `ccm:license_oer` etwas sagt, das die Lizenz nicht schon sagt; das
Feld ist dabei, weil opt-in niemanden etwas kostet, und die Unmessbarkeit steht
im Code statt in einer Behauptung.

**Drei Reparaturen in derselben Sitzung.**

1. **`FACET_BUCKET_MAX` — `facetLimit` ist keine Bucket-Obergrenze.** Gemessen an
   `ccm:taxonid` über sechs Punkte, jedes Mal exakt **5 × Limit**: 1→5, 2→10,
   10→50, 50→250, 80→376 (= alle Werte, die es gibt). `license-search.ts` prüfte
   auf `buckets.length >= FACET_LIMIT` und verwarf damit eine **vollständige**
   Zählung als „vielleicht gekürzt", sobald der Korpus mehr als 20 Lizenzen
   führt — er führt 23. Auf jeder breiten Lizenzsuche fiel die Antwort auf die
   Familien-Gesamtzahl zurück, die dasselbe Modul als um 98–164 % zu hoch
   dokumentiert. Die Grenze ist jetzt eine eigene Konstante; `FACET_LIMIT` bleibt
   20, weil es die nutzersichtbare Facettenausgabe bemisst (auf 100 gehoben
   wüchse die `ccm:taxonid`-Facette von 100 auf 376 Eimer).
2. **Der Lizenz-Korpus-Pin** stand auf der Messung vom 2026-08-12 (16 Schlüssel);
   es sind 23. Die sieben neuen sind überwiegend **Freitext im Lizenzfeld** — ein
   Firmenname (11 Datensätze), ein Copyright-Vermerk, ein ganzer UrhG-Satz,
   `OTHER`. Die Datei führt jetzt zwei Listen: was auflösen MUSS und was
   unaufgelöst bleiben MUSS. Der zweite Test ist der wichtigere: eine Lizenz zu
   erfinden, wo der Datensatz keine nennt, sagt einer Leserin, sie dürfe
   nachnutzen. Dass `OTHER` keine Lizenz ist, ist nicht geraten —
   `LICENSE.NAMES` ist die Liste des Repositories und führt 15 Schlüssel, ohne
   `OTHER`.
3. **Zwei `nodeId:`-Zeilen aus Phase 2 übersehen.** `get_node_details` — das
   Werkzeug, dem eine Verknüpfungs-id am ehesten übergeben wird — und die
   Fachportal-Liste bauen ihre Zeile von Hand und sagten deshalb nicht, dass eine
   id eine Verknüpfung ist, während `structuredContent` es die ganze Zeit trug.
   Genau die Spaltung, gegen die das Feld eingeführt wurde. Beide gehen jetzt
   durch `nodeIdLine`, und ein Wächter in `tests/shared-rule-discipline.test.ts`
   fängt handgebaute Zeilen (durch eingebaute Verletzung rot gesehen). Die eine
   erlaubte Ausnahme ist `skill-registry.ts`: ein Registry-Eintrag stammt aus
   einem `:::`-Block, nicht aus einem Knoten-Abruf, hat also keine `originalId`.

**Stand:** `npm test` → **1932 pass, 0 fail** · typecheck, eslint je exit 0.
Zusätzlich live gegen Staging: die Projektion an drei echten Datensätzen mit
jeweils anderer Teilmenge der Felder.

### 2026-08-17 — Phase 5: die widerlegte Messung im Nutzer-Skill korrigiert

`wlo-collections-references` behauptete, ein Metadaten-Schreibvorgang auf eine
Sammlungs-Verknüpfung „verpuffe STILLSCHWEIGEND (200 OK ohne Effekt)". Die
Live-Messung vom 2026-08-16 widerlegt das: der Wert wird auf der **Verknüpfung
gespeichert**, erreicht das Original nie, und die Verknüpfung erbt dieses Feld
danach nicht mehr. Kein verworfener Schreibvorgang, sondern ein stiller,
dauerhafter Override — und der braucht die entgegengesetzte Reparatur.

Korrigiert in der Konvention des Skills selbst (`⚠ Korrektur (Datum)`, dort
schon einmal am 2026-08-01 benutzt), mit Datum der Korrektur **und** der Messung,
weil beides auseinanderfällt.

**An zwei Stellen, und das ist der eigentliche Befund.** Dieselbe Falschaussage
stand ein zweites Mal als **Nummer 1 in der „Häufige Fallen"-Liste** — die
Stelle, die jemand im Zweifel zuerst liest. Nur die im Plan genannte zu
korrigieren hätte die wirksamere Fassung stehen lassen. Eine widerlegte Aussage
zu korrigieren heißt, nach allen ihren Fassungen zu suchen, nicht nach der einen,
die jemand notiert hat.

Mit korrigiert, weil im selben Abschnitt und aus derselben Messreihe:

- die Vererbungszusage in Falle 7 — sie gilt **nicht** für ein Feld, das schon
  einmal direkt auf die Verknüpfung geschrieben wurde;
- die Kommentare im „Praktische Konsequenz"-Beispiel, die behaupteten, ein GET
  nach dem falschen Schreibvorgang zeige den alten Wert (er zeigt den neuen);
- `node.originalId` ist am Original `undefined`, und die **Property**
  `ccm:original` taugt nicht als Signal, weil sie beim Original auf sich selbst
  zeigt;
- die Gegenrichtung für Inhalte: ein **Upload** auf eine Verknüpfungs-ID landet am
  Original, und ein Dateiaustausch benennt den Datensatz nicht um (`cm:name`
  bleibt). Die Asymmetrie ist der Grund, warum „schreibt auf das Original" keine
  Aussage über den Knoten ist, sondern über das jeweilige Feld.

`docs/` brauchte keine Korrektur: die Fundstellen im Repo benennen die Aussage
bereits als widerlegt.

**Stand:** `npm test` → **1932 pass, 0 fail**. `npm run test:live` → **8 Tests**;
ein Lauf 7/8, der Wiederholungslauf 8/8. Der Ausreißer ist der Vertragstest, der
beim Durchlaufen 24,4 s braucht — das ist der bekannte **F7**-Zeitrand
(`WLO_FETCH_TIMEOUT_MS` = 20 000 ms gegen ein `ccm:wwwurl`-Anlegen von ~16,8 s auf
Staging), vorbestehend und außerhalb dieses Plans. Die Fehlermeldung des ersten
Laufs ist nicht mitgeschnitten worden, der Zusammenhang ist also plausibel und
nicht belegt.

**Damit ist der Plan `2026-08-17-original-id-und-metadatenflaeche.md`
vollständig: P0–P5 erledigt.**

### 2026-08-17 — Review des Plans: ein MAJOR-Befund, behoben

Der Review nach P5 hat einen Fehler gefunden, den vier Phasen und der Live-Lauf
nicht gefunden haben: **die Änderungsmenge verglich gegen den genannten Knoten,
geschrieben wurde auf den aufgelösten.** Alle drei Metadaten-Werkzeuge gaben
`before` aus dem angefragten Knoten in `buildChangeSet(target.targetId, …)`.

Solange eine Verknüpfung erbt, sind beide Stände identisch — deshalb war nichts
zu sehen, in keinem Test und in keinem Live-Lauf. Sie laufen genau dann
auseinander, wenn die Verknüpfung schon einmal direkt beschrieben wurde: der
Zustand, den ältere Fassungen genau dieser Werkzeuge erzeugt haben.

Dann kostet es dreifach:

1. Ein Feld gilt als **unverändert**, weil die VERKNÜPFUNG den Wunschwert schon
   zeigt (`change-set.ts`, `sameValues`). Das Original bekommt ihn nie, gemeldet
   wird Erfolg. Bei `wlo_decide_suggestion` führt das direkt in den Zweig „stand
   schon so drin" und markiert den Vorschlag **ACCEPTED über einen Datensatz,
   der den Wert nie erhalten hat** — genau das, was die Reihenfolge
   schreiben→zurücklesen→markieren verhindern soll.
2. Die Vorschau zeigt als „vorher" den Wert der Verknüpfung. Bestätigt wird ein
   Diff, der einen anderen Datensatz beschreibt.
3. **Datenverlust bei Schlagworten:** `cclom:general_keyword` ist ein
   MERGED_PROPERTY. Der Merge lief gegen die Liste der Verknüpfung, das Ergebnis
   ersetzte die des Originals. Original [A,B,C], Verknüpfung [A] → Original wird
   [A, neu]; B und C sind weg.

**Behoben:** `readWriteBaseline` (`services/write/nodes.ts`) liefert Ziel **und**
Vergleichsstand zusammen; die drei Werkzeuge rufen es statt `resolveWriteTarget`.
Der Zusatzabruf fällt nur bei Umleitung an. Ein nicht lesbares Original
**verweigert** — der Rückfall auf die Verknüpfung wäre der eigentliche Fehler,
weil er wie ein normaler Vergleich aussähe. Nicht angefasst: der Ablehn-Pfad in
`wlo_decide_suggestion` (schreibt keine Metadaten), `wlo_submit_content` und das
Löschen (beide bewusst ohne Auflösung).

**Der Test, der die Umleitung prüfte, enthielt die Prämisse des Fehlers.** Sein
Fixture gab dem Original genau den Titel, den der Aufruf setzt — unter der
korrigierten Regel ein No-op. Die alten Zusicherungen gingen nur durch, weil
gegen die Verknüpfung verglichen wurde. Fixture korrigiert (zwei verschiedene
Titel, wie eine überschriebene Verknüpfung wirklich aussieht) und um die
fehlende Zusicherung ergänzt: der Vorher-Wert stammt vom Original.

Dritter Wächter in `tests/shared-rule-discipline.test.ts` — durch eingebaute
Verletzung rot gesehen, nennt Datei und Grund. Dazu der NIT aus dem Review: die
Reichweite des `nodeId`-Wächters (nur Template-Literale, nur die eigenständige
Zeile) steht jetzt in seinem Kommentar, damit ein grüner Lauf nicht mehr
verspricht, als er prüft.

**Stand:** `npm test` → **1936 pass, 0 fail** · `npm run test:live` → **8/8** ·
typecheck, eslint je exit 0.

### 2026-08-17 — Offene Punkte: F7 behoben, die zwei originalIdOf-Kopien geklärt

**F7 war ungenau beschrieben, und das Aufschlüsseln hat die Reparatur verändert.**
In den Notizen stand „Anlegen braucht 16,8 s gegen 20 s Grenze". `createContentNode`
sind aber **drei** Anfragen, und das Timeout gilt je Anfrage — 16,8 s verteilt auf
drei wäre kein Timeout-Problem gewesen. Mit einer Aufrufspur gemessen:

```
 1.2 s  POST /search/v1/queries/…/ngsearch     (Dublettenprüfung)
18.6 s  POST /node/v1/nodes/-home-/-userhome-/children
 0.5 s  PUT  /node/v1/nodes/-home-/…/metadata
```

Ein **einzelner** Aufruf bei 93 % des Budgets; über vier Läufe 12,2 / 15,7 /
16,6 / 18,6 s. (Warum, war damit noch offen — die Erklärung „das Repository
erschließt die URL" ist am selben Tag widerlegt worden, siehe unten.)

Damit ist es kein Test-Artefakt: ein Abbruch meldet **Fehlschlag für Arbeit, die
das Repository zu Ende bringt** — und ein Wiederholungsversuch legt einen zweiten
Datensatz an. `CREATE_NODE_TIMEOUT_MS = 25_000` gilt nur für diesen Aufruf.

Zwei Grenzen, die die Zahl bestimmen: nach oben `httpServer.requestTimeout =
30_000` in `http.ts` — ein größeres Budget verschöbe den Abbruch nur von uns zum
Client, der dann gar nichts sieht; nach unten die Einstellung des Betreibers, die
`Math.max` nicht unterläuft (wer `WLO_FETCH_TIMEOUT_MS` hochsetzt, meint diesen
Aufruf erst recht).

**Wächter, weil das Verhalten an der Naht nicht prüfbar ist:** `wloFetch` hängt
selbst ein Signal an, wenn der Aufrufer keins mitgibt — im Fetch-Mock sehen beide
Pfade gleich aus. Der Wächter liest deshalb die Quelle und fällt um, wenn die
`signal:`-Zeile verschwindet (durch Entfernen rot gesehen).

**Die zwei `originalIdOf`-Kopien sind beide korrekt** — jetzt gemessen statt
begründet. `ccm:original` ist ein **blanker UUID**, kein Store-Ref (6/6 Sätze:
3 Originale, 3 Verknüpfungen), und am Original zeigt es auf sich selbst, während
das DTO-Feld `undefined` ist (bestätigt F6). Damit ist `node-collections.ts`
richtig, das den Wert roh als Knoten-id nimmt, und das `stripStoreRef` in
`skill-files.ts` ist dort ein No-op.

**Nicht vereinheitlicht, und das ist die Entscheidung:** beide sind Lesepfade;
sie auf `services/write/nodes.ts` zu ziehen hieße, einen Lesepfad auf den
Schreibpfad zeigen zu lassen. Stattdessen steht in `skill-files.ts` jetzt, warum
die Property-Lesart dort trägt (der Selbstvergleich an der Aufrufstelle) und
warum der Strip bleibt (das Repository benutzt Store-Refs anderswo sehr wohl,
`ccm:page_config`).

**Stand:** `npm test` → **1939 pass, 0 fail** · `npm run test:live` → **8/8** ·
typecheck, eslint je exit 0.

### 2026-08-17 — Nachtrag: die Decke, die es nicht gibt (25 s → 30 s)

Auf die Frage, ob 20 auf 30 Sekunden gehen soll, habe ich zuerst die Grenze
geprüft, mit der ich am selben Tag die 25 s begründet hatte — und sie war falsch.

**Gemessen:** ein `node:http`-Server mit `requestTimeout = 30_000` und einem
Handler, der nach **35 s** antwortet, liefert die Antwort aus (HTTP 200).
`httpServer.requestTimeout` begrenzt das **Empfangen** einer Anfrage
(Slow-Body/Slow-Header), nicht die Arbeit daran. Der Kommentar an der Einstellung
in `http.ts` sagt das ausdrücklich, und die langlebigen SSE-Antworten dieses
Servers wären sonst nach 30 s tot.

Der Irrtum saß schon länger im Code und hatte dort **Entwürfe begründet**:
`tools/node-details.ts` (`TEXT_ENRICH_MAX`), `services/collection-traversal.ts`
(`RECURSIVE_VISIT_MAX`) und ein Testkommentar. Meine 25 s waren der vierte Fall —
ich hatte die Behauptung beim Lesen übernommen, statt sie zu prüfen. Die Deckel
selbst bleiben richtig, aber jetzt aus dem messbaren Grund: was der Aufruf
kostet (50 Volltexte ≈ 23 s im Median, ≈ 46 s im Maximum), nicht eine Frist, die
es nicht gibt. **Was das Warten wirklich begrenzt, sitzt beim Client und ist von
hier aus unsichtbar.**

**Entschieden:**

- `CREATE_NODE_TIMEOUT_MS` **25 000 → 30 000** — 1,6× über dem langsamsten
  gemessenen Aufruf (18,6 s) statt 1,3×. Die Zahl hängt jetzt an der Messung,
  und der Test sagt das auch so: er prüft gegen `SLOWEST_MEASURED_MS`, nicht
  gegen eine Serverschranke.
- **`WLO_FETCH_TIMEOUT_MS` bleibt bei 20 000.** Das globale Limit auf 30 s zu
  heben bringt nichts Messbares: außer dem Anlegen liegt jeder gemessene Aufruf
  unter 3 s (Suche 0,5–2,4 s, Knoten lesen 0,3–0,4 s, Metadaten 0,5–0,9 s), und
  der Volltext hat längst sein eigenes, größeres Budget. Es kostet aber etwas —
  ein hängender Socket blockiert den Werkzeugaufruf dann 50 % länger, und genau
  dagegen existiert das Limit. Das eine Werkzeug, das mehr braucht, hat sein
  eigenes Budget.

**Lehre, die über diesen Fall hinausgeht:** eine Zahl im Code, die als
Begründung zitiert wird, ist keine Messung. Diese hier ist durch vier Stellen
gewandert, bevor jemand sie ausprobiert hat — und das Ausprobieren kostete 35
Sekunden.

**Stand:** `npm test` → **1940 pass, 0 fail** · typecheck, eslint je exit 0.

### 2026-08-17 — Warum das Anlegen 15–20 s braucht: die Ursache liegt woanders als gedacht

Auf die Frage „bei edu-sharing dauert das Anlegen sonst 2–3 s — wo geht die Zeit
verloren?" habe ich gemessen statt erklärt. Meine bisherige Antwort („das
Repository erschließt die URL") war eine **Annahme, als Tatsache formuliert**,
und sie ist widerlegt.

**Je eine Variable geändert, gemessen wird nur der `children`-POST:**

| Variante | Zeit |
|---|---|
| heutiger Aufruf (URL + Beschreibung + Keyword + linktype) | 20,3 s |
| **ohne `ccm:wwwurl`** (stattdessen `cm:name`) | **1,1 s** |
| nur `ccm:wwwurl`, sonst nichts | 13,5 s |
| `renameIfExists=false` | 14,8 s |
| ohne `versionComment` | 17,5 s |
| ohne `ccm:linktype` | 22,1 s |
| URL auf eine Domain, die es nicht gibt | 15,8 s |

**Nur `ccm:wwwurl` zählt.** Alles andere ist Rauschen.

**Was es NICHT ist** — vier Erklärungen, jede einzeln ausgeschlossen:

1. *Die Seite wird geladen.* Nein: eine nicht existierende Domain kostet 13,1 s,
   eine erreichbare 19,5 s, ein sofort abgelehnter Port 17,5 s. Die Zeit hängt
   nicht am Ziel.
2. *Es wird etwas aus der Seite gelesen.* Nein: der Titel des Knotens ist die
   **URL-Zeichenkette** (`example.org/a-1786…`), nicht der Seitentitel
   („Example Domain").
3. *Es wird auf den Suchindex gewartet.* Nein: der Knoten ist erst **11,4 s
   nach** dem Anlegen auffindbar.
4. *Es entsteht Metadatenarbeit.* Nein: der Property-Vergleich mit einem
   Knoten ohne URL zeigt genau **zwei** zusätzliche Properties — `ccm:wwwurl`
   selbst und der aus ihm abgeleitete `cclom:title`.

**Was es ist:** eine serverseitige Arbeit mit **Wartekonkurrenz**. Drei
gleichzeitige Anlegevorgänge: 20,1 / 39,2 / 39,2 s bei 39,2 s Wanduhr — sie
machen sich gegenseitig langsamer. (Die automatische Einordnung im Messskript
schrieb „PARALLEL"; die Schwelle war falsch gewählt, die Zahlen sagen das
Gegenteil. Notiert, weil eine Skript-Einordnung keine Messung ist.) Was genau
dort wartet, ist von außen nicht sichtbar.

**Der verwertbare Teil: es liegt daran, DASS die URL im Anlege-Body steht.**

| | heute | URL erst danach setzen |
|---|---|---|
| Anlegen | 14,7–21,0 s | **0,6 s** |
| URL setzen (`PUT …/metadata`) | — | **1,1 s** |
| **zusammen** | **~21 s** | **~1,7 s** |
| `ccm:wwwurl` | gesetzt | gesetzt |
| `virtual:mediatype` | Website | **Website** |
| `mimetype` | null | **null** |
| `cm:name` | `example.org_m1-…` (Repository) | `m3-…` (von uns) |

Bedingung: das mitgesendete `cm:name` darf **keine Dateiendung** tragen — mit
`.txt` wird der Knoten als „Textdatei" geführt, ohne Endung als „Website". Ganz
ohne `cm:name` lehnt das Repository das Anlegen ab.

**Damit ist ein Faktor 10 verfügbar**, ohne dass sich am Ergebnis etwas ändert
außer `cm:name`. Nicht umgesetzt — das ändert, was für jeden künftigen Datensatz
im Katalog steht, und ist eine Entscheidung der Betreiberin, keine Reparatur.

Die widerlegte Erklärung ist an sechs Stellen korrigiert (Code, Test, Plan,
STATUS, CLAUDE.md, CHANGELOG).

### 2026-08-17 — Korrektur: es IST ein Rendering-Dienst, und der schnelle Weg spart nichts

Der Hinweis „vermutlich werden Screenshots gemacht" war richtig, und meine
Gegenmessung von vorhin war an zwei Punkten falsch.

**Was der Aufruf kauft:** der Datensatz trägt danach eine **echte Vorschau** —
`preview.isIcon=false`, ein JPEG von ~50 kB — statt des SVG-Platzhalters
(1 kB, `isIcon=true`). Mein Property-Vergleich hatte das nicht gesehen, weil ein
Bild keine Property ist. Es steckt im `preview`-Objekt des DTOs und hinter einer
eigenen URL.

**Korrektur 1 — das Ziel ist NICHT egal.** `planet-schule.de` kostete beim
ersten Mal **46,5 s**, danach 8,8 s. Die Vorschau ist **je Adresse
zwischengespeichert**: ein zweiter Datensatz zur selben URL bekommt
byte-identische Bilder, und ein `/preview`-Abruf kostet 0,3 s. Meine früheren
Messungen benutzten jedes Mal eine neue Einweg-URL, waren also alle
Cache-Fehlschläge — daher der scheinbar konstante Sockel von 13–22 s.

**Korrektur 2 — der „Faktor 10" existiert nicht.** Gleiche URL, gleicher Lauf:

| | |
|---|---|
| anlegen MIT URL | **8,8 s** |
| anlegen ohne URL | 0,5 s |
| URL danach setzen (`PUT …/metadata`) | **7,8 s** |

Die Arbeit **wandert mit der Eigenschaft**. Mein voriger Vergleich stellte ein
kaltes Anlegen einem warmen Nachsetzen gegenüber, aus verschiedenen Läufen — ein
Vergleich, der nichts misst. Der Ratschlag, `ccm:wwwurl` aus dem Anlege-Body zu
nehmen, ist damit gegenstandslos: er verschiebt die Wartezeit um einen Aufruf.

**Was daraus folgte:**

1. **Ein ungedeckter Pfad.** Die Grenze gehört an `ccm:wwwurl`, nicht ans
   Anlegen — und der Metadaten-Schreibpfad hatte gar keine. `wlo_update_content`
   konnte beim Ändern der Quell-URL genauso ablaufen. `CREATE_NODE_TIMEOUT_MS`
   ist deshalb ersetzt durch `writeTimeoutMs(properties)` /
   `WWWURL_WRITE_TIMEOUT_MS`, angewandt an **beiden** Schreibstellen. Eine Regel
   für eine Ursache.
2. **60 s statt 30 s.** 30 s hätten den kalten Lauf (46,5 s) abgebrochen — also
   Fehlschlag gemeldet für Arbeit, die zu Ende läuft, mit einem zweiten
   Datensatz als Folge des Wiederholungsversuchs.
3. **Schneller geht es nur im Repository.** Der Platzhalter (`isIcon=true`)
   existiert dort für genau diesen Fall; das Rendern müsste asynchron laufen.
   Von hier aus ist nichts zu holen.

**Lehre:** zwei meiner Schlüsse waren Artefakte des Messaufbaus — einmal ein
Cache, den ich nicht kannte, einmal ein Vergleich über Läufe hinweg. Eine
Messung ohne Kontrolle der Bedingungen ist eine Meinung mit Nachkommastellen.

**Stand:** `npm test` → **1941 pass, 0 fail** · typecheck, eslint je exit 0.

### 2026-08-17 — Zweiter Review der originalId-Fläche: 2 minor, 2 nits, alle behoben

Der erste Review hatte die Baseline-Lücke gefunden. Dieser prüfte die Fläche
danach noch einmal und fand vier kleinere Dinge — keinen Blocker.

**1. Titel und id gehörten verschiedenen Knoten** (`curation-decide.ts`). Der
Zustimmungssatz paarte `„${title}"` — abgeleitet vom **genannten** Knoten — mit
`(${target.targetId})`, der id des **Originals**. Bei einer überschriebenen
Verknüpfung nennt der Satz damit einen Titel, den dieser Datensatz nicht trägt,
und widerspricht zugleich `cs.title`, das aus der Baseline stammt. Beides steht
im Fingerabdruck und beides liest die Nutzerin. Der Test zeigte es wörtlich:

```
Nimmt den Vorschlag s-1 für „Beschreibung" an: der Wert wird in
„Titel der Verknüpfung" (original-1) geschrieben …
```

Behoben: der Satz nimmt `recordTitle(writeBefore)`. Der Ablehn-Pfad behält
seinen eigenen Titel — dort gibt es keine Umleitung, und der genannte Knoten
IST der gemeinte.

**2. Zwei Werkzeuge ohne Verhaltensabdeckung der Umleitung.**
`wlo_update_compendium` und `wlo_decide_suggestion` waren verdrahtet, aber
nichts prüfte, dass der Schreibvorgang am Original landet und die Vorschau beide
ids nennt — der Disziplin-Wächter belegt nur den Aufruf. Beide Tests ergänzt.
Der für das Kompendium war sofort grün (der Pfad war korrekt), der für
`decide` war rot und hat Befund 1 aufgedeckt. Genau dafür schreibt man sie.

**3. `originalId` existierte als SCHLÜSSEL auch am Original**, mit Wert
`undefined` (`formatNode` setzte ihn unbedingt). Durch JSON und zod folgenlos —
beide verwerfen ihn —, aber `'originalId' in node` antwortete mit ja. Genau
deshalb wäre es unbemerkt geblieben, bis jemand auf Präsenz statt auf den Wert
prüft. Jetzt per Spread, mit Test auf die Schlüsselabwesenheit.

**4. Die Reichweite des Baseline-Wächters** steht jetzt in seinem Kommentar: er
scannt bis zur ersten Klammer, ein geklammertes Argument entkäme, und einen
falschen SATZ neben einer richtigen Baseline sieht er grundsätzlich nicht — das
deckt der Test je Werkzeug ab.

**Stand:** `npm test` → **1944 pass, 0 fail** · typecheck, eslint je exit 0.


---

## 2026-08-18 — Kontexte in der Skill-Registry: P0 (Entwurf + Aufgaben) fertig

**Neu:** [`2026-08-18-registry-kontexte-design.md`](2026-08-18-registry-kontexte-design.md)
+ [`2026-08-18-registry-kontexte-tasks.md`](2026-08-18-registry-kontexte-tasks.md)
(17 Aufgaben, 6 Phasen). Kein Code.

**Die Anforderung.** Ein Registry-Dokument soll seine Skills über
Markdown-Überschriften in Arbeitskontexte gliedern (H1 = Dokumententitel,
H2 = Kontext, H3 = Unterkontext) und je Kontext eine Nutzungsanleitung der
Redaktion tragen. Werkzeuge liefern alles oder gezielt einen Kontext.

**Was die Messung am echten Dokument ergeben hat** (Staging, `get_skill_registry`
auf `9e7ae956-e9df-430f-bace-f3db4b910013`), und was daran den Entwurf gedreht
hat:

1. Das Dokument („Skillkatalog Physik Optik", 16 717 Zeichen, 28 Einträge)
   **nutzt bereits `##` — aber eine H2 je Skill.** Unter der neuen Regel ergäbe
   das 28 Kontexte mit je einem Skill: korrekt geparst, nutzlos. Der Umbau ist
   Redaktionsarbeit; der Code muss den Übergang aushalten.
2. Die gewünschte Gliederung existiert schon — in den **Keywords** (sieben
   Gruppen: „Kommunikation & Organisation", „Diagnostik und Bewertung",
   „Vorgabe & Planung", „Material", „Kontext & Zugang", „Erschließen &
   Beschreiben", „Fragen & Qualität"). Dort kostet sie 28 Metadaten-Abrufe; als
   `##` im Dokument kostet sie **nichts**, weil der billige Tarif den Text
   ohnehin liest.
3. **Korrektur:** `CLAUDE.md` nennt „56 `:::` blocks". Es sind **28 Blöcke** mit
   56 Zaunzeilen. Wird in P6 richtiggestellt.

**Die Entscheidung, die der Nutzer im Verlauf revidiert hat, und der Grund.**
Erste Antwort auf „was hängt an jedem Sammlungstreffer" war „gruppiert, Skills
vollständig" — das hätte den Status quo konserviert, und der IST die teure
Stelle: `REGISTRY_LINES_MAX` steht auf 100, Optik schreibt ~3330 Zeichen in
jeden Treffer, davon 1008 nackte UUIDs. Die kaufen genau eine Fähigkeit —
`get_skill` direkt aufzurufen, also den Schritt zu überspringen, von dem die
drei Zeilen darunter sagen, dass man ihn nicht überspringen soll.

**Stattdessen: ein Zeilenbudget, drei Formen, monotoner Abbau.**

```
REGISTRY_INLINE_MAX = 12
Kontextzeilen + Skillzeilen ≤ 12  →  beides, gruppiert, mit nodeIds
sonst Kontextzeilen ≤ 12          →  nur der Kontext-Index, keine UUIDs
sonst                             →  Kopfzeile allein
```

Je größer die Registry, desto kürzer wird sie im Treffer — nie länger. Optik
nach dem Redaktionsumbau: ~490 statt ~3330 Zeichen.

> **Überholt am 2026-08-18 (P6).** Beide Sätze stimmen nicht. Gedeckelt ist die
> OBERGRENZE, nicht jede Größe — innerhalb des Budgets kostet die Gruppierung
> eine Zeile je Kontext, eine kleine Registry wird dadurch länger als ihre
> flache Liste (echtes Optik-Dokument, 3 Skills in 2 Kontexten: 818 gegen 659
> Zeichen). Und die Zahlen waren geschätzt: gemessen sind es **407 statt 3436**
> Zeichen (28 Skills, 7 Kontexte) bzw. **147** für ein flaches Dokument mit 50
> Skills. **Auch flache Dokumente
gewinnen, und zwar am meisten:** was heute 50 Zeilen schreibt, schreibt eine —
ganz ohne Kontexte.

**`skillContext` an fünf Werkzeugen.** Auf Nachfrage des Nutzers ergänzt: die
Werkzeuge, die über EINE Sammlung antworten (`get_collection_contents`,
`search_wlo_within_collection`, `get_node_details`, `get_topic_page_content`,
`get_related_content`), nehmen einen Kontextnamen entgegen und liefern dann
Skills UND Anleitung in einer Antwort — der zweite Aufruf entfällt.
**Nicht** an `search_wlo_all` / `search_wlo_collections`: die Namen sind je
Registry vergeben, ein Parameter über fünf Sammlungen hieße je Zeile etwas
anderes.

**Drei Regeln vom Nutzer entschieden:** Anweisung = Prosa bis zum ersten
Skill-Block (Text danach gehört dem Skill) · kontextfreie Skills gelten immer und
kommen bei jedem Kontext-Aufruf mit · (von mir, gleiche Logik) eine H3 erbt die
Anweisung ihrer H2.

**Tragende Zusage, die in P2 als Test festgeschrieben wird:** Kontexte kosten
**null** zusätzliche Abrufe. Der billige Tarif bleibt bei exakt 1 × `/children`
+ 1 × Download + 0 × Metadaten — die bestehende Zählung in
`tests/skill-registry.test.ts:362` muss unverändert grün bleiben.

**Zwei Ergänzungen des Nutzers, noch am selben Tag in P0 eingearbeitet.**

1. **Ein Fehlgriff liefert alles, nie nichts.** Ein unbekannter — und, gleiche
   Logik, ein mehrdeutiger — Kontextname fällt auf die vollständige Antwort
   zurück und nennt die vorhandenen Namen. Bei `get_skill_registry` heißt das:
   das ganze Dokument, identisch zum Aufruf ohne `context`. Nie ein `isError`,
   nie eine leere Antwort. Der Grund ist der Normalfall, nicht die Ausnahme: ein
   Modell rät den Namen, bevor es die Namen kennt, und soll ihn aus genau der
   Antwort lernen, in der es danebengriff.

   **Eine bewusste Abweichung, hier festgehalten statt stillschweigend
   umgesetzt:** die fünf Sammlungs-Werkzeuge schicken bei einem Fehlgriff **keine**
   Anweisungstexte mit, nur die volle Skill-Liste, alle Kontextnamen und den
   Zeiger. Wörtlich gefordert waren „alle Skills und Anweisungen"; sieben
   Anweisungen à bis zu 1200 Zeichen sind ~8 kB in JEDEM Sammlungstreffer,
   ausgelöst durch einen Tippfehler — ein Modellfehler darf nicht die teuerste
   Antwort des Systems auslösen. Die Anweisungen sind einen Aufruf entfernt, mit
   dann korrektem Namen.

2. **Kurzliste der Kontexte, immer.** Das deckte eine echte Lücke im ersten
   Entwurf auf: Form 3 (Kopfzeile allein) nannte **keinen einzigen Kontextnamen**
   — ein gezielter Zweitaufruf wäre damit unmöglich gewesen. Jetzt werden
   Kontextnamen **gepackt** (mehrere je Zeile, `·`-getrennt, Umbruch bei
   ~100 Zeichen), sieben Kontexte sind also zwei Zeilen statt sieben. Damit ist
   **Form 2 der Normalfall und Form 3 die Ausnahme** — und Form 3 nennt dann
   wenigstens die Anzahl und `get_skill_registry` als Weg zu den Namen.

**Dadurch korrigiert, statt stehengelassen:** die Zusage „der Übergangszustand
ist der billigste Fall (eine Zeile)" gilt nicht mehr. Die 28 Kontextnamen des
heutigen Optik-Dokuments sind die Skilltitel selbst (~35 Zeichen), gepackt also
rund 12 Zeilen — genau an der Budgetgrenze. Ob Form 2 oder 3 greift, entscheidet
die Namenslänge; das sind ~1200 bzw. ~150 Zeichen gegen heute ~3330, also
zwischen Faktor 2,8 und Faktor 22. Eine krisp klingende Zahl wäre hier falsch.
In `CLAUDE.md` und oben richtiggestellt.

**Nächster Schritt:** P1 (Abschnitts-Parser + `offset` am `SkillReference`).


---

## 2026-08-18 — Kontexte in der Skill-Registry: P1 (Parser) fertig

**Neu:** `src/services/markdown-sections.ts` (102 Zeilen, rein, kein I/O) +
`tests/markdown-sections.test.ts` (13 Tests). **Geändert:**
`src/services/skill-references.ts` bekommt `offset` am `SkillReference`
(+1 Test).

**Der Kern.** Zwei Parser, ein gemeinsames Koordinatensystem: `parseSections`
sagt, welche Überschrift welchen Bereich des Dokuments abdeckt,
`parseSkillReferences` sagt jetzt zusätzlich, an welchem Offset ein `:::`-Block
steht. P2 verbindet beides — und braucht dafür **keine zweite Blockerkennung**,
was die Doppelung gewesen wäre, gegen die dieses Modul überhaupt existiert.

**Was der Parser bewusst NICHT kann**, jeweils mit Test:

- **Setext-Überschriften** (`Titel` über `=====`) — im WLO-Editor nicht in
  Gebrauch, und ein `-----` unter einer Zeile ist auf den ersten Blick nicht von
  einer Trennlinie zu unterscheiden. Eine Regel, die eine Redakteurin
  überrascht, ist schlechter als eine, die eine ungenutzte Form ignoriert.
- **Raten, wo ein nicht geschlossener Codezaun enden sollte** — er verschluckt
  den Rest des Dokuments. Ein fehlerhaftes Dokument liefert damit WENIGER
  Kontexte, nie falsche; erfundene Struktur ist der Fehler, den niemand bemerkt.

**Drei Fälle, die ohne Test still falsch geworden wären:**

1. **Ein `##` in einem Codeblock ist kein Kontext.** Ein Registry-Dokument ist
   redaktionelle Prosa und zeigt durchaus das Format, das es dokumentiert.
   Zäune werden zeichengenau geprüft: nur dasselbe Zeichen schließt, und nur
   mindestens gleich lang — sonst beendete ein ``` `-Beispiel INNERHALB eines
   `~~~`-Blocks genau den Block, der es zeigt.
2. **`## Material ##` heißt „Material", `## C# lernen` heißt „C# lernen".**
   CommonMark schließt eine Überschrift nur mit einem Hash-Lauf, dem ein
   Leerzeichen vorausgeht. Ohne diese Regel trüge der Kontext einen Namen, unter
   dem ihn niemand aufrufen kann — und genau danach wird er aufgerufen.
3. **Ein H2-Abschnitt endet an der nächsten H2, nicht an seiner ersten H3.**
   Das ist die Regel, die einen Unterkontext zum TEIL seines Kontexts macht
   statt zu dessen Nachfolger. Ein Off-by-one hier ordnet Skills dem falschen
   Kontext zu, und dem Katalog sieht man das nicht an.

**Beim Bau aufgefallen und in T3 eingetragen, damit es nicht verlorengeht:** ein
Abschnitt mit leerem Titel (`##` allein) wird vom Parser wahrheitsgemäß mit
`title: ''` gemeldet, ist aber per `context:"…"` nicht adressierbar — die
Registry muss ihn verwerfen. Der Parser bleibt treu, die Auswahl trifft die
Schicht darüber.

**Noch offen und bewusst nach P2 verschoben:** der Lauf gegen das echte
Optik-Dokument (erwartet: 28 H2). Kontexte werden erst mit P2 durch
`get_skill_registry` beobachtbar; ihn jetzt zu fahren hieße, 16 kB zweimal zu
holen, um eine Zahl zu bestätigen, die P2 ohnehin ausgibt.

**Stand:** `npm test` → **1958 pass, 0 fail** (vorher 1944, +14) ·
`npx tsc -p tsconfig.typecheck.json` exit 0 · `npm run lint` exit 0.

**Nächster Schritt:** P2 (T3–T7) — `contexts` am `SkillRegistry`, die Anweisung,
`resolveContext`, Knotenfeld + zod, und die Zusicherung, dass der billige Tarif
weiterhin 1/1/0 kostet.


---

## 2026-08-18 — Kontexte in der Skill-Registry: P2 (Dienst) fertig

**Neu:** `src/services/registry-contexts.ts` (Gliederung + `resolveContext`) +
`tests/registry-contexts.test.ts` (8 Tests). **Geändert:**
`src/services/skill-registry.ts` (Typen, Verdrahtung, Re-Export),
`src/formatter.ts` (Knotenfeld), `src/apps/outputSchemas.ts` (zod),
`tests/skill-registry.test.ts` (+22 Tests). **1988 pass, 0 fail** (vorher 1958).

**Abweichung vom Entwurf, eingetragen statt stillschweigend umgesetzt:** die
Kontext-Logik liegt in einem eigenen Modul, nicht in `skill-registry.ts`. Jenes
besitzt bereits Finden, Lesen, Auflösen und Kappen einer Registry; „was bedeutet
die Gliederung des Dokuments" ist ein eigener Grund zur Änderung, und die
480 Zeilen wären auf über 600 gewachsen. `skill-registry.ts` re-exportiert
alles und bleibt die eine Anlaufstelle.

**Die eine Regel:** ein Kontext ist ein Abschnitt der Ebene 2 oder 3 **mit
nicht-leerem Titel**. Alles andere ist DURCHLÄSSIG — sein Inhalt gehört dem
nächsten benannten Kontext darüber, sonst dem allgemeinen Teil. Eine Regel, zwei
richtige Ergebnisse: ein namenloses `##` auf oberster Ebene landet im
Allgemeinen, ein namenloses `###` innerhalb seiner H2 bei dieser H2. Der Titel
ist die ADRESSE (`context: "…"`), deshalb wird ein namenloser Abschnitt nicht
angeboten — sein Inhalt geht aber nicht verloren, was die verworfene Alternative
(„verwerfen") getan hätte.

**Zwei Regeln, die erst der TEST bzw. der LIVE-LAUF gefunden hat:**

1. **Ein Kontext ist gelistet, sobald ein Block in seiner SPANNE liegt — nicht
   erst, wenn er ihm selbst gehört.** Eine H2, deren einziger Skill in ihrer H3
   sitzt, fiel sonst aus der Liste, während ihre H3 sie weiter im `path` nannte:
   ein Unterkontext, der auf einen Elternteil zeigt, den der Katalog nicht führt.
   `skills` bleibt trotzdem innerste Zuordnung, damit Eltern und Kind denselben
   Skill nie doppelt zählen — ein rein gruppierender Kontext zeigt deshalb 0.
2. **Ein benannter Abschnitt IST ein Kontext, auch ohne Skill** — meine eigene
   Regel, vom Live-Lauf widerlegt. Die Redaktion hatte `## Browserplugin` mit
   Anweisung und noch ohne Skills angelegt; Gruppen werden erzeugt und dann
   gefüllt. Unter der alten Regel fehlte die Überschrift im Katalog UND
   `resolveContext` meldete „unbekannt" für einen Namen, den jeder im Dokument
   lesen kann. Zweites, unabhängiges Argument: die 0 eines gruppierenden
   Elternkontexts wurde bereits gezeigt — dieselbe Zahl bei einem Blatt zu
   verbergen, war inkonsistent.

**Der Live-Lauf gegen Staging** (Sammlung Optik, `9e7ae956-…`) hat außerdem
gezeigt: **das Registry-Dokument ist ausgetauscht worden** — 984 statt
16 717 Zeichen, 3 Einträge statt 28, und in genau der neuen Form (allgemeine
Prosa + 2 allgemeine Skills vor der ersten H2, dann `## Browserplugin` und
`## Redaktionsumgebung`). Geparst wird es korrekt: 2 Kontexte, 2 allgemeine
Skills, 1 Skill unter „Redaktionsumgebung", 0 unresolved, 1,9 s.

**Die tragende Zusage ist als Test festgeschrieben:** ein Dokument MIT
Gliederung kostet den billigen Tarif weiterhin exakt 1 × `/children` +
1 × Download + **0** × Metadaten — und trägt dabei die vollständige Gliederung,
nicht nur eine halbe.

**Befund am Rande, NICHT behoben (außerhalb dieses Pakets):** der Eintragstitel
`Skill\_Qualitätscheck\_Sachrichtigkeit` trägt die maskierten Unterstriche des
Markdown-Links bis in die Ausgabe. `unwrapEmphasis` in `skill-references.ts`
entfernt nur `*`. Betrifft den billigen Tarif direkt, weil dort der Blocktitel
angezeigt wird. Entscheidung des Nutzers, ob das in dieses Paket gehört.

**Nächster Schritt:** P3 (T8–T10) — `context` an `get_skill_registry`.


---

## 2026-08-18 — Kontexte in der Skill-Registry: P3 (Werkzeug) fertig

`get_skill_registry` nimmt `context` entgegen. **1997 pass, 0 fail** (vorher
1988) · typecheck, eslint je exit 0 · Live gegen Staging in drei Fällen geprüft.

**Was der Aufruf mit einem passenden Kontext liefert.** Kopfzeile mit dem
Kontextnamen, dem übergeordneten (dessen Anweisung mitgilt) und den
Unterkontexten als nächste Aufrufe; dann der Katalog in **zwei Gruppen** —
„Freigegebene Skills" (die des Kontexts) und „Gilt immer" (der allgemeine Teil);
unterhalb des `---` nur noch der **Abschnitt** des Dokuments statt des ganzen
Textes, vorangestellt die allgemeine Prosa und, bei einem Unterkontext, die
Anweisung des übergeordneten.

**Die zwei Gruppen waren eine Korrektur nach dem Live-Lauf.** Der erste Entwurf
mischte eigene und allgemeine Skills in eine Liste („Freigegebene Skills (3)")
und nannte die Zahl der allgemeinen in einem Nebensatz. Eine Zahl sagt, WIE
VIELE, nie WELCHE — ein Leser hätte alle drei für die des Kontexts gehalten, was
eine Aussage über redaktionelle Absicht ist, die das Dokument nicht macht.

**Ein Fehlgriff liefert alles, nie nichts** — live bestätigt: `context:
"Klassenfahrt"` antwortet mit dem vollständigen Katalog, dem ganzen Dokument und
der Zeile „Der Kontext „Klassenfahrt" kommt in dieser Registry nicht vor.
Vorhanden: Browserplugin · Redaktionsumgebung." Kein `isError`. Mehrdeutigkeit
verhält sich genauso, mit den qualifizierten Pfaden. Eine flache Registry sagt,
dass sie sich nicht in Kontexte gliedert, statt den Aufrufer zu beschuldigen.

**Eine Testzusicherung war zu grob und wurde geschärft, nicht abgeschwächt:** sie
verlangte, dass die nodeId eines Unterkontext-Skills NIRGENDS in der Antwort
steht. Verengt wird aber der KATALOG; der wortgetreue Abschnitt umfasst die
Unterabschnitte bewusst, denn wer „Redaktionsumgebung" liest, will deren
Abschnitt ganz sehen. Zusicherung jetzt auf den Bereich oberhalb des `---`.

**Der JSON-Zweig** trägt `registry.contexts`, bei einem Treffer `context` als
benanntes Feld samt `instruction` (dort ist ein Feld eindeutig, anders als Prosa
im Markdown-Zweig), bei einem Fehlgriff `contextMiss` mit `kind` und den Namen.
Beide Formate lösen den Namen über **denselben** `narrow`-Aufruf auf — welche
Antwort ein Name bedeutet, darf sich zwischen Markdown und JSON nicht
unterscheiden.

**Live gemessen** (Sammlung Optik): ohne Kontext 2974 Zeichen / 2,7 s, mit
`context: "Redaktionsumgebung"` 2481 Zeichen / 2,4 s, Fehlgriff 3129 Zeichen.
Die Ersparnis ist hier klein, weil das Dokument klein ist — sie skaliert mit dem
Dokument, nicht mit dem Katalog.

**Weiterhin offen und für P4 vorgemerkt:** die maskierten Unterstriche
(`Skill\_Qualitätscheck\_Sachrichtigkeit`) im billigen Tarif. Im Werkzeug-Tarif
gewinnt der Datensatztitel, dort ist er sauber — gemessen 2026-08-18.

**Nächster Schritt:** P4 (T11–T13) — `REGISTRY_INLINE_MAX`, die drei Formen, und
die Unterstrich-Reparatur.


---

## 2026-08-18 — Review von P1–P3: 1 major, 4 minor, 3 nits — alle abgearbeitet

`npm test` **2002 pass, 0 fail** (vorher 1997, +5 Regressionstests) · typecheck,
eslint je exit 0 · Live gegen Staging in drei Fällen unverändert korrekt.

**Der eine, der zählt (MAJOR).** `renderCatalogue` prüfte `registry.entries` —
und das ist bei einem Kontext-Aufruf die VERENGTE Liste. War sie leer, meldete
die Antwort „Die Registry nennt keine abrufbaren Skills." Das ist falsch über die
Registry; leer war nur der Kontext. Der richtige Satz existierte eine Zeile
tiefer und war in genau diesem Fall unerreichbar, weil der frühe Rücksprung
vorher griff. Auslöser ist gewöhnlich: ein Dokument mit `## Browserplugin` ohne
Skills und ohne allgemeinen Teil — dann behauptet die Antwort, die Sammlung habe
nichts freigegeben, während ein anderer Kontext einen Skill führt. Behoben: jeder
Leer-Satz nennt jetzt, WESSEN Leere er meint, und der Kontext-Fall nennt die
anderen Kontexte.

**Drei weitere mit derselben Wurzel — eine Bedingung las die unverengte Registry,
während die Antwort die verengte trug:**

- `hint` (JSON) hing an `registry.entries.length` statt an der ausgelieferten
  Sicht und lieferte „das ist nur die Übersicht" neben einem leeren Katalog —
  genau das, was der Kommentar drei Zeilen darüber ausschließt. Jetzt gibt es
  **eine** Variable `shown`, die Payload und Bedingung speist.
- `truncated` wurde in die verengte Sicht übernommen; `renderDisclosures` schrieb
  dann „hier stehen die ersten 100" über eine Liste anderer Größe. Die
  Offenlegung geht nicht verloren, sondern wandert umformuliert in die Notiz —
  sie ist das einzige Zeichen, dass Skills weggefallen sind.
- `registry.markdown` heißt „das Dokument, unverändert"; bei Verengung ist es ein
  Ausschnitt. Der Markdown-Zweig erklärt das über die Notiz, JSON hatte nichts —
  jetzt `markdownIsExcerpt: true`.

**Zwei NITs behoben:** die zwei `narrowed!` (Nicht-Null-Behauptungen, die auf
einer Invariante vier Zeilen darüber trugen) sind durch eine Prüfung ersetzt; das
Entwurfsdokument nennt `range` am `RegistryContext`.

**Ein Befund war teilweise falsch, und das steht hier, statt es zu verschweigen.**
Ich hatte gemeldet, `unknown.available` präsentiere eine gekappte Kontextliste als
vollständig. Der Test dazu war bei Ankunft GRÜN: der Kontext-Index legt zwei
Zeilen tiefer offen, wie viele Kontexte das Dokument wirklich gliedert. Der Test
bleibt als Absicherung. Ebenfalls belassen: ein Eintrag jenseits des
Kontext-Deckels trägt weiter seinen `path`, obwohl `contexts` ihn nicht führt —
das ist wahr über das Dokument, und ihn zu entfernen verlöre Information.

**Die Testlücke, die den MAJOR durchgelassen hat:** keiner der beiden
Leer-Katalog-Sätze hatte einen Test. Beide haben jetzt einen.

**Nächster Schritt:** P4 (T11–T13) — `REGISTRY_INLINE_MAX`, die drei Formen, und
die vorgemerkte Unterstrich-Reparatur.


---

## 2026-08-18 — Zweite Review-Runde auf dem Reparatur-Diff: 1 major, 1 minor, 2 nits

`npm test` **2004 pass, 0 fail** · typecheck, eslint je exit 0 · Live 3/3.

**Der MAJOR steckte in meiner eigenen Reparatur der ersten Runde.** Um den
falschen Kappungs-Satz loszuwerden, hatte ich `truncated` per Destrukturierung
aus der verengten Sicht ENTFERNT und den Ersatz in `notice` gelegt — und `notice`
gibt der JSON-Zweig nie aus. Ein JSON-Aufrufer, der über eine Registry mit
>100 Skills verengt, bekam damit **gar keine** Offenlegung mehr; vorher war sie
falsch formuliert, danach fehlte sie. Das verletzt genau die Regel, deren
Nachbarfall die erste Runde behoben hatte („eine Offenlegung, die beim Trimmen
verschwindet, ist keine").

Richtig ist: `truncated` ist eine Tatsache über die **Registry** — wie viele das
Dokument nennt gegen wie viele gelesen wurden —, nicht über den Ausschnitt.
Umformuliert werden musste nur der **Satz**. Das Feld bleibt, `renderDisclosures`
erfährt stattdessen, ob verengt wurde. Die Destrukturierung entfällt ganz.

**MINOR:** der ignorierte `context` an einer flachen Registry existierte nur als
Prosa; JSON zeigte weder `context` noch `contextMiss`, war also nicht von „nichts
gefragt" zu unterscheiden. Jetzt `contextMiss: { kind: 'no_contexts', asked }` —
bewusst KEIN `ContextResolution`, denn `resolveContext` antwortet dort zu Recht
mit „all"; ignoriert wurde der Parameter trotzdem.

**NIT behoben:** `ctx?.path` verdeckte, dass der Zweig nur verengt erreichbar ist,
und hätte „undefined" gedruckt; jetzt `ctx!` mit begründeter Invariante.

**Ein NIT nach erneutem Hinsehen zurückgezogen:** `markdownIsExcerpt` auf oberster
Payload-Ebene neben `registry.markdown`. Der Payload trägt genau ein
markdown-Feld, der Name ist also eindeutig — eine Umbenennung wäre länger, nicht
klarer.

**Dritter Durchgang** über die neuesten Änderungen: `miss.kind` wird nirgends
verzweigt (nur serialisiert), `renderDisclosures` hat genau einen Aufrufer, die
`ctx!`-Invariante hält. Keine weiteren Befunde.

**Lehre, die bleibt:** eine Reparatur, die eine Aussage aus einem FELD in PROSA
verschiebt, verliert sie für jeden Aufrufer, der die Prosa nicht rendert. Beide
Formate gegenprüfen, nicht nur den, in dem der Fehler auffiel.


---

## 2026-08-18 — Kontexte in der Skill-Registry: P4 (Zeilenbudget) fertig

`npm test` **2017 pass, 0 fail** (vorher 2004) · typecheck, eslint je exit 0 ·
an echten Daten gemessen.

**`REGISTRY_INLINE_MAX = 12` ersetzt `REGISTRY_LINES_MAX = 100`.** Die alte Zahl
war kein Budget: eine Registry mit sechzig Skills schrieb sechzig Zeilen in
JEDEN Sammlungstreffer. Drei Formen, eine Zahl, monotoner Abbau — je größer die
Registry, desto kürzer ihr Block.

**Gemessen (`registrySummaryLines` gegen den echten Katalog bzw. eine
realistische 28er-Gliederung):**

| Fall | Zeilen | Zeichen | vorher |
|---|---|---|---|
| Optik real: 3 Skills, 2 Kontexte → Form 1 | 8 | 818 | 6 / ~700 |
| 28 Skills in 7 Kontexten → Form 2 | **3** | **407** | 30 / ~3330 |
| 28 Skills flach → Form 3 | **1** | **147** | 30 / ~3330 |

Faktor 8 bzw. 22. Der größte Gewinn liegt bei den FLACHEN Dokumenten und braucht
gar keine Gliederung.

**Kontextnamen werden gepackt** (mehrere je Zeile, `·`-getrennt, Umbruch bei
100 Zeichen, ein Name wird nie zerschnitten). Sieben Namen sind zwei Zeilen statt
sieben — deshalb ist Form 2 der Normalfall und Form 3 die Ausnahme. Ohne Namen
kann niemand gezielt nachfragen, und genau das war die Lücke, die der Nutzer
gefunden hat.

**Vier Regeln halten, jede mit Test:** der Kopfzeilen-Tarif bleibt EINE Zeile und
nennt die Kontext-ANZAHL, nie die Namen (dreißig Portale × sieben Namen ist
dieselbe Wand über einen anderen Weg) · Form 2 und 3 drucken keine Skill-nodeId,
also auch keine `DESCRIPTIONS_ONLY_NOTE` · jeder Kontextname geht durch `oneLine`
· der `reach`-Satz der Kopfzeile ist je Form wahr über die Form DARUNTER.

**Drei bestehende Tests kodierten den alten Vertrag und wurden UMGESCHRIEBEN,
nicht gelöscht** — jeder sagt jetzt, was sich geändert hat und warum:

- „a full search-tier catalogue is still listed in full" nagelte die Spiegelung
  zweier Konstanten fest, von denen es eine nicht mehr gibt. Ersetzt durch die
  Regel, die davon überlebt: **eine Liste ist ganz oder gar nicht, nie eine
  Stichprobe.** Innerhalb des Budgets jeder Eintrag, jenseits keiner — und dann
  Anzahl plus Werkzeug an ihrer Stelle.
- „what the SERVICE capped is still disclosed as missing" — die Regel überlebt,
  ihre Form nicht: bei dreißig Einträgen wandert die Offenlegung in die
  Kopfzeile. Als zweiter Test ergänzt, dass sie innerhalb des Budgets weiterhin
  unter der Liste steht.
- „a capped listing points at the tool" — dritte Fassung dieses Tests. Das Muster
  ist bemerkenswert: jede Fassung nagelte fest, was die Kopfzeile VERSPRECHEN
  darf, und jedes Mal war eine Zahl darunter verschoben worden.

**Die maskierten Unterstriche sind behoben** (aus dem Live-Lauf von P2):
`plainTitle` löst Markdown-Escapes auf, nachdem die Emphase abgestreift ist. Die
Reihenfolge trägt — umgekehrt würde aus `\*kein Stern\*` erst `*kein Stern*`,
und der Emphase-Pass risse genau die Sterne ab, die der Autor als Text markiert
hat. Vier Tests, inkl. `C:\pfad` (Backslash bleibt) gegen `50\%` (Escape).
Sichtbar am echten Datensatz: `Skill_Qualitätscheck_Sachrichtigkeit` statt
`Skill\_Qualitätscheck\_Sachrichtigkeit`, und zwar im billigen Tarif, wo kein
Datensatztitel überstimmt.

**REST-HTML** zeigt bei gegliederten Registries die Kontextnamen statt der ersten
vier Skilltitel — vier von 28 Titeln sagten weder, was abgedeckt ist, noch, was
man als Nächstes fragen kann.

**Zwei Kommentare korrigiert, die durch die Änderung falsch wurden:**
`tests/skill-registry.test.ts` behauptete eine Gleichheit mit einer Konstante,
die es nicht mehr gibt (direkt neben der Zusicherung), und ein Testkommentar nannte
die umbenannte Funktion.

**Nächster Schritt:** P5 (T14–T16) — `skillContext` an den fünf
Sammlungs-Werkzeugen plus Wächter.


---

## 2026-08-18 — Kontexte in der Skill-Registry: P5 (skillContext) fertig

`npm test` **2027 pass, 0 fail** (vorher 2017) · typecheck, eslint je exit 0 ·
Live gegen Staging in vier Fällen.

**Fünf Werkzeuge nehmen `skillContext`:** `get_collection_contents`,
`search_wlo_within_collection`, `get_node_details`, `get_topic_page_content`,
`get_related_content`. **Nicht** `search_wlo_all` / `search_wlo_collections` —
die Kontextnamen sind je Registry vergeben, ein Parameter über fünf Sammlungen
hieße je Zeile etwas anderes. Zugesichert als Test, nicht als Auslassung.

**Die Entwurfszusage „null zusätzliche Abrufe" war falsch und ist korrigiert.**
Der Cache hält die ZUSAMMENFASSUNG — Titel, nodeId, Kontextnamen, Anzahlen — und
nicht die Prosa der Redaktion, die je Sammlung Kilobytes wäre und dann in jedem
Treffer läge. Ein benannter Kontext kostet deshalb **einen Live-Abruf: 2
Anfragen, ~1,0–1,4 s**. Opt-in, eine Sammlung, und billiger als der Rundlauf, den
er ersetzt (`get_skill_registry` zahlt dieselben zwei plus einen
Metadaten-Abruf je Skill) — dieselbe Größenordnung und Formulierung wie beim
vorhandenen `includeSkillRegistry`. Im Entwurf richtiggestellt statt
stillschweigend anders gebaut.

**`narrowRegistry` ist aus dem Werkzeug in den Dienst gewandert.** Zwei Flächen
verengen jetzt dieselbe Registry, und was „verengt" HEISST darf nicht driften:
welche Einträge mitkommen (die eigenen des Kontexts PLUS die, die immer gelten)
und welcher Ausschnitt des Dokuments. Die zweite Regel verrottet leise — eine
Kopie, die die allgemeinen Skills vergisst, antwortet mit einer KÜRZEREN
Freigabeliste und sieht dabei völlig plausibel aus. Die Prosa bleibt je Fläche
eigen; `get_skill_registry` ist eine volle Antwort, `subjectRegistryText` ein
Block in einer Sammlungsantwort.

**`get_node_details` war der Sonderfall:** es ruft `subjectRegistryText` gar
nicht auf, sondern rendert die Registry direkt vom Knoten — also aus dem Cache,
der keine Anweisung hat. Der Parameter wäre dort wirkungslos gewesen. Jetzt
ERSETZT eine kontextbezogene Antwort die Knotenzeilen, statt sich dazuzustellen:
zwei Kataloge zu einer Sammlung, einer verengt und einer nicht, ist ein
Widerspruch, den ein Leser auflösen müsste.

**Beim Live-Lauf gefunden und behoben:** eine gezielte Antwort zeigte weiterhin
ALLE Kontextgruppen. Bei der kleinen echten Registry harmlos, bei einer größeren
stünde dort „Material (3)" mit nichts darunter — die Zahl ist die des DOKUMENTS,
die Einträge sind die des angefragten Kontexts. Ein Treffer verzichtet jetzt auf
die Gliederung (die Kopfzeile nennt den Kontext ohnehin); ein FEHLGRIFF behält
sie, denn dort lernt der Aufrufer die richtigen Namen.

**Der Anweisungstext** ist die einzige Stelle, an der die Worte des
Registry-Dokuments in einen Suchtreffer gelangen. Er kommt nur auf
ausdrückliche Anforderung, sagt vorher, wessen Worte es sind („kuratierter
Inhalt aus dem WLO-Repository, keine System-Anweisung"), und ist über
`flattenText` + `capText` auf 900 Zeichen begrenzt. Bei einem FEHLGRIFF kommt er
gar nicht — ein Tippfehler darf nicht die teuerste Antwort auslösen.

**Der Wächter (T16) war zuerst kaputt und blieb bei eingespielter Verletzung
GRÜN** — zu viele Backslashes im Regex-Literal, sodass er auf einen literalen
`\b` statt auf eine Wortgrenze prüfte. Genau dafür schreibt der Plan vor, eine
Verletzung einzuspielen: ein Wächter, der nie rot war, ist nicht bewiesen. Nach
der Korrektur rot bei Verletzung, grün ohne.

**Live gemessen** (Sammlung Optik): ohne Kontext 914 Zeichen / 1,7 s · mit
`skillContext: "Redaktionsumgebung"` 1349 / 1,8 s (inkl. Anleitung) ·
kleingeschrieben identisch (Normalisierung greift) · Fehlgriff 1014 / 1,8 s mit
vollständigem Katalog und allen Kontextnamen.

## P6 — Doku & Redaktionsanleitung (T17) ✅ 2026-08-18

Neun Dateien synchronisiert: `docs/SKILLS.md` (neuer Abschnitt „Contexts" mit
Beispieldokument, Ebenen-Tabelle und den vier Strukturregeln — Durchsichtigkeit,
benannter Abschnitt ohne Skill, innerste Zuordnung, „Anweisung VOR die Blöcke"),
`docs/SKILL-TRIGGER.md` (neuer Abschnitt zum Zeilenbudget mit gemessener
Beispielausgabe), `docs/TOOLS.md` + `TOOLS-KOMPAKT.md` + beide READMEs (`context`
und `skillContext` benannt), `CHANGELOG.md` (zwei Einträge: Added/Changed),
`CLAUDE.md` (Block auf VOLLSTÄNDIG, plus zwei Korrekturen) und dieser Datei.

**Zwei Korrekturen an älteren Aussagen.** „56 `:::` blocks" in `CLAUDE.md` waren
**28 Blöcke** — gezählt worden waren die ZAUNZEILEN, je eine öffnende und eine
schließende. Und `REGISTRY_LINES_MAX` steht dort noch als Regel von 2026-08-11;
die Konstante existiert seit P4 nicht mehr, der Absatz hat jetzt seine
Überholt-Marke.

**Der Live-Lauf hat einen Satz widerlegt, den ich zuvor in vier Dokumente
geschrieben hatte.** „Je größer die Registry, desto kürzer der Treffer — nie
länger" ist falsch. Gedeckelt ist die Obergrenze; *innerhalb* des Budgets kostet
die Gruppierung eine Zeile je Kontext, eine kleine Registry wird dadurch länger
als ihre flache Liste. Am echten Optik-Dokument (3 Skills, 2 Kontexte, volle
Form): **818 gegen 659 Zeichen**. Kein Test konnte das finden — er müsste gegen
eine Ausgabeform vergleichen, die es nicht mehr gibt. Korrigiert in `README.md`,
`README.de.md`, `docs/TOOLS.md`, `docs/SKILL-TRIGGER.md`, `CHANGELOG.md`,
`CLAUDE.md`, im Entwurf und oben im P4-Eintrag.

**Die veröffentlichten Zahlen sind jetzt gemessen statt geschätzt.** Der Plan
sagte „4 Zeilen, ~490 statt ~3330 Zeichen"; gerendert sind es **3 Zeilen, 407
statt 3436** (28 Skills in 7 Kontexten) und **147** für ein flaches Dokument mit
50 Skills. Die Ersparnis entsteht ausschließlich oberhalb des Budgets — dort dann
um den Faktor 8.

**Ein rohes Steuerzeichen im P5-Eintrag** liess `npm test` fehlschlagen
(`source-bytes-discipline`): der Satz über *zu viele Backslashes* hatte selbst
einen an die Shell verloren, aus `\b` wurde ein echtes Backspace-Byte (0x08).
Ersetzt; die Datei ist wieder frei von Steuerzeichen.

**Gemessen (Deckel).** `REGISTRY_CONTEXT_MAX` = 50: ein Dokument mit 55 benannten
Abschnitten meldet `contextsTruncated {listed: 50, found: 55}`, die Skills des
51. bis 55. bleiben im Katalog (der ungefilterte Zweig listet flach), sind aber
nicht mehr über ihren Namen erreichbar. Das steht so in `docs/SKILLS.md`.

**Tore:** `npm test` → **2027 pass, 0 fail** · `npx tsc -p tsconfig.typecheck.json`
→ exit 0 · `npm run lint` → exit 0. Live gegen Staging: `loadSkillRegistry` auf
Optik in 1,9 s, 3 Einträge in 2 Kontexten, 0 unresolved.

**Offen, aber nicht Code:** die Redaktion baut das Optik-Dokument weiter um (aus
28 Ein-Skill-Überschriften sind bisher 2 echte Kontexte geworden). Danach lohnt
eine erneute Messung — erst dort greift die kurze Form.

**Damit ist das Paket „Kontexte in der Skill-Registry" vollständig (P0–P6).**
Nichts committet; Auslieferung wie immer manuell.

## Review-Runde nach P6 ✅ 2026-08-18 — 5 Befunde, alle behoben

**1 MAJOR, 3 MINOR, 1 NIT.** Alle gegen die Quelle geprüft, drei zusätzlich
ausgeführt, bevor sie gemeldet wurden.

**Der MAJOR und ein MINOR hatten eine Wurzel, und sie widerlegt einen Wächter.**
`resolveContext` meldete für „ein Name über einem Dokument ohne Gliederung"
denselben Ausgang wie für „will alles" (`kind: 'all'`). Beide Aufrufer mussten
den Unterschied selbst herleiten — und schrieben verschiedene Bedingungen:
`get_skill_registry` nahm das reservierte `all` aus, `subjectRegistryText` nicht.
Also meldete `skillContext: "all"` auf einer flachen Registry, „all" habe nicht
gegriffen: eine falsche Aussage über einen korrekten, dokumentierten Aufruf.
Derselbe Zweig schickte `all` außerdem in den Live-Pfad (2 Anfragen, ~1,0–1,4 s)
für eine Antwort, die der Cache schon hält.

Der Wächter aus T16 war grün und blieb es zu Recht: er prüft, dass die
**Funktion** einmal definiert ist, nicht dass die **Entscheidung** einmal
getroffen wird. `resolveContext` meldet den Fall jetzt selbst
(`kind: 'no_contexts'`); beide Aufrufer rendern ihn nur noch. Als Regel in
`CLAUDE.md` festgehalten.

**MINOR: der vom Aufrufer gelieferte Kontextname wurde nur durch `oneLine`
echot** — auf der Schwesterfläche längst durch `sanitizeText`. Gemessen:
`oneLine` lässt U+2028, U+0085, U+202E und U+200B unverändert durch. Die
`notice`-Zeilen stehen oberhalb des `---`, also in dem serverseitigen Bereich,
dessen Unverfälschbarkeit dieses Paket als Eigenschaft führt.

**MINOR (Doku, aus P6 selbst):** „die fünf Sammlungs-Werkzeuge der zweiten
Zeile" verwies auf eine Tabellenzeile mit vier Namen — `get_node_details` steht
in Zeile 1. Die fünf sind jetzt ausgeschrieben.

**NIT:** `layoutContexts` bekam nur die `ki-skill`-Blöcke, also begrenzte ein
`::: wlo-material`-Block die Anweisungsspanne nicht — seine Zaunzeilen und seine
URL landeten wörtlich in der Anleitung und verbrauchten deren 900 Zeichen.
Blockgrenzen kommen jetzt aus allen Blöcken, `paths` bleibt an den Skills
ausgerichtet.

**Beim Beheben selbst gefunden, und es ist der lehrreichste Teil:** ein
vergessener Import ließ `narrow()` mit einem ReferenceError abbrechen — den der
`catch` des Werkzeugs in ein nutzerseitiges „Fehler beim Laden der
Skill-Registry" verwandelte. 23 Tests fielen, das Werkzeug wäre still und
dauerhaft ausgefallen. Ein `catch`, der Upstream-Fehler höflich meldet, verdeckt
Programmierfehler genauso höflich.

**Zwei eigene Testfehler**, beide vom Testlauf gefangen: ein fehlender Import,
und ein Test, der `all` gegen `coll-1` prüfte — dessen Cache ein früherer Test
mit dem anderen Dokument gefüllt hatte. Jetzt über eine eigene Sammlungs-id
isoliert.

**Tore:** `npm test` → **2034 pass, 0 fail** (7 neue Zusicherungen, jede vorher
rot gesehen) · `tsc` → 0 · `lint` → 0.

**Live gegen Staging** (Optik, nach dem Warmlaufen): `all` und `ALL` → **0 ms**,
914 Zeichen, byteweise identisch mit einem Aufruf ohne Kontext (vorher ~1,6 s);
`"Redaktionsumgebung"` → 1579 ms, 1349 Zeichen mit Anleitung; `"Klassenfahrt"`
→ 1770 ms, vollständiger Katalog. Kein Fehlgriff-Satz mehr, wo keiner hingehört.


## Vokabular-Abgleich (Qualität · Recht · Zugänglichkeit) ✅ 2026-08-18

Auf Nachfrage des Nutzers noch einmal gegen Staging gemessen — mit den dreizehn
veröffentlichten Vokabularen (`vocabs.openeduhub.de`) als Vergleich. Ergebnis:
`docs/plans/2026-08-18-vokabular-abgleich.md`.

**Der Mechanismus, jetzt gemessen statt erschlossen.** `_DISPLAYNAME` löst genau
das auf, was das WIDGET im Metadatensatz deklariert — nicht die URI-Form, nicht
das Vokabular. Ein Datensatz (`7affb314…`) trug sieben Qualitätsfelder; nur
`ccm:oeh_quality_login` kam beschriftet zurück, weil sein Widget als einziges die
nackten Ziffern deklariert, die es speichert. Gegenprobe:
`containsAdvertisement/yes` ist eine saubere URI aus einem veröffentlichten
Vokabular und bleibt unbeschriftet. Die Entscheidung vom 17.8., die
Qualitätsfelder nicht zu lesen, steht damit auf einer Messung.

**Zwei Felder waren nie erhoben worden.** Die drei Suchmuster vom 17.8. verfehlten
`ccm:price` (**339 687** Belegungen, 58 % des Korpus) und
`ccm:containsAdvertisement` (**69 688**). Beide standen die ganze Zeit in der
Auffangliste, die dasselbe Skript ausgibt — genau dafür gibt es sie.
`survey-metadata.mjs` hat eine vierte Gruppe bekommen.

**Gebaut:** `includeAccessInfo` liefert fünf Felder statt drei (`Kosten:`,
`Werbung:` kommen hinzu). Für `ccm:containsAdvertisement` gibt es die einzige
lokale Vokabular-Tabelle des Moduls (`yes`→„Ja", `no`→„Nein") — sein Widget
deklariert die Sterne-Skala, während 69 628 von 69 688 Werten
`containsAdvertisement/yes|no` lauten, das Repository schweigt also. Sie ist
Rückfallebene, kein Vorrang. Das schränkt die Regel „keine Vokabular-Tabelle"
ein, ohne sie aufzuheben: sie schützt vor einer dritten Quelle, die einer Instanz
hinterherhängt — hier gibt es nichts, wovon sie abweichen könnte.

**Drei Messfallen**, festgehalten weil sie diese Sitzung Zeit gekostet haben:
`skipCount` über ~10 000 antwortet HTTP 500 (eine frühere Sonde schien mit
550 000 durchzukommen — sie hatte die Schleife vorher verlassen); der Kopf einer
leeren Anfrage ist keine Stichprobe (300 Datensätze ohne einen Träger eines
Feldes auf 12 % des Korpus); und ein Datensatz kann im Index stehen und beim
Knotenlesen 404 antworten.

**Tore:** `npm test` → **2039 pass, 0 fail** (5 neue Zusicherungen, alle vorher
rot gesehen) · `tsc` → 0 · `lint` → 0.

**Live gegen Staging** — `get_node_details` auf „Addition ohne
Zehnerüberschreitung" (`0d2e90fe…`, grundschulkoenig.de), beide Ausgabeformate:
`Zugang: ohne Anmeldung` · `Kosten: zusätzliche Inhalte / Features per Kauf
möglich` · `Werbung: Ja` · `Barrierefreiheit: Nicht geprüft`. Ohne den Schalter
ist die Ausgabe unverändert.

### Review-Runde ✅ 2026-08-18 — 5 Befunde, alle behoben

**2 MINOR, 3 NIT.** Beide MINOR waren in Code, den dieselbe Sitzung geschrieben
hat.

**Die Rückfall-Tabelle wurde über die Prototypenkette befragt.** `VOCAB_FALLBACK`
ist ein Objektliteral, und der Schlüssel kommt aus dem Repository: ein Datensatz
mit `…/containsAdvertisement/toString` erzeugte die Zeile
`Werbung: function toString() { [native code] }`, `constructor` und
`hasOwnProperty` ebenso, `__proto__` ergab `[object Object]`. Ausgeführt, nicht
vermutet. Jetzt `Object.hasOwn`. Bemerkenswert: die Schwesterfunktion
`labelFromUri` (`vocabs.ts`) hat die Lage nicht, weil sie ein ARRAY durchsucht —
der Befund war also keine Konsistenz mit dem Bestand, sondern eine Abweichung
davon.

**Die Testvorrichtung kannte die zwei neuen Felder nicht.** `ACCESS_PROPS` trug
nur die drei alten, also prüfte auf Werkzeugebene nichts `Kosten`/`Werbung` —
insbesondere nicht der Negativtest, der die Zusage des Plans trägt („die Ausgabe
ohne den Parameter bleibt unverändert"). Er deckte drei von fünf Zeilen ab.
`ccm:containsAdvertisement` steht in der Vorrichtung jetzt bewusst **ohne**
`_DISPLAYNAME` — das ist die gemessene Realität und zieht den Rückfallpfad durch
beide Werkzeuge statt nur durch den Unit-Test.

Beide Wächter wurden mit eingespieltem Fehler geprüft: `Object.hasOwn`
zurückgedreht → `not ok 11`; eine einzelne `Kosten:`-Zeile unbedingt gerendert
→ `not ok 16` (mit der alten Dreier-Liste wäre sie grün geblieben).

**Drei NITs:** Bezugsgröße im Modulkopf mischte zwei Läufe (590 186 → 590 209);
`survey-metadata.mjs` sagte noch „drei Gruppen“ und „we do not cover today“;
Abschnitt 8 der Erhebung vom 17.8. beschrieb das Skript vor der vierten Gruppe
(übrige Felder 179 → **177**, gemessen). Beim Wiederlesen selbst gefunden und
mitgenommen: `accessInfoLines` sprach von „the three lines“.

**Tore:** `npm test` → **2040 pass, 0 fail** · `tsc` → 0 · `lint` → 0 · Live
gegen Staging unverändert korrekt (`Werbung: Ja` weiterhin aus der Tabelle).

Nichts committet.

## Anleitungsebenen getrennt + Optik live geprüft ✅ 2026-08-18

**Live-Test des ausgelieferten Servers** (`wlo-mcp.87.106.195.152.nip.io`): 42
Werkzeuge, anonym 200, Müll-Bearer 401, beide OAuth-Discovery-Dokumente, CORS-
Ausnahme nur auf `/auth/ticket`, alle vier privaten Adressen von `get_url_text`
abgelehnt — und `Kosten:`/`Werbung:` aus der Produktion, also ist der Stand von
heute ausgeliefert.

**Optik-Registry geprüft.** Struktur kommt exakt richtig an: H1 + Vorrede + zwei
Blöcke → „Gilt immer", `## Browserplugin` ohne Skills → `Kontext (0)`,
`## Redaktionsumgebung` → `Kontext (1)`. Verengung leckt nichts: `narrowRegistry`
nimmt nur `context === ctx.path` plus die kontextfreien, und der wortgetreue
Auszug nur den angefragten Abschnitt — durch drei bestehende Wächter gedeckt.
**Die 28 Einträge von 2026-08-12 gibt es nicht mehr** (Redaktion hat das Dokument
auf 985 Zeichen / 3 Blöcke umgebaut, Nutzerentscheidung); `CLAUDE.md` korrigiert.
Ein Skill (`431893a7…`) antwortet **HTTP 403** — nicht öffentlich freigegeben,
redaktionell zu beheben; deshalb sagt die Sammlungs-Zeile „3 freigegebene Skills"
und `get_skill_registry` listet 2 plus einen unter „Nicht auflösbare Verweise".

**Geändert:** die zwei Anleitungsebenen werden nicht mehr zu einem Absatz
verkettet. `contextInstructions` liefert `{scope, title, text}`,
`subjectRegistryText` rendert eine Zeile je Ebene mit Beschriftung. `flattenText`
läuft dabei je TEIL — über den Block angewandt macht es die Trennung sofort
wieder rückgängig, weil es jeden Whitespace-Lauf kollabiert.

**Eigener Fehler beim Bauen, hier festgehalten:** ein Python-Schnitt
(`b[:start]`) beim Reparieren eines Testliterals hat **11 Tests** am Dateiende
von `tests/tools-registry-cache.test.ts` gelöscht. Aufgefallen ist es nur, weil
die Gesamtzahl von 2040 auf 2030 fiel — die Suite war grün. Wiederhergestellt
aus `C:/Users/jan/github/wlo-mcp-sc` (Stand 13:54, bis Zeile 622 zeichengleich).
**Merksatz: eine grüne Suite ist kein Beleg dafür, dass die Tests noch da sind
— nur die Anzahl ist es.**

**Tore:** `npm test` → **2041 pass, 0 fail** · `tsc` → 0 · `lint` → 0 · lokal
gegen die echte Optik-Sammlung geprüft (beide Ebenen getrennt und benannt).

Nichts committet.

## Beschreibungen am benannten Kontext ✅ 2026-08-18

Nutzerwunsch: die Sammlungs-Oberfläche soll Beschreibung und Keywords mitgeben,
„es werden nicht so viele je Sammlung". **Gemessen, bevor gebaut:** für Optik
(3 Skills) sind es +3 Metadaten-Abrufe und +1 027 Zeichen — für dasselbe Dokument
sechs Tage vorher (28 Skills) wären es +28 Abrufe und ~9 585 Zeichen gewesen, und
`REGISTRY_MAX` erlaubt 100. Zwei Multiplikatoren kamen dazu: die Übersicht ohne
Kontext bedient bis zu **10** Sammlungen je Anfrage aus dem Cache, und
`REGISTRY_INLINE_MAX` (12 Zeilen) hätte einen Vier-Skill-Kontext in die Kurzform
ohne nodeIds gekippt — mehr Information hätte die Antwort schlechter gemacht.

**Gebaut wurde daher: Beschreibungen nur am benannten `skillContext`, keine
Keywords** (Nutzerentscheidung; gemessen ~175 Zeichen je Skill gegen ~170 für die
Beschreibung). `describeEntries` läuft **nach** dem Verengen — ein Abruf je
gezeigtem Skill, nicht je deklariertem. Die Beschreibungen stehen unter der Liste,
außerhalb des Zeilenbudgets. Die kostenlose Übersicht ist unberührt und durch
einen eigenen Test gedeckt, der die Metadaten-Abrufe auf 0 zählt.

Zwei Ungenauigkeiten, die erst der Live-Lauf zeigte und die beide von dieser
Änderung kamen: die erste Beschreibungszeile verlor ihre Einrückung (`capText`
trimmt — eingerückt wird jetzt NACH dem Kappen), und die Kopfzeile bot weiter
„Beschreibungen mit get_skill_registry" an, obwohl sie danebenstanden. Dafür hat
`registrySummaryLines` einen vierten `reach`-Fall (`opts.described`), der
Schlagworte und das Dokument nennt.

**Tore:** `npm test` → **2045 pass, 0 fail** · `tsc` → 0 · `lint` → 0.
**Live gegen Optik:** ohne Kontext 2 Anfragen / **0** Metadaten / 914 Zeichen ·
mit `"Redaktionsumgebung"` 5 Anfragen / 3 Metadaten / 2 097 Zeichen, alle drei
Beschreibungen gleichmäßig eingerückt.

**Offen (Betreiber/Redaktion):** `Skill_Qualitätscheck_Sachrichtigkeit`
(`431893a7…`) ist nicht öffentlich freigegeben — mit Dienstkonto löst er auf, anonym
403. Solange das so ist, sagt die Sammlungs-Zeile „3 freigegebene Skills" und
`get_skill_registry` listet 2 plus einen unter „Nicht auflösbare Verweise".

Nichts committet.

### Nachtrag: Beschreibungen auch ohne Kontext, Deckel 3 ✅ 2026-08-18

Nutzerentscheidung nach der Messung: die Beschreibungen sollen **auf beiden**
Pfaden der Sammlungs-Oberfläche stehen, begrenzt auf die **ersten drei** Skills
je Sammlung; ab dem vierten bleibt es bei Titel + nodeId.

`DESCRIBED_MAX` = 3 ist damit ein Deckel auf die **Abrufe**, nicht nur auf die
Ausgabe — das ist der Grund, warum es tragfähig ist: eine Registry darf 100
Skills deklarieren. Gerendert wird an **einer** Stelle (`skillDescriptionLines`),
weil beide Pfade sie brauchen und eine zweite Kopie still den Deckel verlöre. Der
Katalog an SUCHTREFFERN (Cache, bis zu 10 Sammlungen je Anfrage) ist unberührt.

**Mitbehoben:** ein Skill, dessen Kopf sich nicht lesen ließ, wird als „Nicht
abrufbar (geprüft für die ersten 3)" benannt statt mit „laden mit get_skill"
angeboten. Wir bezahlen den Abruf ohnehin, also wissen wir es — und der Satz
nennt seine eigene Reichweite, weil der Deckel die übrigen ungeprüft lässt.

**Zwei bestehende Zusicherungen umgeschrieben, nicht gelöscht.** Beide pinnten
den alten Vertrag „0 Metadaten-Abrufe in der Übersicht", den diese Entscheidung
aufhebt. Sie prüfen jetzt, was weiterhin gilt: `all` löst **kein** erneutes Lesen
des Dokuments aus, und die Übersicht bleibt bei **höchstens drei** Abrufen —
niemals einer je deklariertem Skill.

**Tore:** `npm test` → **2048 pass, 0 fail** · `tsc` → 0 · `lint` → 0.
**Live gegen Optik:** ohne Kontext 5 Anfragen / 3 Metadaten / 1 572 Zeichen ·
mit `"Redaktionsumgebung"` 5 / 3 / 2 097 Zeichen, beide mit allen drei
Beschreibungen.

**Nicht live belegt:** die „Nicht abrufbar"-Zeile. Lokal läuft die Erhebung mit
Dienstkonto, und damit ist der 403-Skill lesbar — der Fall ist durch einen Test
gedeckt, nicht durch einen Lauf gegen echte Daten.

Nichts committet.

### Nachtrag 2: Katalog vollständig an jeder Sammlungs-Antwort ✅ 2026-08-18

Zielbild des Nutzers: an den sammlungs- und themenseiten-relevanten Werkzeugen
hängt **immer** der Katalog mit den allgemeinen Skills **und Anweisungen**; ein
mitgegebener Kontext verengt auf das Relevante, wie `get_skill_registry`; und die
übrigen Kontexte werden genannt, damit ein zweiter Aufruf genauer wird.

**Gemessen, bevor gebaut:** warme Übersicht 286–393 ms gegen **1 851 ms** mit
Dokument-Lesen. „Immer die Anweisung" durfte also nicht heißen „immer das
Dokument lesen". Die allgemeine Anweisung ist 356 Zeichen (Optik) — klein genug
für den Cache.

**Gebaut:** `CacheEntry.generalInstruction`, **nicht** `CachedRegistry` — Letzteres
IST das Feld, das ein Suchtreffer-Knoten trägt, und Prosa dort läge in jedem
Treffer. Gedeckelt beim SPEICHERN (1200 Zeichen): der Cache hält bis zu 2000
Einträge, ungedeckelt wäre die Eintragsgrenze keine Speichergrenze. Ein Treffer
behält seinen eigenen Kontext in der Gliederung, wodurch Kontext-Skills und
immer geltende getrennt erscheinen; darunter „Weitere Kontexte in dieser
Registry: …".

**Zwei falsche Sätze mitgefunden und korrigiert:** „in 1 Kontexten" (falscher
Plural, betraf auch die Übersicht) und die Kontextzahl auf einer verengten
Antwort — die war die der SICHT in einem Satz, der wie eine Aussage über die
Registry liest. Verengt wird jetzt gar keine Zahl genannt.

**Eigener Fehler, zum zweiten Mal in dieser Sitzung:** ein Bash-Heredoc hat einen
Backslash geschluckt, `\b` wurde in Python zu einem **Backspace-Byte** und landete
in `tests/formatter.test.ts`. Gefangen hat es der Wächter „no source file carries
a raw control character" — nicht ich. **Konsequenz: Test- und Quelltexte mit
Regexen gehen über eine Skriptdatei (Write), nicht über einen Heredoc.**

**Tore:** `npm test` → **2052 pass, 0 fail** · `tsc` → 0 · `lint` → 0.
**Live gegen Optik:** Übersicht 2 093 Zeichen mit Katalog + allgemeiner Anweisung ·
`"Redaktionsumgebung"` 2 287 Zeichen mit getrennter Gruppierung, „Weitere
Kontexte: Browserplugin (0)" und beiden Anweisungsebenen.

Nichts committet.

### Review-Runde ✅ 2026-08-18 — 4 Befunde, alle behoben

**3 MINOR, 1 NIT**, alle in Code dieser Sitzung.

**Der eine, der funktional zählt:** die neue Zeile „Weitere Kontexte" bot den
BLANKEN Überschriftentext an (`c.title`), während `resolveContext` zuerst gegen
den PFAD vergleicht und eine Überschrift, die sich unter zwei Eltern wiederholt,
als `ambiguous` meldet. Bei einem Unterkontext ist `title` = „Material", `path` =
„Planung/Material" — die Empfehlung war also ein Aufruf, der nicht greift. Jetzt
`c.path`, wie der Kontext-Index es ohnehin druckt.

**Der Test dazu war beim ersten Anlauf grün und trotzdem wertlos:** er prüfte nur
den ERSTEN angebotenen Namen, und der ist eine H2 mit eindeutiger Überschrift. Er
prüft jetzt JEDEN angebotenen Namen im Rundlauf. Mit `c.title` eingespielt:
`"Material" must not come back as ambiguous`.

**Drei Kommentar-/Doku-Befunde**, alle von den Änderungen desselben Tages falsch
gemacht: ein überholter Block, der das Gegenteil des Codes begründete („die
Gliederung wird fallen gelassen"); die Zusage, der Cache halte „nicht die Prosa"
(er hält jetzt die allgemeine Anweisung, nur nicht die je Kontext); und „ein
Katalog kostet nichts", während die Übersicht bis zu drei Metadaten-Abrufe zahlt.

**Tore:** `npm test` → **2053 pass, 0 fail** · `tsc` → 0 · `lint` → 0.

Nichts committet.

---

## Kompendiumstext: Inhaltsverzeichnis + gezielte Passagen (BM25) ✅ 2026-08-18

Entwurf + Aufgaben: `docs/plans/2026-08-18-kompendium-bm25-design.md`.
`get_compendium_text` nimmt einen `query`; jede Antwort beginnt mit dem
Inhaltsverzeichnis.

**Gemessen vor dem Bauen** (Staging, 158 Sammlungen, 11 mit Kompendiumstext).
Drei Bauarten sind daran gescheitert, bevor sie geschrieben wurden: „je H1
kappen" hätte jedes Dokument als Ganzes gekappt (10 von 10 tragen genau eine H1,
die Inhalte liegen in H2); ein roher Absatz ist die falsche BM25-Einheit (329
von 972 unter 40 Zeichen, die Längennormalisierung hebt Tabellenzeilen über die
Prosa); und ein ganzer Abschnitt wäre zu grob (größter Eigentext 16 317 Zeichen).

**Neu:** `src/text-bm25.ts` (rein) · `src/services/compendium-view.ts` (rein) ·
`WLO_COMPENDIUM_SECTION_MAX`, Standard 2000, in `.env.example` und
`docker-compose.yml`.

**Ein Test hat eine Prämisse widerlegt.** Die Zusicherung „eine Überschrift mit
`\r` darf keine Gliederungszeile fälschen" ging rot — nicht weil der Schutz
fehlte, sondern weil der Fall nicht existiert: JavaScripts `.` schließt `\r`
aus, die Zeile gilt gar nicht als Überschrift. Kommentar und Test sagen jetzt
das Gemessene statt des Vermuteten; der `oneLine`-Aufruf bleibt, weil die Zusage
dem Renderer gehört und nicht der Zeichenklasse des Parsers von heute.

**Live gegen Optik (65 250 Zeichen), durch das Werkzeug:**

| Aufruf | Antwort | ms |
|---|---|---|
| ohne `query` | 20 802 Zeichen, `truncated=true`, `charCount=65250` | 1 121 |
| `"Lehrplan Thüringen Regelschule"` | 4 964 Zeichen, 8 Passagen, **nicht gefunden: thüringen, regelschule** | 588 |
| `"Brechung an der Linse"` | 8 725 Zeichen, 8 Passagen, nichts unbeantwortet | 833 |
| `"Quantenfeldtheorie Stringtheorie"` | 2 083 Zeichen (nur Inhaltsverzeichnis), **kein** `isError` | 466 |

**Tore:** `npm test` → **2086 pass, 0 fail** · `tsc` → 0 · `lint` → 0.

Nichts committet.

### Review-Runde ✅ 2026-08-18 — 7 Befunde, alle behoben

`/better-coding-review` über dasselbe Paket: 0 kritisch, **1 schwer**, 4 mittel,
2 Kleinigkeiten.

**Der schwere war eine gebrochene Symmetrie, die ich selbst eingebaut hatte.**
`queryTerms` trennt nur an Leerraum, die Dokumentseite an `[\p{L}\p{N}]+` — ein
Suchwort mit Bindestrich, Schrägstrich oder Satzzeichen konnte deshalb KEIN
Token treffen. Gemessen am echten Optik-Text (nennt „Rheinland-Pfalz" siebenmal):
`"Lehrplan Rheinland-Pfalz"` meldete `rheinland-pfalz` als **nicht gefunden**.
Ebenso verlor `"Wellenoptik?"` sein Wort ans Fragezeichen — bei einem
Chat-Werkzeug der Normalfall. Damit log genau die Zeile, die dieses Paket als
Ehrlichkeits-Zusage führt. `termMatches` war bisher immer auf ein ganzes
Textfeld angewandt, wo `includes` den Bindestrich mitnahm; erst das Tokenisieren
der Dokumentseite hat das gebrochen. Behoben in `normalizedTerms`: die Anfrage
läuft durch denselben Tokenizer, `queryTerms` behält die Stoppwort-Hoheit.
Nach dem Fix: `nicht gefunden: []` für alle drei Proben.

**Ein Test hat mich dabei korrigiert.** Meine Zusicherung „`Was sagt der Text zur
Wellenoptik?` findet alles" ging rot — zu Recht: „was", „sagt", „text" fehlen dem
kleinen Fixture wirklich. Die Zusicherung sagt jetzt, was gilt, und hält fest,
warum die Liste so bleibt (das Werkzeug erbittet einen Suchtext, und zu
entscheiden, welches Wort des Aufrufers „zählte", wäre Raten). Am echten
65-kB-Text tritt das Rauschen nicht auf.

**Die übrigen sechs:** doppelte Suchwörter zählten doppelt und standen zweimal in
`unmatched` · `Bm25Result.matched` hatte keinen Leser und ist gestrichen · der
Entwurf versprach Passagen „mit Punktzahl", die der Code nicht führt (Vertrag
korrigiert, mit dem Grund: ein roher BM25-Wert ist zwischen Anfragen nicht
vergleichbar) · Zahlendrift 18 725 gegen 18 744 in vier Dokumenten (18 725 war
die Schätzung vor der Umsetzung, nie nachgemessen) · eine titellose Überschrift
erzeugte ein leeres `- ` in der Gliederung und ein leeres `### ` über der Passage
(jetzt durchsichtig, sie erbt den Pfad des benannten Abschnitts darüber) · die
`outputFormat`-Beschreibung versprach ein `outline`, das ein Eintrag ohne
Kompendiumstext nicht trägt.

**Toolbeschreibungen geprüft** (die ausdrücklich gestellte Frage): angepasst,
676 von 1024 Zeichen, nennt `query`, Beispiel und Inhaltsverzeichnis. Kein
anderes Werkzeug nennt das Kompendium in seiner Beschreibung, also keine
Querverweis-Drift; `includeCompendium` in `search_wlo_content` sagt weiter
„vollständigen Kompendiumstext" und bleibt richtig, weil `getCompendiumTexts`
unverändert ist.

**Nicht geändert, deine Entscheidung:** das Inhaltsverzeichnis ist ungedeckelt,
während der Körper gedeckelt ist (gemessen 16–61 Zeilen). Du hast das volle
Verzeichnis ausdrücklich verlangt.

**Tore:** `npm test` → **2092 pass, 0 fail** · `tsc` → 0 · `lint` → 0 ·
`npm run build` → 0. Live gegen Optik unverändert: 20 802 / 4 964 / 8 725 /
2 083 Zeichen.

Nichts committet.

### Doku-Durchgang + CI-Ursache ✅ 2026-08-18

**Doku.** Der neue Parameter und die neue Einstellung stehen jetzt überall dort,
wo jemand sie sucht, nicht nur im Werkzeugeintrag: `WLO_COMPENDIUM_SECTION_MAX`
in den Konfigurationstabellen beider READMEs und in `docs/DEPLOYMENT.md`
(vorher nur als Prosa erwähnt — die kanonischen Tabellen kannten sie nicht) ·
`src/text-bm25.ts` und `src/services/compendium-view.ts` im Modulbaum beider
READMEs · ein Erklärblock in `docs/TOOLS.md` nach dem Muster des
Kontexte-Abschnitts (zwei Formen, Beispiele, was die Antwort über sich selbst
sagt) · die Zeile in `docs/INTEGRATION.md` · und **O11** in `PERFORMANCE.md`
und `PERFORMANCE.de.md` mit der Messtabelle, denn das ist der Ort, an dem dieses
Projekt Token- und Latenzänderungen führt.

**Die GitHub-Pipeline scheiterte an einem Test — und es war keine Codefrage.**
`not ok 271 - no document states a tool count the server contradicts`, mit einem
nackten `ENOENT ... open '.../CLAUDE.md'`. Lokal grün, weil die Datei hier liegt;
im Repository liegt sie nicht, sie wurde nie hochgeladen (nicht gitignored).
`tests/docs-claims.test.ts` führt sie in `COUNTED_DOCS`, weil sie Toolzahlen
nennt.

Gefunden wurde das durch Ausschluss und dann durch Nachbau, nicht durch Raten:
Node 20 lokal (die CI-Version) lief 2092/2092 durch, also lag es nicht an der
Laufzeit; `src/` und `tests/` sind zwischen Repository und Arbeitskopie
byte-identisch, also lag es nicht am Code. Erst ein Klon des öffentlichen
Repositories mit anschließendem Suitelauf zeigte den Test — und mit
hineinkopierter `CLAUDE.md` lief derselbe Klon 2092/2092.

**Behoben ist nur die Diagnostizierbarkeit**, denn die Ursache ist ein Upload:
`read()` in `docs-claims.test.ts` nennt jetzt die Datei und sagt, dass sie ins
Repository gehört. Es bleibt ein harter Fehlschlag — ein Dokument, das still
übersprungen wird, ist eine Prüfung, die aufgehört hat zu laufen und weiter grün
meldet.

**Offen und beim Nutzer:** `CLAUDE.md` mit hochladen (oder sie aus `COUNTED_DOCS`
streichen, falls sie bewusst nicht ins Repository soll — die Fehlermeldung nennt
beide Wege).

**Tore:** `npm test` → **2092 pass, 0 fail** (auch unter Node 20) · `tsc` → 0 ·
`lint` → 0.

Nichts committet.

#### Nachtrag: der Lint-Fehler war lokal die ganze Zeit da (2026-08-18)

Die Pipeline scheiterte im nächsten Lauf an ESLint, an genau der Zeile, die der
Eintrag darüber hinzugefügt hat: `preserve-caught-error` — ein `throw` im
`catch` ohne `{ cause }`. Behoben, mit dem ursprünglichen `ENOENT` als `cause`,
denn dessen aufgelöster Pfad ist es, der ein fehlendes Dokument von einer
falschen Wurzel unterscheidet. Nachgeprüft, dass der Reporter weiterhin die
AUSSAGE zeigt und nicht die Ursache.

**Der Befund über den Befund ist wichtiger.** ESLint war lokal und in der CI
dieselbe Version (10.8.1), und der Fehler stand lokal im Baum — ich hatte das
Tor durch `npm run lint 2>&1 | tail -1` geführt. Das schneidet die Meldung ab
UND ersetzt den Exit-Code durch den von `tail`, also durch 0. Ein Gate durch
eine Pipe zu schicken, die seinen Ausgang verschluckt, ist kein Gate. Seither
laufen `lint`, `typecheck`, `build` und `test` ungefiltert und mit
ausgegebenem `$?`.

**Tore (ungefiltert, mit Exit-Code):** `npm test` → exit 0, **2092 pass, 0
fail** · `npm run lint` → exit 0 · `tsc` → exit 0 · `npm run build` → exit 0.

#### Nachtrag II: `CLAUDE.md` aus `COUNTED_DOCS` (2026-08-18, Nutzerentscheidung)

Der dritte Pipeline-Lauf scheiterte wieder an demselben einen Test — der
Lint-Fix war im Repository, also lief `npm test` erstmals wieder an und traf auf
dieselbe fehlende Datei. `CLAUDE.md` stand in `COUNTED_DOCS`, war aber **noch
nie** im Repository. Der Test verlangte damit eine Datei, die dort nicht
hingehört.

Entscheidung des Nutzers: aus der Liste streichen, statt 1521 Zeilen interner
Messungen und Entwurfsbegründungen öffentlich zu machen. Es kostet keine
Abdeckung, die ein Leser bemerkt — die fünf verbleibenden Dokumente
(`README.md`, `README.de.md`, `docs/TOOLS.md`, `docs/TOOLS-KOMPAKT.md`,
`docs/INTEGRATION.md`) sind die, die dieses Projekt veröffentlicht, und jede
Zahlenaussage darin wird weiter geprüft. Der klarere Fehlertext von Nachtrag I
bleibt: er gilt jetzt für diese fünf.

**Die eigentliche Lehre betrifft aber mein Vorgehen, nicht den Test.** Ich habe
dreimal „lokal grün" gemeldet und dreimal ist die Pipeline gefallen, weil der
Unterschied nicht im Code lag, sondern im ZUSTAND DES REPOSITORIES nach einem
manuellen Upload — etwas, das ein lokaler Lauf grundsätzlich nicht sehen kann.
Seither wird die Pipeline nachgebaut statt beschrieben: Repository klonen, den
geplanten Upload darüberlegen (ohne die Dateien, die der Nutzer nicht hochlädt),
und `build → typecheck → lint → test` in der Reihenfolge der CI durchlaufen
lassen. Dieser Lauf, gegen `0b9431a` + Upload, ohne `CLAUDE.md`:

| Schritt | Exit |
|---|---|
| `npm run build` | 0 |
| `npm run typecheck` | 0 |
| `npm run lint` | 0 |
| `npm test` | 0 — **2092 pass, 0 fail** |

Nichts committet.

### Live-Abnahme gegen den deployten Server ✅ 2026-08-18

`https://wlo-mcp.87.106.195.152.nip.io/mcp`, anonym (der Server meldet
„Zugriff ohne Anmeldung").

**Deploy = Repository, vollständig abgeglichen:** 42 Werkzeuge auf beiden
Seiten, keins nur hier oder nur dort, **keine abweichende Beschreibung und kein
abweichender Parametersatz** — verglichen wurde jede der 42 Beschreibungen und
jede Parameterliste gegen einen lokal registrierten Server.

**Kompendium Optik (65 250 Zeichen Quelltext), Inhaltsverzeichnis in JEDER Antwort:**

| Aufruf | Antwort | ms | nicht gefunden |
|---|---|---|---|
| ohne `query` | 20 802 Z., `truncated=true`, `charCount=65250` | 662 | — |
| `Lehrplan Bayern` | 4 933 Z., 8 Passagen | 728 | **bayern** |
| `Linsen` | 8 084 Z., 8 Passagen | 1 528 | — |
| `Licht` | 8 097 Z., 8 Passagen | 379 | — |
| `Brechung Totalreflexion` | 8 559 Z., 8 Passagen | 317 | — |
| `Rheinland-Pfalz` | 4 926 Z., 8 Passagen | 352 | — |
| `Was steht zur Wellenoptik?` | 7 004 Z., 8 Passagen | 410 | — |
| `Photosynthese Zellatmung` | 2 067 Z. (nur Inhaltsverzeichnis), **kein** `isError` | 311 | photosynthese, zellatmung |

Die beiden Zeilen, die den Review-Befund belegen: **`Rheinland-Pfalz`** (Bindestrich)
und **`Was steht zur Wellenoptik?`** (Fragezeichen) melden nichts als fehlend —
vor dem Fix hätten beide ihr Wort verloren. Und `Lehrplan Bayern` zeigt, wozu die
Offenlegung da ist: Optik führt nur Lehrpläne aus Rheinland-Pfalz und Sachsen, die
Antwort sagt „Nicht gefunden: bayern" statt acht RLP-Passagen als bayerische
auszugeben.

**Skillkatalog:** `get_skill_registry` liefert 3 freigegebene Skills;
`context:"Redaktionsumgebung"` verengt auf 1 + „Gilt immer (2)"; ein unbekannter
Kontext ist **kein Fehler**, nennt die vorhandenen (Browserplugin ·
Redaktionsumgebung) und liefert den ganzen Katalog. Der Katalog hängt live an
`get_collection_contents`, `search_wlo_within_collection`,
`get_topic_page_content`, `get_node_details` und den Sammlungstreffern der Suche.

**Zugangs-/Qualitätsmetadaten:** über sechs Materialien geprüft — `includeAccessInfo`
liefert `Zugang: ohne Anmeldung` / `Kosten: nein`, ohne das Flag **null** solcher
Zeilen (die opt-in-Zusage hält live), und der JSON-Zweig trägt
`accessInfo: {conditionsOfAccess, price}`. Die Beschriftung „nein" stammt vom
`_DISPLAYNAME` des Repositories, nicht von uns.

**Drei Fehlschläge in diesem Durchlauf waren Fehler im TESTSKRIPT, nicht im
Server** — und die Verwechslung ist lehrreich genug, um sie zu notieren:
`get_skill_registry` nimmt `collectionId`, `search_wlo_within_collection` dagegen
`nodeId`; und der Skillkatalog reist als **eigener Content-Block**, nicht in
`content[0]`. Wer nur den ersten Block liest, sieht ihn nicht und hält das für
eine Regression.

### Nachprüfung Qualitätsmetadaten & Vokabulare — 1 Befund behoben ✅ 2026-08-18

Auf die Frage, ob der Server mit den Qualitätsmetadaten ARBEITEN kann und ob die
Vokabulare stimmen. Drei Antworten, alle gemessen.

**1. Schreiben: nein, und zwar absichtlich.** `WRITABLE_FIELDS` hat 16 Einträge
und **kein einziges** Qualitätsfeld; `validateField` lehnt
`ccm:oeh_quality_correctness` (Sachrichtigkeit) und die vier Geschwister mit
Begründung ab, und `wlo_suggest_metadata` geht durch dieselbe Prüfung — ein
Qualitätswert kann also nicht einmal VORGESCHLAGEN werden. Der Grund steht seit
dem 17.8. fest und wurde heute an einem echten Träger bestätigt:
`ccm:oeh_quality_correctness_DISPLAYNAME` ist **leer**, `neutralness = ["4"]`
ebenso — wir könnten den Wert, den wir schrieben, nicht benennen.

**2. Vokabulare: korrekt.** Live gegen den Server geprüft: `CC BY` heißt `CC BY`
(die „4.0"-Schreibweisen stehen nur noch als ALIAS, wie am 12.8. entschieden),
`COPYRIGHT_FREE` heißt „Copyright, freier Zugang" und nicht mehr das Gegenteil,
`cc_by_sa_nc` ist Alias von `CC_BY_NC_SA`, `COPYRIGHT_LICENSE` ist da. Die
Verarbeitungsrichtung stimmt ebenfalls: „CC BY-SA" wird angenommen, „CC XY"
abgelehnt mit Liste, „Arbeitsblatt" löst auf `new_lrt/36e68792…` auf, „Physik"
auf `discipline/460`, und `ccm:oeh_lrt_aggregated` wird mit dem Hinweis
abgelehnt, dass das Repository es ableitet.

**3. Lesen: ein Befund, behoben.** Derselbe Datensatz trug
`ccm:containsAdvertisement = ["5"]` mit leerem `_DISPLAYNAME` — die Sterne-Skala
statt des yes/no-Vokabulars —, und die Antwort druckte **`Werbung: 5`**. Neben
`Kosten: nein` liest sich das wie eine beschriftete Aussage, und die Richtung
ist nicht rekonstruierbar. `labels()` verwirft jetzt einen rein numerischen
Slug. Rot-grün eingespielt; am echten Datensatz bleibt
`["Kosten: nein","Barrierefreiheit: A (am niedrigsten)"]` und die Werbezeile
fällt weg. Verhältnismäßigkeit gemessen: 63 Wort-Werte gegen 1 Zahl, und
`ccm:license_oer` (numerische Slugs) war auf beiden Trägern beschriftet.

**Eine Messung von heute widerlegt eine Zwischenbehauptung von mir:** „die
Qualitätsfelder sind unsichtbar" hatte ich zuerst an einem Datensatz geprüft,
der anonym **403** antwortet — der Beleg war wertlos. Mit Dienstkonto gegen
denselben Datensatz gelesen: 2 429 Zeichen, **keine** quality-Zeile. Erst das
ist der Beleg.

**Tore:** `npm test` → 2092 pass, 0 fail · `lint` → 0 · `typecheck` → 0.

### Qualitätsmetadaten: Schreibfläche für die fünf Befundfelder ✅ 2026-08-18

Auf die Rückfrage, warum das Schreiben nie umgesetzt wurde. Die Kette war: der
Entwurf knüpfte den schreibenden Support an eine Bedingung („nur für die
Teilmenge, die die Erhebung als vokabular-gestützt ausweist"), die Erhebung fand
11 von 14 Qualitätsfeldern außerhalb ihrer eigenen Deklaration, also blieb
scheinbar keine Teilmenge. **Der Schluss war zu weit** — nachgemessen am 18.8.
sind die 14 Felder ZWEI Familien, und die Erhebung hat sie als eine behandelt.

| Familie | Deklaration | Korpus | Entscheidung |
|---|---|---|---|
| **Befund (5)** — correctness, copyright_law, criminal_law, personal_law, protection_of_minors | ein Vokabular, vollständig beschriftet, unterscheidet **Maschine von Mensch** | 4 von 5 werden bereits so benutzt (52/97 · 54/98 · 50/92) | **schreibbar** |
| **Sterne (7)** — didactics, language, medial, neutralness, transparentness, currentness, data_privacy | URI `quality_x/0…5`, „✰✰✰✰ moderne, gute Methodik" | nackte Ziffer statt URI | bleibt zu |

`correctness` (Sachrichtigkeit) ist die Ausnahme in Familie A: 41 von 41 Werte
sind Sterne. Seine Deklaration ist mit der seiner vier Geschwister identisch,
die Zielschreibweise also nicht offen.

**Gebaut:** `qualityFinding` in `vocabs.ts` (das VOLLE Vokabular, damit
`lookup_wlo_vocabulary` es nicht falsch wiedergibt) · fünf Einträge in
`WRITABLE_FIELDS` mit deutschen Beschriftungen für die Vorschau · ein Riegel
gegen die beiden MENSCH-Werte in `validateField` · fünf Parameter an
`wlo_create_content`/`wlo_update_content`, über `validateField` damit auch an
`wlo_suggest_metadata`. Zwei-Schritt-Bestätigung, Fingerabdruck, Zurücklesen und
Original-Umleitung gelten unverändert.

**Zwei Lese-Befunde derselben Sitzung, behoben:** `Werbung: 5` (Sterne-Rest im
`containsAdvertisement`-Feld, 28 Datensätze) und `Kosten: false` (4 Junk-Werte
unter 339 687). Ein Wert, den weder das Repository noch unsere Rückfallebene
beschriften kann, wird jetzt weggelassen statt als nackte Zahl oder Boolean
ausgegeben — dieselbe Regel, aus der die Sternefelder gar nicht gelesen werden,
angewandt je WERT.

**Vokabular-Abgleich (`npm run sync:vocabs`):** alle sechs hinterlegten
Vokabulare aktuell, kein fehlender Eintrag. Zugangsfelder gegen ihre Deklaration:
`conditionsOfAccess`, `accessibilitySummary`, `license_oer` je **0** Abweichungen,
`price` 4 von 339 687, `containsAdvertisement` 69 678 von 69 688 — dort
deklariert das Widget die Sterne-Skala, während der Korpus `yes/no` speichert,
und genau dafür existiert `VOCAB_FALLBACK`.

**Offen, vorbestehend, nicht in diesem Paket behoben:** die Bestätigungsvorschau
zeigt bei JEDEM Vokabularfeld die rohe URI (`Bildungsstufe: (leer) →
http://…/sekundarstufe_1`). Eine Vorschau soll ein Mensch prüfen können.

**Tore:** `npm test` → **2108 pass, 0 fail** · `lint` → 0 · `typecheck` → 0 ·
`build` → 0.

### Qualitätsskalen lesbar gemacht ✅ 2026-08-18 (Nutzeranstoß)

Der Nutzer fragte nach, was „339 687" bei `ccm:price` zählt, und schloss daraus:
Felder mit 0–5 haben vermutlich kein Vokabular, aber feste Skalen — also legen
wir uns die Wertebereiche selbst an und lesen die Labels aus. **Beides hat
gesessen.**

**Die Zahl:** 339 687 sind BELEGUNGEN, nicht Werte. `ccm:price` hat **5**
verschiedene Werte (`no` 338 017 · `yes_for_additional` 1 058 · `yes` 608 ·
`false` 3 · `true` 1) bei 590 213 Datensätzen im Index. Keine freie Eingabe.

**Die Skalen:** der Metadatensatz deklariert alle zehn **mit Beschriftungen**,
je Feld eigen formuliert (`3` heißt bei Didaktik „✰✰✰ gute Methodik", bei
Neutralität „✰✰✰ ideologisch eingefärbt, aber transparent"). Der Korpus
speichert **beide Formen nebeneinander im selben Feld** — `…/quality_didactics/1`
und eine nackte `"4"` —, und nur die URI-Form kommt mit `_DISPLAYNAME` zurück.
Das ist die Lücke; die Beschriftung existierte, nur das Nachschlagen fehlte.

**Gebaut:** `scripts/generate-quality-scales.mjs` → `src/vocabs-quality-scale.ts`
(10 Skalen, 52 Beschriftungen, aus dem Metadatensatz erzeugt statt erfunden) ·
`src/node-quality.ts` mit 13 Feldern (8 Skalen + 5 Befunde) ·
`includeQualityInfo` an `get_node_details`/`get_nodes_details`, beide Formate.
Reihenfolge der Beschriftung: Datensatz-eigenes `_DISPLAYNAME` → deklarierte
Skala → Befundvokabular; was keine der drei benennt, wird weggelassen.

**Das korrigiert meinen Fix vom selben Tag.** `includeAccessInfo` hatte
`ccm:containsAdvertisement = ["5"]` als unbeschriftbare Zahl WEGGELASSEN. Sie ist
beschriftbar: **5 heißt „✰✰✰✰✰ ohne Werbung"**. Das Weglassen verwarf eine
Tatsache, und das vorherige „Werbung: 5" sagte ihr Gegenteil. Die Weglass-Regel
bleibt für Werte, die keine Quelle benennt.

**Am echten Datensatz** (`7affb314-3f66-4a86-955d-161239ec63b2`), der gestern
gar nichts zeigte:

```
Werbung: ✰✰✰✰✰ ohne Werbung
Didaktik: ✰✰✰ gute Methodik
Sprache: ✰✰✰ angemessen
Medien: ✰✰✰ Medial passend
Neutralität: ✰✰✰✰ neutrale Formulierung
Transparenz: ✰✰✰✰✰ renommierter Anbieter, korrekte Kontaktangaben
Aktualität: ✰✰✰✰ 4- aktueller Wissensstand
```

**Tore:** `npm test` → **2119 pass, 0 fail** · `lint` → 0 · `typecheck` → 0.

### 0–5-Qualitätsskalen schreibbar ✅ 2026-08-19 (Nutzerentscheidung)

**Die verlangte Liste zuerst: es fehlt nichts.** Acht der zehn Skalen sind
vollständig 0–5 deklariert. Die zwei mit nur 0–1 sind keine gekürzten Skalen,
sondern echte Ja/Nein-Fragen — `ccm:oeh_quality_login` („Zugang nur mit Login" /
„Ohne Login zugänglich") und `ccm:oeh_quality_relevancy_for_education` („Nein -
ungeeignet" / „Ja - geeignet"). Nichts zum Nachtragen im Repository.

**Geschrieben wird die DEKLARIERTE Form, und die ist je Feld verschieden:**
sechs Skalen deklarieren die volle URI, `currentness` die nackte Ziffer. Deshalb
führt `vocabs-quality-scale.ts` seit heute `{id, caption}` statt nur der
Beschriftung — eine Ableitung aus dem Schlüssel wäre geraten. Aufrufer dürfen
Ziffer, Beschriftung oder URI schicken; außerhalb 0–5 wird mit genanntem Bereich
abgelehnt.

**Schreibbar: sieben.** didactics · language · medial · neutralness ·
transparentness · data_privacy · currentness. **Nicht schreibbar und warum:**
`login`/`relevancy_for_education` (0–1, keine Skalen) und
`ccm:containsAdvertisement` — es deklariert zwar 0–5, aber 69 628 seiner 69 688
Werte sind `yes`/`no`; ein Stern dort wäre die dritte Schreibweise in dem einen
Feld, das schon zwei trägt.

**Die Bestätigungsvorschau beschriftet jetzt jeden Vokabularwert.** Vorher stand
dort die rohe URI — `Bildungsstufe: (leer) → „http://…/sekundarstufe_1"` —, und
der Bestätigungsschlüssel bindet an genau diesen Satz. Bei Fach und Stufe war das
gerade noch entzifferbar, bei einer Bewertung nicht mehr: „…/quality_didactics/4"
sagt einem Kurator nichts darüber, was er freigibt. Jetzt:

```
Bildungsstufe: (leer) → „Sekundarstufe I“
Fach: (leer) → „Physik“
Sachrichtigkeit (Prüfergebnis): (leer) → „keine Auffälligkeiten gefunden (Maschine)“
Didaktik (Bewertung): (leer) → „✰✰✰✰ moderne, gute Methodik“
Aktualität (Bewertung): (leer) → „✰✰✰✰✰ 5 - hochaktuell/neuester Wissensstand“
```

`PREVIEW_VOCAB` ist bewusst nicht `FIELD_VOCAB`: das eine entscheidet, was
geschrieben werden darf, das andere nur, was ein Satz sagt — so kann ein Feld
lesbar werden, ohne schreibbar zu werden.

**Erlaubnisliste: 28 Felder** (16 → 21 mit den Befunden → 28 mit den Skalen).

**Tore:** `npm test` → **2129 pass, 0 fail** · `lint` → 0 · `typecheck` → 0.

### Die zwei binären Qualitätsfelder aufgenommen ✅ 2026-08-19

Nachgemessen statt aus der Notiz zitiert. Beide deklarieren **genau 0 und 1, als
nackte Ziffern**:

| Feld | 0 | 1 | Korpus |
|---|---|---|---|
| `ccm:oeh_quality_login` | „Zugang nur mit Login" | „Ohne Login zugänglich" | 1 328 / 71 459 — **nichts** außerhalb der Deklaration |
| `ccm:oeh_quality_relevancy_for_education` | „Nein - ungeeignet" | „Ja - geeignet" | 11 / 104, dazu 2 × `true` |

`login` ist damit das sauberste der vierzehn Qualitätsfelder. Beide sind jetzt
schreibbar (`qualityLogin`, `qualityRelevance`) und laufen durch **denselben**
Resolver wie die 0–5-Skalen: der Bereich kommt aus der Skala, nicht aus einer
Annahme, also meldet eine Ablehnung hier „0 bis 1" und dort „0 bis 5", ohne eine
feldspezifische Regel.

**`ccm:oeh_quality_login` wird jetzt auch GELESEN.** Es war bewusst draußen, weil
`ccm:conditionsOfAccess` dieselbe Tatsache dreiwertig und auf 198 699 statt
72 787 Datensätzen sagt. Das Schreiben kippt die Abwägung: ein Feld, das eine
Aufruferin setzen und nicht zurücklesen kann, ist nicht prüfbar — und falls die
beiden je auseinanderlaufen, ist das Verstecken des einen das schlechtere
Ergebnis, nicht das ordentlichere. Es erscheint als `Login:`, die Zugangsfläche
sagt `Zugang:`, damit ein Leser zwei Felder als zwei Felder sieht. Die
Werkzeugbeschreibung von `qualityLogin` warnt vor dem möglichen Widerspruch.

**Erlaubnisliste: 30 Felder.** **Tore:** `npm test` → **2131 pass, 0 fail** ·
`lint` → 0 · `typecheck` → 0.

### Review der Qualitätsmetadaten-Erweiterung — 8 Befunde behoben ✅ 2026-08-19

`/better-coding-review` über den ganzen Änderungsumfang (Skalentabelle,
`node-quality`, `node-access`, `write/fields`, `write/change-set`,
`curation-fields`, `vocabulary`, `node-details`): 1 major, 5 minor, 2 nits. Alle
behoben, jeder mit Test zuerst.

**Der major-Befund war eine Sackgasse in der Fehlerbehandlung.** Zwei Texte —
die Ablehnung einer ungültigen Stufe (`write/fields.ts`) und die Beschreibung
jedes `quality*`-Parameters — verwiesen für die Beschriftungen auf
`lookup_wlo_vocabulary`, und dessen Enum kannte **keine einzige Skala**. Ein
Modell, das danebengreift, bekommt also die Empfehlung, ein Werkzeug zu rufen,
das es mit einem zweiten Fehler abweist. Der zweite genannte Weg
(`get_node_details` mit `includeQualityInfo`) zeigt nur, was ein Datensatz schon
trägt — bei 30–120 bewerteten Datensätzen je Feld auf einem beliebigen Knoten
nichts. Neu: `vocabulary="qualityScale"` nennt jede Stufe jeder schreibbaren
Bewertung samt Beschriftung **und dem Kuratier-Parameter**, der sie setzt (eine
Beschriftung ohne Parameter ist eine halbe Antwort). `ccm:containsAdvertisement`
bleibt draußen, obwohl es eine Skala hat: es ist nicht schreibbar, und es hier
anzubieten hieße, einen Schreibvorgang zu bewerben, der verweigert wird.

Der Wächter dagegen nimmt den Werkzeugnamen aus der **Ablehnung selbst**, ruft
ihn auf und prüft, dass eine der angebotenen Auswahlen die Beschriftung nennt —
ein Verweis, der verrottet, wird damit rot.

**Eine Beschriftung ließ sich überhaupt nicht zurückschreiben.** Das Repository
speichert `quality_currentness/0` als `" 0-A veralteter Inhalt"` mit führendem
Leerzeichen, `validateField` trimmt jede Eingabe — also wurde genau die
Eingabeform abgelehnt, die Parameterbeschreibung und Ablehnung versprechen, von
demselben Satz, der sie gerade gedruckt hatte. Gefixt an der Datenquelle
(Generator trimmt), was nebenbei den doppelten Abstand in `Aktualität:  0-A …`
beseitigt.

Die übrigen: `node-access.ts` erklärte im Kopf weiterhin, warum die
Qualitätsfelder weder lesbar noch schreibbar seien — in einer Datei, die seit
dem Vortag `scaleLabel` importiert; zwei Doc-Blöcke waren beim Einfügen von
ihrem Bezugsobjekt getrennt worden (`VOCAB_FALLBACK`, `renderValues`);
`isScaleProperty` war exportiert und hatte keinen Aufrufer; beide
Detail-Werkzeuge zählen ihre optionalen Anreicherungen auf und ließen die neueste
weg; `qualityFinding` fehlte in der Parameterbeschreibung, in den Tests und in
allen vier Doku-Dateien.

**Nebenbefund beim Kürzen:** `get_node_details` riss dabei die 1024-Zeichen-Grenze,
und der erste Schnitt entfernte die fünf `raw`-Feldnamen — was ein bestehender
Test fing, weil genau diese Aufzählung verhindert, dass die Beschreibung breiter
ist als das Verhalten. Budget stattdessen aus Prosa geholt, an der keine
Zusicherung hängt.

**Zweite Review-Runde, 5 Befunde (0 major):** Der Modulkopf von `vocabulary.ts`
sprach weiter von „filter-value discovery" — dieselbe Klasse, die diese Runde in
`node-access.ts` behoben hatte, im selben Durchgang neu erzeugt. Zwei Wächter
saßen neben ihrem Fix statt darauf: der Caption-Test pinnte die EINE kaputte
Beschriftung über den Renderpfad, obwohl der Fix im Generator sitzt (jetzt eine
Invariante über alle 52 — Verletzung auf einem ANDEREN Feld eingespielt und rot
gesehen), und der Parametertest prüfte zwei Namen stichprobenartig, statt zu
verlangen, dass JEDE gelistete Skala einen Kuratier-Parameter nennt (Verletzung
durch Entfernen von `qualityMedial` eingespielt, rot gesehen). Dazu zwei
Wortlaute: „die niedrigste ist die schlechteste Bewertung" trägt über die beiden
0/1-Felder nicht — das sind Ja/Nein-Fragen, keine Bewertungen —, und beim Kürzen
war „**freigegebenen** Skills" verlorengegangen, das Wort, das eine Registry als
Freigabeliste ausweist. Zeichenneutral zurückgeholt.

**Tore:** `npm test` → **2141 pass, 0 fail** (10 neue Tests) · `lint` → 0 ·
`typecheck` → 0 · `build` → 0. Beide Detail-Beschreibungen liegen bei 1015 von
1024 Zeichen — das Budget ist aufgebraucht, die nächste Ergänzung muss anderswo
kürzen.

### Themenseiten tragen den Skill-Katalog ihrer Sammlung ✅ 2026-08-19 (Freigabe des Nutzers)

Live gegen den deployten Server gefunden: `search_wlo_all("Optik")` listete die
Optik-Themenseite ohne einen ihrer drei freigegebenen Skills, während der
Sammlungs-Topf daneben seinen Katalog trug — eine Themenseite IST ein `ccm:map`,
wurde aber eine Zeile vor der Anreicherung bewusst in den anderen Topf gefiltert
(`searchAll`, der Nachbar `enrichCompendium` nahm schon immer beide). Ein Test
pinnte den Zustand („topic-page results are not enriched") als einziger im File
ohne Begründung; er ist mit Begründung in sein Gegenteil umgeschrieben.

**Der Kern der Lösung ist eine Rückgabetyp-Änderung.**
`ensureRegistries`/`attachCachedRegistries` liefern die **Menge der
beantworteten nodeIds** statt einer Zahl: beide Töpfe teilen sich EINEN Aufruf
(und damit den Live-Fallback-Deckel von 10 — zwei Aufrufe hätten das Budget
einer Suche verdoppelt), und jeder Topf rechnet sein eigenes `registryChecked`
aus der Menge. Eine Zahl kann nicht sagen, zu welcher Seite eine Antwort gehört:
4 beantwortete Ids sind nicht „2 von 2 Sammlungen", und die zählbasierte
Vereinigung hätte die NORMALE (gemischte) Suche als ungeprüft markiert, während
ihre Kataloge in der Antwort stehen — der „nicht geprüft"-Hinweis wäre direkt
unter einem gedruckten Katalog gelandet. Der Hinweis in `content-search.ts`
gattert deshalb jetzt je Topf. `topicPages.registryChecked` ist in
`searchAllEnvelopeSchema` deklariert (zod verwirft Undeklariertes lautlos; ein
Test parst den Envelope durch das Schema).

**`get_topic_page_content` trägt den Katalog im Markdown-Modus INLINE.** Er
reiste als zweiter Content-Block, und mindestens ein realer Client (der eigene
MCP-Client dieser Sitzung) reicht dem Modell nur den ersten durch — der Server
hatte „welche Skills gelten hier?" beantwortet und das Modell sah es nie. Das
war der wahrscheinlichste Sitz des gemeldeten ChatGPT-Problems. JSON behält den
zweiten Block: Block 1 ist dort reines JSON, Prosa darin bräche jeden Parser.
Beide Pfade (Treffer und Leer-Fall) gleich behandelt.

Sechs neue Tests, alle relevanten zuerst rot gesehen (4 rot in
`search-skill-registry`, 1 rot in `tools-topic-page-content`; der
Topf-Unabhängigkeits-Test ist als Regressionswächter gegen die zählbasierte
Vereinigung bewusst vorher wie nachher grün). Ein vierter Test-Standort mit
Zahl-Zusicherung (`skill-cache-disabled.test.ts`) tauchte erst im Vollsuiten-Lauf
auf — grep über drei Dateien war keine Vollsuite.

**Review-Runde (2 Befunde, beide behoben):** Die Kern-Kostenzusage — beide
Töpfe teilen sich EINEN Live-Deckel — stand in drei Kommentaren und dem
CHANGELOG, aber kein Test erzwang sie: zwei getrennte `ensureRegistries`-Aufrufe
hätten jeden bestehenden Test grün gelassen und das Upstream-Budget einer Suche
still auf 16 verdoppelt. Der neue Wächter nutzt 8+8 Sammlungen/Themenseiten
(je Topf UNTER dem Deckel von 10, Vereinigung darüber — ein 5+5-Fixture könnte
die beiden Formen nicht unterscheiden); Verletzung eingespielt: **16 statt 10,
nur dieser Test rot**, danach wiederhergestellt. Dazu das veraltete
Kontrastwort in der `cachedRegistriesFor`-Doc („count" → Id-Menge).

### Master-Skill-Abgleich: Beschreibungen folgen dem gelebten Routing ✅ 2026-08-20

Der Master-Skill des Chatbots wurde als Referenz für die realen Usecases
gelesen; vier Werkzeugtexte und ein Verhaltensfehler folgten daraus, alle mit
Test zuerst (rote Läufe gesehen: B1-JSON-Test, zwei Helfer-Testdateien am
fehlenden Export, REQUIRED-Querverweis).

**V1** `search_wlo_all` behauptete „als Filter, nicht in ein anderes Werkzeug"
— und kämpfte damit gegen das gewollte Routing (Nutzerklärung: Überblick hier,
`search_wlo_content` sobald NUR Einzelmaterialien eines Typs gewünscht sind).
Umformuliert; der Querverweis ist als REQUIRED-Phrase gepinnt. **V2** Vier
Stellen nannten `search_skill` bedingungslos — im Registry-only-Deployment ein
Phantomwerkzeug, das die „keine Registry"-Antwort sogar EMPFAHL; der
Master-Skill musste dagegenhalten („existiert nicht"). Jetzt eine pure Funktion
(`skillFinderName`) über alle drei Modi getestet; Beschreibungen und Antworten
nennen nur Registriertes. **B1** `get_node_collections` hängte den Katalog NACH
dem JSON-Early-Return an — Markdown trug ihn, JSON nicht; dieselbe Klasse wie
die Browse-Werkzeuge am 15.08. Vor den Format-Zweig gezogen. **V3/V4**
Beschreibungen benennen die Kette Material→Sammlung→Skills bzw. die
redaktionelle Dreiteilung des Kompendiums (Weltwissen · Lehrplan-Kompetenzen je
Stufe/Bundesland · Inhaltsvorstellung) und seine Zwecke (Lückenanalyse,
Sachrichtigkeits-Maßstab, Lernpfade).

Dazu ein **Protokoll für die Chatbot-Entwickler** (Scratchpad, an den Nutzer
übergeben): `hasCompendium` ist ein Phantomfeld, die Kompendium-`query` ist
live, Skills laufen über Sammlungen (serverseitig jetzt auch so beschrieben),
drei Deploy-Ankündigungen, `skillContext` spart einen Aufruf,
`lookup_wlo_vocabulary` liefert keine Themen-Synonyme.

**Nacharbeit Doku-Flächen (2026-08-20):** Die vier Flächen trugen die
korrigierten Behauptungen nie — aber beide READMEs sagten an je drei Stellen
noch „one-tool ersetzt search_skill+get_skill … 41 statt 42", den Stand vor dem
2026-08-16 (der Tausch ist 1:1, heute live als 42 gemessen). Der
docs-claims-Wächter prüfte MUSTER und kannte diese Schreibweise nicht; zwei
Muster ergänzt („N tools instead of", „N statt M Werkzeuge"), rot auf beiden
Altlasten gesehen, dann sechs Stellen korrigiert. Dazu die Kompendium-Dreiteilung
in TOOLS.md (Deep-Dive) und TOOLS-KOMPAKT nachgezogen.

**Review-Runde (1 minor, 1 nit):** Die puren Finder-Funktionen und die
Werkzeug-Listen waren je Modus getestet, die VERDRAHTUNG dazwischen nicht — ein
hartkodierter Finder in `registerGetSkill` hätte alles grün gelassen und den
Phantom-Verweis zurückgebracht. Wächter ergänzt (durch das echte
`registerSkillTools`), Verletzung eingespielt und rot gesehen. Der NIT bleibt
als dokumentierte Grenze: `registerSkillRegistryTool` liest den Finder aus der
Env auf Modulebene; Nicht-Standard-Modi sind dort über die exportierten puren
Funktionen getestet, ein Opts-Durchstich nur für Testbarkeit wäre
unverhältnismäßig.

**Tore:** `npm test` → **2153 pass, 0 fail** (5 neue Tests) · `lint` → 0 ·
`typecheck` → 0 · `build` → 0.

### Kompendium-Signal statt Volltext + get_skill-Volltext-Garantie ✅ 2026-08-20 (Nutzerentscheidung)

**Kompendium:** Live gemessen trug EIN Optik-Treffer 37 428 Zeichen Kompendium
inline — 75 % einer 50k-JSON-Antwort, in jedem Format (structuredContent reist
auch bei Markdown mit); der Betreiber-Deckel `WLO_COMPENDIUM_SECTION_MAX` sah
diesen Pfad nie. Nutzerentscheidung: der Text darf nicht mitreisen — der Weg ist
`get_compendium_text` (Inhaltsverzeichnis + gezielte Absätze mit `query`, sonst
je Hauptabschnitt gekappt; genau die seit 18.08. gebaute Form). `formatNode`
setzt jetzt `hasCompendium: true` (im Schema deklariert, Spread wie
`originalId`) und den Text nie; Markdown rendert eine Verweiszeile; die
`includeCompendium`-Anreicherung bleibt der Opt-in für den Volltext und füllt
weiterhin JEDE Lücke (nicht nur signalisierte — der Gap-Fill-Test modelliert
einen Treffer ohne Property trotz vorhandenem Text). `get_node_details` behält
die gekappte Markdown-Vorschau (liest das Property direkt) und trägt im JSON das
Signal. **Der Umbau fand seine eigene Beinahe-Regression:** `getCompendiumTexts`
las den Text DURCH `formatNode` — der Drop hätte das Lieferwerkzeug selbst
geleert; der Gap-Fill-Test wurde rot, der Dienst liest das Property jetzt
direkt. Die alte Docstring am Feld behauptete zudem, DISPLAY_PROPS enthalte das
Property nicht — von der Messung widerlegt, korrigiert.

**get_skill:** Die Frage der Chatbot-Entwickler war berechtigt — der anonyme
Download ist bei 64 KiB gedeckelt, ein größeres SKILL.md kam mit Marker gekürzt.
Nutzerentscheidung: Anleitungen laden ganz. `readSkillText` liest jetzt bis
1 MiB (größter echter Skill ~17 KB; die Schranke ist Speicherschutz, keine
erwartbare Größe) — Registry-Dokumente eingeschlossen, weil beide durch
`readSkillText` gehen. Test mit 90-KiB-Skill: Schwanz kommt an, kein Marker.

Sechs Tests zuerst rot gesehen (u. a. der geflippte formatNode-Pin, der
Envelope-Wächter samt Schema-Überleben, der 90-KiB-Skill); der Plural-Flip war
zunächst nur am NAMEN getauscht — die Zusicherung selbst hatte einen anderen
Wortlaut als vermutet und wurde nachgezogen, bevor Grün etwas bewiesen hätte.

**Nachschärfung (Nutzerentscheidung, gleicher Tag):** Die 1-MiB-Schranke am
Skill-Pfad ist ERSATZLOS entfernt — jede Schranke ist eine Größe, ab der eine
Anleitung still nicht mehr befolgt wird. `readSkillText` liest jetzt unbegrenzt
(`Number.POSITIVE_INFINITY` an `getNodeDownloadText`, dessen 64-KiB-Standard für
alle anderen anonymen Downloads unverändert gilt); der `/textContent`-Rückfall
hat keinen eigenen Deckel (geprüft). Das Restrisiko ist bewusst und ruht darauf,
WAS dieser Pfad liest: kuratierte Datensätze aus dem eigenen Repository, nie
Aufrufer-URLs. Test von 90 KiB auf 1,5 MiB gehoben — rot gegen die
1-MiB-Schranke gesehen, grün nach der Entfernung.

**Tore:** `npm test` → **2156 pass, 0 fail** · `lint` → 0 · `typecheck` → 0 ·
`build` → 0. Live-Verifikation nach Deploy: `search_wlo_all("Optik")` JSON
ohne `compendiumText`, mit `hasCompendium`; `get_compendium_text` liefert wie
bisher; `get_skill` auf einem großen Dokument ungekürzt.

**Tore (Vorgänger-Paket):** `npm test` → **2148 pass, 0 fail** · `lint` → 0 · `typecheck` → 0 ·
`build` → 0. **Live-Verifikation steht aus** (braucht Upload + Deploy durch den
Nutzer): danach muss `search_wlo_all("Optik")` im Themenseiten-Topf die drei
Skills mit nodeIds zeigen, und `get_topic_page_content("Optik")` im Markdown nur
noch EINEN Block.

### Live-Verifikation nach Deploy ✅ 2026-08-20 (31 Proben, alle grün)

Beide ausstehenden Live-Läufe (Themenseiten-Katalog · Kompendium-Signal +
get_skill) am Draht verifiziert — rohes MCP über Streamable HTTP gegen den
deployten Server, nicht durch einen Client (der eigene verschluckt zweite
Content-Blöcke, gemessen am Vortag). 31 Zusicherungen, alle PASS:

- **Modus:** 41 Werkzeuge (registry-only: `search_skill` weg, `get_skill` und
  `get_skill_registry` da); Beschreibungen tragen die Master-Skill-Abgleiche
  (`search_wlo_all` nennt `search_wlo_content`, Kompendium-Dreiteilung,
  `get_node_collections` nennt den Katalog); `skillContext` an allen fünf
  Sammlungs-Werkzeugen sichtbar.
- **`search_wlo_all("Optik")`:** Optik im Themenseiten-Topf MIT Katalog
  (3 Skills, alle mit nodeId), `topicPages.registryChecked: true`,
  `hasCompendium: true`, **kein** `compendiumText` irgendwo im Envelope;
  Markdown trägt die Verweiszeile „Kompendium: vorhanden" und ist 15 209
  statt >50k Zeichen.
- **`get_topic_page_content("Optik")`:** Markdown = **1** Content-Block mit dem
  Katalog inline; JSON = 2 Blöcke (Block 1 reines JSON), wie entworfen.
- **`get_compendium_text`:** liefert 28 855 Zeichen samt `## Inhalt`
  (die Beinahe-Regression am Lieferwerkzeug ist live widerlegt); mit
  `query: "Lehrplan Thüringen"` 1 868 Zeichen Passagen, Inhaltsverzeichnis
  ebenfalls dabei. Eine Probe war zunächst rot, weil sie das WORT
  „Inhaltsverzeichnis" suchte — gerendert wird `## Inhalt`; Probe korrigiert,
  kein Server-Befund.
- **`get_skill`:** Registry-Eintrag geladen, 6 351 Zeichen, kein
  Kürzungsmarker. Ehrlich benannt: der größte echte Skill liegt unter dem alten
  64-KiB-Deckel, „ungekürzt jenseits des Deckels" beweist live also nur der
  Offline-Test (1,5 MiB, rot→grün); live beweisbar ist „vollständig, ohne
  Marker", und das gilt.
- **`get_node_details`:** Markdown-Vorschau gekappt bei 509 Zeichen mit `…`,
  JSON trägt `hasCompendium: true` und kein `compendiumText`.

Probe-Skript: `verify-deploy.mjs` (Scratchpad, nicht im Repo).

### Volltext-Decken auf 200 000 Zeichen ✅ 2026-08-20 (Nutzerentscheidung)

Gemessen vor dem Bauen: die einzigen Längengrenzen auf dem Volltext-Pfad sind
die drei Schema-Obergrenzen — `get_wlo_content_text` und `get_url_text` je
50 000, `get_wikipedia_summary` 100 000. Die Quellen kappen NICHT
(`/textContent` liefert ganz, der Extraktionsdienst auch, und der
64-KiB-Download-Deckel liegt auf einem anderen Pfad). Alle drei Decken auf
**200 000** gehoben; die Vorgabe bleibt 8 000, keine bestehende Antwort wächst.
Drei Tests zuerst rot gesehen (`not ok … maxChars 200000`), grün nach den drei
Einzeilern. Bewusst NICHT angefasst: `fetch` behält seinen festen
10 000-Deckel — kein Parameter, Antwort reist doppelt (Text +
`structuredContent`), ein 200k-Zwang ohne Opt-in wäre die falsche Richtung;
dem Nutzer benannt. Referenz (Markdown + Web-Artefakt) trägt den Absatz.

**Tore:** `npm test` → **2159 pass, 0 fail** (3 neue Tests) · `lint` → 0 ·
`typecheck` → 0 · `build` → 0.
Hochzuladen: `src/tools/content-text.ts` · `src/tools/url-text.ts` ·
`src/tools/wikipedia.ts` · `tests/tools-content-text.test.ts` ·
`tests/tools-url-text.test.ts` · `tests/tools-wikipedia.test.ts` ·
`CHANGELOG.md` · `docs/MCP-REFERENZ.md` · `docs/plans/STATUS.md`.

**Nachschärfung (Nutzerentscheidung, gleicher Tag):** die VORGABE ist ebenfalls
200 000 — ein Aufruf ohne `maxChars` liefert den ganzen Text. Gemessen vorab:
`DEFAULT_MAX_CHARS` lebt je Datei (drei Konstanten, kein REST-Import), beide
Beschreibungen interpolieren die Konstante, und KEIN Test nagelte den alten
Standard fest — die Vorgabe war ungetestetes Verhalten, jetzt nicht mehr. Drei
weitere Tests zuerst rot gesehen (Aufruf ohne `maxChars` auf 150k-Text ×2, dazu
der tools/list-Vertrag: alle drei Beschreibungen nennen 200000), grün nach den
drei Konstanten. `fetch` (fester 10 000-Deckel, kein Parameter, Antwort reist
doppelt) bleibt unverändert. CHANGELOG in place editiert (unreleased). Tore
erneut: `npm test` → **2162 pass, 0 fail** · lint/typecheck/build → 0.
Upload-Liste unverändert (dieselben neun Dateien).

**Zweite Nachschärfung (Nutzerentscheidung, gleicher Tag): `fetch` auf
100 000** — „10 000 klingt zu wenig". Fest statt Parameter, aus den bekannten
Gründen (Konvention erlaubt nur `id`, Antwort reist doppelt, der Deckel ist
die einzige Schranke des Chat-Kontexts). **Dabei eine echte Regression des
Kompendium-Pakets gefunden:** `fetch` bevorzugte `f.compendiumText` als
Dokumentkörper — das Feld setzt `formatNode` seit dem Signal-Umbau nie mehr,
also lieferte jeder Sammlungs-`fetch` still nur die Beschreibung; die dritte
Stelle derselben Krankheit (nach `getCompendiumTexts` und der
Detail-Vorschau), und die einzige OHNE Test. Beides rot-zuerst gebaut (60k-Text
ungekürzt · Sammlungs-`fetch` liefert das Kompendium), grün nach Konstante +
Property-Read. Tore: `npm test` → **2164 pass, 0 fail** · lint/typecheck/build
→ 0. Upload-Liste + `src/tools/knowledge.ts` · `tests/tools-knowledge.test.ts`
(jetzt elf Dateien).

**Review-Runde (1 minor, 2 nits — alle behoben, 2026-08-20):** Der Minor
(Text reist im Markdown-Modus doppelt: Content-Block + `structuredContent`)
ist als BEHALTEN + Begründung im Code aufgelöst, nicht durch Streichen —
gemessen: das Reading-Widget rendert aus `structuredContent`
(`widgetUri` an `get_wlo_content_text`), der Streich-Fix hätte es geleert;
bei `get_url_text` ist `structuredContent` der Maschinenvertrag. Beide
Rückgaben tragen jetzt den Kommentar, damit niemand die Hälfte
„wegoptimiert". Die Nits: der Drei-Werkzeuge-Vertragstest ist von
`tools-content-text.test.ts` nach `tool-descriptions.test.ts` umgezogen
(dorthin gehören Beschreibungs-Verträge) und um einen Abweisungs-Test ergänzt
(alle drei verweigern `maxChars` 250 000 — vor jedem Upstream-Aufruf, netguard
bewacht die Richtung); `fetch` hat einen Grenz-Test (120k-Dokument → Schnitt
bei 100k MIT Marker, Schwanz weg). Auch geprüft: kein verstecktes
20 000-ZEICHEN-Limit existiert auf dem `get_url_text`-Pfad (die einzigen
20 000er im Code sind ein Timeout in ms und Schreibfeld-Grenzen) — Webseiten
bis 200 000 Zeichen sind durchgängig frei, mit und ohne `maxChars` je mit
157k-Fixtur getestet. Tore: `npm test` → **2166 pass, 0 fail** ·
lint/typecheck/build → 0. Upload-Liste + `tests/tool-descriptions.test.ts`
(jetzt zwölf Dateien).

**Live nach Deploy bestätigt (2026-08-20), ausgelöst durch eine Meldung der
Browser-Plugin-Entwickler („irgendwo bei 50 000 gekappt"):** Alle drei
Werkzeuge melden am laufenden Server `default=200000 min=500 max=200000`.
Gegen `en.wikipedia.org/wiki/Experimental_physics`: **ohne** `maxChars`
59 398 Zeichen, `truncated=false` — die ganze Seite. Mit `maxChars: 50000`
schneidet derselbe Server bei 50 003 (`charCount` 59 398). **Die 50 000 sind
also ein Wert des AUFRUFERS, keine Serverschranke** — im Quellcode existiert
kein 50 000er mehr. Vor diesem Deploy war 50 000 die Decke, ein
hartkodierter Wert dort war damals notwendig und ist jetzt veraltet.
`fetch` auf die Optik-Sammlung liefert **100 005** Zeichen MIT Kürzungsmarker
und beginnt mit dem Kompendium — der stille Regressions-Fix wirkt live.
Nebenbefund, nicht verfolgt: das Optik-Kompendium ist roh **352 919** Zeichen
(`charCount` von `get_compendium_text`), während ein Suchtreffer am
2026-08-20 nur 37 428 inline trug — Suchindex und Knotenspeicher liefern
dieselbe Eigenschaft offenbar unterschiedlich lang. Betrifft keine
ausgelieferte Zusicherung, wäre aber vor einer Aussage über
Kompendiumslängen neu zu messen.

---

## 2026-08-21 — Zwei Widget-Befunde aus dem ChatGPT-Betrieb (Ladezustand, Vorschaubilder)

**Meldung des Nutzers:** Die Apps-SDK-Widgets zeigen „während sie Infos
abrufen" durchgehend „Keine Inhalte gefunden", und viele Kacheln bleiben ohne
Vorschaubild, obwohl das Repository anonym fast überall eines liefert.

**Befund 1 — der Leerzustand war der Ladezustand.** Eine Zeile, viermal
wiederholt: `render(host.toolOutput(), …)` malt beim Mount, und `toolOutput`
ist `null`, bis der Host das Ergebnis liefert. Jeder Renderer tat also genau
das Richtige mit einer leeren Nutzlast — über eine Nutzlast, die noch gar
nicht da war. Das Lesetext-Widget war der schlimmste Fall: sein
Fallback-Grund behauptet „Zu diesem Material ist kein Text hinterlegt", eine
Aussage über das Material, bevor irgendetwas gelesen wurde.
`host.awaitingOutput()` ist jetzt ein **eigener Begriff** und wird nie aus
einer leeren Nutzlast erschlossen — dieselbe Regel wie serverseitig bei
`registryChecked` und `content.licenseFilter`. Am Standard-Bridge ist der
Begriff die `tool-result`-Meldung (ein Ergebnis mit leerem
`structuredContent` ist trotzdem angekommen); ChatGPT bietet kein solches
Ereignis, dort ist der Wert das einzige verfügbare Signal. Die Wartezeit ist
mit `OUTPUT_GRACE_MS` = **30 s** gedeckelt, und die Zahl ist gemessen statt
geschätzt: der Deckel wirkt in beide Richtungen, denn ein FEHLGESCHLAGENES
Werkzeug liefert ebenfalls nichts (`toolError` gibt `isError` ohne
`structuredContent`) — zu großzügig heißt also unnötig langes Skelett im
Fehlerfall. Live über alle widget-gebundenen Werkzeuge (2026-08-21) ist
`get_topic_page_content` mit **2 240 ms** das langsamste
(`get_url_text` auf einer schweren Wikipedia-Seite 1 568 ms, ein volles
`search_wlo_all` 1 287 ms). 30 s sind das ~13-fache und liegen innerhalb
eines Upstream-Budgets (`WLO_FETCH_TIMEOUT_MS`, 20 s), können also nicht
mitten im Aufruf ablaufen — das brächte den falschen Satz genau bei den
langsamen Aufrufen zurück, für die der Ladezustand da ist.

**Review derselben Sitzung, ein MAJOR und drei kleinere — alle behoben.** Der
Gnadenfrist-Timer meldete **bedingungslos**: 30 s nach *jedem* erfolgreichen
Mount baute jedes Widget sein DOM per `innerHTML` neu und zerstörte dabei
Tastaturfokus (WCAG 2.4.3) und jede Textmarkierung — auf einem Bildschirm, der
längst gerendert war. Er meldet jetzt nur noch, wenn es etwas ändert. Dazu
kam: `imageDomains()` warnte **pro Aufruf**, und `widgetResourceMeta` läuft je
Anfrage einmal pro Widget (`mcp-transport.ts` baut Server und Transport pro
Anfrage neu) — ein Tippfehler in `WLO_WIDGET_IMAGE_DOMAINS` erzeugte damit vier
Logzeilen je Anfrage; jetzt wird nur beim Wechsel des Rohwerts geparst und
gewarnt. Beides ist als Verhaltenstest festgenagelt, nicht als Quelltextmuster:
`createHost` wird mit einer `window`-Attrappe wirklich ausgeführt und der
Zeitgeber abgefangen (statt Nodes noch experimenteller `mock.timers`), die
Warnung wird über `log.warn` gezählt. Der schwache Wächter, der nur die
*Existenz* von `OUTPUT_GRACE_MS` prüfte, ist dadurch ersetzt — er hätte den
Befund nie gefunden.

**Befund 2 — die eigene CSP blockierte vorhandene Vorschaubilder.** Gemessen
gegen Staging über **92** eindeutige Materialien aus 12 Suchen:

| Lage | Anzahl | Folge |
|---|---|---|
| Vorschau löst auf der Repository-Origin auf | 75/78 | wird angezeigt |
| Repository antwortet `302` → `https://img.youtube.com` | **3/78** | **war blockiert** |
| `previewIsIcon: true` (Repository hat kein Bild) | **14/92** | Symbol statt Bild |

Die CSP nannte allein die Repository-Origin, und ein Browser prüft den Host
bei **jeder** Weiterleitungsstufe neu — die drei YouTube-Fälle wurden also
verworfen, obwohl die Vorschau existiert. Neu: `WLO_WIDGET_IMAGE_DOMAINS`
(Vorgabe `https://img.youtube.com`) erweitert **nur** `resource_domains`;
`connect_domains` bleibt allein das Repository, weil das Widget selbst keine
Anfragen stellt. Abschaltwort ist `none` und **nicht** der Leerwert:
`docker-compose.yml` reicht jede Einstellung als `"${VAR:-}"` durch, ein nicht
konfigurierter Container zeigt also immer einen Leerstring — als „aus" gelesen
hätte das die Vorgabe in jedem Deployment stillschweigend gestrichen. Das fiel
beim Verdrahten der Compose-Seite auf, nicht im Test.

Unabhängig davon fällt ein Bild, das trotzdem nicht lädt (unvermessenes
Weiterleitungsziel, tote Anbieter-URL, 404), auf **das Zeichen zurück, das die
Kachel ohne Vorschau ohnehin zeigt** — `data-fallback` am Element,
`shared/image-fallback.ts` tauscht. Der Listener hört in der **Capture-Phase**,
weil `error` nicht aufsteigt; ohne dieses Flag feuert ein delegierter Listener
nie. Genau das ist der Wächter: die DOM-Attrappe im Test registriert nur bei
`capture === true`, ein entferntes Flag macht den Test rot (eingespielt und
belegt).

**Nicht geändert, weil gemessen:** die 14 Datensätze mit `previewIsIcon` haben
im Repository kein Bild (`…/mime-types/previews/link.svg`) und auch kein
Bildfeld (0 von 8 Stichproben). Die Unterdrückung des Platzhalters bleibt.

**Tore:** `npm test` → **2185 pass, 0 fail** (19 neu) · lint 0 · typecheck 0 ·
`build` grün. Beide neuen Wächter wurden durch eingespielte Verletzung als rot
nachgewiesen. Neue Widget-Hashes (Host-Cache-Key rollt):
`search-results b54ffd82 · topic-page 79014cd5 · browse cd3adcda · reading 60e4e12f`
(Stand nach dem Kompendiums-Paket weiter unten — `strings.ts` steckt in allen
vier Bündeln, beide Pakete gehen zusammen hoch).

**Offen:** visuelle Abnahme im echten Host. Der Browser-Pane rendert lokale
Dateien nur als statischen Snapshot (`script-src 'none'`) und blockiert
`127.0.0.1` per Richtlinie, das Widget-JS läuft dort also nicht — die
Ladeansicht und der Bildtausch sind über Markup- und Verhaltenstests belegt,
nicht über einen Screenshot.

---

## 2026-08-21 — Kompendiumstext geht ans Modell, nicht auf den Bildschirm

**Nutzerentscheidung.** `get_compendium_text` antwortet mit redaktioneller Prosa
in Absatz-Abschnitten — mit `query` die BM25-Passagen, ohne sie der je
Hauptabschnitt gekappte Text. Vom Bildschirm gelesen sind das
zusammenhanglose Schnipsel; gesehen werden soll, was das Modell daraus macht.
Gewählt wurde: **alle** Kompendiums-Antworten (nicht nur die Passagen-Form) und
**mit** kurzer Übergabe-Zeile statt gar nichts.

**Wo der Hebel sitzt, und wo nicht.** Die Widget-Bindung steht im
Tool-Deskriptor (`apps/register.ts`), wird also einmal bei `tools/list` gesetzt —
pro Aufruf abschaltbar ist sie nicht, und ob ein Host ein `_meta` am *Ergebnis*
beachtet, ist ungemessen. Geändert wird deshalb, was das Widget **rendert**, was
vollständig in unserer Hand liegt: `contentTextSchema` trägt `forModel` und
(nur bei `query`) `passageCount`, das Lese-Widget zeigt darauf hin eine
Übergabe-Zeile. `get_wlo_content_text` teilt Widget und Schema, setzt beides
nicht und rendert unverändert als Dokument.

Drei Regeln binden jede Änderung hier. (1) **Was das Modell bekommt, bleibt
unangetastet** — `content[0].text` und `structuredContent.text` tragen weiter
alles; die Verengung ist eine Anzeige-Entscheidung, keine Inhaltsentscheidung.
(2) Die Zeichenzahl der Übergabe-Zeile ist `text.length`, **nicht** `charCount`:
letzteres ist die QUELL-Länge und benennte hier etwas, das niemand bekommen hat.
(3) Die Folgeaktionen bleiben stehen — mit dem Material außer Sicht ist das
Modell danach zu fragen das Einzige, was in der Ansicht noch zu tun ist.

**Ein Wächter hat dabei einen echten Fehler gefangen.** Die Werkzeugbeschreibung
war durch den neuen Verarbeitungs-Hinweis auf **1175 Zeichen** gewachsen;
`tests/tool-descriptions.test.ts` kappt bei 1024, und ein Host kürzt **von
hinten** — genau dort stand die neue Anweisung. Sie steht jetzt **vor** den
Mechanik-Sätzen (1006/1024), damit auch ein strenger kürzender Host sie liefert.
Das Widget allein hätte den Fall ohnehin nicht gedeckt: es verhindert die
*sofortige* Anzeige, nicht dass ein Modell die Schnipsel wörtlich in seine
Antwort kopiert.

**Tore:** `npm test` → **2198 pass, 0 fail** (13 neu: 8 Widget, 5 Werkzeug) ·
lint 0 · typecheck 0 · build grün. Rot-zuerst belegt: 3 von 5 Widget-Tests und
3 von 3 Werkzeug-Tests waren vor der Umsetzung rot, die übrigen sind
Regressions-Pins (Folgeaktionen, unveränderte Ansicht ohne die Fahne).

**Review desselben Pakets, ein MAJOR und drei kleinere — alle behoben.** Der
Übergabe-Zweig ließ die **Kürzungs-Offenlegung** fallen: `truncated` wurde nur
im Dokument-Zweig gerendert, obwohl `get_compendium_text` die Fahne setzt, sobald
`WLO_COMPENDIUM_SECTION_MAX` greift — und das trifft ausgerechnet den größten
Text (Optik, 65 250 → 18 744 Zeichen). Ohne die Zeile liest sich die
Modell-Antwort wie eine Aussage über das ganze Kompendium; die Angabe wiegt hier
**schwerer** als in der Leseansicht, weil niemand mehr selbst nachsehen kann.
Dieselbe Form, die dieses Projekt schon einmal als Fehler behandelt hat: ein Feld
im Envelope ist keine Offenlegung, wenn der Renderer es fallen lässt. `truncated`
steht deshalb jetzt **über** beiden Zweigen — eine Definition, damit die Ansichten
nicht erneut auseinanderlaufen. Dazu: der Klammersatz der Beschreibung („die
Oberfläche zeigt sie bewusst nicht an") galt nur für Widget-Hosts und heißt jetzt
host-unabhängig „sie sind nicht zur direkten Anzeige gedacht" (1008/1024);
`docs/TOOLS.md` ist nachgezogen (es beschrieb beide Antwortformen, ohne die
Anzeige-Entscheidung zu erwähnen); und die tote Modifier-Klasse
`wlo-reading--handover` ist raus.

**Eine abgelehnte Beobachtung war falsch abgelehnt.** `unmatchedTerms` hatte ich
mit „das Modell bekommt sie ja" durchgewunken — dasselbe Argument gilt aber für
`truncated` (die Hinweiszeile trägt es ebenfalls ans Modell), und dort wurde es
zu Recht als MAJOR gewertet. Zwei gleiche Fälle, zwei Urteile. Die Terme reisen
jetzt als Feld neben `passageCount`, nur bei einer `query`-Antwort. Über einen
Sammelabruf ist es die **Schnittmenge**, nie die Vereinigung: ein Term, der in
einer Sammlung fehlt und in einer anderen steht, IST gefunden — als „nicht
gefunden" gemeldet stünde die Aussage neben einer Antwort, die genau dieses Wort
enthält. Merksatz: wer eine Offenlegung aus der Prosa in ein Feld verschiebt,
muss auch entscheiden, was sie über MEHRERE Quellen bedeutet.

Bewusst NICHT geändert, mit Grund: der Sammelabruf trägt keine Folgeaktionen
(`nodeId` ist dort leer, und ein Knopf mit der id der ersten von 25 Sammlungen
wäre eine falsche Aussage statt einer fehlenden), und „0 Passagen an die KI
übergeben" bleibt stehen — es ist sachlich richtig, und mit der neuen
`Nicht gefunden`-Zeile daneben erklärt sich der Fall jetzt von selbst.

**Offen:** die optische Abnahme im echten Host, wie beim Ladezustand — der
Browser-Pane führt lokales Widget-JS nicht aus.

---

## 2026-08-21 — Rahmenwörter löschten das Suchergebnis (Meldung aus Claude)

**Symptom:** Bei Inhaltsfragen antwortete das Modell mit Statistiken statt mit
konkreten Vorschlägen. **Es tat das Richtige mit dem, was es bekam.**

**Ursache, gemessen gegen Staging:** Das Repository verundet jedes Wort einer
Anfrage, und die Substantive, die eine Frage RAHMEN, stehen in praktisch keinem
Datensatz — eines davon leert die Antwort.

| Anfrage | Treffer |
|---|---|
| `Französische Revolution` | **480** |
| `Unterrichtsstunde Französische Revolution` | **0** |
| `Optik` | 825 |
| `Bildungsinhalte zur Optik` | 4 |
| `Photosynthese` | 211 |
| `Erklärvideo Photosynthese` | 1 |

Die Beugung ist NICHT die Ursache (`Französischen Revolution` liefert weiter
450) — ein Rahmenwort genügt. Mit 0–4 Datensätzen meldet ein Modell eine Zahl;
in Claude verdeckt kein Widget, wie dünn das ist, in ChatGPT ließen die Kacheln
dieselbe Antwort gehaltvoll aussehen. Die bestehende Stoppwortliste konnte das
nicht fangen: sie hält Funktionswörter (`der`, `zur`, `für`), und
„Unterrichtsstunde" ist ein Substantiv.

**Lösung:** `expandQuery` gibt eine `topic:`-Variante ohne Rahmenwörter aus,
Gewicht **0.92** — über der Schlagwort-Variante, damit `MAX_VARIANTS` nicht
ausgerechnet die einzige Variante wegschneidet, die etwas liefert, und unter den
Phrasen-Varianten, damit ein exakt passender Datensatz weiter vorn steht. Sie
entsteht nur, wenn etwas entfernt wurde UND etwas übrig bleibt: unverändert wäre
sie eine Dublette von `full`, leer träfe sie alles.

**Die Wortliste ist belegt, nicht erfunden:** es ist das Vokabular, das die
Server-Anweisung und `docs/TOOLS.md` den Nutzenden selbst in den Mund legen.
Die Anfrage-VERBEN mussten zu den Substantiven dazu — mit `suche` verengte sich
die Optik-Anfrage auf einen einzigen Datensatz, schlechter als die Substantive
allein erreichten. Gefunden hat das die Messung, nicht der Test.

**A/B über EINEN Einstiegspunkt** (der erste Vergleich war schief: „vorher" lief
über `search_wlo_all`, „nachher" über `enhancedSearch`):

| Anfrage | ohne | mit |
|---|---|---|
| Unterrichtsstunde zur Französischen Revolution | 0 | **9** |
| Zeig mir ein Video zur Eiszeit | 0 | **10** |
| Arbeitsblatt zur Zellteilung | 3 | **10** |
| Ich suche Bildungsinhalte zur Optik … | 2 | **5** |
| Erklärvideo Photosynthese | 1 | **4** |
| `Französische Revolution` · `Optik` (Kontrollen) | 10 | 10 |

Keine Anfrage wurde schlechter. Dazu ein Satz in `instructions.ts` (Thema in
`query`, Medium/Stufe/Fach in die Filter) — dort und nicht in der Beschreibung
von `search_wlo_all`, die bei 1017 von 1024 Zeichen steht.

**Tore:** `npm test` → **2205 pass, 0 fail** (7 neu) · lint 0 · typecheck 0.

**Nachtrag am selben Tag (Nutzerhinweis): das Medium gehört in den FILTER, nicht
in den Papierkorb.** „Arbeitsblatt KI" fragt zweierlei — KI als Thema,
Arbeitsblatt als Inhaltstyp. Die Themen-Variante rettete die Treffer, warf die
Einschränkung aber weg. `withDerivedResourceType` (`filter-criteria.ts`) füllt
`learningResourceType`, wenn der Aufrufer keinen nennt; ein ausdrücklicher
Parameter gewinnt immer. Sie sitzt in den beiden Such-WERKZEUGEN, nicht in
`searchAll`: dort entsteht `labeled`, der Filter wird also im `_queryMeta`
offengelegt statt still zu verengen.

**Die Zuordnung ist kuratiert, und das ist eine Messung, keine Vorliebe.**
`resolveVocab` gleicht unscharf ab: `material` → Übungsmaterial,
`bildungsinhalte` → **Bild**. Aus „was auflöst" einen Filter zu bauen machte aus
„Bildungsinhalte zur Optik" eine Bildersuche. Aufgenommen sind nur Wörter, die
genau ein Medium benennen (Video, Arbeitsblatt, Übung, Bild, Simulation,
Podcast). `aufgabe`/`grafik`/`film` fehlen aus dem zweiten Grund: sie lösen gar
nicht auf, ein Filter daraus träfe keinen Datensatz. „Unterrichtsstunde" ist der
Fall, der die Regel beweist — als Unterrichtsplanung zugeordnet fiel
„Französische Revolution" von 480 auf 0 Treffer.

**Messfalle, teuer bezahlt:** die Abnahme-Sonde rief `searchAll` DIREKT auf und
ging damit an der Ableitung vorbei — „Arbeitsblatt zur Zellteilung" lieferte
Videos, was wie ein Fehler aussah und keiner war. Wer eine Schicht prüft, muss
sie auch durchlaufen; festgenagelt ist es jetzt über den Werkzeug-Aufruf.

**Review derselben Runde (1 MAJOR, 1 MINOR, 1 NIT — alle behoben).** Der
abgeleitete Filter VERENGT, war aber nur in `_queryMeta` offengelegt — dem
letzten Textblock, den ein gemessener realer Client dem Modell nie übergibt
(2026-08-19). „Podcast zur Französischen Revolution" ohne Podcast hätte als
nacktes „Keine Inhalte gefunden." über einem Thema mit 480 Datensätzen gelesen —
die Fehlerklasse, für die der Lizenzfilter seine Sätze bekam, hier durch eine
neue Tür. Die Offenlegung folgt jetzt dem Lizenz-Muster und geht einen Schritt
weiter: der Satz (`derivedResourceTypeNotice`, wohnt neben den Lizenz-Hinweisen
in `filter-criteria.ts`) steht im Markdown IN Block 0 (ein JSON-Block-0 verträgt
keine Prosa — dort eigener Block, Test parst Block 0), und
`derivedResourceType` reist deklariert im `structuredContent`: top-level in
`nodeListSchema`, im searchAll-Envelope neben `licenseFilter` im content-Eimer,
weil beide dasselbe Leg beschreiben. Nie gesetzt bei explizitem Parameter — die
eigene Wahl des Aufrufers als Entdeckung zurückzumelden wäre Rauschen. Envelope
wird GESPREADET, nicht mutiert (der Service-Typ kennt das Feld nicht), und vor
dem JSON-Zweig angereichert, damit Text-Envelope und structuredContent nicht
auseinanderfallen. Dazu: beide Parameter-Beschreibungen und TOOLS.md benennen
die Ableitung samt REST-Abweichung (REST leitet bewusst nicht ab); der
Auflösungs-Test deckt jetzt alle 6 Ziel-Labels (vorher 4 — `Übung`/`Bild`
ungedeckt, `seen.size === 6` erzwingt Vollständigkeit).

**Tore:** `npm test` → **2218 pass, 0 fail** (20 neu gegenüber Paketbeginn) ·
lint 0 · typecheck 0.

---

## 2026-08-21 — Offene Punkte der Sitzung geschlossen (A11y-Ansage, Stufen-Messung, Doku-Paar)

**Inventur statt Neubau:** fünf Kandidaten aus den Reviews der Sitzung, drei mit
Substanz, einer per Messung geschlossen, einer bleibt Deploy-Check.

**(A) Screenreader hörten „wird geladen …" — und dann für immer nichts.** Der
Ladezustand versprach per `role="status"` eine Fortsetzung, die nie kam:
`paint()` ersetzt `#wlo-root` per innerHTML **mitsamt** der Live-Region, das
Eintreffen wurde also nie angesagt (WCAG 4.1.3). `shared/announce.ts` mit zwei
Regeln, die beide der Grund sind, warum es funktioniert: die Region lebt
AUSSERHALB von `#wlo-root` an `document.body` (der Repaint kann sie nicht
zerstören) und wird beim ERSTEN Paint LEER angelegt — eine Live-Region, die
zusammen mit ihrem Text eingefügt wird, feuert in AT unzuverlässig; eine, die
schon existiert, wenn der Text landet, zuverlässig. Nur der Übergang
laden→Ergebnis spricht: eine ohne Ergebnis abgelaufene Gnadenfrist bleibt stumm
(„geladen" über einer leeren Ansicht wäre falsch), beim Mount schon vorhandene
Ausgabe war nie „ladend", und spätere Repaints (Theme, Auswahl) sagen nichts
erneut an. Verhaltenstest mit DOM-Attrappe + Quell-Pins in allen vier Shells;
Wächter durch eingespielte Verletzung als rot belegt.

**(D) Stufen-Ableitung aus „Klasse 6" — gemessen und NICHT gebaut.** Je Thema
tragen nur 36 % (Bruchrechnung, 454/1269) bis 72 % (Photosynthese) der
Datensätze überhaupt eine Stufe; ein abgeleiteter Filter würde die ungesetzte
Mehrheit VERBERGEN statt eingrenzen — dieselbe Falle, die am 2026-08-07 die
Themenseiten-Filter lokal statt serverseitig machte. Anders als beim Medienwort
hat es auch niemand verlangt. `klasse`/`sekundarstufe` bleiben reine
Streichwörter der Themen-Variante; die Messung steht als Schließungsgrund im
CHANGELOG und in MCP-REFERENZ.md.

**(B/C) Doku-Paar wieder deckungsgleich.** MCP-REFERENZ.md kannte die
Medienwort-Ableitung noch nicht (nur TOOLS.md) — nachgezogen, samt dem
Nicht-gebaut-Satz zur Stufe. Die HTML-Fassung (Artefakt
`670d9a7a…`, Label `widgets-suche-2026-08-21`) trug **null** der
Sitzungs-Deltas und hat jetzt alle sechs: `WLO_WIDGET_IMAGE_DOMAINS`-Zeile,
Kompendiums-Übergabe (`forModel`/`passageCount`/`unmatchedTerms`),
Lese-Widget-Zeile, Rahmenwort/Ableitungs-Kasten, Widget-Verhaltenskasten
(Ladezustand + Bild-Rückfall + Ansage), Fußzeile („Änderungen vom 21.08.
warten auf den nächsten Deploy"). Merksatz: die HTML-Fassung ist ein
Doku-PAAR-Partner von MCP-REFERENZ.md — wer die MD ändert, zieht sie nach.

**(E) bleibt:** optische Abnahme im echten Host nach dem Deploy — der
Browser-Pane führt lokales Widget-JS nicht aus.

**Tore:** `npm test` → **2224 pass, 0 fail** (6 neu) · lint 0 · typecheck 0 ·
build grün. Widget-Hashes (alle vier rollen — `strings.ts`/`base.css` stecken in
jedem Bündel): `search-results 089b68ed · topic-page 4fd139cc ·
browse 6b7d964b · reading 862cf11d`.

---

## 2026-08-22 — Das Rechte-Schild in den Widgets: Diagnose und ehrliche Darstellung

**Meldung mit Screenshots:** dieselbe angemeldete Person sieht im
edu-sharing-Web Vorschaubilder, im ChatGPT-Widget dagegen Karten mit „Keine
ausreichenden Rechte / insufficient permissions".

**Diagnose, an den zwei nodeIds des Nutzers gemessen (Staging):** Die
Datensätze sind `isPublic: false`. Eine ANGEMELDETE Suche findet sie („SUPRA
Licht Schatten": anonym 0, angemeldet 13), der anonyme Metadaten-Abruf
antwortet 403, und die anonyme `/preview` antwortet **HTTP 200** mit jedes Mal
demselben 19 590-Byte-Schild-SVG. Ein Widget-`<img>` ist immer ein anonymer
Abruf — kein Header trägt die MCP-Anmeldung hinein, und ein Token in der
Bild-URL wäre ein Credential in structuredContent, Chatverlauf und Logs
(verboten, und zwar aus gutem Grund). Das Schild war also die Rechteprüfung des
Repositories in ihrer alarmierendsten Darstellung; wegen der 200 feuert auch
der Bildfehler-Rückfall nie. **Drei Sackgassen wurden gemessen, bevor die
Ursache stand:** Browser-Header (Sec-Fetch/Referer/UA) kippen nichts; die
Datensätze fehlen im anonymen Index BEIDER Instanzen; ein drittes Repository
(`repository.openeduhub.net`) existiert nicht.

**Der billige Signalweg:** `isPublic` ist ein Top-Level-Feld JEDES Such-DTOs,
unabhängig vom `propertyFilter` (gemessen) — null Zusatzabfragen. Regeln, die
jede Änderung binden: `formatNode` trägt NUR den bemerkenswerten Fall
(`isPublic: false`, gespreadet wie `originalId`; `true` und „Feld nie gesendet"
bleiben abwesend, sonst sähe eine Instanz ohne das Feld eingeschränkt aus);
deklariert in `formattedNodeSchema` (zod!) und in `PROJECTABLE_FIELDS`
(`rest/validate.ts`); die Widgets versuchen das Bild GAR NICHT ERST (Schloss
🔒 + Faktenzeile „Sichtbarkeit: nicht öffentlich — Anmeldung erforderlich",
Text, nie nur Symbol); und die EINE Satz-Konstante `NOT_PUBLIC_LINE`
(formatter.ts) speist `renderToText` UND `get_node_details` — ein Modell, das
einen Datensatz empfiehlt, den das Publikum nicht öffnen kann, ist derselbe
Fehler in Prosa. Beim Verdrahten gefunden: die Anker-Prüfung des Edit-Skripts
fand die EIGENE Einfügung statt des Imports — `NOT_PUBLIC_LINE is not defined`
zur Laufzeit, vom Test gefangen.

**Bewusst NICHT gebaut:** authentifizierte Vorschaubilder im Widget. Der
ehrliche Weg zu „alle sehen das Bild" ist das Veröffentlichen des Datensatzes —
eine redaktionelle Entscheidung, keine Server-Änderung.

**Tore:** `npm test` → **2231 pass, 0 fail** (7 neu) · lint 0 · typecheck 0 ·
build grün. Widget-Hashes: `search-results bbe0fa87 · topic-page f37262a5 ·
browse 093e9b62 · reading fff52b73`.

**Nachtrag am selben Tag — die Rückfrage des Nutzers hat den Hebel benannt:
„die Metadaten kommen auch durch."** Stimmt, und zwar weil der SERVER sie mit
der Anmeldung des Aufrufers holt — also holt er jetzt auch die gesperrten
Vorschaubilder so. `services/preview-inline.ts` läuft im selben Anfragekontext
(`wloFetch` trägt das per-Request-Credential über `runWithCredential`), bettet
bis zu **8** Rasterbilder (je ≤300 KB) als `data:`-URIs ein und liefert sie im
`_meta` des Ergebnisses (`wlo/previewData`) — dem Apps-SDK-Kanal, den ein Host
dem WIDGET übergibt und nie dem Modell. Vier Regeln binden jede Änderung:
(1) **Nie in `structuredContent`** — das wäre die Kompendiums-Krankheit mit
Bildern, 8×~40 KB Base64 im Modellkontext jeder Redaktionssuche; ein Test
prüft, dass dort kein `base64` auftaucht. (2) **Nur Rasterbilder** — SVG ist
entweder das Rechte-Schild (die anonyme Antwort) oder ein Platzhalter; damit
ist der Pfad selbstsichernd: erreicht das Credential den Abruf nicht, kommt
das Schild, und das wird nie eingebettet. (3) Das Widget akzeptiert aus der
Karte **nur `data:image/*`** (`inlinePreview`, geteilt von Kachel und
Detailansicht, damit die Schema-Prüfung nicht auseinanderdriftet) und behält
die Sichtbarkeits-Zeile — das Bild macht den Datensatz nicht öffentlich.
(4) Rückfall-Glyphe des eingebetteten Bilds ist das **Schloss** (nicht 📄):
verweigert eine Sandbox-CSP `data:`-Bilder, degradiert die Karte zur
Gesperrt-Darstellung. Öffentliche Treffer kosten **nichts** (kein Abruf).
Messfalle im Test-Helfer: `Content-Type` + `content-type` als zwei Schlüssel
im Header-Init ergeben "a, b" — der Mock normalisiert jetzt auf Kleinschreibung.
**Nur live prüfbar bleibt:** ob die ChatGPT-Sandbox `data:`-Bilder und
`toolResponseMetadata` durchreicht — bei Nein bleibt es beim Schloss von P1.

**Tore (Nachtrag):** `npm test` → **2242 pass, 0 fail** (11 neu) · lint 0 ·
typecheck 0 · build grün. Hashes: `search-results bb447a4b · topic-page
5687b92b · browse 82fb2876 · reading 1def31e6`.

**Nachtrag 2 (Review-Runde, 2026-08-22): 6 Minor + 2 Nits, alle behoben — zwei
Regeln kommen dazu.** (5) **Die Abruf-Grenze IST die Credential-Grenze:**
`isRepositoryUrl` (aus `withCredential` extrahiert und exportiert,
`wlo-fetch.ts`) entscheidet beide Fragen. Nur eine Repository-Adresse wird
geholt, denn nur dort kann die Antwort für den Angemeldeten anders ausfallen —
jeder andere Host bedient ein anonymes `<img>` genauso gut, Inlining verschöbe
nur den Abruf-Standpunkt auf den Server. Zwei Fast-Kopien einer
Sicherheitsgrenze sind der Weg, auf dem eine driftet. (6) **Nur Materialien:**
die Sammlungs-Kachel rendert gar kein Bild (Early-Return in `tile.ts`), also
wurden Bytes geholt, die kein Pixel je zeichnet — der Dienst filtert
`nodeType !== 'collection'`, die Aufrufstellen übergeben nur den
content-Bucket, und eine nicht-öffentliche Sammlung trägt stattdessen ein
🔒-Abzeichen mit dem Sichtbarkeits-Text (sonst sah die Kachel offen aus,
während die Prosa `NOT_PUBLIC_LINE` sagt). Ferner: jedes Vorschaubild hat sein
EIGENES Budget (`PREVIEW_FETCH_TIMEOUT_MS` = 4 s statt der 20-s-Voreinstellung
— 8 Bilder über Pool 4 hätten einer fertigen Antwort zwei volle
Upstream-Timeouts anhängen können); eine deklarierte Übergröße
(`content-length`) wird übersprungen, ohne den Körper zu puffern;
`search`/`fetch` im rich-Modus rendern dasselbe Widget und liefern jetzt
denselben `_meta`-Kanal (lean bezahlt die Abrufe nicht); der Widget-Wächter
nennt exakt die vier Raster-Typen des Servers. Je FORMAT zugesichert:
`search_wlo_all` trägt das `_meta` in Markdown UND JSON — der Wächter wurde
rot bewiesen, indem nur der Markdown-Return den Spread verlor
(`'markdown: the map rides along'`).

**End-zu-End live bewiesen (Staging, 2026-08-22):** die `preview.url` des DTOs
liegt unter `{WLO_REPOSITORY_URL}/preview?…`, also innerhalb der
Credential-Grenze; der Abruf MIT Anmeldung antwortet `image/jpeg` (6 036
Bytes, Magic `ffd8ffe0`), ohne Anmeldung das Schild-SVG (19 590 Bytes). Der
Pfad ist damit gemessen, nicht nur gemockt. Mess-Lektion der Runde: ein
WERFENDER Mock beweist hier nichts — der Dienst fängt Fetch-Fehler bewusst ab,
„nicht geholt" ist von „geholt und verschluckt" nur über die ZÄHLUNG
(`mock.calls.length === 0`) zu unterscheiden; drei so grün-gerippte Tests sind
auf Zählung umgestellt.

**Tore (Nachtrag 2):** `npm test` → **2252 pass, 0 fail** (10 neu) · lint 0 ·
typecheck 0 · build grün · Bundles zweimal identisch gebaut (deterministisch):
`search-results 35a4a337 · topic-page 97e284e2 · browse 166f1c4b · reading
544540c7`.

**Nachtrag 3 (erster Live-Tag der Widgets, 2026-08-22).** Der Nutzer bestätigt:
**die Inline-Vorschauen laufen in ChatGPT** — echte Bilder auf gesperrten
Kacheln; die Sandbox reicht `toolResponseMetadata` durch und rendert
`data:`-Bilder. Damit ist die letzte Nur-live-Frage des Pakets beantwortet.
Zwei Befunde aus derselben Nutzung, beide behoben:

(1) **Sammlungs-Karte mit Themenseite bietet BEIDE Aktionen**
(Nutzerentscheidung, dreht die Ein-Aktions-Regel vom 2026-07 zurück):
„Themenseite öffnen" zuerst (die kuratierte Sicht), daneben „Inhalte anzeigen"
— die alte Regel verbarg die Inhalte genau der reichsten Sammlungen. Eine
Sammlung ohne Themenseite behält ihren einen Knopf. `tile.ts`, Test-Pin
umgedreht (`widgets-followup.test.ts`), `docs/TOOLS.md` angepasst.

(2) **„Volltext anzeigen" auf einem SWR-Video lieferte die Kompendiumspassagen
der SAMMLUNG.** Gemessen (Staging): das Material ist `video/mp4`,
`/textContent` hat 0 Zeichen, `ccm:wwwurl` zeigt auf eine rohe `.mp4` — der
Server antwortete also ehrlich „kein Text", und das MODELL ersetzte die
Negativ-Auskunft durch den nächstliegenden interessanten Text (die
Optik-Lehrplan-Anfrage aus dem früheren Verlauf; daher „Nicht gefunden:
thüringen, regelschule"). Kein Routing-Fehler — aber beide Enden der Kette
luden dazu ein und tragen jetzt die Regel an der Stelle, wo sie gilt: die
Kein-Text-ANTWORT ist ein Satz in Worten statt eines Slugs in Klammern
(`NO_TEXT_REASONS`, `content-text.ts`) und schließt mit „keinen Ersatztext aus
anderen Quellen (z. B. dem Kompendium einer Sammlung) liefern"; die
Klick-NACHRICHT (`followUpTextNone`, nur die text-Aktion) schließt mit „Wenn
kein Volltext hinterlegt ist, sage das kurz — hole keinen anderen Text als
Ersatz." Befolgung ist nicht erzwingbar — derselbe Stand wie bei der
Skill-Aktivierungszeile.

**Tore (Nachtrag 3):** `npm test` → **2254 pass, 0 fail** (2 neu, 1 Pin bewusst
umgedreht — alle rot-zuerst) · lint 0 · typecheck 0 · build grün.

Die Review-Runde dazu (1 Minor, 2 Nits, alle behoben): die Doppelaktion riss
per doppeltem `margin-top: auto` eine gedehnte Lücke ZWISCHEN die beiden
Knöpfe — die Regel war für EINEN Knopf je Karte geschrieben, und bei zweien
verteilt Flexbox die Resthöhe auf beide Auto-Margins; eine Geschwisterregel
(`.wlo-tile__followup + .wlo-tile__followup { margin-top: 0 }`, base.css)
lässt nur den ersten schieben, gepinnt im Both-Buttons-Test (rot bewiesen),
weil kein String-Test Layout sieht. `NO_TEXT_REASONS` ist als
`Record<ContentTextMiss, string>` typisiert — ein fünfter Grund scheitert am
Build statt still als „Grund unbekannt" im modellgerichteten Satz zu landen.
Hashes (final): `search-results b074e4f2 · topic-page a52cc7ea · browse
039b0ec6 · reading a46efde5`.

**Nachtrag 4 (2026-08-22): der Klick kommt an, das Modell plaudert.** Live
beobachtet: „Inhalte anzeigen" injizierte die Nachricht korrekt (das Modell
zitiert Titel UND nodeId — die reisen nur über den Button), aber ChatGPT
antwortete „Ja. Ich kann dir die Sammlung gezielt anzeigen …" statt zu rufen.
Gemessen, dass es NICHT am Server liegt: `get_collection_contents` mit
derselben nodeId antwortet live sauber (28 Inhalte, 20 geliefert, kein
Fehler). Der Hebel ist der Wortlaut: `followUpTool` (die EINE Stelle, alle
vier Tool-Aktionen) sagt jetzt „… und zeige das Ergebnis direkt an — keine
Rückfrage nötig." (DE/EN, Test rot-zuerst). Erzwingen lässt sich der Aufruf
nicht — Modellverhalten; als Sofort-Ausweg führt ein „ja" auf die Ankündigung
den Aufruf aus. Der Review-NIT dazu (aufruf- statt anzeige-fokussierter
Wortlaut, um Volltext-Dumping in den Chat vorzubeugen) ist VERWORFEN —
Nutzerentscheidung 2026-08-22: das Modell SOLL das Ergebnis übernehmen und
nutzen, beim Volltext bis zur 200 000-Zeichen-Kappe des Werkzeugs; der Satz
bleibt anzeige-fokussiert (Entscheidungskommentar an `followUpTool`,
strings.ts). Ebenfalls gemessen: die Widget-URI trägt den Inhalts-Hash als
Cache-Schlüssel, ChatGPT cached die WERKZEUGLISTE — nach einem Deploy zieht
erst ein Connector-Refresh die neuen URIs. Tore: `npm test` → **2255 pass, 0
fail** · lint 0 · typecheck 0 · build grün. Hashes: `search-results 82588209 ·
topic-page fc2e1986 · browse 7bcc3f6c · reading de1ff9bf`.

**Nachtrag 5 (2026-08-22): Zähler auf Sammlungs-Karten + der flackernde
Klick.** (a) Live weiter beobachtet: die Buttons triggern MAL („Themenseite
öffnen" lief im erneuten Test), mal behauptet das Modell „mir steht in diesem
Schritt kein passendes WLO-Tool für get_collection_contents zur Verfügung" —
während tools/list live 41 Werkzeuge samt Templates zeigt und derselbe Aufruf
11 Inhalte liefert. Host-seitige Nichtdeterministik; der Server-Hebel (der
geschärfte Satz) IST live. Mein „fehlt im Bundle" davor war ein
FALSCH-NEGATIV: esbuild schreibt Nicht-ASCII als `\xFC`-Escapes, ein
Literal-Grep findet „Rückfrage" im Bundle nicht — Bundle-Greps müssen
escaping-tolerant sein. (b) Nutzerwunsch, ausdrücklich „nur wenn ohne
Zusatzaufwand": Sammlungs-Karten tragen jetzt „N Inhalte · M Skills" als
gedämpfte Faktenzeile — beide Zahlen GRATIS. `childReferencesCount` kommt mit
jedem Treffer der collections-Query (gemessen 2026-08-22: Wellenoptik 59; der
Metadaten-Lesepfad sendet KEIN `collection`-Objekt, auch mit `-all-` — dort
bleibt das Feld weg, Abwesenheit heißt „unbekannt", nie null); die Skill-Zahl
kommt aus dem ohnehin mitreisenden `skillRegistry`, deklarierte Gesamtzahl
schlägt gekappte Liste (dieselbe Regel wie `registrySummaryLines`).
`contentsCount` in `FormattedNode` + Schema + REST-Allowlist. Zwei Lehren aus
dem Bau: **tsx prüft keine Typen** — die Suite war grün, während das Feld im
INTERFACE fehlte, erst `tsc` fand es; und **`tsc | tail; echo $?` liest den
Exit von `tail`** — der Typecheck-Beleg braucht den ungepipten Aufruf. Tore:
TYPECHECK CLEAN (ungepipt) · `npm test` → **2258 pass, 0 fail** (3 neu,
rot-zuerst) · lint 0 · build grün. Hashes: `search-results e6d97ea2 ·
topic-page fa72ae5e · browse ead4beff · reading da7ca6dc`.

**Nachtrag 6 (2026-08-22): „Inhalte anzeigen ging NIE" — die Asymmetrie war
der Schlüssel.** „Themenseite öffnen" triggerte manchmal, `get_collection_contents`
nie ('mir steht in diesem Schritt kein passendes WLO-Tool zur Verfügung') —
also kein Zufallsrauschen. Gemessen: die Live-`_meta` beider Werkzeuge ist
formgleich (nur `browse_collection_tree` trägt `openai/widgetAccessible`),
Listenplätze #1 vs. #12 — Metadaten und Reihenfolge scheiden aus. Der eine
lexikalische Unterschied: die Themenseiten-Beschreibung zitiert ihre
Klick-Nachricht fast wörtlich („Zeige eine WLO-Themenseite" ↔ „Zeige mir die
WLO-Themenseite"), die Sammlungs-Beschreibung nicht („Liste … auf") — und
KEINE Beschreibung nannte ihren Knopf. Jede der vier Button-Ziel-Beschreibungen
trägt jetzt die wörtliche Brücke („Der Widget-Knopf ‚Inhalte anzeigen' führt
hierher." usw.), gepinnt durch einen Test, der `FOLLOW_UP_TOOLS` abläuft und
das sichtbare Knopf-Label in der Beschreibung verlangt (rot-zuerst; dass ALLE
vier das Label nicht trugen, belegen die gelesenen Beschreibungen — der Test
bricht beim ersten Fehltreffer ab). `get_wlo_content_text` (1006/1024 Zeichen) tauschte dafür den
Fast-Doppel-Trigger „den vollen Inhalt anzeigen" gegen seine Brücke — die
selbst den stärkeren Wortlaut „Volltext anzeigen" trägt. Ehrlich bleibt: das
hebt die lexikalische Passung, über die das Modell Werkzeuge wählt; erzwingen
kann es den Aufruf nicht. Server-only — Widget-Hashes unverändert. Tore:
`npm test` → **2259 pass, 0 fail** (1 neu, rot-zuerst) · LINT CLEAN ·
TYPECHECK CLEAN · build grün.

**Upload-Hinweis (Korrektur der Abschluss-Review-Runde, gegen die
Datei-Änderungszeiten verifiziert):** dieses Paket berührt VIER bis dahin nie
gelistete Pfade — `src/tools/collections.ts`, `src/tools/topic-page-content.ts`,
`src/tools/node-relations.ts`, `tests/tool-triggers.test.ts`. Die im Chat
geführte Upload-Liste wächst damit auf **54 Dateien**; die frühere Angabe
„+0 neue Pfade" war falsch. Ohne diese vier erreicht die Brücken-Reparatur
den Server nicht, und der nächste Klick-Test verurteilt den Fix zu Unrecht.

## Audit-Nachbearbeitung 2026-11-05 (Befunde aus dem Gesamt-Audit)

Audit: 77/100, „bedingt produktionsreif" (Bericht im Scratchpad, nicht im Repo).
Abgearbeitet in Paketen, je Paket rot-zuerst und volle Suite als Funktionsnetz.

**P1 — Eingang & Konfiguration (erledigt).**
- **A-1 Batch-Verstärkung:** Das SDK führt jedes Element eines JSON-RPC-Arrays
  aus, das Ratenlimit zählte die HTTP-Anfrage (live belegt: 3er-Batch →
  3 Antworten). Batches bleiben erlaubt (Protokoll 2025-03-26), aber
  `MAX_BATCH_LENGTH` = 10 und JEDES Element wird gegen das Limit gebucht
  (`http-app.ts`). Ablehnen aller Arrays wäre für ältere Clients ein Bruch gewesen.
- **A-2 Image-Rückfall:** `ENV WLO_REPOSITORY_URL=<Produktion>` aus dem Dockerfile
  entfernt — es überschrieb für jedes `docker run` ohne `-e` den bewussten
  Staging-Rückfall des Codes. Gepinnt in `tests/deploy-env-passthrough.test.ts`.
- **Body-Abbruch:** `readBodyWithLimit` liest nach Überschreiten nur noch bis
  `DRAIN_FACTOR` (4) × Deckel; vorher unbegrenztes Drainieren bis zum Timeout.
- **Registry 0600:** Allow-List (enthält Zugangs-ids = Geheimnisse) wird
  owner-only geschrieben. Test ist POSIX-only; unter Windows übersprungen und
  per Docker (`node:24-alpine`) gegen den kompilierten Code nachgewiesen: 600,
  mit eingespielter Verletzung 644.
- **Array-Grenzen:** `keywords` (`MAX_KEYWORDS` 100) und `suggestions`
  (`MAX_SUGGESTIONS` 50) — die letzten zwei ungedeckelten Eingabe-Arrays (zod
  GHSA-mrhx). Schema-Ablehnung vor jedem Upstream-Aufruf, gezählt.
- CLAUDE.md: OAuth-Statuszeile von „IN ARBEIT" auf COMPLETE.
Tore: `npm test` → 2 270 pass, 0 fail, 1 skip (POSIX-Test) · LINT CLEAN · TYPECHECK CLEAN.

**P2 — Abhängigkeiten (erledigt).** `@modelcontextprotocol/sdk` 1.30.0 → **1.32.2**
(sechs Advisories), `npm audit fix` ohne `--force` für die transitiven Pakete,
**zod 3.25 → 4.6.7** (GHSA-mrhx). zod 4 ist ein Major-Sprung, deshalb nicht nur
Tests: `tools/list` unter zod 3 und zod 4 erfasst und verglichen. Die
EINGABE-Schemas (was das Modell liest) sind unter zod 4 sogar 2 % kleiner
(52 493 → 51 412 Zeichen) und unterscheiden sich nur in `additionalProperties:
false` (entfällt — der Server verwirft Unbekanntes unverändert) und einem
Integer-Maximum; null sonstige Unterschiede. Die Ausgabe-Schemas wachsen um
11 % (zod 4 löst `$ref` auf). Audit-Gate `npm audit --omit=dev
--audit-level=high` → Exit 0 (vorher 1).

**P3 — Node 22 LTS (erledigt).** Node 20 ist seit 30.04.2026 ohne Support.
Dockerfile auf `node:22-alpine@sha256:fe4f6d74…` (v22.23.4), CI `node-version:
22`, `engines` `>=22.12.0`, `@types/node` ^22.20.5; README (DE/EN),
CONTRIBUTING (DE/EN), ARCHITECTURE, CLAUDE.md nachgezogen. Belegt am ECHTEN
Image: gebaut, schreibgeschützt gestartet (`--read-only`), Node v22.23.4,
`/health` ok, 42 Werkzeuge, 11er-Batch → 400, Boot-Log `repository:
…staging…` OHNE gesetzte Variable (A-2 am Image bestätigt), und ein echter
`search_wlo_all`-Aufruf gegen Staging (8 Inhalte, 5 Sammlungen).
Tore: `npm test` → 2 270 pass, 0 fail, 1 skip · LINT CLEAN · TYPECHECK CLEAN.

**P4 — SSRF-Bereiche (erledigt).** `isPrivateHost` (`url-safety.ts`) prüft jetzt
über `net.BlockList` (Standardbibliothek) eine CIDR-Liste statt handgeschriebener
Vergleiche. Neu gesperrt — jeweils vorher durch AUSFÜHREN als durchgelassen
belegt: 100.64.0.0/10 (CGNAT, Alibaba-Metadaten 100.100.100.200), 192.0.0.0/24,
198.18.0.0/15, 224.0.0.0/4, 240.0.0.0/4, fe80::/10 vollständig (vorher nur
`fe80`), ff00::/8, 64:ff9b:1::/48. Zusätzlich entpackt: NAT64 `64:ff9b::/96` und
IPv4-kompatibel `::a.b.c.d` (beide führten zu 127.0.0.1). Grenzfälle je Bereich
beidseitig getestet; öffentliche Adressen (8.8.8.8, 100.0.0.1, 2001:4860::…)
bleiben durchgelassen.

**P5 — Low-Sicherheit (erledigt).**
- Bestätigungs-Token an die IDENTITÄT gebunden (`confirm.ts`): Block-`jti`, sonst
  `source:label`. Vorher hätte jemand anderes ein fremdes Token mit identischer
  Änderung unter eigenen Rechten einlösen können. Vorschau und Bestätigung tragen
  bei der Person dieselbe Anmeldung — der Ablauf bleibt unverändert.
- Deckel je Identität: `MAX_PENDING_PER_IDENTITY` (50) für Vorschauen,
  `MAX_CODES_PER_LABEL` (20) für OAuth-Codes. Eine Flut verdrängt nur noch die
  eigenen ältesten Einträge, nicht die anderer Personen.
- Ratenlimit-Schlüssel: IPv6 je /64 (`addressBucket`, `rate-limit.ts`); IPv4 als
  `::ffff:a.b.c.d` (Normalfall auf Dual-Stack-Sockets) behält seine EIGENE
  Adresse — eine naive /64-Kürzung hätte alle IPv4-Clients in einen Topf gelegt;
  eigener Test. Der Passwort-Rate-Limiter erbt den Schlüssel über `clientKey`.
Tore: `npm test` → 2 284 pass, 0 fail, 1 skip · LINT CLEAN · TYPECHECK CLEAN.

**P6 — Release-Identität (erledigt).** `src/version.ts` liest die Version aus
`package.json`; `/health` und MCP-`serverInfo` nutzen sie (vorher zweimal
`'1.0.0'` im Code). Gilt für `src/`, `dist/` und das Image (das `package.json`
neben `dist/` kopiert) — am kompilierten Modul geprüft. Offen und bewusst NICHT
hier: Git-Tags und ein Release-Schritt über Push statt Datei-Upload — das ist ein
Vorgang der Nutzerin, kein Code.

**P7 — `formatter.ts` geteilt (erledigt, verhaltenserhaltend).** 734 → 433 Zeilen.
`text-line.ts` (51) hält `oneLine`/`nodeIdLine`, `registry-render.ts` (275) die
Darstellung des Skill-Katalogs (`registrySummaryLines`, `DESCRIPTIONS_ONLY_NOTE`,
`REGISTRY_INLINE_MAX`, `registryHintFor`, `registryLines`). Die Naht war sauber:
der Registry-Block brauchte von außen nur `oneLine` und den TYP `FormattedNode`,
der Rest von ihm nur zwei Funktionen — kein Laufzeit-Zyklus (Scan: 0 Zyklen über
172 Dateien). `formatter.ts` re-exportiert alle öffentlichen Namen, kein Importeur
musste umziehen. Zwei Wächter in `shared-rule-discipline.test.ts` nannten
`formatter.ts` als EIGENTÜMER der Regel; der Eigentümer zog mit, die Regel nicht —
mit eingespielter Verletzung in `formatter.ts` (jetzt kein Eigentümer mehr) beide
rot, zurückgesetzt grün. Nebenbei behoben: die Doku von `headingFor` stand über
`nodeIdLine` statt über ihrer Funktion.
Tore: `npm test` → 2 287 pass, 0 fail, 1 skip · LINT CLEAN · TYPECHECK CLEAN · build grün.

**P8 — Fehlerpfade der Kuratier-Werkzeuge (erledigt).** Befund: KEINE einzige
Ablehnungs-, Fehlschlag- oder Abbruchmeldung von `wlo_create_collection`,
`wlo_rename_collection`, `wlo_update_compendium`, `wlo_suggest_metadata`,
`wlo_list_suggestions`, `wlo_decide_suggestion` und `get_collection_stats` war
getestet. `tests/curation-failure-paths.test.ts` (10 Tests) prüft den Wortlaut,
den die Person liest — vor allem, dass ein ABGEBROCHENER Schreibvorgang als
offen gemeldet wird („kann also gewirkt haben") und `wlo_decide_suggestion` bei
einem Abbruch den Vorschlag NICHT als entschieden markiert. Charakterisierungs-
tests (der Code war schon richtig) — deshalb mit Gegenprobe: Abbruch-wie-Fehler
und fehlende Titelprüfung eingespielt → 4 rot, zurückgesetzt grün. Zweige:
curation-decide 70 → 78 %, curation-collections 67 → 74 %, collection-stats
57 → 67 %, curation-compendium 66 → 70 %, curation-suggestions 66 → 69 %. Die
80 % wurden bewusst NICHT weiter gejagt: der Rest sind `??`-Rückfälle für
Parameter, die das Schema bereits garantiert — Tests für unmögliche Fälle.

**P9 — Doku (erledigt, mit einer bewussten Ausnahme).** `STATUS.md` 9 231 →
~3 470 Zeilen: alle Einträge vor dem 15.08. VERBATIM nach
`archive/STATUS-2026-07-15-bis-2026-08-14.md`, Fortschrittstabelle und Verweis
bleiben oben. `MCP-REFERENZ.md` + HTML-Artefakt (gleiche URL, Version
`audit-2026-11-05`): Batch-Zählung, IPv6-/64, Registry 0600.
**CLAUDE.md NICHT eingedampft:** sie ist die bindende Verfassung, und jede
Regel darin ist an einer Messung festgemacht. Kürzen hieße Regeln umformulieren
— genau dabei gehen sie verloren. Das braucht eine redaktionelle Entscheidung
der Nutzerin, keinen Mechanismus.

**Gesamtergebnis der Nachbearbeitung.** `npm test` → 2 297 pass, 0 fail, 1 skip
(POSIX-only, per Docker nachgewiesen) · LINT CLEAN · TYPECHECK CLEAN · build
grün · Audit-Gate Exit 0 · 0 Import-Zyklen (172 Dateien). Widget-Hashes
UNVERÄNDERT (`search-results e6d97ea2 · topic-page fa72ae5e · browse ead4beff ·
reading da7ca6dc`) — die Widgets waren nicht betroffen. Live NICHT geprüft:
Batch-Deckel und IPv6-Schlüssel am vServer (am lokalen Image nachgewiesen).

## 2026-11-05 — Auth-Prüfung (WLO-Anmeldung: Annahme, Nutzung, Weiterreichung)

Geprüft: Basic, `wlo2.`-Block, OAuth, Ticket-Tausch, Ausstellung, Allow-List,
Anfrage-Scope, Weiterreichung. Gemessen statt angenommen: Node 22 verwirft den
`Authorization`-Header bei einer Weiterleitung auf einen FREMDEN Host (zwei
lokale Server, echtes `wloFetch`), innerhalb des Repositorys bleibt er.

**Befund 1 (Skill-Katalog-Cache) — als Sicherheitsbefund zurückgezogen,
Nutzerentscheidung.** Der Cache ist nach Sammlungs-id geschlüsselt und wird unter
der Anmeldung des jeweiligen Fragers befüllt (nachgestellt: ein anonymer Aufruf
erhielt danach Katalogtitel + Skill-Eintrag ohne eigenen Abruf). Aber `get_skill`
liest jeden Skill LIVE mit den Rechten des Aufrufers — die Anleitungen schützt
edu-sharing; sichtbar werden kann höchstens Titel/nodeId/Anweisung des Katalogs,
und der Katalog SOLL für anonyme Chatbot-Nutzer lesbar sein. Rest: ein
angemeldeter Nutzer kann bis zu 10 min ein „keine Registry" aus einer anonymen
Abfrage sehen — bewusst NICHT behoben, weil jede angemeldete Suche sonst je
Sammlung live nachfragen müsste (~1 s).

**Befund 2 (abgelehnte Anmeldung) — behoben.** Nach einer Passwortänderung blieb
der Block gelistet; jeder Aufruf schickte das alte Passwort, die Person las
„ngsearch failed: 401" oder „nicht öffentlich". Jetzt: `wloFetch` merkt sich je
ANFRAGE-Credential (Objektidentität; Personen-Anmeldungen werden je HTTP-Anfrage
neu gebaut, das Dienstkonto ist ausgenommen) einen 401 und schickt den Login in
DERSELBEN Anfrage nicht erneut; die Registrierungs-Naht (`tool-defaults.ts`,
alle 42 Werkzeuge) stellt bei abgelehnter Anmeldung eine klare Meldung als
Block 0 voran, setzt `isError` und hängt `mcp/www_authenticate` an;
`nodeLookupMiss` trennt 401 (Anmeldung) von 403 (nicht öffentlich). Grenze,
ehrlich: eine bereits laufende PARALLELE Welle (die drei Abfragevarianten einer
Suche) lässt sich nicht zurückholen, ohne jede Suche zu serialisieren — die
Abkürzung wirkt auf nachfolgende Schritte. Live gegen Staging mit erfundener
Anmeldung belegt: Block 0 = Meldung, `isError`, Neu-Anmelde-Aufforderung.
Gegenprobe: Abkürzung bzw. Hülle entfernt → je ein Test rot.

**Befund 3 (Widerruf nur im Prozess) — dokumentiert.** Ein-Instanz-Annahme in
`access-registry.ts`, README (DE/EN), AUTH.md, MCP-REFERENZ + HTML-Artefakt.

Tore: `npm test` → 2 304 pass, 0 fail, 1 skip · LINT CLEAN · TYPECHECK CLEAN · build grün.

### Review derselben Änderung (2026-11-05) — 3 Befunde, alle behoben

1. **[MAJOR] Jeder 401 galt als abgelehnte Anmeldung.** edu-sharing antwortet
   401 auch einer GÜLTIGEN Anmeldung ohne Recht (gemessen, Skill
   `wlo-edu-sharing-api`: `/bulk/v1/find` → 401 „Admin rights are required").
   Folge wäre gewesen: Rest der Anfrage gesperrt, „bitte neu anmelden" samt
   Login-Aufforderung — eine Schleife, die Neuanmelden nicht löst. Jetzt
   bestätigt `wloFetch` einen 401 einmal je Anfrage gegen
   `/iam/v1/people/-home-/-me-` (`IDENTITY_URL`, `wlo-config.ts`); nur dessen 401
   markiert. 5xx/Zeitüberschreitung dort = nicht abgelehnt (fällt auf das alte
   Verhalten zurück). Kosten: ein Abruf, nur wenn ein 401 kommt.
2. **[MINOR] Ein Werkzeug, das WIRFT, verlor die Meldung** — das SDK machte aus
   dem Wurf einen Block 0 mit der rohen Fehlermeldung. Die Hülle fängt ihn bei
   abgelehnter Anmeldung ab; sonst wird unverändert weitergeworfen.
3. **[MINOR] `nodeLookupMiss` behauptete bei 401 „Anmeldung abgelehnt"** — nach
   (1) nicht mehr gedeckt; neutraler Wortlaut, die Meldung in Block 0 sagt es,
   wenn es zutrifft.

Live gegen Staging: erfundene Anmeldung → Block 0 = Meldung, `isError`,
Neu-Anmelde-Aufforderung; gültige Anmeldung als Personen-Login → normale
Treffer (1 592), keine Meldung. Neue Tests in `credential-rejected.test.ts`
(11, vorher 7) waren vor der Behebung rot. Tore: `npm test` → 2 308 pass,
0 fail, 1 skip · LINT CLEAN · TYPECHECK CLEAN · build grün.


## 2026-11-06 — Stapel-Ablage in den persönlichen Bereich (MA-1…MA-5, für den Chatbot U3-3)

**Gebaut** (alles neu, hinter `WLO_BATCH_UPLOAD_ENABLED`, Vorgabe aus): Datei-Arten aus den Bytes (MA-1),
Upload-Platz `POST /api/uploads` im Arbeitsspeicher (MA-2), Stapel-Freigabe (MA-3), Stapel-Anlegen mit
Ordner-Entscheid über `validateSession` und Rückfall „flach“ (MA-4), Doku (MA-5). Abweichungen vom Plan
(`boerdi-chat/docs/plans/2026-11-04-pakete-sammlungsstrukturen-upload-mcp.md`): Rohkörper statt Multipart;
Speicher statt Temp-Datei (Regel „nichts auf der Platte“); Upload nur mit bestätigter Anmeldung über
`proveLogin`; Read-back über `size` (gemessener Weg), nicht über `content.hash` (ungemessen).

**Offen:**
- **Verdrahtung:** eine Zeile `registerCurationBatchTools(server, challenge)` in `src/server.ts` — die Datei
  trägt uncommittete Nutzeränderungen; Rückfrage an den Nutzer. Die Route ist in `http-app.ts` eingehängt.
- **MA-0 (Messung, Nutzer):** Dürfen Personen im persönlichen Bereich Ordner anlegen
  (`TOOLPERMISSION_CREATE_ELEMENTS_FOLDERS`)? Welche Typen/Größen nimmt edu-sharing? Ohne Messung gilt
  der vorsichtige Rückfall „flach“. Ein Live-Durchlauf gegen Staging nur mit Testkonto und Freigabe.
- `AUTH_CREDENTIAL_LIMIT` zählt verschiedene Anmeldungen je Adresse — der Chatbot ist EINE Adresse für alle
  Personen (wie schon bei `/mcp`); für die Stapel-Ablage ggf. höher setzen.
- Eine Instanz (Speicher-Tabellen wie bei den Bestätigungs-Schlüsseln).

Zwei Review-Runden (MA-1/MA-2: 3 MAJOR, 6 MINOR; MA-3/MA-4: 5 MAJOR, 8 MINOR) — alle behoben, u. a.: 413/408
erreichen den Client (Ablaufen statt Abreißen, im Rahmen `DRAIN_FACTOR`), Upload nur mit bestätigter Anmeldung
(`proveLogin`), `vorgang.json` vom Server aus der Freigabe gebaut, Titel und Inhalt zurückgelesen, nodeId auch nach
Fehlern, nur 403 beim Ordner führt zu „flach“.

Tests: `write-file-types`, `write-upload-slot`, `rest-upload-route`, `write-batch-confirm`,
`write-batch-filing`, `tools-curation-batch`; Suite 2363 grün, Typprüfung und Lint sauber.

## 2026-11-06 — Themenseite parallel · BOERDi-Wunschliste: Machbarkeit + P1

**Perf (Messung 2026-11-05 umgesetzt):** `get_topic_page_content` lädt den
Freigabekatalog der Sammlung jetzt GLEICHZEITIG mit den Swimlanes
(`Promise.all`, `tools/topic-page-content.ts`). Gemessen hing er ~1 s von 3,5 s
hinten dran, obwohl er nur die Sammlungs-id braucht. Test hält die Widget-Antwort
zurück, bis der Katalog-Abruf gestartet ist — seriell lief er in die Frist (rot),
jetzt grün. Ergebnis unverändert. Offen, bewusst: Ergebnis-Cache (erst
Trefferquote messen) und Zeitbudget für die Registry-Nachfrage der Suche
(Produktentscheidung, der Katalog soll an jeder Sammlungsantwort hängen).

**Wunschliste:** Machbarkeit je Punkt, Blocker und sechs Entscheidungen (E1–E6)
in `docs/plans/2026-11-06-boerdi-wunschliste.md`. Blockiert: 9 (Ablagen
wiederfinden — MA-0 ungemessen); nur eingeschränkt: 5 mit `withinCollectionId`
(keine exakte Teilbaum-Zahl im Repository). Gemessener Fehler nebenbei (12c):
`"CC BY NC"` und `"cc by nc sa"` filtern still auf `CC_BY`.

**P1 umgesetzt:**
- 12a: jede Vorschau trägt `structuredContent.confirm = {token, expiresAt,
  preview: {action, target, statement?, fields[{name,label,old,new}]}}`, gebaut in
  `previewReply` aus DEMSELBEN ChangeSet, an den der Schlüssel bindet; Ablaufzeit
  aus `TOKEN_TTL_MS` und demselben `now` wie `mintToken`.
- 12f: `registerCurationBatchTools(server, challenge)` in `server.ts`. Ohne
  `WLO_BATCH_UPLOAD_ENABLED` registriert sie nichts — Werkzeugliste unverändert.
- Doku: README DE/EN („nicht verdrahtet" entfernt, strukturierte Bestätigung),
  MCP-REFERENZ (Stapel-Werkzeuge, `WLO_BATCH_UPLOAD_ENABLED` und die drei
  `UPLOAD_*`-Schlüssel, die bisher fehlten; Env-Zahl 34 → 38) + HTML-Artefakt
  (Version `1793951430-cb24`).

Tests: `curation-structured-confirm.test.ts` (3, vorher alle rot),
`tools-topic-page-content.test.ts` (+1, vorher rot). Tore: `npm test` → 2 367
pass, 0 fail, 1 skip · LINT CLEAN · TYPECHECK CLEAN · build grün. Nicht live
geprüft: P1 schreibt nichts Neues ans Repository (Vorschau-Form, Verdrahtung).

**Nächstes Paket:** P2 (12c, 12d, 3, 2, 4) — 2 wartet auf E6.

### Nachtrag 2026-11-06 — Rückmeldung des BOERDi-Teams zu P1

- **12a erweitert:** `preview.tool` (Werkzeugname, gestempelt an der einen Naht
  `registerCurationTool` — keine zweite Tabelle von Operationsnamen),
  `oldLabels`/`newLabels` aus DERSELBEN Beschriftung wie die Text-Vorschau
  (`displayValue`, jetzt exportiert) und nur, wo die Bezeichnung etwas anderes
  sagt als der Wert; ohne Änderung `{confirm: null, unchanged: true}`.
  Tests: `curation-structured-confirm.test.ts` 5 (die vier neuen Zusicherungen
  vorher rot).
- **Env-Zahl nachgezählt, nicht gerechnet:** der Server liest **40** Schlüssel
  (alle Lesewege: `process.env[…]`, `process.env.X`, `env[…]` im Transport,
  `envMs('…')`); jeder der 40 ist in der Referenz beschrieben. Die bisherige 34
  lag schon um 2 daneben, die 38 aus der Rechnung 34 + 4 also auch. Korrigiert in
  MCP-REFERENZ und HTML-Artefakt (Version `1793951992-a3b1`).
- **`server.ts` geprüft:** meine Änderungen dort sind genau die Import-Zeile und
  der Drei-Zeilen-Block der Stapel-Registrierung, beide als exakte Ersetzung;
  der übrige Abstand zu HEAD (148+/655−) ist der nie committete Umbau.
- **Entscheidungen** E1, E2, E3, E5, E6 übernommen (Plan-Datei); **E4 offen beim
  Nutzer** (Fortsetzungsschlüssel), MA-0 wartet auf ein Testkonto.
- Die Tempo-Änderung an `get_topic_page_content` gehört nicht zur Wunschliste —
  beim Hochladen als eigener Schritt.

## 2026-11-06 — BOERDi-Wunschliste P2 (12c, 12d, 3, 2, 4)

**Gebaut:**
- **12c Lizenz nur exakt:** `resolveVocabMatch` (`vocabs.ts`) sagt, WIE ein Wert traf
  (`exact`/`alias`/`fuzzy`); `resolveVocab` ist darauf aufgesetzt und antwortet für
  jede Nicht-Lizenz unverändert. Lizenzen haben keine unscharfe Stufe mehr: gemessen
  wurden `"CC BY NC"` und `"cc by nc sa"` still zu `CC_BY` — der freiere Lizenzwert.
  Der festgeschriebene Korpus (16 Schlüssel) blieb grün: kein echter Wert hing daran.
- **Unscharfe Filter in `_queryMeta`:** `LabeledCriterion.match: "fuzzy"` — über
  `buildFilterCriteria`, also ohne eine der fünf Aufrufstellen anzufassen.
- **12d:** `lookup_wlo_vocabulary` listet alle Aliasse (gemessen höchstens ~350
  Zeichen mehr je Vokabular).
- **3 `resolve_wlo_filters`** (`filter-resolve.ts` rein, `tools/filter-resolve.ts`):
  je Wert `status`, bei `fuzzy` mit `suggestions`, Unaufgelöstes in `unresolved`,
  OER mit seinen vier Schlüsseln. Kein Repository-Abruf (Test zählt null).
- **2 `find_content_by_url`** (`services/url-matches.ts`, `tools/find-by-url.ts`):
  Messung 2026-11-06 an echten Datensätzen — die `ccm:wwwurl`-Suche ist
  groß/klein-unempfindlich, liefert NACHBARN mit (`…-teil-2`), findet aber mit
  Schrägstrich oder `utm_` die gespeicherte saubere Adresse NICHT. Deshalb bis zu
  drei Schreibweisen je Adresse und ein Vergleich jedes Treffers; `exact` /
  `normalized`; Fehler je Eintrag; `includeCollections` begrenzt parallel.
  `findByUrl` (Dublettenprüfung beim Anlegen) läuft über dieselbe Abfrage und bleibt
  streng. Ein dabei geschriebener Kommentar („nur exakte Treffer") war falsch und
  ist nach der Nachmessung korrigiert — im Code, im Test, in Referenz und HTML.
- **4 `wlo_create_content` + `addToCollectionId`:** die Aufnahme steht im ChangeSet
  (`addTo` im Fingerabdruck UND im Aktionssatz — ein Wächter-Test prüft `addTo`
  allein, Gegenprobe rot). Anlegen, dann aufnehmen; scheitert die Aufnahme, bleibt
  der Datensatz (`collection.status: failed` + Code, kein `isError`). Ziel wird VOR
  der Vorschau gelesen und muss `ccm:map` sein. Dublette zur URL → Vorschau bietet
  an, DEN vorhandenen aufzunehmen (eigener ChangeSet); liegt er schon drin →
  `already`, kein Schlüssel. `isUpstreamTimeout` dafür nach
  `services/write/timeouts.ts` verlegt (re-exportiert in `curation-shared`).

**Review (3 Befunde, alle behoben):** Nicht-Sammlung als Ziel (MINOR),
unbegrenzte Sammlungszählung (MINOR), fehlende Doku zu `structuredContent` (NIT).
Bewusst nicht gebaut: `mayAdd` in der Vorschau (Rechte-Semantik ungemessen).
Notiert, bestehend: bei einer Startseiten-Adresse fluten Nachbarn die 20 Treffer.

**Live (Staging, anonym, nur lesend):** `resolve_wlo_filters` 106 ms, alle
Wunschlisten-Beispiele wie erwartet; `find_content_by_url` 825 ms für 4 Adressen,
die `utm`/Fragment/Schrägstrich-Variante als `normalized` gefunden. **Nicht live:**
Punkt 4 schreibt — erst mit Freigabe des Nutzers.

Werkzeuge: 30 lesend + 14 kuratierend = 44 (Doku, Tests, HTML-Artefakt
`1793955051-68c5`). Tore: `npm test` → 2 398 pass, 0 fail, 1 skip · LINT CLEAN ·
TYPECHECK CLEAN · build grün.

**Offen beim Nutzer:** Freigabe E4 (Fortsetzungsschlüssel) und der Messung auf
Staging; Testkonto für MA-0. **Nächstes Paket:** P3 (1 `get_collection_overview`,
8 `get_node_details` eins/viele).

### Zweiter Review P1 + P2 (2026-11-06) — 4 Befunde, alle behoben

1. **[MINOR] Stapel-Ablage ohne `structuredContent.confirm`** (12a verlangt die
   Form bei ALLEN schreibenden Werkzeugen) — ergänzt, Ziel `home`, Ablaufzeit vor
   dem Prägen berechnet (nie später als die echte); `batchToken` bleibt.
2. **[MINOR] „liegt bereits in der Sammlung" ohne `{confirm: null, unchanged: true}`**
   — ergänzt.
3. **[MINOR] Aufnehmen eines vorhandenen Datensatzes verschwieg, dass die
   angegebenen Metadaten NICHT übernommen werden** — der Schlüssel bindet an den
   Satz; er sagt es jetzt und verweist auf `wlo_update_content`.
4. **[MINOR] Lizenz-URI galt als `exact`** (gemessen: wurde als
   `ccm:commonlicense_key` gesendet, das nur Schlüssel kennt → stille 0 Treffer)
   — jetzt ungelöst mit Vorschlag. Andere Vokabulare nehmen URIs unverändert;
   der Lizenz-Korpus (16 Schlüssel) blieb grün.

Neue Tests vorher rot. Tore: `npm test` → 2 400 pass, 0 fail, 1 skip · LINT CLEAN ·
TYPECHECK CLEAN.

## 2026-11-06 — BOERDi-Wunschliste P3 (1 `get_collection_overview`, 8 `get_node_details` eins/viele)

**8 (E3):** `get_node_details` nimmt `nodeIds` (1–50) neben `nodeId`, genau eines
von beiden (sonst Rückfrage, kein Log-Fehler). Mit `nodeIds` IMMER eine Liste
`{total, count, results, missing}`, Anreicherungen je Ergebnis im Schema
deklariert; mit `nodeId` die alte Form. Der Ladekern zog wortgleich nach
`services/node-details.ts` (`loadNodeDetails`, `TEXT_ENRICH_MAX`) und wird von
`get_nodes_details` (bleibt, Beschreibung verweist und wurde unter die
1024-Zeichen-Grenze gekürzt) und `get_node_details` geteilt.

**1:** `services/collection-overview.ts` + `tools/collection-overview.ts`. Kopf
lesen (Verknüpfung → Original; `not_found`/`forbidden`/`not_a_collection` als
`{error:{code,message}}` + `isError` — gemessen am SDK: Fehlerantworten werden
nicht gegen das `outputSchema` geprüft), dann alle Teile parallel
(`Promise.allSettled`); ein gescheiterter Teil steht in `missing: [{part, code}]`.
Zwei Entscheidungen beim Bauen, beide gemessen bzw. regelbegründet:
- **Gliederung nur Tiefe 0–1** + `headings` + `tocDepthLimited`: Optik hat live
  242 Überschriften, das volle Verzeichnis sind 19 KB JSON gegen 1,3 KB für zwei
  Ebenen (188 der 242 auf Ebene 2). Kostet keinen Abruf (Kopf liest `-all-`).
- **`not_checked`** für eine Skill-Suche, die nicht beantwortet hat (z. B. die auf
  50 begrenzte Registry-Suche über 212 Kinder) — kein Fehler und NICHT „keine
  Skills". Gefunden, weil ein Test genau das falsch annahm.
- `subcollections` als Liste wie in der Wunschliste, Kappung als
  `subcollectionsTruncated`. `DESCRIBED_MAX` hat jetzt EINE Heimat
  (`services/skill-registry.ts`), vorher privat in `tools/shared.ts`.
- Bewusste zweite Stelle im Wächter „single collection's registry"
  (`shared-rule-discipline`) mit Begründung: strukturierte Antwort, beide Regeln
  eingehalten und getestet.

**Review (2 Befunde, behoben):** Skill-Liste mit nodeIds ohne
`DESCRIPTIONS_ONLY_NOTE` (MINOR — der Wächter sieht neue Oberflächen nicht);
Kosten von `maxSubcollections` nicht genannt (NIT).

**Live (Staging, anonym, lesend):** Übersicht Optik 2 221 ms gegen 3 240 ms für
die drei Einzelaufrufe (Abnahme erfüllt), Pfad „WLO › Physik › Optik", 168
Inhalte / 6 Untersammlungen / 4 Skills, `missing: []`; Material als Sammlung →
`not_a_collection`; `get_node_details` mit 4 ids 307 ms, die ungültige in `missing`.

Werkzeuge: 31 lesend + 14 kuratierend = 45 (Doku, Tests, HTML-Artefakt
`1793963926-c48a`). Tore: `npm test` → 2 414 pass, 0 fail, 1 skip · LINT CLEAN ·
TYPECHECK CLEAN · build grün.

**Nächstes Paket:** P4 (5 `count_wlo_content_matches` ohne `withinCollectionId`,
11 Baum Tiefe 3). Offen beim Nutzer: E4-Freigabe + Messung, Testkonto MA-0.

## 2026-11-06 — Staging-Messungen (freigegeben: nur eigene Daten, danach aufräumen)

**Dienstkonto ist Admin** (`validateSession`: `isAdmin: true`, 82 Tool-Rechte) —
deshalb **kein MA-0**: gefragt ist, was eine GEWÖHNLICHE Person im eigenen Bereich
darf. Ein Testkonto steht nicht in `.env` (nur `WLO_REPOSITORY_URL`,
`WLO_SERVICE_USER`, `WLO_SERVICE_PASSWORD`, `WLO_TEXT_EXTRACTION_URL`).

**Sammlungs-Anlage (für E4):** Anlegen + Zurücklesen nacheinander Median 1 185 ms,
Max 1 391 ms (n = 12); vier gleichzeitig je Aufruf Median 1 346 ms, Gesamt 4 167 ms
für 12 = **347 ms je Sammlung**. Eltern-Sammlung auf oberster Ebene 2 805 ms.
Aufräumen: 26/26 eigene Knoten gelöscht und als weg bestätigt; jedes Löschen nur
nach Prüfung „id aus diesem Lauf UND Titel beginnt mit `BOERDi-Messung`".

**Staging-Regression — Sammlungs-Verknüpfungen scheitern (Ursache im Repository):**
`PUT /collection/v1/collections/-home-/{c}/references/{n}` → **500**
`InvalidTypeException: The node's content can't be updated via
NodeService#setProperty directly … property name: content` — für Datei- UND
Link-Datensätze, sofort und nach 10 s; ein zweiter Versuch → **409**
`DuplicateNodeName` (halb angelegter Verknüpfungsknoten, verschwindet mit der
Sammlung). Beleg, dass es nicht an unserem Code liegt: der unveränderte
Live-Vertragstest `tests/live/reference-delete.test.ts` (grün am 2026-08-17)
scheitert heute an genau diesem Schritt. Unser Verhalten ist richtig (Aufnahme
`failed`, Datensatz bleibt). Folgen: Punkt 4 ist live NICHT nachweisbar, Punkt 7
(`wlo_add_to_collections`) bis zur Behebung nicht live testbar;
`wlo_add_to_collection` ist auf Staging derzeit kaputt. Zu melden ans
edu-sharing-/Staging-Team.

**Alte Testreste gefunden, NICHT gelöscht** (Vorgabe des Nutzers): 6 Datensätze
`example.org/wlo-mcp-live-contract/<ms>` im Heimordner des Dienstkontos, Zeitstempel
August 2026 (frühere Live-Läufe von `write-contract.test.ts`). Entscheidung beim Nutzer.

## 2026-11-06 — BOERDi-Wunschliste P4 (5 `count_wlo_content_matches`, 11 Baum Tiefe 3)

**5:** `services/content-count.ts` + `tools/content-count.ts`. Eine Suche je
Anfrage (`ngsearchword` + Filter), keine Varianten, kein Reranking — `total` ist
`pagination.total`. Ein NICHT auflösbarer Filter wird nie weggelassen (die Anfrage
landet in `missing` als `unresolved_filter`), ein geratener steht in
`fuzzyFilters`. Ohne `withinCollectionId` (E5). Fehler je Anfrage über das neue
`services/failure-code.ts`, das jetzt auch die Sammlungsübersicht nutzt.
**Gemessen live:** 8 Anfragen 472 ms; Wiederholung identisch. Und: die Zahl
zählt JEDEN Volltexttreffer — „Spiegelbild" 150, bester Treffer zu Arbeitsmärkten
am Golf. Steht deshalb in der Beschreibung: die Top-Treffer zeigen, wie gut die
Zahl zum Thema passt; eine Lücke nicht allein an einer großen Zahl verneinen.

**11:** `browse_collection_tree` bis `depth: 3`. Gesamtdeckel **300 Knoten**,
VOR dem Lauf aus der Breite der ersten Ebene berechnet (größtes k mit
L1·(1+k+k²) ≤ 300 — alle Äste gleich breit, kein Zähler, den nebenläufige Arbeiter
in beliebiger Reihenfolge leeren); Ebene 3 je Ast nacheinander, damit bleibt es bei
höchstens 40 gleichzeitigen Abrufen (Test misst den Spitzenwert);
`truncatedAt` = erster gekappter Ast in Listenreihenfolge, im Schema deklariert.
**Live:** Physik in Tiefe 3 mit Zählung: 4,9 s, 89 Knoten, dritte Ebene erreicht.

Gegenproben (Schranken ausgebaut → Test rot): Tiefe ≤ 3, ≤ 30 Anfragen.
Werkzeuge: 32 lesend + 14 kuratierend = 46 (Doku, Tests, HTML `1793966505-b830`).

**Nächstes Paket:** P5 (7 `wlo_add_to_collections`, 6 `wlo_create_collection_tree`)
— beide brauchen die E4-Antwort des Chatbot-Entwicklers, und 7 lässt sich wegen der
Staging-Regression (Verknüpfungen → 500) derzeit nicht live prüfen.

### E4 entschieden (2026-11-06): B

Antwort des BOERDi-Teams: der Server hält die Freigabe für den ganzen Plan,
Fortsetzungsschlüssel bei Bedarf, C nur als Rückfall (dann bestätigt die PERSON).
Anforderungen und Entwurf: `2026-11-06-boerdi-wunschliste.md`, Abschnitt „P5 —
Entwurf" — wichtigste: Schlüssel von derselben Identität wiederholbar (ein
erneuter Aufruf setzt fort oder liefert dasselbe Ergebnis, nie doppelt),
`plan_expired`/`plan_mismatch` als eigene Codes, `progress {done, total}` und
die Zuordnung Plan-Knoten → nodeId, Zeitbudget 40 s unter ihrem 60-s-Limit.
**Nächstes Paket: P5 nach diesem Entwurf.** (erledigt, siehe unten)

## 2026-11-06 — BOERDi-Wunschliste P5 (6 `wlo_create_collection_tree`, 7 `wlo_add_to_collections`)

**Baustein** `services/write/plan-runner.ts`: Planspeicher im Arbeitsspeicher,
gebunden an Anmeldung UND Argumente (Hash), 30 min ab Bestätigung, höchstens 5 je
Anmeldung; Läufer mit 40 s Budget, Pool 4, von oben nach unten; ein gescheiterter
Knoten überspringt seinen Teilbaum (`parent_failed`); ein zweiter Aufruf während
eines Laufs bekommt `inProgress`. Bestätigungs- wie Fortsetzungsschlüssel dürfen
von derselben Anmeldung erneut vorgelegt werden. Antwortform einmal in
`tools/curation-plan-reply.ts`. Die Schritte jedes Plans stehen als
`ChangeSet.items` in der Vorschau und im Fingerabdruck.

**6:** `services/write/collection-tree.ts` + `tools/curation-tree.ts`. Vorschau
liest nur unter vorhandenen Sammlungen; vor dem Anlegen wird nachgesehen, wo der
Knoten schon existieren könnte (unter Vorhandenem, oder nach einem Abbruch).
**7:** `services/write/filing-plan.ts` + `tools/curation-add-many.ts`. Beide Enden
jedes Paars vor der Vorschau gelesen; Verknüpfung → Original; doppelte Paare ein
Schritt; `already` per `/usage` vor dem Senden.

**Live-Befund, der jeden Test überlebt hatte:** der erste Lauf auf Staging meldete 5
von 40 Anlagen als gescheitert — sie existierten alle. Ursache gemessen:
Geschwister gleichzeitig unter derselben Elternsammlung → 500
`ConcurrencyFailureException: Acl…`, die Sammlung entsteht trotzdem (17/24);
verschiedene Eltern parallel 12/12. Behoben: Anlagen je Elternsammlung
nacheinander, und ein abgelehntes Anlegen wird nachgeschlagen (`unverified`
statt `failed`). Dabei aufgefallen: die frühere Messung „0,35 s je Sammlung bei 4
parallel" war falsch — `mapPool` verschluckt Fehlschläge, gezählt wurde nur, was
durchkam. Im Plan korrigiert.

**Live nach der Korrektur (eigene Daten, alles gelöscht):** 40 Knoten in einem
Aufruf 15,8 s, alle `created`; Schlüssel erneut → dasselbe Ergebnis; `merge`-Lauf
40/40 vorhanden, nichts angelegt; Budget 0 → 1/4 → 3/4 → 4/4; Teilbaum gegen
Meldungen Abweichung 0; 7 → `failed/upstream_error` (Staging-Regression, sauber
gemeldet). Aufräumen über die Auflistung des Teilbaums: 46/46. Der erste Lauf
hatte 6 ungemeldete Sammlungen hinterlassen; sie lagen unter der gelöschten
Elternsammlung, die Suche über beide Sammlungs-Indizes findet 0 Reste.

Review (8 Befunde, alle behoben, jeder mit rotem Test bzw. Mutationsprobe):
Beschreibung VOLL in der Vorschau (gekappt teilten sich zwei Beschreibungen einen
Schlüssel), leerer Titel, Obergrenze je Anmeldung, Abbruch bei 7 bleibt offen,
`inProgress`-Test, Doku, Wortlaut. Tests 2450 grün, 1 Skip (POSIX). Werkzeuge: 32
lesend + 16 kuratierend = 48 (Doku, Tests, HTML `1793969029-3f8c`).

**Offen:** 7 live nach Behebung der Staging-Regression. Folgepunkt:
`wlo_create_collection` (einzeln) meldet einen 500er beim Anlegen noch als „nicht
angelegt" — nur bei gleichzeitiger Anlage durch jemand anderen relevant.
**Nächstes Paket:** P6 (12b `excludeNodeIds` in `search_wlo_within_collection`,
10 `get_skill_registry` + `task`; 9 wartet auf MA-0 / Testkonto).

## 2026-11-06 — MA-0 gemessen (Testkonto, kein Admin) + Staging-Upload-Regression

Testkonto (`WLO_TEST_USER`/`WLO_TEST_PASSWORD` in `.env`): `validateSession` →
kein Admin, kein Gast, 52 Werkzeugrechte, `TOOLPERMISSION_CREATE_ELEMENTS_FOLDERS`
**nein**, `…_COLLECTIONS` ja. Gemessen über die ECHTE Stapel-Ablage
(`wlo_prepare_file_batch` → `wlo_store_batch_file` × 5 → Manifest):

- **Ordner im eigenen Bereich:** nein — und das Repository bestätigt es: der echte
  Versuch antwortet 403 → `denied`. `folderLayout()` sagt `flat`, der Stapel läuft
  flach. Die Annahme aus MA-4 stimmt.
- **Ablageort:** direkt in `-userhome-` (5/5 dort gelistet, `primaryparent` gesetzt).
- **Suche für den Besitzer:** `ngsearch` findet die eigenen Ablagen **sofort**
  (5/5 nach 0 s) — die Frage, an der Punkt 9 hing.
- **Dateiarten/-größen: NICHT messbar.** Jeder Upload → HTTP 500
  `InvalidTypeException: The node's content can't be updated via
  NodeService#setProperty directly … property name: content` — PDF (193 B und
  8,6 MB), DOCX, PNG, Markdown. Gegenprobe mit NACKTEN REST-Aufrufen, ohne unseren
  Code: derselbe Fehler bei Testkonto UND Dienstkonto. Der Datensatz entsteht, die
  Bytes nicht (`size=null`). **Dieselbe Ausnahme wie die Regression beim Aufnehmen
  in Sammlungen** — ein Staging-Defekt, zwei lahme Wege. Der Stapel meldete es
  ehrlich (`dropped` mit Kennung).

Aufräumen: 5/5 Ablagen + 2 Probe-Datensätze gelöscht (danach 404), 0 Reste dieses
Laufs im eigenen Bereich; die 10 übrigen Einträge des Testkontos unangetastet.

**Folge:** Punkt 9 ist für den ENTWURF frei (Ort + Sichtbarkeit gemessen); die
Typen-/Größenfrage wartet auf die Behebung auf Staging.

**Nächster Schritt (Nutzerwunsch 06.11.): Code-Review der heutigen Änderungen**
(51 Quelldateien, ~10 700 Zeilen nach Änderungszeit, uncommittet — kein Diff
möglich), in vier Sitzungen à ≤ 400 Zeilen Kern-Logik, Befunde im Chat (keine
Review-Dateien im Repo): **R-A** Stapel-Ablage (file-types, zip-entries,
file-signatures, upload-slot, upload-route, batch-confirm, batch-filing,
curation-batch, http-app, access-verify) · **R-B** Wunschliste P1/P2 (change-set,
confirm, curation-shared, filter-resolve, vocabs, filter-criteria, url-matches,
find-by-url, create-filing, curation-content, duplicates, verify, collections) ·
**R-C** P3/P4 (node-details, collection-overview, skill-registry, content-count,
collection-traversal, browse, outputSchemas) · **R-D** Querschnitt (topic-page-content,
server.ts, tool-status, nodes-lifecycle, vocabulary, P5 im Zusammenhang). Danach P6.

## 2026-11-06 — Review der heutigen Änderungen (R-A…R-D) — erledigt, alle Befunde behoben

**R-A Stapel-Ablage** (5): ein abgebrochenes Ablegen blieb für immer „wird gerade
abgelegt“ und lief ohne `timeoutOrError` hinaus → als `unverified` verbucht; ein
abgebrochenes `vorgang.json` wurde beim nächsten Aufruf als „liegt schon ab“
gemeldet → das Manifest trägt jetzt sein Ergebnis (wie `redeem`); Gesamtgrenze
500 Stapel; zwei veraltete Kommentare. **R-B Wunschliste P1/P2** (1): ein Abbruch
beim LESEN vor der Bestätigung meldete „ob angelegt, ist offen“ → nur noch nach
eingelöstem Schlüssel. Zwei Verdachte per Messung widerlegt und am Code
festgehalten: die Adress-Suche setzt die gespeicherte Adresse auf Rang 0 (40/40)
und liefert nur Originale (0 Verknüpfungen bei 50). **R-C P3/P4** (3): `missing`
von `get_node_details` mit `nodeIds` jetzt E6-konform `[{part, code}]`; die
gekappte erste Baumebene wird offengelegt (`subcollectionsTruncated` war toter
Code, `browse_collection_tree` schwieg); ein Kommentar wiederholte die widerlegte
„Server-Frist“. **R-D Querschnitt**: kein Befund (paralleles Laden der Themenseite
fällt sauber ab, wenn der Katalog fehlt).

Jeder Befund mit rotem Test vorher, jeder Wächter per Mutation geprüft (einer —
der Manifest-Test — war zu schwach und wurde geschärft). Doku + HTML
`1793998533-7e47`. **Nächstes Paket:** P6 (12b, 10; 9 jetzt entwerfbar).

## 2026-11-06 — BOERDi-Wunschliste P6 (12b, 10 gebaut; 9 blockiert)

**12b** `excludeNodeIds` an `search_wlo_within_collection`. **10** `get_skill_registry`
+ `task` (E2) mit Anleitung — aber nur bei eindeutiger Wahl: live an der Optik-Registry
wählte die reine Rangfolge 2 von 4 Mal falsch; mit der Regel (unterscheidendes Wort,
1,5 × Abstand) wird „Wie vollständig …“ zu `ambiguous` statt zu einer falschen
Anleitung. Ein Rest bleibt („Material aufnehmen“ → Sprachliche Qualität), benannt.
Beim Testen gefunden und behoben: ein nicht lesbarer freigegebener Skill (in
`unresolved`) war gar kein Kandidat — die Antwort sagte „keiner passt“ über einen,
der dem Namen nach passt. **9 blockiert, gemessen:** eine private Datei ist mit
Basic nicht lesbar (download 403, /content 405, /textContent leer) — Optionen A/B/C
im Plan, Entscheidung beim Nutzer/BOERDi-Team.

Tests 2473 grün, 1 Skip; jede Regel per Mutation geprüft. Doku + HTML `1794002511-becf`.
Werkzeugzahl unverändert (48). **Offen:** Entscheidung zu 9; Staging-Regression
(Upload + Aufnahme); 7 live.

### Nachtrag 2026-11-06 — Punkt 9 gebaut (Entscheidung A des Nutzers)

Vor-Messung (Testkonto, eigene Datensätze, alle gelöscht): eine Eigenschaft, die
das Modell nicht kennt, behält das Repository NICHT (`PUT …/metadata` 400,
`POST …/property` **200 und still verworfen**); Modell-Text-Eigenschaften behalten
53 950 Zeichen unverändert. Gewählt `cm:description` (vom Formatter bei
Datensätzen nicht gelesen, anonym 403). `services/write/batch-manifest.ts` hält
Format und Lesen der kompakten Zusammenfassung an EINER Stelle (Schreiber
`batch-filing.ts`, Leser `services/my-batches.ts`); sie wird zurückgelesen,
fehlt sie, heißt das Manifest `unverified`. `wlo_list_my_batches` sucht über die
Knoten-Ablage (flach + eine Ordnerebene, gedeckelt, `scanTruncated`), nie über
den Index; liest `cm:description` nur für die gezeigten; eine fremde id ist
`not_found`. Nebenbei: jede Absage der Kuratier-Schranke trägt jetzt
`error.code = login_required`. **Live:** Manifest-Bytes verworfen (Regression),
Zusammenfassung geschrieben + zurückgelesen, Liste Platz 1 mit richtigen
`counts`, Einzelansicht vollständig; aufgeräumt 1/1. Über das Werkzeug selbst ist
auf Staging derzeit KEIN Manifest ablegbar: MA-4 legt es erst nach einer
`stored`-Datei ab, und Staging verwirft jeden Inhalt.

Tests 2480 grün, 1 Skip; vier Regeln per Mutation geprüft (neueste zuerst, nur
eigene Ablagen, Rücklesen, `limit` liest nur Gezeigtes). Kuratierende Werkzeuge
mit Schalter 20 (vier Stapel-Werkzeuge). Doku + HTML `1794004492-27fa`.
**Offen:** Staging-Regression (Upload + Aufnahme) — danach 7 und die Dateiarten
live.

### Nachtrag 2026-11-07 — Review P6 + Punkt 9 (4 Befunde, alle behoben)

**MAJOR:** mit `task` und Treffer fehlten die Anweisungen der Redaktion — sie
reisten nur im Katalog mit, der in dieser Antwort entfällt; jetzt über
`contextInstructions` + `instructionBlock` (beschriftet, als ungeprüfter Inhalt
gekennzeichnet, vor dem Skill-Dokument), im JSON `task.instructions`. **MINOR:**
Stapel-Ordner mit einer Seite gelesen (≤ 201 Einträge je Stapel; halbiert den
schlechtesten Fall); fehlender Test für den gekappten Bereich ergänzt. **NIT:** eine
nicht lesbare Ablage im Ordner heißt nach dem Ordner. Jeder Befund mit rotem Test
vorher, jede Korrektur per Mutation geprüft (ein Test war zunächst wirkungslos —
der Mock lieferte keine volle Seite — und wurde geschärft). Tests 2484 grün, 1 Skip.

### Nachtrag 2026-11-07 — alte Testreste entfernt (Freigabe des Nutzers)

Die sechs Wegwerf-Datensätze der Live-Vertragstests vom 17.08.
(`example.org/wlo-mcp-live-contract/<ms>`, im eigenen Bereich des Dienstkontos,
in keiner Sammlung) gelöscht — jeder erst nach Prüfung von Titel UND
Beschreibung, jeder danach mit 404 bestätigt. Die siebte Datei des Bereichs
blieb unberührt.

### Nachtrag 2026-11-07 — Querschnitts-Review des Chatbot-Vertrags (4 Befunde, behoben)

Alle 52 Werkzeuge introspektiert (Stapel-Schalter an): Beschreibungen < 1024
Zeichen, neue Lese-Werkzeuge mit outputSchema, Codes durchgängig englisch
snake_case. **MAJOR 1:** `get_skill_registry` lieferte kein `structuredContent`
— die Nutzlast des JSON-Zweigs (samt `task`) steht jetzt in BEIDEN Formaten
dort. **MAJOR 2:** nur die Anmelde-Schranke trug `error.code`; jede andere
Ablehnung war reiner Text. Jetzt `codedError` (`curation-shared.ts`) mit
`invalid_input` (+ `reasons`), `confirm_*`, `not_found`, `not_a_collection`,
`not_checked`, `timeout` (+ `outcomeOpen`), `not_visible`, `unverified`,
`upstream_error` (auch `toolError` der Lese-Werkzeuge) und `refused` als
Auffangcode in `errorText`. **MINOR 3:** die Stapel-Werkzeuge antworteten mit
`{status, reason}` statt `error.code` — jetzt beides (Code = `reason`, Freigabe-
Absagen `batch_unknown`/`batch_expired`/`batch_mismatch`). Text unverändert.
**MAJOR 4** (gefunden beim Schreiben des Entwicklerberichts): `POST /api/uploads`
zählte Anmeldungen je ADRESSE für jedes Schema — die 11. angemeldete Person hinter
einem Chatbot-Backend bekam 429, derselbe Relay-Fehler, der am 2026-08-12 im
MCP-Pfad behoben wurde. Jetzt `abuseBucketKey` (Block je `jti`, Basic je Adresse);
`proveLogin` nimmt den Bucket nur von diesem Aufrufer an, weil die Ausgabe frisch
geprägte ids sieht und je Adresse bleiben muss.
Jeder Befund mit rotem Test vorher, per Mutation geprüft. Tests 2489 grün, 1 Skip; Lint, Typen, Build sauber.
Codetabelle: `docs/MCP-REFERENZ.md` §2, HTML `1794008502-ca5f`.

### Nachtrag 2026-11-07 — Feedback des Chatbot-Entwicklers (11 Punkte, alle umgesetzt)

Jeder Punkt erst am Code bestätigt, dann mit rotem Test vorher umgesetzt und per
Mutation gegengeprüft. **Hoch:** (1) eine nicht auflösbare Lizenz liefert 0 statt
des ungefilterten Bestands (`licenseUnresolvable` — Suche, lokaler Durchgang und
Facetten; der alte Test, der „ändert nichts“ festschrieb, ist ersetzt); (2)
`unresolvedFilters`/`facets` in `structuredContent` der vier Suchwerkzeuge; (3)
URL-Dublette schon in der Vorschau, `exists` mit `error.existing`. **Mittel:** (4)
Fehler-Netz in `apps/tool-defaults.ts` (`refused`, `upstream_error` für Würfe,
`login_rejected`); (5) Grabsteine für abgelaufene Bestätigungs- und Plan-Schlüssel
(1 h, nur die Kennung); (6) `isPreviewCall` → `outcomeOpen: false` nur bei einem
Aufruf ganz ohne Schlüssel; (7) unfertige Pläne werden nie verdrängt,
`too_many_plans` vor dem Einlösen; (8) Stapel: Anmelde-Aufforderung an
`personal()`, abgelehnter Schlüssel kostet den Upload-Platz nicht mehr — das kehrt
eine frühere Entscheidung bewusst um (Speicher ist durch die Platz-Deckel ohnehin
gebunden). **Niedrig:** (9) `get_node_details` mit `nodeId`: `missing`,
Anreicherungen in `structuredContent`; (10) `not_found` an den Einzel-
Schreibwerkzeugen, `toolError` über `failureCode`; (11) Zahlen in sieben
Dokumenten, `docs-claims` erfasst die übersehenen Schreibweisen, und die
„zod strips“-Begründung ist widerlegt (SDK 1.32.2 reicht undeklarierte Felder
weiter; die Regel bleibt wegen `additionalProperties: false` im angekündigten
Schema) — korrigiert in Code, Tests, `ARCHITECTURE.md` und `CLAUDE.md`.
Tests 2517 grün, 1 Skip; Lint, Typen, Build sauber. HTML-Referenz `1794012590-b18a`, Entwicklerbericht `1794012624-d7b0`.

### Nachtrag 2026-11-07 — Review der Feedback-Änderungen (5 Befunde, behoben)

**MAJOR:** Fehler, die das SDK selbst baut (falsche Parameter, unbekanntes
Werkzeug, Schema-Verstoß der Antwort), liefen über `McpServer.createToolError`
am Fehler-Netz vorbei — jetzt `invalid_input` / `unknown_tool` /
`upstream_error`; ein Test fällt, wenn ein SDK-Update die interne Methode
verschiebt. **MINOR:** Lizenz-Hinweis „keine Materialien“ statt „keine Treffer“
(neben Sammlungen in `search_wlo_all` war das falsch); sieben Lese-Fehler mit
präzisem Code statt `refused` über `codedErrorResult` (`tools/shared.ts`).
**NIT:** Frist im `too_many_plans`-Text, toter Testcode entfernt. Zwischen
Kapazitätsprüfung und `startPlan` liegt kein `await` — kein Wettlauf, geprüft.
Tests 2525 grün, 1 Skip. HTML-Referenz `1794013120-14f0`.

### Nachtrag 2026-11-07 — GitHub und Doku

Stand nach `janschachtschabel/wlo-mcp-sc` `main` übertragen (`b9778d4`, 65 neu,
102 geändert, nichts gelöscht; `.gitlab-ci.yml` erhalten und auf Node 22
korrigiert, `38ec600`); GitHub-CI für beide grün. Achtung: der lokale `origin`
zeigt auf `wlo-mcp-server` (das Original), nicht auf `wlo-mcp-sc`.
Doku-Durchgang: `INTEGRATION.md` (zehn fehlende Werkzeuge, Zahlen, Upload-Route,
Fehlercodes, OER = vier Suchen), `ARCHITECTURE.md`, `DEPLOYMENT.md` (Schalter,
nginx-Rumpfgrenze), `PRIVACY.md` (Uploads, Pläne, Stapel), `AUTH.md`,
Submission-Checkliste, beide READMEs, `TOOLS.md`. `docs-claims` erfasst die
Zahlen-Schreibweisen von `INTEGRATION.md`. Tests 2525 grün, 1 Skip.

### 2026-11-07 — Chatbot-Anbindung: Plan erstellt, wartet auf Freigabe

`docs/plans/2026-11-07-chatbot-anbindung-stabilitaet.md` (Auftrag des
Chatbot-Teams S1–S7). Gemessen: ein `tools/call` ohne `initialize` → 200
(F2: ein POST je Aufruf reicht); Verbindungsaufbau zu edu-sharing 0,1–0,3 s
(B7s 22 s kommen nicht vom Transport). Vier Phasen (Budget/429, upstream_busy,
sichere Wiederholung, /auth/status + /ready). S7 ist eine Entscheidungsvorlage
für den Nutzer, kein Code. Offen beim Nutzer: Freigabe, F1 (Live-Werte),
S7-Wahl.

### 2026-11-07 — Chatbot-Anbindung Phase 1 (S1/S2a) erledigt

Freigegeben vom Nutzer; F1: live 300 Anfragen/min; S7 entschieden (Empfehlung des
Chatbot-Teams: R1 Frist in der Allow-Liste, 12 h für Ticket-/Widget-Blöcke; R2
Selbst-Widerruf per Bearer; R4 `TICKET_ALLOWED_ORIGINS`) → Phasen 5–7 im Plan.
Gebaut: `src/client-budget.ts` (Schlüssel, Bucket, `countToolCalls`, JSON-RPC-429,
`createClientBudgets`), `RateLimiter.retryAfterSeconds`, Verdrahtung in
`http-app.ts`/`http.ts`. Werkzeug-Budget nur `tools/call`, Protokoll-Budget 3× vor
dem Rumpf, vertraute Clients je Schlüssel, 429 mit Restzeit. Vier alte Tests, die
„jeder POST zählt“ festschrieben, bewusst auf die neue Regel umgestellt; F2-Test
(`tools/call` ohne `initialize` → 200) neu. Gegenprobe: zählt das Budget jede
Nachricht, wird der Test rot. Doku: `.env.example`, `docker-compose.yml`,
DEPLOYMENT, MCP-REFERENZ, INTEGRATION, beide READMEs, CHANGELOG.
HTML-Referenz `1794054659-a704`. **Nächster Schritt:** Phase 2 (`upstream_busy`) — nach Kontext-Reset.

### Nachtrag 2026-11-07 — Review Phase 1 (4 Befunde, behoben)

**MAJOR:** der Anmelde-Schutz auf `/mcp` antwortete weiter mit Freitext und
pauschal `Retry-After: 600` — jetzt JSON-RPC mit `data.code: "too_many_logins"`
und der Restzeit seines Fensters (`DistinctValueLimiter.retryAfterSeconds`).
**MINOR:** Tests für das Protokoll-Budget eines vertrauten Clients (3×) und den
REST-429 auf `/api/*`; Doku: `X-WLO-Client-Key` nur von Server zu Server (CORS
lässt den Kopf bewusst nicht zu). **NIT:** `rateLimitedBody` mit Code-Parameter.
Bewusst nicht geändert: die REST-Seiten unter `/auth*` (Passwort, Zustimmung)
behalten ihr `Retry-After: 600` — dort spricht niemand JSON-RPC. Tests 2539 grün, 1 Skip; HTML `1794055312-bd01`.

### 2026-11-07 — Chatbot-Anbindung Phase 2 (S2b `upstream_busy`) erledigt

`src/upstream-error.ts` (Fehlertext mit `retry-after=N` aus dem Kopf von oben,
nur Sekunden-Form), `failureCode` → `upstream_busy` bei 429/503,
`retryAfterOf` (sonst 10 s), `codeOfStatus` ebenso, `toolError` trägt
`retryAfter`, drei `missing`-Schemata erweitert. Test zuerst rot, Gegenprobe
(Zeile entfernt → 2 rot). Doku: MCP-REFERENZ, INTEGRATION, CHANGELOG.
Review Phase 2 (2 MINOR, behoben): `upstream_busy` ohne `retryAfter` in
`wlo_health_check` und `wlo_list_my_batches` — jetzt `failureFields(err)`
(`failure-code.ts`), die EINE Stelle, die Code und Wartezeit paart; HTML-Referenz
`1794055841-5120` ergänzt. Tests 2546 grün, 1 Skip. Bewusst außerhalb: ein 503 beim SCHREIBEN bleibt
`upstream_error`/`failed` — dort sagt er nicht „gefahrlos wiederholen“.

### 2026-11-07 — Chatbot-Anbindung Phase 3 (S3 sichere Wiederholung) erledigt

`services/write/confirm-replay.ts` (Speicher je Schlüssel-Hash, gebunden an
Identität + Argument-Hash, 30 min, ≤ 500; aufgezeichnet NUR wenn der Schlüssel im
Aufruf eingelöst wurde — `markRedeemed` aus `consumeToken`), `tools/curation-replay.ts`
(Naht in `registerCurationTool`: done → `replayed: true`, running → `inProgress`,
andere Argumente → `confirm_mismatch`), `replay: false` für die zwei Plan-Werkzeuge.
Tests: verlorene Antwort → ein Datensatz; parallel → einmal geschrieben; fremde
Identität → kein Replay; nie eingelöst → nichts gespeichert; Wettlauf im
Bestätigungspfad direkt nachgestellt. Zwei Gegenproben: ohne `markRedeemed` 3 rot;
ohne die `replay`-Prüfung zunächst GRÜN — der Werkzeug-Test erreichte den Wettlauf
nie; ein gezielter Test schließt die Lücke (dann 1 rot).
Review Phase 3 (2 MINOR, Doku, behoben): Codetabelle `confirm_unknown`
präzisiert (gleiche Anmeldung + Argumente = erste Antwort); benannt, dass ein
offener `timeout` auch in der Wiederholung offen bleibt; HTML `1794056328-8eee`.
Geprüft ohne Befund: je Aufruf höchstens eine Einlösung, Plan-Werkzeuge
ausgenommen (ihr Fortsetzungstest grün), nie fremde Identität, Speicher begrenzt.
Tests 2556 grün, 1 Skip.

### 2026-11-07 — Chatbot-Anbindung Phase 4 (S4 `/auth/status`, S5 `/ready`, S6) erledigt

`auth/auth-status.ts` (`authStatusPayload`, `readAuthStatus` — die EINE Stelle
für Werkzeug und Endpunkt; der Autoritäts-Wächter nennt jetzt dieses Modul statt
`tools/auth.ts`), `rest/auth-status.ts` (Kopf-Regeln wie `/mcp`, Protokoll-Budget,
Anmelde-Schutz, 60-s-Cache), `services/upstream-readiness.ts` (Probe = 1-Treffer-
Suche, 30-s-Cache, single-flight, höchstens 5 s Warten), `rest/ready.ts`,
`rest/rate-limited.ts` (gemeinsamer JSON-RPC-429), `slow upstream`-Log in
`wloFetch` ab 5 s (nur Pfad), Probe-Start nur aus `http.ts` (Test),
`WLO_READY_PROBE_MS`. Gegenproben: ohne single-flight 1 rot, ohne Status-Cache 1
rot. Bewusst weggelassen (Plan T4.5): ein Verweis auf `/auth/status` in der
Beschreibung von `wlo_auth_status` — die liest ein Modell, und ein Modell ruft
keinen HTTP-Endpunkt. Tests 2574 grün, 1 Skip; HTML `1794056818-4fc4`.

**Review Phase 4 (2026-11-07), 7 Befunde, alle behoben.** (1, MAJOR) Der
Slow-Log fehlte für einen Aufruf, der WIRFT — und der 22-s-Fall liegt über dem
20-s-Budget, war also genau der, den S6 sehen sollte; jetzt als Status 0.
(2, MAJOR) `/auth/status` hielt eine Antwort ohne `authority` 60 s — ein kurzer
Ausfall zeigte eine gültige Anmeldung eine Minute als abgelehnt; jetzt 10 s
(`AUTH_STATUS_UNKNOWN_CACHE_MS`), weil „abgelehnt" und „nicht erreicht" dort
nicht unterscheidbar sind. (3) 429 auf `/auth/status` ist REST
(`restRateLimitedBody`, wie `/api`), nicht JSON-RPC. (4) Der Anmelde-Schutz-429
ist EINE Funktion (`refuseTooManyLogins`) für `/mcp` und `/auth/status`; die
Kopie loggte nicht. (5) Der Probe-Takt fragt frisch statt über den 30-s-Cache
(sonst wirkte ein Intervall unter 30 s nicht, und ein früher Takt fiel aus).
(6) Tests für Anmelde-Schutz und kaputten Basic-Kopf mit Dienstkonto. (7)
Kommentar: gemessen bis zu den Kopfzeilen. Gegenproben: (1), (2), (4)-Log und
(5) je rot. Tests 2579 grün, 1 Skip; Lint/Typen/Build sauber; HTML `1794057236-4f55`.

### 2026-11-07 — Chatbot-Anbindung Phase 5 (R4 `TICKET_ALLOWED_ORIGINS`) erledigt

`auth/ticket-origins.ts` (rein: Liste normalisieren über `new URL().origin`,
`*`/Unlesbares/Nicht-Web abgelehnt und gewarnt; leere Liste und fehlende
`Origin` erlaubt). `/auth/ticket` antwortet einer fremden Browser-Herkunft 403
`origin_not_allowed` — nach dem Adress-Budget, vor dem Rumpf —, und die
CORS-Antwort spiegelt mit Liste nur eine eingetragene Herkunft (`Vary: Origin`)
statt `*`, damit schon die Vorabfrage scheitert. Gegenproben: ohne 403, mit `*`
statt Spiegel, ohne die Ausnahme für fehlende `Origin` je rot. Review (inline):
1 MINOR — die Abweisung lag vor dem Budget und war mit gefälschtem `Origin` eine
unbegrenzte Quelle von Logzeilen; verschoben, Test zählt den 429 —, 1 NIT
(Kommentar `isCredentialSurface`). HTML `1794057686-3c79`.

### 2026-11-07 — Chatbot-Anbindung Phase 6 (R2 Selbst-Widerruf) erledigt

`POST /auth/revoke` nimmt den Block auch als `Authorization: Bearer` — ohne
Rumpf und ohne JSON (der Kopf macht die Anfrage vorabfragepflichtig, `/auth*`
bleibt ohne CORS) — und widerruft genau ihn; `credentialFromHeader` liefert
danach `null`, `/mcp` also 401. Antwort immer 200 `{revoked}`: unlesbar, fremd,
ungelistet und schon widerrufen sehen gleich aus. Kopf schlägt Rumpf; ein
`Basic`-Kopf ist kein Bearer-Widerruf (weiter 415). Kein neues Recht: der
Rumpf-Weg nahm schon jeden Block mit gelisteter id (`AUTH.md` §4). Gegenprobe
(400 für Unlesbares) rot. Review inline ohne Befund. HTML `1794057914-a86d`.

### 2026-11-07 — Chatbot-Anbindung Phase 7 (R1 Frist in der Allow-Liste) erledigt — Plan vollständig

`RegistryEntry.exp` (Sekunden, optional, kein Formatwechsel; ein `exp`, das
keine Zahl ist, schließt zu), geprüft in `registry.has(jti, nowMs)` — der einen
Stelle, die `credentialFromHeader` fragt; ein abgelaufener Block ist wie ein
widerrufener (401). `SESSION_BLOCK_TTL_S` = 12 h für Ticket-Blöcke (ein neuer
Tausch desselben Tickets erneuert) und für OAuth-Anmeldungen, deren GEPRÜFTES
`redirect_uri` in `WIDGET_OAUTH_ORIGINS` liegt — beim Bauen entschieden und im
Plan begründet: Widget und KI-Host kommen beide über OAuth, und nur das
Weiterleitungsziel unterscheidet sie verlässlich. Leer = kein OAuth-Block läuft
ab. `/auth/status` und `wlo_auth_status` nennen `expiresAt`. Ein echter Server
zeigt den Ablauf bis `/auth/status` (`oauth-flow.test.ts`). Gegenproben: `has`
ohne Frist, Consent ohne TTL, Ticket-`has` ohne `now`, http-app ohne
Durchreichen, Ablauf-Bereinigung aus — je rot. Review (inline): 1 MAJOR —
Widget-Einträge haben kein `k` und zählen mit den eingefügten Blöcken, tägliche
Anmeldungen hätten den in ChatGPT eingefügten Block nach ~5 Tagen verdrängt;
jetzt fallen abgelaufene Einträge vor dem Deckel heraus. HTML `1794058342-5a6a`.

**Damit ist `2026-11-07-chatbot-anbindung-stabilitaet.md` vollständig (Phasen
1–7).** Nicht hier messbar und offen beim Chatbot-Team: der Lasttest mit 30
Personen (S1) und die echte Ursache des kalten Pfads (S6 — das Log zeigt sie
erst im Betrieb). Betrieb: `TICKET_ALLOWED_ORIGINS` und `WIDGET_OAUTH_ORIGINS`
setzen, sonst bleibt beides wirkungslos.

### 2026-11-07 — Vollständiger Review S1–S7 (zwei unabhängige Prüfer), 18 Befunde, alle behoben

Zwei Prüfer mit frischem Kontext (S1–S3 und S4–S7), jeder Befund am Quelltext
nachgeprüft. Drei waren MAJOR: (1) die 12-h-Frist ließ sich über `/auth/issue`
oder eine Zustimmung mit beliebigem `redirect_uri` abstreifen — `add` ersetzt den
ganzen Eintrag; jetzt bestätigt die Ausstellung eine gelistete id ohne
Neuschreiben, verweigert eine abgelaufene (Vermerk 48 h, `EXPIRED_KEPT_S`, zählt
nicht gegen den Deckel) und einen Block mit `iat` > 24 h neben unserer Uhr
(`ISSUE_MAX_SKEW_S`); (2) ein Fehler NACH der Einlösung (etwa die Dubletten-
prüfung mit 503) lud mit `retryAfter` zu einem Aufruf ein, der nur wiederholen
konnte — jetzt `requiresNewPreview: true` ohne `retryAfter`, und ein Wurf nach
der Einlösung antwortet `outcomeOpen: true` statt den Schlüssel zu vergessen;
(3) `wlo_health_check` meldete einen echten 503 als „erreichbar“, weil nur ein
WURF abgebildet war und der Test warf — dieselbe Form wie 2026-08 („ein Test
gegen fetchMock beweist nur, was wir senden wollten“). Dazu 11 MINOR/NIT:
Statuserkennung an der Position statt jeder dreistelligen Zahl, `upstream_busy`
auch in Übersicht/URL-Suche, Replay-Deckel je Identität, Hinweis bei
vorbereiteten Anfragen, `/auth/status`-Cache je VORGELEGTEM Kopf (HMAC),
Herkunftsliste ohne brauchbaren Eintrag schließt, Probe anonym und Zeitstempel
bei Ankunft, `TRUSTED_CLIENT_KEYS` ohne Klartext im Log und ohne Doppelnamen,
Reihenfolge der Allow-Liste bei Rückgängig/Erneuern, Doku (Erneuerung nur nach
Ablauf, „no expiry“-Sätze in AUTH.md/CLAUDE.md, `/auth/revoke`-Antworten,
`/auth/ticket` in INTEGRATION.md, Logzeilen-Name). Korrektur zur Phase-2-Notiz
„ein 503 beim Schreiben bleibt upstream_error“: nach der Einlösung heißt er jetzt
`upstream_busy` mit `requiresNewPreview` und ohne `retryAfter`; ein Planschritt
heißt `upstream_busy`, weil ein gescheitertes Anlegen dort nachgeprüft ist.
Bewusst NICHT umgesetzt (begründet in Phase 4): der Verweis auf `/auth/status`
in der Beschreibung von `wlo_auth_status`. Fünf Test-Blöcke trugen ein festes
`iat` von 2025 und laufen jetzt mit der aktuellen Zeit, wie die Seiten sie
erzeugen (`public/access-block.js`); ein Fixture `'upstream 403'` entsprach
keiner echten Nachricht und trägt jetzt die echte Form. Gegenproben der neuen
Ausstellungsregeln je rot. Tests 2622 grün, 1 Skip; Lint/Typen/Build sauber.

### 2026-11-07 — Rückmeldung des Chatbot-Teams zu S1–S7: drei Befunde, alle behoben

Das Team hat den Bericht am Quelltext und live (nur anonyme GETs, ein Widerruf
mit einem erfundenen Block) geprüft; keine Befunde, die den Betrieb stören.
(B1) Das Adress-Budget vor `/auth/issue`, `/auth/revoke`, `/auth/revoke-all` und
`/auth/ticket` antwortete fest `Retry-After: 60` mit `{error}` ohne `code`, der
Anmelde-Schutz dort fest `600` — jetzt dieselbe REST-Form wie `/api` und
`/auth/status` (`{error, code, retryAfter}`, Restzeit des jeweiligen Fensters),
mit deutschem `error`, weil die Seiten ihn Menschen zeigen
(`refuseRateLimited(…, 'rest', message)` / `sendRateLimited`). (B2)
`/auth/status` konnte „abgelehnt“ und „nicht erreicht“ nicht trennen
(`authority: null` für beides) — jetzt `upstream: 'ok' | 'unreachable'`, aus
`checkIdentity` (`unreachable` bei Netzfehler, Zeitüberschreitung, 429/5xx und
einem 200, das nicht das Identitätsdokument ist; 401/403/404 sind eine Antwort).
Folge für den Zwischenspeicher: eine Ablehnung gilt 60 s wie eine Anmeldung, nur
„nicht erreicht“ 10 s. `wlo_auth_status` sagt bei einem Ausfall nicht mehr, die
Zugangsdaten würden nicht akzeptiert. (B3) In `AUTH.md` festgehalten: ein
Abmelden nach Ticket-Tausch hält bis zum nächsten Tausch desselben Tickets — so
gewollt, die edu-sharing-Sitzung ist die Instanz. Gegenproben je rot (feste
Wartezeit, Statusregel, alte Cache-Regel). Offen als Anregung des Teams, nicht
umgesetzt: Widerruf über den Client-Schlüssel zählen statt über das
Adress-Budget.

**Review dieser Änderungen (10 Befunde: 5 MINOR, 5 NIT, alle behoben).** Der
gewichtigste: `proveLogin` warf das neue `unreachable`-Signal weg, also
antworteten `/auth/issue`, `/auth/revoke-all`, `/auth/ticket` und die
OAuth-Zustimmung bei einem Ausfall weiter „Zugangsdaten nicht akzeptiert“ (400),
`/api/uploads` 403 `login_required` — ein Widget verwarf über einen kurzen
Ausfall ein gültiges Ticket. Jetzt `LoginProof.reason: 'unreachable'` → 503
`upstream_unreachable` (`retryAfter` 10), EINE Antwortstelle
(`rest/login-failure.ts`) für alle vier REST-Pfade. Die alte Begründung („nicht
unterscheidbar, damit niemand Tickets abtastet“) trug nicht: ob das Repository
antwortet, hängt nicht vom Ticket ab, ein totes Ticket antwortet 404 (gemessen
2026-08-13). Dazu: die `/oauth/*`-429 in derselben REST-Form; 429 auf
`/api/uploads` mit `Retry-After`/`code`/`retryAfter` (`error` bleibt der
Code-String); Werkzeugbeschreibung und Startlog nennen einen Ausfall nicht mehr
„abgelehnt“; `notReached()` liefert ein frisches Objekt; `refuseRateLimited`
nimmt `{shape, message}` statt sechs Positionsparametern; „in einer Sekunde“;
README-Sätze zu `authenticated: false`. Gegenproben aller sieben neuen
Wächter je rot.

**Zweite Rückmeldung, Befund 4 (Fehler nach der Einlösung) — behoben.**
`keySpent` setzte `requiresNewPreview` an jeden Fehler nach der Einlösung, und
die Referenz empfahl danach eine neue Vorschau — über `not_visible`,
`unverified` oder einen halb ausgeführten Vorgang legt das eine Dublette an (der
erste Stand des Chatbots hat genau das getan). Jetzt trägt JEDER Fehler nach der
Einlösung `outcomeOpen`: `false` nur, wo der Aufruf beweisbar nichts schrieb
(`exists`; `not_stored`, wenn kein Feld ankam und nichts anders gespeichert
wurde), sonst `true`; der Text sagt entsprechend „erst nachsehen“ oder „nichts
geschrieben“. `reportOutcome` antwortet `not_stored`, `unverifiedReply`
`unverified` (vorher `isError` ohne Code), `withFiling` behält den Fehlerteil
neben `nodeId`, und ein ANGELEGTER Datensatz ist immer `outcomeOpen: true`
(`markWritten`), auch wenn kein Feld ankam — sonst legte ein Neustart einen
zweiten an. Ein bestehender Test hielt die richtige Gegenregel fest („eine
Ablehnung ist kein offenes Ergebnis“) und hat den ersten, gröberen Entwurf
(Standard immer `true`) zu Fall gebracht. Gegenproben aller sieben Wächter je rot.

**Review aller Änderungen seit dem Push `09fcb18` (2026-11-07): 1 MINOR, 1 NIT,
beide behoben.** Der Satz nach einer Einlösung mit `outcomeOpen: true` sagte
„… ist offen“ — auch unter einem Bericht, der den Ausgang genau nennt
(`not_stored` mit „Gespeichert: … / NICHT gespeichert: …“); er sagt jetzt „es
kann bereits etwas geschrieben sein — erst nachsehen“. Die Referenzzeile zu
`not_stored` nennt die Ausnahme `wlo_create_content` (immer `true`). Bewusst
kein Befund: `reportMutation`/`failed` bleibt `true`, weil derselbe Bericht auch
NACH einem Anlegen prüft und `createContentNode` „2xx ohne id“ als `failed`
meldet — `false` steht nur, wo es beweisbar ist.

### 2026-11-08 — Volltext & Sammelmetadaten, Phase 1 (W4 Rolle im Stapel) erledigt

Plan: `docs/plans/2026-11-08-volltext-und-sammelmetadaten.md`. Messungen vorab
(Staging, Testkonto, eigene Wegwerf-Knoten): jeder Schreibweg für Inhalt —
`POST …/textContent`, `POST …/content`, `ccm:fulltext_content` — antwortet 500
mit derselben `InvalidTypeException` wie die Uploads seit dem 06.11.; F1 ist
deshalb nach Nutzerentscheidung `textContent` am Knoten selbst, mit Sicherung für
Knoten mit Datei (Plan 4.4). W4: `entries[].role` (`structure`|`content`) an
`wlo_prepare_file_batch`, Teil des Fingerabdrucks; `vorgang.json` und
Zusammenfassung `wlo.ablage-vorgang@2` (`@1` weiter gelesen); `role` je Eintrag
in `wlo_list_my_batches`; keine Eigenschaft am Datensatz (F4). Review (unabhängiger
Prüfer): 3 MINOR, 3 NIT, alle behoben — u. a. fehlte ein Test, der `structure`
bis ins Manifest verfolgt (eine gelöschte Zeile wäre grün geblieben), ein
Strukturdokument jenseits der 20 Vorschauzeilen wurde nicht genannt, und die
Größenangabe der Zusammenfassung stimmte nicht (jetzt 30–47 k Zeichen bei 200
Einträgen; `rolle` steht dort nur für `structure`). Mehrere Strukturdokumente je
Stapel sind erlaubt. Gegenproben je rot.

### 2026-11-08 — Volltext & Sammelmetadaten, Phase 2 (Lesen des Volltexts) erledigt

`get_wlo_content_text`: ein kurzer Text an einem Datensatz ohne Link zählt (die
200-Zeichen-Schwelle galt dem Crawler-Text einer verlinkten Seite und hätte einen
kurzen W1-Volltext verschluckt), außer er trägt Ersatz- oder Steuerzeichen
(Binärreste). Neue Gründe: `not_extracted` (Datei da, kein Text daraus — Markdown,
JSON, Bilder) und `text_unreadable` (Abruf gescheitert, keine Aussage über das
Material). `get_node_details`/`get_nodes_details` mit `includeTextContent` sagen
dasselbe (`textContentNote`, `textContentError`; der Mehrfach-Pfad antwortete
bisher für beides mit einem leeren Text). Review (unabhängiger Prüfer): 2 MAJOR,
3 MINOR, 1 NIT, alle behoben — die beiden schweren: `not_extracted` hing nur an
der Dateigröße, also hätte eine Zeitüberschreitung an einem großen PDF als „kein
Text in der Datei“ gegolten; und der zweite Lesepfad war nicht angefasst. Bewusst
nicht: der Ausschnitt `textContent` der Suchtreffer. Gegenproben je rot.

### 2026-11-08 — Volltext & Sammelmetadaten, Phase 3 (W3 `wlo_update_contents`) umgesetzt

Metadaten für bis zu 200 Datensätze unter einer Bestätigung, auf dem Plan-Läufer
von `wlo_add_to_collections`. Der Server entscheidet je Feld
(`services/write/field-routing.ts`, Nutzerentscheidung F5): Titel, Beschreibung,
Schlagworte, Fach, Bildungsstufe, Inhaltstyp werden geschrieben und
zurückgelesen, alles Redaktionelle wird Vorschlag (Typ `AI`). Verknüpfung →
Original (F6), zwei Namen für einen Datensatz → `duplicate`. Zwei Funde beim
Bauen: der Schritt schrieb die Original-id als `nodeId` in den Zustand und
überschrieb damit in der Antwort die angefragte id (gefunden vom Test über eine
Verknüpfung); und eine CC-Lizenz bringt ihre Version als zweiten Vorschlag mit
(`applyLicenceDefaults`) — die Testerwartung war falsch, nicht der Code. Die
Werkzeugzahlen der Doku sind nachgezogen (49 gesamt, 17 immer gelistete
Kuratier-Werkzeuge). Gegenproben je rot. Review folgt.

**Review Phase 3 (unabhängiger Prüfer): 5 MAJOR, 5 MINOR, 1 NIT — alle behoben.**
Die schweren: ein Vorschlag, dessen POST mit 5xx oder einem leeren 200
beantwortet wurde, galt als „nichts geschrieben“ (`outcomeOpen: false`) — jetzt
`open`; die Vorschau zeigte nur den neuen Wert, also sah niemand, dass ein
ersetztes Fach verloren geht, und der alte Wert war nicht im Fingerabdruck —
jetzt vorher → nachher; „nichts zu bestätigen“ sprach über Ablehnungen von „steht
schon so da“; und der Bestätigungsaufruf las zuerst alle Datensätze und bekam
dann noch einmal volle 40 s. Dabei aufgefallen und behoben, und es betrifft auch
`wlo_add_to_collections`: unabhängige Schritte bildeten EINE Welle, und das
Budget wurde nur zwischen Wellen geprüft — 200 Einträge liefen in einem Aufruf
ohne Zeitgrenze. Jetzt höchstens vier je Welle; der Test des Prüfers hatte zu
Recht bemängelt, dass die Fortsetzung nie geprüft wurde (3 Einträge, Pool 4).
Bewusste Abweichung vom Plantext: die Vorschau trägt jede Zeile vollständig
(Projektregel „alles Gesendete steht in der Vorschau“). Gegenproben je rot.

### 2026-11-08 — Volltext & Sammelmetadaten, Phase 4 (W1 `wlo_attach_fulltext`) umgesetzt

Volltext in den `textContent` des Datensatzes selbst (Nutzerentscheidung F1).
Gesendet als Rohtext unter `application/json` mit `mimetype=text/plain`, danach
zurückgelesen. In der Vorschau abgewiesen: `would_replace_file` (Sicherung
`FULLTEXT_KEEPS_BINARY = false`, bis ein Live-Lauf zeigt, dass die Datei
erhalten bleibt), `link_record` (Messung 2026-07-31: ein verlinkter Datensatz
liefert den Seitentext, nicht den geschriebenen), `exists`, `nothing_to_change`,
`too_large`, `not_found`, `text_unreadable`. Folge, ehrlich gesagt: bis die
Sicherung gelöst ist, schreibt W1 nur an Datensätzen ohne Datei und ohne Link.
`tests/live/fulltext.test.ts` misst beides (Rücklesen + F3 Suche; Datei bleibt?)
und überspringt sich mit Begründung, solange Staging Inhalte mit 500 ablehnt.
Alle 10 Tests liefen gleich grün — deshalb 8 Gegenproben, je rot. Review folgt.

### 2026-11-08 — Volltext & Sammelmetadaten, Phase 5 (W2 `wlo_attach_fulltexts`) umgesetzt

Bis zu 200 Volltexte unter einer Bestätigung, ≤ 3 MB je Aufruf (vor jedem Abruf
geprüft), je Datensatz die Regeln von W1 (`fulltext-plan.ts` plant nur viele und
begrenzt den Speicher: 64 MB über alle Pläne, ein erledigter Text wird sofort
verworfen, darüber `upstream_busy` VOR der Einlösung). Die Eingabeprüfung (URL,
Sprache) teilen W1 und W2 (`curation-fulltext-input.ts`). Fünf Gegenproben je rot;
ein Test für die Doppelnennung fehlte und ist ergänzt. Werkzeugzahlen nachgezogen
(51 gesamt, 19 immer gelistete Kuratier-Werkzeuge). Review folgt.

**Review Phase 4 (unabhängiger Prüfer): 5 MAJOR, 5 MINOR, 2 NIT — alle behoben.**
Zwei trafen genau die Sicherung: ein zweiter Abruf des Originals, der kurz
scheitert, machte die Dateigröße zu 0 — die Sperre griff nicht (jetzt ein Abruf,
und ein nicht lesbares Original weist ab); und der Live-Test, der die Sicherung
begründen soll, prüfte nicht, ob überhaupt geschrieben wurde — ein anders
gescheiterter Schreibvorgang hätte sie fälschlich freigegeben (jetzt `stored`
Pflicht, dazu Typ UND Inhalts-Hash). Ferner: ein 5xx galt als „nichts
geschrieben“ (jetzt nur 4xx); nach dem ersten Ablegen hat ein Datensatz Inhalt,
also lief jeder weitere Aufruf in `would_replace_file` — `exists` und
`nothing_to_change` werden jetzt vorher geprüft, die Meldung sagt „Inhalt“;
`forbidden`/`unreadable` statt `not_found`; leerer Text abgewiesen; Zeitbudgets
(60 s für das Schreiben, Lesen mit `WLO_TEXT_TIMEOUT_MS`); Vergleich beidseitig
getrimmt samt BOM. Die Gegenprobe zum Hash blieb zuerst grün (der Test änderte
mit der Datei auch den Typ) — ein Fall „gleicher Typ, andere Bytes“ ist ergänzt.

**Review Phase 5 (unabhängiger Prüfer): 4 MINOR, 4 NIT — alle behoben.**
Der schwerste: zwei gleichzeitige Bestätigungen mit demselben Schlüssel — die
zweite fand den eben gestarteten Plan nicht, lief in den verbrauchten Schlüssel
und antwortete `confirm_unknown` („bitte neue Vorschau“), deren Bestätigung
jeden Datensatz ein zweites Mal geschrieben hätte. Derselbe Fehler stand in W3
(`wlo_update_contents`) und ist dort mit behoben; beide schauen jetzt VOR der
Einlösung nach dem laufenden Plan. Ferner: ein werfender Schritt blieb
`pending` und hielt seinen Text (jetzt offenes Ergebnis, Text verworfen); der
Plan-Lauf startet keine Welle mehr, die nach der vorigen zu urteilen über das
Budget liefe; der Speicher wird VOR dem Lesen der 200 Datensätze geprüft und
danach noch einmal; ein nicht prüfbarer Datensatz heißt `unreadable`; eine
zweite Nennung desselben Datensatzes ist `duplicate`, auch wenn die erste
nichts ändert; `retryAfter` als benannte Konstante (60 s); 64 MiB statt „64 MB“.
Jede neue Prüfung ist per Mutation rot geprüft — die späte Speicherprüfung erst,
nachdem ein Test zwei gleichzeitige Pläne laufen ließ (sequentiell deckt die
frühe sie zu; fünf Läufe stabil).

**Phase 6 — Gesamt-Review über alle Pakete (unabhängiger Prüfer): 3 MAJOR, 10
MINOR, 8 NIT — alle behoben.** Die drei MAJOR: (1) die Sicherung galt nur bei
der Bestätigung, ein W2-Plan schreibt aber bis zu 30 min danach — jetzt prüft
`writeFulltext` unmittelbar vor jedem POST (Inhalt hinzugekommen →
`would_replace_file`, sonst geändert → `changed_since_preview`, beides ohne
Senden); dieselbe Lücke in W3 (Titel/Beschreibung still überschrieben,
entfernte Schlagworte wieder da) ist mit derselben Prüfung geschlossen. (2) Der
Wächter für Werkzeugzahlen war seit seiner Einführung blind für „alle 48
Werkzeuge“ (kein Leerzeichen im Muster) und für jede Zahl mit Stapel-Schalter —
zehn falsche Zahlen in vier Dokumenten, jetzt rot geprüft und korrigiert. (3)
`includeTextContent` verlor bei einer Zeitüberschreitung des Textabrufs den
ganzen Datensatz (im Mehrfachpfad auch die Eltern). Ferner: W1 und W2 melden
dieselbe Ursache gleich (`failed`/`file_replaced`, Netzfehler als
`unreadable`/`text_unreadable`), `nothing_to_change` ist bei W1 kein Fehler
mehr, ein PDF wird ohne Textextraktion abgelehnt (Kosten der Vorschau), nach
einem 5xx entscheidet das Zurücklesen; W3: `forbidden`, ganze Schlagwortliste in
der Vorschau, leere Vorschlagsliste = `unverified`, Titel des Originals;
Beschreibungen (`text_unreadable`, „~40 s“), Codetabelle in MCP-REFERENZ,
`isStoredText` als eine Regel für beide Lesepfade, Status-Texte, Plan-Doku.

Beim Abgleich des Berichts gefunden und mit behoben: derselbe Wettlauf zweier
gleichzeitiger Bestätigungen bestand auch in `wlo_add_to_collections` und
`wlo_create_collection_tree` (beide lesen zwischen Plan-Suche und Einlösung) —
reproduziert mit `confirm_unknown`, jetzt dieselbe Prüfung, beide per Mutation
rot geprüft. Damit schauen alle vier Plan-Werkzeuge vor der Einlösung nach dem
laufenden Plan.

Beim Spiegeln der Referenz gefunden: `docs/MCP-REFERENZ.md` stand nicht in der
Liste des Zahlen-Wächters und nannte an fünf Stellen noch 48 bzw. 16 Werkzeuge.
Jetzt geprüft (mit Mustern für ihre eigenen Formulierungen, erst rot gesehen)
und korrigiert; `get_nodes_details` nennt dort `textContentNote`/`textContentError`.

**Abschluss Plan 2026-11-08 (T6.1, T6.2 erledigt).** Tests 2743 (2742 grün, 1
Plattform-Skip), tsc, ESLint, Build sauber. Entwicklerbericht veröffentlicht:
https://claude.ai/artifact/AJz45mccHLKqfRceY8NA2i; Nachtrag im Bericht S1–S7;
HTML-Referenz (670d9a7a…) auf dem Stand von `MCP-REFERENZ.md`. Offen bleibt nur,
was am Repository hängt: W1/W2 live schreiben, sobald Staging wieder Inhalte
annimmt — dann `npm run test:live` (`tests/live/fulltext.test.ts`) und erst
danach die Sicherung `FULLTEXT_KEEPS_BINARY` entscheiden; F3 (Suche im
Volltext) misst derselbe Lauf. Kein Commit, kein Push (nur auf Zuruf).

**Review 3 (nach dem Gesamt-Review, unabhängiger Prüfer): 5 MINOR, 5 NIT —
alle behoben, dazu ein Hinweis auf vorher vorhandenen Code.** Der wichtigste:
nach einem 5xx galt ein leeres Zurücklesen als Beweis, dass nichts ankam — bei
einem 502/504 eines Proxys, während das Repository noch schreibt, und bei einem
Körper ohne Textangabe (den `readNodeTextContent` als 200 mit `null` meldet)
war das falsch. Jetzt entscheidet das Zurücklesen nur nach der eigenen 500 des
Repositorys, und `null` ist keine Antwort. Ferner: die Prüfung vor dem
Schreiben vergleicht Typ und Prüfsumme nur, wo es Inhalt gibt; der Zweig
`changed_since_preview` und das unlesbare Ziel sind jetzt getestet; eine
Bestätigung, die ihr ganzes Budget mit Lesen verbraucht hat, startet den Plan
ohne Welle (eine erzwungene Welle schob die Antwort über das Client-Limit);
`text/plain;charset=…` wird als früher geschriebener Text erkannt;
`exists`-Text, Werkzeugbeschreibung, Codetabelle in MCP-REFERENZ, CHANGELOG; der
Live-Test gibt bei `file_replaced` vorher/nachher aus, bevor er scheitert.
`wlo_add_to_collections`/`wlo_create_collection_tree` geben jetzt ebenfalls nur
ihr Restbudget an den Plan (dafür kein eigener Test: ein Vorbereiten über 40 s
lässt sich ohne Uhr-Attrappe nicht nachstellen; die Regel selbst ist am
`runPlan`-Test belegt).

**Nachtrag 2026-11-08 (Kleinigkeiten nach dem Push a604598):** die Statustexte
von neun älteren zweistufigen Schreibwerkzeugen kündigten die Handlung selbst an
(„wird angelegt“), obwohl der erste Aufruf nur eine Vorschau baut — jetzt
„… wird vorbereitet“, und ein Test hält die Regel für jedes ändernde
Kuratier-Werkzeug. Die Skill-Tabelle in `docs/MCP-REFERENZ.md` (42/41/42) ist
neu gezählt (51/50/51, über `tools/list` in allen drei Konfigurationen) und vom
Zahlen-Wächter erfasst — erst rot gegen den alten Stand gesehen.

**Review der Nachträge (unabhängiger Prüfer): 4 MINOR, 4 NIT — alle behoben,
dazu ein älterer Befund.** Der Statustext steht EINMAL je Werkzeug, also über
Vorschau UND Ausführung: „wird vorbereitet“ war über einer echten Löschung
falsch — jetzt „… wird bearbeitet“ für alle 18 zweistufigen Werkzeuge. Die vier
Stapel-Werkzeuge hatten gar keinen Text; der Test misst die registrierten
Kuratier-Werkzeuge jetzt (Stapel-Schalter an) statt der Handliste zu glauben.
Im Zahlen-Wächter traf das Muster für „50 Werkzeuge im Registry-Modus“ nichts
(der Satz bricht um) — jetzt muss jedes neue Muster mindestens einmal treffen,
beides per Gegenprobe rot gesehen; die Erwartungen je Skill-Modus sind gemessen
statt gerechnet; „die Zahl bleibt 42“ in beiden READMEs ist 51; `docs/TOOLS.md`
nennt alle Schalter, die die Liste verändern.

## Audit-Nacharbeit (Plan `2026-11-12-audit-nacharbeit.md`)

**P1 Zugang (S-1, S-2, S-6) — umgesetzt 2026-11-12.** Ein Zugangsblock gilt nur
noch für den Namen, für den seine ID gelistet wurde (`registry.labelOf`); die
Ausgabe lehnt einen Block mit fremder ID ab. Gemessen auf Staging: edu-sharing
nimmt einen Login in anderer Groß-/Kleinschreibung an und bestätigt dasselbe
Konto — deshalb trägt ein Eintrag jetzt zusätzlich den bestätigten Kontonamen
(`acct`, optional, kein Formatwechsel), nach dem „alle sperren“ und die
Obergrenze je Konto gehen. Die Anmeldesperre zählt eine Adresse in einem
Zählraum (`addressBucket`); beim Umstellen fielen vier Tests, weil die
Restwartezeit noch unter dem alten Schlüssel nachgeschlagen wurde — mit
umgestellt. Acht Gegenproben, alle rot gesehen.

**Review P1 (unabhängiger Prüfer): 6 MINOR, 4 NIT — alle behoben.** Der
Kontoschlüssel ist jetzt die Authority in voller Länge (`WloIdentity.account`),
nicht ihre auf 120 Zeichen gekappte Anzeigeform; die getippte Schreibweise
trifft beim Sperren nur Einträge OHNE bestätigtes Konto; ein Alt-Eintrag
bekommt sein Konto nachgetragen, wenn sein Block erneut ausgegeben wird
(`noteAccount`, Ablauf und Reihenfolge bleiben); Ticket-Einträge tragen das
Konto ebenfalls; der Standard-Zählraum eines Anmeldenachweises ist die Adresse.
Ticket-Roundtrip durch die Namensbindung getestet. AUTH.md §4 neu gefasst, mit
der benannten Restlücke.

**P2 Schreibziel (K-1, K-11) — umgesetzt 2026-11-12.** Die Lösch-Werkzeuge
verlangen den genauen Knotentyp und lehnen Platzhalter ab; Einordnen leitet
eine Verknüpfung aufs Original um wie das Sammelwerkzeug; Einordnen,
Herausnehmen, Umbenennen und Kompendium lehnen ein Ziel ab, das keine Sammlung
ist. Neuer Code `is_a_collection`. Zwölf Gegenproben (P1-Review und P2), alle
rot gesehen. Nach außen: nur Fehlbedienungen, die vorher durchliefen, werden
jetzt abgelehnt.

**P3 Grenzen (P-2, S-3) — umgesetzt 2026-11-12.** `get_skill` lädt ganz oder
gar nicht: kein Kürzen (Entscheidung vom 2026-08-20 bleibt), aber eine
Nicht-Text-Datei wird gar nicht erst geladen und ein Text über 2 MiB als Ganzes
abgelehnt (`contentRefused`). Anmelde- und OAuth-Routen lesen höchstens 64 KiB
Rumpf; Statuscodes unverändert. Acht Gegenproben, alle rot gesehen. Nach außen:
neues optionales Feld `skill.contentRefused`; sonst nur Missbrauchsfälle.

**Review P2 (unabhängiger Prüfer): 2 MAJOR, 6 MINOR, 3 NIT — alle behoben, eine
Messung dazu.** Kernbefund: `ccm:map` ist der allgemeine Container, keine
Sammlung. Gegen Staging gemessen (2026-11-12, `tests/live/node-kinds.test.ts`,
4 Tests grün): Sammlung = `ccm:map` MIT Aspekt `ccm:collection`; Ablage-Ordner
(angelegt als `cm:folder`), `-userhome-`, Seitenkonfigurations-Ordner und
Variante = `ccm:map` OHNE ihn; Verknüpfung = `ccm:io` mit `originalId` (3/3).
Eine Regel in `src/node-kind.ts`, die Werkzeuge gehen über `wrongKind`
(`curation-shared.ts`); Wächter in `shared-rule-discipline.test.ts`. Ordner:
von beiden Lösch-Werkzeugen abgelehnt (neuer Code `is_a_folder`) — vor P2 lief
ein Ordner samt Inhalt unbemerkt durch `wlo_delete_content`. Platzhalter-Riegel
jetzt in `registerCurationTool` für jedes id-Argument jedes Kuratier-Werkzeugs.
Einordnen: Materialseite geprüft, Original gelesen, schon Enthaltenes wird
nicht gesendet. 14 Gegenproben, alle rot gesehen.

**Review P3 (unabhängiger Prüfer): 7 MINOR, 5 NIT — alle behoben.** Die
Schranke gilt jetzt auch auf dem Rückfallpfad über den Text-Extrakt; ein leerer
Download fällt auf den Extrakt zurück; die Vorab-Regel ist eine Sperrliste
sicher binärer Typen statt „alles außer `text/*`" (gemessen ist nur
`text/x-web-markdown` — auf Verdacht abzulehnen hätte eine funktionierende
JSON-Begleitdatei gebrochen); der Task-Pfad nennt den Ablehnungsgrund
(`task.refused`); ein übergroßes Registry-Dokument wird gemerkt statt je Tick
neu geladen und gilt nicht als Antwort (`CacheEntry.oversized`, dieselbe Form
wie `scanTruncated`); die ungenutzte Hülle `getNodeDownloadText` ist entfernt.
S-3-Test deckt `/auth/ticket` und einen Betreiberwert unter 64 KiB. Acht
Gegenproben, alle rot gesehen. Offen und bewusst nicht in diesem Paket:
`getNodeTextContent` liest überall ohne Byte-Schranke (Extrakt, nicht
Rohdatei) — gehört zu P5 (`wloFetch`).

**P4 Herunterfahren (B-1) — umgesetzt 2026-11-13.** `src/shutdown.ts`: auf
SIGTERM/SIGINT keine neuen Verbindungen, laufende Anfragen zu Ende, Exit 0;
nach 25 s wird abgeschnitten (Exit 1), ein zweites Signal beendet sofort.
`docker-compose.yml`: `init: true`, `stop_grace_period: 30s`. Am gebauten Image
gemessen: `docker stop` 2,3 s (Node als PID 1) bzw. 1,0 s (mit `--init`),
Exit-Code 0, beide Logzeilen vorhanden. Sechs Tests an einem echten
`http.Server`; einer davon fand, dass einmaliges Schließen der Leerlauf-
Verbindungen nicht reicht (Keep-Alive hielt den Exit ~5 s auf).

**Review P4 (unabhängiger Prüfer): 1 MAJOR, 5 MINOR, 6 NIT — alle behoben.**
Kern: die erste Fassung wartete auf VERBINDUNGEN (`server.close`), und das war
in beide Richtungen falsch (vom Prüfer an node:http gemessen): eine Verbindung
ohne Anfrage hielt den Exit die ganze Frist auf und endete als „erzwungen",
während ein Client, der mitten in der Anfrage auflegt, keine Verbindung
hinterlässt — der Exit kam mitten im Schreibvorgang. Jetzt zählt ARBEIT:
Handler nicht zurückgekehrt, Antwort nicht ausgeliefert, oder vom Request
gelöste Arbeit (`detachedFromRequest`, die Schreibvorgänge). Frist 70 s
(vorher 25 s — zu kurz für genau die Schreibaufrufe, um die es geht),
`stop_grace_period: 75s`. Der falsche Satz in DEPLOYMENT §5.0 („Schlüssel
erneut vorlegen") ist ersetzt: nach einem Neustart kennt der Server den
Schlüssel nicht mehr. Erststart der Zugangsliste schreibt über temp+rename.
13 Tests, 13 Gegenproben rot gesehen.

**Übergreifendes Review Phase 1 (P1–P3): 2 MAJOR, 5 MINOR, 5 NIT — behoben,
ein Punkt bewusst offen.** (1) `wlo_add_to_collections` prüft jetzt die
Materialseite wie das Einzelwerkzeug und nennt je unbrauchbarer id einen Code
(`error.refused`). (2) `wlo_create_collection` liest sein `parentId` und
verlangt eine Sammlung; die Vorschau nennt sie mit Titel. Dazu: Volltext auf
einem Container wird abgelehnt (`not_a_record`), `get_collection_overview`
fragt dieselbe Regel, die Art-Entscheidung liegt in `node-kind.ts` (Dienste und
Werkzeuge teilen sie), der Wächter deckt `services/write/` ab. **Offen und eine
Entscheidung, kein Fehler:** `wlo_update_content[s]`, die Vorschlags-Werkzeuge
und `wlo_submit_content` nehmen weiterhin jede Knotenart — ob Sammlungs-
Metadaten darüber gepflegt werden dürfen, ändert bestehendes Verhalten und
gehört dem Nutzer (vorgemerkt für P11).

Nachmessung P4 am gebauten Image (2026-11-13, nach dem Umbau auf „Arbeit
zählen"): `docker stop` 1,3 s (Node als PID 1), 1,4 s (`--init`), 1,0 s mit
einer offenen Verbindung, die nie eine Anfrage schickt — jeweils Exit 0.

**P5 Gesamtlimit und Abbruchsignal (P-1, dazu P-3) — umgesetzt 2026-11-13.**
`src/upstream-gate.ts`: prozessweite Obergrenze für Aufrufe ans Repository
(`WLO_UPSTREAM_CONCURRENCY`, Standard 24, 0 = aus), FIFO, unterhalb der Grenze
synchron wie bisher; ohne Platz binnen `WLO_FETCH_TIMEOUT_MS` wird nicht
gesendet und 503 + `Retry-After` geantwortet (→ `upstream_busy`).
`src/request-scope.ts`: das Verbindungsende der eingehenden Anfrage bricht die
Repository-Aufrufe ab (`/mcp`, `/api/*`); Kuratier-Werkzeuge laufen bewusst
davon gelöst (`registerCurationTool`), der gemeinsame Registry-Abruf ebenfalls.
14 Tests (10 Einheit, 4 über einen echten Server), 13 Gegenproben rot gesehen.
Nach außen: neue Betreiber-Einstellung; unter Überlast `upstream_busy` statt
ungebremster Last. Hinweis zur Audit-Aussage „das Repository drosselt ab etwa
11 Anfragen je Sekunde": das ist keine Messung einer Drossel, sondern die in
CLAUDE.md errechnete Dauerlast eines Vollabzugs — der Standardwert 24 ist
deshalb am Bedarf EINES Aufrufs bemessen, nicht an einer gemessenen Grenze.

**Review P5 (unabhängiger Prüfer): 2 MAJOR, 4 MINOR, 4 NIT — behoben bis auf
einen Punkt, der Paket 9 ist.** Die Zählung selbst war korrekt (kein Leck, keine
Doppelfreigabe, vom Prüfer per Sonde bestätigt). Behoben: die
Bereitschaftsprüfung läuft am Limit vorbei (`outsideUpstreamGate`) — sonst
meldete `/ready` eigene Überlast 30 s lang als „Repository nicht erreichbar";
eigene Wartegrenze 5 s statt des 20-s-Timeouts, Warteschlange auf das
Vierfache des Limits begrenzt, `Retry-After` 5; ein Client, der schon vor
Arbeitsbeginn aufgelegt hat, wird erkannt; ein Hang-up ist `ClientGoneError`
(Info-Log statt Fehler, Fan-out bricht ab statt je Element zu scheitern, nie
als Zeitüberschreitung gewertet); Verhaltenstest über einen echten Server,
dass ein Kuratier-Werkzeug NICHT abgebrochen wird; SSE-Modus getestet.
**Offen = P9:** sechs Lese-Helfer schwächen ein 503 zu „leer" ab — auch das
selbst erzeugte. Dokumentiert, nicht mehr als „jeder Aufrufer meldet
upstream_busy" behauptet. 24 Tests, 19 Gegenproben rot gesehen.

**P6 Image, Starttest, Adressprüfung (B-3, T-1, B-6) — umgesetzt 2026-11-13.**
`scripts/smoke-image.sh` (CI-Schritt in GitHub; lokal gelaufen: grün) baut das
Image, startet es unter den Compose-Einschränkungen und prüft `/health`, den
HEALTHCHECK-Befehl im Container, `tools/list`, ein fehlerfreies Startlog,
sauberes `docker stop` und die Ablehnung einer unbrauchbaren Adresse.
Gegenprobe: Image ohne Signal-Handler → Skript rot (Exit 143).
`tests/start.test.ts` startet `src/http.ts` und `src/stdio.ts` als
Kindprozesse (5 s). `repositoryUrlProblem` + Abbruch beim Start in beiden
Einstiegen. 6 Gegenproben rot gesehen. GitLab-Pipeline unverändert (kein
Docker-Daemon im Job) — dort vermerkt.

**P7 offene Ausgänge und ein Plan-Gerüst (A-4, K-4, K-5, K-7) — umgesetzt
2026-11-13.** `runPlannedCall` (`tools/curation-plan.ts`) trägt den Ablauf der
vier Sammel-Werkzeuge einmal (zusammen ~120 Zeilen weniger, Verhalten
unverändert, alle bestehenden Tests grün). `isOutcomeOpen`: Verbindungsabbruch
nach abgesandter Anfrage = offen wie eine Zeitüberschreitung. `outcomeOpen` an
`plan_expired` (true), `plan_mismatch`/`too_many_plans` (false), den
Stapel-Fehlern und `confirm_unknown` (true; Satz „Es wurde nichts geschrieben"
ersetzt). `reportOutcome`: das Zurücklesen entscheidet auch über ein Feld,
dessen Schreibaufruf mit Fehler beantwortet wurde. 13 neue Tests, 13
Gegenproben: 11 rot, 2 lehrreich überlebt — eine doppelte Zeile (entfernt) und
`canonicalArgs`: die Audit-Aussage „andere Schlüsselreihenfolge findet den Plan
nicht" traf nicht zu, zod ordnet deklarierte Schlüssel bereits (im Code
vermerkt). Nach außen: additive Felder; `timeout` jetzt auch bei Abriss.

**Review P6 (unabhängiger Prüfer): 1 MAJOR, 9 MINOR, 7 NIT — alle behoben.**
MAJOR: zwei ältere Warnungen schrieben die Adresse VOR der Ablehnung ungekürzt
ins Log — mit Passwort, einmal je Neustart; jetzt überall `addressForLog`
(Herkunft + Pfad), per Starttest belegt (Passwort in keiner Logzeile).
Schema-Regel verengt (ein `:` oder `//` weiter hinten im Pfad startet wieder)
und erweitert (`https:/host`, nacktes `http://`, nacktes `?`/`#`); eine
Funktion für beide Einstiege (`startup-check.ts`), für beide getestet.
Smoke-Skript: echter HEALTHCHECK-Befehl aus dem Image, Zeitgrenzen, kein
`| grep -q` unter pipefail, freier Port, `npm run smoke:image`, CI mit
`timeout-minutes`; `.gitattributes` (LF für `*.sh` — die Datei lag mit CRLF
vor, was Linux-bash bricht). Kindprozesse der Starttests laufen unter netguard.
Smoke lokal erneut grün.

**Review P7 (unabhängiger Prüfer): 0 CRITICAL/MAJOR, 8 MINOR, 7 NIT — alle
behoben.** Der Umbau der vier Sammel-Werkzeuge wurde Pfad für Pfad gegen die
Baseline als verhaltensgleich bestätigt. Behoben: ein mit 5xx oder ohne
verwertbare ID beantwortetes Anlegen ist `failed` UND offen (Stapel-Ordner und
-Datei; der Text riet zuvor „erneut senden" über einem Ordner, der existierte);
eine angelegte Sammlung behält ihre ID, wenn eine SPÄTERE Anfrage desselben
Anlegens abgelehnt wird (im Baum scheiterten sonst alle Kinder); abgelehnt mit
5xx + nicht sichtbar = offen; die Sammel-Schritte melden einen Abriss als
`timeout`; ein offener Schritt wird höchstens dreimal versucht
(`MAX_OPEN_TRIES`), dann `failed` + offen; `plan_mismatch` und
`confirm_mismatch` über einem schon eingelösten Schlüssel sind offen; die
beiden Quelltext-Wächter prüfen jetzt den NAMEN statt einer Aufruf-Schreibweise
(`findPlan<T>(` rutschte durch). 21 Tests in `curation-open-outcomes.test.ts`.

**P8 Inhaltssuche (A-1, K-2, P-5) — umgesetzt 2026-11-13.**
`services/content-search.ts`: EIN Ablauf für `search_wlo_content` und den
Inhalts-Teil von `search_wlo_all`. K-2: eine zu kurze Seite wird aus bis zu drei
weiteren Fenstern aufgefüllt (`REFILL_ROUNDS`), der Rest als
`more {nextSkipCount}` offengelegt — in beiden Werkzeugen (beide Formate) und
auf der HTML-Seite; „Keine Inhalte gefunden" steht nicht mehr über einer bloß
erschöpften Seite. P-5: Volltext nur für die ersten 20 Treffer
(`textContentSkipped`), fehlgeschlagene Abrufe als `textContentUnreadable`.
12 Tests, 19 Gegenproben rot gesehen. Nach außen: additive Felder; mehr
Treffer je Seite als vorher, wo vorher zu wenige kamen. **Teil-Erledigung
A-1:** der Einzelfall-Handler von `get_node_details` (rund 200 Zeilen neben dem
Dienst) ist nur um die Volltext-Regel entdoppelt (`readStoredTextAnswer`); das
Zusammenlegen gehört zu A-5 (P14) und ist dort vorgemerkt.

**Review P8 + übergreifendes Review Phase 2: 1 MAJOR, 10 MINOR, 2 NIT (+2
vorbestehend) — behoben.** MAJOR: das Ende einer geblätterten Suche wurde an
`total` abgelesen; die Zahl zählt aber die Voll-Variante bzw. die exakte
Lizenz, geblättert wird über alle Varianten bzw. die Lizenzfamilie — bei
„Unterrichtsstunde …"-Formulierungen und einer einzelnen Lizenz lief die Suche
weiter leer. Jetzt sagt das FENSTER, ob es das letzte war
(`SearchResponse.exhausted`). Dazu: Auffüllen erst aus dem Rest des gereihten
Fensters; Lizenz-Gesamtzahl einmal je Aufruf; Hang-up bleibt Hang-up;
Schreibvorgänge werden an der Schlange nie abgewiesen (`patient`);
`/api/search?fields=` und das Widget tragen die Hinweise; ungelesene Liste nach
abgelehntem Anlegen lässt den Baum-Schritt offen. Die sechs Sonden des Prüfers
sind als Regressionstests übernommen.

**P9 „nicht erreichbar" ≠ „leer" (K-3, K-15) — umgesetzt 2026-11-13.** Die
Sammlungs-Indizes und die Portal-Liste sagen, ob sie GEANTWORTET haben;
`search_wlo_all` trägt `collections.incomplete` / `topicPages.incomplete`,
`search_wlo_collections` `incomplete`, ein Wortlaut (`incompleteNotice`) in
allen Ausgaben; `search_wlo_topic_pages` meldet einen nicht antwortenden Index
als Fehler. Der erzwungene Registry-Frischabruf läuft durch den
Zwischenspeicher (`refreshRegistries`). 10 Tests in
`search-unreachable.test.ts`, 3 in `tools-registry-param.test.ts`. Nach außen:
additive Felder; während eines Ausfalls Fehler statt „keine Themenseiten".

**P10 eine Registrierung für alle Werkzeuge (A-2) — umgesetzt 2026-11-13.**
Zwölf Lesewerkzeuge riefen `server.tool` direkt und gingen damit an
`registerWloTool` vorbei — der einen Stelle, an der die Abschaltung unsicherer
Werkzeuge hängt. Sie nutzen jetzt `registerReadTool` (dieselbe Kurzform, durch
die gemeinsame Stelle). `tools/list` vor und nach der Umstellung verglichen:
Byte für Byte identisch (253 299 Bytes). Wächter in
`shared-rule-discipline.test.ts`, per eingespielter Verletzung rot gesehen.
**Bewusst nicht in diesem Paket:** Ausgabeschemata für die zwölf — ein Schema
ist ein Vertrag je Werkzeug (`additionalProperties: false`), kein Rundumschlag;
vorgemerkt für P14.

**Review P9 (unabhängig, 3 MAJOR · 8 MINOR · 4 NIT) — alle behoben 2026-11-13.**
Der Kern: das Paket hatte die Suche selbst ehrlich gemacht, aber nicht die Wege
EINEN Schritt dahinter. (1) `search_wlo_topic_pages`/`get_topic_page_content`
mit `query` meldeten „keine Themenseite", wenn die Fachportal-Liste nicht
antwortete → `findTopicPagesByQueryResult {pages, incomplete}`, eigener Grund
`source_unreachable`. (2) Eine nicht LESBARE Sammlung galt als Sammlung ohne
Themenseite → `getCollectionThemePages` wirft außer bei 404/403/401. (3) Der
Baum-Rückfall von `search_wlo_collections` zählt ungelesene Unterlisten.
Dazu: fehlgeschlagener Frischabruf zeigt nicht mehr den alten Katalog
(`refreshRegistries` → `{answered, failed}`), JSON-Blockreihenfolge, flache
Widget-Form, HTML-Seite ohne „Keine Treffer." neben der Warnung, Namens-Index-
Treffer ohne Nachlesen, schlankes `search` (leer + Ausfall = Fehler). Die vier
Kurzformen ohne „hat es geantwortet?" sind entfernt; der Wächter „nur ein Modul
kennt beide Indizes" traf seit der Umbenennung keinen Aufruf mehr und ist
repariert (Verletzung eingespielt: rot). Gegenproben: 13 Mutationen, alle rot
(eine erst nach einem zusätzlichen Test — der Fachportal-Term war im
bisherigen Fixture von einem anderen mit abgedeckt). 2945 Tests grün.
**Nach außen sichtbar:** `search_wlo_topic_pages` mit `collectionId` und
`search` (schlank) antworten bei einem Ausfall jetzt mit `isError` statt leer.

**P11 Vorschläge und die id eines angelegten Datensatzes (K-6, K-8, K-9, K-10) — umgesetzt 2026-11-13.**
K-6: `createContentNode` wirft nicht mehr, wenn ein Schritt NACH dem Anlegen
keine Antwort bekommt — `created` mit `incomplete`, das Werkzeug meldet
`unverified` mit `error.nodeId`; 5xx beim Anlegen ist `outcomeOpen: true`.
K-8: Annehmen fügt bei mehrwertigen Feldern hinzu (`valuesAfterAccept`).
K-9: Einzel- und Sammelwerkzeug teilen `newProposals`/`createSuggestions`;
hinterlegt wird am Original; leere Antwort = offen; Auflisten/Entscheiden
sehen am genannten Knoten UND am Original nach (`suggestionsFor`).
K-10: nur OFFENE Vorschläge sind entscheidbar (`already_decided`), der Status
wird nach dem PATCH zurückgelesen (`suggestion_not_marked`).
Tests zuerst (14 rot → grün), 14 Mutationen alle rot, 2963 Tests grün.
**Ungemessen:** ob das Repository Vorschläge über eine Verknüpfungs-id selbst
aufs Original auflöst — Staging kann derzeit keine Verknüpfungen anlegen
(PUT references 500). Deshalb fragt `suggestionsFor` beide Knoten.

**Review P10+P11 (unabhängig, 1 MAJOR · 7 MINOR · 2 NIT) — alle behoben 2026-11-13.**
MAJOR: die K-6-Antwort sagte „NICHT erneut anlegen" und hängte danach den
Standardhinweis für einen verbrauchten Schlüssel an („neue Vorschau
bestätigen") — beim Datei-Weg entsteht genau so der zweite Datensatz. Ein
Fehler über einem angelegten Datensatz trägt jetzt `recordExists: true`,
`requiresNewPreview: false` und den Hinweis, am vorhandenen nachzutragen.
MINOR: jeder Schritt nach dem Anlegen hat sein eigenes try (ein Upload ohne
Antwort kostet nicht mehr den Titel); „hinzugefügt" nur, wenn hinzugefügt wird;
Autor/Herausgeber bewusst ersetzend (begründet im Code); Vorschlag nach der
Entscheidung nicht mehr in der Liste = offen; weniger genannt als gesendet =
`unverified`; Dubletten im selben Aufruf; Wächter der Registrierung liest die
ganze Datei ohne Kommentare und fängt jeden Empfänger.

**P12 Beobachtbarkeit (B-5) — umgesetzt 2026-11-13.** `X-Request-Id` an jeder
Antwort und als `req` in jeder Logzeile der Anfrage (eigener ALS-Speicher,
`src/request-id.ts` — er überlebt `detachedFromRequest`, weil gerade der
Schreibvorgang verfolgbar sein soll). `GET /metrics` (`src/metrics.ts`,
`src/rest/metrics-route.ts`) nur mit `METRICS_TOKEN`, ohne Abhängigkeit;
Zählung an den drei Nahtstellen: Antwortende in `http-app.ts`, Werkzeugaufruf
in `registerWloTool`, Repository-Aufruf in `wloFetch`. Container-Log auf
5 × 10 MB begrenzt. Nicht Code: eine Verfügbarkeitsprüfung von AUSSEN
(DEPLOYMENT §5.0.1). Neue Betreiber-Einstellung: `METRICS_TOKEN`.

**P13 übrige Sicherheitsbefunde (S-4, S-5, S-7 … S-13) — umgesetzt 2026-11-13.**
S-4 Upload-Route: Protokoll-Budget VOR der Anmeldung, abgelehnte Anmeldung 60 s
gemerkt, je Anmeldung höchstens die Hälfte des Byte-Budgets. S-5 Vorschau nennt
JEDE Datei; abweichende Größe wird nicht abgelegt. S-7 Dienstkonto nur noch als
Modus (`authority: null`). S-8 anonyme OAuth-Codes je Adresse. S-9 `fsync` vor
dem Umbenennen der Zugangsliste. S-10 `src/keyed-digest.ts` — ein Geheimnis je
Prozess für jedes Wiedererkennen einer Anmeldung. S-12 fremde Identität
verbraucht keinen Schlüssel; das Dienstkonto ist nicht EINE Person. S-13 volle
Prüfsumme bindet den Datei-Upload. Tests zuerst (`tests/security-leftovers.test.ts`).
**S-11 nur als Startwarnung:** OAuth ohne `WLO_PUBLIC_BASE_URL` abzuschalten
würde Installationen brechen, die auf dem Host-Kopf laufen — Betreiber-
entscheidung, im Abschlussbericht genannt.
**Nach außen sichtbar:** `/auth/status` und `wlo_auth_status` nennen das
Dienstkonto nicht mehr beim Namen (Felder bleiben, `authority` ist dort `null`);
die Datei-Vorschau zeigt 64 statt 12 Zeichen Prüfsumme; `/api/uploads` kann
`429 rate_limited` antworten.

**Review über Phase 3 (P12, P13, Querbezüge P9–P13; 2 MAJOR · 6 MINOR · 6 NIT) — behoben 2026-11-13.**
MAJOR 1: scheiterte nach einem ANGELEGTEN Datensatz nur das Zurücklesen, fehlte
`recordExists` — der Hinweis für den verbrauchten Schlüssel lautete wieder
„neue Vorschau". MAJOR 2: der Anteil je Anmeldung am Upload-Budget konnte
kleiner sein als eine erlaubte Datei. Dazu: Stapel-Eigentümer als
Schlüssel-Hash (übersehene Stelle von S-10, jetzt mit Wächter über ganz `src`),
abgelaufener Bestätigungsschlüssel antwortet seine ganze Stunde `expired`,
Dienstkonto mit eigenem Anteil (500) statt ohne Deckel, `confirm_mismatch`
nennt die andere Anmeldung, abgebrochener Aufruf zählt als `cancelled`,
Verzeichnis-`fsync` wo möglich. CHANGELOG hat einen gesammelten Abschnitt
„Changed — visible to clients". 6 Gegenproben rot, 3006 Tests grün.
Nicht umgesetzt (begründet): Ratenbegrenzung für `/metrics` (Token ≥ 16 Zeichen,
Vergleich kostet zwei Hashes).

**P14 begonnen:** D-1 (Datenschutzerklärung nennt Benutzernamen/IP in Logs),
D-3 (acht Variablen in beiden READMEs, Wächter aus dem Quelltext; echte
Clone-Adresse; Compose ohne Zahl), X-1 (`.github/dependabot.yml`), F-1
(Markdown-Darsteller: Code und Links vor Fett/Kursiv geschützt). K-12 war
bereits mit P7 erledigt (Nachschau ohne Antwort → `pending/not_checked`).

**P14, erster Teil — umgesetzt 2026-11-13:** K-13 (laufende Stapel werden nicht
verdrängt → `too_many_batches`; offener Ordner wird nicht zweimal angelegt),
K-14 (vier Stellen: Version nur versprechen, wo eine entsteht · `already_submitted`
· Kompendium-Entfernen bindet Länge+Prüfsumme · Stapel-Titel bis 200 Zeichen),
K-16 (Skill-Durchlauf meldet `incomplete` · ein Cache-Takt zur Zeit · Wikipedia
`unreachable`), F-1 (Markdown), F-2 (Anmeldeseiten DE/EN — im Browser geprüft:
Umschalten per Tastatur, sichtbarer Fokus, 375 px ohne Überlauf; KEIN
Screenreader-Test), D-1, D-3, X-1. 11 Gegenproben rot. 3027 Tests grün.
Bewusst so entschieden: bei offenem Ordner wird NICHT nachgesehen und
weiterverwendet (die Form der Ordnerliste im eigenen Bereich ist ungemessen;
das Testkonto darf keine Ordner anlegen) — der Stapel bleibt ohne Ordner und
muss neu vorbereitet werden.

**P14, zweiter Teil — umgesetzt 2026-11-13:** P-3 (rekursiver Sammlungsinhalt
ebenenweise in Sechsergruppen; Reihenfolge des Baums, Besuchsdeckel 50
unverändert), P-4 (`src/short-cache.ts`: Fachportal-Liste und
Skill-Beschreibungen 60 s; nur Antworten, nie ein Ausfall, nie ein laufendes
Promise), A-6 (0 Import-Zyklen über 238 Dateien, gemessen), A-7 (eine Stelle
für die Titelwahl, zwei Ketten mit Begründung; Wächter fand beim Einbau zwei
weitere Stellen), A-5 teilweise (`curation-shared.ts` 613→443,
`skill-registry.ts` 641→458, Lesepfad von `get_node_details` in den Dienst),
T-2 teilweise (`tests/live/suggestions.test.ts`, grün gegen Staging).
**Gemessen 2026-11-13 (Staging):** `POST /suggestions` nennt die angelegten
Vorschläge (2 von 2, mit `confidence: 0`); `PATCH` + `GET` zeigt den neuen
Status am selben Knoten; **das Repository lässt DECLINED → ACCEPTED zu** —
unsere Sperre `already_decided` ist die einzige; `ccm:taxonid` mit zwei Werten
kommt als zwei Werte zurück. 3033 Tests grün.

**Bewusst NICHT umgesetzt — braucht eine Entscheidung (siehe Abschlussbericht):**
- A-3 (einheitlicher Vertrag: eine Form für „nicht gefunden", gleiche
  Vorgabewerte, Weiterblättern überall) — ändert Antwortformen und Vorgaben,
  also die Außenschnittstelle.
- A-2-Rest (Ausgabeschemata für die zwölf Lesewerkzeuge) — jedes Schema ist
  ein veröffentlichter Vertrag (`additionalProperties: false`).
- D-2 (CHANGELOG/CLAUDE.md/STATUS kürzen, Versionen schneiden, `/health`
  meldet 1.0.0) — Dokumente und Versionsnummer des Nutzers.
- S-11 hart (OAuth nur mit `WLO_PUBLIC_BASE_URL`) — bräche laufende
  Installationen; umgesetzt ist die Startwarnung.
- Aus P11: sollen Metadaten-Werkzeuge Sammlungen/Ordner ablehnen?
**Offen ohne Entscheidung, nur Aufwand:** restliche Aufteilungen aus A-5
(`skill-registry-cache.ts` 730, `http-app.ts` 618, `wlo-config.ts` 572,
`curation-content.ts` 545 Zeilen), die laut knip ungenutzten Exporte (nicht
geprüft — knip ist nicht installiert), weitere Live-Tests (Einreichen,
Themenseite, Sammlungsbaum; Einordnen und Stapel scheitern derzeit an der
Staging-Regression) und ein nächtlicher Lauf (die CI hat keine Zugangsdaten).

**Review P14 (unabhängig, 3 MAJOR · 8 MINOR · NITs) — behoben 2026-11-13.**
MAJOR 1: der neue Minuten-Zwischenspeicher war nur nach Knoten geschlüsselt —
eine mit den Rechten einer Person gelesene Skill-Beschreibung ging eine Minute
lang an anonyme Aufrufer. Schlüssel trägt jetzt, wessen Rechte gelesen haben
(`sharedReadScope`); Lesungen einer persönlichen Anmeldung werden gar nicht
behalten. MAJOR 2: Stapel-Zusammenfassung sprengte mit 200-Zeichen-Titeln ihr
Feld → Titel in der Zusammenfassung auf 120 gekappt. MAJOR 3: im parallelen
Durchlauf konnte eine Sammlung den Aufruf scheitern lassen, die der serielle
nie gefragt hätte → `allSettled`. Dazu acht kleinere (Wikipedia-Ausfall in
REST und `search_wlo_all`, `get_skill_for_task`, Stapel-Texte und -Verdrängung,
Titelketten, Markdown, Fokusring, Cache-Stop, Variablen-Wächter).
`tests/audit-p14-review.test.ts` (12 Tests), Gegenproben rot bis auf drei
gleichwertige Mutanten (begründet). **3045 Tests grün**, tsc, Lint, Build,
Image-Starttest (`npm run smoke:image`, jetzt auch unter Git Bash/Windows).
Nicht übernommen (geprüft, kein Fehler): „Wiederholung nach verlorener Antwort
bekommt `already_submitted`“ — die Wiedergabe eines eingelösten Schlüssels
läuft an der gemeinsamen Nahtstelle VOR dem Handler.
Offen aus dem Review, ohne Umsetzung: Statuszeilen behalten nach einem
Sprachwechsel die alte Sprache; deutsche Servermeldungen im englischen Modus
tragen kein `lang="de"`.

**Audit-Nacharbeit: P1–P14 abgeschlossen bis auf die oben genannten
Entscheidungspunkte.** Nichts ist committet.

**Rückmeldung des Chatbot-Teams vom 2026-11-13 — der vertragsneutrale Teil ist umgesetzt.**
(1) Hinweis „voller Durchlass wird zu leer": die letzten vier Aufrufer ohne
`reachable` melden es jetzt (`get_collection_contents` rekursiv →
`incomplete`, `browse_collection_tree` → `childrenUnread`, Skill-Durchlauf →
`incomplete`, Varianten einer Themenseite → `source_unreachable`); die Kurzform
`getChildCollections` ist entfernt. (2) Hinweis „Leerfall als Satz":
`structuredContent` trug `total/count/results[/incomplete]` schon; neu ist der
parsebare erste Block im JSON-Modus. (3) W6: `get_skill` mit
`structuredContent {found, contentLoaded, contentRefused?}`. (4) W5:
`x-client-trace-id` und B3 gelesen, geloggt, ans Repository weitergegeben
(`src/request-id.ts`). 10 Tests (`tests/chatbot-feedback-1113.test.ts`),
12 Gegenproben rot, 3055 Tests grün.
**Nicht angefasst — Entscheidung des Nutzers bzw. außerhalb des Codes:** die
fünf Entscheide (D-2 Versionen, A-3, Ausgabeschemata, S-11, Sammlungen in den
Metadaten-Werkzeugen), der Diensteleitfaden von Team 6 (zweiter Port,
Log-Feldnamen/stdout, `LOG_LEVEL`, getrennte Readiness, Helm, OpenAPI,
Dienst-ID), W1/W4 (warten auf den Staging-Fix), W2/W3 (hängen an Fragen ans
Repository-Team), W7.

**Rückmeldung des Chatbot-Teams vom 2026-11-13, zweite Fassung — D1–D7 umgesetzt (nach 1.1.0, unveröffentlicht).**
D1: `wlo_submit_content` lehnt Sammlungen/Ordner ab (`is_a_collection`/`is_a_folder`). D2: Titel/Beschreibung einer
Sammlung gehen in `cm:title`/`cm:description` (`services/write/collection-fields.ts`, vier Werkzeuge, Wächter in
`shared-rule-discipline`). **Gemessen auf Staging 2026-11-13** (`tests/live/collection-metadata.test.ts`):
`cclom:title` an einer Sammlung wird als ZWEITES Feld gespeichert; `collection.title` bleibt, der DTO-`title` des
Knotens folgt ab dann dem neuen Feld und wird von einer späteren Umbenennung nicht mehr erreicht; `cm:title` /
`cm:description` über die Metadaten-Route landen dort, wo die Sammlung liest. D3: `error.nodeId` bei jedem
`recordExists`. D4: `scope` an `too_many_batches`. D5: `incompleteReason` bei `search_skill`. D6: 401/403/404 einer
Unterliste ist kein Ausfall (`didNotAnswer`, `isRefusal`); Schreibpfade lesen eine Ablehnung weiter als „nicht
herausgefunden". D7: `incomplete` im JSON-Text. Tests: `collection-metadata-routing` (10),
`refused-is-not-unreachable` (18), zwei erweiterte; 22 Gegenproben rot.
**Nebenbefund Live-Lauf:** `tests/live/fulltext.test.ts` „a full text written to textContent reads back" ist auf
Staging GRÜN (der 500 auf `POST textContent` ist für Datensätze ohne Datei weg); der Test MIT Datei bleibt rot —
W1/W4 also weiter offen, aber nicht mehr vollständig blockiert. Nicht weiter untersucht.
**Review D1–D7 (unabhängig, 7 Befunde, alle behoben):** der Skill-Durchlauf zählte einen abgelehnten
INHALTS-Abruf weiter als Ausfall (MAJOR); ein abgelehnter Startknoten trug den Code eines Ausfalls — `failureCode`
kennt jetzt `not_found` für 404; Fachportal-Wurzel und `search_skill`-Wurzel sagen „nicht gefunden oder … nicht
lesbar"; eine Sammlung wird in jedem bestätigten Satz mit IHREM Titel benannt (`titleOn`), nicht mit einem
verirrten `cclom:title`; `wlo_update_content` lehnt eine Datei an einer Sammlung ab; Wächter zählt Zuordnungen je
Baseline. 11 Gegenproben rot.

**D8–D10 umgesetzt (2026-11-13).** D8: Log-Felder `timestamp`/`level`/`service`/`message` (vorher
`ts`/`name`/`msg`), über HTTP nach stdout (`logger-stdout.ts` als ERSTER Import von `http.ts`), unter stdio weiter
stderr, `LOG_LEVEL`. D9: Dauern als Histogramme (`wlo_tool_duration_seconds`, neu `wlo_upstream_duration_seconds`,
`wlo_http_request_duration_seconds`; ein Bucket-Raster 0,05–60 s), Prozessmetriken unter den üblichen Namen,
Event-Loop-Verzögerung. D10: `INTERNAL_PORT` — zweiter Listener nur für `/health`, `/ready`, `/metrics`
(`rest/internal-port.ts`, `rest/health.ts`), Zusatz zum öffentlichen Port. 3100 Tests, 3099 grün, 1 übersprungen;
Lint, Typprüfung, Build sauber.
**Nicht gebaut, weil es eine Entscheidung braucht:** die Zeile „Logs tragen IP, Benutzername und Suchbegriff" aus
der Leitfaden-Tabelle — was davon aus dem Log soll, ist eine Abwägung zwischen Datenschutz und Missbrauchsdiagnose.
**Offen:** D11 (Ressourcen messen, Zustand beschreiben), D12 (OpenAPI der Nebenpfade, Antwortzeiten je Werkzeug),
D13 (Entwurf Helm-Chart, Steckbrief).

**Review D8–D10 (unabhängig, 9 Befunde, alle behoben, 2026-11-13):** `not_found` fehlte in den veröffentlichten
`missing[].code`-Enums von `get_collection_overview` und `count_wlo_content_matches` (MAJOR — ein 404 an einem
Teil hätte die ganze Antwort an der Schemaprüfung scheitern lassen); Event-Loop-Verzögerung um die Auflösung des
Monitors bereinigt; ein nicht zu öffnender `INTERNAL_PORT` beendet den Start; Readiness gehört an den öffentlichen
Port (Doku); interner Handler fängt Fehler; Startzeit einmal berechnet; Rest Text und Tests. 3101 Tests, 3100 grün,
1 übersprungen; Image-Starttest bestanden (vor den Review-Korrekturen gelaufen).

**D1–D10 gepusht (2026-11-13):** Commit `645d326` auf `janschachtschabel/wlo-mcp-sc`, CI grün (inkl. Image-Starttest).

**D11 — Ressourcen gemessen, Zustand beschrieben (2026-11-13).** `npm run measure:resources`
(`scripts/measure-resources.mjs`, meldet nur). Gemessen (gebauter Server, anonym, Lesen gegen Staging): Leerlauf
72 MB, nach einer Runde Lesewerkzeuge 100 MB, Spitze bei 3 × 10 gleichzeitigen `search_wlo_all` 172 MB, 0,3 Kerne.
Speicher an ihren Grenzen, je in eigenem Prozess: Upload-Slots 128 MB gehalten → +156 MB (gehaltene Bytes plus die
Größe der zuletzt abgelegten Datei; wo diese Kopie liegt, ist nicht verfolgt — begrenzt durch eine Datei);
Volltexte 64 MiB → +67 MB bei reinem Latin-1, **+131 MB sobald ein Zeichen außerhalb liegt** (V8 hält die
Zeichenkette dann mit zwei Bytes je Zeichen; die Grenze zählt UTF-8-Bytes). Schlimmster Fall zusammen rund 480 MB —
`mem_limit: 512m` reicht ohne Stapel-Upload bequem, mit ihm nur knapp; Empfehlung 768 MB (dokumentiert, Compose
NICHT geändert). `docs/DEPLOYMENT.md` §5.0.2: Zahlen, was im Speicher liegt und wie lange, warum eine Instanz.

**D12 + D13 (2026-11-13), mit unabhängigem Review über D11–D13 (11 Befunde + 4 Kleinigkeiten, alle behoben).**
D12: `docs/openapi.yaml` (OpenAPI 3.1, 40 Pfade außerhalb von MCP), `tests/openapi.test.ts` (Pfade in beide
Richtungen gegen den Quelltext, jeder `$ref` löst auf — nicht Methoden oder Statuscodes), `docs/INTEGRATION.md` §7
(gemessene Dauern mit Quelle, Budgets). D13: Entwurf `deploy/helm/wlo-mcp/` (eine Replik, `Recreate`, PVC, zwei
Services, Proben nur auf `/health`, Secrets aus bestehendem Secret, optional Ingress/ServiceMonitor/PrometheusRule/
NetworkPolicy), `docs/STECKBRIEF.md`, `tests/helm-chart.test.ts`; `helm lint` ohne Fehler, auf keinem Cluster
installiert, PromQL nicht gegen ein Prometheus ausgewertet. Aus dem Review: vier nicht definierte `$ref`s; die
NetworkPolicy war standardmäßig AN mit geratenen Namespaces (hätte nach der Installation allen Verkehr gesperrt) —
jetzt aus, Namespaces Pflicht; `TRUST_PROXY` hinter einem Ingress, der nur eine Knotenadresse sieht, legt alle
Nutzer in einen Budget-Topf (dokumentiert, aus dem Code hergeleitet); Alarme, die das erste Ereignis nach einem
Neustart verpasst hätten. Das Messskript maß nach der Überarbeitung +1317 MB für die Upload-Slots (abgelehnte,
ungelesene Körper blieben im Speicher und wurden mitgezählt) — behoben, jetzt 127 MB gehalten → +129 MB.
3127 Tests, 3126 grün, 1 übersprungen.
**Offene Entscheidungen des Nutzers (unverändert):** Entscheide 1/2/4 (A-3, Ausgabeschemata, `WLO_PUBLIC_BASE_URL`
erzwingen); Staging-Vorgabe im Code streichen; Dienst-ID; Image-Registry; was das Log an IP/Benutzername/
Suchbegriff tragen darf; `mem_limit` 768 MB bei Stapel-Upload. **Nebenbefunde, nicht geändert:** `/api/wikipedia`
503 und `/ready` 503 ohne `Retry-After`; die No-CORS-Regel auf `/auth*` trifft auch die statischen Skripte.

**Log-Datenschutz, Dienst-ID, Vorgabe (2026-11-13, Nutzerentscheidungen).** Adresse, Kontoname und Suchbegriff
stehen im Log standardmäßig nur als Pseudonym (`src/log-privacy.ts`, Schlüssel-Hash je Prozesslauf);
`LOG_PERSONAL_DATA=plain` schreibt Klartext. Geprüft: nichts liest das Log zurück — Limiter, Zugangsliste und Caches
arbeiten mit den echten Werten im Speicher. Review (unabhängig, 10 Befunde, behoben): drei übersehene Stellen mit
Suchbegriff im Klartext (`browse.ts` Fach, Wikipedia-Titel, `/api/search/<Begriff>` im Fehlerpfad), Wächter
erweitert (ausbalancierter Aufruf-Scanner, mehr Feldnamen, Wert in der Meldung), Grenzen eines Pseudonyms in
PRIVACY.md benannt. Dienst-ID `wlo-mcp` für Paket und Image. Die Staging-Vorgabe im Code BLEIBT (ohne B-API gibt es
keine andere Quelle für die Adresse; Installationen ohne Variable würden nicht mehr starten) — dafür warnt der Start,
wenn die Variable fehlt. `WLO_PUBLIC_BASE_URL` bleibt bei der Startwarnung (Empfehlung: erst setzen, eine Version
warnen, dann erzwingen). A-3 und Ausgabeschemata: als neue Hauptversion mit Liste „alt → neu", noch nicht geplant.

**Nachtrag des Chatbot-Teams (Tempo) — Z1, Z2, Z5, B1, B2 umgesetzt (2026-11-13).** Z1: Schreiben nimmt einen
Vokabularwert nur per Name/Alias/URI; ein Teilwort-Treffer wird mit Kandidaten abgelehnt (`error.candidates`).
Z2: Vorschau nennt Art, Titel und Kennung; Inhaltstyp als Name. Z5: Vorschau des Anlegens nennt Datensätze unter
bereinigter Schreibweise der Adresse. B1: Fach/Stufe/Typ/Zielgruppe als Text oder Liste. B2:
`lookup_wlo_vocabulary("contentType")`. Befund beim Bauen: zwei Inhaltstyp-Namen („Suchmaschine",
„Stationenlernen") stehen für je zwei Konzepte und werden vom Schreiben abgelehnt — die Liste nennt dafür die URI.
3154 Tests, 3153 grün, 1 übersprungen; 15 Gegenproben rot. **Offen:** Z3 (Sammlung per Name an fünf Lesewerkzeugen),
Z4 (`search_wlo_content_many`), B1-Ergänzen (Frage an die Redaktion).

**Review Z1/Z2/Z5/B1/B2 (unabhängig, 9 Befunde + Alias-Liste, alle behoben, 2026-11-13):** Kandidaten sind jetzt
EINTRÄGE (jeder einmal, der geratene zuerst, dann Namen mit dem Wort als Ganzem); der Inhaltstyp liefert
`error.candidates` (bei mehrdeutigem Namen die URIs); kein menschliches Prüfurteil als Vorschlag; Werte dedupliziert;
ALLE abgelehnten Werte einer Liste werden gemeldet (`refused[]`); die Vorschau des Anlegens fragt die Adresse einmal
statt viermal; ein über einen Alias aufgelöster Wert wird in der Vorschau gesagt („Gymnasium" wird als
„Sekundarstufe II" geschrieben); rund 60 gängige Schreibweisen als Aliasse ergänzt (nicht: vorschule,
foerderschule, sonderschule — enthalten „schule"); Satzzeichen und Mehrfach-Leerzeichen um einen Namen stören nicht
mehr. 3175 Tests, 3174 grün, 1 übersprungen; Image-Starttest unter `wlo-mcp:smoke` bestanden.

**Nachtrag, zweite Hälfte — Z3, Z4, B1 und der Extraktionsdienst hinter dem B-API-Proxy (2026-11-13).**
Z3: Sammlung per Name an fünf Lesewerkzeugen (`services/collection-by-name.ts`, `tools/collection-arg.ts`); genau EIN
gleicher Titel wird genommen, sonst `ambiguous_collection` mit Kandidaten. **Gemessen gegen Staging (24 Titel):** die
erste, nach dem Review strenge Fassung löste nur 3 von 24 auf (9 eindeutige Treffer wegen vollen Suchfensters
abgelehnt); mit EINEM breiteren Prüflauf (Stichwort-Index 100, Namens-Index 50) 12 mit Fach und 9 ohne, kein
eindeutiger Treffer mehr abgelehnt, +0,7 s im Median. Für „kein gleicher Titel bei vollem Fenster" bringt der breitere
Lauf nichts (9 Fälle, 0 Funde) und läuft deshalb nicht. Z4: `search_wlo_content_many` (33 Lesewerkzeuge), Tempo
NICHT gemessen. B1 (Nutzerentscheidung): Ersetzen bleibt Standard, `addDiscipline`/`addEducationalContext`/
`addUserRole` ergänzen. `WLO_TEXT_EXTRACTION_API_KEY`: Schlüssel als `X-API-KEY` an den Extraktionsdienst hinter
dem B-API-Proxy, gegen keinen echten Proxy erprobt.
**Älterer Fehler, im Review gefunden und behoben:** ein streng prüfender MCP-Client verwarf jede codierte
Fehlerantwort eines Werkzeugs mit Ausgabeschema; die Schemata tragen jetzt einen Fehlerzweig (`anyOf`).
Drei unabhängige Reviews (26 Befunde), alle behoben. 3310 Tests, 3309 grün, 1 übersprungen.
**Offen:** einheitlicher Vertrag (A-3) als neue Hauptversion; Tempo von Z4 messen; ob jeder Host ein `anyOf` auf
oberster Ebene des Ausgabeschemas annimmt.

**Abschlussprüfungen nach dem Nachtrag (2026-11-13, Abend).**
- **Live-Tests gegen Staging: 16 von 16 grün.** Staging nimmt Inhalts-Uploads wieder an (der 500
  `InvalidTypeException` seit dem 6.11. ist weg): Datei ersetzen, Verknüpfen, Volltext ohne Datei laufen live.
- **Die seit dem 8.11. offene Messung ist beantwortet:** ein Volltext an einen Datensatz MIT Datei ERSETZT die Datei
  (zweimal gemessen: text/x-web-markdown 47 Bytes → text/plain 29 Bytes, anderer Hash; die frühere Datei liegt in der
  Versionsliste). `FULLTEXT_KEEPS_BINARY` bleibt `false` — als Regel, nicht mehr als Platzhalter. Der Live-Test hält
  das fest und wird rot, falls ein Repository die Datei künftig behält. Für W4 heißt das: Volltext an Datensätze mit
  Datei geht über `textContent` NICHT; dafür bräuchte es einen anderen Ablageort.
- **Z4 gemessen** (fünf Suchen zu Optik, Fach Physik, je fünf Treffer, drei Runden, Reihenfolge gewechselt):
  `search_wlo_content_many` 0,6–1,0 s gegen 1,3–2,9 s für fünf gleichzeitige Einzelsuchen. Ein Lauf, kleine Stichprobe.
- **Nebenbefunde behoben:** `/api/wikipedia` und `/ready` tragen bei 503 `Retry-After`.
- **CI:** GitHub startet den Job nicht („recent account payments have failed or your spending limit needs to be
  increased") — Sache des Kontos, nicht des Codes; erneutes Anstoßen ändert nichts. Lokal: voller Lauf, Lint,
  Typprüfung und Image-Starttest grün.
- **Jetzt messbar, noch nicht gemessen:** MA-0 für den Stapel-Upload (Dateiarten, Größen) — die Voraussetzung
  „Staging nimmt Uploads an" ist erfüllt.

**Messdurchgang Upload/Volltext, Host-Verträglichkeit (2026-11-13, spät).**
- **CI wieder grün:** das Repository ist öffentlich, der Lauf für `bcdcecb` ist nach erneutem Anstoßen durchgelaufen.
- **MA-0 gemessen** (`npm run measure:uploads`, Wegwerf-Datensätze, alle gelöscht): elf der fünfzehn angenommenen Dateiarten
  geprüft (nicht: gif, webp, ods, odp), jede wird mit dem von uns erkannten Typ gespeichert. Dauer klein 1,6–3,5 s · 1 MB 3,3 s · 10 MB 18 s · 50 MB 85 s
  (Frist 20 s + 2 s/MB reicht überall). Punkt 9 der Wunschliste ist damit von der Messung her frei.
- **`textContent` je Format** (deckt sich mit dem Team-Dokument vom 10.11.): Text bei txt, PDF mit Textebene, docx,
  xlsx (Blattname voran), odt; `{"text":null}` bei Markdown, Bildern, Audio, Video; zwei Zeilenumbrüche bei PDF ohne
  Textebene. Markdown bleibt `text/x-web-markdown` und ohne Text, gleich mit welchem Typ es gesendet wird — die
  offene Frage des Dokuments („kommt .md als octet-stream als Text an?") ist für Staging mit NEIN beantwortet.
  Unser handgebautes Minimal-pptx lieferte nichts; für echte PowerPoint-Dateien nicht aussagekräftig.
- **Daraus gebaut:** (1) öffentliche Markdown-Datei wird als ihr eigener Text gelesen (`fileTextFor`, vier
  Lesewege — Volltext-Werkzeug, Details, Suchtreffer, `fetch` —, eine Regel); privat bleibt `not_extracted`, weil kein Login die Bytes liest (erneut gemessen: 403/405).
  (2) `textContent` wird unter 4 MiB gelesen — eine 50-MB-Textdatei antwortete 52 Mio. Zeichen in EINEM JSON-Wert.
  (3) `{"text":null}` ist in der Suche „kein Text", nicht mehr „nicht lesbar".
- **Extraktionsdienst hinter dem B-API-Proxy: erprobt.** Route `/api/v1/proxy/text-extraction`, Schlüssel als
  `X-API-KEY`; 0,5 s (`simple`) / 1,3 s (`browser`); ohne Schlüssel 401. Der Dienstname stammt aus dem Team-Dokument.
- **OpenAI:** alle 52 Werkzeuge als Funktionen angenommen (Chat- und Responses-API, zwei Modelle, ~26 000 Tokens für
  die Liste); der gehostete MCP-Client listet und ruft den bereitgestellten Server. Statische Grenzen von OpenAI und
  Anthropic für alle Werkzeuge eingehalten. **Offen:** das `anyOf` der veröffentlichten Ausgabeschemata hat noch kein
  Host gesehen — der bereitgestellte Server ist ein älterer Stand (50 Werkzeuge). Nach dem nächsten Deploy:
  `node scripts/check-host-compat.mjs tools.json https://<server>/mcp`. Anthropic-API: kein Schlüssel vorhanden.
- **Weiter offen, braucht Entscheidung:** einheitlicher Vertrag (A-3) als neue Hauptversion; Alias
  „Gemeinschaftskunde → Politik".
- **Unabhängiges Review dazu: 0 kritisch, 0 groß, 8 klein, 6 Randnotizen — alle behoben**, je mit Gegenprobe: ein
  abgeschnittener Extrakt wird als Skill-Anleitung ganz verweigert; `charCountIsLowerBound` + „mindestens" im Satz;
  ein 200 ohne Textfeld ist auf allen Wegen „nicht lesbar"; das Rücklesen eines Volltexts zählt einen Schnitt als
  nicht lesbar; `fetch` folgt derselben Regel; Bytes mit Steuerzeichen werden nie als Text ausgegeben; kein
  Datei-Rückgriff bei verlinkten Datensätzen; ein Text, dem nur die schließende Klammer fehlt, gilt als ganz.

**Entschieden 2026-11-13 (Nutzer): der einheitliche Vertrag (A-3) und die Ausgabeschemata für die übrigen
Lesewerkzeuge werden NICHT umgesetzt.** Kein offener Punkt mehr. Gründe: niemand hat danach gefragt (der Punkt stammt
aus dem eigenen Audit, nicht aus den Rückmeldungen des Chatbot-Teams); was ein Client einheitlich braucht, ist es
bereits (Fehlercodes, Wartezeiten, „nicht gefunden / nicht erreichbar / abgelehnt"); Modelle lesen die Beschreibung je
Werkzeug; weitere Schemata nützen nur streng prüfenden Clients und vergrößern die Werkzeugliste (heute ~26 000 Tokens je
Anfrage). Wieder aufgreifen nur gezielt, wenn ein Abnehmer eine konkrete Uneinheitlichkeit als Hindernis meldet.
Der Alias „Gemeinschaftskunde → Politik" ist bestätigt; er war seit Z1 eingetragen (`src/vocabs.ts`).

**Antwort des Chatbot-Teams vom 2026-11-14 — alle acht Punkte umgesetzt.**
Sie haben die Arbeitskopie gelesen (Stand `8cbc051`), der Chatbot verträgt die sechs Verhaltensänderungen.
- **Punkt 1 (schwerster Befund, berechtigt):** eine abgelehnte Unterliste UNTERHALB des Startknotens galt seit D6 still
  als leer — vorher fälschlich „später erneut", danach gar nichts. Jetzt: `childrenRefused: true` am Baumknoten,
  `restricted: true` + `RESTRICTED_NOTICE` an den drei Listenantworten (Baumsuche von `search_wlo_collections`,
  `get_collection_contents` rekursiv, `search_skill`), in beiden Formaten.
- **Punkt 2:** die Ablehnung des INHALTS einer Untersammlung bricht den rekursiven Lauf nicht mehr ab; ausgelassen,
  gekennzeichnet, Rest geliefert. Startknoten bleibt Fehler, Ausfall (5xx) bleibt Ausfall.
- **Punkt 3:** `confirm.preview.notes[]` — dieselben Zeichenketten wie die ⚠-Zeilen, aus `previewReply`.
- **Punkt 4:** `error.reason` (`several`/`none`/`unverified`) an `ambiguous_collection`; der Wert hieß intern schon so.
- **Punkt 5:** `wlo_update_compendium` nennt die Sammlung in der ersten Zeile; `target.kind` bleibt `compendium`.
- **Kleinere:** `find_content_by_url` 404 → `not_found`; `previewUrl` an `search_wlo_content_many`; Absatz zum
  Python-SDK in `docs/INTEGRATION.md` §3.5. Die Größe der Werkzeugliste bleibt (bewusst, siehe Entscheidung zu A-3).
- Neue Tests: `refused-branch-is-said` (31), `chatbot-followup-1114` (8), `refused-branch-review` (15); jede Korrektur mit Gegenprobe rot gesehen.
- **Unabhängiges Review (0 kritisch, 2 groß, 5 klein, 3 Randnotizen) — behoben:** mit `includeContentCounts` /
  `includeContentPreview` (und immer in `get_collection_overview`) verschwand ein Knoten, dessen Inhalte abgelehnt
  wurden oder nicht antworteten, GANZ aus dem Baum (`mapPool` macht aus dem Wurf `null`) — jetzt bleibt er, mit
  `contentsRefused` / `contentsUnread`; `get_skill_for_task` kannte `restricted` nicht; „Keine Skills gefunden" stand
  über einer eingeschränkten Antwort; der Hinweis heißt „Ein Teil des durchsuchten Bereichs …"; der Skill-Durchlauf
  liest unterhalb einer Sammlung mit abgelehntem Inhalt weiter. Bewusst anders gelassen und benannt: Themenseiten
  (nicht lesbare Varianten = „keine Variante"). Nicht geändert, weil nichts Falsches gesagt wird: Geschwister in
  `get_related_content`, Zähler der Fachportal-Liste. 3372 Tests, 3371 grün, 1 übersprungen.
- Antwort ans Team mit den neuen Formen: `docs/plans/2026-11-14-antwort-an-chatbot-team-2.md`.
- **Zweites Review auf Wunsch des Nutzers (0 kritisch, 3 groß, 9 klein, 4 Randnotizen) — behoben.** Alle drei großen
  lagen in den KORREKTUREN nach dem ersten Review: `get_skill_for_task` setzte den Hinweis als eigenen ERSTEN Block,
  die Anleitung rutschte in Block 1 (ein Client, der nur Block 0 weiterreicht, verlor sie) — jetzt ein Block, Hinweis
  als erste Zeilen; `search_skill` hatte den bestehenden Fall „leer + nur unvollständig" verändert (Satz weg, Text
  begann mit Leerzeilen) — wiederhergestellt, Teile werden verbunden statt verkettet; das Suchergebnis-Widget zeigte
  über einer leeren `restricted`-Antwort „Keine Treffer gefunden." — beide Widgets kennen die Marken jetzt. Ferner:
  `contentsUnread`/`contentsRefused` nie zusammen und nie neben einer gelieferten Vorschau; ein fehlgeschlagener
  Inhaltsabruf im Baum wird geloggt; eine abgelehnte Skill-Wurzel beendet den Lauf sofort (vorher wurde der Unterbaum
  noch gelesen); `contentsUnread` auch in der Übersicht; Markdown-Hinweis von `get_collection_contents` im ersten
  Block. Nicht geändert: der Code `not_found` an `find_content_by_url` (vom Team so erbeten) — die Antwort ans Team
  sagt jetzt ausdrücklich, dass er dort NICHT „kein Datensatz" heißt. Die Wendung „mit dieser Anmeldung nicht
  lesbar" ist per Test festgeschrieben (Bitte des Teams, §7 ihrer Antwort).

**GitHub konsolidiert (2026-11-15).** `main` ist der einzige Zweig, keine offenen PRs. Zusammengeführt: `actions/checkout`
7.0.1, `actions/setup-node` 7.1.0 (von Hand, der Zweig hatte nach dem ersten Merge einen Konflikt), vier kleine
Entwicklungs-Updates (esbuild, globals, tsx, typescript-eslint). Geschlossen: Node 25 im Image, TypeScript 7 /
`@types/node` 26 (CI rot). `.github/dependabot.yml` nimmt Hauptversionen von `typescript`, `@types/node` und des
Node-Images seither aus. Der Hilfsklon für die Pushes liegt jetzt unter `<scratchpad>/sc-remote2`.

**Sammlung per Titel: Messung des Chatbot-Teams, zwei Befunde, behoben (2026-11-15).**
Ihre Messung an 24 Titeln: 13 mit Fach, 10 ohne aufgelöst, alle richtig. Beide Befunde aus EINER Regel („ein Treffer
ohne Fach wird durch ein Fach nicht ausgeschlossen"):
- Trägt genau EINE gleichnamige das verlangte Fach → sie wird genommen, die ohne Fachangabe stehen in `alsoFound`.
- Trägt KEINE das Fach → eine ohne Fachangabe wird nicht mehr genommen (`unverified` + `disciplineUnverified`).
- Dazu: Nachsuche mit Umlauten, `error.message` im JSON ohne Kandidatenzeilen, Zeilen mit Kennung zuerst und Titel
  zuletzt in Anführungszeichen, `oneLine` ersetzt auch U+0085/U+2028/U+2029, Satz an `find_content_by_url`.
- **Live gegen Staging bestätigt** (anonym, lesend): „Klimawandel" + Geografie → nicht genommen; „Mechanik" + Physik →
  genommen, Community-Sammlung genannt; „Saeuren und Basen" + Chemie → „Säuren und Basen", lose, gesagt.
- **Review (1 groß, 7 klein, 1 Randnotiz) behoben:** die Umlaut-Nachsuche vergaß ein volles Fenster der ERSTEN Suche
  und nahm so einen losen Treffer als einzigen; eine nicht beantwortete Nachsuche wird gesagt; `ue` nach q/a/e wird
  nicht umgeschrieben und Großschreibung bleibt; Pfad und Zahl stehen VOR dem Titel, dessen Anführungszeichen ersetzt
  werden; `alsoFoundTotal`; der Satz bei mehreren empfiehlt das Fach nicht mehr, wenn es schon genannt war.
  Mein eigener Fehler dabei: beim Umschreiben der Testdatei fünf bestehende Tests überschrieben — vom Lint gemeldet
  (ungenutzte Importe), aus dem gepushten Stand wiederhergestellt, Namensvergleich alt/neu gemacht.
- **Offen, als Beobachtung des Reviews gemeldet, NICHT geändert:** andere Zeilen, in denen ein Titel vor der Kennung
  steht (`Skill: <Titel> (nodeId: …)` in `registry-render.ts`, `find-by-url.ts`, `browse.ts`, `collection-overview.ts`,
  `node-details.ts`) und die Vorschauzeile `Datensatz: „Titel“ (id)`, deren schließendes Anführungszeichen ein Titel
  setzen kann. Das sind Formate, an denen Clients hängen — Entscheidung des Nutzers.

**Antwort des Chatbot-Teams vom 15.11. (§9) — umgesetzt (2026-11-15).**
Sie bestätigen beide Korrekturen an der Titel-Auflösung (24 Titel mit Fach: 13 aufgelöst, alle im genannten Fach).
- **Neuer Befund, behoben:** `search_wlo_content_many` meldete bei null Treffern `more: true`. Ursache genauer als von
  ihnen vermutet: die Rangsuche erklärt das Ende nicht, wenn EINE Abfragevariante fehlschlug; die Einzelsuche las
  deshalb zusätzlich ein leeres Fenster als Ende, die Mehrfachsuche nicht. Jetzt eine Regel (`windowWasLast`).
- **Zeilen mit Titel vor der Kennung umgestellt**, nachdem das Team genannt hat, welche Zeilen es wörtlich auswertet
  (diese nicht): Skill-Registry-Kopf und -Einträge, Baumzeile, `find_content_by_url`, Übersicht, Eltern-Sammlungen.
  Eine Hilfsfunktion (`quotedTitle`, `text-line.ts`).
- **Festgeschrieben** (`tests/line-forms.test.ts`): die Formen, an denen der Chatbot hängt. NICHT geändert: die
  Vorschauzeile `Datensatz: „Titel“ (id)` (daran erkennt ihr Client, dass wir das Ziel schon nennen).
- **Für das Team:** ihr Rückfall-Muster für Suchantworten („Gesamt:" / „Treffer:" / „Gefunden:") trifft keine unserer
  Zeilen — sie lautet „Gefundene Treffer gesamt: N, zeige M".
- **Offen beim Nutzer (aus ihrer Liste):** Termin für das Deploy auf Staging; Versionsnummer; Image-Registry.
- **Review dazu (0 kritisch, 1 groß, 6 klein, 6 Randnotizen) — behoben.** Der große Befund betraf MEINE Korrektur:
  ein leeres Fenster mit einer FEHLGESCHLAGENEN Variante galt danach als Ende, also „keine Treffer" über einer
  Variante, die niemand gelesen hat — so falsch wie vorher „es gibt weitere", nur andersherum (und die Einzelsuche
  sagte dort schon immer „Keine Inhalte gefunden"). Jetzt meldet die Rangsuche `incomplete`, und das steht auf jeder
  Oberfläche einer Inhaltssuche: beide Werkzeuge in beiden Formaten, `search_wlo_all`, HTML-Seite, Widget; der Satz
  trägt die Wendung „hat nicht (vollständig) geantwortet". Ferner: `quotedTitle` ersetzt weitere Anführungszeichen
  und nimmt unsichtbare Titel als keinen; die „Nicht abrufbar"-Zeile der Skill-Beschreibungen und die Hinweiszeilen
  im Baum folgen derselben Regel; `nodeIdLine` statt handgebauter Zeile; ein Test, der seit der Umstellung leer
  grün war (`startsWith('Skill-Registry:')`), prüft wieder etwas; die Wort-für-Wort-Formen sind als CODE
  festgeschrieben, nicht als Teilstring, den auch ein Kommentar erfüllt.
  Nicht geändert: `<Titel> (nodeId: …)` in `get_skill_registry`/`get_skill` (daran hängt der Chatbot) und die
  Auswahl-Nachricht des Such-Widgets (eigene Bereinigung, eigener Vertrag).

**Sammlungsstrukturen (Wünsche S1–S10 des Chatbot-Teams, 2026-11-14)** — Plan:
`docs/plans/2026-11-14-sammlungsstrukturen.md`. Vier Pakete, alles additiv.
- **P1 lesen (S1 Lesen, S2) — umgesetzt (2026-11-14).** `order: "title" | "stored"` an `browse_collection_tree` und
  `get_collection_overview` (Vorgabe unverändert `title`); neues Lesewerkzeug `list_collection_tree` (Teilbaum als
  flache Liste mit Pfad, Tiefe 4, Seiten zu 250). Eigene Messung `npm run measure:order`: beide Kinder-Listen
  ignorieren eine gesetzte Reihenfolge, solange man nicht mit `sortProperties=ccm:collection_ordered_position` fragt;
  mit dem Parameter steht ein Kind ohne Position hinter denen mit Position, in Anlege-Reihenfolge.
  Live (Staging, anonym, Fachportal Physik): gespeicherte Reihenfolge kommt an, Seiten zu 7 ergeben exakt die ganze
  Liste, 144 Sammlungen über vier Ebenen in 6,4 s, 20 Inhaltszahlen in 1,8 s. 34 Lesewerkzeuge, 53 insgesamt.
- **Review zu P1 (0 kritisch, 1 groß, 6 klein, 4 Randnotizen) — behoben.** Groß: ein anonymer Aufruf konnte mit
  `skipCount` 2000 rund 2 000 Abfragen auslösen, und jede Seite begann den Lauf neu. Jetzt höchstens 400 Abfragen je
  Aufruf (`FLAT_TREE_LISTINGS_MAX`, per Test gezählt), `skipCount` bis 500, und ein Lauf, der dort endet, sagt
  `walkCapped` — er endet GANZ, statt eine Ebene tiefer weiterzugehen, weil sonst ein Loch in der Liste entstünde.
  Klein: Startknoten, der keine Sammlung ist, wird als `not_a_collection` abgelehnt (vorher „keine
  Untersammlungen" über einem Datensatz); die Beschreibung von `browse_collection_tree` behauptete weiter
  „alphabetisch"; README nannte Tiefe 1–2; fehlende Inhaltszahlen stehen nur am Eintrag, und das steht jetzt in der
  Beschreibung; das Blätter-Versprechen gilt nicht, solange `incomplete` gesetzt ist. Neun Tests ergänzt (spätere
  Seite eines Elternknotens fällt aus, Zyklus, Schnitt in gespeicherter Reihenfolge, Abfragezahl …).
- **P2 vom Upload bis zum Einreichen (S4, S3) — umgesetzt (2026-11-14).** `wlo_submit_contents` (Plan wie
  `wlo_add_to_collections`; schon Eingereichtes ist `already`, geprüft für die Vorschau UND unmittelbar vor dem
  Schreiben; eine abgebrochene Einreichung, die ankam, ist `submitted` und nicht „already"). Eigener Befund beim
  Schreiben der Tests: ein Test „ohne Anmeldung wird abgelehnt" war leer grün (falsche Signatur des Helfers, vom
  Typprüfer gemeldet). `wlo_create_collection_tree` nimmt je Knoten `discipline`, `educationalContext`, `keywords`
  und `shared` für den Baum. Live (Staging, Wegwerf-Sammlungen, `tests/live/collection-structure.test.ts`): eine
  neue Sammlung behält alle drei Felder; die gesetzte Reihenfolge wird nur mit dem Sortierparameter geliefert.
  Das Einreichen selbst ist NICHT neu live gemessen: der Stapel nutzt denselben Aufruf wie das Einzelwerkzeug
  (gemessen, Forschungsdokument §10), und ein Testlauf legte Wegwerf-Datensätze in die Warteschlange der Redaktion.
  34 Lesewerkzeuge, 20 Kuratier-Werkzeuge, 54 insgesamt (58 mit Stapel-Ablage).
