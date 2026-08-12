# WLO MCP Server — Werkzeuge kompakt

Ausführliche Referenz: [`TOOLS.md`](./TOOLS.md)

## Lesend (28)

### Suchen

| Tool | Funktion |
|---|---|
| `search_wlo_all` | Sucht Materialien, Sammlungen und Themenseiten in einem Aufruf. |
| `search_wlo_content` | Sucht ausschließlich einzelne Materialien — Video, Arbeitsblatt, interaktives Medium. |
| `search_wlo_collections` | Sucht kuratierte Sammlungen zu einem Thema. |
| `search_wlo_within_collection` | Durchsucht und filtert die Inhalte innerhalb einer bestimmten Sammlung. |
| `search_wlo_topic_pages` | Findet Themenseiten zu einem Thema, Fach oder einer Bildungsstufe. |

### Sammlungen & Stöbern

| Tool | Funktion |
|---|---|
| `get_collection_contents` | Listet auf, was eine Sammlung enthält — Materialien und Unter-Sammlungen. |
| `browse_collection_tree` | Navigiert durch die Unterthemen einer Sammlung oder eines Fachportals. |
| `get_subject_portals` | Zeigt, welche Fächer es gibt — die obersten Fach-Hubs. |
| `get_collection_stats` | Fasst zusammen, woraus eine Sammlung besteht, nach Typ, Fach und Stufe. |

### Details & Verwandtes

| Tool | Funktion |
|---|---|
| `get_node_details` | Die Detailansicht eines Datensatzes: Titel, Fach, Stufe, Lizenz, Anbieter, Link. |
| `get_nodes_details` | Dasselbe für mehrere nodeIds parallel, in einem Aufruf. |
| `get_related_content` | Findet ähnliche Materialien zu einem Inhalt. |
| `get_node_breadcrumb` | Zeigt den Pfad von der Wurzel bis zum Knoten im Themenbaum. |
| `get_node_collections` | Zeigt, in welchen Sammlungen ein Material geführt wird. |

### Volltexte

| Tool | Funktion |
|---|---|
| `get_wlo_content_text` | Der eigentliche Text eines Materials, nicht seine Metadaten. |
| `get_compendium_text` | Der redaktionelle Kompendiumstext einer oder mehrerer Sammlungen. |
| `get_wikipedia_summary` | Wikipedia zu einem Begriff — Anriss oder ganzer Artikel. |
| `get_url_text` | Der Text hinter einer beliebigen Web-Adresse (als unsicher deklariert, abschaltbar). |

### Themenseiten

| Tool | Funktion |
|---|---|
| `get_topic_page_content` | Rendert eine Themenseite mit ihren Schwimmlinien. |

### Vokabular & Anbieter

| Tool | Funktion |
|---|---|
| `lookup_wlo_vocabulary` | Nennt die gültigen Werte für Filter wie Fach, Bildungsstufe oder Inhaltstyp. |
| `lookup_wlo_publishers` | Listet die Anbieter der Inhalte, je mit Anzahl. |

### Skills

| Tool | Funktion |
|---|---|
| `search_skill` | Sucht Skills (Inhaltsart „KI-Skill") mit angehängter Anleitung — passend zu einer Aufgabe. |
| `get_skill` | Lädt die Anleitung (SKILL.md) eines Skills zu seiner nodeId. |
| `get_skill_registry` | Nennt die Skills, die eine Sammlung freigegeben hat. |

### System

| Tool | Funktion |
|---|---|
| `wlo_auth_status` | Sagt, mit welchen Rechten dieser Server gerade liest. |
| `wlo_health_check` | Prüft, ob die WLO-API erreichbar ist. |

### ChatGPT-Wissenskonvention

| Tool | Funktion |
|---|---|
| `search` | Leichte Belegstellen-Treffer für belegte Antworten. |
| `fetch` | Der Volltext zu einem Treffer per id. |

## Kuratierend (14)

### Inhalte

| Tool | Funktion |
|---|---|
| `wlo_create_content` | Legt einen neuen Datensatz an. |
| `wlo_update_content` | Ändert Metadaten und/oder den Inhalt eines vorhandenen Datensatzes. |
| `wlo_submit_content` | Reicht einen Datensatz zur redaktionellen Prüfung ein. |
| `wlo_delete_content` | Löscht einen Datensatz endgültig. |

### Sammlungen

| Tool | Funktion |
|---|---|
| `wlo_create_collection` | Legt eine neue Sammlung an. |
| `wlo_rename_collection` | Ändert Titel und Beschreibung einer Sammlung. |
| `wlo_add_to_collection` | Nimmt ein vorhandenes Material in eine Sammlung auf. |
| `wlo_remove_from_collection` | Nimmt ein Material wieder aus einer Sammlung heraus. |
| `wlo_delete_collection` | Löscht eine Sammlung endgültig, samt Untersammlungen. |

### Themenseiten & Kompendium

| Tool | Funktion |
|---|---|
| `wlo_update_compendium` | Schreibt oder ersetzt den Kompendialtext einer Sammlung. |
| `wlo_set_topic_page` | Legt fest, welche Variante eine Themenseite öffentlich rendert. |

### Vorschläge

| Tool | Funktion |
|---|---|
| `wlo_suggest_metadata` | Schlägt Metadaten vor, ohne den Datensatz zu ändern. |
| `wlo_list_suggestions` | Zeigt die hinterlegten Vorschläge zu einem Datensatz mit Begründung und Status. |
| `wlo_decide_suggestion` | Nimmt einen Vorschlag an oder lehnt ihn ab. |
