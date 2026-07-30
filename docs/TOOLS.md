# WLO MCP Server — Funktionsübersicht mit Chat-Triggern

Vollständige Referenz des aktuell unterstützten Funktionsumfangs: 23 MCP-Tools,
4 interaktive Widgets und die öffentlichen REST-Endpunkte — je mit dem besten
Chat-Trigger (natürliche Formulierung, die das Tool/Widget auslöst).

---

## 1. MCP-Tools (23) — mit Chat-Trigger

### Suchen & Finden
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `search_wlo_all` | Kombi-Suche: Materialien + Sammlungen + Themenseiten in einem Aufruf (der Standard-Einstieg) | *„Ich suche Bildungsinhalte für eine Mathestunde zur Bruchrechnung"* |
| `search_wlo_content` | Nur einzelne Materialien (Videos, Arbeitsblätter …) | *„Zeig mir ein Video zur Eiszeit für die 6. Klasse"* |
| `search_wlo_collections` | Sammlungen/Themenseiten zu einem Thema | *„Gibt es eine WLO-Sammlung zum Klimawandel?"* |
| `search_wlo_topic_pages` | Themenseiten suchen (liefert deren URLs/Varianten) | *„Welche WLO-Themenseiten gibt es zu Optik?"* |

> **Praxis-Hinweis zu `search_wlo_topic_pages`:** Ohne `query` listet das Tool
> Themenseiten auf und muss dafür jede gefundene Seiten-Variante ihrer
> Sammlung zuordnen — der aufwendigste Pfad des Servers. `maxResults` klein
> halten und, wenn möglich, `educationalContext` mitgeben: beides verkleinert
> die Kandidatenmenge und verkürzt die Antwortzeit deutlich. Einen
> `discipline`-Filter gibt es hier **nicht** (unbekannte Parameter werden still
> verworfen) — fachlich filtern über `search_wlo_collections` /
> `search_wlo_content`. Betreiber-Stellschraube: `WLO_TOPIC_POOL`.

### Inhalte im Volltext
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `get_wlo_content_text` | Der **eigentliche Text** eines Materials (Arbeitsblatt, Artikel), nicht nur die Metadaten | *„Fasse dieses Arbeitsblatt zusammen"* · *„Mach daraus Aufgaben für Klasse 7"* |

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

### Themenseiten (Schwimmlinien)
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `get_topic_page_content` | Render-fertige Schwimmlinien einer Themenseite — jetzt in einem Schritt per Thema | *„Zeig mir die Themenseite zu Optik mit den Schwimmlinien"* |

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
| `get_subject_portals` | Übersicht aller Fachportale (Mathe, Bio, Deutsch …) | *„Welche Fächer gibt es bei WLO?"* |
| `browse_collection_tree` | Themenbaum / Unterthemen eines Fachs oder einer Sammlung | *„Zeig mir den Themenbaum zu Mathematik"* |

> **Der Baum ist bewusst begrenzt:** höchstens zwei Ebenen und eine gedeckelte
> Breite je Knoten. Zweige mit mehr Inhalt tragen `hasMoreChildren`, die Antwort
> insgesamt `truncated`, und die Markdown-Ausgabe nennt den Folgeaufruf
> (`browse_collection_tree mit nodeId=…`). So bleibt die Übersicht schnell und
> lesbar, und tiefer geht es gezielt auf Nachfrage — die Nutzerin/der Nutzer
> erfährt dabei, dass es mehr gibt. `includeContentPreview` kostet einen Abruf
> je Knoten (Sekunden auf breiten Bäumen) und ist standardmäßig aus.
| `get_collection_contents` | Inhalte einer konkreten Sammlung auflisten | *„Was ist in der Sammlung Bruchrechnung drin?"* |
| `search_wlo_within_collection` | Innerhalb einer Sammlung suchen/filtern | *„Welche Videos zu Zellteilung gibt es in dieser Sammlung?"* |
| `get_collection_stats` | Zusammensetzung einer Sammlung (Anzahl, Typen, Fächer) | *„Woraus besteht diese Sammlung?"* |
| `get_node_breadcrumb` | Pfad einer Sammlung im Themenbaum | *„Wo liegt diese Sammlung im WLO-Baum?"* |

### Details & Verwandtes
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `get_node_details` | Alle Metadaten + Volltext eines Inhalts | *„Zeig mir alle Details und den Volltext zu diesem Inhalt"* |
| `get_nodes_details` | Metadaten vieler Knoten auf einmal (meist modell-intern) | *„Hol die Details zu diesen Treffern"* |
| `get_related_content` | Ähnliche Materialien (gleiches Fach/Stufe) | *„Was passt noch dazu?"* / *„Zeig mir ähnliche Materialien"* |

### Hintergrundtexte
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `get_compendium_text` | Vollständiger redaktioneller Kompendiumstext einer Sammlung | *„Gib mir den ganzen Kompendiumstext dieser Sammlung"* |
| `get_wikipedia_summary` | Kurzer Wikipedia-Überblick (Ergänzung, kein OER) | *„Gib mir einen kurzen Wikipedia-Überblick zu Zellatmung"* |

### Vokabular & Anbieter
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `lookup_wlo_vocabulary` | Gültige Filterwerte (Stufe, Fach, Materialtyp, Zielgruppe) | *„Welche Bildungsstufen kann ich als Filter angeben?"* |
| `lookup_wlo_publishers` | Anbieter/Quellen mit Materialzahl | *„Welche Anbieter liefern die meisten Biologie-Materialien?"* |

### System & Skills
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `find_wlo_skills` | Fertige WLO-Anleitungen (Skills) finden | *„Welche WLO-Skills passen zu meiner Aufgabe?"* |
| `wlo_health_check` | Erreichbarkeit der WLO-API prüfen | *„Ist die WLO-Verbindung gerade erreichbar?"* |

### ChatGPT-Wissenskonvention (RAG)
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `search` | Leichte Treffer ({id,title,url}) für belegte Antworten — ChatGPT ruft es oft automatisch | *„Suche in WLO nach Material zur Photosynthese"* |
| `fetch` | Volltext eines Treffers per id (Folge zu `search`, meist modell-intern) | *„Lad den Volltext zu diesem Treffer"* |

---

## 2. Widgets (4 interaktive Oberflächen)

| Widget | Ausgelöst durch | Trigger-Beispiel | Was man sieht |
|---|---|---|---|
| **reading** | `get_wlo_content_text` | *„Fasse dieses Arbeitsblatt zusammen"* | Der Volltext lesbar formatiert, mit Herkunftsangabe und Buttons zum Weiterarbeiten („Zusammenfassen", „Einfacher formulieren", „Aufgaben ableiten") |
| **search-results** | `search_wlo_all` | *„Ich suche Material zur Bruchrechnung"* | Sammlungs-/Themenseiten-Band oben, gleich große Material-Kacheln darunter, „Details"-Button → Einzelansicht; Kacheln lassen sich ankreuzen und über „Ausgewählte weiterverwenden" mit ihren nodeIds in den Chat übernehmen |
| **topic-page** | `get_topic_page_content` | *„Zeig die Themenseite zu Optik"* | Titel + Beschreibung, darunter Schwimmlinien mit Karten |
| **browse** | `get_subject_portals`, `browse_collection_tree` | *„Zeig mir den Themenbaum zu Mathematik"* | Statisch vor-aufgeklappter Baum; Auf-/Zuklappen lokal; „Inhalte anzeigen" an **jedem** Knoten (auch solchen mit Unterordnern) lädt dessen Inhalte als neue Karte |

> **Klicken statt tippen:** Jede Kachel trägt die Aktion, die den Ablauf
> fortsetzt — Sammlung → „Inhalte anzeigen", Themenseite → „Themenseite öffnen",
> Einzelansicht → „Volltext anzeigen" und „Ähnliche Inhalte". Jeder Button
> schickt eine Nachricht in den Chat, die **nodeId und passendes Werkzeug**
> nennt, damit das nachfolgende Tool direkt arbeiten kann. Kann der Host keine
> Nachricht einspeisen, erscheinen die Buttons gar nicht erst.

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
  Spalte „Trigger" genügt — das Modell wählt das Tool und rendert das Widget.
- **REST-/Launcher-Weg** (ohne Connector): Die KI baut die passende
  `/api/…`-URL. Bei eingeschränkten Abruf-Werkzeugen greift die Fallback-Leiter
  (Pfad-Form → `?format=html` → URL/JSON in den Chat einfügen).
