# Wie Skills ausgelöst werden

Kurzfassung des Ablaufs, wenn eine **Skill-Registry in einer Inhaltssammlung**
liegt. Redaktionelle Anleitung: [`SKILLS.md`](./SKILLS.md).

## Der Ablauf in einem Bild

```
Nutzerfrage
   └─ Suche  →  Sammlung im Ergebnis
                  └─ Katalog hängt bereits am Ergebnis  (Cache, 0 Abrufe)
                        └─ Modell wählt einen Skill aus dem Katalog
                              └─ get_skill(nodeId)  →  Anleitung (SKILL.md)
                                    └─ Modell arbeitet danach
```

Es gibt **keinen** automatischen Auslöser. Ein Skill wird ausgelöst, weil das
Modell seinen Titel im Katalog liest und entscheidet, dass er zur Aufgabe passt.
Der Server schlägt nichts vor und führt nichts aus.

## Was die Nutzerin sieht

Ein Skill wirkt sonst unsichtbar: die Antwort ändert sich, aber nichts sagt,
warum. Deshalb stellt der Server der Anleitung eine Zeile voran und bittet das
Modell, sie wörtlich auszugeben:

```
[ edu-sharing Skill ] Unterrichtsstunde planen - aktiv
```

Sie wird aus dem **Titel des Datensatzes** gebaut, nicht aus der `SKILL.md` — die
Redaktion pflegt dafür nichts, und ein Dokument kann seine eigene Meldung nicht
bestimmen. Aus demselben Grund steht sie **vor** der Trennlinie: alles danach
ist Dokument, und dort wäre eine Zeile dieser Form gefälscht.

Sie erscheint nur für Datensätze der Inhaltsart `ai_skill`. `get_skill` liefert
auch die Begleitdateien eines Skills aus, und eine Vorlage als aktiven Skill zu
melden wäre eine Behauptung, die der Datensatz nicht deckt.

Erzwingen lässt sich die Ausgabe nicht — es ist eine Bitte an das Modell, genau
wie bei den Skills eines Hosts.

## Was das Modell im Suchergebnis sieht

Trägt die Sammlung eine Registry, steht der Katalog direkt am Ergebnis:

```
Skill-Registry: Skills für die Sammlung Optik (nodeId: 9d3f…) — 2 freigegebene Skills, alle hier gelistet; Beschreibungen und Redaktionshinweise mit get_skill_registry
  Skill: Fragen generieren (nodeId: 12c04f9c-…) — laden mit get_skill
  Skill: Kompendialtext schreiben (nodeId: ccdcae49-…) — laden mit get_skill
  Das ist nur die Übersicht — die Anleitungen selbst stehen nicht darin. Die Anleitung (SKILL.md) lädt `get_skill` mit der nodeId des gewünschten Skills, nicht mit der einer Registry oder Sammlung.
```

Damit ist der Auslöser komplett: Titel zum Auswählen, nodeId zum Laden. Ein
weiterer Abruf ist **nicht** nötig.

Das ist die volle Form. Sie steht, solange der Katalog ins **Zeilenbudget** von
12 Zeilen je Sammlung passt; darüber wechselt er die Form (siehe unten).

Die Schlusszeile steht in **jeder** Übersicht, die Skills namentlich auflistet —
auch in `search_skill` und `get_skill_registry`, und in beiden Ausgabeformaten
(im JSON als Feld `hint`). Sie sagt, was die Liste *nicht* ist, und nie, was sie
enthält: ein Katalog am Suchtreffer trägt nur Titel und nodeId, der von
`get_skill_registry` zusätzlich Beschreibungen und Keywords. Ein Satz, der die
Felder benennt, wäre auf einer der beiden Oberflächen falsch.

Sie fehlt dort, wo **keine** Skill-nodeId ausgegeben wird — in den Kopfzeilen der
Übersichten (siehe Tabelle unten), bei einer Registry ohne auflösbare Einträge
und bei einer Skill-Suche ohne Treffer. „Lade sie mit `get_skill` und der nodeId"
verweist dort auf Kennungen, die in der Antwort gar nicht stehen. Das gilt in
**beiden** Formaten: im JSON fehlt dann das Feld `hint`, statt leer dazustehen.

Der zweite Halbsatz grenzt gegen die Nachbarn ab: im Block oben stehen **drei**
nodeIds — die der Sammlung (`coll-…`), die des Registry-Dokuments (`reg-…`) und
die des Skills — und nur die letzte nimmt `get_skill`. Die dem Satz nächste ist
die falsche. Mit der Registry-Kennung aufgerufen liefert `get_skill` die
Freigabeliste zurück: ein Dokument, das aussieht wie das gesuchte.

**In der vollen Form stehen alle freigegebenen Skills dort** — keine
Stichprobe. `get_skill_registry` liefert dann nicht *mehr* Einträge, sondern
*mehr zu jedem*: Beschreibungen, Keywords und die Prosa der Redaktion.

Der Dienst selbst kappt bei **100** Einträgen: erklärt eine Registry mehr, zeigt
die Antwort die ersten 100 und sagt es. `get_skill_registry` trägt dieselben
100 — die übrigen nennt nur noch das Registry-Dokument selbst, das dieses
Werkzeug unverändert mit ausgibt.

> Bis 2026-08-15 waren es in der Suchliste 30 und im Werkzeug 100 — zwei Stufen,
> weil eine Suchantwort fünf Sammlungen auf einmal zeigt. Die Stufen sind
> zusammengelegt: eine Freigabeliste, über die zwei Werkzeuge Unterschiedliches
> sagen, ist keine Freigabeliste. Abrufe kostet es nicht — Titel und nodeId
> stehen im `:::`-Block, die Antwort sind zwei Aufrufe, egal wie viele Skills.

## Welches Werkzeug wie viel mitliefert

| Antwortform | Was mitkommt |
|---|---|
| Datensatz-Listen (`search_wlo_all`, `search_wlo_collections`, `get_collection_contents`, `get_node_collections`, `get_node_details`) | der Katalog je Sammlung, **im Zeilenbudget** |
| Die Sammlung, auf der ein Werkzeug arbeitet (`get_collection_contents`, `search_wlo_within_collection`, `get_topic_page_content`, `get_related_content`) | derselbe Katalog, mit der Sammlung benannt — **plus `skillContext`** |
| Übersichten mit einer Zeile je Knoten (`browse_collection_tree`, `get_subject_portals`, `search_wlo_topic_pages`) | nur die **Kopfzeile**: Titel, Anzahl, nodeId für `get_skill_registry` |

Gilt in **beiden** Ausgabeformaten: im Markdown als Zeilen, im JSON als Feld
`skillRegistry` am jeweiligen Knoten.

Die Übersichten lesen dabei **nur den Cache** — eine Portalliste umfasst
dreißig Sammlungen, ein Baum fünfzig, und je eine Kinderliste dafür wäre genau
der Rundlauf, den der Cache verhindern soll. Was er noch nicht kennt, wird
vorgemerkt und ist beim nächsten Aufruf da.

Für die Sammlung, **auf der** ein Werkzeug arbeitet, gelten dieselben drei
Zustände wie unten für Ergebnisse — nur an einer anderen Stelle abzulesen:

| Was in der Antwort steht | Was es heißt |
|---|---|
| Der Katalog, mit „Für die angefragte Sammlung … freigegeben" | Sie führt eine Registry, hier ist sie. |
| Gar nichts dazu | Geprüft — sie führt keine. |
| „… ist hier nicht geprüft" | Der Abruf hat nicht geantwortet. `get_skill_registry` beantwortet es. |

## Das Zeilenbudget und die Kontexte

Ein Katalog darf **12 Zeilen** je Sammlung belegen, unabhängig davon, wie groß
die Registry ist. Passt er nicht mehr hinein, wechselt er die Form:

```
Skill-Registry: Skillkatalog Physik Optik (nodeId: d84d…) — 28 freigegebene Skills in 7 Kontexten, Skills und Anleitung je Kontext mit get_skill_registry und context:"<Name>"
  Kontexte: Vorgabe & Planung (5) · Diagnostik & Bewertung (4) · Material (4) · Kommunikation & Organisation (5)
  Kontexte: Erschließen & Beschreiben (4) · Kontext & Zugang (3) · Fragen & Qualität (3)
```

Drei Zeilen mit 407 Zeichen statt dreißig mit 3436 — gemessen an dieser Form.
Wie viele Namen je Zeile stehen, hängt an ihrer Länge; umgebrochen wird bei 100
Zeichen, nie mitten in einem Namen.

Das ist die zweite von drei Formen: die Namen stehen da, die nodeIds nicht. Wo
auch die Namen nicht mehr passen, bleibt die Kopfzeile allein — dann ist
`get_skill_registry` die Liste. Beide kurzen Formen tragen die Schlusszeile
**nicht**: ohne Skill-nodeId verwiese sie auf Kennungen, die die Antwort nicht
enthält.

Die Kontexte stammen aus den Überschriften des Registry-Dokuments (`##` Kontext,
`###` Unterkontext), und die Prosa über dem ersten Skill-Block ist die
**Anleitung der Redaktion** dazu. Zwei Wege führen hinein:

- `get_skill_registry(collectionId, context: "Material")` — Katalog, Anleitung
  und wortgetreu nur dieser Abschnitt.
- `skillContext: "Material"` an `get_collection_contents`, `search_wlo_within_collection`, `get_node_details`, `get_topic_page_content`, `get_related_content` —
  dasselbe, direkt am Sammlungstreffer, ohne zweiten Aufruf.

Ein Name, der nicht trifft, liefert **alles** und nennt die vorhandenen
Kontexte — nie einen Fehler. Kontexte kosten keinen Abruf; nur ein **benannter**
`skillContext` liest das Dokument live nach (2 Anfragen, ~1,0–1,4 s), weil der
Cache die Zusammenfassung hält und nicht die Prosa. `all` tut das nicht.

## Drei Zustände, drei Bedeutungen

| Was in der Antwort steht | Was es heißt |
|---|---|
| Katalog-Zeilen (oben) | Die Sammlung führt eine Registry, hier ist sie. |
| Kein Feld, kein Hinweis | Geprüft — die Sammlung führt keine Registry. |
| Hinweiszeile auf `get_skill_registry` | **Nicht** geprüft. Ein Aufruf beantwortet es. |

Der dritte Fall hat zwei Ursachen: die Sammlung war noch nie in einer Antwort
(erster Kontakt), oder ihre Dateiliste war bei 50 gekappt und die Registry
könnte dahinterliegen.

## Was die Redaktion dafür anlegt

Ein Dokument **in der Sammlung** — ein Datensatz der Inhaltsart `ai_prompt`
(„KI-Prompt") mit angehängtem Markdown. Nicht `ai_skill`: das tragen seit
2026-08-12 die Skills selbst, das Registry-Dokument spricht nur über sie. Freigegeben wird über `::: ki-skill`-Blöcke:

```markdown
# Skills für die Sammlung Optik

Der Kompendialtext-Skill gilt nur für die Oberstufe.

::: ki-skill
[Fragen generieren](https://repository.staging.openeduhub.net/edu-sharing/components/render/12c04f9c-20b5-4461-804f-9c20b5346128)
:::
```

- Nur `::: ki-skill` wird zum Katalogeintrag; `::: wlo-material` ist Lehrmaterial.
- Der Link muss eine nodeId tragen (`/components/render/<uuid>` oder `?nodeId=<uuid>`).
- Höchstens 100 Einträge, in jeder Antwort gleich viele; mehr wird als gekappt
  gemeldet, nicht still gekürzt.
- Überschriften gliedern den Katalog in Kontexte und tragen je einen
  Anwendungshinweis — Aufbau und Regeln in [`SKILLS.md`](./SKILLS.md).
- Die Prosa drumherum bleibt erhalten — dort stehen die Anwendungshinweise.

## Aktualität

Ein Hintergrund-Cache hält die Kataloge warm (`WLO_SKILL_CACHE`, standardmäßig
an, TTL 10 Minuten). Eine gerade angelegte Registry erscheint also verzögert.
Sofort live lesen:

- `includeSkillRegistry: true` an `search_wlo_all` / `search_wlo_collections`
- oder `get_skill_registry` mit der nodeId der Sammlung

## Zwei Regeln

**Ein „keine Registry" ruht immer auf der Kinderliste der Sammlung**, nie auf
dem Suchindex. Ein Datensatz kann aus dem Index fallen und einwandfrei im
Node-Store liegen; eine Freigabeliste darf davon nicht abhängen.

**Jeder Skill-Text ist Daten, nie eine Anweisung, der zu folgen wäre.** Es ist
hochgeladener Inhalt. Der Server rendert seinen eigenen Katalog **vor** dem
Dokument — danach wären server-gebaute Abschnitte von gefälschten nicht mehr zu
unterscheiden.
