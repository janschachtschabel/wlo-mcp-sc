# Volltext an hochgeladenen Inhalten und Metadaten für viele Knoten

Stand 2026-11-08 · Auftrag des Chatbot-Teams (BOERDi) vom 2026-11-07 · Entwurf und
Aufgaben in einer Datei · **Phasen 1–6 umgesetzt (2026-11-08); W1/W2 schreiben auf Staging erst nach dem Repository-Fix**

## 1. Ziel

Der Chatbot steuert den Ablauf „Upload → Volltext → Metadaten → Struktur“ für
50–200 Knoten je Vorgang. Dieses Paket gibt ihm vier Dinge, die heute fehlen:
die Rolle einer Datei im Stapel (W4), das Lesen eines angehängten Volltexts,
Metadaten für viele Knoten unter einer Bestätigung (W3) und das Anhängen von
Volltexten an einen bzw. viele Knoten (W1, W2).

## 2. Messungen (Staging, 2026-11-07/08, Testkonto, eigene Wegwerf-Knoten, danach gelöscht)

Gemessen mit dem Nicht-Admin-Testkonto im persönlichen Bereich; Skripte im
Scratchpad der Sitzung, nicht im Repository. Ergänzt um das Wissen aus der
Python-Bibliothek `edu-sharing-python-client` (gelesen, nicht benutzt) und das
Projekt-Skill `wlo-content-files`.

| # | Prüfung | Ergebnis |
|---|---|---|
| M1 | Kindobjekt anlegen (`assocType=ccm:childio`, `aspects=ccm:io_childobject`) | 200 |
| M2 | Zweites Kindobjekt mit **demselben Namen**, `renameIfExists=false` | **200, angelegt** — das Repository sichert keine Eindeutigkeit |
| M3 | `POST …/textContent` (JSON-Zeichenkette, `mimetype` text/plain bzw. text/markdown), am Kindobjekt wie am Material | **500** `InvalidTypeException … content can't be updated via NodeService#setProperty` |
| M4 | `POST …/content` (multipart) am Kindobjekt | **500**, dieselbe Meldung |
| M5 | `ccm:fulltext_content` setzen (`POST …/property`) | **500**, dieselbe Meldung; `PUT …/metadata` verwirft sie still |
| M6 | `POST …/textContent` mit `Content-Type: text/plain` bzw. `text/markdown` (Rohtext) | 415 — der Endpunkt nimmt nur JSON |
| M7 | Inhalt eines privaten Kindobjekts lesen: `GET …/content` / Download-URL | 405 / 403 |
| M8 | (nicht mehr genutzt, Kindobjekt-Variante verworfen) Herkunft am Kindobjekt: `ccm:oeh_extendedData` (JSON), `cclom:general_language`, `cclom:title`, `cm:title`, `cclom:format` per `PUT …/metadata` | alle **erhalten** |
| M9 | Material löschen | Kindobjekt danach **404** (wird mitgelöscht) |
| M10 | Suche nach einem Wort aus dem Titel (Kontrolle) | sofort gefunden — die Suche als Person funktioniert |
| M11 | Suche nach einem Wort aus einem Text am Kindobjekt (in `cm:description`) | nach 150 s **nicht** gefunden |

**M3–M5 sind ein Repository-Defekt, kein Vertrag:** jeder Schreibweg für Inhalt
scheitert mit derselben Ausnahme — derselbe Fehler, der seit dem 2026-11-06 alle
Uploads und `PUT …/references` blockiert (STATUS.md). Was `textContent` tut, wenn
er behoben ist, ist vorher gemessen bzw. in der Bibliothek dokumentiert:

- `POST …/textContent` heißt in der Spezifikation „Change content of node as
  text“; am 2026-07-31 entsprach `cclom:size` danach genau den gesendeten Bytes
  (Skill `wlo-content-files`, an einem Link-Datensatz ohne Datei). Ob es an einem
  Knoten MIT Datei die Datei ersetzt oder daneben ablegt, ist **ungemessen** —
  belegt ist nur, dass es den Inhalt schreibt. Das ist die eine Messung, an der
  W1 hängt (Abschnitt 4.4, Sicherung).
- `GET …/textContent` extrahiert aus dem Inhalt und cacht in
  `ccm:fulltext_content` (OpenAPI). Für `text/plain` kommt der Text vollständig
  zurück, für `text/markdown` und `application/json` **leer** (Bibliothek,
  gemessen 2026-08-27 und 2026-09-11). Deshalb `mimetype=text/plain`.
- Mit den eigenen Zugangsdaten ist `textContent` an einem privaten Knoten lesbar
  (Bibliothek, 2026-09-10).

## 3. Entscheidungen (Antworten auf F1–F6)

- **F1 Ablage (Nutzerentscheidung 2026-11-08):** Die Datei hängt am Knoten, der
  Volltext kommt in **`textContent` desselben Knotens** — der Weg des Repositorys,
  auch wenn er auf Staging gerade nicht schreibbar ist (M3, wird gefixt).
  Geschrieben per `POST …/textContent?mimetype=text/plain` (Rohtext unter `application/json` — eine JSON-Zeichenkette würde mit ihren Anführungszeichen gespeichert;
  `text/markdown` liefert beim Lesen leeren Text), gelesen per
  `GET …/textContent` — der Weg, den `get_wlo_content_text` und
  `includeTextContent` heute schon gehen. Kein Kindobjekt, nicht in
  `cm:description`. Dasselbe gilt für Kestra (Flow 1): dieselben Endpunkte,
  dasselbe `mimetype`.
- **F2 Größen (Nutzerentscheidung):** je Volltext höchstens 2 000 000 Bytes
  (UTF-8), je W2-Aufruf höchstens 200 Einträge und 3 000 000 Bytes zusammen —
  inline im Aufruf, keine Upload-Route. Größere Mengen = mehrere Pläne. Der
  Rumpf von `tools/call` (4 MiB) trägt das.
- **F3 Suche:** nicht messbar, solange M3 scheitert. Teil des Live-Tests nach dem
  Fix (T4.4): ein Wort aus dem Volltext suchen. Bis dahin an das Team: für
  Folgeschritte gedacht, Suche offen.
- **F4 Rolle am Knoten:** **keine** Eigenschaft. Die Rolle steht im Manifest
  (`vorgang.json`) und in dessen Zusammenfassung; `wlo_list_my_batches` liefert
  sie, Kestra liest sie über die B-API aus der Zusammenfassung. Eine Eigenschaft
  am Material wäre sichtbare Fremd-Metadaten für eine Information, die nur dem
  Vorgang gehört.
- **F5 Metadaten (Nutzerentscheidung 2026-11-08):** kein `mode`. Der **Server**
  entscheidet je Feld: beschreibende Felder werden direkt geschrieben — Titel,
  Beschreibung, Schlagworte, Fach, Bildungsstufe, Inhaltstyp
  (`DIRECT_FIELDS`) —, alles, was redaktionelle Bestätigung braucht (Lizenz,
  Urheber, Herausgeber, Quell-URL, Sprache, Zielgruppe, Qualitätsfelder), wird
  als Vorschlag angelegt (`/suggestions/v1`, Typ `AI`). Die Antwort sagt je Feld,
  was geschah.
- **F6 Verknüpfungen:** ja. W1, W2 und W3 schreiben auf das **Original**
  (`readWriteBaseline`, wie `wlo_update_content`); die Umleitung steht in der
  Vorschau und im Fingerabdruck.

## 4. Entwurf

### 4.1 W4 — Rolle im Stapel

- `wlo_prepare_file_batch`: `entries[].role` (`structure` | `content`, Vorgabe
  `content`). `BatchEntry.role`, im Fingerabdruck der Vorschau.
- Manifest-Format `wlo.ablage-vorgang@2`: jeder Eintrag trägt `rolle`;
  `summarizeManifest`/`parseManifestSummary` (`batch-manifest.ts`, EIN Ort für
  Schreiber und Leser) kennen @2 und lesen @1 weiter (Rolle dann `content`).
- `wlo_list_my_batches`: `role` je Eintrag in Text und `structuredContent`.

### 4.2 Lesen des Volltexts

- Gelesen wird über `GET …/textContent` des Knotens — das tun `get_wlo_content_text`
  und `includeTextContent` schon heute (`services/content-text.ts`). Die Herkunft
  nennt das vorhandene Feld `source` (kein neues `textSource`). Neu: bei leerem
  Text sagt die Antwort, warum (`not_extracted` = Datei da, kein Text daraus;
  `text_unreadable` = Abruf gescheitert), auch in `get_node_details`/
  `get_nodes_details` (`textContentNote`/`textContentError`); ein kurzer Text an
  einem Datensatz ohne Link zählt. Bewusst NICHT angefasst: der 4000-Zeichen-
  Ausschnitt `textContent` der Suchtreffer — ein Ausriss, kein Lesepfad.
- Kein Zusatzabruf, keine neue Ablage. Der Live-Test nach dem Fix (T4.4) prüft,
  dass ein per W1 geschriebener Text hier unverändert zurückkommt.

### 4.3 W3 — `wlo_update_contents` (Plan)

- Eingabe: `items[]` (1–200) = `{nodeId, …Felder wie wlo_update_content}`,
  `confirmToken`, `continuationToken`. Kein `mode` (F5).
- Vorschau: je Knoten die Änderungsmenge wie heute (Ziel = Original, F6), geteilt
  in „wird geschrieben“ (vorher → nachher) und „wird vorgeschlagen“; Text = Kopf
  mit Zahlen plus EINE Zeile je Datensatz in voller Länge — bewusst keine bloße
  Zusammenfassung: die Projektregel verlangt, dass alles Gesendete in der
  bestätigten Vorschau steht (Review P3); strukturiert `plan` je Datensatz;
  `confirm` aus derselben Änderungsmenge (`previewReply`). Knoten ohne Änderung zählen als `unchanged`
  und sind nicht im Plan.
- Ausführung über `plan-runner.ts` (Abschnitte, `progress`, `complete`,
  `continuationToken`, `plan_*`, `too_many_plans`). Je Eintrag
  `status` ∈ {`stored`, `suggested`, `partly`, `not_stored`, `unverified`, `failed`}
  + `code` + `outcomeOpen`. Jeder Schreibvorgang liest zurück (Regel 1).
- `ItemStatus` in `plan-runner.ts` wird um die neuen Zustände erweitert; die
  Bereit-Regel (`READY`) bleibt für Bäume unverändert.

### 4.4 W1 — `wlo_attach_fulltext`

- Eingabe: `nodeId*`, `markdown*` (≤ 2 000 000 Bytes), `source*`
  (`binary`|`website`|`manual`), `sourceUrl?` (http/https), `language?`,
  `replace` (Vorgabe false), `confirmToken`.
- **Vorschau** (vor jedem Schlüssel): Ziel (Titel, Umleitung aufs Original), Länge,
  sha256, ob schon Text vorliegt (`GET textContent`), ob der Knoten eine Datei trägt.
  Abweisungen schon hier, alle mit `outcomeOpen: false`: `not_found`, `forbidden`,
  `too_large`, `exists` (Text vorhanden, `replace` false), `nothing_to_change`
  (gleicher Text nach Normalisierung der Zeilenenden).
- **Sicherung `FULLTEXT_KEEPS_BINARY`:** ob `POST textContent` an einem Knoten MIT
  Datei die Datei behält, ist ungemessen (Abschnitt 2). Bis der Live-Test nach dem
  Staging-Fix es bestätigt, weist W1 einen Knoten mit Datei in der Vorschau ab
  (`would_replace_file`, `outcomeOpen: false`) — eine Konstante in
  `services/write/fulltext.ts`, die nach der Messung umgestellt wird (eine Zeile +
  Test + STATUS-Eintrag). Bestätigt die Messung das Gegenteil, wird der Entwurf
  hier neu entschieden, nicht still umgebaut. Ein Knoten ohne Datei ist nicht
  betroffen.
- **Ausführung:** `POST …/textContent?mimetype=text/plain&versionComment=…`
  (Rohtext unter `application/json`) → **zurücklesen** (`GET …/textContent`, Vergleich nach
  Normalisierung der Zeilenenden). Danach zusätzlich prüfen, dass Datei-Hash und
  `mimetype` des Knotens unverändert sind, sobald die Sicherung gelöst ist —
  eine ersetzte Datei wird als Fehler `file_replaced` mit `outcomeOpen: true`
  gemeldet (die alte Fassung liegt in der Versionsliste). Ergebnis `stored` |
  `not_stored` | `unverified`.
- Herkunft (`source`, `sourceUrl`, `language`) steht in der Vorschau und im
  Versionskommentar; eine eigene Ablage dafür entfällt.
- Replay nach S3 (eine Einlösung, Wiederholung liefert dieselbe Antwort).

### 4.5 W2 — `wlo_attach_fulltexts` (Plan)

- Eingabe: `items[]` (1–200, zusammen ≤ 3 000 000 Bytes) =
  `{nodeId, markdown, source, sourceUrl?, language?}`, `replace`, Schlüssel.
- Vorschau mit Zahlen (`neu`, `ersetzt`, `unverändert`, `abgelehnt`) und je
  Eintrag Code; dieselbe Einzel-Logik wie W1 (`services/write/fulltext.ts`, EIN
  Ort), dieselbe Sicherung für Knoten mit Datei. Ausführung über `plan-runner.ts`; fortgesetzt wird über
  `continuationToken` ODER den eingelösten `confirmToken` — beide führen den
  GESPEICHERTEN Plan fort, der keinen Datensatz zweimal schreibt; das allgemeine
  Replay (`replay: false`) bleibt aus, wie bei W3.
- **Speicher:** ein Plan hält bis 3 MB Text. Gesamtbudget für Volltext-Pläne
  `FULLTEXT_HOLD_MAX` = 64 MiB über alle Identitäten; darüber `upstream_busy`
  mit `retryAfter` (`FULLTEXT_BUSY_RETRY_S` = 60 s), bevor ein Schlüssel
  eingelöst wird — einmal vor dem Lesen der Datensätze (mit der Summe aller
  Texte) und einmal danach (mit dem, was der Plan wirklich hält). Der Text eines Eintrags
  wird verworfen, sobald er erledigt ist.

## 5. Architektur

| Datei | Verantwortung |
|---|---|
| `src/services/write/batch-confirm.ts`, `batch-manifest.ts`, `services/my-batches.ts`, `tools/curation-batch.ts`, `tools/curation-batch-list.ts` | W4 |
| `src/services/content-text.ts` | Grund bei leerem Text (`not_extracted`, `text_unreadable`), die eine Regel „zählt als Text“ (`isStoredText`) und das nie werfende Lesen (`readStoredText`) — auch für `includeTextContent` |
| `src/services/write/fulltext.ts` (neu) | Volltext per `textContent` planen, unmittelbar vor dem Schreiben erneut prüfen, schreiben, zurücklesen, Datei-Prüfung, Sicherung `FULLTEXT_KEEPS_BINARY` |
| `src/services/write/fulltext-plan.ts` (neu) | W2: viele planen, Duplikate, Speichergrenze, Plan-Schritt |
| `src/services/write/field-routing.ts` (neu) | `DIRECT_PROPERTIES` und die Aufteilung schreiben/vorschlagen |
| `src/services/write/update-many.ts` (neu) | W3: planen, Vorschauzeile, Prüfung vor dem Schreiben, Plan-Schritt |
| `src/services/write/plan-runner.ts` | `ItemStatus` erweitert, Wellen ≤ `PLAN_POOL` mit Vorausschau, `livePlans` |
| `src/tools/curation-fulltext.ts` (neu) | W1 (und Registrierung von W2) |
| `src/tools/curation-fulltexts.ts`, `curation-fulltext-input.ts` (neu) | W2; gemeinsame Eingabeprüfung W1/W2 |
| `src/tools/curation-update-many.ts` (neu) | W3 |
| `src/server.ts` | Registrierung (Reihenfolge: nach `wlo_update_content`) |

Abhängigkeitsrichtung: `tools/` → `services/write/` → `services/` → `wlo-*`; kein
Rückweg. Keine neue Abhängigkeit. Jedes neue Werkzeug geht durch
`registerCurationTool` (Wächter in `tests/shared-rule-discipline.test.ts`).

## 6. Risiken

- **Staging-Defekt (M3–M5):** W1, W2 und der Lesepfad lassen sich erst live
  prüfen, wenn das Repository wieder Inhalte annimmt. Bis dahin offline gegen den
  dokumentierten Vertrag; ein Live-Test (`tests/live/fulltext.test.ts`) liegt
  bereit und überspringt sich bei genau dieser Ausnahme mit Begründung.
- **Datei ersetzt:** `POST textContent` schreibt den Inhalt des Knotens; ob die
  Datei daneben erhalten bleibt, ist ungemessen. Abgefangen durch die Sicherung
  (4.4) und die Datei-Prüfung nach jedem Schreiben. Dasselbe Risiko trägt Kestra,
  wenn Flow 1 diesen Weg geht — Teil der Antwort an das Team.
- **Unbestätigter Vertrag:** dass `GET textContent` für `text/plain` den Text
  unverändert liefert, stammt aus der Bibliothek (Testtext 26 Zeichen). Der
  Zurücklese-Vergleich in W1 meldet jede Abweichung als `not_stored` statt
  Erfolg — eine falsche Annahme zeigt sich beim ersten Lauf, nicht nach Wochen.
- **Speicher der Pläne:** begrenzt durch `FULLTEXT_HOLD_MAX`.

## 7. Aufgaben

Jede Phase beginnt mit **Schritt 0: `/better-coding-workflow`** und endet mit
Review + Befundbehebung, `STATUS.md` und den Gates (`npm test`, Typen, Lint, Build).
Tests zuerst (rot), jede Schutzregel mit Gegenprobe.

**Phase 1 — W4 Rolle im Stapel**
- [x] T1.1 Test: `wlo_prepare_file_batch` nimmt `role`, Vorgabe `content`, Rolle im Fingerabdruck. (Kein `confirm_mismatch`-Pfad: der Plan liegt beim Server, `wlo_store_batch_file` nennt nur einen Index — eine andere Rolle ist ein anderer Plan mit anderem Fingerabdruck; so getestet.)
- [x] T1.2 Test: Manifest @2 trägt `rolle`; `parseManifestSummary` liest @1 (→ `content`) und @2; Unbekanntes Format → null.
- [x] T1.3 Test: `wlo_list_my_batches` zeigt die Rolle in Text und `structuredContent`.
- [x] T1.4 Umsetzung, Doku (INTEGRATION, MCP-REFERENZ, Manifest-Format).

**Phase 2 — Lesen des Volltexts**
- [x] T2.1 Test: `get_wlo_content_text` und `includeTextContent` nennen die Herkunft (`source`); leerer Text → Grund (`not_extracted`, `text_unreadable`), kurzer Text ohne Link zählt, Binärreste nicht.
- [x] T2.2 Umsetzung in `content-text.ts`, `node-details` (Tool und Dienst), Lese-Widget, Doku.

**Phase 3 — W3 `wlo_update_contents`**
- [x] T3.1 Test `field-routing`: `DIRECT_FIELDS` = Titel, Beschreibung, Schlagworte, Fach, Bildungsstufe, Inhaltstyp; alles andere → Vorschlag.
- [x] T3.2 Test: Vorschau für 3 Knoten — Zahlen, je Knoten geschrieben/vorgeschlagen, Umleitung aufs Original, `confirm` aus der Änderungsmenge; 201 Einträge → `invalid_input`.
- [x] T3.3 Test: Ausführung mit kleinem Budget — Fortsetzung über `continuationToken`, je Eintrag `status`/`code`/`outcomeOpen`, Zurücklesen; fremder Knoten → `forbidden`.
- [x] T3.4 Umsetzung (`plan-runner` `ItemStatus`, Werkzeug, Registrierung), Doku.

**Phase 4 — W1 `wlo_attach_fulltext`**
- [x] T4.1 Test Vorschau: `too_large`, `exists`, `nothing_to_change`, Umleitung, und bei Knoten MIT Datei `would_replace_file` — alle vor dem Schlüssel, `outcomeOpen: false`.
- [x] T4.2 Test Ausführung (Knoten ohne Datei): `POST textContent` als Rohtext unter `application/json` mit `mimetype=text/plain`, Zurücklesen → `stored`; Abweichung → `not_stored`; 500 nach der Einlösung → `outcomeOpen: true`.
- [x] T4.3 Test: mit gelöster Sicherung prüft die Ausführung Datei-Hash und `mimetype` danach; geändert → `file_replaced`, `outcomeOpen: true`.
- [x] T4.4 Umsetzung; Live-Test `tests/live/fulltext.test.ts` (eigener Knoten mit Datei: Volltext schreiben, Datei-Hash vorher/nachher, `GET textContent`, Suche nach einem Wort daraus — F3), überspringt sich mit Begründung, solange Staging die bekannte Ausnahme wirft; Doku.

**Phase 5 — W2 `wlo_attach_fulltexts`**
- [x] T5.1 Test: Grenzen (200 Einträge, 3 MB zusammen, 2 MB je Eintrag), Zahlen in der Vorschau.
- [x] T5.2 Test: Plan-Ausführung, Fortsetzung, Text erledigter Einträge verworfen, `FULLTEXT_HOLD_MAX` → `upstream_busy` vor der Einlösung.
- [x] T5.3 Umsetzung, Doku.

**Phase 6 — Abschluss**
- [x] T6.1 Gesamt-Review aller Phasen, Befunde beheben.
- [x] T6.2 Antwort an das Chatbot-Team (F1–F6, Format für Kestra, Staging-Defekt), Entwicklerbericht nachziehen, GitHub erst auf Zuruf.

## 8. Abnahme

- Jede Phase: die Tests ihrer Aufgaben rot → grün, Gegenproben rot, `npm test`
  ohne Fehler, Typen/Lint/Build sauber.
- Live (sobald Staging Inhalte annimmt): `npm run test:live` mit
  `tests/live/fulltext.test.ts` — am eigenen Wegwerf-Knoten mit Datei: bleibt die
  Datei erhalten (entscheidet die Sicherung), kommt der Text zurück, findet ihn die
  Suche (F3). Bis dahin steht in STATUS.md, dass W1/W2/Lesen nur offline
  geprüft sind.
- Regression: die bestehenden Suiten zu `wlo_update_content`, Stapel-Ablage,
  Plänen und `get_wlo_content_text` bleiben grün.
