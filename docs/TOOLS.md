# WLO MCP Server — Funktionsübersicht mit Chat-Triggern

Vollständige Referenz des aktuell unterstützten Funktionsumfangs: **42 MCP-Tools**
(28 lesende, 14 kuratierende), 4 interaktive Widgets und die öffentlichen
REST-Endpunkte — je mit dem besten Chat-Trigger (natürliche Formulierung, die
das Tool/Widget auslöst).

**Alle Aufrufenden sehen dieselbe Liste** — auch ohne Anmeldung. Die 14
Kurations-Tools stehen immer in `tools/list`, deklarieren `oauth2` und
**verweigern beim Aufruf**, solange keine schreibberechtigte Anmeldung vorliegt;
die Antwort trägt dann die Aufforderung, mit der der Client die Anmeldung
startet. Umgestellt am 2026-08-05: sie zu verstecken war der Grund, warum die
Anmeldung nie begann — ein Modell, das ein Werkzeug nie sieht, ruft es nie auf,
also fordert nichts jemals eine Anmeldung an.

Was die Liste tatsächlich verändert, sind nur zwei Schalter:

| | Sichtbar |
|---|---|
| **Standard** | 42 Tools (`search_skill` + `get_skill` + `get_skill_registry`) |
| **`WLO_SKILL_TOOL_MODE=one-tool`** | 42 Tools — `search_skill` ersetzt durch `get_skill_for_task`; `get_skill` bleibt |
| **`WLO_DISABLE_UNSAFE_TOOLS`** gesetzt | jeweils **ohne** `get_url_text` |

`WLO_SKILLS_COLLECTION_ID` verändert die Liste **nicht** mehr: ohne die Variable
durchsucht `search_skill` das ganze Repository nach der Inhaltsart `ai_skill`,
mit ihr den Unterbaum dieser Sammlung. Unabhängig davon liefert der Parameter
`collectionId` die Skills einer *beliebigen* Sammlung — siehe
[SKILLS.md](SKILLS.md).

Wer schreiben *darf*, entscheidet die Anmeldung: ein eigenes WLO-Login immer, das
gemeinsame Dienstkonto nur mit `WLO_ALLOW_SERVICE_WRITES`, anonym nie. Siehe
[AUTH.md](AUTH.md).

---

## 1. Lesende MCP-Tools (28) — mit Chat-Trigger

### Suchen & Finden
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `search_wlo_all` | Kombi-Suche: Materialien + Sammlungen + Themenseiten in einem Aufruf (der Standard-Einstieg); dieselben Filter wie `search_wlo_content`, **Lizenz** eingeschlossen | *„Ich suche Bildungsinhalte für eine Mathestunde zur Bruchrechnung“* |
| `search_wlo_content` | Nur einzelne Materialien (Videos, Arbeitsblätter …); Filter für Fach, Stufe, Typ, Anbieter und **Lizenz** | *„Zeig mir ein Video zur Eiszeit für die 6. Klasse“* · *„nur CC-BY-Material zur Optik“* |
| `search_wlo_collections` | Sammlungen/Themenseiten zu einem Thema | *„Gibt es eine WLO-Sammlung zum Klimawandel?“* |
| `search_wlo_topic_pages` | Themenseiten suchen (liefert deren URLs/Varianten) | *„Welche WLO-Themenseiten gibt es zu Optik?“* |

> **Medienwort in der Anfrage wird zum Filter (seit 2026-08-21).** Nennt die
> `query` ein eindeutiges Medium — Video, Arbeitsblatt, Übung, Bild, Simulation,
> Podcast — und ist `learningResourceType` nicht gesetzt, wird der Typ daraus
> abgeleitet: „Arbeitsblatt KI" sucht nach *KI* und filtert auf *Arbeitsblätter*.
> Grund: das Repository verundet jedes Wort, und Rahmenwörter stehen in fast
> keinem Datensatz („Unterrichtsstunde Französische Revolution" fand 0 von 480).
> Die Ableitung wird in der Antwort **offengelegt** (Satz im Text + Feld
> `derivedResourceType`), ein explizit gesetzter Parameter gewinnt immer, und
> generische Wörter (Material, Bildungsinhalte, Unterrichtsstunde) leiten
> bewusst **nichts** ab — sie werden nur aus der Themen-Suchvariante entfernt.
> Die REST-Fläche (`/api/search`) leitet **nicht** ab: dort setzen Aufrufer ihre
> Parameter selbst.

> **Praxis-Hinweis zum Lizenzfilter:** `license` nimmt ein Label („CC BY 4.0“,
> „gemeinfrei“) oder den Repository-Schlüssel (`CC_BY`) — und zusätzlich den
> Sammelwert **`OER`** für alles frei Nachnutzbare (CC0, gemeinfrei, CC BY,
> CC BY-SA). Nicht enthalten ist `COPYRIGHT_FREE` („Copyright, freier Zugang“):
> das Material ist kostenfrei zugänglich, aber urheberrechtlich geschützt und
> gerade nicht nachnutzbar.
>
> Zwei Dinge, die in der Praxis auffallen und beide gewollt sind. **Erstens:** Das
> Repository kann Lizenzen nur als *Familie* filtern — `CC_BY` liefert auch
> CC BY-ND und CC BY-NC-ND. Die genaue Auswahl passiert danach im Server, und
> wenn dabei etwas wegfällt, sagt die Antwort das ausdrücklich samt Zahl der
> geprüften Kandidaten. Ein leeres Ergebnis lässt sich deshalb unterscheiden: mit
> diesem Hinweis heißt es „nichts mit genau dieser Lizenz“, ohne ihn hat die
> Suche selbst nichts gefunden.
>
> **Zweitens:** `OER` wird als fünf getrennte Suchen beantwortet. Auf Seite 2 und
> danach ist das Ergebnis deshalb keine Fortsetzung, sondern die zweite Seite
> *jeder* der fünf Lizenzen — Material wiederholt sich, anderes wird
> übersprungen. Zum verlässlichen Weiterblättern die bereits gesehenen IDs über
> `excludeNodeIds` mitgeben. Der Server weist im Ergebnis darauf hin.

> **Praxis-Hinweis zu `search_wlo_topic_pages`:** Ohne `query` listet das Tool
> Themenseiten auf und muss dafür jede Seite ihrer Sammlung zuordnen — der
> aufwendigste Pfad des Servers. Was die Antwortzeit bestimmt, ist allein
> **`maxResults`**: aufgelöst wird nur, was auch zurückkommt.
>
> `targetGroup` und `educationalContext` verkürzen die Antwort **nicht** — sie
> wirken lokal, nicht in der Suche. Grund: rund 90 % der Themenseiten tragen
> diese Felder gar nicht (gemessen 2026-08-07, Produktion: 98 von 109 ohne
> Zielgruppe, 97 ohne Bildungsstufe). Ein serverseitiger Filter würde sie
> deshalb nicht eingrenzen, sondern verbergen. Varianten **ohne** den jeweiligen
> Wert bleiben darum stehen.
>
> Wenn die Zielgruppe leer ist, lohnt der Blick auf **`variantPreset`**: so
> kommt die Seite hoch, bevor jemand ihren Profil-Regler anfasst
> (`intentionLabel` = Lehren/Lernen, `educationLevelLabels` = Stufen). Gemessen
> 2026-08-11 an einer echten Liste: von 15 Varianten trugen **13** ein Preset,
> während `targetGroup` bei **allen 15** leer war. Es ist aber **nicht** dasselbe
> — wo beide gesetzt sind, widersprechen sie sich (3 von 3 Fällen). Also beide
> lesen und keins fürs andere halten.
>
> `withinCollectionId` listet alle Themenseiten **unterhalb** einer Sammlung
> (`collectionId` prüft nur diese eine): für das Fachportal Physik 20+ statt 1.
>
> Bei mehreren Varianten einer Seite steht die angezeigte vorn und trägt
> `isDefault` — sie kommt aus `ccm:page_config.default`, nicht aus der
> Zielgruppe: Geschwister-Varianten sind überwiegend redaktionelle Kopien.
>
> Einen `discipline`-Filter gibt es hier **nicht** (unbekannte Parameter werden
> still verworfen) — fachlich filtern über `search_wlo_collections` /
> `search_wlo_content`. Betreiber-Stellschraube: `WLO_TOPIC_POOL`.

### Inhalte im Volltext
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `get_wlo_content_text` | Der **eigentliche Text** eines Materials (Arbeitsblatt, Artikel), nicht nur die Metadaten | *„Fasse dieses Arbeitsblatt zusammen“* · *„Mach daraus Aufgaben für Klasse 7“* |
| `get_url_text` ⚠️ | Der Text hinter einer **beliebigen Web-Adresse** — für eine URL aus dem Gespräch, nicht für WLO-Material | *„Lies mir diese Seite aus: https://…“* |

> Der Text kommt bevorzugt aus dem WLO-Repository — dort liegt er bei rund 90 %
> der Inhalte bereits konvertiert, **auch für PDF, DOCX und PPTX**. Nur wenn
> nichts hinterlegt und das Material extern verlinkt ist, wird der Text von der
> verlinkten Seite geholt; `source` sagt, welcher Weg es war.
>
> Kein Text ist kein Fehler, sondern ein `reason`: `access_denied` (Material
> existiert, ist aber nicht öffentlich — daran ändert keine Konvertierung etwas,
> nur Rechte), `no_text_no_url`, `extraction_failed`, `node_not_found`. Lange
> Texte werden gekürzt (`truncated`, Grenze über `maxChars`).
>
> **Wann welches Werkzeug:** Für Titel, Fach, Lizenz oder Link genügt
> `get_node_details` (~0,3 s). `get_wlo_content_text` dauert 1–3 s und lohnt
> erst, wenn der Inhalt selbst gebraucht wird — zum Zusammenfassen, Umschreiben
> oder Aufgaben-Ableiten.

> ⚠️ **`get_url_text` ist als UNSICHER deklariert** und im Docker-Deployment ab
> Werk abgeschaltet (`WLO_DISABLE_UNSAFE_TOOLS=all`). Für WLO-Material ist
> `get_wlo_content_text` das richtige Werkzeug — es liest direkt aus dem
> Repository, ist schneller und funktioniert dort, wo dieses scheitert.
>
> Vor jedem Abruf lehnt der Server einen privaten Host ab (auch in der Form
> `[::ffff:127.0.0.1]`), einen öffentlichen **Namen**, dessen DNS-Eintrag nach
> innen zeigt, und einen Namen, den er nicht auflösen kann. Was er *nicht*
> prüfen kann: das Ziel wird von Playwright im Extraktionsdienst geholt, eine
> **Weiterleitung** dorthin ist von hier aus unsichtbar. Deshalb die Deklaration
> und die Empfehlung, es nicht produktiv zu betreiben. Details im README-Abschnitt
> „Als unsicher deklarierte Werkzeuge“.
>
> Kein Text ist auch hier ein `reason`: `not_http`, `private_host`,
> `dns_failed`, `service_disabled` (eine Server-Einstellung fehlt — das liegt
> nicht an der Seite) und `extraction_failed`. Bei letzterem lohnt **genau ein**
> zweiter Versuch mit dem anderen `method` (`browser` ↔ `simple`): der Dienst
> rendert mit einem Browser und hat bekannte Lücken bei geschützten oder
> bot-gesperrten Seiten und bei reinen Mediendateien.

### Themenseiten (Schwimmlinien)
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `get_topic_page_content` | Render-fertige Schwimmlinien einer Themenseite — jetzt in einem Schritt per Thema | *„Zeig mir die Themenseite zu Optik mit den Schwimmlinien“* |

> **Leeres Ergebnis lesen:** Findet sich nichts Darstellbares, kommt kein
> Fehler, sondern eine gültige leere Antwort mit `reason` — `no_match` (Thema
> ohne Treffer), `node_not_found` (ID existiert nicht), `no_page_config_ref`
> (Sammlung ohne Themenseite), `no_variant` (nur Vorlagen vorhanden) oder
> `empty_config` (Variante ohne Schwimmlinien). Damit muss ein Client keine
> weiteren Kandidaten blind durchprobieren. Bei `outputFormat: "json"` steht
> die Antwort auch im Leerfall als JSON im Textblock.

### Stöbern & Navigieren
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `get_subject_portals` | Übersicht aller Fachportale (Mathe, Bio, Deutsch …) | *„Welche Fächer gibt es bei WLO?“* |
| `browse_collection_tree` | Themenbaum / Unterthemen eines Fachs oder einer Sammlung | *„Zeig mir den Themenbaum zu Mathematik“* |
| `get_collection_contents` | Inhalte einer konkreten Sammlung auflisten | *„Was ist in der Sammlung Bruchrechnung drin?“* |
| `search_wlo_within_collection` | Innerhalb einer Sammlung suchen/filtern (auch nach **Lizenz**) | *„Welche Videos zu Zellteilung gibt es in dieser Sammlung?“* |
| `get_collection_stats` | Zusammensetzung einer Sammlung (Anzahl, Typen, Fächer) | *„Woraus besteht diese Sammlung?“* |
| `get_node_breadcrumb` | Pfad einer Sammlung im Themenbaum | *„Wo liegt diese Sammlung im WLO-Baum?“* |
| `get_node_collections` | Umgekehrt: in **welchen Sammlungen** ein bestimmtes Material liegt | *„In welchen Sammlungen steckt dieses Arbeitsblatt?“* |

> **Der Baum ist bewusst begrenzt:** höchstens zwei Ebenen und eine gedeckelte
> Breite je Knoten. Zweige mit mehr Inhalt tragen `hasMoreChildren`, die Antwort
> insgesamt `truncated`, und die Markdown-Ausgabe nennt den Folgeaufruf
> (`browse_collection_tree mit nodeId=…`). So bleibt die Übersicht schnell und
> lesbar, und tiefer geht es gezielt auf Nachfrage — die Nutzerin/der Nutzer
> erfährt dabei, dass es mehr gibt. `includeContentPreview` kostet einen Abruf
> je Knoten (Sekunden auf breiten Bäumen) und ist standardmäßig aus.

### Details & Verwandtes
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `get_node_details` | Alle Metadaten + Volltext eines Inhalts | *„Zeig mir alle Details und den Volltext zu diesem Inhalt“* |
| `get_nodes_details` | Metadaten vieler Knoten auf einmal (meist modell-intern) | *„Hol die Details zu diesen Treffern“* |
| `get_related_content` | Ähnliche Materialien (gleiches Fach/Stufe) | *„Was passt noch dazu?“* / *„Zeig mir ähnliche Materialien“* |

> **`includeAccessInfo`** (beide Detail-Werkzeuge, standardmäßig aus) ergänzt fünf
> Felder, die sonst nirgends erscheinen: **Zugang** (`ccm:conditionsOfAccess` —
> „ohne Anmeldung“ / „Anmeldung notwendig“ / „… für erweiterte Funktionen“),
> **Kosten** (`ccm:price` — „ja“ / „nein“ / „zusätzliche Inhalte per Kauf
> möglich“), **Werbung** (`ccm:containsAdvertisement` — „Ja“ / „Nein“),
> **Barrierefreiheit** (`ccm:accessibilitySummary` — A/AA/AAA, BITV 2.0, WCAG)
> und **OER-Status** (`ccm:license_oer`). Kostet **keinen** zusätzlichen Abruf:
> die Detail-Werkzeuge lesen ohnehin alle Properties.
>
> Abdeckung im Korpus (Staging, 2026-08-18, 590 209 Datensätze): Kosten 339 687 ·
> Zugang 198 699 · Werbung 69 688 · Barrierefreiheit 3 475 · OER-Status 1 121. Nur
> was der Datensatz trägt wird gezeigt — es gibt keine „keine Angabe“-Zeile.
>
> **Nicht filterbar.** Alle fünf Felder antworten als Suchkriterium mit HTTP 400;
> sie lassen sich an einem Datensatz ablesen, aber nicht suchen. „Zeig mir
> Material ohne Login“ geht also nicht.
>
> Vier der fünf beschriftet das Repository selbst. **Werbung** braucht zwei
> Rückfallebenen: der Metadatensatz deklariert dort die Sterne-Skala
> `quality_advertisement/0…5`, während 69 628 der 69 688 Werte
> `containsAdvertisement/yes|no` lauten. Für die `yes|no`-Mehrheit gibt es eine
> lokale Zwei-Werte-Tabelle, für die 60 Sterne-Reste die deklarierte Skala —
> und die ist keine Kosmetik: **`5` heißt „✰✰✰✰✰ ohne Werbung"**, eine nackte
> „5" liest sich als das Gegenteil.

> **`includeQualityInfo`** (beide Detail-Werkzeuge, standardmäßig aus) ergänzt
> die redaktionelle **Qualitätsbewertung** eines Datensatzes: Sachrichtigkeit,
> Didaktik, Sprache, Medien, Neutralität, Transparenz, Aktualität, Datenschutz,
> Bildungsrelevanz sowie Urheber-, Straf- und Persönlichkeitsrecht und
> Jugendschutz — als die Beschriftungen, die das Repository selbst deklariert
> („✰✰✰ gute Methodik", „keine Auffälligkeiten gefunden (Maschine)"). Kostet
> ebenfalls keinen zusätzlichen Abruf.
>
> **Wenige Datensätze sind bewertet** (30–120 Belegungen je Skalenfeld, 3 444 bei
> Jugendschutz), und ein unbewertetes Feld fehlt in der Antwort.
>
> Bis 2026-08-18 galten diese Felder als unlesbar. Die Erhebung vom 17.8. hatte
> gemessen, dass elf der vierzehn Werte außerhalb ihrer eigenen Deklaration
> speichern, und dort aufgehört. Nachgemessen speichert der Korpus **beide
> Formen nebeneinander im selben Feld** — `…/quality_didactics/1` und eine nackte
> `"4"` —, und nur die URI-Form kommt mit `_DISPLAYNAME` zurück. Die Ziffer ist
> kein kaputter Wert, sondern dieselbe Position auf derselben festen Skala: die
> Beschriftung gab es, nur das Nachschlagen fehlte.
> `src/vocabs-quality-scale.ts` liefert es, **erzeugt** aus dem Metadatensatz
> (`scripts/generate-quality-scales.mjs`, 10 Skalen, 52 Beschriftungen) statt hier
> erfunden. Antwortet der Datensatz selbst, gewinnt er.
>
> `ccm:oeh_quality_login` fehlte bis zum 2026-08-19 bewusst: `ccm:conditionsOfAccess`
> sagt dieselbe Sache dreiwertig und auf 198 699 statt 72 787 Datensätzen, und
> eine Tatsache zweimal auszugeben lädt zum Widerspruch ein. Das Schreiben hat
> die Abwägung gekippt — ein Feld, das man setzen und nicht zurücklesen kann, ist
> nicht prüfbar. Es steht als `Login:`, die Zugangsfläche als `Zugang:`.
>
> **Schreibend** sind seit dem 2026-08-19 alle vierzehn Felder offen: die neun
> Skalen (sieben 0–5, dazu `Login` und `Bildungsrelevanz` mit 0–1) und die fünf
> Befundfelder, dort nur die MASCHINEN-Werte — siehe `wlo_update_content`.
> Geschrieben wird die **deklarierte Form**, und die ist je Feld verschieden:
> volle URI bei sechs Skalen, nackte Ziffer bei `currentness`, `login` und
> `relevancy_for_education`. Welche Stufe wie heißt, nennt
> `lookup_wlo_vocabulary` mit `vocabulary="qualityScale"` — samt dem
> Kuratier-Parameter je Feld. `ccm:containsAdvertisement` bleibt zu: es
> deklariert 0–5, aber 69 628 von 69 688 gespeicherten Werten sind `yes`/`no`,
> ein Stern wäre dort die dritte Schreibweise.

### Hintergrundtexte
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `get_compendium_text` | Redaktioneller Kompendiumstext einer Sammlung — immer mit Inhaltsverzeichnis, mit `query` nur die passenden Absätze (BM25) | *„Gib mir den ganzen Kompendiumstext dieser Sammlung“*, *„Was sagt der Kompendiumstext zum Lehrplan Thüringen?“* |
| `get_wikipedia_summary` | Wikipedia: Anriss, oder mit `fullText` der ganze Artikeltext (Ergänzung, kein OER) | *„Gib mir den Wikipedia-Artikel zu Zellatmung“* |

#### Kompendiumstext: Inhaltsverzeichnis immer, Absätze auf Wunsch

Ein Kompendiumstext ist redaktionelle Prosa zu einer Sammlung — typischerweise
dreiteilig: (1) Weltwissen zum Thema, (2) Kompetenzen und Lehrplanbezüge nach
Bildungsstufe und Bundesland, (3) Vorstellung der Sammlungsinhalte. Er ist damit
der Maßstab für Lückenanalysen (Soll gegen den Ist-Bestand), für
Sachrichtigkeits-Prüfungen und für Lernpfade entlang der Lehrplan-Kompetenzen —
und er kann sehr lang
werden — der längste auf Staging hat **65 250 Zeichen**. Deshalb antwortet
`get_compendium_text` in zwei Formen, und beide beginnen mit dem
**Inhaltsverzeichnis** der Überschriften des Dokuments:

| Aufruf | Antwort |
|---|---|
| ohne `query` | Inhaltsverzeichnis + der ganze Text, **jeder Hauptabschnitt für sich gekappt** |
| mit `query` | Inhaltsverzeichnis + nur die Absätze, die dazu passen, jeder unter seinem Überschriftenpfad |

```
get_compendium_text(nodeId: "9e7a…")
get_compendium_text(nodeId: "9e7a…", query: "Lehrplan Thüringen Regelschule")
```

Das Inhaltsverzeichnis geht **immer** mit, auch bei einer gezielten Frage: wer nur
Ausschnitte sieht, weiß sonst nicht, was er nicht gesehen hat — und kann die
zweite, genauere Frage nicht stellen.

`query` ist ein Suchtext, keine Frage: Stichwörter wie „Lehrplan Thüringen
Regelschule" wirken besser als ein ganzer Satz. Gewichtet wird mit **BM25**;
Groß-/Kleinschreibung ist egal, deutsche Komposita treffen („Brechung" findet
„Lichtbrechung"), und Füllwörter zählen nicht mit.

> **Die Antwort ist Arbeitsmaterial, keine Anzeige.** Die Absätze kommen als
> Chunks und sind für die Verarbeitung durch das Modell gedacht, nicht zum
> Mitlesen. Wo das Lese-Widget rendert (ChatGPT), zeigt es deshalb **statt des
> Textes** eine Übergabe-Zeile — „12 Passagen an die KI übergeben · 4.812
> Zeichen", dazu die Hinweise, die man vor dem Vertrauen kennen muss: nicht
> getroffene Suchwörter und eine Kürzung, falls der Deckel unten gegriffen hat.
> Was das Modell bekommt, ist unverändert vollständig; gesehen werden soll, was
> es daraus macht.

> **Was die Antwort über sich selbst sagt.** Suchwörter, die im Text **gar nicht**
> vorkommen, werden benannt: „Lehrplan Thüringen Regelschule" auf der Sammlung
> Optik trifft nur über *Lehrplan* und liefert Lehrpläne aus Rheinland-Pfalz und
> Sachsen — ohne den Satz *„Nicht gefunden: thüringen, regelschule"* läse sich das
> wie eine Antwort auf die gestellte Frage. Und ein Treffer ohne Ergebnis ist
> **kein Fehler**: dann kommt das Inhaltsverzeichnis mit dem Hinweis, dass nichts
> passte — nie stillschweigend der Volltext, der eine andere Frage beantwortet.

> Betreiber-Stellschraube: `WLO_COMPENDIUM_SECTION_MAX` (Standard 2000 Zeichen je
> Hauptabschnitt). Was ein Hauptabschnitt ist, wird am Dokument abgelesen — die
> flachste Überschriftenebene, die mehr als einmal vorkommt. Gemessen tragen
> 10 von 10 Texten mit Überschriften ihren Titel in einer einzelnen H1 und ihre
> 11–18 Inhaltsabschnitte in H2; ein Deckel „je H1“ hätte also jedes Dokument als
> Ganzes gekappt. `GET /api/compendium` und `search_wlo_content` mit
> `includeCompendium` liefern unabhängig davon weiterhin den Volltext.

### Vokabular & Anbieter
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `lookup_wlo_vocabulary` | Gültige Werte eines Feldes — Filter (Stufe, Fach, Materialtyp, Zielgruppe, Lizenz) und Schreibfelder (`qualityScale`, `qualityFinding`) | *„Welche Bildungsstufen kann ich als Filter angeben?“*, *„Welche Stufen hat die Didaktik-Bewertung?“* |
| `lookup_wlo_publishers` | Anbieter/Quellen mit Materialzahl | *„Welche Anbieter liefern die meisten Biologie-Materialien?“* |

### System & Skills
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `search_skill` | Passende WLO-Skills (Inhaltsart „KI-Skill") auflisten — nodeId, Titel, Beschreibung, Keywords; mit `collectionId` nur die Skills einer Sammlung, mit `discipline`/`educationalContext` die zu einem Fach bzw. einer Stufe verschlagworteten | *„Welche WLO-Skills passen zu meiner Aufgabe?“* · *„Welche Skills gibt es für Physik?“* |
| `get_skill` | Die Anleitung (SKILL.md) zu einer nodeId laden — plus die Liste der weiteren Dateien des Skills (Name + nodeId, ohne Inhalt) | *(Folgeaufruf nach `search_skill`)* |
| `get_skill_registry` | Die Skills nennen, die EINE Inhaltssammlung freigegeben hat — Katalog (Titel, nodeId, Beschreibung, Keywords) plus die Verwendungshinweise der Redaktion aus dem Registry-Dokument. Mit `context` nur die Skills eines Arbeitszusammenhangs samt dessen Anleitung | *„Welche Skills gelten für diese Sammlung?“* · *„Was darf ich hier verwenden?“* · *„Wie plane ich damit Unterricht?“* |
| `get_skill_for_task` | Wählt den Skill selbst und liefert die Anleitung direkt — nur bei `WLO_SKILL_TOOL_MODE=one-tool` statt der beiden obigen | *„Gib mir die Anleitung für eine Vertretungsstunde“* |
| `wlo_auth_status` | Mit welchen Rechten der Server gerade liest — anonym, gemeinsames Dienstkonto oder persönliches Konto | *„Bin ich angemeldet?“* · *„Warum sehe ich diesen Inhalt nicht?“* |
| `wlo_health_check` | Erreichbarkeit der WLO-API prüfen | *„Ist die WLO-Verbindung gerade erreichbar?“* |

**Eine geladene Anleitung meldet sich.** `get_skill` und `get_skill_for_task`
stellen der Anleitung eine vom Server erzeugte Zeile voran und bitten das Modell,
sie wörtlich auszugeben:

```
[ edu-sharing Skill ] Unterrichtsstunde planen - aktiv
```

Damit sieht die Nutzerin, dass ein hochgeladenes Dokument die Antwort gerade
mitsteuert, und welches. Der Titel kommt aus dem Datensatz, die Zeile aus dem
Server — in der `SKILL.md` steht dafür nichts. Sie erscheint nur, wenn der
Datensatz die Inhaltsart `ai_skill` trägt: `get_skill` lädt auch die
Begleitdateien eines Skills, und eine Vorlage ist kein Skill. Im JSON-Ausgabe­
format steht sie als Feld `activation`.

**Welches der drei Skill-Tools?** Die Frage entscheidet, nicht der Zufall:

| Frage | Tool |
|---|---|
| Welche Skills gibt es für *diese Aufgabe*? | `search_skill` → dann `get_skill` |
| Welche Skills hat *diese Sammlung* freigegeben? | `get_skill_registry` |
| Beides in einem Schritt, ohne eigene Auswahl | `get_skill_for_task` (nur `WLO_SKILL_TOOL_MODE=one-tool`) |

`get_skill_registry` beantwortet die **Umkehrung** von `search_skill`: nicht
„welche Skills existieren", sondern „welche gelten hier". Es lohnt sich, wenn es
um das Vorgehen MIT einer Sammlung geht („wie arbeite ich damit", „was ist hier
vorgesehen") statt um ihre Inhalte.

**Der Katalog kommt meist von allein mit** — und seit 2026-08-15 bei jedem
Werkzeug, das mit Sammlungen zu tun hat, nicht nur bei der Suche:

| Antwortform | Was mitkommt |
|---|---|
| Datensatz-Listen (`search_wlo_all`, `search_wlo_collections`, `get_collection_contents`, `get_node_collections`, `get_node_details`) | der Katalog je Sammlung, **im Zeilenbudget** (unten) |
| Die Sammlung, auf der ein Werkzeug arbeitet (`get_collection_contents`, `search_wlo_within_collection`, `get_topic_page_content`, `get_related_content`) | derselbe Katalog, mit der Sammlung benannt — **plus `skillContext`** |
| Übersichten mit einer Zeile je Knoten (`browse_collection_tree`, `get_subject_portals`, `search_wlo_topic_pages`) | nur die **Kopfzeile**: Titel, Anzahl, nodeId für `get_skill_registry` |

**Das Zeilenbudget: eine Zahl, drei Formen.** Ein Katalog darf **12 Zeilen** je
Sammlung belegen, unabhängig von der Größe der Registry. Was hineinpasst,
entscheidet die Form.

| Passt | Form | Was steht da |
|---|---|---|
| Kontexte + Skills ≤ 12 | **voll** | wie bisher: jeder Skill mit nodeId, nach Kontexten gruppiert |
| nur die Kontextnamen ≤ 12 | **Kontext-Index** | die Namen mit Anzahl, mehrere je Zeile — **keine** nodeIds |
| auch das nicht | **Kopfzeile** | Titel, Gesamtzahl, Anzahl Kontexte, und `get_skill_registry` |

Gemessen an der Form der Optik-Registry (28 Skills, 7 Kontexte): **3 Zeilen
statt 30, 407 statt 3436 Zeichen** je Sammlung — wie viele Namen je Zeile
passen, hängt an ihrer Länge. Ein flaches Dokument mit 50 Skills schrumpft auf
eine Zeile (147 Zeichen); dort greift kein Kontext, nur das Budget.

Die Ersparnis entsteht **oberhalb** des Budgets. Innerhalb kostet die
Gruppierung eine Zeile je Kontext — eine kleine Registry wird dadurch etwas
länger als ihre flache Liste (echtes Optik-Dokument, 3 Skills in 2 Kontexten:
818 gegen 659 Zeichen). Zugesichert ist die Obergrenze, nicht eine Ersparnis
bei jeder Größe.

Formen 2 und 3 drucken **keine Skill-nodeId** und tragen deshalb auch den
Übersichtssatz nicht — er verspräche einen `get_skill`-Aufruf, für den die
Antwort keine Kennung mitgibt.

### Kontexte: gezielt statt vollständig

Ein Registry-Dokument gliedert seine Skills über Überschriften: `##` ist ein
Kontext, `###` ein Unterkontext, und die Prosa von der Überschrift bis zum ersten
Skill-Block ist die **Anleitung der Redaktion** dazu. Das Anlegen beschreibt
`docs/SKILLS.md`.

Zwei Parameter greifen darauf zu:

| Parameter | Wo | Wirkung |
|---|---|---|
| `context` | `get_skill_registry` | nur die Skills dieses Kontexts (plus die immer geltenden), die Anleitung dazu, und wortgetreu **nur diesen Abschnitt** statt des ganzen Dokuments |
| `skillContext` | `get_collection_contents`, `search_wlo_within_collection`, `get_node_details`, `get_topic_page_content`, `get_related_content` | derselbe verengte Katalog **plus die Anleitung**, direkt am Sammlungstreffer |

```
get_skill_registry(nodeId: "9e7a…", context: "Unterricht vorbereiten")
get_collection_contents(nodeId: "9e7a…", skillContext: "Material erschließen")
```

Groß-/Kleinschreibung und Leerzeichen sind egal. Ohne Angabe oder mit `all`
kommt alles. Ein Unterkontext wird als `Kontext/Unterkontext` angesprochen —
oder mit seinem eigenen Namen, solange der im Dokument eindeutig ist.

**Ein Name, der nicht trifft, verengt nie.** Unbekannt oder mehrdeutig liefert
den **vollständigen** Katalog plus einen Satz mit den vorhandenen Namen — kein
Fehler, und keine kurze Liste, die wie ein Ergebnis aussieht. Das Modell lernt
den richtigen Namen aus genau der Antwort, in der es danebengriff. Bei einem
Fehlgriff kommt allerdings **keine** Anleitung mit: ein Tippfehler soll nicht die
teuerste Antwort auslösen.

**Nicht bei `search_wlo_all` / `search_wlo_collections`.** Kontextnamen sind je
Registry vergeben; ein Parameter über fünf Sammlungen träfe in der einen und ginge
in der anderen ins Leere. Diese Werkzeuge liefern stattdessen den Index, aus dem
die Namen überhaupt erst bekannt werden.

**Was Kontexte kosten: nichts.** Sie stehen im Dokumenttext, den der billige
Tarif ohnehin liest (1 Kinderliste + 1 Download, unverändert). Nur ein
**benannter** `skillContext` kostet einen Live-Abruf (2 Anfragen, ~1,0–1,4 s),
weil der Cache die Zusammenfassung hält und nicht die Prosa der Redaktion —
dafür entfällt der zweite Aufruf. `skillContext: "all"` verlangt keine Prosa und
wird deshalb wie ein Aufruf ohne Kontext aus dem Cache beantwortet.

> Seit 2026-08-18 trägt **jede** Sammlungs-Antwort — mit oder ohne
> `skillContext` — die **Beschreibung** der ersten **drei** Skills („Wozu die
> Skills da sind"). Ab dem vierten bleibt es bei Titel + nodeId.
>
> Die Drei ist eine Grenze für die **Abrufe**, nicht nur für die Ausgabe: eine
> Registry darf hundert Skills deklarieren, und ein Metadaten-Abruf je Skill ist
> genau der Preis, den der billige Tarif vermeidet. Bei einem benannten Kontext
> läuft die Auflösung zudem NACH dem Verengen — bezahlt wird, was gezeigt wird.
> Schlagworte bleiben draußen (längstes Feld, ~175 Zeichen je Skill gemessen);
> die gibt es weiter nur mit `get_skill_registry`.
>
> Der Katalog, der mit **Suchtreffern** reist, ist ein anderer Weg (Cache, bis zu
> zehn Sammlungen je Anfrage) und bleibt unverändert kostenlos.
>
> Ein Skill, dessen Datensatz nicht lesbar ist, wird als „Nicht abrufbar
> (geprüft für die ersten 3)" benannt statt mit „laden mit get_skill" angeboten.

In **beiden** Ausgabeformaten: im Markdown als Zeilen, im JSON als Feld
`skillRegistry` am jeweiligen Knoten — dort trägt jeder Eintrag sein `context`
und der Knoten die Liste `contexts` mit Namen und Anzahl. Antwortet der Abruf
nicht, steht statt des Katalogs „… ist hier nicht geprüft" — das ist etwas
anderes als eine Sammlung, die keine Skills freigegeben hat, und wird auch
anders gesagt.

**Jede aufgelistete Übersicht sagt, dass sie nicht die Anleitung ist.** Überall
dort, wo Skill-nodeIds gedruckt werden — also in der vollen Form der ersten
beiden Tabellenzeilen —, ebenso in `search_skill` und `get_skill_registry` (im
JSON als Feld `hint`):

> Das ist nur die Übersicht — die Anleitungen selbst stehen nicht darin. Die
> Anleitung (SKILL.md) lädt `get_skill` mit der nodeId des gewünschten Skills,
> nicht mit der einer Registry oder Sammlung.

Ohne ihn liest sich ein Katalogeintrag wie ein bereits übergebener Arbeitsschritt:
„Fragen generieren" ist aber nur der Name eines Ablaufs, den niemand geholt hat.
Der zweite Halbsatz grenzt gegen die Nachbarn ab: eine gerenderte Sammlung führt
**drei** nodeIds — ihre eigene, die des Registry-Dokuments und die des Skills —
und die dem Satz nächste ist die falsche.

Die dritte Tabellenzeile trägt den Satz **nicht**, und die Formen 2 und 3
ebenso wenig — dort steht keine Skill-nodeId, mit der man ihm folgen könnte.

Die zweite Zeile war die eigentliche Lücke: diese Werkzeuge geben die Sammlung,
um die es geht, nie als Ergebnis zurück — sie steht in den Argumenten. Wer den
Katalog an die Ergebnisse hängte, beantwortete alles außer der Frage. Bei einer
Themenseite ist die **Sammlungs-nodeId** die richtige Kennung, nie die
Varianten-ID.

Die Übersichten lesen nur den Cache: eine Portalliste umfasst dreißig
Sammlungen, ein Baum fünfzig, und je eine Kinderliste dafür wäre der Rundlauf,
den der Cache verhindern soll. Was er nicht kennt, wird vorgemerkt und ist beim
nächsten Aufruf da.

Ein Hintergrund-Cache (`WLO_SKILL_CACHE`, standardmäßig **an**) hält je Sammlung
bereit, was ihre Kinderliste sagt, und erneuert es alle 5 Minuten. Drei Dinge,
die die Antwort bedeuten kann:

- **Katalog vorhanden** → die Sammlung führt eine Registry.
- **Kein Feld, aber geprüft** → sie führt keine. Das ruht immer auf einer
  Kinderliste, die geantwortet hat, nie auf dem Suchindex.
- **Hinweiszeile auf `get_skill_registry`** → *nicht* geprüft. Entweder war die
  Sammlung noch nie in einer Antwort, oder die Dateiliste war bei 50 gekappt und
  die Registry könnte dahinter liegen.

Ein Eintrag gilt bis zu 10 Minuten (`WLO_SKILL_CACHE_TTL_MS`). Direkt nach dem
Anlegen oder Ändern einer Registry deshalb `includeSkillRegistry: true` an
`search_wlo_all`/`search_wlo_collections` (erzwingt den frischen Abruf) oder
gleich `get_skill_registry` — das liest immer live.

### ChatGPT-Wissenskonvention (RAG)
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `search` | Leichte Treffer ({id,title,url}) für belegte Antworten — ChatGPT ruft es oft automatisch. Mit `WLO_SEARCH_OUTPUT_MODE=rich` zusätzlich dieselben Töpfe und dieselbe Oberfläche wie `search_wlo_all` | *„Suche in WLO nach Material zur Photosynthese“* |
| `fetch` | Volltext eines Treffers per id (Folge zu `search`, meist modell-intern). Mit `WLO_SEARCH_OUTPUT_MODE=rich` zusätzlich Vorschaubild, Download-Link und Beschreibung — und die Detailansicht wie `get_node_details` | *„Lad den Volltext zu diesem Treffer“* |

---

## 1b. Kuratierende MCP-Tools (14) — mit Chat-Trigger

**Nur sichtbar mit Schreibrechten.** Wer anonym liest, sieht diese Tools gar
nicht — und ein Modell kann nicht missbrauchen, was es nicht sieht. Jedes lehnt
zusätzlich beim Aufruf ab, weil ein Host eine zwischengespeicherte Werkzeugliste
ausliefern kann.

Drei Regeln gelten für **jedes** davon:

1. **Zwei Schritte, immer.** Der erste Aufruf ändert nichts, sondern zeigt eine
   Vorschau und gibt ein einmal verwendbares Bestätigungs-Token zurück. Erst der
   zweite Aufruf mit diesem Token schreibt. Ein Token gilt für genau diese eine
   Änderung — sonst könnte ein hineingeschmuggelter Text eine andere Änderung
   freigeben, als die Nutzerin gesehen hat.
2. **Nichts gilt als gespeichert, bis es zurückgelesen wurde.** edu-sharing
   antwortet in drei gemessenen Fällen mit `200` und verwirft den Wert trotzdem.
   Nach jedem Schreibvorgang wird erneut gelesen und je Feld berichtet, ob der
   Wert gespeichert, verworfen oder umgeschrieben wurde.
3. **Löschen ist über diesen Server endgültig.** Wiederherstellbarkeit ließ sich
   nicht nachweisen, also wird sie nicht versprochen.
4. **Eine id aus einer Sammlung ist eine Verknüpfung, nicht der Datensatz.**
   Sammlungslisten liefern ausschließlich Verknüpfungs-ids, und die beiden
   Richtungen sind gegensätzlich (gemessen 16./17.08.2026): Ein
   **Metadaten-Schreibvorgang** an eine Verknüpfung würde dort gespeichert, das
   Original nie erreichen und die Verknüpfung dauerhaft abkoppeln — deshalb
   lösen die Schreibwerkzeuge auf das Original auf und nennen beide ids in der
   Vorschau. Ein **Löschvorgang** an eine Verknüpfung entfernt dagegen nur die
   Verknüpfung; er wird bewusst *nicht* umgeleitet, weil das aus einem
   harmlosen Aufräumen Datenverlust machen würde. In Ergebnislisten steht die
   Unterscheidung als `nodeId: … (Verknüpfung; Original: …)` bzw. als Feld
   `originalId`.

### Inhalte pflegen
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `wlo_update_content` | Datensatz ändern — Metadaten **und/oder den Inhalt** (`content`/`fileBase64` ersetzt die hinterlegte Datei; die alte Fassung bleibt in der Versionshistorie). Metadaten: Titel, Beschreibung, Schlagwörter (ergänzt, nicht ersetzt), Quell-URL, Sprache, Autor, Herausgeber, Lizenz, Inhaltstyp, Fach, Stufe, Zielgruppe, **Prüfergebnis einer maschinellen Qualitätsprüfung** (Sachrichtigkeit, Urheberrecht, Strafrecht, Persönlichkeitsrecht, Jugendschutz — nur die Maschinen-Werte, ein Mensch-Ergebnis wird abgelehnt) | *„Ergänze bei diesem Material das Fach Biologie und die Stufe Sek I“*, *„Trage ein, dass die Sachrichtigkeitsprüfung keine Auffälligkeiten ergeben hat“* |
| `wlo_create_content` | Neuen Datensatz anlegen — **zwei Wege**: `url` für Material, das woanders liegt (prüft vorher auf ein Duplikat und nennt den vorhandenen), oder `content`/`fileBase64`, wenn der Datensatz den Inhalt **selbst tragen** soll (im Chat erstelltes Markdown, erzeugtes Bild). Bleibt ein **Entwurf** | *„Leg für diese Seite einen WLO-Datensatz an“* · *„Speichere dieses Arbeitsblatt in WLO“* |
| `wlo_submit_content` | Einen vorhandenen Datensatz zur redaktionellen Prüfung einreichen — ein eigener Schritt, nie automatisch | *„Reiche diesen Datensatz zur Prüfung ein“* |
| `wlo_delete_content` | Datensatz löschen. Über diesen Server nicht rückgängig zu machen. Über die id einer **Sammlungs-Verknüpfung** verschwindet nur die Verknüpfung — der Datensatz bleibt; die Vorschau sagt, welcher Fall vorliegt | *„Lösche diesen Datensatz“* |

### Sammlungen pflegen
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `wlo_create_collection` | Sammlung anlegen (eine kuratierte Themenseite), oberste Ebene oder Untersammlung | *„Leg eine Sammlung ‚Bruchrechnung Klasse 6‘ an“* |
| `wlo_rename_collection` | Titel und Beschreibung einer Sammlung ändern | *„Benenne diese Sammlung um in …“* |
| `wlo_add_to_collection` | Vorhandenes Material in eine Sammlung aufnehmen. Nichts wird verschoben oder kopiert — eine Sammlung enthält Verweise | *„Nimm dieses Video in meine Sammlung auf“* |
| `wlo_remove_from_collection` | Material aus einer Sammlung herausnehmen. Das Material bleibt bestehen und in allen anderen Sammlungen | *„Nimm dieses Material aus der Sammlung heraus“* |
| `wlo_delete_collection` | Sammlung samt Untersammlungen löschen. Das verlinkte Material bleibt bestehen | *„Lösche diese Sammlung“* |
| `wlo_update_compendium` | Redaktionellen Kompendialtext einer Sammlung schreiben, ersetzen oder entfernen (Markdown) | *„Schreib einen Einführungstext für diese Sammlung“* |
| `wlo_set_topic_page` | Festlegen, **welche Variante** eine Themenseite öffentlich rendert. Legt keine Varianten an, löscht und sortiert keine | *„Zeig auf dieser Themenseite künftig die Variante für die Oberstufe“* |

> **Sofort öffentlich.** Dies ist das einzige Kurationswerkzeug, dessen Ergebnis
> ohne weiteren Schritt auf einer öffentlichen Seite steht. Das Repository prüft
> das zugrunde liegende Dokument (`ccm:page_config`) überhaupt nicht — gemessen
> am 09.08.2026: es speichert auch die Zeichenkette `"not json at all"` und
> antwortet mit 200. Alle Prüfungen liegen deshalb hier: Das gespeicherte
> Dokument wird **bearbeitet, nie neu gebaut** (unbekannte Schlüssel und die
> Variantenliste bleiben unangetastet), eine Variante, die nicht zu dieser Seite
> gehört, wird abgelehnt, ein unlesbares Dokument nicht überschrieben, und nach
> dem Schreiben wird zurückgelesen und neu geparst.

### Vorschlagen statt schreiben
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `wlo_suggest_metadata` | Werte **mit Begründung** vorschlagen, statt sie zu schreiben. Der Datensatz bleibt unverändert | *„Schlag passende Schlagwörter vor, ohne sie zu setzen“* |
| `wlo_list_suggestions` | Hinterlegte Vorschläge mit Begründung, Status und Entscheid-ID anzeigen | *„Welche Vorschläge liegen zu diesem Datensatz vor?“* |
| `wlo_decide_suggestion` | Annehmen (schreiben, zurücklesen, **dann** vermerken) oder ablehnen | *„Nimm den Vorschlag zum Fach an“* |

> **Warum die Reihenfolge beim Annehmen zählt:** Ein Vorschlag wird erst
> geschrieben und zurückgelesen und danach als angenommen markiert. Andersherum
> stünde `ACCEPTED` über einem Datensatz, der den Wert nie bekommen hat — und das
> liest sich wie erledigte Arbeit.

---

## 1a. Mit welchen Rechten wird gelesen?

Der Server löst die Identität **pro Anfrage** entlang einer Kette auf. Die
erste Sprosse, die greift, gewinnt:

| Sprosse | Woher | Wirkung |
|---|---|---|
| **1. Persönliches Konto** | `Authorization: Basic …`, vom KI-Programm mitgeschickt | Die Rechte genau dieser Person |
| **2. Dienstkonto** | `WLO_SERVICE_USER` + `WLO_SERVICE_PASSWORD` (Server-Umgebung) | Dieselben erweiterten Rechte für **alle** Nutzenden |
| **3. Anonym** | nichts konfiguriert | Nur öffentliche Inhalte — der Standard |

Welche gerade gilt, beantwortet `wlo_auth_status`.

### Persönliche Anmeldung einrichten

Die MCP-URL wird **ohne Auth** eingetragen — nur wer seine eigenen Rechte will,
hinterlegt zusätzlich einen Wert im Authorization-Feld seines KI-Programms. Der
Header wird bei jeder Anfrage mitgeschickt; **das Sprachmodell bekommt ihn nie zu
sehen**, und der Server speichert nichts.

**Empfohlen: der verschlüsselte Zugangsblock.** Auf `https://<host>/auth` mit dem
WLO-Konto anmelden — das Passwort wird **im Browser** verschlüsselt und verlässt
das Gerät nur als unlesbarer Block. Diesen einmal einfügen; sperren jederzeit
unter `/auth-revoke.html` oder `/auth/revoke` — dieselbe Seite.

Gegenüber dem direkten Basic-Header bringt das drei Dinge: das Passwort liegt
nicht beim KI-Anbieter, der Block funktioniert **nur gegen diesen Server** statt
gegen ganz WLO, und er ist widerrufbar. Voraussetzung ist, dass die Betreiberin
`WLO_AUTH_PRIVATE_KEY` gesetzt hat; sonst sagt die Seite, dass dieser Server
gerade keine Zugänge ausgibt.

Pro WLO-Konto sind die **zehn zuletzt geholten** Blöcke gültig; wer einen elften
holt, entwertet damit seinen ältesten. Das begrenzt zugleich, wie lange ein
verlorener Block gilt — sperren lässt er sich nur, solange man ihn noch hat.
Zugänge, die ein eingebettetes Widget automatisch erzeugt, zählen dabei getrennt
und können einen selbst eingetragenen Block nicht verdrängen.

**Fallback: Basic.** Wo der Zugangsblock nicht angeboten wird, geht weiterhin
`Basic ` gefolgt von `nutzername:passwort` in Base64. Dann aber bitte **nicht**
über die Kommandozeile — `printf 'name:passwort' | base64` schreibt das Passwort
im Klartext in die Shell-History, wo es unbefristet stehen bleibt. Der
Passwortmanager oder ein Umwandler, der lokal im Browser rechnet, sind die
besseren Wege.

Danach mit `wlo_auth_status` prüfen: `mode: "user"` **und**
`authenticated: true` heißt, es greift.

> **Warum Basic und nicht OAuth?** Die edu-sharing-REST-API deklariert in ihrer
> eigenen OpenAPI genau zwei Verfahren — `basicAuth` und das Session-Cookie.
> Einen Bearer-Token ignoriert sie stillschweigend, statt ihn abzulehnen; der
> Server weist ihn deshalb ab, statt einen Aufruf zu erzeugen, der
> authentifiziert *aussieht* und keiner ist. Ein OAuth-Discovery-Dokument gibt
> es auf keinem WLO-Host (geprüft 2026-07-30).

> **Fallstrick:** Falsche Zugangsdaten schalten **nicht** auf „nur öffentlich“
> zurück. WLO antwortet mit `401` — auf dem Identitäts- wie auf dem
> Such-Endpunkt (gemessen 2026-07-31 gegen die Produktion) — und damit schlägt
> jede Abfrage fehl: der Server liefert gar nichts mehr. Wer anonym lesen will,
> lässt die Variablen weg. Der Server prüft seine Identität deshalb beim Start
> und meldet im Log, wenn hinterlegte Zugangsdaten abgelehnt werden;
> `wlo_auth_status` zeigt dasselbe als `mode: "service"` bei
> `authenticated: false`.

Die öffentliche REST-Schicht (`/api/*`) bleibt bewusst anonym: ein dort
mitgeschickter `Authorization`-Header wird **nicht** übernommen (per Test
festgeschrieben).

---

## 2. Widgets (4 interaktive Oberflächen)

| Widget | Ausgelöst durch | Trigger-Beispiel | Was man sieht |
|---|---|---|---|
| **reading** | `get_wlo_content_text`, `get_compendium_text` | *„Fasse dieses Arbeitsblatt zusammen“*, *„Worum geht es in dieser Sammlung?“* | Der Volltext bzw. der redaktionelle Kompendiumstext lesbar formatiert, mit Herkunftsangabe und Buttons zum Weiterarbeiten („Zusammenfassen“, „Einfacher formulieren“, „Aufgaben ableiten“). Bei einer Sammel-Abfrage mehrerer Sammlungen entfallen die Buttons — „fasse *diesen* Inhalt zusammen“ wäre dann mehrdeutig |
| **search-results** | **jedes Werkzeug, das eine Trefferliste liefert**: `search_wlo_all`, `search_wlo_content`, `search_wlo_collections`, `get_collection_contents`, `search_wlo_within_collection`, `get_related_content`, `search_wlo_topic_pages`, `get_node_details` (ein Knoten = Liste mit einem Element) | *„Ich suche Material zur Bruchrechnung“*, *„Was ist in dieser Sammlung?“*, *„Was passt noch dazu?“* | Sammlungs-/Themenseiten-Band oben, gleich große Material-Kacheln darunter, „Details“-Button → Einzelansicht; Kacheln lassen sich ankreuzen, die Aktionsleiste steht **über** dem Raster |
| **topic-page** | `get_topic_page_content` | *„Zeig die Themenseite zu Optik“* | Titel + Beschreibung, darunter Schwimmlinien mit Karten — jede Karte mit „Details“ → Einzelansicht (Lizenz, Quelle) und von dort „Volltext anzeigen“ / „Ähnliche Inhalte“ |
| **browse** | `get_subject_portals`, `browse_collection_tree` | *„Zeig mir den Themenbaum zu Mathematik“* | Statisch vor-aufgeklappter Baum; Auf-/Zuklappen lokal; „Inhalte anzeigen“ an **jedem** Knoten (auch solchen mit Unterordnern) lädt dessen Inhalte als neue Karte |

> **Klicken statt tippen:** Jede Kachel trägt die Aktion, die den Ablauf
> fortsetzt — Sammlung → „Inhalte anzeigen“, Themenseite → „Themenseite öffnen“
> **und** „Inhalte anzeigen“ (beides, seit 22.08. — vorher verbarg die
> Ein-Aktions-Regel die Inhalte genau der reichsten Sammlungen),
> Einzelansicht → „Volltext anzeigen“ und „Ähnliche Inhalte“. Jeder Button
> schickt eine Nachricht in den Chat, die den **passenden Parameternamen des
> Zielwerkzeugs** trägt (meist `nodeId`, bei `get_topic_page_content`
> `collectionId`) — ein Test prüft jeden Eintrag gegen das Eingabeschema des
> registrierten Werkzeugs.
>
> **Wo die Buttons erscheinen:** Das Einspeisen einer Nachricht in den Chat ist
> eine **ChatGPT-Erweiterung** (`window.openai.sendFollowUpMessage`). Die
> MCP-Apps-Standardbrücke kennt nur `tools/call` und `ui/update-model-context` —
> beides löst keinen Nutzer-Zug aus. Auf Hosts ohne diese Erweiterung (Claude
> u. a.) erscheinen die Folge-Buttons deshalb **gar nicht**; die Widgets sind
> dort reine Anzeige. Das ist Absicht: ein Button, den der Host nicht einlösen
> kann, wäre schlimmer als keiner. Lokale Bedienung — Details/Zurück,
> Baum auf- und zuklappen — funktioniert überall.

---

## 3. REST-Endpunkte (öffentlich, nur lesend — für Nicht-MCP-KIs/Launcher)

| Methode + Pfad | Funktion | Trigger / Aufruf |
|---|---|---|
| `GET /api/search/<Begriff>` | Suche, Pfad-Form (übersteht Query-Stripping) | `…/api/search/Bruchrechnung?discipline=Mathematik` |
| `GET /api/search?q=<Begriff>` | Suche, Query-Form (Alias) — ohne Begriff: 200-Hinweis-Envelope | `…/api/search?q=Eiszeit&learningResourceType=Video` |
| `…&format=html` | Dieselbe Suche als lesbare HTML-Seite (für Reader-KIs/Menschen) | `…/api/search/Bruchrechnung?format=html` |
| `GET /api/topic-page?collectionId=…` | Schwimmlinien einer Themenseite (leeres Ergebnis trägt `reason`, s. o.) | `…/api/topic-page?collectionId=<id>` |
| `GET /api/compendium?ids=…` | Kompendiumstexte | `…/api/compendium?ids=<id1,id2>` |
| `GET /api/wikipedia?q=…` | Wikipedia-Zusammenfassung | `…/api/wikipedia?q=Zellatmung` |
| `GET /api/collection?nodeId=…` | Inhalte einer Sammlung (Skills-Quelle des Launchers) | `…/api/collection?nodeId=<id>` |
| `GET /api/skills` · `GET /api/skills/<id>` | Skill-Katalog · roher Markdown eines Skills | `…/api/skills` |
| `GET /health` | Status + Widget-Build-Hashes (Deploy-Fingerprint) | `…/health` |
| `GET /llms.txt` · `/robots.txt` | Selbstbeschreibung für KI-Fetcher · permissiv | `…/llms.txt` |
| `GET /` · `/launcher.html` · `/bookmarklet.md` | Prompt-Launcher (Boerdi) · Bookmarklet-Anleitung | im Browser öffnen |
| `POST /mcp` | Der MCP-Kanal selbst (SSE/JSON) — für Connector-Einbindung | MCP-URL, z. B. `https://<host>/mcp` |

---

## Praxis-Hinweise

- **MCP-Modus** (Connector in Claude/ChatGPT): Der natürliche Satz aus der
  Spalte „Trigger“ genügt — das Modell wählt das Tool und rendert das Widget.
- **REST-/Launcher-Weg** (ohne Connector): Die KI baut die passende
  `/api/…`-URL. Bei eingeschränkten Abruf-Werkzeugen greift die Fallback-Leiter
  (Pfad-Form → `?format=html` → URL/JSON in den Chat einfügen).
