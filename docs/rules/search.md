# Searching: materials, licences, collections, vocabularies, compendium

Binding rules for this area, moved verbatim out of `CLAUDE.md` on 2026-11-14 (the file had grown to 2154 lines).
A dated sentence records what was measured or decided that day; where a later block says "superseded", the later one holds.
Index: [README.md](README.md) · short rules: [`CLAUDE.md`](../../CLAUDE.md).

- `src/services/content-search.ts` — the ONE search for individual materials,
  behind `search_wlo_content` and the content leg of `searchAll` (audit
  2026-11-12, A-1/K-2/P-5). Three rules bind it. (1) The ranked search reads ONE
  fixed window per call (`WLO_POOL_SIZE` per variant) whatever is asked — so a
  page that comes up short after exclusion, dedupe and the licence pass is
  REFILLED from following windows (`REFILL_ROUNDS` = 3, each a whole ranked
  search), and what the bound did not reach is disclosed as
  `more {nextSkipCount}`. The END is read off the window
  (`SearchResponse.exhausted`: no variant returned a full pool), NEVER off
  `total` — that number counts the full-query variant resp. the exact licence,
  while the paging runs over all variants resp. the licence family. Measured on
  the two cases the first cut broke: a framing query whose full variant matches
  0 while its topic variant holds 480, and a licence family of 343 for 42
  exact. The ranked search is asked for its WHOLE merged window (it costs
  nothing upstream), so a short page is filled from better-ranked hits before
  any further window is read; the exact licence total is asked once, not per
  window. Paging by `excludeNodeIds` read the same window every
  time and answered "Keine Inhalte gefunden" over thousands. (2) That sentence is
  a statement about the CATALOGUE: no renderer prints it over a page that
  carries `more` — and every renderer says it: both tools in both formats, the
  HTML page, `/api/search` with `fields` (`projectEnvelope` keeps what a bucket
  says about itself) and the search widget's empty state. An envelope field the
  renderer drops is no disclosure.
  The end rule is ONE function (`windowWasLast`: no variant returned a full
  pool, OR the window is empty). A variant that FAILED is a third thing and is
  SAID (`SearchResponse.incomplete` → `incomplete` on both tools, the content
  bucket of `searchAll`, the HTML page, the widget; `contentIncompleteNotice`,
  which carries the outage phrase clients recognise): the ranked search
  tolerates one failed variant and then claims no end, so over an empty window
  the many search answered "there is more" — and the first fix "no hits", over
  a variant nobody read (review 2026-11-15).
  (3) `enrichStoredText` reads for the first `TEXT_ENRICH_MAX` hits only and
  keeps `textContent` UNSET for a text it did not read or could not read
  (`textContentSkipped` / `textContentUnreadable`) — an empty string means "the
  repository answered, and there is none".

- **Use-Case-Lücken (Lizenzfilter, Usage, Themenseiten-Variante) — COMPLETE
  (2026-08-09):** `docs/plans/2026-08-09-usecase-gap-tools.md` (design + tasks in
  one file). Three packages, of which one is deliberately NOT built.

  **P1 licence filter** — see `filter-criteria.ts` under Architecture above. One
  rule sits outside it and binds any change: the OER BUNDLE fans out over its
  four keys and merges round-robin (`services/license-search.ts`). It was five
  until 2026-08-12: `COPYRIGHT_FREE` is not an open licence — "kostenfrei
  zugänglich", ordinary copyright otherwise — and answered 12 445 records to
  callers asking for freely reusable material, which is the surplus direction
  this file already calls harmful. All three tool descriptions had always listed
  only the four, so the code was the outlier. Sending no
  criterion and filtering the generic page locally — the first version — answered
  "kein Treffer" over the 18 793 OER records staging holds for `Mathematik`,
  because relevance ranking and licence are unrelated and the top fifty carried
  no `ccm:commonlicense_key` at all. Concatenating the five instead of
  interleaving them handed the whole cap to the first key (six hits, all CC 0,
  while 11 563 CC BY-SA never appeared). Both were invisible to every test.
  Measure with FACETS before contradicting any of this: `ngsearch` takes
  `facets: string[]` and counts exact keys server-side over the whole result set.

  Three further rules from working the review's leftovers (2026-08-09): the
  facet total is DISCARDED when the bucket list is full (`FACET_LIMIT`, one
  exported constant) — a possibly-truncated sum understates the corpus while
  looking exact, and staging's 16 keys are a property of that instance;
  EVERY path that accepts `license` must disclose its exactness pass, which is
  why `searchAll` carries `content.licenseFilter {checked, kept}` (neither
  `count`, post-cap, nor `total`, the corpus, can stand in for it); and paging
  the BUNDLE is not a partition — the same `skipCount` goes to every key, so
  the tools say so and point at `excludeNodeIds`.

  "EVERY path" is literal and was found violated on two of the five the day it
  was written (2026-08-09), both in `rest/`: **an envelope field is not a
  disclosure if the renderer drops it.** `/api/search?format=html` accepts
  `license`, ran the pass, and rendered nothing — an emptied result read as a
  bare "Keine Treffer." over material that is demonstrably there — and
  `/api/collection?q=…` returned only its post-filter `total`, which is
  indistinguishable from an empty collection. The page now carries the sentences
  through `warnings`, and the counts come from the UNPROJECTED envelope, because
  `fields` may drop `licenseFilter` and a disclosure that disappears when the
  response is trimmed is no disclosure. Counting the paths is the check: three
  MCP tools plus `/api/search` (JSON and HTML) plus `/api/collection`.
  `search_wlo_within_collection` deliberately has no paging notice — it slices
  ONE locally filtered list, so its paging is a real partition.
  `content.licenseFilter` exists exactly when a licence was given AND the content
  leg ran (`include`), and that is deliberate: it is the SINGLE gate both
  `search_wlo_all` and the HTML page hang their sentences on. Emitting it as
  `{checked: 0, kept: 0}` for a collections-only call read like a filter that
  emptied the bucket, and re-deriving the condition from `include` per call site
  is a second copy of one rule — which is how the paging notice came to fire over
  a content search that never happened, twice.

  A review of that fan-out (2026-08-09) found three more, and they bind too. (a)
  The reported total is the FACET count of exact keys (`exactLicenseTotal`),
  never a sum of the keys' `pagination.total`: the families NEST — `CC_BY`
  contains `CC_BY_SA` (Mathematik 27 351 vs 3 848 + 9 554) and also the NC/ND
  records — so summing overstated by 98–164 % (`Mathematik` 37 851 for 14 343),
  and a single licence reported its family (343 over a list of 42). Facet buckets
  are matched through `resolveVocab`, the SAME resolution `filterByExactLicense`
  applies to a node, because the index holds `CC BY-SA` with spaces as its own
  key — count and list must not disagree about what counts. (b) Every path that
  accepts `license` needs its own exactness pass: the bundle contributes NO
  criterion, so `search_wlo_within_collection`, which matches locally, filtered
  nothing at all and answered `license: "OER"` with CC BY-NC-ND. (c) Losing one
  key is tolerated, losing ALL of them throws (four since 2026-08-12) — an empty merge is indistinguishable
  from "there is no freely reusable material on this topic".

  **P2 `wlo_register_usage` — not built, and the reason binds any retry.** The
  write endpoint is gated on an **application signature**, not a user: `POST
  /usage/v1/usages/repository/-home-` answers 403 `app signature required` for an
  authenticated service user, for every `appId` tried and for an EMPTY body (so
  the gate precedes the body), and 500 `Signature could not be verified!` when
  the four `X-Edu-App-*` headers are present but bogus — including with a
  registered app id. `prepareUsage` answers 200 and records nothing. The READ
  side works and is empty everywhere. Getting a key is not a code change: an
  edu-sharing app signature lets its holder act for arbitrary users, which
  reverses this server's auth design. Operator decision, not a task.

  **P3 `wlo_set_topic_page`** — the 14th curation tool and the only one whose
  result is immediately public: it sets `default` in `ccm:page_config`, which
  decides which variant a Themenseite renders. Measured 2026-08-09 and the reason
  every check is local: the repository validates NOTHING — `POST …/property`
  stored the literal `"not json at all"` and answered 200, and accepted the
  property on a `ccm:io`. Rules that bind any change: the stored document is
  EDITED, never composed (`setDefaultVariant` in `topic-page-config.ts`, which
  keeps unknown keys and the variant list — 28/28 real documents carry
  `variants[]`, only 2/28 a `default`); the value is written as a store ref
  (`toStoreRef`, the inverse of the `stripStoreRef` every read applies); a
  variant that is not a usable child of THIS page's config folder is refused, and
  an unreadable child listing is refused as unreadable rather than as "no such
  variant"; the read-back compares the PARSED document, because a repository
  that stores whatever it is handed proves nothing by echoing our bytes; and a
  no-op (the variant already renders) is refused rather than written again —
  `buildChangeSet` gives the other tools that for free by dropping unchanged
  FIELDS, and this change has none. The
  confirm token binds to the sentence naming page and both variants with ids —
  a document of store refs is not something a person can check in a preview.

- **Sammlungssuche über beide Backends (P1) + Vokabular-Abgleich (P2) —
  COMPLETE (2026-08-11/12):**
  - Design + Aufgaben: `docs/plans/2026-08-11-collection-name-search-and-vocab-sync.md`

  **P2 (2026-08-12):** `npm run sync:vocabs` compares the six checked-in
  vocabularies against a live repository and REPORTS — it never writes, because
  labels need judgement (ours are sometimes better than the repository's, and the
  worst defect found was a label that existed and looked fine). Four measurements
  bind any change here. (1) The mds `values` endpoint is **not** the source for
  licences: asked for `ccm:commonlicense_key` it answers with the bare key as its
  own `displayString` for all 16 values IN EVERY LOCALE; the names live in
  `GET /config/v1/language/defaults` → `LICENSE.NAMES`. For the other five
  vocabularies `values` does carry captions (100 %), which is why the script has
  two legs. (2) `pattern: ""` lists everything and the documented `"-all-"`
  returns EMPTY. (3) `ccm:taxonid` mixes 345 Hochschulfächer with 71 Schulfächer,
  separable by URI — we mirror `/vocabs/discipline/` only, by the user's decision.
  (4) `ccm:commonlicense_version` is absent on 90 of 90 sampled CC records, not
  in `DISPLAY_PROPS` and not facetable, so no display label may carry a version;
  the versioned spellings stay as ALIASES so existing prompts keep resolving.
  Three defects fixed: `COPYRIGHT_FREE` read "urheberrechtsfrei", the OPPOSITE of
  what the repository means (12 445 records); three keys were unknown, costing
  both the label and the record's survival in `filterByExactLicense`
  (`COPYRIGHT_LICENSE` 1 359, `CC_BY_SA_NC` 497 — aliased onto `CC_BY_NC_SA`
  because it is a legacy spelling of one licence, not a second one —
  `UNTERRICHTS_UND_LEHRMEDIEN` 15); and every CC label asserted "4.0". What is
  deliberately NOT mirrored is named in the script's `NOT_MIRRORED` map with the
  reason (`MULTI` is not a licence but a statement about a set), because a report
  with permanent false positives stops being read. The corpus is pinned offline
  as `CORPUS_LICENSE_KEYS` in `tests/vocabs.test.ts` — 16 keys, their record
  counts, and what each must resolve to — rather than as a live test `npm test`
  could not run (`netguard`).

  The repository answers "which collections match this word?" through TWO
  unrelated indexes and **neither is a superset of the other** (measured
  2026-08-11, re-measure before contradicting): the mds `collections` query
  cannot return the collection `9e7ae956` ("Optik") for ANY search word — terms
  occurring only in its own keywords return zero hits there — while
  `GET /collection/v1/collections/-home-/search` returns it every time; and the
  mds query matches `ccm:oeh_collection_compendium_text`, which the second
  endpoint does not read (6 of 6 checked). Neither searches the materials inside
  a collection.

  `services/collection-search.ts` is the ONE place that knows there are two, and
  the three call sites (`services/search.ts`, `services/topic-page.ts`,
  `tools/collections.ts`) go through it — enforced by
  `tests/shared-rule-discipline.test.ts`, not by this sentence. Three rules bind
  any change. (1) The name leg's own nodes are DISCARDED: that endpoint ignores
  `propertyFilter` and answers with a fixed projection without
  `ccm:page_config_ref`, so adopting them files a Themenseite as an ordinary
  collection — the same trap the mds keyword endpoint sprang on 2026-07-17. It is
  an ID source; what it contributes is re-read with our projection, and an id
  that cannot be re-read is dropped rather than adopted half-projected. (2) It
  gets its OWN cap (`NAME_LEG_MAX = 5`), never the caller's: its latency scales
  with the result count (889/1275/2565 ms at 3/5/10 for "Mathematik") and at the
  caller's cap of 10 the first version TRIPLED the collections leg — 7–10 of its
  10 hits were new ids and each had to be re-read. The leg is a repair for
  records the index cannot return at any rank, and those rank high; 5 not 3
  because "Optik" sits at position 3 of that ranking. (3) Round-robin, not
  concatenation — same rule and reason as the licence bundle; `searchAll` reranks
  afterwards and overrides it, the other two call sites do not.

  Measured cost: +0.6 to +1.2 s on the collections leg (median of 5). Live-verified
  2026-08-11: `searchAll({query:'Optik'})` returns `9e7ae956` at position 1 of the
  **topicPages** bucket — it carries a `page_config_ref`, so that bucket is right.
  Noted while verifying and NOT changed here: `searchAll` drops every collection
  with a `topicPageUrl` from the collections bucket whether or not `topicPages`
  was requested, so `include: ['collections']` never shows a Themenseite.

- **Vokabular-Abgleich: was eine Beschriftung trägt — VOLLSTÄNDIG (2026-08-18):**
  `docs/plans/2026-08-18-vokabular-abgleich.md`

  Die Messung, die P3/P4 oben an zwei Stellen korrigiert. **`_DISPLAYNAME` löst
  genau das auf, was das WIDGET im Metadatensatz deklariert** — nicht die
  URI-Form, nicht das veröffentlichte Vokabular. Belegt an EINEM Datensatz
  (`7affb314…`) mit sieben Qualitätsfeldern: nur `ccm:oeh_quality_login` kam
  beschriftet zurück, weil sein Widget als einziges die nackten Ziffern
  deklariert, die es speichert. Die Trennlinie ist also **deklariert oder nicht**,
  niemals „Ziffer oder URI" — die Gegenprobe ist `containsAdvertisement/yes`, eine
  saubere URI aus einem veröffentlichten Vokabular, die unbeschriftet bleibt.
  Damit steht die Entscheidung vom 17.8. (Qualitätsfelder nicht lesen) auf einer
  Messung statt auf einem Schluss.

  **Die Feldfläche ist fünf Felder groß, nicht drei.** Die drei Suchmuster der
  Erhebung vom 17.8. verfehlten `ccm:price` (339 687 Belegungen, **58 %** des
  Korpus) und `ccm:containsAdvertisement` (69 688) — beide standen die ganze Zeit
  in der Liste der übrigen Felder, die dasselbe Skript ausgibt. `survey-metadata.mjs`
  hat dafür eine vierte Gruppe bekommen. Merksatz: die Auffangliste eines
  Erhebungsskripts ist kein Anhang, sie ist der Teil, der die Muster prüft.

  **Ein Wert, den niemand beschriften kann, wird WEGGELASSEN (2026-08-18).**
  Nachgemessen am Datensatz `7affb314-3f66-4a86-955d-161239ec63b2`:
  `ccm:containsAdvertisement = ["5"]` mit **leerem** `_DISPLAYNAME` — die
  Sterne-Skala des Widgets statt des yes/no-Vokabulars, das 69 628 von 69 688
  Werten tragen. Der Slug-Rückfall druckte daraus `Werbung: 5`. Neben
  `Kosten: nein` und `Zugang: ohne Anmeldung` liest sich das wie eine
  beschriftete Aussage, und gerade die RICHTUNG ist nicht rekonstruierbar — auf
  dem einen Feld, wo sie verkehrt herum aus „werbefrei" „voller Werbung" macht.
  `labels()` verwirft deshalb einen Slug, der nur aus Ziffern besteht. Das ist
  dieselbe Regel, aus der 11 der 14 Qualitätsfelder gar nicht gelesen werden,
  angewandt je WERT statt je Feld — ein sauberes Feld hält gelegentlich einen
  schmutzigen. Gemessen kostet es nichts, was gebraucht wird: über 119
  Datensätze 63 Wort-Werte gegen **1** nackte Zahl, und `ccm:license_oer` (2
  Träger, numerische Slugs `oer/1`, `oer/2`) war in **beiden** Fällen
  beschriftet.

  Zwei Regeln binden jede Änderung hier. (1) **`VOCAB_FALLBACK` ist eine
  Rückfallebene, kein Vorrang**, und hat genau einen Eintrag
  (`ccm:containsAdvertisement`: `yes`/`no`). Sein Widget deklariert die
  Sterne-Skala `quality_advertisement/0…5`, während 69 628 von 69 688 Werten
  `containsAdvertisement/yes|no` lauten — das Repository schweigt also. Das
  schränkt die Regel „keine Vokabular-Tabelle" ein, ohne sie aufzuheben: sie
  schützt vor einer dritten Quelle, die einer Instanz hinterherhängt, und hier
  gibt es nichts, wovon sie abweichen könnte. Liegt ein `_DISPLAYNAME` vor,
  gewinnt es, ohne dass jemand die Tabelle anfasst. (2) `ccm:oeh_quality_login`
  ist sauber beschriftet und auf 72 787 Datensätzen gesetzt und wird trotzdem
  **nicht** gelesen — unverändert aus dem gleichen Grund wie am 17.8.:
  `ccm:conditionsOfAccess` sagt dasselbe dreiwertig auf 198 699 Datensätzen.

  Drei Messfallen, teuer bezahlt: **`skipCount` jenseits von ~10 000 antwortet
  HTTP 500** (eine frühere Sonde schien mit 550 000 durchzukommen — sie hatte die
  Schleife vorher verlassen); der **Kopf einer leeren Anfrage ist keine
  Stichprobe** (300 Datensätze ohne einen einzigen Träger eines Feldes, das auf
  12 % des Korpus liegt — wer streuen will, streut über SUCHWÖRTER); und ein
  Datensatz kann **im Suchindex stehen und beim Knotenlesen 404 antworten**, also
  braucht eine Trägersuche mehrere Kandidaten je Feld.

- **Kompendiumstext: Inhaltsverzeichnis + gezielte Passagen — VOLLSTÄNDIG
  (2026-08-18):** `docs/plans/2026-08-18-kompendium-bm25-design.md` (Entwurf und
  Aufgaben in einer Datei).

  `get_compendium_text` nimmt einen `query`. Mit ihm kommen die passenden
  Absätze zurück (BM25, `src/text-bm25.ts`), ohne ihn der ganze Text mit je
  Hauptabschnitt gedeckelten Abschnitten. Das **Inhaltsverzeichnis geht in
  beiden Fällen mit** — ein Modell, das nur Ausschnitte sieht, weiß sonst nicht,
  was es nicht gesehen hat, und kann die zweite, genauere Frage nicht stellen.

  Vier Messungen binden jede Änderung hier (Staging, 2026-08-18, 158 Sammlungen
  über acht Suchwörter, davon **11 mit Kompendiumstext** — neu messen, bevor man
  ihnen widerspricht):

  1. **„je H1 kappen" kappt das ganze Dokument.** 10 von 10 Texten mit
     Überschriften tragen **genau eine H1** (den Titel) und 11–18 H2. Der Deckel
     gilt deshalb je **Hauptabschnitt**, und das ist die flachste
     Überschriftenebene, die **mindestens zweimal** vorkommt (`topLevelOf`,
     `services/compendium-view.ts`) — sonst die flachste überhaupt, ohne
     Überschrift der ganze Text. Bei 2 000 ändert sich genau **ein** Text
     (Optik, 65 250 → 18 744 Zeichen Körper, 6 von 12 Abschnitten), die anderen
     neun kommen unverändert. Der Deckel ist für den Ausreißer.
  2. **Ein roher Absatz ist die falsche BM25-Einheit.** 329 der 972 echten
     Absätze sind kürzer als 40 Zeichen (Tabellenzeilen, Listenpunkte); BM25
     normalisiert auf die Länge, also schlägt die 4-Zeichen-Zeile den Absatz,
     der sie erklärt. Eine Passage ist ein **Absatzlauf innerhalb EINES
     Abschnitts, aufgesammelt bis 200 Zeichen** — und sie überschreitet nie eine
     Überschrift, sonst trüge sie einen Pfad, den ihr Text nicht stützt.
  3. **Der Abschnitt als Einheit wäre zu grob:** p50 276 Zeichen, aber der
     größte Eigentext hat **16 317**.
  4. **Nicht getroffene Suchwörter werden benannt.** „Lehrplan Thüringen
     Regelschule" trifft auf Optik nur über `lehrplan`; die Antwort ist voller
     Lehrpläne aus Rheinland-Pfalz. `rankBm25` liefert `unmatched` deshalb selbst
     — ein Aufrufer, der es herleitet, braucht eine zweite Kopie der Trefferregel.

  Fünf Regeln der Umsetzung. (a) Die **Termhäufigkeit zählt über `termMatches`**,
  nicht über Token-Gleichheit: deutsche Komposita sind der gemessene Grund, aus
  dem `node-match.ts` existiert. **Dazu gehört zwingend (a2): die ANFRAGE geht
  durch denselben Tokenizer wie die Dokumente** (`normalizedTerms`,
  `text-bm25.ts`). `queryTerms` allein trennt nur an Leerraum, lässt also
  Satzzeichen am Wort — und sobald die Dokumentseite Token für Token verglichen
  wird, trifft so ein Term gar nichts: gemessen kam „Rheinland-Pfalz" als NICHT
  GEFUNDEN zurück über einen Text, der es siebenmal nennt, und eine natürliche
  Frage verlor ihr letztes Wort ans „?". Das fälscht genau die Zeile, die dieses
  Paket als Ehrlichkeits-Zusage führt. `queryTerms` behält dabei die Hoheit
  darüber, WELCHE Wörter zählen, damit die Stoppwortregel eine Heimat hat; ein
  `Set` darüber, weil ein zweimal gesagtes Wort sonst doppelt punktet und
  zweimal in `unmatched` steht. (b) Serverseitiges (Titel, Inhaltsverzeichnis,
  Hinweiszeile) steht **vor** dem ungeprüften Dokument — dieselbe Regel wie bei
  `get_skill`; jede daraus stammende Zeile geht durch `oneLine`. Eine Überschrift
  mit `\r` kann die Gliederung trotzdem nicht fälschen, und zwar aus einem
  anderen Grund als vermutet: JavaScripts `.` schließt `\r` aus, die Zeile gilt
  gar nicht erst als Überschrift (gemessen). (c) **Kein Treffer ist kein Fehler**
  und fällt NICHT auf den Volltext zurück — die Antwort ist dann das
  Inhaltsverzeichnis plus der Satz, dass nichts passte. (d) Im JSON trägt eine
  `query`-Antwort `passages` und **kein** `compendiumText`: beides nebeneinander
  hebt die Verengung auf, um die der Aufrufer gebeten hat. `getCompendiumTexts`
  bleibt unangetastet — `services/search.ts` und `/api/compendium` hängen daran.

  `WLO_COMPENDIUM_SECTION_MAX` (Standard 2000) ist eine **Betreiber**-Einstellung
  und kein Aufrufparameter: der Deckel existiert, damit eine Antwort nicht endlos
  wird, und wer ihn hochsetzen kann, hat keinen.

- **What the audit of 2026-11-14 added here.** (a) The OER bundle reports `incomplete` when one of its keys failed
  or was itself incomplete; with empty results it used to answer "Keine Inhalte gefunden." (b) When the exact licence
  total cannot be had, the summed family totals are an UPPER bound and are called one (`totalIsUpperBound`) — but
  only when every key answered, and an answered facet request without buckets is an exact 0, not "unknown".
  (c) Matching normalises BOTH sides to NFC (`queryTerms`, the BM25 tokenizer, the reranker and skill-ranking
  haystacks); normalising the query alone made an NFD query miss an NFD title it used to find. A vocabulary label
  in NFD still does not resolve — that is `resolveVocab`, unchanged. (d) Scans over repository text are linear
  (`oneLine`, `parseSections`, `parseSkillReferences`): the previous expressions took 61 s, 53 s and 1.2 s on a
  200 000-character value; equivalence was checked on 300 000 fuzzed inputs each.
