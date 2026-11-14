# WLO MCP Server — Referenz

Stellt die offenen Bildungsinhalte von WirLernenOnline (edu-sharing) über das
Model Context Protocol bereit: Suche, Sammlungen, Themenseiten, Volltexte,
KI-Skills — und, nach Anmeldung, das Kuratieren von Datensätzen.

| | |
|---|---|
| **Endpunkt** | `https://wlo-mcp.87.106.195.152.nip.io/mcp` |
| **Quellcode** | <https://github.com/janschachtschabel/wlo-mcp-sc> |
| **Transport** | Streamable HTTP (`POST /mcp`), SSE optional · stdio lokal |
| **Werkzeuge** | 34 lesend · 20 kuratierend = **54** (58 mit `WLO_BATCH_UPLOAD_ENABLED`) |
| **Widgets** | 4 |
| **Env-Schlüssel** | 40 vom Server gelesen, dazu 3 für den Container |

Erhoben aus dem Quellcode, nicht aus dem Gedächtnis: Werkzeugliste und
Parameter stammen aus `tools/list` des laufenden Servers, die Trefferzahlen aus
einem echten Aufruf gegen Staging (zuletzt 2026-08-20, nach dem Deploy mit
31 Proben am laufenden Server verifiziert).

---

## 1. Anschluss

Ein Client **ohne** `Authorization`-Header bekommt `200` und die **volle**
Werkzeugliste — alle 54, die Kuratier-Werkzeuge eingeschlossen. Das ist Absicht:
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
| **anonym** | alle 34 | **nie** | kein Header. Die öffentliche Fläche bleibt lesend. |
| **eigenes WLO-Konto** | alle 34 | alle 20 | OAuth 2.1, oder ein `wlo2.…`-Block als `Bearer`, oder `Basic`. Jede Änderung ist einer Person zurechenbar. |
| **Dienstkonto** | alle 34 | nur mit `WLO_ALLOW_SERVICE_WRITES` | Sonst stünde in der Versionshistorie „wlo-mcp" für eine Änderung, die irgendwer wollte. |

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
verwerfen und trotzdem `200` zu antworten. Für Programme steht der Schlüssel samt
Änderungsmenge zusätzlich in `structuredContent.confirm` (`token`, `expiresAt`,
`preview.action` = `change`/`delete`, `preview.tool` = der Werkzeugname,
`preview.target`, `preview.fields[]` mit `name`/`label`/`old`/`new`, bei
Vokabular- und Bewertungsfeldern dazu `oldLabels`/`newLabels`, bei mehrschrittigen
Änderungen `preview.items[]` mit einer Zeile je Schritt) — kein
Herauslesen aus dem Text mehr nötig. Gibt es nichts zu bestätigen, kommt
`{"confirm": null, "unchanged": true}`. Die Stapel-Ablage trägt dieselbe Form
(Ziel `home`, 30 min gültig) und daneben weiter `batchToken`.

**Sicher wiederholbar.** Geht die Antwort auf einen bestätigten Aufruf verloren,
darf derselbe Aufruf mit demselben `confirmToken` und **denselben Argumenten**
noch einmal kommen: 30 Minuten lang liefert der Server die erste Antwort erneut,
mit `structuredContent.replayed: true` und ohne zweiten Schreibvorgang. Läuft die
erste Ausführung noch, kommt `{inProgress: true}` (kein Fehler — gleich erneut
fragen). Andere Argumente mit demselben Schlüssel → `confirm_mismatch`, eine
andere Anmeldung → `confirm_unknown`. Gebunden ist an die Argumente, nicht an die
Änderungsmenge: nach dem ersten Schreiben sähe eine neue Vorschau anders aus. Nach
einem Neustart des Servers ist das Gedächtnis weg (`confirm_unknown` wie bisher).
Endet ein Aufruf NACH der Einlösung mit einem Fehler, trägt er
`error.requiresNewPreview: true` und kein `retryAfter`: derselbe Aufruf bekäme
nur diese Antwort noch einmal. **`requiresNewPreview` sagt nichts darüber, ob
geschrieben wurde** — das sagt `outcomeOpen`, das jeder Fehler nach der
Einlösung ausdrücklich trägt: `false` = dieser Aufruf hat nichts geschrieben
(etwa `exists`, oder jedes Feld wurde abgelehnt) → ohne `confirmToken` neu
aufrufen und die neue Vorschau bestätigen; `true` = es kann schon etwas
geschrieben sein (`not_visible`, `unverified`, `upstream_busy` mitten in einem
Vorgang, ein angelegter Datensatz mit `not_stored`) → **erst nachsehen**, sonst
entsteht womöglich eine Dublette. Ohne eigenen Code heißt ein solcher Fehler
`unverified`. Bricht er nach der Einlösung ab, kommt `upstream_error` mit
`outcomeOpen: true` (nachsehen), nie „nichts geschrieben“.
Die Plan-Werkzeuge haben dafür ihren eigenen Weg (`continuationToken`). Wiederholt
wird die Antwort, wie sie war: Endete der erste Aufruf mit `timeout` und
`outcomeOpen: true`, bleibt auch die Wiederholung offen — dann nachsehen (etwa
`find_content_by_url` oder eine neue Vorschau), nicht noch einmal senden.

**Geplante Änderungen** (`wlo_create_collection_tree`, `wlo_add_to_collections`, `wlo_submit_contents` — Liste `items`): eine
Bestätigung für den ganzen Plan; der Server führt ihn in Abschnitten von ~40 s aus
(vier Schritte parallel, von oben nach unten). Die Antwort trägt `complete`,
`progress {done, total}`, je Schritt `status`/`code`/`nodeId` und, solange etwas offen
ist, `continuationToken`. Der Plan gilt 30 min ab Bestätigung und verlängert sich nicht.
Ein Schlüssel darf von derselben Anmeldung erneut vorgelegt werden — er setzt fort oder
liefert dasselbe Ergebnis, legt nie doppelt an. Fehlercodes: `plan_expired` (unbekannt,
abgelaufen oder nach Neustart — weiter mit neuer Vorschau; `outcomeOpen: true`, weil frühere
Aufrufe des Plans Schritte ausgeführt haben können) und `plan_mismatch` (andere
Anmeldung oder andere Angaben).

**Fehler als Code.** Jede Antwort mit `isError` trägt `structuredContent.error`
(`code`, `message` = derselbe deutsche Text; einzelne Codes mit Zusatzfeldern). Das
veröffentlichte `outputSchema` jedes Werkzeugs lautet deshalb `{type: "object", anyOf: [Erfolg, Fehler]}`:
ein Client, der `structuredContent` gegen das Schema prüft (das SDK tut es auch bei `isError`),
bekommt den Fehler als lesbares Ergebnis; die Erfolgsform bleibt geschlossen. Die Codes:

| Code | Bedeutung | Was ein Programm tut |
|---|---|---|
| `login_required` | Schreibwerkzeug ohne (eigene) Anmeldung | Anmeldung anstoßen (`_meta["mcp/www_authenticate"]`) |
| `login_rejected` | Das Repository hat die vorhandene Anmeldung abgelehnt (HTTP 401, z. B. Passwort geändert) — in jedem Werkzeug | neu anmelden (`_meta["mcp/www_authenticate"]`) |
| `invalid_input` | Angaben abgelehnt — auch falsche Parameter, die das SDK schon vor dem Werkzeug abweist (`Input validation error …`); bei Schreibwerkzeugen nennt `reasons[]` jeden Grund | Angaben korrigieren |
| `unknown_tool` | Werkzeug unbekannt oder abgeschaltet (etwa `get_url_text` unter `WLO_DISABLE_UNSAFE_TOOLS`) | Werkzeugliste neu lesen |
| `exists` | `wlo_create_content`: zu dieser URL gibt es schon einen Datensatz — schon in der Vorschau, ohne Schlüssel; `error.existing {nodeId, title}`. `wlo_attach_fulltext[s]`: der Datensatz trägt schon einen Text — einen Volltext oder eine Textdatei (er wird nicht ersetzt, siehe `would_replace_file`) | diesen bearbeiten · beim Volltext: nichts tun |
| `confirm_expired` / `confirm_mismatch` / `confirm_unknown` | Bestätigungsschlüssel abgelaufen / gehört zu anderer Änderung (auch: schon eingelöst, aber mit anderen Argumenten) / unbekannt oder verbraucht. Ein schon eingelöster Schlüssel mit **gleicher Anmeldung und gleichen Argumenten** ist keiner dieser Fälle: er liefert die erste Antwort (`replayed: true`) `confirm_unknown` trägt **`outcomeOpen: true`**: dieser Aufruf hat nichts geschrieben, aber „unbekannt“ deckt auch einen Schlüssel, der vor einem Neustart schon eingelöst wurde — jener Aufruf kann geschrieben haben. `confirm_expired` und ein noch nicht eingelöstes `confirm_mismatch` tragen `outcomeOpen: false`; ein `confirm_mismatch` über einem **schon eingelösten** Schlüssel (andere Argumente) `true` — der frühere Aufruf kann geschrieben haben. | ohne `confirmToken` neu aufrufen, neue Vorschau |
| `plan_expired` / `plan_mismatch` | Plan unbekannt, abgelaufen oder nach Neustart verloren · Schlüssel gehört zu einem anderen Plan (andere Anmeldung oder andere Angaben). Beide **`outcomeOpen: true`**: dieser Aufruf hat nichts geschrieben, aber unter dem Schlüssel können schon Schritte gelaufen sein — beim verlorenen Plan frühere Aufrufe, beim fremden Plan jener selbst | neue Vorschau — sie zeigt, was schon da ist (beim Aufnehmen in Sammlungen meldet erst der neue Lauf Erledigtes als `already`) |
| `too_many_plans` | Schon fünf unfertige Pläne dieser Anmeldung; nichts geschrieben, der Schlüssel gilt weiter | einen Plan zu Ende führen, dann mit demselben Schlüssel wiederholen |
| `not_found` / `not_a_collection` / `is_a_collection` / `is_a_folder` | Ziel fehlt · ist keine Sammlung (Einordnen einzeln und gesammelt, Herausnehmen, Umbenennen, Kompendium, `wlo_delete_collection`, `parentId` von `wlo_create_collection`, Wurzel von `wlo_create_collection_tree`, `addToCollectionId` von `wlo_create_content`, `get_collection_overview`) · ist eine Sammlung bzw. ein Ordner, wo ein einzelner Datensatz erwartet wird (`wlo_delete_content`, die Materialseite beim Einordnen und Herausnehmen). Eine **Sammlung** ist ein Knoten mit dem Aspekt `ccm:collection` — der Typ `ccm:map` allein genügt nicht, denn Arbeitsbereichs-, Ablage- und Seitenkonfigurations-Ordner melden ihn auch (gemessen 2026-11-12). Ein Knoten, dessen Typ das Repository gar nicht nennt, ergibt bei `wlo_delete_content` `refused`. Immer vor jedem Schlüssel, nichts geändert. **`wlo_add_to_collections`** antwortet für unbrauchbare ids insgesamt mit `invalid_input` und nennt sie einzeln in `error.refused [{nodeId \| collectionId, code}]` mit genau diesen Codes | das passende Werkzeug nehmen; einen Ordner löscht dieser Server nicht |
| `not_checked` | Eine nötige Prüfung ließ sich nicht lesen; nichts geändert | später erneut |
| `already_submitted` | `wlo_submit_content`: der Datensatz liegt schon zur Prüfung vor (`ccm:wf_status` = `200_tocheck`) — schon in der Vorschau, ohne Schlüssel; ein zweites Einreichen hätte den Beleg des ersten als eigenen gemeldet | nichts |
| `invalid_input` mit `candidates` | Ein Vokabularwert (Fach, Bildungsstufe, Zielgruppe, Inhaltstyp) ist kein Name und kein Alias des Vokabulars. `error.candidates: [{field, value, suggestions}]` nennt je abgelehntem Wert bis zu fünf Einträge, die angenommen würden — ein Teilwort-Treffer wird beim Schreiben nicht mehr still übernommen (seit 2026-11-13). Die Suche löst weiterhin großzügig auf. |
| `is_a_collection` / `is_a_folder` bei `wlo_submit_content` | Eingereicht werden nur einzelne Datensätze (seit 2026-11-13) — schon in der Vorschau, ohne Schlüssel. Die Metadaten-Werkzeuge (`wlo_update_content[s]`, `wlo_suggest_metadata`, `wlo_decide_suggestion`) bleiben für Sammlungen offen; Titel und Beschreibung landen dort in `cm:title` / `cm:description`. |
| `too_many_batches` | `wlo_prepare_file_batch`: fünf Stapel dieser Anmeldung sind schon in Arbeit (Dateien abgelegt, Abschluss fehlt). Ein laufender Stapel wird für einen neuen nicht mehr aufgegeben; `outcomeOpen: false` | einen Stapel abschließen (`wlo_store_batch_manifest`) oder 30 Minuten auslaufen lassen `scope` (oben und in `error`) sagt, wessen Grenze es ist: `owner` — einen eigenen Stapel abschließen hilft; `server` — nur warten. |
| `already_decided` | `wlo_decide_suggestion`: über den Vorschlag ist schon entschieden (angenommen oder abgelehnt) — eine getroffene Entscheidung wird nicht überschrieben; schon in der Vorschau, ohne Schlüssel | nichts; soll der Wert doch hinein oder heraus: `wlo_update_content` |
| `suggestion_not_marked` | `wlo_decide_suggestion`: die Entscheidung ließ sich nicht vermerken — abgelehnt, oder mit Erfolg beantwortet und beim Rücklesen nicht zu sehen. `outcomeOpen: true`, wenn der WERT dabei schon in den Datensatz geschrieben wurde (dann nicht erneut annehmen) oder das Rücklesen nicht antwortete | `wlo_list_suggestions` ansehen |
| `timeout` | Vom Repository kam keine Antwort: Zeitüberschreitung **oder Verbindungsabbruch nach abgesandter Anfrage** (seit 2026-11-13 — ein Abriss galt vorher als Fehlschlag). Bei Schreibwerkzeugen `outcomeOpen`: `false` = der Aufruf trug keinen Schlüssel, war also eine Vorschau (gefahrlos wiederholen); `true` = kann gewirkt haben (erst nachsehen). Eine Anfrage, die nachweislich nie abging (Verbindung abgelehnt, Name nicht auflösbar, TLS-Aufbau gescheitert), ist `upstream_error`. In den Sammel-Werkzeugen bleibt ein solcher Schritt zunächst `pending` und wird beim nächsten Aufruf erneut versucht — höchstens dreimal, dann `failed` mit `outcomeOpen: true`. Bei Lese-Werkzeugen ohne `outcomeOpen` | je nach `outcomeOpen` |
| `not_visible` / `unverified` | Angenommen, aber im Datensatz nicht zu sehen / nicht überprüfbar | nachsehen, nicht blind wiederholen — auch nicht über eine neue Vorschau |
| `not_stored` | Rückgelesen: einzelne Felder sind nicht angekommen (abgelehnt, verworfen oder anders gespeichert); was ankam, steht im Text. `outcomeOpen: false`, wenn kein Feld ankam — außer bei `wlo_create_content`: dort ist der Datensatz angelegt, also immer `true` (bekam ein Schritt NACH dem Anlegen keine Antwort, kommt `unverified` mit `error.nodeId` — nicht erneut anlegen; ein mit 5xx beantwortetes Anlegen ist ebenfalls `unverified`/`outcomeOpen: true`). Bei `wlo_attach_fulltext[s]`: angenommen, aber anders zurückgelesen — immer `outcomeOpen: true` | bei `false` neue Vorschau (sie zeigt nur, was fehlt); bei `true` erst nachsehen |
| `changed_since_preview` | `wlo_update_contents`, `wlo_attach_fulltext[s]`: unmittelbar vor dem Schreiben stand im Datensatz nicht mehr, was bestätigt wurde (jemand hat dazwischen geändert; beim Volltext: eine inzwischen hinzugekommene Datei ist `would_replace_file`). Nichts gesendet, `outcomeOpen: false` | neue Vorschau |
| Volltext: `not_a_record` (Sammlung oder Ordner — ein Volltext ist der Inhalt eines Datensatzes) · `would_replace_file` · `link_record` · `too_large` · `nothing_to_change` · `unreadable` · `unreadable_original` · `text_unreadable` · `file_replaced` | `wlo_attach_fulltext[s]`, alle außer `file_replaced` VOR jedem Schlüssel und `outcomeOpen: false`; `would_replace_file`, `not_found` und `unreadable` zusätzlich unmittelbar vor dem Schreiben — dann NACH der Einlösung (der Schlüssel ist verbraucht), nichts gesendet, `outcomeOpen: false`: Datensatz trägt Inhalt (der Text würde ihn ersetzen, gemessen 2026-11-13 — die frühere Datei bliebe nur in der Versionsliste) · verlinkter Datensatz · über 2 000 000 Bytes · derselbe Text steht schon da (bei W1 kein Fehler, sondern `{confirm: null, unchanged: true}`) · Datensatz bzw. Original nicht lesbar · vorhandener Text nicht lesbar. `file_replaced` (im Betrieb nicht erreichbar, solange Datensätze mit Inhalt abgelehnt werden): Text gespeichert, Datei dabei ersetzt — `status: failed`, `outcomeOpen: true` | `would_replace_file`: Volltext nur an einem Datensatz ohne Datei ablegen · `link_record`: kein Volltext möglich · `unreadable…`: später erneut · `file_replaced`: Version wiederherstellen |
| `requiresNewPreview: true` | Nach der Einlösung: dieser Schlüssel ist verbraucht. **Keine** Aussage darüber, ob geschrieben wurde — die trifft `outcomeOpen` (immer dabei) | `outcomeOpen: false` → neue Vorschau; `true` → erst nachsehen |
| `forbidden` | Das Repository verweigert den Zugriff (401/403) | — |
| `upstream_busy` | edu-sharing ist ausgelastet (es antwortete 429 oder 503); `retryAfter` = sein `Retry-After` in Sekunden, sonst geschätzt 10. Auch als `missing`-Code der Bündel-Antworten, bei `get_collection_overview`, je Eintrag bei `find_content_by_url` und bei `wlo_health_check`. Nach einer Einlösung ohne `retryAfter`, mit `requiresNewPreview` | einmal nach `retryAfter` erneut, wenn es in die eigene Frist passt |
| `upstream_error` | Das Repository hat einen Fehler gemeldet, oder ein Werkzeug ist unerwartet abgebrochen | — |
| `refused` | Jede übrige fachliche Ablehnung; der Grund steht in `message`. Auffangnetz: jede Fehlerantwort ohne eigenen Code bekommt diesen | Text an die Person geben |
| `batch_unknown` / `batch_expired` / `batch_mismatch` · `slot_missing` · `mismatch_bytes` · `folder_failed` · `nothing_stored` | Stapel-Ablage: Freigabe unbekannt/abgelaufen/fremd · hochgeladene Datei nicht (mehr) da · Bytes passen nicht zur Freigabe · Ordner nicht anlegbar · noch keine Datei abgelegt (die Felder `status`/`reason` bleiben daneben) Alle tragen `error.outcomeOpen`: `true` bei `batch_unknown`/`batch_expired` (unter der Freigabe können früher Dateien abgelegt worden sein — `wlo_list_my_batches` zeigt sie), bei einem Abbruch ohne Antwort und immer dann, wenn das Anlegen mit einem 5xx oder ohne verwertbare ID beantwortet wurde (dann kann der Ordner bzw. Datensatz existieren — erst nachsehen, nicht erneut senden); sonst `false`. | neu vorbereiten · neu hochladen · neu hochladen · Datei erneut senden · erst eine Datei ablegen |

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
| `WLO_ALLOW_SERVICE_WRITES` | **aus** | die 20 Kuratier-Werkzeuge im Dienstkonto-Modus | An: das geteilte Konto darf ändern. Aus: Absage zur Laufzeit. Betrifft auch **stdio** — dort kommen die Zugangsdaten aus der Umgebung und gelten deshalb als Dienstkonto, selbst wenn es das eigene Login ist. |
| `WLO_ALLOW_PREPARED_WRITES` | **aus** | die Antwortform der Kuratier-Werkzeuge | An: ein *angemeldeter* Aufrufer kann einen Schreibvorgang **vorbereiten** statt ausführen — die Antwort ist eine Beschreibung der Anfrage, die ein Widget mit der Sitzung der Nutzerin abschickt. Gibt keine Rechte, nur eine andere Antwortform. Anonyme bekommen auch damit nichts. |
| `WLO_DISABLE_UNSAFE_TOOLS` | Code: **aus** (Werkzeug AN)<br>Container: **`all`** (Werkzeug AUS) | `get_url_text` | `all`, `1`, `true`, `yes` oder `on` schaltet **jedes** als unsicher erklärte Werkzeug ab; sonst eine komma- oder leerzeichengetrennte Namensliste. Ein „all" irgendwo in der Liste gewinnt. Das Werkzeug verschwindet aus `tools/list`.<br><br>**Achtung, die beiden Standards sind entgegengesetzt.** Im Code sind unsichere Werkzeuge an (deshalb warnt der Start beim Registrieren jedes einzelnen); `docker-compose.yml` dreht das auf `all`, weil eine Installation genau der Ort ist, an dem das nicht schließbare Risiko zählt. Zum Einschalten im Container die Variable **ausdrücklich leer** setzen — compose nutzt `${VAR-all}` ohne Doppelpunkt, greift also nur bei *ungesetzt*. |
| `WLO_DISABLE_SKILL_SEARCH` | **aus** | `search_skill` | An: die repository-weite Skill-Suche entfällt — für eine Installation, die auf den Registry-Prozess umgestellt hat (ein Skill wird über die Sammlung erreicht, die ihn freigibt). `get_skill` und `get_skill_registry` bleiben unberührt: die Registry gibt nodeIds aus, und `get_skill` ist genau wofür sie da sind. Nur ein ausdrückliches Ja schaltet ab — die Zeichenkette `"false"` darf nicht als „ja" gelesen werden.<br><br>**Wirkt nur im `two-tool`-Modus.** Unter `WLO_SKILL_TOOL_MODE=one-tool` wird die Fahne **ignoriert**: dort *ist* `get_skill_for_task` die Suche, und sie abzuschalten ließe den Modus ohne jeden Weg, einen Skill zu finden. Gemessen 2026-08-19. |
| `WLO_SKILL_TOOL_MODE` | `two-tool` | `search_skill` ↔ `get_skill_for_task` | `one-tool` tauscht **die Suche allein** gegen ein Werkzeug, das den passenden Skill sucht *und* lädt. Die Werkzeuganzahl ändert sich **nicht**, und `get_skill` ist in **jedem** Modus registriert — es ist das einzige Werkzeug, das eine nodeId nimmt, und die Freigabelisten geben nodeIds aus.<br><br>**Hebt `WLO_DISABLE_SKILL_SEARCH` auf**, siehe dort. |
| `WLO_BATCH_UPLOAD_ENABLED` | **aus** | `wlo_prepare_file_batch`, `wlo_store_batch_file`, `wlo_store_batch_manifest`, `wlo_list_my_batches`, Route `POST /api/uploads` | An (`1`/`true`/`yes`/`on`): die Stapel-Ablage in den persönlichen Bereich ist da — vier Kuratier-Werkzeuge plus der Upload-Platz im Arbeitsspeicher. Aus: weder Werkzeuge noch Route; `tools/list` bleibt unverändert. Nur mit eigener Anmeldung, das Dienstkonto wird abgewiesen. |
| `UPLOAD_MAX_BYTES` | 50 MB | `POST /api/uploads` | Größte Einzeldatei eines Upload-Platzes; höchstens 100 MB. Nur wirksam mit `WLO_BATCH_UPLOAD_ENABLED`. |
| `UPLOAD_MAX_TOTAL_BYTES` | 128 MB | `POST /api/uploads` | Summe aller offenen Upload-Plätze im Arbeitsspeicher; höchstens 384 MB (der Container hat 512 MB). **Eine** Anmeldung hält davon höchstens die Hälfte (seit 2026-11-13). Die Route verbraucht außerdem das Protokoll-Budget des Aufrufers (Adresse bzw. `X-WLO-Client-Key`) — `429 rate_limited` noch vor der Anmeldeprüfung — und merkt sich eine vom Repository abgelehnte Anmeldung 60 s. |
| `UPLOAD_REQUEST_TIMEOUT_MS` | 25 000 | `POST /api/uploads` | Frist für den Empfang eines Upload-Körpers; höchstens 28 000, damit sie vor der serverweiten Empfangsfrist greift und der Client eine Antwort bekommt. |
| `WLO_SEARCH_OUTPUT_MODE` | `lean` | `search` **und** `fetch` | `rich`: `search` liefert die vollen Töpfe von `search_wlo_all` samt Widget, `fetch` den vollen Datensatz samt Detailansicht. Der Schalter deckt beide, weil `search` → `fetch` ein Fluss ist — nur den ersten Schritt anzureichern ließe den zweiten nichts rendern. Die Konventionsform (ein einziger Parameter) bleibt in beiden Modi unangetastet. |
| `WLO_SKILL_CACHE` | **AN** | den Freigabekatalog an Sammlungs-Antworten | Hält die Registry jeder Sammlung im Hintergrund warm, damit ein Sammlungstreffer seinen Katalog kostenlos tragen kann. Nur ein ausdrückliches `0`, `false`, `no` oder `off` schaltet ab. Der Schalter deckt **Zeitgeber und Anfragepfad**: ohne Tick darf auch der Live-Rückfall nicht laufen, sonst zahlt jede Anfrage die volle Kinderliste, während nichts sie je verfallen ließe. |
| `WLO_TEXT_EXTRACTION_URL` | gesetzt | `get_url_text`, Volltext-Rückfall | Leer: der Extraktionsdienst ist aus, `get_url_text` antwortet mit nichts, und Volltext kommt nur noch aus `/textContent` des Repositoriums. Der Start warnt. |
| `WLO_TEXT_EXTRACTION_API_KEY` | _(leer)_ | `get_url_text`, Volltext-Rückfall | Für den Extraktionsdienst hinter dem B-API-Proxy (`WLO_TEXT_EXTRACTION_URL=https://<b-api>/api/v1/proxy/text-extraction`): der Schlüssel geht als `X-API-KEY` mit, nur an diese Adresse. Leer: direkter Aufruf ohne Schlüssel. |
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

Gemessen über `tools/list` (zuerst 2026-08-19, live bestätigt am 2026-08-20;
neu gezählt am 2026-11-08 — damals 42/41/42, seither kamen Werkzeuge dazu; heute
53 Werkzeuge im Registry-Modus). Ohne `WLO_BATCH_UPLOAD_ENABLED` gezählt; mit ihm
je vier mehr:

| Konfiguration | Skill-Werkzeuge | Gesamt |
|---|---|---:|
| nichts gesetzt | `get_skill` · `get_skill_registry` · `search_skill` | 54 |
| **`WLO_DISABLE_SKILL_SEARCH=1`** | **`get_skill` · `get_skill_registry`** | **53** |
| dasselbe **+ `WLO_SKILL_TOOL_MODE=one-tool`** | `get_skill` · `get_skill_for_task` · `get_skill_registry` | 54 |

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

Seit 2026-11-07 stehen `unresolvedFilters` und `facets` zusätzlich in
`structuredContent` (`search_wlo_content`, `search_wlo_all`,
`search_wlo_collections`, `search_wlo_within_collection`) — wer nur den Vertrag
liest, erfährt sonst nicht, dass ein Filter nicht griff. **Eine nicht auflösbare
Lizenz leert die Materialien** (0 Inhalte, keine Facetten, Hinweis mit Vorschlägen;
Sammlungen und Themenseiten filtert die Lizenz ohnehin nicht):
ungefiltert hätte sie Material unter anderer Lizenz geliefert, etwa CC BY-NC-ND auf
die Frage nach CC BY. Die übrigen Filter werden weiterhin ignoriert und gemeldet.

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

**Zu einzelnen Werkzeugen:**

- `search_wlo_all`: **Nicht erreichbar ≠ nichts vorhanden** (seit 2026-11-13): antwortet ein Sammlungsindex oder die Fachportal-Liste nicht, trägt der Bucket `incomplete: true` (`collections` bzw. `topicPages`), der Text sagt „nicht erreichbar — KEIN Befund“ statt „Keine … gefunden“; die Inhalte kommen trotzdem. `includeSkillRegistry` erzwingt einen Frischabruf, dessen Ergebnis den Zwischenspeicher ersetzt; `registryChecked` gilt nur für Sammlungen, deren Abruf wirklich geantwortet hat.
- `search_wlo_content`: **Weiterblättern** (seit 2026-11-13): derselbe Aufruf mit `excludeNodeIds` läuft nicht mehr leer — eine zu kurze Seite wird erst aus dem Rest des gereihten Fensters, dann aus bis zu drei weiteren Fenstern aufgefüllt (das Ende wird am Fenster erkannt, nicht an `total`); reicht das nicht, steht `more {nextSkipCount}` in der Antwort und der Text sagt „nicht das Ende“ statt „Keine Inhalte gefunden“. `maxResults` bis 50 wird gefüllt. **Volltext** (`includeTextContent`): nur für die ersten 20 Treffer; übrige in `textContentSkipped`, fehlgeschlagene Abrufe in `textContentUnreadable` (ein leerer `textContent` heißt nur noch „keiner hinterlegt“). Dieselben Felder trägt `search_wlo_all` in `content`.
- `search_wlo_collections`: Antwortet ein Sammlungsindex nicht: `incomplete: true` und ein Satz dazu — nie „Keine Sammlungen gefunden“ über einer Suche, die nicht geantwortet hat. `incomplete: true` steht auch im JSON-Text (Block 0), nicht nur in `structuredContent`.
- **Inhaltssuche unvollständig** (seit 2026-11-15): Die Rangsuche stellt mehrere Varianten einer Anfrage. Antwortet eine davon nicht, trägt die Antwort `incomplete: true` (`search_wlo_content`; `content.incomplete` in `search_wlo_all`; je Anfrage in `search_wlo_content_many`) und den Satz „Die Inhaltssuche hat nicht (vollständig) geantwortet …“ — „keine Treffer“ ist dann kein Befund. Ohne `incomplete` und ohne `more` ist eine leere Liste das Ende.
- **Abgelehnt ≠ nicht erreichbar** (seit 2026-11-13): beantwortet das Repository eine Unterliste mit 401/403/404, ist das kein Ausfall — `incomplete`, `childrenUnread` und `source_unreachable` werden dafür nicht gesetzt (ein erneuter Versuch ändert nichts). Stattdessen wird es GESAGT (seit 2026-11-14), denn ein abgelehnter Zweig ist auch nicht leer: im Baum trägt der Knoten `childrenRefused: true`, eine Listenantwort (`search_wlo_collections`, `get_collection_contents` mit Untersammlungen, `search_skill`) trägt `restricted: true` und den Satz „Ein Teil des durchsuchten Bereichs ist mit dieser Anmeldung nicht lesbar und fehlt in dieser Antwort …“ (`get_skill_for_task` ebenso). Das gilt für die Unterliste wie für den Inhalt einer Untersammlung — beides wird ausgelassen und gekennzeichnet, der Rest geliefert. Im Baum bleibt ein Knoten, dessen eigene Inhalte abgelehnt wurden, stehen und trägt `contentsRefused: true` (bei einem Ausfall `contentsUnread: true`); `get_collection_overview` führt ihn in `subcollections` mit `contentsRefused: true`. Themenseiten sind bewusst anders: Varianten, die diese Anmeldung nicht lesen darf, gelten dort als „keine Variante“. Ein so abgelehnter STARTKNOTEN ist ein Fehler mit dem Satz „nicht gefunden oder mit dieser Anmeldung nicht lesbar“. `error.recordExists: true` trägt immer `error.nodeId`.
- `search_wlo_topic_pages`: Antwortet der Themenseiten-Index nicht oder lässt sich die EINE genannte Sammlung nicht lesen, ist das ein Fehler (`isError`), kein „keine Themenseiten“. Mit `query`: antwortet eine der Quellen nicht (Fachportal-Liste, ein Sammlungsindex, eine Kandidaten-Sammlung), trägt die Antwort `incomplete: true` und den Satz „KEIN Befund“ statt „Keine Themenseiten für …“.
- `search`: Die Form `{results}` hat kein Feld für einen Ausfall: eine LEERE Liste über einer Sammlungssuche, die nicht geantwortet hat, kommt deshalb als Fehler (`isError`), nicht als „nichts gefunden“. Mit Treffern bleibt es eine Antwort.

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
NC- oder ND-Material. Eine Lizenz **löst** auch nur exakt auf (seit 2026-11-06):
„CC BY NC" ohne Bindestriche wurde früher still zu CC BY und landet jetzt mit
Vorschlag in `unresolvedFilters`, ebenso eine Lizenz-URI — WLO speichert
Lizenzen als Schlüssel (`CC_BY_NC`), eine URI träfe nichts. Ein Filter, der nur **geraten** aufgelöst
wurde („Arbeitsblat" → Arbeitsblatt), trägt in `_queryMeta.criteria` das Feld
`match: "fuzzy"`.

### 5.2 Sammlungen & Navigation — ohne Anmeldung

**Sammlung per Titel statt nodeId (`collection`).** `get_collection_overview`,
`get_collection_contents`, `search_wlo_within_collection`, `browse_collection_tree`
und `get_compendium_text` nehmen statt der id den Titel der Sammlung. Genommen wird
nur **genau eine** Sammlung mit gleichem Titel — nie ein Präfix oder Teilwort.
Groß-/Kleinschreibung ist egal, Leerzeichen und Bindestrich gelten als derselbe Trenner;
ä/ae, ß/ss und ein fehlender Trenner zählen nur, wenn sonst nichts passt
(`resolvedCollection.matched: "loose"`, und die Antwort sagt es). Findet die Suche zu
einer Schreibweise ohne Umlaute nichts Gleiches, sucht sie einmal mit Umlauten nach
(„Saeuren und Basen“ → „Säuren und Basen“). Die Antwort beginnt dann mit
`Sammlung: <nodeId> · unter <Pfad> — „<Titel>“` — Kennung zuerst, Titel zuletzt und in
Anführungszeichen, damit ein Titel weder Kennung noch Pfad vortäuschen kann — und trägt
`resolvedCollection {nodeId, title, path?, matched?, alsoFound?, alsoFoundTotal?}`.
Sonst läuft das Werkzeug **nicht**: Fehler `ambiguous_collection` mit `error.reason`
und `error.candidates` (bis zu fünf: `nodeId`, `title`, `path?`, `contentsCount?`,
`disciplineUnknown?`):

| `reason` | Bedeutung | Erneut versuchen hilft |
|---|---|---|
| `several` | mehrere Sammlungen tragen den Titel | nein — auswählen |
| `none` | keine trägt genau den Titel | nur bei `incomplete: true` |
| `unverified` | genau eine gefunden, aber nicht übernommen | bei `incomplete: true` ja; bei `disciplineUnverified: true` **nein** |

`incomplete: true` heißt: ein Suchindex hat nicht geantwortet oder ein Suchfenster war
voll (`windowFull: true`) — dann ist „kein gleicher Titel“ kein Befund.
`disciplineUnverified: true` heißt: ein Fach war verlangt, und die eine gefundene
Sammlung trägt keine Fachangabe. Im JSON-Modus ist `error.message` der Satz ohne die
Kandidatenzeilen (sie stehen in `candidates` und im Textblock).

**Mit Fach** (`discipline`): Trägt genau eine gleichnamige Sammlung das Fach, wird sie
genommen; gleichnamige ohne Fachangabe stehen dann in `resolvedCollection.alsoFound`
(höchstens fünf, `alsoFoundTotal` nennt die Zahl, wenn es mehr sind) und im Text unter
„Auch gefunden, Fach unbekannt“. Trägt keine das Fach, wird eine ohne Fachangabe
**nicht** genommen. `discipline` (bei
`search_wlo_within_collection`: `collectionDiscipline`) unterscheidet Gleichnamige nach
Fach; ein nicht erkanntes Fach grenzt nichts ein und steht als `unresolvedDiscipline`
in der Antwort. Eine angegebene nodeId gewinnt immer — der Titel wird dann nicht
nachgeschlagen.

| Werkzeug | Funktion | Parameter |
|---|---|---|
| `search_wlo_collections` | Kuratierte Bündel zu einem Thema finden. Fragt **beide** Repository-Indizes, weil keiner eine Obermenge des anderen ist. | query · parentNodeId · educationalContext · discipline · maxResults`=5` · excludeNodeIds · includeSkillRegistry · outputFormat |
| `get_collection_contents` | Was in dieser Sammlung liegt — Materialien und Unter-Sammlungen. Mit `includeSubcollections`: ließ sich eine Unterliste nicht lesen, trägt die Antwort `incomplete: true` und einen Hinweis (kein „Sammlung ist leer“); gab das Repository eine Untersammlung nicht heraus (401/403/404), `restricted: true` — sie wird ausgelassen, der Rest geliefert. | nodeId **oder** collection (+ discipline) · query · contentFilter (files\|folders\|both) · includeSubcollections · maxResults`=20` · skipCount · excludeNodeIds · skillContext · outputFormat |
| `search_wlo_within_collection` | Innerhalb einer Sammlung suchen und filtern. `excludeNodeIds` lässt schon Gesehenes weg (auch über das Original einer Verknüpfung), vor dem Blättern. | nodeId **oder** collection (+ collectionDiscipline — `discipline` filtert hier die Inhalte) · query · alle Filter · maxResults`=10` · skipCount · excludeNodeIds · skillContext · outputFormat |
| `get_subject_portals` | Welche Fächer/Themen es überhaupt gibt — die obersten Fach-Hubs. | educationalContext · includeContentCounts · outputFormat |
| `browse_collection_tree` | Geführtes Stöbern durch die Unterthemen eines Fachportals. Ein Zweig, dessen Unterthemen sich nicht lesen ließen, trägt `childrenUnread: true` (unbekannt, nicht leer); einer, dessen Unterthemen das Repository nicht herausgibt (401/403/404), `childrenRefused: true` (ebenfalls nicht leer, und ein erneuter Aufruf ändert nichts). Tiefe 1–3; bei Tiefe 3 höchstens **300 Knoten** insgesamt (Breite je Ast vor dem Lauf berechnet), `truncatedAt` nennt den ersten gekappten Ast — die Elternsammlung selbst, wenn schon die erste Ebene mehr als `maxResults` Unterthemen hat. | nodeId · subject (Fachportal) · collection (+ discipline; `subject` daneben grenzt nur ein) · depth`=1` (1–3) · includeContentCounts · includeContentPreview · maxResults`=50` · order`=title` (`stored` = Reihenfolge des Repositorys: gesetzte Position, sonst Anlege-Reihenfolge) · outputFormat |
| `list_collection_tree` | Der Teilbaum unter einer Sammlung als flache Liste: je Untersammlung `nodeId`, `title`, `path` (Titel ab der Start-Sammlung), `depth`, `parentId`. Bis 4 Ebenen, Ebene für Ebene, in der Reihenfolge des Repositorys (gesetzte Position, sonst Anlege-Reihenfolge); nicht je Elternknoten gekürzt. Seiten über `more.nextSkipCount`. Ein Zweig, dessen Unterliste nicht antwortete oder abgelehnt wurde, trägt `childrenUnread` / `childrenRefused`, die Antwort `incomplete` / `restricted`. Ein Aufruf sendet höchstens 400 Abfragen; endet der Lauf dort, bevor die Seite voll ist, trägt die Antwort `walkCapped` (dann eine Untersammlung als Start nehmen). Ein Start, der keine Sammlung ist: `not_a_collection`. `includeContentCounts` liest die Inhaltszahl direkt (nicht den Zähler des Repositorys, der nachhinkt). | nodeId **oder** collection (+ discipline) · depth (1–4) · maxItems (≤250) · skipCount · includeContentCounts · outputFormat |
| `get_collection_stats` | Woraus eine Sammlung besteht: Anzahl Dateien und Unter-Sammlungen plus Aufschlüsselung. | `nodeId*` · outputFormat |
| `get_collection_overview` | Eine Sammlung auf einen Blick: Kopf, Pfad, Kompendium (die oberen zwei Gliederungsebenen, Gesamtzahl der Überschriften und Länge — ohne eigenen Abruf; das volle Verzeichnis liefert `get_compendium_text`), Statistik, freigegebene Skills (erste drei mit Beschreibung), Untersammlungen mit Inhaltszahl, erste Inhalte. Teile parallel; ein fehlender Teil steht in `missing` (`timeout`/`forbidden`/`upstream_error`/`not_checked`). Fehler als Code: `not_found`, `forbidden`, `not_a_collection`. | collectionId **oder** collection (+ discipline) · include · maxContents`=10` · maxSubcollections`=30` · order`=title` (wie bei `browse_collection_tree`) |
| `count_wlo_content_matches` | Für bis zu 30 Suchanfragen zugleich die Trefferzahl (+ bis zu 3 Treffer je Anfrage). Eine Suche je Anfrage, ohne Varianten und Umsortierung — `total` ist die Zahl des Repositorys und zählt jeden Volltexttreffer, auch schwache (live: „Spiegelbild" 150, bester Treffer zu Arbeitsmärkten); die Top-Treffer zeigen, wie gut sie passt. Ein nicht auflösbarer Filter wird nie weggelassen: die Anfrage steht in `missing` (`unresolved_filter`); ein geratener in `fuzzyFilters`. Über ganz WLO, nicht in einem Teilbaum (Entscheidung E5). | `queries*` = [{id, query, filters}] (≤30) · top`=2` (0–3) |
| `search_wlo_content_many` | Bis zu 8 Inhaltssuchen in EINEM Aufruf, je bis zu 5 Treffer in Kurzform unter der `id` der Anfrage (nodeId, Titel, URL, Beschreibung ≤200 Zeichen, Typ, Bildungsstufe, Lizenz; `originalId` bei einer Verknüpfung; `previewUrl`, wenn der Datensatz ein Vorschaubild hat) — etwa ein Material je Schritt eines Lernpfads. Auf Zeit gebaut: höchstens 3 Suchvarianten je Anfrage über ein kleineres Fenster (10 je Variante, 25 mit Lizenz), EIN Abruf-Pool für den ganzen Aufruf (halbe `WLO_UPSTREAM_CONCURRENCY`), Frist 8 s je Anfrage und 15 s je Aufruf, kein Nachladen weiterer Fenster, kein Volltext, kein Skill-Katalog. Was nicht beantwortet wurde, steht in `missing` (`unresolved_filter` · `timeout` · `upstream_busy` mit `retryAfter` …) und ist nie eine leere Liste; ein nicht auflösbarer Filter wird nie weggelassen. `distinct` zeigt ein Material nur bei der Anfrage, zu der es am besten passt (Rerank-Wert, dann Rang, dann frühere Anfrage) — die andere rückt aus ihrem eigenen Fenster nach und nennt `movedToOtherQueries`. Lizenz: nur EINE, exakt geprüft und als `licenseFilter {checked, kept}` offengelegt; `"OER"` wird abgelehnt (`invalid_input`, dafür `search_wlo_content`). Kein Blättern, keine Gesamtzahl — `more: true` sagt nur, dass es weitere gibt. | `queries*` = [{id (≤40, eindeutig), query, filters}] (≤8) · gemeinsame Filter wie `search_wlo_content` (ohne OER) · maxResults`=3` (1–5) · distinct`=false` · outputFormat |

### 5.3 Detail & Kontext — ohne Anmeldung

| Werkzeug | Funktion | Parameter |
|---|---|---|
| `get_node_details` | Die Detailansicht: Metadaten als lesbare Labels. `includeQualityInfo` ergänzt die 14 redaktionellen Bewertungen, `includeAccessInfo` Zugang, Kosten, Werbung, Barrierefreiheit und OER-Status — beides **ohne zusätzlichen Abruf**. Kompendium: Markdown zeigt eine 500-Zeichen-Vorschau, JSON nur das Signal `hasCompendium`. Mit `nodeIds` (1–50) statt `nodeId` ist die Antwort immer eine Liste `{results, missing}` — `missing: [{part, code}]` mit `not_found`/`forbidden`/`timeout`/`upstream_error`, so dass gelöscht und gesperrt auseinanderzuhalten sind —, die Anreicherungen stehen je Ergebnis; `includeRaw` und `skillContext` gelten nur mit `nodeId`. Mit `nodeId` dieselbe Form in `structuredContent`: ein Fehlgriff trägt `missing`, ein Treffer trägt `renderUrl` und die angeforderten Anreicherungen in beiden Formaten. | `nodeId` oder `nodeIds` · includeTextContent · includeParents · includeRaw · includeQualityInfo · includeAccessInfo · skillContext · outputFormat |
| `get_nodes_details` | Dasselbe für bis zu 50 ids parallel. Fehlschläge kommen in `failed` zurück, nicht als Gesamtfehler. Mit `includeTextContent` (wie bei `get_node_details`): leerer Text an einer Datei → `textContentNote` (das Repository hat keinen Text daraus gewonnen), gescheiterter oder abgelaufener Abruf → `textContentError` — die Metadaten kommen in beiden Fällen; Leerraum und Binärreste gelten nicht als Text. | `nodeIds*` · includeTextContent · includeParents · includeQualityInfo · includeAccessInfo |
| `get_related_content` | „Mehr wie dieses" — ähnliche Materialien nach einer Suche oder Detailansicht. | `nodeId*` · maxResults`=8` · includeSiblings · skillContext · outputFormat |
| `get_node_breadcrumb` | Wo eine Sammlung im Themenbaum sitzt — der Pfad von der Wurzel. | `nodeId*` · outputFormat |
| `get_node_collections` | In welchen Sammlungen ein Material geführt wird — jede gefundene Sammlung nennt ihren Katalog freigegebener Skills gleich mit, in beiden Formaten. | `nodeId*` · outputFormat |

### 5.4 Texte — ohne Anmeldung

| Werkzeug | Funktion | Parameter |
|---|---|---|
| `get_wlo_content_text` | Der eigentliche Text eines Materials. Notfalls von der verlinkten Seite — und wenn keiner da ist, wird gesagt warum. | `nodeId*` · maxChars`=200000` · outputFormat |
| `get_compendium_text` | Redaktionelle Prosa einer Sammlung, typischerweise dreiteilig: Weltwissen · Lehrplan-Kompetenzen je Stufe/Bundesland · Vorstellung der Inhalte — der Maßstab für Lückenanalyse, Sachrichtigkeit und Lernpfade. **Mit** `query` kommen per BM25 nur die passenden Absätze, **ohne** der ganze Text mit je Hauptabschnitt gekapptem Umfang. Das Inhaltsverzeichnis geht in beiden Fällen mit (gerendert als `## Inhalt`) — sonst weiß ein Modell nicht, was es *nicht* gesehen hat. Nicht getroffene Suchwörter werden benannt. **Die Antwort wird im Chat nicht angezeigt:** die Absätze sind Arbeitsmaterial für das Modell, das Lese-Widget zeigt nur eine Übergabe-Zeile (`forModel`/`passageCount` in `structuredContent`). Das Modell erhält unverändert alles. | nodeId · nodeIds · collection (+ discipline) · query · outputFormat |
| `get_wikipedia_summary` | Anriss oder ganzer Artikeltext. Ein danebenliegender Treffer liefert lieber gar keinen Artikel als den nächstähnlichen String. Antwortet Wikipedia nicht (Ausfall, 429, 5xx), steht das da — im JSON `unreachable: true` neben `found: false` —, nie „kein Artikel“; `search_wlo_all` mit `includeWikipedia` trägt dafür `wikipediaUnreachable: true`, `/api/wikipedia` antwortet 503 statt 404. | `query*` · language`=de` · sections`=1` · fullText · maxChars`=200000` · outputFormat |
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
| `search_skill` | Skills im Repository suchen. Entfällt mit `WLO_DISABLE_SKILL_SEARCH`; unter `WLO_SKILL_TOOL_MODE=one-tool` ersetzt `get_skill_for_task` dieses Werkzeug. Auf eine Sammlung eingegrenzt: konnte sie nicht vollständig gelesen werden (mehr Dateien als eine Seite, Tiefe, ein nicht lesbarer Teil), sagt die Antwort das (`incomplete: true` + `incompleteNote` im JSON) — eine leere Liste ist dann kein Befund; `get_skill_for_task` meldet es ebenso statt „Keine Skills gefunden“. | query · maxResults · collectionId · includeSubcollections · discipline · educationalContext · outputFormat Ist die Liste unvollständig (`incomplete: true`), nennt `incompleteReason` den Grund: `unreachable` (ein Teil hat nicht geantwortet — erneut versuchen kann helfen) oder `limit` (Seitengröße, Tiefe, Besuchsgrenze — erneut versuchen ändert nichts). |
| `get_skill` | `structuredContent` in beiden Formaten: `{found, nodeId, title?, contentLoaded, contentRefused?}` — `contentRefused` ist `too_large` oder `not_text`, eine Ablehnung ist also ohne Textauswertung erkennbar. Die Anleitung per nodeId laden — der Markdown-Volltext, wortgetreu und **nie gekürzt** (seit 2026-08-20; der 64-KiB-Deckel gewöhnlicher Datei-Downloads gilt auf dem Skill-Pfad nicht — eine halbe Anleitung ist schlimmer als keine). **Ganz oder gar nicht** (seit 2026-11-12): eine Datei, die sicher kein Text ist (Video, Audio, Bild, PDF, Archiv, Office), oder die größer als 2 MiB ist — als Datei wie als Text-Extrakt —, wird nicht geladen; die Antwort sagt das, im JSON als `skill.contentRefused` (`not_text` / `too_large`) bei `content: null`. In **jedem** Modus registriert. | `nodeId*` · includeFiles · outputFormat |
| `get_skill_registry` | Welche Skills für **eine** Sammlung freigegeben sind. Mit `context` nur der eine Arbeitszusammenhang samt Anleitung der Redaktion. Mit `task` wählt das Werkzeug unter den freigegebenen den passendsten und liefert seine **Anleitung** gleich mit, zusammen mit den Anweisungen der Redaktion (`task.instructions`) — aber nur bei eindeutiger Wahl (Wortübereinstimmung, deutlicher Abstand); sonst `match: ambiguous` mit den Kandidaten, `none` wenn keiner passt, `unreadable` wenn der passende nicht lesbar ist. | `collectionId*` · context · task · outputFormat |

Der Freigabekatalog reist **kostenlos** an jeder Sammlungs- und
Themenseiten-Antwort mit (aus dem Cache). Ein *benannter* `skillContext` kostet einen Live-Abruf von rund
1,0–1,4 s, weil die Prosa der Redaktion nicht im Cache liegt. Ein Fehlgriff
liefert die vollständige Antwort und nennt die vorhandenen Kontexte — nie einen
Fehler.

### 5.7 Vokabular & Betrieb — ohne Anmeldung

| Werkzeug | Funktion | Parameter |
|---|---|---|
| `lookup_wlo_vocabulary` | Welche Werte ein Feld annimmt — für Filter **und** fürs Schreiben. `qualityScale` nennt jede Stufe jeder Qualitätsbewertung samt Beschriftung und Kuratier-Parameter, `qualityFinding` die Prüfergebnisse. | `vocabulary*` = educationalContext \| discipline \| userRole \| lrt \| license \| targetGroup \| universitySubject \| qualityScale \| qualityFinding · query *(nur für universitySubject)* |
| `resolve_wlo_filters` | Alle Filter-Bezeichnungen eines Vorhabens in **einem** Aufruf → der gespeicherte Wert, je Wert mit `status` `exact`/`alias`/`fuzzy` (unscharf nur mit `suggestions`, nie still übernehmen); Unaufgelöstes in `unresolved` mit Vorschlägen. Lizenzen nur exakt („CC BY NC" wird nicht zu CC BY). Rein lokal. | `filters*` = {discipline · educationalContext · lrt · license · userRole · targetGroup}, je ≤10 |
| `find_content_by_url` | Gibt es zu diesen Adressen schon einen Datensatz (`ccm:wwwurl`)? `exact` = dieselbe Adresse, `normalized` = gleich nach Bereinigung (Schrägstrich, Fragment, `utm_*`/`fbclid`/`gclid`). Eine Schreibweise mit Schrägstrich oder Tracking-Parameter findet die gespeicherte Adresse im Repository nicht (gemessen) — deshalb fragt das Werkzeug bis zu drei Schreibweisen ab und vergleicht jeden Treffer selbst, weil die Suche auch Nachbarn liefert (`…-teil-2`). Fehler je Eintrag (`invalid_url`, `upstream_busy`, `not_found` für einen 404, `upstream_error`). | `urls*` (≤20) · includeCollections`=false` |
| `lookup_wlo_publishers` | Welche Anbieter Inhalte liefern, mit Materialzahl je Anbieter — als Facetten-Aggregation über den echten Index. | query · discipline · educationalContext · maxResults`=20` · outputFormat |
| `wlo_health_check` | Ist das Repository erreichbar? Latenz in ms, aufgelöste Wurzel-nodeId, Status. | — |
| `wlo_auth_status` | Wer bin ich gerade, und darf ich schreiben? Der Einstieg, wenn ein Kuratier-Aufruf abgewiesen wurde. | — |

### 5.8 Kuratierung — Anmeldung erforderlich

Alle 20 sind für jeden Aufrufer **sichtbar** und werden zur Laufzeit abgewiesen (dazu vier Stapel-Werkzeuge, die nur mit `WLO_BATCH_UPLOAD_ENABLED` erscheinen).
Jeder Aufruf ohne `confirmToken` erzeugt nur die Vorschau.

| Werkzeug | Funktion | Parameter |
|---|---|---|
| `wlo_create_content` | Neuen Datensatz anlegen — mit Metadaten, optional Text oder Datei. Mit `addToCollectionId` unter **derselben** Bestätigung gleich in eine Sammlung aufgenommen (die Aufnahme ist Teil der bestätigten Änderung); scheitert nur das Aufnehmen, bleibt der Datensatz (`collection.status` = `failed` mit Code). Gibt es zur `url` schon einen Datensatz, bietet die Vorschau an, **diesen** aufzunehmen. Eine Ziel-id, die keine Sammlung ist, wird vor der Vorschau abgelehnt. Die Antwort trägt `structuredContent {nodeId, title, collection?}`. | `title*` · description · keywords · url · language · author · publisher · licenseKey · licenseVersion · contentType · educationalContext · discipline · userRole · *14 Qualitätsfelder* · content · contentFormat · fileBase64 · addToCollectionId · confirmToken |
| `wlo_update_content` | Metadaten oder Inhalt ändern. Zeigt die Änderung auf eine Verknüpfung automatisch auf das **Original** um und sagt das in der Vorschau. Fach, Bildungsstufe und Zielgruppe (`discipline`, `educationalContext`, `userRole`) **ersetzen** das Feld; `addDiscipline`, `addEducationalContext`, `addUserRole` (seit 2026-11-13, Label oder Liste, dieselbe Vokabularprüfung, `error.candidates` unter dem Parameternamen) **fügen hinzu**: gesendet und zurückgelesen wird die ganze Liste (vorhandene zuerst, dann die neuen), verschmolzen mit den Werten des **geschriebenen** Datensatzes (Original, nicht Verknüpfung). Die Vorschau zeigt ein Hinzufügen wie bei Schlagwörtern (`Fach: + Mathematik`), ein Ersetzen als `„alt“ → „neu“`; strukturiert trägt `confirm.preview.fields[]` dann `added` (und `addedLabels`) neben `old`/`new`. Der Schlüssel bindet an die Art: ein fürs Hinzufügen erteilter bestätigt kein Ersetzen mit derselben Endliste (`confirm_mismatch`). Beide Parameter für dasselbe Feld → `invalid_input`; steht alles schon da → „Keine Änderung“. | `nodeId*` · dieselbe Feldfläche · addDiscipline · addEducationalContext · addUserRole · commit · versionComment · confirmToken |
| `wlo_submit_content` | Einen Datensatz zur redaktionellen Prüfung einreichen. | `nodeId*` · comment · confirmToken |
| `wlo_create_collection` | Sammlung anlegen. Ein `parentId` wird gelesen und muss eine Sammlung sein (`not_found` / `not_a_collection`); die Vorschau nennt die Elternsammlung mit Titel. | `title*` · description · parentId · confirmToken |
| `wlo_rename_collection` | Sammlung umbenennen. Ist die id keine Sammlung: `not_a_collection`. | `nodeId*` · `title*` · description · confirmToken |
| `wlo_add_to_collection` | Material einer Sammlung zuordnen. Eine Verknüpfungs-id (wie sie eine Sammlungsliste ausgibt) wird aufs **Original** umgeleitet, wie in `wlo_add_to_collections`; die Vorschau nennt es und trägt den Titel des Originals. Liegt das Material schon in der Sammlung, wird nichts gesendet und kein Schlüssel ausgegeben (kein Fehler). Ist das Ziel keine Sammlung: `not_a_collection`; ist das Material selbst eine Sammlung oder ein Ordner: `is_a_collection` / `is_a_folder`. | `collectionId*` · `nodeId*` · confirmToken |
| `wlo_remove_from_collection` | Zuordnung lösen. | `collectionId*` · `nodeId*` · confirmToken |
| `wlo_create_collection_tree` | Sammlungsbaum mit einer Bestätigung anlegen (≤ 250 Knoten, Tiefe 4). Je Knoten optional `discipline`, `educationalContext`, `keywords`; `shared` setzt sie für jeden neuen Knoten, ein Knoten, der ein Feld selbst nennt, ERSETZT dort den gemeinsamen Wert (leere Liste = abgeschaltet). Vokabular nur per Name, Alias oder URI; eine Ablehnung trägt `candidates`. Die Vorschau nennt je Knoten jeden Wert als Beschriftung. Eine übernommene Sammlung (`merge`) bleibt unverändert — die Vorschau nennt, was dort NICHT gesetzt wird. Kam ein Wert nicht an: `unverified` mit Code `not_visible`, die `nodeId` bleibt. | `parentCollectionId*` · `tree*` · shared · onExisting · confirmToken · continuationToken |
| `wlo_add_to_collections` | Bis zu 200 Materialien mit einer Bestätigung aufnehmen. | `pairs*` · confirmToken · continuationToken |
| `wlo_submit_contents` | Bis zu 200 Datensätze mit einer Bestätigung zur redaktionellen Prüfung einreichen (Plan wie `wlo_add_to_collections`). Ein Datensatz, der schon vorliegt, kommt als `already` zurück und wird nicht erneut eingereicht — geprüft für die Vorschau und noch einmal unmittelbar vor dem Schreiben. Status je Eintrag: `submitted`, `already`, `not_stored` (Code `dropped`: mit Erfolg beantwortet, der Datensatz zeigt aber keinen Workflow-Status), `unverified`, `failed`, solange offen `pending` (`timeout`, `not_checked`, `upstream_busy`). `failed` mit `outcomeOpen: true` heißt: Ausgang unbekannt, am Datensatz prüfen — nach einem 5xx wird der Datensatz gelesen, bevor etwas gesagt wird. Ließ sich ein Datensatz für die Vorschau nicht lesen: Fehler `not_checked`, nichts eingereicht. Ein unbrauchbarer Eintrag (nicht gefunden, Sammlung, Ordner) lehnt den ganzen Aufruf vor dem Schlüssel ab (`error.refused`). Die Notiz gilt für alle und ist Teil der Bestätigung. Liegen alle schon vor: Antwort ohne Schlüssel, kein Fehler. | `items*` [{nodeId}] · comment · confirmToken · continuationToken |
| `wlo_update_contents` | Metadaten für bis zu 200 Datensätze mit einer Bestätigung (Plan wie `wlo_add_to_collections`). Der Server entscheidet je Feld: Titel, Beschreibung, Schlagworte, Fach, Bildungsstufe, Inhaltstyp werden **geschrieben** und zurückgelesen; Lizenz, Urheber, Herausgeber, Quell-URL, Sprache, Zielgruppe und Qualitätsfelder werden als **Vorschlag** (Typ `AI`, Begründung `reason`) hinterlegt. Verknüpfung → Original. Die Vorschau nennt je ersetztem Feld **vorher → nachher** (bei Schlagworten und bei `addDiscipline`/`addEducationalContext` die ganze gesendete Liste und was davon neu ist; `addUserRole` wird wie `userRole` vorgeschlagen) — der alte Wert ist Teil der Freigabe, eine Änderung zwischen Vorschau und Bestätigung ergibt `confirm_mismatch`, eine Änderung danach (der Plan schreibt bis zu 30 min) `changed_since_preview` für diesen Datensatz, ohne dass etwas gesendet wird; strukturiert `plan` je Datensatz (`write` mit `before`/`after`, bei einem Hinzufügen zusätzlich `added`; `suggest`), `unchangedItems` und `refused` (`not_found`, `forbidden`, `unreadable`, `duplicate`, `unreadable_original`). Bleibt nichts im Plan, kommt `confirm: null` mit den Gründen; je Eintrag `status` (`stored`/`suggested`/`partly`/`not_stored`/`unverified`/`failed`), `code`, `outcomeOpen`, `written`, `suggested`. Antwortet der Vorschlags-Endpunkt mit einer leeren Liste, ist das kein Beleg: `unverified`. | `items*` (`nodeId*`, `reason`, Felder wie `wlo_update_content` einschließlich `add…`) · confirmToken · continuationToken |
| `wlo_attach_fulltext` | Volltext (Markdown, ≤ 2 000 000 Bytes) im **`textContent` des Datensatzes selbst** ablegen — gelesen über `get_wlo_content_text`/`includeTextContent`. Gesendet als Rohtext mit `mimetype=text/plain` (aus `text/markdown` extrahiert das Repository nichts), danach zurückgelesen. Steht derselbe Text schon da, ist das kein Fehler: `{confirm: null, unchanged: true, code: "nothing_to_change"}`. In der Vorschau abgelehnt (`outcomeOpen: false`): `exists` (ohne `replace`), `would_replace_file` (Datensatz trägt Inhalt — eine Datei oder einen früher hier geschriebenen Volltext; der Text würde ihn **ersetzen**, gemessen 2026-11-13: die frühere Datei bleibt nur in der Versionsliste. Das ist die Regel, kein Provisorium — ein Volltext geht nur an einen Datensatz ohne Datei, und auch ein abgelegter Volltext lässt sich nicht ersetzen), `link_record` (verlinkter Datensatz: das Repository liest dessen Text von der Seite), `too_large`, `not_found`, `forbidden`, `unreadable`, `unreadable_original`, `text_unreadable`; ein leerer Text ist `invalid_input`. Unmittelbar vor dem Schreiben wird erneut geprüft: hat der Datensatz inzwischen Inhalt bekommen, `would_replace_file`, hat er sich sonst geändert, `changed_since_preview` — beide ohne Senden, `outcomeOpen: false`. Nach der Einlösung: `stored`, `not_stored` (zurückgelesen anders, `outcomeOpen: true`), `unverified`, bei einer Ablehnung des Repositorys ihr Code — bei 4xx `outcomeOpen: false`; bei der eigenen 500 des Repositorys entscheidet das Zurücklesen (Text da → `stored`, nachweislich leer → `false`, nicht lesbar oder ohne Textangabe → `true`); 502/503/504 (womöglich ein Proxy, während das Repository noch schreibt) bleiben `true`. Datensätze mit Datei werden abgelehnt, ohne ihren Text extrahieren zu lassen (ein PDF kostet Sekunden). Verknüpfung → Original. Staging nimmt Inhalte seit 2026-11-13 wieder an (500 vom 2026-11-06 bis dahin). | `nodeId*` · `markdown*` · `source*` (`binary`/`website`/`manual`) · sourceUrl · language · replace · confirmToken |
| `wlo_attach_fulltexts` | Volltexte für bis zu 200 Datensätze mit einer Bestätigung — zusammen ≤ 3 000 000 Bytes je Aufruf (sonst `invalid_input` vor jedem Abruf; mehrere Aufrufe), je Text ≤ 2 000 000. Je Datensatz die Regeln von `wlo_attach_fulltext`. Vorschau: `counts` {`new`, `replaced`, `unchanged`, `refused`}, `refused` [{`nodeId`, `code`}] (auch `duplicate`), `unchangedItems`. Plan wie `wlo_update_contents`: `continuationToken` oder derselbe `confirmToken` setzen den gespeicherten Plan fort, kein Datensatz wird zweimal geschrieben — auch nicht, wenn zwei Bestätigungen gleichzeitig eintreffen. Hält der Server schon zu viel Text (64 MiB über alle Pläne), kommt `upstream_busy` mit `retryAfter` (60 s) **vor** der Einlösung — der Schlüssel gilt weiter. Ein nicht prüfbarer Datensatz ist `unreadable`; derselbe Datensatz ein zweites Mal (auch über eine Verknüpfung, auch wenn die erste Nennung nichts ändert) ist `duplicate`. Je Eintrag `status` (`stored`/`not_stored`/`unverified`/`failed`), `code`, `outcomeOpen` — ein Datensatz, der während des Plans Inhalt bekommt, wird nicht beschrieben (`would_replace_file`). Vorschau und Bestätigung lesen jeden Datensatz; bei 200 Einträgen kann das allein länger dauern als die ~40 s eines Plan-Abschnitts. | `items*` (`nodeId*`, `markdown*`, `source*`, sourceUrl, language) · replace · confirmToken · continuationToken |
| `wlo_update_compendium` | Kompendiumstext einer Sammlung setzen oder entfernen. Ist die id keine Sammlung: `not_a_collection`. | `nodeId*` · text · remove · confirmToken |
| `wlo_set_topic_page` | Welche Variante eine Themenseite rendert. Das einzige Werkzeug, dessen Ergebnis **sofort öffentlich** ist. | `collectionId*` · `variantId*` · confirmToken |
| `wlo_suggest_metadata` | Metadaten *vorschlagen* statt schreiben — mit Begründung, zur Entscheidung durch die Redaktion. Hinterlegt wird am **Original** (auch über eine Verknüpfungs-id, wie das Sammelwerkzeug); je WERT geprüft: was der Datensatz schon trägt, wird nicht vorgeschlagen. Nennt das Repository keinen hinterlegten Vorschlag, ist das `unverified` mit `outcomeOpen: true`, kein Erfolg. | `nodeId*` · `suggestions*` · confirmToken |
| `wlo_list_suggestions` | Offene, angenommene oder abgelehnte Vorschläge auflisten — über eine Verknüpfungs-id auch die des Originals. | `nodeId*` · status (PENDING\|ACCEPTED\|DECLINED) |
| `wlo_decide_suggestion` | Vorschlag annehmen oder ablehnen. Annehmen schreibt und liest zurück, **bevor** der Vorschlag als angenommen markiert wird; bei Feldern mit mehreren Werten (Fach, Bildungsstufe, Inhaltstyp, Zielgruppe, Sprache, Schlagwörter) wird der Wert **hinzugefügt**, nicht an die Stelle der vorhandenen gesetzt. Nur ein OFFENER Vorschlag ist entscheidbar (`already_decided`), und die Entscheidung gilt erst, wenn das Rücklesen sie zeigt (`suggestion_not_marked`). | `nodeId*` · `suggestionId*` · `decision*` · confirmToken |
| `wlo_delete_content` | Material löschen. Über eine Verknüpfungs-id trifft es **nur die Verknüpfung** — die Vorschau sagt, welcher der beiden Fälle vorliegt. Nur für einzelne Datensätze: eine Sammlung wird abgelehnt (`is_a_collection`), ein Ordner ebenfalls (`is_a_folder`). | `nodeId*` · confirmToken |
| `wlo_delete_collection` | Sammlung samt Untersammlungen löschen. Verlinkte Materialien bleiben; Datensätze, die als Original direkt in der Sammlung angelegt wurden, gehen mit (die Vorschau sagt es). Ein Datensatz oder Ordner wird abgelehnt (`not_a_collection`). | `nodeId*` · confirmToken |
| `wlo_prepare_file_batch` | **Nur mit `WLO_BATCH_UPLOAD_ENABLED`.** Ablage mehrerer Dateien in den *persönlichen* Bereich vorbereiten: Vorschau aller Einträge und **ein** Freigabe-Schlüssel (`batchToken`) für genau diese Liste. Legt nichts an. Je Eintrag `role`: `structure` (ein Strukturdokument des Vorgangs; mehrere sind erlaubt) oder `content` (Vorgabe) — Teil der Freigabe. | `target*`=home · `folderName*` · `entries*` (`title`, `sha256`, `size`, `ext`, `role`) |
| `wlo_store_batch_file` | **Nur mit `WLO_BATCH_UPLOAD_ENABLED`.** Eine Datei des freigegebenen Stapels ablegen (Datei vorher über `POST /api/uploads`). Jeder Index nur einmal. | `batchToken*` · `index*` · `ref*` |
| `wlo_store_batch_manifest` | **Nur mit `WLO_BATCH_UPLOAD_ENABLED`.** `vorgang.json` (`wlo.ablage-vorgang@2`, je Eintrag mit `rolle`; `@1` ohne Rolle wird weiter gelesen, als `content`) zum Stapel ablegen, vom Server aus der Freigabe gebaut. Titel, Kennung, Stand und Rolle jeder Datei stehen zusätzlich in `cm:description` des Datensatzes (zurückgelesen) — diesen Server lässt das Repository die Bytes einer privaten Datei nicht lesen. | `batchToken*` |
| `wlo_list_my_batches` | **Nur mit `WLO_BATCH_UPLOAD_ENABLED`, nur lesend, nur eigene Anmeldung.** Die eigenen Stapel-Ablagen, neueste zuerst: Titel, Datum, Stand (`counts`: stored/dropped/unverified/failed/open); mit `nodeId` eine Ablage samt Einträgen, je Eintrag mit `role` (`structure`/`content`). Gefunden über die Knoten-Ablage des eigenen Bereichs (flach und eine Ordnerebene), nie über den Suchindex; nicht lesbare Kennzahlen → `status: unreadable`, ein gekappter Bereich → `scanTruncated`. Fehler als Code: `login_required`, `not_found`. | limit`=10` (1–20) · nodeId |

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
| `WLO_AUTH_REGISTRY_PATH` | `/data/access-registry.json` | Die Erlaubnisliste — hält ids, nie Zugangsdaten, nur für den Eigentümer lesbar (0600). Der einzige Ort, an den zur Laufzeit geschrieben wird. Eine Server-Instanz je Datei: ein Widerruf wirkt nur in der Instanz, die ihn ausführt. |
| `WLO_PUBLIC_BASE_URL` | — | Der Aussteller-Ursprung für OAuth. Ohne ihn nur aus dem `Host`-Header, und nur unter `TRUST_PROXY`. |

### Betrieb

| Schlüssel | Standard | Wirkung |
|---|---|---|
| `PORT` · `BIND_ADDR` · `HOST_PORT` | 3000 · 127.0.0.1 · 3000 | Wo der Server lauscht. Die letzten beiden wertet **docker-compose** aus, nicht der Server. |
| `TRUST_PROXY` | Code: **0**<br>Container: **1** | Nur hinter einem eigenen Proxy einschalten — sonst fälscht jeder Client `X-Forwarded-For` und damit seine Rate-Limit-Identität. Der Container steht per Annahme hinter einem TLS-terminierenden Proxy und setzt deshalb 1. Bei direkter Freigabe (`BIND_ADDR=0.0.0.0`) **muss** wieder 0 gesetzt werden. |
| `MCP_SSE` | 1 | Server-Sent Events für den Transport (docker-compose). |
| `RATE_LIMIT_RPM` | 120 | **Werkzeugaufrufe** je Minute auf `/mcp`, gezählt je Adresse (IPv6 je /64). Nur `tools/call` zählt, in einem Batch jeder einzeln (höchstens 10 Einträge); alle POSTs zusammen dürfen das Dreifache. Ein 429 trägt die Restzeit des Fensters als `Retry-After` und einen JSON-RPC-Fehler mit `data.code: "rate_limited"`. |
| `WLO_READY_PROBE_MS` | 30000 | Wie oft die Bereitschaftsprobe edu-sharing fragt (eine Suche mit einem Treffer). Die erste Probe beim Start wärmt den Suchpfad an; jeder Takt fragt frisch, auch unter 30 s. `0` = nur auf Anfrage. |
| `TRUSTED_CLIENT_KEYS` | — | Vertraute Clients mit **eigenem** Budget statt der Adresse: `name:rpm:schlüssel`, kommagetrennt, gesendet als `X-WLO-Client-Key`. Schlüssel ≥ 32 Zeichen, nur als Hash gehalten, nie geloggt; ein unbekannter Schlüssel zählt wie keiner. Hebt nur das Anfrage-Budget, nie den Schutz gegen das Raten von Anmeldungen. **Nur von Server zu Server** — im Browser wäre der Schlüssel öffentlich; CORS lässt den Kopf bewusst nicht zu. |
| `API_RATE_LIMIT_RPM` | 30 | dito für `/api/*`. |
| `AUTH_CREDENTIAL_LIMIT` | 10 | Verschiedene Geheimnisse je Identität — der Rateversuchs-Deckel. Zählt bei `Basic` je Adresse, bei einem Zugangsblock je `jti`. |
| `TICKET_CREDENTIAL_LIMIT` | 200 | Eigenes Budget für den Ticket-Tausch eingebetteter Widgets. |
| `WIDGET_OAUTH_ORIGINS` | — | Herkünfte der Weiterleitungsziele eines eingebetteten Widgets (kommagetrennt). Eine OAuth-Anmeldung, deren geprüftes `redirect_uri` dort liegt, läuft nach **12 h** ab. Leer = kein OAuth-Block läuft ab — ChatGPT, Claude & Co. sind nie betroffen. Ticket-Blöcke laufen immer nach 12 h ab; nach dem Ablauf listet der nächste Tausch desselben noch gültigen Tickets ihn wieder für 12 h (vorher verlängert er nichts). Eine Liste ohne brauchbaren Eintrag wird als Fehler geloggt. |
| `TICKET_ALLOWED_ORIGINS` | — | Browser-Herkünfte, die ein Ticket tauschen dürfen (kommagetrennt). Eine gesetzte Liste ohne brauchbaren Eintrag (etwa ohne `https://`) lässt **keine** Browser-Herkunft zu und wird als Fehler geloggt. Andere → `403 origin_not_allowed`, ohne CORS-Kopf; ohne `Origin` (Server zu Server) nie abgewiesen. Leer = jede Herkunft wie bisher. Im Betrieb dieselbe Liste wie `CORS_ORIGINS` des Chatbots. |
| `MAX_BODY_BYTES` | 4 194 304 | Obergrenze des Anfragekörpers. Die Anmelde- und OAuth-Routen (`/auth*`, `/oauth/*`) nehmen davon höchstens 64 KiB — dort wird ein Login oder ein Block gesendet, kein Text. |
| `WLO_FETCH_TIMEOUT_MS` | 20 000 | Zeitbudget je Repository-Abruf. Ein Schreibvorgang mit `ccm:wwwurl` bekommt intern 60 s, weil das Repository die Seite rendert. |
| `WLO_UPSTREAM_CONCURRENCY` | 24 | Obergrenze gleichzeitiger Aufrufe des ganzen Prozesses ans Repository (0 = aus). Ein Aufruf ohne freien Platz wartet höchstens 5 s (bei voller Warteschlange gar nicht), wird dann nicht gesendet und erscheint als `upstream_busy` mit `retryAfter: 5` — bei den Lese-Helfern, die eine Nicht-OK-Antwort zu „leer“ abschwächen (Sammlungssuche, Themenseiten-Suche, Knotenlesen), wie ein echtes 503 als leeres Ergebnis; das trennt Audit-Paket 9. `GET /ready` misst am Limit vorbei das Repository selbst. |
| `METRICS_TOKEN` | _(leer)_ | Schaltet `GET /metrics` ein (Prometheus-Textformat), Antwort nur auf `Authorization: Bearer <Token>`; mind. 16 Zeichen, sonst bleibt die Route aus (404). Jede Antwort trägt außerdem `X-Request-Id`; dieselbe Kennung steht als `req` in jeder Logzeile der Anfrage. Ein eigenes `X-Request-Id` des Aufrufers (8–64 Zeichen aus `A–Z a–z 0–9 . _ -`) wird übernommen. |
| `LOG_LEVEL` | `info` | Niedrigste geloggte Stufe (`debug`, `info`, `warn`, `error`); ein unbekannter Wert wird mit einer Warnung ignoriert. Logzeilen sind JSON mit `timestamp`, `level`, `service`, `message` (+ `req`, bei B3-Kopfzeilen `trace_id`/`span_id`) — über HTTP auf stdout, unter stdio auf stderr. |
| `LOG_PERSONAL_DATA` | _(leer)_ | Leer: Client-Adresse, Kontoname und Suchbegriff stehen im Log als Pseudonym (`~` + 12 Hex-Zeichen, nur innerhalb eines Prozesslaufs stabil). `plain`: Klartext. Betrifft nur das Log. |
| `INTERNAL_PORT` | _(leer)_ | Zweiter Port nur für `GET /health`, `/ready`, `/metrics` (Proben, Scraper). Zusatz — die Pfade bleiben auch am öffentlichen Port. `/metrics` dort ohne Token, solange `METRICS_TOKEN` leer ist: den Port nicht veröffentlichen. |
| _(Kopfzeilen, keine Variable)_ | — | **Trace-Kontext:** `x-client-trace-id` und B3 (`b3` oder `X-B3-TraceId`/`X-B3-SpanId`/`X-B3-Sampled`) werden gelesen, nur wohlgeformt übernommen, stehen als `client_trace_id`, `trace_id`, `span_id` in jeder Logzeile der Anfrage und gehen als Kind-Span ans Repository weiter (und nur dorthin). Ohne diese Kopfzeilen wird nichts erfunden. |
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
| `GET /health` | Lebenszeichen: der Prozess läuft. | ja |
| `GET /ready` | Bereitschaft: ist edu-sharing erreichbar? 200 `{status: "ready", upstream: "ok", latencyMs, checkedAt}` oder 503 mit `upstream: "unreachable"` / `"slow"` (Probe über 5 s). Anfragen lösen höchstens alle 30 s eine Probe aus — kein Budget. | ja |
| `GET /auth/status` | Anmeldestand in **einer** Anfrage, mit denselben Regeln wie `/mcp`: `{mode, authenticated, configuredAs?, authority, displayName?, credential, upstream, expiresAt?}` (das gemeinsame **Dienstkonto** wird seit 2026-11-13 nur als `mode: "service"` gemeldet: `authority: null`, kein `configuredAs`, kein `displayName` — sein Name geht anonyme Aufrufer nichts an; ebenso im Werkzeug `wlo_auth_status`) — derselbe Inhalt wie `wlo_auth_status`; `credential` = `none`/`basic`/`access-block`/`ticket`/`service`; `upstream` = `ok` (edu-sharing hat geantwortet — `authenticated: false` heißt dann „abgelehnt“) oder `unreachable` (keine Aussage über die Anmeldung: Ausfall, 429/5xx, Zeitüberschreitung). Unbrauchbarer Bearer → 401 mit Anmelde-Aufforderung. Je Kopf 60 s zwischengespeichert — eine Antwort mit `upstream: "unreachable"` nur 10 s. Am Protokoll-Budget und am Anmelde-Schutz; ein 429 ist dort `{error, code, retryAfter}` wie auf `/api`. Ohne CORS. `expiresAt` (ISO) nur für Ticket- und Widget-Blöcke: ab dann nimmt der Server den Block nicht mehr an (eine Ticket-Sitzung kann früher enden — deren Ende kennt der Server nicht). | **nein** |
| `/api/search` · `/api/collection` · `/api/compendium` · `/api/topic-page` · `/api/wikipedia` · `/api/skills` | REST-Fläche über denselben Diensten — für Widgets und Einbettungen. | ja |
| `/auth` · `/auth/issue` · `/auth/revoke` | Zugangsblock holen und widerrufen. Das Passwort wird im Browser verschlüsselt. `POST /auth/revoke` nimmt den Block auch als `Authorization: Bearer` (ohne Rumpf) und widerruft genau ihn — zum Abmelden aus einem Backend; Antwort immer 200 `{revoked}`. Ein 429 auf `/auth*` ist `{error, code, retryAfter}` wie auf `/api` (`rate_limited` oder `too_many_logins`, `Retry-After` = Restzeit des Fensters). Antwortet edu-sharing auf die Anmeldeprüfung nicht, kommt 503 `upstream_unreachable` (`retryAfter` 10) statt „Zugangsdaten nicht akzeptiert“ — auch auf `/auth/ticket`, `POST /oauth/authorize` und `/api/uploads`. | **nein** |
| `POST /auth/ticket` | edu-sharing-Ticket gegen einen Zugangsblock tauschen — für eingebettete Widgets. Mit `TICKET_ALLOWED_ORIGINS` nur für eingetragene Herkünfte (andere 403). | ja *(exakte Ausnahme; mit Liste nur die eingetragenen)* |
| `/oauth/authorize` · `/oauth/register` · `/oauth/token` | OAuth 2.1 mit offener Registrierung und PKCE-Pflicht. | gemischt |

`/auth*` sendet **keinen** CORS-Header, und das ist keine Nachlässigkeit: beide
Missbrauchs-Zähler laufen je Client-Adresse, ein Wildcard-Ursprung ließe also
eine fremde Seite das Kontingent jeder Besucherin für einen Passwort-Rateversuch
ausgeben und das Ergebnis mitlesen. `/auth/ticket` ist die einzige Ausnahme —
exakt dieser Pfad, damit `/auth/ticket-irgendwas` sie nicht erbt.

---

*Stand: 2026-08-20 — nach dem Deploy live verifiziert (31 Proben am laufenden Server, alle grün).*
