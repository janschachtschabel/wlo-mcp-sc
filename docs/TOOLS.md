# WLO MCP Server — Funktionsübersicht mit Chat-Triggern

Vollständige Referenz des aktuell unterstützten Funktionsumfangs: **39 MCP-Tools**
(26 lesende, 13 kuratierende), 4 interaktive Widgets und die öffentlichen
REST-Endpunkte — je mit dem besten Chat-Trigger (natürliche Formulierung, die
das Tool/Widget auslöst).

**Alle Aufrufenden sehen dieselbe Liste** — auch ohne Anmeldung. Die 13
Kurations-Tools stehen immer in `tools/list`, deklarieren `oauth2` und
**verweigern beim Aufruf**, solange keine schreibberechtigte Anmeldung vorliegt;
die Antwort trägt dann die Aufforderung, mit der der Client die Anmeldung
startet. Umgestellt am 2026-08-05: sie zu verstecken war der Grund, warum die
Anmeldung nie begann — ein Modell, das ein Werkzeug nie sieht, ruft es nie auf,
also fordert nichts jemals eine Anmeldung an.

Was die Liste tatsächlich verändert, sind nur zwei Schalter:

| | Sichtbar |
|---|---|
| **Standard** | 38 Tools — `find_wlo_skills` fehlt ohne `WLO_SKILLS_COLLECTION_ID` |
| **Mit Skills-Sammlung** | 39 Tools |
| **`WLO_DISABLE_UNSAFE_TOOLS`** gesetzt | jeweils **ohne** `get_url_text` |

Wer schreiben *darf*, entscheidet die Anmeldung: ein eigenes WLO-Login immer, das
gemeinsame Dienstkonto nur mit `WLO_ALLOW_SERVICE_WRITES`, anonym nie. Siehe
[AUTH.md](AUTH.md).

---

## 1. Lesende MCP-Tools (26) — mit Chat-Trigger

### Suchen & Finden
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `search_wlo_all` | Kombi-Suche: Materialien + Sammlungen + Themenseiten in einem Aufruf (der Standard-Einstieg) | *„Ich suche Bildungsinhalte für eine Mathestunde zur Bruchrechnung“* |
| `search_wlo_content` | Nur einzelne Materialien (Videos, Arbeitsblätter …) | *„Zeig mir ein Video zur Eiszeit für die 6. Klasse“* |
| `search_wlo_collections` | Sammlungen/Themenseiten zu einem Thema | *„Gibt es eine WLO-Sammlung zum Klimawandel?“* |
| `search_wlo_topic_pages` | Themenseiten suchen (liefert deren URLs/Varianten) | *„Welche WLO-Themenseiten gibt es zu Optik?“* |

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
| `search_wlo_within_collection` | Innerhalb einer Sammlung suchen/filtern | *„Welche Videos zu Zellteilung gibt es in dieser Sammlung?“* |
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

### Hintergrundtexte
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `get_compendium_text` | Vollständiger redaktioneller Kompendiumstext einer Sammlung | *„Gib mir den ganzen Kompendiumstext dieser Sammlung“* |
| `get_wikipedia_summary` | Wikipedia: Anriss, oder mit `fullText` der ganze Artikeltext (Ergänzung, kein OER) | *„Gib mir den Wikipedia-Artikel zu Zellatmung“* |

### Vokabular & Anbieter
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `lookup_wlo_vocabulary` | Gültige Filterwerte (Stufe, Fach, Materialtyp, Zielgruppe) | *„Welche Bildungsstufen kann ich als Filter angeben?“* |
| `lookup_wlo_publishers` | Anbieter/Quellen mit Materialzahl | *„Welche Anbieter liefern die meisten Biologie-Materialien?“* |

### System & Skills
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `find_wlo_skills` | Fertige WLO-Anleitungen (Skills) finden | *„Welche WLO-Skills passen zu meiner Aufgabe?“* |
| `wlo_auth_status` | Mit welchen Rechten der Server gerade liest — anonym, gemeinsames Dienstkonto oder persönliches Konto | *„Bin ich angemeldet?“* · *„Warum sehe ich diesen Inhalt nicht?“* |
| `wlo_health_check` | Erreichbarkeit der WLO-API prüfen | *„Ist die WLO-Verbindung gerade erreichbar?“* |

### ChatGPT-Wissenskonvention (RAG)
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `search` | Leichte Treffer ({id,title,url}) für belegte Antworten — ChatGPT ruft es oft automatisch | *„Suche in WLO nach Material zur Photosynthese“* |
| `fetch` | Volltext eines Treffers per id (Folge zu `search`, meist modell-intern) | *„Lad den Volltext zu diesem Treffer“* |

---

## 1b. Kuratierende MCP-Tools (13) — mit Chat-Trigger

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

### Inhalte pflegen
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `wlo_update_content` | Metadaten eines Datensatzes ändern: Titel, Beschreibung, Schlagwörter (ergänzt, nicht ersetzt), Quell-URL, Sprache, Autor, Herausgeber, Lizenz, Inhaltstyp, Fach, Stufe, Zielgruppe | *„Ergänze bei diesem Material das Fach Biologie und die Stufe Sek I“* |
| `wlo_create_content` | Neuen Datensatz für ein über URL erreichbares Material anlegen. Prüft vorher auf ein Duplikat und nennt den vorhandenen, statt einen zweiten anzulegen. Bleibt ein **Entwurf** | *„Leg für diese Seite einen WLO-Datensatz an“* |
| `wlo_submit_content` | Einen vorhandenen Datensatz zur redaktionellen Prüfung einreichen — ein eigener Schritt, nie automatisch | *„Reiche diesen Datensatz zur Prüfung ein“* |
| `wlo_delete_content` | Datensatz löschen. Über diesen Server nicht rückgängig zu machen | *„Lösche diesen Datensatz“* |

### Sammlungen pflegen
| Tool | Funktion | Bester Chat-Trigger |
|---|---|---|
| `wlo_create_collection` | Sammlung anlegen (eine kuratierte Themenseite), oberste Ebene oder Untersammlung | *„Leg eine Sammlung ‚Bruchrechnung Klasse 6‘ an“* |
| `wlo_rename_collection` | Titel und Beschreibung einer Sammlung ändern | *„Benenne diese Sammlung um in …“* |
| `wlo_add_to_collection` | Vorhandenes Material in eine Sammlung aufnehmen. Nichts wird verschoben oder kopiert — eine Sammlung enthält Verweise | *„Nimm dieses Video in meine Sammlung auf“* |
| `wlo_remove_from_collection` | Material aus einer Sammlung herausnehmen. Das Material bleibt bestehen und in allen anderen Sammlungen | *„Nimm dieses Material aus der Sammlung heraus“* |
| `wlo_delete_collection` | Sammlung samt Untersammlungen löschen. Das verlinkte Material bleibt bestehen | *„Lösche diese Sammlung“* |
| `wlo_update_compendium` | Redaktionellen Kompendialtext einer Sammlung schreiben, ersetzen oder entfernen (Markdown) | *„Schreib einen Einführungstext für diese Sammlung“* |

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
> fortsetzt — Sammlung → „Inhalte anzeigen“, Themenseite → „Themenseite öffnen“,
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
