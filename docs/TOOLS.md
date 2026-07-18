# WLO MCP Server — Funktionsübersicht mit Chat-Triggern

Vollständige Referenz des aktuell unterstützten Funktionsumfangs: 22 MCP-Tools,
3 interaktive Widgets und die öffentlichen REST-Endpunkte — je mit dem besten
Chat-Trigger (natürliche Formulierung, die das Tool/Widget auslöst).

---

## 1. MCP-Tools (22) — mit Chat-Trigger

### Suchen & Finden
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `search_wlo_all` | Kombi-Suche: Materialien + Sammlungen + Themenseiten in einem Aufruf (der Standard-Einstieg) | *„Ich suche Bildungsinhalte für eine Mathestunde zur Bruchrechnung"* |
| `search_wlo_content` | Nur einzelne Materialien (Videos, Arbeitsblätter …) | *„Zeig mir ein Video zur Eiszeit für die 6. Klasse"* |
| `search_wlo_collections` | Sammlungen/Themenseiten zu einem Thema | *„Gibt es eine WLO-Sammlung zum Klimawandel?"* |
| `search_wlo_topic_pages` | Themenseiten suchen (liefert deren URLs/Varianten) | *„Welche WLO-Themenseiten gibt es zu Optik?"* |

### Themenseiten (Schwimmlinien)
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `get_topic_page_content` | Render-fertige Schwimmlinien einer Themenseite — jetzt in einem Schritt per Thema | *„Zeig mir die Themenseite zu Optik mit den Schwimmlinien"* |

### Stöbern & Navigieren
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `get_subject_portals` | Übersicht aller Fachportale (Mathe, Bio, Deutsch …) | *„Welche Fächer gibt es bei WLO?"* |
| `browse_collection_tree` | Themenbaum / Unterthemen eines Fachs oder einer Sammlung | *„Zeig mir den Themenbaum zu Mathematik"* |
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

## 2. Widgets (3 interaktive Oberflächen)

| Widget | Ausgelöst durch | Trigger-Beispiel | Was man sieht |
|---|---|---|---|
| **search-results** | `search_wlo_all` | *„Ich suche Material zur Bruchrechnung"* | Sammlungs-/Themenseiten-Band oben, Material-Karten darunter, „Details"-Button → Einzelansicht |
| **topic-page** | `get_topic_page_content` | *„Zeig die Themenseite zu Optik"* | Titel + Beschreibung, darunter Schwimmlinien mit Karten |
| **browse** | `get_subject_portals`, `browse_collection_tree` | *„Zeig mir den Themenbaum zu Mathematik"* | Statisch vor-aufgeklappter Baum; Auf-/Zuklappen lokal; „Inhalte anzeigen"-Button lädt tiefere Ebenen als neue Karte |

---

## 3. REST-Endpunkte (öffentlich, nur lesend — für Nicht-MCP-KIs/Launcher)

| Methode + Pfad | Funktion | Trigger / Aufruf |
|---|---|---|
| `GET /api/search/<Begriff>` | Suche, Pfad-Form (übersteht Query-Stripping) | `…/api/search/Bruchrechnung?discipline=Mathematik` |
| `GET /api/search?q=<Begriff>` | Suche, Query-Form (Alias) — ohne Begriff: 200-Hinweis-Envelope | `…/api/search?q=Eiszeit&learningResourceType=Video` |
| `…&format=html` | Dieselbe Suche als lesbare HTML-Seite (für Reader-KIs/Menschen) | `…/api/search/Bruchrechnung?format=html` |
| `GET /api/topic-page?collectionId=…` | Schwimmlinien einer Themenseite | `…/api/topic-page?collectionId=<id>` |
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
