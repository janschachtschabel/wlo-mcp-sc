# WLO MCP Server — Referenz

Stellt die offenen Bildungsinhalte von WirLernenOnline (edu-sharing) über das
Model Context Protocol bereit: Suche, Sammlungen, Themenseiten, Volltexte,
KI-Skills — und, nach Anmeldung, das Kuratieren von Datensätzen.

| | |
|---|---|
| **Endpunkt** | `https://wlo-mcp.87.106.195.152.nip.io/mcp` |
| **Quellcode** | <https://github.com/janschachtschabel/wlo-mcp-sc> |
| **Transport** | Streamable HTTP (`POST /mcp`), SSE optional · stdio lokal |
| **Werkzeuge** | 28 lesend · 14 kuratierend = **42** |
| **Widgets** | 4 |
| **Env-Schlüssel** | 34 vom Server gelesen, dazu 3 für den Container |

Erhoben aus dem Quellcode, nicht aus dem Gedächtnis: Werkzeugliste und
Parameter stammen aus `tools/list` des laufenden Servers, die Trefferzahlen aus
einem echten Aufruf gegen Staging (zuletzt 2026-08-20, nach dem Deploy mit
31 Proben am laufenden Server verifiziert).

---

## 1. Anschluss

Ein Client **ohne** `Authorization`-Header bekommt `200` und die **volle**
Werkzeugliste — alle 42, die Kuratier-Werkzeuge eingeschlossen. Das ist Absicht:
ein Modell, das ein Schreibwerkzeug nie sieht, ruft es nie auf, und dann fordert
nichts den Host je zur Anmeldung auf. Der *Aufruf* wird zur Laufzeit abgewiesen
und trägt die `WWW-Authenticate`-Aufforderung, die den Login startet.

Clients ohne Header-Feld (etwa der ChatGPT-Connector) nutzen OAuth 2.1: beide
Discovery-Dokumente und `/oauth/register` stehen bereit, die Registrierung ist
offen, PKCE ist Pflicht. Das Zugriffs-Token **ist** der verschlüsselte
Zugangsblock — es liegt kein Passwort auf der Platte und es gibt keinen
Session-Store.

---

## 2. Anmeldung: was womit geht

| Identität | Lesen | Schreiben | Wie |
|---|---|---|---|
| **anonym** | alle 28 | **nie** | kein Header. Die öffentliche Fläche bleibt lesend. |
| **eigenes WLO-Konto** | alle 28 | alle 14 | OAuth 2.1, oder ein `wlo2.…`-Block als `Bearer`, oder `Basic`. Jede Änderung ist einer Person zurechenbar. |
| **Dienstkonto** | alle 28 | nur mit `WLO_ALLOW_SERVICE_WRITES` | Sonst stünde in der Versionshistorie „wlo-mcp" für eine Änderung, die irgendwer wollte. |

Der Zugangsblock wird unter `/auth` geholt (das Passwort wird **im Browser**
verschlüsselt) und unter `/auth/revoke` widerrufen. Eingebettete Widgets, die
schon wissen, wer angemeldet ist, tauschen unter `POST /auth/ticket` ein
edu-sharing-Ticket gegen einen gewöhnlichen Block. Der ganze Mechanismus ist
aus, solange `WLO_AUTH_PRIVATE_KEY` nicht gesetzt ist.

**Jede Änderung ist zweistufig.** Ein Kuratier-Aufruf ohne `confirmToken` erzeugt
ausschließlich eine Vorschau der Änderungsmenge und einen einmalig gültigen
Schlüssel. Der Schlüssel bindet an einen Fingerabdruck genau dieser Menge — was
nicht in der Vorschau stand, kann nicht mitgeschrieben werden. Danach wird jeder
Schreibvorgang zurückgelesen, weil edu-sharing drei Wege kennt, eine Änderung zu
verwerfen und trotzdem `200` zu antworten.

---

## 3. An/Aus-Schalter

Alles über Umgebungsvariablen. Nur `WLO_SKILL_CACHE` ist **an** by default; alle
anderen Schalter sind aus, solange sie nicht gesetzt werden.

> **Zwei Standards, nicht einer.** Was der Code annimmt, wenn nichts gesetzt ist,
> und was `docker-compose.yml` in den Container reicht, ist bei zwei Schlüsseln
> **entgegengesetzt** (`WLO_DISABLE_UNSAFE_TOOLS`, `TRUST_PROXY`). Die Spalte
> „Standard" nennt deshalb beide, wo sie auseinandergehen. Maßgeblich für eine
> Installation ist der Container-Wert.

| Schalter | Standard | Wirkt auf | Effekt |
|---|---|---|---|
| `WLO_AUTH_PRIVATE_KEY` | **aus** | die gesamte Anmeldung | Ohne ihn gibt es keinen Zugangsblock, kein OAuth und keine `/auth`-Seiten. Der Server ist dann rein lesend — oder schreibt unter dem Dienstkonto, falls dessen Schalter gesetzt ist. |
| `WLO_ALLOW_SERVICE_WRITES` | **aus** | die 14 Kuratier-Werkzeuge im Dienstkonto-Modus | An: das geteilte Konto darf ändern. Aus: Absage zur Laufzeit. Betrifft auch **stdio** — dort kommen die Zugangsdaten aus der Umgebung und gelten deshalb als Dienstkonto, selbst wenn es das eigene Login ist. |
| `WLO_ALLOW_PREPARED_WRITES` | **aus** | die Antwortform der Kuratier-Werkzeuge | An: ein *angemeldeter* Aufrufer kann einen Schreibvorgang **vorbereiten** statt ausführen — die Antwort ist eine Beschreibung der Anfrage, die ein Widget mit der Sitzung der Nutzerin abschickt. Gibt keine Rechte, nur eine andere Antwortform. Anonyme bekommen auch damit nichts. |
| `WLO_DISABLE_UNSAFE_TOOLS` | Code: **aus** (Werkzeug AN)<br>Container: **`all`** (Werkzeug AUS) | `get_url_text` | `all`, `1`, `true`, `yes` oder `on` schaltet **jedes** als unsicher erklärte Werkzeug ab; sonst eine komma- oder leerzeichengetrennte Namensliste. Ein „all" irgendwo in der Liste gewinnt. Das Werkzeug verschwindet aus `tools/list`.<br><br>**Achtung, die beiden Standards sind entgegengesetzt.** Im Code sind unsichere Werkzeuge an (deshalb warnt der Start beim Registrieren jedes einzelnen); `docker-compose.yml` dreht das auf `all`, weil eine Installation genau der Ort ist, an dem das nicht schließbare Risiko zählt. Zum Einschalten im Container die Variable **ausdrücklich leer** setzen — compose nutzt `${VAR-all}` ohne Doppelpunkt, greift also nur bei *ungesetzt*. |
| `WLO_DISABLE_SKILL_SEARCH` | **aus** | `search_skill` | An: die repository-weite Skill-Suche entfällt — für eine Installation, die auf den Registry-Prozess umgestellt hat (ein Skill wird über die Sammlung erreicht, die ihn freigibt). `get_skill` und `get_skill_registry` bleiben unberührt: die Registry gibt nodeIds aus, und `get_skill` ist genau wofür sie da sind. Nur ein ausdrückliches Ja schaltet ab — die Zeichenkette `"false"` darf nicht als „ja" gelesen werden.<br><br>**Wirkt nur im `two-tool`-Modus.** Unter `WLO_SKILL_TOOL_MODE=one-tool` wird die Fahne **ignoriert**: dort *ist* `get_skill_for_task` die Suche, und sie abzuschalten ließe den Modus ohne jeden Weg, einen Skill zu finden. Gemessen 2026-08-19. |
| `WLO_SKILL_TOOL_MODE` | `two-tool` | `search_skill` ↔ `get_skill_for_task` | `one-tool` tauscht **die Suche allein** gegen ein Werkzeug, das den passenden Skill sucht *und* lädt. Die Werkzeuganzahl ändert sich **nicht**, und `get_skill` ist in **jedem** Modus registriert — es ist das einzige Werkzeug, das eine nodeId nimmt, und die Freigabelisten geben nodeIds aus.<br><br>**Hebt `WLO_DISABLE_SKILL_SEARCH` auf**, siehe dort. |
| `WLO_SEARCH_OUTPUT_MODE` | `lean` | `search` **und** `fetch` | `rich`: `search` liefert die vollen Töpfe von `search_wlo_all` samt Widget, `fetch` den vollen Datensatz samt Detailansicht. Der Schalter deckt beide, weil `search` → `fetch` ein Fluss ist — nur den ersten Schritt anzureichern ließe den zweiten nichts rendern. Die Konventionsform (ein einziger Parameter) bleibt in beiden Modi unangetastet. |
| `WLO_SKILL_CACHE` | **AN** | den Freigabekatalog an Sammlungs-Antworten | Hält die Registry jeder Sammlung im Hintergrund warm, damit ein Sammlungstreffer seinen Katalog kostenlos tragen kann. Nur ein ausdrückliches `0`, `false`, `no` oder `off` schaltet ab. Der Schalter deckt **Zeitgeber und Anfragepfad**: ohne Tick darf auch der Live-Rückfall nicht laufen, sonst zahlt jede Anfrage die volle Kinderliste, während nichts sie je verfallen ließe. |
| `WLO_TEXT_EXTRACTION_URL` | gesetzt | `get_url_text`, Volltext-Rückfall | Leer: der Extraktionsdienst ist aus, `get_url_text` antwortet mit nichts, und Volltext kommt nur noch aus `/textContent` des Repositoriums. Der Start warnt. |
| `WLO_SKILLS_COLLECTION_ID` | leer | `search_skill` | Verengt die Suche auf eine Sammlung — schaltet nichts ab. |

### Rezept: nur der Registry-Weg

Skill-Suche aus, Skills erreichbar über `get_skill_registry` und `get_skill`, der
Katalog kommt aus dem Cache, den gewöhnliche Sammlungs-Antworten füllen:

```dotenv
WLO_DISABLE_SKILL_SEARCH=1
```

Mehr nicht. `WLO_SKILL_TOOL_MODE` **ungesetzt lassen** (`one-tool` würde die
Suche als `get_skill_for_task` zurückbringen) und `WLO_SKILL_CACHE` ebenfalls —
er ist an, solange man ihn nicht abschaltet. `WLO_SKILLS_COLLECTION_ID` wird
gegenstandslos, weil es nur die Suche verengt.

Gemessen 2026-08-19 über `tools/list`, nach dem Deploy am 2026-08-20 live
bestätigt (41 Werkzeuge im Registry-Modus):

| Konfiguration | Skill-Werkzeuge | Gesamt |
|---|---|---:|
| nichts gesetzt | `get_skill` · `get_skill_registry` · `search_skill` | 42 |
| **`WLO_DISABLE_SKILL_SEARCH=1`** | **`get_skill` · `get_skill_registry`** | **41** |
| dasselbe **+ `WLO_SKILL_TOOL_MODE=one-tool`** | `get_skill` · `get_skill_for_task` · `get_skill_registry` | 42 |

Den Cache füllen die Sammlungs-Antworten von `search_wlo_all`,
`search_wlo_collections`, `get_collection_contents`,
`search_wlo_within_collection`, `get_node_details` und `get_related_content` —
je gesehener Sammlung ein Eintrag, ohne Vorab-Durchlauf des Baums. Der
Hintergrund-Zeitgeber startet in `http.ts` bzw. `stdio.ts`.
`get_skill_registry` hängt **nicht** am Cache: es liest die Registry der
genannten Sammlung live und funktioniert auch bei abgeschaltetem Cache.

---

## 4. Was zurückkommt

Jedes Suchwerkzeug liefert drei Dinge nebeneinander:

1. einen **Textblock** — Markdown oder JSON, je `outputFormat`
2. **`structuredContent`** mit demselben Envelope
3. einen **`_queryMeta`**-Block mit `pagination {maxItems, skipCount, totalResults}`,
   den Suchkriterien, einer `searchUrl` sowie — falls vorhanden —
   `unresolvedFilters` (mit bis zu drei Vorschlägen) und `facets`

### Datensatz: 19 Felder

```
nodeId · title · description (400 Zeichen) · keywords (max. 10) · disciplines ·
educationalContexts · userRoles · learningResourceTypes · url · downloadUrl ·
contentUrl · previewUrl · previewIsIcon · mimeType · fileSize · license ·
publisher · nodeType · topicPageUrl
```

Gemessen an einem echten Treffer: **898 Zeichen JSON je Datensatz**, davon
**34 % allein die vier URL-Felder**. Optional kommen hinzu: `hasCompendium`
(nur das Signal — der Text selbst kommt über `get_compendium_text` oder
`includeCompendium`; bis 2026-08-20 reiste er ungekappt mit, gemessen 37 428
Zeichen in einem einzigen Optik-Treffer), `compendiumText` (nur nach
`includeCompendium`), `textContent` (500 Z.), `skillRegistry` (der
Freigabekatalog — an Sammlungs- **und** Themenseiten-Treffern; ob die Prüfung
lief, sagen `collections.registryChecked` bzw. `topicPages.registryChecked`),
`originalId` (nur wenn der Datensatz eine Verknüpfung ist).

### Wie viele Treffer, und welche Zahl dazu

| Werkzeug | Standard | Max. | Gelieferte Zahl |
|---|---:|---:|---|
| `search_wlo_all` | 8 + 5 + 5 | 50 / 20 / 20 | `content.total` = **echte** Trefferzahl · `collections.total` und `topicPages.total` = gezeigte Anzahl |
| `search_wlo_content` | 8 | 50 | **echte** Backend-Trefferzahl |
| `search_wlo_collections` | 5 | 50 | gefundene Sammlungen vor dem Deckel — keine Korpuszahl |
| `get_collection_contents` | 20 | 100 | **echte** Kinderzahl der Sammlung |
| `search_wlo_within_collection` | 10 | 50 | lokal passende Kinder, begrenzt durch das Gelesene |
| `search_wlo_topic_pages` | 5 | 20 | gezeigte Anzahl |
| `get_related_content` | 8 | 30 | gezeigte Anzahl |
| `browse_collection_tree` | 50 | 100 | gezeigte Anzahl |
| `search` | 10 + 5 | fest | keine |

> **Nur drei Werkzeuge liefern eine echte Bestandszahl.** Überall sonst ist
> `total` das, was gezeigt wird. Eine Antwort mit `content.total: 1269` neben
> `collections.total: 5` stellt eine Korpuszahl neben eine Seitengröße — die
> Werkzeugbeschreibung sagt es („Nur content.total ist eine echte Trefferzahl"),
> am Feldnamen ist es nicht ablesbar. Eine typische Antwort trägt **8–20
> Datensätze**.

---

## 5. Werkzeuge

`*` = Pflichtparameter, `=n` = Standardwert.

### 5.1 Suche — ohne Anmeldung

| Werkzeug | Funktion | Parameter |
|---|---|---|
| `search_wlo_all` | **Der Standard-Einstieg** für den Überblick: ein Aufruf liefert Materialien, Sammlungen und Themenseiten. Steht fest, dass NUR Einzelmaterialien eines Typs gewünscht sind, ist `search_wlo_content` die Verengung. | `query*` · discipline · educationalContext · userRole · learningResourceType · publisher · license · maxContent`=8` · maxCollections`=5` · include · excludeNodeIds · skipCount · includeFacets · includeCompendium · includeTextContent · includeSkillRegistry · includeWikipedia · includeTopicPageContent · maxPerSwimlane`=3` · outputFormat |
| `search_wlo_content` | Nur Einzelmaterialien, ohne Sammlungen und Themenseiten — die bewusste Verengung für „ausschließlich Videos zu …". | `query*` · dieselben Filter · maxResults`=8` · skipCount · excludeNodeIds · includeTextContent · includeFacets · outputFormat |

> **Rahmenwörter und Medienwörter (seit 2026-08-21, beide Suchwerkzeuge).** Das
> Repository verundet jedes Wort der `query`, und Anfrage-Rahmenwörter stehen in
> fast keinem Datensatz — „Unterrichtsstunde Französische Revolution" fand 0 von
> 480 Treffern. Die Suche bildet deshalb intern eine zusätzliche Themen-Variante
> ohne diese Wörter. Nennt die `query` dabei ein **eindeutiges Medium** (Video,
> Arbeitsblatt, Übung, Bild, Simulation, Podcast) und ist `learningResourceType`
> nicht gesetzt, wird es als Inhaltstyp-Filter übernommen — „Arbeitsblatt KI"
> sucht nach *KI* und filtert auf *Arbeitsblätter*. Die Ableitung wird
> offengelegt: als Satz in der Antwort und als Feld `derivedResourceType`
> (top-level bzw. im `content`-Eimer neben `licenseFilter`). Ein explizit
> gesetzter Parameter gewinnt immer; generische Wörter (Material,
> Bildungsinhalte) leiten nichts ab. Eine Bildungsstufe wird bewusst **nicht**
> abgeleitet: 30–64 % der Datensätze tragen keine (gemessen 2026-08-21), ein
> Stufenfilter würde sie verbergen statt eingrenzen.

> **Angemeldete Suche und nicht-öffentliche Treffer (seit 22.08.2026).** Eine
> per OAuth/Block angemeldete Suche findet auch Datensätze, die anonym nicht
> lesbar sind. Solche Treffer tragen `isPublic: false`, die Textausgabe sagt
> „Sichtbarkeit: nicht öffentlich — Abruf nur mit Anmeldung", und die Widgets
> zeigen ein Schloss statt des Vorschaubilds — der Bildabruf eines Browsers ist
> immer anonym und bekäme vom Repository nur dessen Rechte-Schild. Für die
> ANGEMELDETE Person holt der Server die gesperrten Vorschauen selbst (mit
> ihrer Anmeldung; bis zu 8 je Antwort, nur Material-Kacheln, nur
> Repository-Adressen, je Bild ein eigenes 4-s-Budget) und liefert sie als
> eingebettete Bilder im widget-eigenen `_meta`-Kanal mit — auch bei
> `search`/`fetch` im rich-Modus. Die Kachel zeigt dann das echte Bild samt
> Sichtbarkeits-Zeile; eine nicht-öffentliche Sammlung trägt ein 🔒-Abzeichen
> (ihre Kachel hat kein Bild). Das Modell bekommt die Bilddaten nie zu sehen.
| `search` | Belegstellen-Suche nach der ChatGPT-Knowledge-Konvention. Minimal: ein Suchbegriff, keine Filter. | `query*` |
| `fetch` | Ein Datensatz per id als vollständiges Dokument (`{id, title, text, url, metadata}`) — die zweite Hälfte derselben Konvention. | `id*` |

Filter nehmen deutsche Labels **oder** URIs. Ein Label, das sich nicht auflösen
lässt, wird nicht still verworfen, sondern in `_queryMeta.unresolvedFilters`
gemeldet. `license: "OER"` fasst die vier frei nachnutzbaren Lizenzen zusammen
(CC0, gemeinfrei, CC BY, CC BY-SA) und filtert **exakt**: „CC BY 4.0" liefert nie
NC- oder ND-Material.

### 5.2 Sammlungen & Navigation — ohne Anmeldung

| Werkzeug | Funktion | Parameter |
|---|---|---|
| `search_wlo_collections` | Kuratierte Bündel zu einem Thema finden. Fragt **beide** Repository-Indizes, weil keiner eine Obermenge des anderen ist. | query · parentNodeId · educationalContext · discipline · maxResults`=5` · excludeNodeIds · includeSkillRegistry · outputFormat |
| `get_collection_contents` | Was in dieser Sammlung liegt — Materialien und Unter-Sammlungen. | `nodeId*` · query · contentFilter (files\|folders\|both) · includeSubcollections · maxResults`=20` · skipCount · excludeNodeIds · skillContext · outputFormat |
| `search_wlo_within_collection` | Innerhalb einer Sammlung suchen und filtern. | `nodeId*` · query · alle Filter · maxResults`=10` · skipCount · skillContext · outputFormat |
| `get_subject_portals` | Welche Fächer/Themen es überhaupt gibt — die obersten Fach-Hubs. | educationalContext · includeContentCounts · outputFormat |
| `browse_collection_tree` | Geführtes Stöbern durch die Unterthemen eines Fachportals. | nodeId · subject · depth`=1` · includeContentCounts · includeContentPreview · maxResults`=50` · outputFormat |
| `get_collection_stats` | Woraus eine Sammlung besteht: Anzahl Dateien und Unter-Sammlungen plus Aufschlüsselung. | `nodeId*` · outputFormat |

### 5.3 Detail & Kontext — ohne Anmeldung

| Werkzeug | Funktion | Parameter |
|---|---|---|
| `get_node_details` | Die Detailansicht: Metadaten als lesbare Labels. `includeQualityInfo` ergänzt die 14 redaktionellen Bewertungen, `includeAccessInfo` Zugang, Kosten, Werbung, Barrierefreiheit und OER-Status — beides **ohne zusätzlichen Abruf**. Kompendium: Markdown zeigt eine 500-Zeichen-Vorschau, JSON nur das Signal `hasCompendium`. | `nodeId*` · includeTextContent · includeParents · includeRaw · includeQualityInfo · includeAccessInfo · skillContext · outputFormat |
| `get_nodes_details` | Dasselbe für bis zu 50 ids parallel. Fehlschläge kommen in `failed` zurück, nicht als Gesamtfehler. | `nodeIds*` · includeTextContent · includeParents · includeQualityInfo · includeAccessInfo |
| `get_related_content` | „Mehr wie dieses" — ähnliche Materialien nach einer Suche oder Detailansicht. | `nodeId*` · maxResults`=8` · includeSiblings · skillContext · outputFormat |
| `get_node_breadcrumb` | Wo eine Sammlung im Themenbaum sitzt — der Pfad von der Wurzel. | `nodeId*` · outputFormat |
| `get_node_collections` | In welchen Sammlungen ein Material geführt wird — jede gefundene Sammlung nennt ihren Katalog freigegebener Skills gleich mit, in beiden Formaten. | `nodeId*` · outputFormat |

### 5.4 Texte — ohne Anmeldung

| Werkzeug | Funktion | Parameter |
|---|---|---|
| `get_wlo_content_text` | Der eigentliche Text eines Materials. Notfalls von der verlinkten Seite — und wenn keiner da ist, wird gesagt warum. | `nodeId*` · maxChars`=200000` · outputFormat |
| `get_compendium_text` | Redaktionelle Prosa einer Sammlung, typischerweise dreiteilig: Weltwissen · Lehrplan-Kompetenzen je Stufe/Bundesland · Vorstellung der Inhalte — der Maßstab für Lückenanalyse, Sachrichtigkeit und Lernpfade. **Mit** `query` kommen per BM25 nur die passenden Absätze, **ohne** der ganze Text mit je Hauptabschnitt gekapptem Umfang. Das Inhaltsverzeichnis geht in beiden Fällen mit (gerendert als `## Inhalt`) — sonst weiß ein Modell nicht, was es *nicht* gesehen hat. Nicht getroffene Suchwörter werden benannt. **Die Antwort wird im Chat nicht angezeigt:** die Absätze sind Arbeitsmaterial für das Modell, das Lese-Widget zeigt nur eine Übergabe-Zeile (`forModel`/`passageCount` in `structuredContent`). Das Modell erhält unverändert alles. | nodeId · nodeIds · query · outputFormat |
| `get_wikipedia_summary` | Anriss oder ganzer Artikeltext. Ein danebenliegender Treffer liefert lieber gar keinen Artikel als den nächstähnlichen String. | `query*` · language`=de` · sections`=1` · fullText · maxChars`=200000` · outputFormat |
| `get_url_text` ⚠️ **unsafe** | Text einer beliebigen Webseite über den Extraktionsdienst. **Nicht für den Produktivbetrieb:** die Seite wird nicht von uns geholt, sondern im Dienst — eine Umleitung ins private Netz ist auf dieser Ebene nicht sichtbar. Abschaltbar über `WLO_DISABLE_UNSAFE_TOOLS`. | `url*` · method (browser\|simple) · maxChars`=200000` · outputFormat |

`maxChars` liegt bei allen drei Volltext-Werkzeugen auf **200 000** Zeichen —
als Obergrenze **und** als Vorgabe (seit 2026-08-20; vorher Vorgabe 8 000,
Decken 50 000 bzw. 100 000): ein Aufruf ohne `maxChars` liefert den ganzen
Text, wer weniger will, sagt es. Die Quellen selbst kappen nicht:
`/textContent` und der Extraktionsdienst liefern ungekürzt. Das
Konventions-Werkzeug `fetch` hat einen festen Deckel von **100 000** Zeichen —
fest, weil es keinen Parameter hat und seine Antwort doppelt reist (Text
**und** `structuredContent`): der Deckel ist die einzige Schranke, die der
Chat-Kontext dort hat. Als Dokumentkörper liefert `fetch` das Kompendium der
Sammlung, sonst den Volltext, sonst die Beschreibung.

### 5.5 Themenseiten — ohne Anmeldung

Eine Themenseite ist eine Sammlung mit einem Seiten-Layout aus Schwimmlinien,
oft in Varianten für Lehrkraft, Lernende oder allgemein.

| Werkzeug | Funktion | Parameter |
|---|---|---|
| `search_wlo_topic_pages` | Themenseiten finden, wahlweise auf eine Zielgruppe eingegrenzt. | query · targetGroup (teacher\|learner\|general) · educationalContext · collectionId · withinCollectionId · mergeVariants`=true` · sort · maxResults`=5` · includeContent · maxPerSwimlane`=3` · outputFormat |
| `get_topic_page_content` | Die Seite mit ihren Schwimmlinien und deren Inhalten, render-fertig. | query · collectionId · variantId · targetGroup · maxPerSwimlane`=3` · skillContext · outputFormat |

Zielgruppe und Bildungsstufe werden **lokal** gefiltert, und ein nicht gesetzter
Wert schließt nie aus: rund 90 % der Varianten tragen keinen von beiden, ein
serverseitiger Filter würde Seiten verstecken statt eingrenzen.

Eine Themenseite hängt an einer Sammlung, und deren Freigabekatalog reist mit
(seit 2026-08-20): Themenseiten-Treffer in `search_wlo_all` tragen den Katalog
wie Sammlungstreffer, und `get_topic_page_content` antwortet im Markdown in
**einem** Content-Block mit dem Katalog inline — mindestens ein realer
MCP-Client reicht dem Modell nur den ersten Block durch. Im JSON bleibt der
Katalog ein zweiter Block, weil Block 1 dort reines JSON ist.

### 5.6 Skills — ohne Anmeldung

Ein Skill ist ein Datensatz mit angehängter `SKILL.md` — eine kuratierte
Anleitung, die ein Modell laden kann.

| Werkzeug | Funktion | Parameter |
|---|---|---|
| `search_skill` | Skills im Repository suchen. Entfällt mit `WLO_DISABLE_SKILL_SEARCH`; unter `WLO_SKILL_TOOL_MODE=one-tool` ersetzt `get_skill_for_task` dieses Werkzeug. | query · maxResults · collectionId · includeSubcollections · discipline · educationalContext · outputFormat |
| `get_skill` | Die Anleitung per nodeId laden — der Markdown-Volltext, wortgetreu und **ohne Längenlimit** (seit 2026-08-20; der 64-KiB-Deckel gewöhnlicher Datei-Downloads gilt auf dem Skill-Pfad nicht — eine halbe Anleitung ist schlimmer als keine). In **jedem** Modus registriert. | `nodeId*` · includeFiles · outputFormat |
| `get_skill_registry` | Welche Skills für **eine** Sammlung freigegeben sind. Mit `context` nur der eine Arbeitszusammenhang samt Anleitung der Redaktion. | `collectionId*` · context · outputFormat |

Der Freigabekatalog reist **kostenlos** an jeder Sammlungs- und
Themenseiten-Antwort mit (aus dem Cache). Ein *benannter* `skillContext` kostet einen Live-Abruf von rund
1,0–1,4 s, weil die Prosa der Redaktion nicht im Cache liegt. Ein Fehlgriff
liefert die vollständige Antwort und nennt die vorhandenen Kontexte — nie einen
Fehler.

### 5.7 Vokabular & Betrieb — ohne Anmeldung

| Werkzeug | Funktion | Parameter |
|---|---|---|
| `lookup_wlo_vocabulary` | Welche Werte ein Feld annimmt — für Filter **und** fürs Schreiben. `qualityScale` nennt jede Stufe jeder Qualitätsbewertung samt Beschriftung und Kuratier-Parameter, `qualityFinding` die Prüfergebnisse. | `vocabulary*` = educationalContext \| discipline \| userRole \| lrt \| license \| targetGroup \| universitySubject \| qualityScale \| qualityFinding · query *(nur für universitySubject)* |
| `lookup_wlo_publishers` | Welche Anbieter Inhalte liefern, mit Materialzahl je Anbieter — als Facetten-Aggregation über den echten Index. | query · discipline · educationalContext · maxResults`=20` · outputFormat |
| `wlo_health_check` | Ist das Repository erreichbar? Latenz in ms, aufgelöste Wurzel-nodeId, Status. | — |
| `wlo_auth_status` | Wer bin ich gerade, und darf ich schreiben? Der Einstieg, wenn ein Kuratier-Aufruf abgewiesen wurde. | — |

### 5.8 Kuratierung — Anmeldung erforderlich

Alle 14 sind für jeden Aufrufer **sichtbar** und werden zur Laufzeit abgewiesen.
Jeder Aufruf ohne `confirmToken` erzeugt nur die Vorschau.

| Werkzeug | Funktion | Parameter |
|---|---|---|
| `wlo_create_content` | Neuen Datensatz anlegen — mit Metadaten, optional Text oder Datei. | `title*` · description · keywords · url · language · author · publisher · licenseKey · licenseVersion · contentType · educationalContext · discipline · userRole · *14 Qualitätsfelder* · content · contentFormat · fileBase64 · confirmToken |
| `wlo_update_content` | Metadaten oder Inhalt ändern. Zeigt die Änderung auf eine Verknüpfung automatisch auf das **Original** um und sagt das in der Vorschau. | `nodeId*` · dieselbe Feldfläche · commit · versionComment · confirmToken |
| `wlo_submit_content` | Einen Datensatz zur redaktionellen Prüfung einreichen. | `nodeId*` · comment · confirmToken |
| `wlo_create_collection` | Sammlung anlegen. | `title*` · description · parentId · confirmToken |
| `wlo_rename_collection` | Sammlung umbenennen. | `nodeId*` · `title*` · description · confirmToken |
| `wlo_add_to_collection` | Material einer Sammlung zuordnen. | `collectionId*` · `nodeId*` · confirmToken |
| `wlo_remove_from_collection` | Zuordnung lösen. | `collectionId*` · `nodeId*` · confirmToken |
| `wlo_update_compendium` | Kompendiumstext einer Sammlung setzen oder entfernen. | `nodeId*` · text · remove · confirmToken |
| `wlo_set_topic_page` | Welche Variante eine Themenseite rendert. Das einzige Werkzeug, dessen Ergebnis **sofort öffentlich** ist. | `collectionId*` · `variantId*` · confirmToken |
| `wlo_suggest_metadata` | Metadaten *vorschlagen* statt schreiben — mit Begründung, zur Entscheidung durch die Redaktion. | `nodeId*` · `suggestions*` · confirmToken |
| `wlo_list_suggestions` | Offene, angenommene oder abgelehnte Vorschläge auflisten. | `nodeId*` · status (PENDING\|ACCEPTED\|DECLINED) |
| `wlo_decide_suggestion` | Vorschlag annehmen oder ablehnen. Annehmen schreibt und liest zurück, **bevor** der Vorschlag als angenommen markiert wird. | `nodeId*` · `suggestionId*` · `decision*` · confirmToken |
| `wlo_delete_content` | Material löschen. Über eine Verknüpfungs-id trifft es **nur die Verknüpfung** — die Vorschau sagt, welcher der beiden Fälle vorliegt. | `nodeId*` · confirmToken |
| `wlo_delete_collection` | Sammlung löschen. | `nodeId*` · confirmToken |

#### Die Qualitätsfläche: 14 Felder

**Neun Skalen** — sieben von 0–5 (`qualityDidactics`, `qualityLanguage`,
`qualityMedial`, `qualityNeutralness`, `qualityTransparentness`,
`qualityDataPrivacy`, `qualityCurrentness`) und zwei von 0–1 (`qualityLogin`,
`qualityRelevance`). Geschrieben wird die *deklarierte* Form, und die ist je Feld
verschieden: volle URI bei sechs Skalen, nackte Ziffer bei den übrigen drei.
Welche Stufe wie heißt, nennt `lookup_wlo_vocabulary` mit
`vocabulary="qualityScale"` — samt dem Kuratier-Parameter je Feld.

**Fünf Befundfelder** — `qualityCorrectness`, `qualityCopyrightLaw`,
`qualityCriminalLaw`, `qualityPersonalLaw`, `qualityProtectionOfMinors`. Sie
nehmen ausschließlich die **Maschinen-Werte**; ein Ergebnis, das ein Mensch
geprüft hat, wird abgelehnt — ein Modell kann nicht bezeugen, dass eine Person
hingesehen hat.

Die Bestätigungsvorschau beschriftet jeden Vokabularwert:
`Didaktik (Bewertung): (leer) → „✰✰✰✰ moderne, gute Methodik"` statt einer rohen
URI. Der Schlüssel bindet an genau diesen Satz, und eine technische id ist
nichts, was jemand prüfen kann.

---

## 6. Widgets

Vier gebaute Oberflächen, als `ui://`-Ressourcen ausgeliefert und über `_meta` an
die Werkzeuge gehängt, die sie anzeigen können. Die Ressourcen-URI ist
inhaltsadressiert: sie deckt HTML **und** Metadaten, damit eine reine
Konfigurationsänderung nicht in einem veralteten Host-Cache hängen bleibt.

| Widget | Zeigt | An welchen Werkzeugen |
|---|---|---|
| `search-results` | Sammlungs-Kacheln und Material-Karten mit aufklappbarer Detailansicht. | `search_wlo_all` · `search_wlo_content` · `search_wlo_collections` · `get_collection_contents` · `search_wlo_within_collection` · `get_node_details` · `search_wlo_topic_pages` · `get_related_content` · `search` und `fetch` *(nur unter `WLO_SEARCH_OUTPUT_MODE=rich`)* |
| `topic-page` | Titel und Beschreibung über den Schwimmlinien mit ihren Inhalten. | `get_topic_page_content` |
| `browse` | Interaktiver Sammlungsbaum zum Stöbern. | `get_subject_portals` · `browse_collection_tree` |
| `reading` | Volltext eines Materials mit Herkunftsangabe und Schaltflächen zum Weiterarbeiten. Trägt die Nutzlast `forModel: true`, zeigt es **statt des Textes** eine Übergabe-Zeile („N Passagen an die KI übergeben") — nur `get_compendium_text` setzt das. | `get_compendium_text` · `get_wlo_content_text` |

---

## 7. Konfiguration

Vollständige Vorlage mit Begründungen: [`.env.example`](../.env.example).
Die An/Aus-Schalter stehen in **Abschnitt 3**.

### Repository und Identität

| Schlüssel | Standard | Wirkung |
|---|---|---|
| `WLO_REPOSITORY_URL` | Staging | Die edu-sharing-Instanz. Der einzige Host, an den je ein Passwort geht. |
| `WLO_ROOT_COLLECTION_ID` | — | Wurzel des Inhaltsbaums. |
| `WLO_SERVICE_USER` / `WLO_SERVICE_PASSWORD` | — | Dienstkonto für das Lesen nicht-öffentlicher Inhalte. |
| `WLO_INBOX_ID` | — | Ablageort für neu angelegte Inhalte im Dienstkonto-Modus. Ohne ihn wird das Anlegen mit Hinweis abgelehnt — besser als ein Datensatz, der irgendwo landet. |

### Anmeldung

| Schlüssel | Standard | Wirkung |
|---|---|---|
| `WLO_AUTH_PRIVATE_KEY` | — | Der Hauptschalter, siehe Abschnitt 3. |
| `WLO_AUTH_PRIVATE_KEY_PREVIOUS` | — | Vorgängerschlüssel, damit eine Rotation ausgegebene Blöcke nicht sofort entwertet. |
| `WLO_AUTH_REGISTRY_PATH` | `/data/access-registry.json` | Die Erlaubnisliste — hält ids, nie Zugangsdaten. Der einzige Ort, an den zur Laufzeit geschrieben wird. |
| `WLO_PUBLIC_BASE_URL` | — | Der Aussteller-Ursprung für OAuth. Ohne ihn nur aus dem `Host`-Header, und nur unter `TRUST_PROXY`. |

### Betrieb

| Schlüssel | Standard | Wirkung |
|---|---|---|
| `PORT` · `BIND_ADDR` · `HOST_PORT` | 3000 · 127.0.0.1 · 3000 | Wo der Server lauscht. Die letzten beiden wertet **docker-compose** aus, nicht der Server. |
| `TRUST_PROXY` | Code: **0**<br>Container: **1** | Nur hinter einem eigenen Proxy einschalten — sonst fälscht jeder Client `X-Forwarded-For` und damit seine Rate-Limit-Identität. Der Container steht per Annahme hinter einem TLS-terminierenden Proxy und setzt deshalb 1. Bei direkter Freigabe (`BIND_ADDR=0.0.0.0`) **muss** wieder 0 gesetzt werden. |
| `MCP_SSE` | 1 | Server-Sent Events für den Transport (docker-compose). |
| `RATE_LIMIT_RPM` | 120 | Anfragen je Minute auf `/mcp`. |
| `API_RATE_LIMIT_RPM` | 30 | dito für `/api/*`. |
| `AUTH_CREDENTIAL_LIMIT` | 10 | Verschiedene Geheimnisse je Identität — der Rateversuchs-Deckel. Zählt bei `Basic` je Adresse, bei einem Zugangsblock je `jti`. |
| `TICKET_CREDENTIAL_LIMIT` | 200 | Eigenes Budget für den Ticket-Tausch eingebetteter Widgets. |
| `MAX_BODY_BYTES` | 4 194 304 | Obergrenze des Anfragekörpers. |
| `WLO_FETCH_TIMEOUT_MS` | 20 000 | Zeitbudget je Repository-Abruf. Ein Schreibvorgang mit `ccm:wwwurl` bekommt intern 60 s, weil das Repository die Seite rendert. |
| `WLO_TEXT_TIMEOUT_MS` | 25 000 | dito für den Extraktionsdienst. |
| `WLO_POOL_SIZE` · `WLO_TOPIC_POOL` | 25 · 10 | Nebenläufigkeit der Fan-outs. |
| `WLO_SKILL_CACHE_REFRESH_MS` · `WLO_SKILL_CACHE_TTL_MS` | 300 000 · 600 000 | Auffrischung und Haltbarkeit des Freigabekatalog-Caches. Die TTL ist nie kleiner als das Auffrischintervall. |
| `WLO_COMPENDIUM_SECTION_MAX` | 2 000 | Kappung je Hauptabschnitt des Kompendiumstexts. Betreiber-Einstellung, kein Aufrufparameter. |
| `WLO_WIDGET_MIME` | `text/html;profile=mcp-app` | Notventil, falls ein Host noch `text/html+skybridge` erwartet. |
| `WLO_WIDGET_DOMAIN` | — | Nur wenn gesetzt, wird eine Widget-Domain in `_meta` ausgewiesen. |
| `WLO_WIDGET_IMAGE_DOMAINS` | `https://img.youtube.com` | Zusätzliche Origins für **Vorschaubilder** in der Widget-CSP (kommagetrennt). Nur `resource_domains`, nie `connect_domains`. Grund: das Repository leitet manche Vorschauen per `302` auf den Thumbnail-Host des Anbieters weiter, und die CSP prüft den Host bei jeder Weiterleitung neu. `none` schaltet es ab (Kachel zeigt dann ihr Symbol). |

---

## 8. HTTP-Endpunkte

| Pfad | Zweck | CORS |
|---|---|---|
| `POST /mcp` | Der MCP-Transport. Auch unter `/`. | ja |
| `GET /health` | Lebenszeichen. | ja |
| `/api/search` · `/api/collection` · `/api/compendium` · `/api/topic-page` · `/api/wikipedia` · `/api/skills` | REST-Fläche über denselben Diensten — für Widgets und Einbettungen. | ja |
| `/auth` · `/auth/issue` · `/auth/revoke` | Zugangsblock holen und widerrufen. Das Passwort wird im Browser verschlüsselt. | **nein** |
| `POST /auth/ticket` | edu-sharing-Ticket gegen einen Zugangsblock tauschen — für eingebettete Widgets. | ja *(exakte Ausnahme)* |
| `/oauth/authorize` · `/oauth/register` · `/oauth/token` | OAuth 2.1 mit offener Registrierung und PKCE-Pflicht. | gemischt |

`/auth*` sendet **keinen** CORS-Header, und das ist keine Nachlässigkeit: beide
Missbrauchs-Zähler laufen je Client-Adresse, ein Wildcard-Ursprung ließe also
eine fremde Seite das Kontingent jeder Besucherin für einen Passwort-Rateversuch
ausgeben und das Ergebnis mitlesen. `/auth/ticket` ist die einzige Ausnahme —
exakt dieser Pfad, damit `/auth/ticket-irgendwas` sie nicht erbt.

---

*Stand: 2026-08-20 — nach dem Deploy live verifiziert (31 Proben am laufenden Server, alle grün).*
