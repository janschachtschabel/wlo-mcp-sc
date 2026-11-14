# Rückmeldung an das Chatbot-Team: was am WLO-MCP-Server umgesetzt ist

Stand 14.11.2026, Commit `8cbc051` auf `janschachtschabel/wlo-mcp-sc`. Antwort auf eure
Rückmeldung vom 13.11. (zweite Fassung, D1–D13) und den Nachtrag „weniger Runden, weniger
Wartezeit" (Z1–Z5, B1, B2).

**Wichtig vorab:** Der bereitgestellte Server (`wlo-mcp.87.106.195.152.nip.io`) läuft noch auf
einem älteren Stand (50 Werkzeuge). Alles hier gilt ab dem nächsten Deploy. Die Werkzeugliste
hat dann 52 Einträge: 33 zum Lesen, 19 zum Kuratieren.

## 1. Was ihr anpassen müsst

Diese Änderungen verhalten sich anders als bisher. Alles Übrige ist Zusatz.

| Änderung | Bisher | Jetzt |
|---|---|---|
| Vokabularwert beim **Schreiben** (Fach, Stufe, Zielgruppe, Inhaltstyp) | ein Teilwort wurde geraten („Wirtschaft" → Agrarwirtschaft) | nur Name, Alias oder URI; sonst Ablehnung mit `error.candidates` — ihr wählt |
| Fehlercode für einen 404 | `upstream_error` | `not_found` (auch in `missing[].code`) |
| Abgelehnte Unterliste (401/403/404) | als Ausfall gemeldet („später erneut") | eigener Hinweis; kein `incomplete` mehr dafür |
| `wlo_submit_content` mit Sammlung oder Ordner | wurde angenommen | `is_a_collection` / `is_a_folder` |
| `textContentUnreadable` in der Suche | auch für Markdown, Bilder, Audio, Video | nur noch für echte Lesefehler; „kein Text" ist ein leeres `textContent` |
| Zwei Inhaltstyp-Namen („Suchmaschine", „Stationenlernen") | per Name schreibbar | mehrdeutig, nur per URI (`lookup_wlo_vocabulary("contentType")` nennt sie) |

## 2. Eure Punkte D1–D13

| Punkt | Ergebnis |
|---|---|
| D1 | Einreichen lehnt Sammlungen und Ordner ab. |
| D2 | Titel und Beschreibung einer Sammlung landen in `cm:title` / `cm:description`, also dort, wo die Sammlung sie liest. Gemessen: `cclom:title` an einer Sammlung wurde als zweites Feld gespeichert und war danach für Umbenennungen unerreichbar. |
| D3 | `error.nodeId` steht bei jedem Fehler mit `recordExists`. |
| D4 | `too_many_batches` nennt `scope`. |
| D5 | `search_skill` nennt `incompleteReason`. |
| D6 | Abgelehnt ist nicht „nicht erreichbar" (siehe Tabelle oben). |
| D7 | `incomplete` steht auch im JSON-Text, nicht nur in `structuredContent`. |
| D8 | Log-Felder `timestamp`, `level`, `service`, `message`; über HTTP nach stdout; `LOG_LEVEL`. |
| D9 | Dauern als Histogramme (`wlo_tool_duration_seconds`, `wlo_upstream_duration_seconds`, `wlo_http_request_duration_seconds`), dazu Prozessmetriken. |
| D10 | `INTERNAL_PORT`: zweiter Port nur für `/health`, `/ready`, `/metrics`. |
| D11 | Ressourcen gemessen: 72 MB im Leerlauf, 172 MB bei 30 gleichzeitigen Suchen, schlimmster Fall rund 480 MB. Zahlen in `docs/DEPLOYMENT.md` §5.0.2. |
| D12 | `docs/openapi.yaml` für die 40 Pfade außerhalb von MCP; Antwortzeiten je Werkzeug in `docs/INTEGRATION.md` §7. |
| D13 | Entwurf eines Helm-Charts (`deploy/helm/wlo-mcp/`) und `docs/STECKBRIEF.md`. Auf keinem Cluster installiert. |

Aus eurer ersten Fassung zusätzlich erledigt: `x-client-trace-id` wird gelesen, geloggt und ans
Repository weitergegeben; `get_skill` trägt `structuredContent {found, contentLoaded, contentRefused?}`.

## 3. Der Nachtrag Z1–Z5, B1, B2

- **Z1 – kein Raten beim Schreiben.** Siehe Tabelle. Rund 60 gängige Schreibweisen sind als
  Aliasse ergänzt („Lehrkräfte", „SuS", „Gemeinschaftskunde" → Politik). Wird ein Wert über
  einen Alias aufgelöst, sagt die Vorschau das.
- **Z2 – Vorschau nennt, worum es geht.** Erste Zeile: Art, Titel und Kennung
  (`Datensatz: „Titel" (id)`); der Inhaltstyp steht als Name statt als URI.
- **Z3 – Sammlung per Name.** Fünf Lesewerkzeuge nehmen `collection` (Titel) statt der ID:
  `get_collection_contents`, `search_wlo_within_collection`, `browse_collection_tree`,
  `get_collection_overview`, `get_compendium_text`. Optional `discipline` zum Eingrenzen
  (bei `search_wlo_within_collection` heißt er `collectionDiscipline`). Genommen wird nur
  genau ein gleicher Titel; sonst `ambiguous_collection` mit Kandidaten. Die Antwort nennt
  die gewählte Sammlung in `resolvedCollection`. Gemessen an 24 Titeln: 12 mit Fach, 9 ohne
  wurden aufgelöst. Schreibwerkzeuge verlangen weiter die ID.
- **Z4 – mehrere Suchen in einem Aufruf.** `search_wlo_content_many`: bis zu acht Suchen, je
  bis zu fünf Treffer, dieselben Filter wie `search_wlo_content`. Gemessen: 0,6–1,0 s gegen
  1,3–2,9 s für fünf gleichzeitige Einzelsuchen (kleine Stichprobe).
- **Z5 – Dubletten vor dem Anlegen.** Die Vorschau von `wlo_create_content` nennt Datensätze,
  die unter einer bereinigten Schreibweise derselben Adresse schon existieren.
- **B1 – Listen und Ergänzen.** Fach, Stufe, Typ und Zielgruppe nehmen Text oder Liste.
  Ersetzen bleibt der Standard. Zum Hinzufügen gibt es eigene Parameter: `addDiscipline`,
  `addEducationalContext`, `addUserRole`. Die Vorschau zeigt dann die bisherigen Werte mit.
- **B2 – Inhaltstypen nachschlagen.** `lookup_wlo_vocabulary("contentType")`.

## 4. Volltext und Dateien

- **Volltext an einen Datensatz mit Datei geht nicht (W4).** Gemessen auf Staging: Das
  Schreiben über `textContent` ersetzt die Datei. `wlo_attach_fulltext` lehnt solche
  Datensätze deshalb dauerhaft ab (`would_replace_file`). Ohne Datei und ohne Link
  funktioniert es. Das deckt sich mit eurem Dokument vom 10.11.
- **Was `get_wlo_content_text` liefert**, gemessen je Format: Text bei txt, PDF mit
  Textebene, docx, xlsx, odt; keiner bei Bildern, Audio, Video und PDFs ohne Textebene.
- **Markdown:** Das Repository gewinnt daraus keinen Text. Ist der Datensatz öffentlich,
  lesen wir jetzt die Datei selbst (auch bei `includeTextContent` und `fetch`). Bei privaten
  Datensätzen bleibt es bei `not_extracted`.
- **Sehr lange Texte:** Gelesen wird bis 4 MiB. War die Quelle größer, steht
  `charCountIsLowerBound: true` in der Antwort.
- **Uploads:** Elf Dateiarten geprüft, alle werden angenommen. Dauer: 1 MB 3 s, 10 MB 18 s,
  50 MB 85 s.
- **Extraktionsdienst hinter dem B-API-Proxy:** läuft mit
  `WLO_TEXT_EXTRACTION_URL=https://<b-api>/api/v1/proxy/text-extraction` und
  `WLO_TEXT_EXTRACTION_API_KEY`; gegen Staging erprobt.

## 5. Betrieb

- **Logs ohne Personenbezug:** Adresse, Kontoname und Suchbegriff stehen nur als Pseudonym
  im Log (`LOG_PERSONAL_DATA=plain` schaltet auf Klartext).
- **Dienst-ID:** `wlo-mcp` (Paket und Image).
- **`Retry-After`** jetzt auch bei 503 von `/api/wikipedia` und `/ready`.
- **Fehler bei Werkzeugen mit Ausgabeschema:** Ein streng prüfender MCP-Client verwarf
  bisher jede codierte Fehlerantwort. Die Schemata haben jetzt einen Fehlerzweig.
- **OpenAI:** Alle 52 Werkzeuge werden als Funktionen angenommen.

## 6. Nicht umgesetzt

- **Einheitliche Antwortformen und Ausgabeschemata für alle Werkzeuge:** entschieden
  dagegen. Fehlercodes und Wartezeiten sind bereits einheitlich. Meldet euch, wenn euch
  eine konkrete Uneinheitlichkeit behindert.
- **W2/W3:** hängen weiter an den offenen Fragen ans Repository-Team.
- **`WLO_PUBLIC_BASE_URL` erzwingen:** bleibt eine Startwarnung.

## 7. Offene Fragen an euch

1. Prüft euer Client `structuredContent` streng gegen das Ausgabeschema? Dann bitte nach
   dem Deploy melden, ob der Fehlerzweig (`anyOf` auf oberster Ebene) bei euch durchgeht.
2. Reicht euch Z3 mit „genau ein gleicher Titel", oder braucht ihr häufiger die Kandidaten?
3. Gibt es eine Entscheidung, wohin strukturierte Volltexte (Markdown) am Node sollen?
   Davon hängt ab, ob W4 doch noch möglich wird.

Nachlesen: `CHANGELOG.md` (Abschnitt „Unreleased"), `docs/MCP-REFERENZ.md`, `docs/TOOLS.md`.
