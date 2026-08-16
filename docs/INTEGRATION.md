# WLO MCP Server — Integrations-Referenz

Für das Team und für Entwicklerinnen und Entwickler, die einen Chatbot oder eine
andere Anwendung anbinden. Ein Dokument, drei Fragen:

1. **[Welche Werkzeuge gibt es?](#1-die-41-mcp-werkzeuge)** — alle 41, gruppiert.
2. **[Welche Adressen kann ich von außen aufrufen?](#2-alle-adressen-von-außen)** — MCP, REST, Seiten, OAuth.
3. **[Was muss ich über das Verhalten wissen?](#3-verhalten-das-die-integration-betrifft)** — die Regeln, an denen Integrationen sonst scheitern.

Ergänzende Dokumente: [TOOLS.md](TOOLS.md) (Chat-Trigger je Werkzeug),
[AUTH.md](AUTH.md) (Anmeldung im Detail), [SKILLS.md](SKILLS.md) (Redaktion),
[DEPLOYMENT.md](DEPLOYMENT.md) (Betrieb), [PRIVACY.md](PRIVACY.md).

> Alle Angaben sind am 2026-08-09 gegen den Quelltext geprüft. Die
> Werkzeugliste stammt aus einem tatsächlich gestarteten Server, nicht aus einer
> Aufzählung von Hand.

---

## Auf einen Blick

| | |
|---|---|
| **Protokoll** | MCP über Streamable HTTP (`POST`), plus stdio für lokale Nutzung |
| **Werkzeuge** | 42 — 28 lesend, 14 kuratierend (schreibend) |
| **Ohne Anmeldung** | Voller Lesezugriff. Kein Login nötig, keine Registrierung |
| **Mit Anmeldung** | Zusätzlich Schreiben mit den Rechten des eigenen WLO-Kontos |
| **Zusätzlich** | Öffentliche REST-API (`/api/*`, nur lesend), 4 Widgets, Launcher-Seite |
| **Basis-URL** | Die des Deployments; aktuell `https://wlo-mcp.87.106.195.152.nip.io` |

Im Folgenden steht `<BASIS>` für diese Adresse.

---

## 1. Die 42 MCP-Werkzeuge

Alle Aufrufenden sehen **dieselbe Liste**, auch anonym. Die kuratierenden
Werkzeuge stehen immer in `tools/list`, deklarieren `oauth2` und **verweigern
beim Aufruf**, solange keine schreibberechtigte Anmeldung vorliegt — die Antwort
trägt dann die Aufforderung, mit der der Client die Anmeldung startet.

*Warum sie sichtbar sind:* ein Modell, das ein Werkzeug nie sieht, ruft es nie
auf — also fordert nichts jemals eine Anmeldung an, und ein Connector bleibt für
immer anonym.

### 1.1 Lesen — 28 Werkzeuge (`noauth`)

**Suchen (5)**

| Werkzeug | Zweck |
|---|---|
| `search_wlo_all` | **Der Standard-Einstieg.** Materialien + Sammlungen + Themenseiten in einem Aufruf |
| `search_wlo_content` | Nur einzelne Materialien |
| `search_wlo_collections` | Nur Sammlungen und Themenseiten |
| `search_wlo_within_collection` | Innerhalb *einer* Sammlung (lokal über bis zu 100 direkte Kinder) |
| `search_wlo_topic_pages` | Themenseiten samt Varianten und URLs |

**Einzelne Datensätze (6)**

| Werkzeug | Zweck |
|---|---|
| `get_node_details` | Metadaten eines Materials |
| `get_nodes_details` | Dasselbe für mehrere IDs in einem Aufruf |
| `get_node_breadcrumb` | Der Pfad eines Knotens von der Wurzel |
| `get_node_collections` | In welchen Sammlungen ein Material liegt |
| `get_related_content` | Inhaltlich verwandtes Material |
| `get_collection_stats` | Kennzahlen einer Sammlung |

**Volltext & Wissen (4)**

| Werkzeug | Zweck |
|---|---|
| `get_wlo_content_text` | Der **eigentliche Text** eines Materials (auch aus PDF/DOCX/PPTX) |
| `get_compendium_text` | Der redaktionelle Kompendialtext einer Sammlung |
| `get_wikipedia_summary` | Wikipedia-Anriss oder Volltext (Ergänzung, kein OER) |
| `get_url_text` ⚠️ | Text hinter einer **beliebigen** Web-Adresse. Als **unsicher** deklariert, im Docker-Deployment ab Werk aus |

**Struktur & Navigation (4)**

| Werkzeug | Zweck |
|---|---|
| `get_collection_contents` | Inhalte einer Sammlung |
| `browse_collection_tree` | Sammlungsbaum als Textbaum |
| `get_subject_portals` | Die Fachportale (oberste Ebene) |
| `get_topic_page_content` | Eine Themenseite als Schwimmlinien, fertig zum Rendern |

**Vokabular (2)**

| Werkzeug | Zweck |
|---|---|
| `lookup_wlo_vocabulary` | Fächer, Bildungsstufen, Ressourcentypen, Zielgruppen, Lizenzen |
| `lookup_wlo_publishers` | Anbieter mit Trefferzahlen |

**Skills (3)**

| Werkzeug | Zweck |
|---|---|
| `search_skill` | Redaktionell gepflegte Anleitungen finden — im ganzen Repository |
| `get_skill` | Eine Anleitung im Wortlaut holen |
| `get_skill_registry` | Die Skills nennen, die EINE Inhaltssammlung freigegeben hat |

> Die beiden Richtungen unterscheiden sich in der Frage: `search_skill` sucht
> Skills unabhängig von einer Sammlung, `get_skill_registry` beantwortet, was
> für **diese** Sammlung vorgesehen ist. Beide enden bei `get_skill`.
>
> `WLO_SKILL_TOOL_MODE=one-tool` ersetzt **nur die Suche** durch
> `get_skill_for_task` (die Zahl bleibt bei 42). `get_skill` und
> `get_skill_registry` bleiben — die Freigabeliste besteht aus nodeIds, und
> `get_skill` ist das einzige Werkzeug, das eine annimmt.
>
> `WLO_DISABLE_SKILL_SEARCH=1` nimmt `search_skill` heraus (dann 41), wenn
> Skills ausschließlich über die freigebende Sammlung gefunden werden sollen.
>
> **Der Katalog kommt bei Sammlungs-Ergebnissen mit — ohne Zusatzabruf.** Ein
> Hintergrunddienst merkt sich je Sammlung, was ihre Kinderliste sagt, und
> erneuert das alle 5 Minuten. Für den Aufrufer ist es ein Map-Zugriff: der
> Abruf, der ohne Cache ~1,0–1,4 s je Sammlung kostete (gemessen 2026-08-10,
> auch für Sammlungen ganz ohne Registry), findet nicht mehr im Anfragepfad statt.
>
> Beim **ersten** Kontakt mit einer Sammlung ist der Cache kalt: dann steht
> **einmal je Antwort** die kostenlose Hinweiszeile — sie sagt ausdrücklich, dass
> es NICHT geprüft ist, nennt `get_skill_registry` und den Anlass („Vorgehen mit
> der Sammlung", nicht „Inhalte") — und die Sammlung wird für den nächsten Takt
> vorgemerkt. Ab dem zweiten Abruf ist der Katalog da.
>
> `includeSkillRegistry: true` an `search_wlo_all`/`search_wlo_collections`
> erzwingt den **Live**-Abruf statt der bis zu 10 Minuten alten Cache-Antwort —
> nötig, wenn eine Registry gerade angelegt oder geändert wurde.
> `WLO_SKILL_CACHE=off` schaltet den Hintergrunddienst ab.

**ChatGPT-Konvention (2)**

| Werkzeug | Zweck |
|---|---|
| `search` | Die von ChatGPT erwartete Suchform (ein einziger Parameter) |
| `fetch` | Die zugehörige Abrufform |

> `WLO_SEARCH_OUTPUT_MODE=rich` reichert **beide** an — `search` um die Buckets
> von `search_wlo_all` samt Widget, `fetch` um den vollen Datensatz. Standardmäßig
> aus. Der Schalter deckt beide ab, weil `search`→`fetch` **ein** Ablauf ist.

**Betrieb (2)**

| Werkzeug | Zweck |
|---|---|
| `wlo_health_check` | Erreichbarkeit des Repositorys |
| `wlo_auth_status` | Mit welcher Identität diese Sitzung arbeitet und was sie darf |

### 1.2 Kuratieren — 14 Werkzeuge (`oauth2`)

Alle verlangen eine Anmeldung, alle laufen **zweistufig**: erst Vorschau mit
Änderungsmenge und Einmal-Token, dann Bestätigung. Jeder Schreibvorgang wird
danach **zurückgelesen**.

| Werkzeug | Zweck |
|---|---|
| `wlo_create_content` | Datensatz anlegen |
| `wlo_update_content` | Metadaten und/oder Datei ändern |
| `wlo_delete_content` | Datensatz löschen |
| `wlo_submit_content` | Zur redaktionellen Prüfung einreichen |
| `wlo_create_collection` | Sammlung anlegen |
| `wlo_rename_collection` | Sammlung umbenennen |
| `wlo_delete_collection` | Sammlung löschen |
| `wlo_add_to_collection` | Material in eine Sammlung legen |
| `wlo_remove_from_collection` | Material aus einer Sammlung nehmen |
| `wlo_update_compendium` | Kompendialtext schreiben |
| `wlo_set_topic_page` | Festlegen, **welche Variante** eine Themenseite öffentlich rendert |
| `wlo_suggest_metadata` | Metadaten *vorschlagen* statt ändern |
| `wlo_list_suggestions` | Offene Vorschläge auflisten |
| `wlo_decide_suggestion` | Vorschlag annehmen oder ablehnen |

> **Für Chatbots wichtig:** `wlo_set_topic_page` ist das einzige Werkzeug, dessen
> Ergebnis **sofort öffentlich** sichtbar ist.

### 1.3 Widgets (4)

Interaktive Oberflächen für Apps-SDK-fähige Clients (ChatGPT), ausgeliefert als
MCP-Ressourcen: `search-results`, `topic-page`, `reading`, `browse`.

---

## 2. Alle Adressen von außen

### 2.1 MCP

| Adresse | Methode | Bemerkung |
|---|---|---|
| `<BASIS>/mcp` | `POST` | Der MCP-Endpunkt. **Das ist die Adresse, die man in einen Client einträgt.** |
| `<BASIS>/` | `POST` | Derselbe Endpunkt — manche Clients hängen nichts an |

> **`GET /mcp` antwortet 405.** Es gibt keinen SSE-GET-Kanal; wer einen erwartet,
> sucht vergeblich. `POST` ist der Transport.

### 2.2 Öffentliche REST-API — nur lesend, ohne Anmeldung

Für alles, was kein MCP spricht: klassische Backends, Nicht-MCP-KI-Werkzeuge,
der Prompt-Launcher. `GET`, `CORS: *`.

| Adresse | Wichtigste Parameter |
|---|---|
| `GET <BASIS>/api/search` | `q` (Pflicht), `educationalContext`, `discipline`, `learningResourceType`, `userRole`, `publisher`, `license`, `maxContent`, `maxCollections`, `skipCount`, `include`, `includeFacets`, `fields`, `format=html` |
| `GET <BASIS>/api/search/<Begriff>` | **Pfad-Form** — dasselbe, Begriff im Pfad |
| `GET <BASIS>/api/collection` | `nodeId`, `q` (optional), `max`, `fields`, Vokabular-Filter inkl. `license` |
| `GET <BASIS>/api/compendium` | `ids` oder `nodeId` — die redaktionellen Kompendialtexte |
| `GET <BASIS>/api/topic-page` | `collectionId` oder `variantId`, optional `targetGroup` — eine Themenseite als Schwimmlinien |
| `GET <BASIS>/api/wikipedia` | `q` (Pflicht), `lang`, `sections` (1–3) — Wikipedia-Anriss |
| `GET <BASIS>/api/skills` | *(keine)* — Liste der Skills |
| `GET <BASIS>/api/skills/<id>` | Das rohe Markdown eines Skills |

> **Die Pfad-Form ist für KI-Abrufschichten die bessere Wahl.** Live diagnostiziert
> (2026-07-17): manche entfernen bei selbst gebauten URLs den Query-String, und
> jeder Testaufruf landete als nacktes `/api/search` → 400. Der Pfad übersteht
> das; verloren gehen dann höchstens die Filter, nicht die Suche.

> **`?format=html`** rendert dasselbe Ergebnis als lesbare HTML-Seite. Grund:
> manche KI-Browsing-Pipelines können eine URL öffnen, verwerfen aber rohes JSON
> (live beobachtet). Die Seite ist auch das menschenfreundliche Ziel zum Teilen.

### 2.3 Seiten für Nutzerinnen und Nutzer

| Adresse | Was |
|---|---|
| `<BASIS>/` | **Launcher-Seite** — Einstieg, Erklärung, fertige Prompts |
| `<BASIS>/auth` | **Zugangsblock holen** — WLO-Konto anmelden, Block erzeugen |
| `<BASIS>/auth/revoke` | **Zugang sperren** — jederzeit widerrufbar |
| `<BASIS>/llms.txt` | Selbstbeschreibung für KI-Abrufer |
| `<BASIS>/bookmarklet.md` | Bookmarklet-Anleitung |
| `<BASIS>/robots.txt` | Bewusst freizügig |

> `/auth.html` und `/auth-revoke.html` sind dieselben Seiten unter der langen
> Adresse.

### 2.4 Anmeldung — OAuth 2.1

Für Clients, die OAuth sprechen (ChatGPT, Claude). Nur aktiv, wenn der Betrieb
`WLO_AUTH_PRIVATE_KEY` gesetzt hat.

| Adresse | Methode | Was |
|---|---|---|
| `GET <BASIS>/.well-known/oauth-authorization-server` | `GET` | Discovery (RFC 8414) |
| `GET <BASIS>/.well-known/oauth-protected-resource` | `GET` | Discovery (RFC 9728) |
| `<BASIS>/oauth/register` | `POST` | Client-Registrierung, offen (RFC 7591) |
| `<BASIS>/oauth/authorize` | `GET`/`POST` | Zustimmungsseite und Code-Ausgabe |
| `<BASIS>/oauth/token` | `POST` | Code gegen Token |

> Beide Discovery-Dokumente gibt es zusätzlich mit `/mcp`-Suffix, weil manche
> Clients dort suchen.

**Das Entscheidende für eine Integration:** Ein Aufruf **ohne** `Authorization`
antwortet weiter mit `200` und der vollen Werkzeugliste. Der `401` kommt nur bei
einem *vorgelegten, aber unbrauchbaren* Token. Anonymes Lesen und OAuth liegen
auf derselben Adresse — es gibt keine zweite URL und keinen erzwungenen 401.

### 2.5 Zugangsblock (ohne OAuth)

Für Clients mit einem Header-Feld: einmal `/auth` besuchen, den Block als
`Authorization: Bearer wlo2.…` eintragen.

| Adresse | Methode | Was |
|---|---|---|
| `<BASIS>/auth/public-key` | `GET` | Öffentlicher Schlüssel für die Browser-Verschlüsselung |
| `<BASIS>/auth/issue` | `POST` | Block ausstellen |
| `<BASIS>/auth/revoke` | `POST` | Einen Block sperren |
| `<BASIS>/auth/revoke-all` | `POST` | Alle Blöcke eines Kontos sperren |

> Das Passwort wird **im Browser** verschlüsselt und verlässt das Gerät nur als
> Chiffretext. Der Server speichert es nie.
>
> **`/auth*` und `/oauth/authorize` senden bewusst keinen CORS-Header** — dort
> wird ein Passwort getippt.

---

## 3. Verhalten, das die Integration betrifft

### 3.1 Ausgabeformat

22 der 42 Werkzeuge nehmen `outputFormat: "markdown" | "json"`. Standard ist Markdown
(sparsamer im Kontextfenster); der vollständige Envelope reist ohnehin in
`structuredContent` mit. Ein abschließender `_queryMeta`-Textblock trägt den
maschinenlesbaren Suchkontext (Kriterien, Paginierung, Repository-URL).

**Wichtig:** `_queryMeta.criteria` nennt nur, was **tatsächlich** gesucht wurde.
Ein Filter, den der Server verwerfen musste, steht dort nicht.

### 3.2 Lizenzfilter — die drei Regeln, die überraschen

Der Parameter `license` nimmt ein Label („CC BY 4.0", „gemeinfrei"), den
Repository-Schlüssel (`CC_BY`) oder den Sammelwert **`OER`** (CC0, gemeinfrei,
CC BY, CC BY-SA). `COPYRIGHT_FREE` („Copyright, freier Zugang") gehört nicht
dazu — kostenfrei zugänglich, aber urheberrechtlich geschützt und nicht
nachnutzbar.

1. **Das Repository filtert nur Lizenz-FAMILIEN.** `CC_BY` liefert auch CC BY-ND
   und CC BY-NC-ND — die Zugabe ist *restriktiver* als gewünscht. Die genaue
   Auswahl passiert danach im Server.
2. **Ein geleertes Ergebnis nennt den Grund.** Fällt beim Exaktheits-Pass etwas
   weg, sagt die Antwort das samt Zahl der geprüften Kandidaten. Ein leeres
   Ergebnis lässt sich deshalb unterscheiden: *mit* diesem Hinweis heißt es
   „nichts mit genau dieser Lizenz", *ohne* ihn hat die Suche selbst nichts
   gefunden.
3. **`OER` wird als fünf getrennte Suchen beantwortet.** Ab Seite 2 ist das
   Ergebnis deshalb keine Fortsetzung, sondern die zweite Seite *jeder* der fünf
   Lizenzen. Zum verlässlichen Weiterblättern die gesehenen IDs über
   `excludeNodeIds` mitgeben — der Server weist darauf hin.

Über REST kommen dieselben Angaben als Felder:

| Feld | Bedeutung |
|---|---|
| `content.licenseFilter { checked, kept }` | Auf `/api/search`, wenn eine Lizenz gesetzt war **und** die Inhaltssuche lief |
| `licenseFilter { checked, kept }` | Dasselbe auf `/api/collection` |

### 3.3 Weitere Offenlegungen, auf die man sich verlassen kann

| Feld | Wo | Bedeutung |
|---|---|---|
| `unresolvedFilters` | `/api/search`, Werkzeuge | Ein Vokabular-Filter ließ sich nicht auflösen und wurde **ignoriert** (mit „Meintest du?"-Vorschlägen) |
| `truncated` + `collectionTotal` | `/api/collection` (gefiltert) | Die Antwort ist eine **Stichprobe** von höchstens 100 Kindern |
| `total` vs. `count` | überall | `total` = Korpus, `count` = zurückgegebene Treffer |

Ein nicht aufgelöster Filter wird **verworfen**, nicht roh weitergereicht — sonst
verengte ein Tippfehler das Ergebnis lautlos.

### 3.4 Schreiben ist immer zweistufig

1. Aufruf **ohne** `confirmToken` → Vorschau der Änderungsmenge + Einmal-Token.
2. Aufruf **mit** `confirmToken` → Ausführung, danach Rücklesen.

Der Token ist an einen Fingerabdruck der Änderungsmenge gebunden: **alles, was
der Aufruf senden wird, muss in der Vorschau gestanden haben.**

Ein Abbruch (Timeout) wird als **offener Ausgang** gemeldet, nie als Fehlschlag —
der Abbruch trifft die Antwort, nicht die Arbeit.

### 3.5 Grenzen

| | Standard | Variable |
|---|---|---|
| MCP-Endpunkt | 120 Anfragen/Minute je Adresse | `RATE_LIMIT_RPM` |
| `/api/*` und die Anmeldeseiten | 30 Anfragen/Minute je Adresse | `API_RATE_LIMIT_RPM` |
| Anfrage-Rumpf | 4 MiB | `MAX_BODY_BYTES` |

### 3.6 Wer was darf

| Identität | Lesen | Schreiben |
|---|---|---|
| Anonym (kein Header) | ✅ alles Öffentliche | ❌ nie |
| Eigenes WLO-Konto | ✅ mit den Rechten des Kontos | ✅ mit den Rechten des Kontos |
| Gemeinsames Dienstkonto | ✅ | nur mit `WLO_ALLOW_SERVICE_WRITES` |

Das Dienstkonto ist standardmäßig gesperrt: In der Repository-Historie steht der
Kontoname, nicht die Person — eine Änderung darunter ist niemandem zuzuordnen.

---

## 4. Schnellstart

**MCP in einen Client eintragen** — nur die Adresse, sonst nichts:

```
https://wlo-mcp.87.106.195.152.nip.io/mcp
```

Der Client findet die Discovery-Dokumente selbst und bietet die Anmeldung an
(gemessen mit ChatGPT am 2026-08-05 und claude.ai am 2026-08-06). Wer nur lesen
will, verbindet ohne Konto.

**REST ausprobieren** — Suche als JSON:

```bash
curl "https://wlo-mcp.87.106.195.152.nip.io/api/search/Photosynthese?maxContent=5"
```

Nur frei nachnutzbares Material, als lesbare Seite:

```bash
curl "https://wlo-mcp.87.106.195.152.nip.io/api/search/Optik?license=OER&format=html"
```

Inhalte einer Sammlung, auf eine Lizenz gefiltert:

```bash
curl "https://wlo-mcp.87.106.195.152.nip.io/api/collection?nodeId=<id>&license=CC%20BY%204.0"
```

---

## 5. Was es bewusst **nicht** gibt

Damit niemand darauf plant:

- **Kein SSE-GET auf `/mcp`** — der Transport ist `POST`.
- **Kein API-Schlüssel und keine Registrierung fürs Lesen.** Die REST-API ist
  offen; die Grenze ist das Ratenlimit.
- **Kein Nutzungs-Tracking** (`wlo_register_usage`). Der Endpunkt des Repositorys
  verlangt eine Anwendungs-Signatur, deren Besitz das Handeln für beliebige
  Nutzerinnen erlaubt — das kehrt die Auth-Idee dieses Servers um. Betreiber-
  Entscheidung, keine Code-Frage.
- **Keine Volltextsuche über Themenseiten.** `ngsearchword` wird auf dem
  page_variant-Index akzeptiert und trifft auf beiden Instanzen null Knoten.
- **Kein `discipline`-Filter auf `search_wlo_topic_pages`** — fachlich filtern
  über `search_wlo_collections` / `search_wlo_content`.
- **Keine eingegrenzte Suche über einen Sammlungs-Teilbaum.**
  `virtual:primaryparent_nodeid` beantwortet das Backend mit `400`;
  `search_wlo_within_collection` prüft deshalb bis zu 100 direkte Kinder lokal.

---

## 6. Wenn etwas nicht funktioniert

| Symptom | Wahrscheinliche Ursache |
|---|---|
| `400` auf `/api/search` | Der Query-String wurde unterwegs entfernt → Pfad-Form `/api/search/<Begriff>` nutzen |
| `405` auf `/mcp` | `GET` statt `POST` |
| `404` auf `/.well-known/oauth-*` | OAuth ist nicht eingerichtet (`WLO_AUTH_PRIVATE_KEY` fehlt) oder `WLO_PUBLIC_BASE_URL` ist nicht gesetzt |
| `401` mit `WWW-Authenticate` | Ein Token wurde vorgelegt und ist unbrauchbar (abgelaufen, gesperrt, fremd). **Ohne** Header gäbe es `200` |
| Kurationswerkzeug verweigert | Keine schreibberechtigte Anmeldung — die Antwort trägt die Aufforderung zum Login |
| Suche liefert nichts trotz Lizenzfilter | Auf den Hinweis achten: mit ihm gibt es nichts *mit genau dieser Lizenz*, ohne ihn nichts zum Thema |
| Das Modell ruft keine Werkzeuge auf | In ChatGPT muss der Connector pro Unterhaltung einmal bestätigt werden — einmal nach WLO fragen und die Karte bestätigen |
