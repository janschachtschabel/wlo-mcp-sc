# Eigene Inhalte löschen: `wlo_delete_own_content` (2026-11-20)

Auftrag: Rückmeldung des Chatbot-Teams vom 20.11. („eigene Inhalte löschen“, Punkt 1). Stand: **gebaut, live getestet** (Review folgt).
Punkt 2 der Rückmeldung (Umwandlungs-Flow) richtet sich an die Flow-Autoren; für uns hängt daran nur später
W5 `wlo_flow_file` (aus dem Plan `2026-11-17-kestra-flows-ueber-repository-proxy.md`), sobald ein Flow Dateien
liefert. Punkt 3 ist zur Kenntnis.

## 1. Ziel

Am Ende von „Themenbaum erstellen“ fragt der Chatbot: „Gliederungsdatei behalten oder aus WLO löschen?“ Gelöscht
werden darf nur, was die Person selbst in ihrem persönlichen Bereich abgelegt hat und was nirgends verwendet wird.
`wlo_delete_content` löscht alles, was die Anmeldung löschen darf — bei Redaktionskonten weit mehr. Der Chatbot
schließt es deshalb aus (R-E1). Das neue Werkzeug begrenzt der **Server** selbst.

## 2. Gemessen auf Staging (2026-11-20, `scripts/own-delete-probe.mjs`)

Testkonto, eigene Wegwerf-Knoten (`boerdi-durchtest-own-…`), am Ende gelöscht (alle 404 danach).

| Frage | Ergebnis |
|---|---|
| Heimordner | `GET …/nodes/-home-/-userhome-/metadata` → `ref.id` ist dieselbe ID wie `homeFolder.id` aus `/iam/v1/people/-home-/-me-` |
| Ersteller | `cm:creator` = `authorityName` der Identität (Zeichenkette); `cm:owner` weicht ab — taugt nicht |
| Datensatz flach im Heimordner | `virtual:primaryparent_nodeid` = Heimordner; `isPublic: false` |
| Datensatz in einem Ordner des Heimordners | Hauptelternknoten = der Ordner; der Ordner ist `ccm:map` **ohne** Sammlungs-Aspekt, sein Hauptelternknoten der Heimordner |
| Verwendungen | `GET /usage/v1/usages/node/{id}` → `{usages: []}`; nach einer Verknüpfung in eine eigene Sammlung `{usages: [1]}` (der Sammlungs-Pfad `…/collections` ebenso 0 → 1) |
| Verknüpfung und Hauptelternknoten | die Verknüpfung ändert den Hauptelternknoten nicht — „im Heimordner“ allein sagt nichts über Verwendung |
| Löschen | `DELETE …?recycle=true` → 200, danach 404 |
| Suchtreffer als „fremder“ Datensatz (für den Live-Test) | von 10 Treffern für „Physik“ lasen sich alle 10 NICHT über `…/metadata` (404); der Live-Test nimmt deshalb das Original hinter einer Verknüpfung in einer Fachsammlung |

Aus dem Skill (früher gemessen): `/usage/v1` sieht nur Verwendungen per Verknüpfung, nie das direkte Kind einer
Sammlung — das ist hier gedeckt, weil ein direktes Kind einer Sammlung deren Hauptelternknoten hat, nicht den
Heimordner. `isPublic` ist der Rechtezustand (`GROUP_EVERYONE`), kein gesetztes Merkmal.

## 3. Entscheidung

- **Eigenes Werkzeug**, kein Modus von `wlo_delete_content`: Der Chatbot erlaubt Werkzeuge nach Namen; ein Modus
  im ausgeschlossenen Werkzeug ließe sich nicht getrennt freigeben.
- **Ein Plan wie `wlo_delete_collections`** (`runPlannedCall`): Vorschau mit Urteil je Knoten, ein Schlüssel
  für die Liste, vor jedem Löschen dieselbe Prüfung noch einmal, ein 5xx bleibt `pending` und wird angesehen,
  bevor etwas erneut gesendet wird.
- Höchstens **10** nodeIds je Aufruf (eine Ablage hat bis zu fünf Gliederungen).
- Nur mit **eigener Anmeldung** (wie `wlo_start_flow`): mit dem Dienstkonto gäbe es kein „eigen“.

## 4. Bedingungen und Codes (je Knoten)

Geprüft in dieser Reihenfolge; die erste verletzte Bedingung gibt den Code. Ein Knoten, der eine Bedingung
verletzt, **bleibt** — das ist eine Antwort je Knoten, kein Fehler des Aufrufs.

| Bedingung | Code |
|---|---|
| Knoten lesbar | `not_found` (404 oder nicht lesbar) |
| ein Datensatz (`ccm:io`), keine Sammlung, kein Ordner | `is_a_collection`, `is_a_folder`, `not_a_record` (aus `wrongKind`) |
| keine Sammlungs-Verknüpfung (Aspekt `ccm:collection_io_reference`) | `is_reference` |
| `cm:creator` = Konto der Anmeldung (`accountOf`: das bestätigte Konto eines Zugangsblocks, sonst der Anmeldename; ohne Groß-/Kleinschreibung) | `not_own` |
| Hauptelternknoten = Heimordner, oder ein Ordner (`ccm:map` ohne Sammlungs-Aspekt) im Heimordner — bis zu 3 Ordnerebenen | `not_in_home` |
| keine Verwendung (`/usage/v1/usages/node/{id}` leer) | `in_use` |
| nicht öffentlich (`isPublic !== true`) | `is_public` |
| nicht feststellbar (Identität, Heimordner oder Verwendungen nicht lesbar) | `not_checked` — der Knoten bleibt |

Ergebnis je Knoten: `deleted`, `kept` (mit Code), `unverified`, `failed`, `pending` — `items [{nodeId, status, code?}]`.

## 5. Bau

- `src/node-kind.ts`: `isReferenceNode(node)` — eine Regel für den Aspekt; `services/bapi/node-metadata-write.ts`
  nutzt sie.
- `src/wlo-node.ts`: `getNodeUsageCount(id): Promise<number | null>` (`null` = nicht lesbar).
- `src/services/write/delete-own-plan.ts`: `checkOwnDeletable(nodeId, ctx)` (die Bedingungen, eine Funktion für
  Vorschau und Schritt), `resolveOwnDeletions(ids)`, `deleteOwnStep()`.
- `src/tools/curation-delete-own.ts`: `wlo_delete_own_content`, registriert nach `wlo_delete_collections`.
- `src/apps/tool-status.ts`: Statuszeilen.
- Tests: `tests/delete-own.test.ts` (jede Bedingung, Prüfung vor dem Schreiben, offener Ausgang); Live-Test in
  `tests/live/` (eigener Knoten flach und im Ordner gelöscht; ein verknüpfter bleibt `in_use`; ein fremder
  Knoten aus einer öffentlichen Sammlung bleibt `not_own`).
- Doku: Werkzeugzahl 26 → 27 Kuratier-Werkzeuge (61 in der Vorgabe), alle Dokumente mit Zählung, CHANGELOG,
  STATUS, Antwort an das Chatbot-Team.

## 6. Abnahme

- Jede Bedingung hat einen Test, der rot wird, wenn die Prüfung fehlt.
- Die Prüfung vor dem Schreiben ist dieselbe Funktion wie in der Vorschau (ein Wächter-Test oder Struktur).
- Live auf Staging: eigener Knoten gelöscht und danach 404; verknüpfter Knoten `in_use`; fremder Knoten `not_own`.
- `npm run typecheck`, `npm run lint`, `npm test` grün.
