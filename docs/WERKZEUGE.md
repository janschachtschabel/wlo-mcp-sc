# WLO MCP Server — alle Werkzeuge in einer Zeile

Stand 1.2.0: 60 Werkzeuge in der Vorgabe (34 lesend, 26 kuratierend), dazu 4 Stapel-Werkzeuge nur mit
`WLO_BATCH_UPLOAD_ENABLED` und 4 Auftrags-Werkzeuge, wo das Repository den b-api-Proxy hat. Reihenfolge nach Thema. Parameter und Antworten:
[`TOOLS.md`](TOOLS.md), als Tabelle: [`TOOLS-KOMPAKT.md`](TOOLS-KOMPAKT.md).

## Lesend (34)

**Suchen**

- `search_wlo_all` — Materialien, Sammlungen und Themenseiten in einem Aufruf suchen.
- `search_wlo_content` — nur einzelne Materialien suchen (Video, Arbeitsblatt, interaktives Medium).
- `search_wlo_collections` — kuratierte Sammlungen zu einem Thema suchen.
- `search_wlo_within_collection` — Inhalte innerhalb einer bestimmten Sammlung suchen und filtern.
- `search_wlo_topic_pages` — Themenseiten zu Thema, Fach oder Bildungsstufe finden.
- `search_wlo_content_many` — mehrere Inhaltssuchen in einem Aufruf, je Anfrage wenige Kurztreffer.
- `count_wlo_content_matches` — für viele Suchanfragen zählen, wie viele Inhalte passen.

**Sammlungen**

- `get_subject_portals` — die Fachportale, also die obersten Sammlungen je Fach.
- `get_collection_contents` — Materialien und Untersammlungen einer Sammlung auflisten.
- `browse_collection_tree` — die Unterthemen einer Sammlung als Baum durchgehen.
- `list_collection_tree` — den Teilbaum einer Sammlung als flache Liste mit Pfaden, bis Tiefe 4.
- `get_collection_overview` — eine Sammlung auf einen Blick: Pfad, Gliederung, Zahlen, erste Inhalte.
- `get_collection_stats` — woraus eine Sammlung besteht, nach Typ, Fach und Stufe.

**Details**

- `get_node_details` — die Metadaten eines Datensatzes: Titel, Fach, Stufe, Lizenz, Anbieter, Link.
- `get_nodes_details` — dasselbe für mehrere Datensätze in einem Aufruf.
- `get_related_content` — ähnliche Materialien zu einem Inhalt.
- `get_node_breadcrumb` — der Pfad von der Wurzel bis zum Knoten im Themenbaum.
- `get_node_collections` — in welchen Sammlungen ein Material liegt.
- `find_content_by_url` — prüft für bis zu 20 Adressen, ob es schon einen Datensatz gibt.

**Texte**

- `get_wlo_content_text` — der eigentliche Text eines Materials statt seiner Metadaten.
- `get_compendium_text` — der redaktionelle Kompendiumstext einer oder mehrerer Sammlungen.
- `get_wikipedia_summary` — Wikipedia zu einem Begriff, als Anriss oder ganzer Artikel.
- `get_url_text` — der Text hinter einer beliebigen Web-Adresse (als unsicher deklariert, abschaltbar).
- `get_topic_page_content` — eine Themenseite mit ihren Schwimmlinien.

**Vokabular und Anbieter**

- `lookup_wlo_vocabulary` — die gültigen Werte eines Feldes, für Filter und zum Schreiben.
- `resolve_wlo_filters` — alle Filter-Bezeichnungen eines Vorhabens auf einmal auflösen.
- `lookup_wlo_publishers` — die Anbieter der Inhalte, je mit Anzahl.

**Skills**

- `search_skill` — KI-Skills mit Anleitung passend zu einer Aufgabe suchen.
- `get_skill` — die Anleitung (SKILL.md) eines Skills laden.
- `get_skill_registry` — die von einer Sammlung freigegebenen Skills, auf Wunsch gleich mit Anleitung.

**System und ChatGPT-Konvention**

- `wlo_auth_status` — mit welcher Anmeldung und welchen Rechten der Server gerade arbeitet.
- `wlo_health_check` — ob das Repository erreichbar ist.
- `search` — leichte Treffer als Belegstellen für ChatGPT.
- `fetch` — der Volltext zu einem `search`-Treffer.

## Kuratierend (26, Anmeldung nötig, jeweils mit Vorschau und Bestätigung)

**Ein Datensatz**

- `wlo_create_content` — einen neuen Datensatz anlegen, wahlweise gleich in eine Sammlung.
- `wlo_update_content` — Metadaten oder Datei eines vorhandenen Datensatzes ändern.
- `wlo_submit_content` — einen Datensatz zur redaktionellen Prüfung einreichen.
- `wlo_attach_fulltext` — einen Volltext an einen Datensatz ohne Datei hängen.
- `wlo_delete_content` — einen Datensatz endgültig löschen.

**Viele Datensätze**

- `wlo_update_contents` — Metadaten vieler Datensätze ändern oder vorschlagen.
- `wlo_attach_fulltexts` — Volltexte für viele Datensätze ablegen.
- `wlo_submit_contents` — viele Datensätze zur Prüfung einreichen.

**Sammlungen**

- `wlo_create_collection` — eine neue Sammlung anlegen.
- `wlo_create_collection_tree` — einen ganzen Sammlungsbaum anlegen.
- `wlo_rename_collection` — Titel und Beschreibung einer Sammlung ändern.
- `wlo_move_collection` — eine Sammlung samt Untersammlungen unter eine andere hängen.
- `wlo_order_collection` — die Reihenfolge der Untersammlungen oder Inhalte setzen.
- `wlo_add_to_collection` — ein Material in eine Sammlung aufnehmen oder, ohne Schreibrecht, vorschlagen.
- `wlo_add_to_collections` — viele Materialien in Sammlungen aufnehmen.
- `wlo_remove_from_collection` — ein Material aus einer Sammlung herausnehmen (das Material bleibt).
- `wlo_remove_from_collections` — viele Materialien aus Sammlungen herausnehmen.
- `wlo_list_collection_proposals` — die für eine Sammlung vorgeschlagenen Materialien zeigen.
- `wlo_decide_collection_proposal` — einen Vorschlag an eine Sammlung annehmen oder ablehnen.
- `wlo_delete_collection` — eine Sammlung samt Untersammlungen endgültig löschen.
- `wlo_delete_collections` — viele leere Sammlungen löschen.

**Themenseiten und Kompendium**

- `wlo_update_compendium` — den Kompendiumstext einer Sammlung schreiben oder ersetzen.
- `wlo_set_topic_page` — festlegen, welche Variante eine Themenseite öffentlich zeigt.

**Metadaten-Vorschläge**

- `wlo_suggest_metadata` — Metadaten vorschlagen, ohne den Datensatz zu ändern.
- `wlo_list_suggestions` — die Vorschläge zu einem Datensatz mit Begründung und Status zeigen.
- `wlo_decide_suggestion` — einen Vorschlag annehmen oder ablehnen.

## Stapel-Ablage (4, nur mit `WLO_BATCH_UPLOAD_ENABLED`)

- `wlo_prepare_file_batch` — eine Stapel-Ablage von Dateien vorbereiten und freigeben lassen.
- `wlo_store_batch_file` — eine Datei des Stapels ablegen (Bytes vorher über `POST /api/uploads`).
- `wlo_store_batch_manifest` — die `vorgang.json` zum Stapel ablegen.
- `wlo_list_my_batches` — die eigenen Ablagen zeigen, neueste zuerst.

## Aufträge der b-api (4, nur mit b-api-Proxy, `WLO_BAPI_VIA_REPOSITORY`)

- `wlo_start_flow` — einen freigegebenen Auftrag (Kestra-Flow) als die angemeldete Person starten, mit Vorschau.
- `wlo_flow_status` — Stand, Fortschritt und Ergebnis eines eigenen Auftrags.
- `wlo_cancel_flow` — einen eigenen laufenden Auftrag abbrechen.
- `wlo_list_flows` — die Aufträge, die diese Anmeldung hier starten darf.
