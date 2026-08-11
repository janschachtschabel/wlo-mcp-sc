# Aufgaben: Skill-Registry-Cache

Entwurf: [`2026-08-11-skill-registry-cache-design.md`](./2026-08-11-skill-registry-cache-design.md)

11 Aufgaben in 4 Phasen. Jede Phase beginnt mit Schritt 0. Jede Aufgabe ist TDD:
erst der rote Test, dann der Code.

**Die Entscheidung, die das Paket klein hält:** der Cache ruft
`loadSkillRegistry(id, { resolveHeads: false })` auf — dieselbe autoritative
Kinderliste wie der Live-Pfad — und merkt sich das Ergebnis. Er baut nichts nach:
keine zweite Erkennungsregel, keine zweite Auswahl, keine zweite Kappung.

| Phase | Aufgaben | Ergebnis |
|---|---|---|
| P1 Cache-Kern | T1–T4 ✅ | Warteschlange, Takt, Ablauf, Ausfallverhalten — **fertig 2026-08-11**, 15 Tests |
| P2 Lebenszyklus | ~~T5~~ T6–T7 | T5 (Konfiguration) wurde nach P1 vorgezogen — T4 braucht die TTL. Offen: Startschuss + Intervall, Start aus den Transports |
| P3 Integration | T8–T10 | Fünf Renderpfade, Parametersemantik, Disziplin-Test |
| P4 Doku | T11 | CHANGELOG, READMEs, CLAUDE.md, STATUS.md, `.env.example` |

---

## Phase 1 — Cache-Kern

**Schritt 0: `/better-coding-workflow` aufrufen.**

### T1: Warteschlange und Lookup

**Dateien**
- Neu: `src/services/skill-registry-cache.ts`
- Neu: `tests/skill-registry-cache.test.ts`

**Was.** Der Zustand und die zwei synchronen Zugriffe — noch ohne Netz.
`lookupCachedRegistry(id): CacheEntry | undefined`,
`queueCollections(ids: string[]): void` (idempotent, überspringt bereits
Bekanntes), Deckel `QUEUE_MAX = 500` mit Warnung, `stopSkillRegistryCache()`
setzt alles zurück (damit Tests sich nicht gegenseitig beeinflussen).

**Schritte**
- [ ] Test: `lookupCachedRegistry('x')` → `undefined`.
- [ ] Test: `queueCollections(['a','a','b'])` → Warteschlangenlänge 2.
- [ ] Test: eine bereits beantwortete Sammlung wird nicht erneut vorgemerkt.
- [ ] Test: 600 ids → 500 vorgemerkt, `log.warn` gefeuert.
- [ ] Rot laufen lassen, implementieren, grün.

**Verifikation.** `node --import tsx --test tests/skill-registry-cache.test.ts`
**Rollback.** Datei löschen.

---

### T2: Der Takt — Warteschlange über die Kinderliste abarbeiten

**Dateien**
- Ändern: `src/services/skill-registry-cache.ts`
- Test: `tests/skill-registry-cache.test.ts`

**Was.** `runCacheTick(): Promise<CacheTickReport>` — nimmt bis zu
`TICK_BATCH_MAX = 50` Einträge aus der Warteschlange und löst sie über
`mapPool(ids, REGISTRY_POOL = 10, id => loadSkillRegistry(id, { resolveHeads: false }))`
auf. Ergebnis je Sammlung: `{ registry, checkedAt }` — **auch `registry: null`**,
denn „nachgesehen, keine da" ist die Antwort, wegen der die Kinderliste
überhaupt gefragt wird.

`REGISTRY_POOL` steht in `skill-registry.ts` (dort nicht exportiert); der Cache
bekommt eine eigene Konstante mit demselben Wert und einem Kommentar, warum sie
denselben Wert hat — 10 ist die gemessene Knie-Stelle (2026-08-10).

**Schritte**
- [ ] Test: eine vorgemerkte Sammlung mit Registry → Eintrag trägt sie,
      `report.found === 1`, genau **1** `/children`-Abruf.
- [ ] Test: eine ohne Registry → `registry: null`, `report.resolved === 1`,
      `found === 0`.
- [ ] Test: 60 vorgemerkt → 50 abgearbeitet, `queueLeft === 10`.
- [ ] Test: Warteschlange leer → 0 Abrufe, Report mit Nullen.
- [ ] Rot → implementieren → grün.

**Verifikation.** wie T1. **Rollback.** Funktion entfernen.

---

### T3: Ein Ausfall wird nicht zu „keine Registry"

**Dateien**
- Ändern: `src/services/skill-registry-cache.ts`
- Test: `tests/skill-registry-cache.test.ts`

**Was.** Wirft `loadSkillRegistry` (von `mapPool` genullt) oder meldet es
`reason: 'unreadable'`, wird **nichts** gemerkt und die Sammlung neu vorgemerkt.
Nur `reason: 'no_registry'` und ein gefundener Katalog werden zu einem Eintrag.
`reason: 'collection_not_found'` wird als endgültig gemerkt (`registry: null`) —
eine nodeId, die es nicht gibt, ändert sich nicht mehr und darf die
Warteschlange nicht dauerhaft belegen.

**Warum.** Nur ein Abruf, der geantwortet hat, darf zur Aussage werden. Das ist
die eine Bedingung, unter der ein Cache-Treffer `registryChecked` setzen darf.

**Schritte**
- [ ] Test: `/children` antwortet 503 → kein Eintrag, Sammlung wieder in der
      Warteschlange, `report.failed === 1`.
- [ ] Test: 404 → Eintrag `registry: null`, **nicht** wieder vorgemerkt.
- [ ] Test: eine fehlgeschlagene Sammlung kostet die anderen im Batch nichts.
- [ ] Rot → implementieren → grün.

**Verifikation.** wie T1. **Rollback.** Fehlerzweig entfernen.

---

### T4: Ablauf nach TTL

**Dateien**
- Ändern: `src/services/skill-registry-cache.ts`
- Test: `tests/skill-registry-cache.test.ts`

**Was.** Zu Beginn jedes Takts werden Einträge mit
`now - checkedAt > WLO_SKILL_CACHE_TTL_MS` neu vorgemerkt (der alte Eintrag
bleibt bis zur Neuantwort **stehen** — eine Lücke wäre schlechter als ein etwas
alter Wert). `report.expired` zählt sie. Die Uhr kommt über einen injizierbaren
`now`-Parameter, damit der Test nicht schlafen muss.

**Schritte**
- [ ] Test: Eintrag mit `checkedAt` weit in der Vergangenheit → beim nächsten
      Takt neu geprüft, `expired === 1`.
- [ ] Test: frischer Eintrag → kein erneuter Abruf.
- [ ] Test: während der Erneuerung liefert der Lookup weiterhin den alten Wert.
- [ ] Rot → implementieren → grün.

**Verifikation.** wie T1. **Rollback.** Ablauflogik entfernen.

---

## Phase 2 — Lebenszyklus

**Schritt 0: `/better-coding-workflow` aufrufen.**

### T5: Konfiguration

**Dateien**
- Ändern: `src/wlo-config.ts`
- Test: die Datei, die die übrigen Schalter prüft

**Was.** `WLO_SKILL_CACHE` (Standard **an**, `off|0|false|no` schaltet ab),
`WLO_SKILL_CACHE_REFRESH_MS` (Standard `300_000`, Grenzen 60 000 / 3 600 000),
`WLO_SKILL_CACHE_TTL_MS` (Standard `600_000`, Untergrenze = Refresh-Intervall).
Je eine Logzeile beim Modul-Load, wie bei den bestehenden Schaltern.
`WLO_REGISTRY_IN_SEARCH` wird **entfernt**, samt Import in `services/search.ts`.

**Schritte**
- [ ] Test: Standardwerte; `off`; Werte unter der Untergrenze werden angehoben;
      Unsinn fällt auf den Standard zurück.
- [ ] Rot → implementieren → grün.
- [ ] `grep -rn "WLO_REGISTRY_IN_SEARCH" src tests docs` → nur CHANGELOG-Historie.

**Verifikation.** Volle Suite. **Rollback.** Konstanten zurücknehmen.

---

### T6: Startschuss und Intervall

**Dateien**
- Ändern: `src/services/skill-registry-cache.ts`
- Test: `tests/skill-registry-cache.test.ts`

**Was.** `startSkillRegistryCache()` — bei `off` ein No-op. Sonst:
**(a)** Startschuss, ein `ngsearch` auf `ccm:oeh_extendedType = ai_prompt`
(`FILES`, `maxItems 100`, `SKILL_PROPS`); dessen `virtual:primaryparent_nodeid`
werden **vorgemerkt**, nicht übernommen. **(b)** `setInterval(runCacheTick, …)`,
`unref()`. Beides ohne `await`, jeweils mit eigenem `.catch`. Zweiter Start ist
ein No-op.

**Warum vormerken statt übernehmen.** Der Index sagt nur, wo sich Nachsehen
lohnt. Was gilt, sagt die Kinderliste — sonst hinge die Freigabeliste am Index,
was `CLAUDE.md:366` verbietet.

**Schritte**
- [ ] Test: der Aufruf kehrt **synchron** zurück, bevor der Mock geantwortet hat.
- [ ] Test: die primaryparent-ids des Korpus landen in der Warteschlange, und
      **kein** Eintrag ist ohne Takt schon beantwortet.
- [ ] Test: bei `off` kein einziger Abruf.
- [ ] Test: zweiter Start legt kein zweites Intervall an.
- [ ] Test: `stopSkillRegistryCache()` beendet es — der Testlauf endet von selbst.
- [ ] Rot → implementieren → grün.

**Verifikation.** Der Lauf muss **von allein enden**; hängt er, fehlt `unref`.
**Rollback.** Lebenszyklus-Funktionen entfernen.

---

### T7: Start nur aus den Transports

**Dateien**
- Ändern: `src/http.ts`, `src/stdio.ts`
- Test: `tests/shared-rule-discipline.test.ts`

**Was.** Beide Einstiegspunkte rufen `startSkillRegistryCache()`. Kein anderer
Ort, und **kein Modul-Load** — sonst feuert der Timer in jedem Test und
`tests/netguard.mjs` schlägt zu Recht an.

**Schritte**
- [ ] Disziplin-Test: `startSkillRegistryCache(` kommt in genau diesen beiden
      `src/`-Dateien vor.
- [ ] Rot → Aufrufe einbauen → grün.
- [ ] `npm test` → keine Netguard-Verletzung.

**Verifikation.** Volle Suite. **Rollback.** Aufrufe entfernen.

---

## Phase 3 — Integration

**Schritt 0: `/better-coding-workflow` aufrufen.**

### T8: Anreichern und vormerken

**Dateien**
- Ändern: `src/services/skill-registry-cache.ts`
- Test: `tests/skill-registry-cache.test.ts`

**Was.** `attachCachedRegistries(nodes: FormattedNode[]): number` — synchron,
ohne Abruf. Je Knoten mit `nodeType === 'collection'` und ohne bereits gesetztes
`skillRegistry`: Treffer mit Registry → Feld setzen; Treffer ohne → nichts
setzen; Fehltreffer → `queueCollections([id])`. Rückgabe: wie viele Knoten der
Cache **autoritativ** beantworten konnte — daraus leitet der Aufrufer
`registryChecked` ab. Ein vom Live-Pfad gesetztes Feld wird nie überschrieben.

**Schritte**
- [ ] Test: Sammlung mit Registry im Cache → Feld gesetzt, **0** Fetches, Rückgabe 1.
- [ ] Test: Sammlung mit `registry: null` → kein Feld, Rückgabe 1, **nicht** neu vorgemerkt.
- [ ] Test: unbekannte Sammlung → kein Feld, Rückgabe 0, **vorgemerkt**.
- [ ] Test: Inhaltsknoten werden nicht angefasst und nicht vorgemerkt.
- [ ] Test: bereits gesetztes Feld bleibt unverändert.
- [ ] Rot → implementieren → grün.

**Verifikation.** wie T1. **Rollback.** Funktion entfernen.

---

### T9: `searchAll` und die vier Werkzeugpfade

**Dateien**
- Ändern: `src/services/search.ts`, `src/tools/collections.ts`,
  `src/tools/node-relations.ts`, `src/tools/browse.ts`
- Test: `tests/search-skill-registry.test.ts`, neu `tests/tools-registry-cache.test.ts`

**Was.** Überall nach dem Formatieren und **nach** einer etwaigen Kappung
`attachCachedRegistries(...)`. In `searchAll` gilt zusätzlich:
`collections.registryChecked = true`, wenn der Live-Abruf lief **oder** der Cache
alle Sammlungen autoritativ beantworten konnte. Live läuft nur noch bei
`opts.includeSkillRegistry === true`.

**Schritte**
- [ ] Test: ohne Parameter, Cache gefüllt → Katalog da, `/children`-Zähler **0**,
      `registryChecked === true`.
- [ ] Test: Cache teilweise kalt → `registryChecked` **ungesetzt**, Hinweiszeile da.
- [ ] Test: `includeSkillRegistry: true` → Live-Abruf, `registryChecked === true`.
- [ ] Test je Werkzeug (`search_wlo_collections`, `get_collection_contents`,
      `get_node_collections`, `browse_collection_tree`): Katalog erscheint,
      **0** zusätzliche Abrufe.
- [ ] Bestehende Tests der Env-Schalter-Datei umschreiben oder entfernen.
- [ ] Rot → implementieren → grün.

**Verifikation.** Volle Suite. **Rollback.** Aufrufe entfernen.

---

### T10: Die Regeln festnageln

**Dateien**
- Ändern: `tests/shared-rule-discipline.test.ts`,
  `src/tools/collections.ts`, `src/tools/content-search.ts`

**Was.**
1. **Disziplin-Test:** Jede `src/`-Datei, die Sammlungsknoten rendert, ruft
   `attachCachedRegistries(`. Die erwarteten Dateien stehen namentlich im Test,
   damit eine neue Renderstelle auffällt.
2. **Parameterbeschreibung:** `includeSkillRegistry` heißt jetzt „erzwingt den
   Live-Abruf (Kinderliste) statt der bis zu 10 Minuten alten Cache-Antwort;
   kostet 2 Abrufe je Sammlung, ~1,0–1,4 s". Der bestehende Test wird auf den
   neuen Wortlaut gezogen, Zahl weiterhin gepinnt.

**Schritte**
- [ ] Beide Tests schreiben, rot laufen lassen.
- [ ] Beschreibungen anpassen, Disziplin-Test erfüllen.
- [ ] `npm test` → grün.

**Verifikation.** Volle Suite. **Rollback.** Test entfernen.

---

## Phase 4 — Doku

**Schritt 0: `/better-coding-workflow` aufrufen.**

### T11: Doku nachziehen

**Dateien**
- `CHANGELOG.md`, `README.md`, `README.de.md`, `docs/INTEGRATION.md`,
  `docs/SKILLS.md`, `.env.example`, `docker-compose.yml`, `CLAUDE.md`,
  `docs/plans/STATUS.md`

**Was.** Die drei neuen Schalter, die geänderte Bedeutung von
`includeSkillRegistry`, der Wegfall von `WLO_REGISTRY_IN_SEARCH`, die
TTL-Staleness — und die Regeln, die in `CLAUDE.md` gehören:

- Der Cache ist ein **Gedächtnis der Kinderliste**, nicht des Suchindex; die
  Suche ist ausschließlich Startschuss.
- Nur ein Abruf, der **geantwortet** hat, wird gemerkt — deshalb darf ein
  Cache-Treffer `registryChecked` setzen.
- Der Cache startet **nur** aus den Transports (sonst bricht die Netguard).
- Die Baummessung vom 2026-08-11 (35 / 331 / ~1335) mit dem Vermerk, sie vor
  einem Widerspruch neu zu messen — sie ist der Grund gegen den Vorab-Durchlauf.

**Schritte**
- [ ] Alle neun Dateien fortschreiben.
- [ ] `npm test`, `npm run build`, Typprüfung.

**Verifikation.** Alle drei grün. **Rollback.** Doku zurücknehmen.

---

## Abnahme

| Kriterium | Nachweis |
|---|---|
| Sammlungsabrufe liefern den Katalog mit | T9: `Skill-Registry:` in allen fünf Pfaden |
| **0** Zusatzabrufe je Anfrage | T8/T9 zählen die Fetches — Zähler auf 0 |
| Erneuerung alle 5–10 min | T5 (Intervall 300 000, TTL 600 000) + T6 |
| Nichts blockiert | T6: Start kehrt vor der ersten Antwort zurück |
| Die Zuordnung kommt aus der Kinderliste | T2: der Takt ruft `loadSkillRegistry`; T6: die Suche merkt nur vor |
| Ein Ausfall wird nicht zur Aussage | T3 |
| Kalter Cache verhält sich wie heute | T8/T9: kein Feld, Hinweiszeile steht |
| Kein unbegrenztes Wachstum | T1: Deckel mit Warnung |

**Live gegen Staging, nach P3** (kein Mock beweist das): Server starten, den
Startschuss protokollieren, eine Sammlungssuche zweimal absetzen und die Dauer
vergleichen (zweiter Lauf ohne `/children`), und — sobald die Redaktion eine
Registry angelegt hat — den `:::`-Pfad erstmals an echten Daten durchlaufen.
**Bis dahin bleibt dieser Pfad ungemessen**, wie schon im Vorpaket.
