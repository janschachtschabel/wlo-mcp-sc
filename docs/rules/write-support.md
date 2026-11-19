# Writing: curation, plans, read-backs

Binding rules for this area, moved verbatim out of `CLAUDE.md` on 2026-11-14 (the file had grown to 2154 lines).
A dated sentence records what was measured or decided that day; where a later block says "superseded", the later one holds.
Index: [README.md](README.md) · short rules: [`CLAUDE.md`](../../CLAUDE.md).

- **Write support / curation — COMPLETE (all 6 phases, 22 tasks, 2026-08-01):**
  - Design: `docs/plans/2026-08-01-write-support-design.md`
  - Tasks:  `docs/plans/2026-08-01-write-support-tasks.md` (22 tasks, 6 phases)
  - Evidence: `docs/plans/2026-07-31-write-support-research.md` — every factual
    claim is measured there; do not re-derive or contradict it without a new
    measurement.

  Targets **staging**. Six rules bind the implementation and still bind any
  change to it: every write reads back (three edu-sharing mechanisms discard a
  write while answering `200`); every mutation is confirmed two-step (preview +
  single-use token) before it happens, and EVERYTHING the call will send must be
  in the previewed change set, because the token is bound to a fingerprint of it
  (a free-text note beside the change set is an approval for text nobody saw);
  write tools refuse at call time — and since 2026-08-05 they are LISTED for
  every caller, which reverses the earlier half of this rule ("absent in
  anonymous mode") deliberately and on the user's decision: a model that never
  sees a write tool never calls one, so nothing ever asks the host to log the
  user in, and a connector stays anonymous forever. The refusal is unchanged and
  absolute; it now carries `_meta["mcp/www_authenticate"]` so the client starts
  the login. Every curation tool goes through `registerCurationTool`
  (`tools/curation-shared.ts`) — the one place that stamps `oauth2` and runs the
  gate, enforced by `tests/shared-rule-discipline.test.ts`;
  `ccm:oeh_lrt_aggregated` is never written by us (the repository derives it);
  accepting a suggestion writes and reads back BEFORE it marks the suggestion
  accepted — an `ACCEPTED` proposal over a record that never got the value reads
  as work already done (since 2026-11-13 the decision itself is read back too,
  only a PENDING proposal can be decided — and that check is the only one:
  measured the same day, the repository itself accepts DECLINED → ACCEPTED —,
  one proposal ADDS to a field holding
  several values — `valuesAfterAccept` — and proposals are filed at the
  ORIGINAL through the one pair `newProposals`/`createSuggestions` both the
  single and the batch tool use); and an ABORTED request is reported as an open outcome,
  never as a failure — the abort hits the response, not the work, so every
  curation `catch` goes through `timeoutOrError` (`tools/curation-shared.ts`)
  rather than `toolError`. A record that was CREATED is never lost to a later
  step (2026-11-13): `createContentNode` answers `created` + `incomplete`, and
  an error over an existing record carries `recordExists` — `keySpent` then
  must not say "preview again", which for a file-carrying record makes the
  second one. Since the audit of 2026-11-12 "aborted" includes a
  LOST CONNECTION after the request left (`isOutcomeOpen`,
  `services/write/timeouts.ts` — the one question; `isUpstreamTimeout` alone in a
  write path is a test failure), and the same care binds every sentence that
  says "nothing was written": `plan_expired`, `confirm_unknown` and the batch
  approvals are `outcomeOpen: true`, because a key the server no longer knows
  may have written before it was forgotten. The four planned tools share ONE
  course (`runPlannedCall`, `tools/curation-plan.ts`) — its order is the safety
  property, and a tool that calls `startPlan`/`findPlan` itself fails a test.

  Live pass against staging done 2026-08-02 (STATUS.md). It found two defects
  that every test had missed — `wlo_create_collection` and
  `wlo_rename_collection` never worked, because the tests asserted our own
  inferred request body back to us against a faked upstream. Measurements in the
  research doc §9. Lesson that binds future work: a test against `fetchMock`
  proves the code sends what we decided to send, never that the repository
  accepts it. `wlo_submit_content` was verified separately (§10) and gained the
  read-back it lacked. Every curation tool has now run against a real repository.

- **Schreibziel Original + erweiterte Metadatenfläche — VOLLSTÄNDIG (P0–P5,
  2026-08-17):** `docs/plans/2026-08-17-original-id-und-metadatenflaeche.md`
  · Messung: `docs/plans/2026-08-17-metadatenfelder-erhebung.md`

  Zwei Befunde, ein Modul. (a) Ein Metadaten-Schreibvorgang auf eine Sammlungs-
  VERKNÜPFUNG wird dort gespeichert, erreicht das Original nicht, und die
  Verknüpfung erbt danach nicht mehr — ein stiller, dauerhafter Override.
  `verifyWrite` fängt es nicht ab, weil es denselben Knoten zurückliest.
  Gemessen in `tests/live/reference-write.test.ts` (4 Tests, grün gegen Staging
  2026-08-16); Inhalts-Uploads treffen dagegen ohnehin das Original, und
  `cm:name` bleibt beim Ersetzen erhalten. **Das widerlegte die Messung im Skill
  `wlo-collections-references`** („verpufft stillschweigend, 200 OK ohne
  Effekt“); das Skill ist am 2026-08-17 korrigiert (P5) — an **zwei** Stellen,
  denn dieselbe Falschaussage stand auch in seiner Fallen-Liste. Nicht ohne neue
  Messung dorthin zurückdrehen. (b) Die Feldfläche
  (17 schreibbar, 24 lesbar) war eine Kontextfenster-Entscheidung, keine
  fachliche; Qualität, Recht und Zugänglichkeit fehlen. Neue Felder sind opt-in
  je Aufruf, damit keine bestehende Antwort länger wird.

  **P3 hat (b) gemessen, und das Ergebnis streicht P4 zusammen (2026-08-17).**
  `npm run survey:metadata` (`scripts/survey-metadata.mjs`, meldet und schreibt
  nie) fragt eine Instanz über zwei Beine, weil keines die Frage des anderen
  beantwortet: der volle Metadatensatz (17,3 MB, 1,0 s — die Warnung im Skill
  gilt der Größe, nicht der Latenz) sagt, welche Felder es GIBT und welches ein
  Vokabular hat; eine Facette je Feld sagt, ob jemand sie PFLEGT. Vier
  Messungen binden jede Änderung hier (2026-08-17, Staging, 590 186 Datensätze —
  neu messen, bevor man ihnen widerspricht):

  1. **`ccm:oeh_quality_*` gibt es — 14 Felder.** Die Annahme aus F9 ist damit
     erledigt und F9 bleibt trotzdem richtig: die vier Rechtsprüfungs-Felder
     tragen 80–86 Belegungen, und ein Feld, das fast niemand pflegt, fehlt auf
     einem beliebigen Datensatz.
  2. **Bei 11 der 14 liegen die gespeicherten Werte außerhalb des Vokabulars,
     das dasselbe Feld deklariert** — dieselbe Sterne-Skala einmal als URI
     (`…/vocabs/quality_didactics/4`) und einmal als nackte Ziffer (`"4"`),
     beides nebeneinander im selben Feld; `ccm:oeh_quality_currentness`
     deklariert die Ziffern und ist deshalb als einziges „konform".
     `ccm:oeh_quality_correctness` deklariert das Befund-Vokabular und speichert
     zu 100 % Sternebewertungen. Das ist ein **zweiter, vom Prüfsiegel-Argument
     unabhängiger** Grund gegen das Schreiben — und er trifft zusätzlich das
     Lesen: ein Feld, dessen Inhalt wir nicht beschriften können, reicht `"0"`
     an ein Modell weiter.
  3. **Übrig bleiben drei Felder statt dreier Feldgruppen**, alle vokabular-rein
     und alle nur LESEND: `ccm:conditionsOfAccess` (198 699 Belegungen),
     `ccm:accessibilitySummary` (3 475), `ccm:license_oer` (1 121). `QUALITY_PROPS`
     entfällt, **T4.3 (Schreibfläche) entfällt**. — **Die zweite Hälfte davon ist
     am 2026-08-18 aufgehoben (Nutzerentscheidung):** die 14 Felder sind ZWEI
     Familien, und die Erhebung hat sie als eine behandelt. Die fünf
     BEFUND-Felder (`correctness`, `copyright_law`, `criminal_law`,
     `personal_law`, `protection_of_minors`) deklarieren EIN vollständig
     beschriftetes Vokabular, das Maschine von Mensch unterscheidet
     (`auto_findings` „Auffälligkeiten gefunden (Maschine)" …), und vier der
     fünf werden im Korpus bereits so benutzt (52/97, 54/98, 50/92). Sie sind
     seither schreibbar — Vokabular `qualityFinding` in `vocabs.ts`, Felder in
     `WRITABLE_FIELDS`, Parameter `qualityCorrectness` … an
     `wlo_create_content`/`wlo_update_content`. Zwei Regeln binden das: die
     beiden MENSCH-Werte werden VERWEIGERT (der Wert benennt, wer geprüft hat,
     und ein Modell kann nicht bezeugen, dass eine Person hingesehen hat), und
     die sieben STERNE-Felder bleiben geschlossen (redaktionelles Urteil, und
     der Korpus speichert dort eine Ziffer, wo das Widget eine URI deklariert).
     **Am 2026-08-19 kamen die sieben 0–5-SKALEN dazu** (didactics, language,
     medial, neutralness, transparentness, data_privacy, currentness), lesend
     wie schreibend. Drei Messungen binden das: (a) der Korpus speichert BEIDE
     Formen im selben Feld (`…/quality_didactics/1` neben nacktem `"4"`), und nur
     die URI-Form kommt mit `_DISPLAYNAME` zurück — die Ziffer ist kein kaputter
     Wert, sondern dieselbe Position, weshalb `src/vocabs-quality-scale.ts`
     (ERZEUGT aus dem Metadatensatz, `scripts/generate-quality-scales.mjs`) sie
     beschriftet; (b) geschrieben wird die DEKLARIERTE Form, und die ist je Feld
     verschieden — URI bei sechs Skalen, nackte Ziffer bei `currentness`; (c)
     `login` und `relevancy_for_education` bleiben zu (0–1, echte Ja/Nein-Fragen)
     und `ccm:containsAdvertisement` ebenfalls (0–5 deklariert, aber 69 628 von
     69 688 Werten sind `yes`/`no` — ein Stern dort wäre die dritte Schreibweise).
     Gemessen ist auch, warum das Lesen überhaupt geht: `containsAdvertisement`
     `5` heißt **„✰✰✰✰✰ ohne Werbung"**, eine nackte „5" sagt das Gegenteil.

     **Die Bestätigungsvorschau beschriftet seit dem 2026-08-19 jeden
     Vokabularwert** (`displayValue`, `services/write/change-set.ts`): vorher
     stand dort die rohe URI, und der Bestätigungsschlüssel bindet an genau
     diesen Satz — dieselbe Regel wie `nameOf` bei den Themenseiten. `PREVIEW_VOCAB`
     ist bewusst NICHT `FIELD_VOCAB`: das eine entscheidet, was geschrieben werden
     darf, das andere nur, was ein Satz sagt.

     Der Rest des Absatzes gilt unverändert. `ccm:oeh_quality_login` ist das
     einzige saubere Qualitätsfeld und wird trotzdem nicht gelesen:
     `ccm:conditionsOfAccess` sagt dieselbe Sache dreiwertig statt zweiwertig
     und auf mehr als der doppelten Datenmenge — beide zu lesen hieße, dieselbe
     Tatsache zweimal auszugeben, mit der Möglichkeit zu widersprechen.
  4. **`facetLimit` ist KEINE Bucket-Obergrenze** — der Server liefert bis zu
     **5 × Limit** (`FACET_BUCKET_MAX`, `wlo-search.ts`). An `ccm:taxonid` über
     sechs Punkte exakt bestätigt: 1→5, 2→10, 10→50, 50→250, 80→376 (= alle 376
     Werte, danach Sättigung). Vermutlich ein Shard-Limit, also eine Eigenschaft
     dieses Deployments — auf einer Instanz mit WENIGER Shards ist die Schranke
     zu hoch, um eine echte Kürzung zu fangen. `facetMinCount` ist dagegen
     **erforderlich**: ohne ihn kommen null Buckets, unabhängig vom Limit.
     `FACET_LIMIT` bleibt 20, weil es die nutzersichtbare Facettenausgabe
     bemisst (auf 100 gehoben wüchse die `ccm:taxonid`-Facette von 100 auf 376).
     Wer Buckets SUMMIERT, prüft gegen `FACET_BUCKET_MAX`, nie gegen das Limit.

  **P4 ist gebaut (2026-08-17) — und der Plan hat sich beim Messen halbiert.**
  `includeAccessInfo` an `get_node_details`/`get_nodes_details` liefert die drei
  Felder in beiden Ausgabeformaten; `src/node-access.ts` hält, was sie SIND.
  Drei Regeln binden jede Änderung hier:

  - **Keine Vokabular-Tabelle** — mit **einer** gemessenen Ausnahme, siehe den
    Nachtrag vom 2026-08-18 unten. Das Repository beschriftet vier der fünf Felder
    selbst (`<property>_DISPLAYNAME`, an echten Datensätzen belegt) — dieselbe
    Quelle, die `formatter.ts` für die Vokabularfelder bevorzugt. Das geplante
    `vocabs-quality.ts` ist ersatzlos gestrichen; eine eigene Tabelle wäre eine
    dritte, die mit einer Instanz Schritt halten muss.
  - **Keine Property-Gruppen.** Die Detail-Werkzeuge lesen `-all-`, die Felder
    sind also schon da: `includeAccessInfo` kostet **keinen** zusätzlichen
    Abruf, und `QUALITY_/RIGHTS_/ACCESSIBILITY_PROPS` hätten nichts verengt.
  - **Ablesbar, nicht suchbar.** Alle antworten als ngsearch-Kriterium mit
    **HTTP 400** — 2026-08-18 auch für die zwei neu dazugekommenen bestätigt. Deshalb ließ sich auch nicht messen, ob `ccm:license_oer`
    etwas sagt, das `ccm:commonlicense_key` nicht schon sagt — das Feld ist
    dabei, weil opt-in nichts kostet, und die Unmessbarkeit steht im Code.

  **Eine handgebaute `nodeId:`-Zeile ist ab jetzt ein Testfehler**
  (`tests/shared-rule-discipline.test.ts`). P2 hatte zwei übersehen —
  `get_node_details` und die Fachportal-Liste —, und die erste ist ausgerechnet
  das Werkzeug, dem eine Verknüpfungs-id am ehesten übergeben wird: der Text
  schwieg, während `structuredContent` `originalId` trug. Einzige erlaubte
  Ausnahme ist `tools/skill-registry.ts` — ein Registry-Eintrag stammt aus einem
  `:::`-Block, nicht aus einem Knoten-Abruf, und hat keine `originalId`.

  **Eine Sammlung erkennt man am Aspekt, nicht am Typ (gemessen 2026-11-12,
  `tests/live/node-kinds.test.ts`).** `ccm:map` ist der allgemeine Container:
  der Ablage-Ordner (angelegt als `cm:folder`), `-userhome-`, der
  Seitenkonfigurations-Ordner und eine Variante melden ihn ebenfalls — nur eine
  Sammlung trägt `ccm:collection`. Eine Verknüpfung ist `ccm:io` mit
  `originalId`. Die Regel steht einmal (`src/node-kind.ts`), die
  Kuratier-Werkzeuge gehen über `wrongKind` (`tools/curation-shared.ts`), und
  ein Typ-Literal in einem `curation-*.ts` ist ein Testfehler. Der erste Schnitt
  des Audit-Pakets 2 las den Typ allein: `wlo_delete_collection` hätte einen
  Ordner angenommen, unter einer Vorschau, die verspricht, sein Inhalt bleibe.
  Ein Ordner wird von BEIDEN Lösch-Werkzeugen abgelehnt (`is_a_folder`) — keine
  ihrer Vorschauen beschreibt, was dabei verloren geht. Ein Repository-Platzhalter
  (`-userhome-` …) wird in `registerCurationTool` für jedes id-Argument jedes
  Kuratier-Werkzeugs abgelehnt, nicht je Werkzeug.

  **Die Metadaten-Werkzeuge bleiben für Sammlungen offen (Nutzerentscheidung
  2026-11-13) — und schreiben Titel und Beschreibung dorthin, wo eine Sammlung
  sie hält.** `services/write/collection-fields.ts` (`propertyOn`/`desiredOn`)
  bildet `cclom:title` → `cm:title` und `cclom:general_description` →
  `cm:description` ab, wenn der GESCHRIEBENE Knoten eine Sammlung ist; wer eine
  Schreib-Baseline für Metadaten holt, geht dort durch (Wächter in
  `tests/shared-rule-discipline.test.ts`). Gemessen auf Staging 2026-11-13
  (`tests/live/collection-metadata.test.ts`): `cclom:title` an einer Sammlung
  wird als ZWEITES Feld gespeichert — `collection.title` bleibt, das Zurücklesen
  meldet „gespeichert", und der DTO-`title` des Knotens folgt ab dann dem neuen
  Feld, außer Reichweite jeder späteren Umbenennung. Nur das Einreichen
  (`wlo_submit_content`) lehnt Sammlungen und Ordner ab.

  **Schreiben nimmt einen Vokabularwert nur per Name, Alias oder URI — nie per
  Teilwort (Chatbot-Nachtrag 2026-11-13, Z1).** `vocabularyUris`
  (`services/write/fields.ts`) fragt `resolveVocabMatch` und lehnt `fuzzy` ab:
  die Suche lebt gut mit dem Raten (ein Filter ohne Treffer schadet nicht),
  beim Schreiben wurde aus „Wirtschaft" still Agrarwirtschaft — und Fach, Stufe
  und Zielgruppe ERSETZEN, was der Datensatz trägt. Der geratene Wert geht nicht
  verloren, er führt die Kandidaten an (`error.candidates`), und gewählt wird
  vom Client. `tests/write-vocab-exact.test.ts` hält für JEDEN Eintrag der drei
  Vokabulare fest, dass Name, Alias und URI weiter angenommen werden. Die vier
  Felder nehmen seither auch eine Liste (B1); der Inhaltstyp hat sein eigenes,
  größeres Vokabular (`new_lrt`), das `lookup_wlo_vocabulary("contentType")`
  listet — zwei Namen darin sind mehrdeutig und nur per URI schreibbar.

  **Ersetzen bleibt Standard, Ergänzen ist ein eigener Parameter
  (Nutzerentscheidung 2026-11-13, B1).** `addDiscipline`,
  `addEducationalContext`, `addUserRole` fügen hinzu; die Felder ohne `add`
  ersetzen weiter — additiv als Standard hielte ein falsches Metadatum fest.
  Ein Ergänzen ist eine Eigenschaft der ÄNDERUNG (`FieldChange.mode: 'add'`),
  steht im Fingerabdruck und zeigt in der Vorschau die bisherigen Werte mit
  (`„Physik, Chemie“ + „Mathematik“`), weil die ganze Liste gesendet wird.

  **P1 ist gebaut (2026-08-17), und drei Regeln binden jede Änderung daran.**
  (a) Die Auflösung entscheidet sich am **DTO-Feld `originalId`**
  (`resolveWriteTarget`, `services/write/nodes.ts`), niemals an der Property
  `ccm:original` — die zeigt beim Original auf sich selbst, und eine zweite
  Implementierung ohne Selbstvergleich meldet jeden Datensatz als Verknüpfung auf
  sich. (b) Sie sitzt an den drei Werkzeug-Einstiegen und **nicht** in
  `updateNodeMetadata`: der Bestätigungsschlüssel bindet an die VORSCHAU, also
  muss das Ziel feststehen, bevor geschrieben wird — eine Auflösung im
  Schreibaufruf fände ein zweites Mal statt und könnte vom bestätigten Ziel
  abweichen. Die Umleitung ist deshalb Teil der Änderungsmenge
  (`ChangeSet.redirectedFrom`), steht als erste Zeile der Vorschau und ist im
  Fingerabdruck. (c) `verifyWrite` nimmt **nur** den ChangeSet und liest
  `cs.nodeId`; der frühere `nodeId`-Parameter war die Stelle, an der still gegen
  den genannten statt den geschriebenen Knoten geprüft würde. Zwei Wächter in
  `tests/shared-rule-discipline.test.ts` halten (a) und die Regel „ein
  Kuratier-Werkzeug übergibt `updateNodeMetadata` ausschließlich `cs.nodeId`".
  Nicht einbezogen, weil über andere Endpunkte und dort ungemessen:
  `wlo_rename_collection` (Collections-REST) und `wlo_submit_content` (Workflow).

  **(d) kam aus dem Review derselben Sitzung und ist die vierte Regel: mit dem
  Ziel muss der VERGLEICHSSTAND mitkommen.** Die Werkzeuge rufen deshalb
  `readWriteBaseline`, nicht `resolveWriteTarget` — Letzteres liefert ein Ziel
  ohne Baseline, und die einzige in Reichweite ist dann die des angefragten
  Knotens. Solange eine Verknüpfung erbt, sind beide Stände gleich und der Fehler
  ist unsichtbar; sie laufen genau dann auseinander, wenn die Verknüpfung schon
  einmal direkt beschrieben wurde (F2 — der Zustand, den ältere Fassungen dieser
  Werkzeuge erzeugt haben). Dann kostet ein Diff gegen die Verknüpfung dreifach:
  ein Feld gilt als unverändert, weil die VERKNÜPFUNG den Wunschwert schon zeigt
  (das Original bekommt ihn nie, gemeldet wird Erfolg — bei
  `wlo_decide_suggestion` samt `ACCEPTED` über einen Datensatz, der den Wert nie
  erhalten hat); die Vorschau zeigt den Wert der Verknüpfung als „vorher"; und
  `cclom:general_keyword` merged in die Liste der VERKNÜPFUNG und schreibt sie
  ÜBER die des Originals, was dessen Schlagworte verliert. Ein nicht lesbares
  Original **verweigert**, statt auf die Verknüpfung zurückzufallen. Der
  Zusatzabruf fällt nur bei Umleitung an. Dritter Wächter in
  `tests/shared-rule-discipline.test.ts`.

  Aus demselben Review, weil es zeigt, wie lange so etwas grün bleiben kann: der
  Test, der die Umleitung prüfte, gab dem Original im Fixture **genau den Titel,
  den der Aufruf setzt**. Damit war der Vorgang unter der korrigierten Regel ein
  No-op — die alten Zusicherungen gingen nur durch, weil gegen die Verknüpfung
  verglichen wurde. Ein Fixture kann die Prämisse des Fehlers enthalten.

  **Das Zeitbudget hängt an `ccm:wwwurl`, nicht am Anlegen (2026-08-17).**
  `WWWURL_WRITE_TIMEOUT_MS = 60_000` über `writeTimeoutMs(properties)` in
  `services/write/nodes.ts`, angewandt an BEIDEN Schreibstellen — Anlegen und
  Metadaten-PUT. Denn die Arbeit wandert mit der Eigenschaft: gleiche Adresse,
  gleicher Lauf, anlegen MIT URL 8,8 s gegen anlegen ohne URL 0,5 s + URL
  nachsetzen 7,8 s. Sie entsteht, weil das Repository die Seite RENDERT — der
  Datensatz trägt danach ein echtes JPEG (~50 kB, `preview.isIcon=false`) statt
  des SVG-Platzhalters; das Ergebnis ist je Adresse zwischengespeichert, was die
  enorme Streuung erklärt (`planet-schule.de` kalt **46,5 s**, warm 8,8 s).
  Deshalb 60 s. Schneller geht es nur im Repository, wo der Platzhalter für
  genau diesen Fall schon existiert. Betroffen ist auch `wlo_update_content`,
  wenn jemand die Quell-URL ändert — der Metadaten-Pfad hatte kein Budget. Gemessen je Anfrage: Dublettenprüfung
  1,2 s · **Anlegen 18,6 s** · Metadaten 0,5 s, über vier Läufe 12,2–18,6 s — das
  Repository lädt dabei NICHT die Adresse (widerlegt, siehe unten). Gegen das 20-s-Budget für
  gewöhnliche Aufrufe (Suche, Knotenlesen: unter einer Sekunde) waren das 93 %,
  und ein Abbruch meldet **Fehlschlag für Arbeit, die das Repository zu Ende
  bringt** — ein Wiederholungsversuch legt dann einen zweiten Datensatz an. Nach
  unten hält `Math.max` die Einstellung des Betreibers. Ein Wächter liest die
  QUELLE, weil `wloFetch` selbst ein Signal anhängt, wenn keins mitkommt — im
  Mock sehen beide Pfade gleich aus.

  **`httpServer.requestTimeout` ist KEINE Obergrenze für die Arbeit an einer
  Anfrage — gemessen 2026-08-17, und der Irrtum saß schon länger im Code.** Ein
  node:http-Server mit `requestTimeout = 30_000` und einem Handler, der nach
  **35 s** antwortet, liefert die Antwort aus (HTTP 200). Die Einstellung
  begrenzt das EMPFANGEN der Anfrage (Slow-Body/Slow-Header), wie der Kommentar
  an ihr auch sagt und wie die langlebigen SSE-Antworten dieses Servers belegen.
  Drei Kommentare hatten daraus eine Antwort-Frist gemacht und damit Entwürfe
  begründet (`tools/node-details.ts`, `services/collection-traversal.ts`,
  `tests/collections-recursive.test.ts`) — der vierte war das 25-s-Budget oben,
  das dieser erfundenen Decke wegen zu niedrig gewählt war. Die Deckel selbst
  (`TEXT_ENRICH_MAX`, `RECURSIVE_VISIT_MAX`) bleiben richtig, aber aus dem
  messbaren Grund: was sie kosten, nicht eine Frist, die es nicht gibt. **Was das
  Warten wirklich begrenzt, sitzt beim Client und ist von hier aus unsichtbar.**

  **P2 macht die Unterscheidung sichtbar (2026-08-17).** `FormattedNode.originalId`
  steht **genau dann**, wenn der Knoten eine Verknüpfung ist — abwesend am
  Original, wie im Repository-DTO, damit jede bestehende Antwort unverändert
  bleibt. Zwei Regeln: das Feld MUSS in `formattedNodeSchema` deklariert sein
  (zod verwirft Unbekanntes, sonst erreicht es den Text und verschwindet aus
  `structuredContent`, ohne dass etwas fehlschlägt — deshalb sind Text- und
  JSON-Zusicherung getrennte Aufgaben), und die Zeile entsteht in **`nodeIdLine`**
  (`text-line.ts`, über `formatter.ts` re-exportiert), geteilt mit den Skill-Werkzeugen: eine Formulierung für eine
  Tatsache. Ebenfalls hier: `wlo_delete_content` versprach „zerstört das Material
  für alle Sammlungen" — über eine Verknüpfungs-id falsch; Beschreibung
  korrigiert, und die VORSCHAU sagt jetzt, welcher der beiden Fälle vorliegt
  (`whatItMeansForReference`, gespeist aus `resolveWriteTarget` — dieselbe
  Funktion wie im Schreibpfad, hier nur zum Beschreiben).

  **P0 ist erledigt und hat die Sperre aufgehoben (F10, 2026-08-17):** ein
  Löschvorgang auf eine Sammlungs-Verknüpfung trifft **nur die Verknüpfung** —
  sie antwortet danach 404, das Original 200 (`tests/live/reference-delete.test.ts`).
  Kein Datenverlust. Zwei Regeln folgen daraus und binden jede Änderung hier.
  **Die Auflösung aufs Original gehört ausschließlich in den Metadatenpfad**: ein
  umgeleitetes `wlo_delete_content` würde aus dem heute harmlosen Verhalten genau
  den Datenverlust machen, nach dem die Messung gesucht hat. Und die Meldung des
  Werkzeugs ist wahr über den Knoten und falsch über das Material — es meldet
  Erfolg, während der Datensatz unter eigener id und in jeder anderen Sammlung
  weiterlebt; faktisch ein `remove_from_collection` mit dem Wort „gelöscht".

- **Volltext & Sammelmetadaten für hochgeladene Inhalte (W1–W4) — CODE COMPLETE
  (2026-11-08); staging accepts content writes again since 2026-11-13: W1 on a
  record WITHOUT a file runs live, a record WITH a file is refused by rule:**
  `docs/plans/2026-11-08-volltext-und-sammelmetadaten.md` (Messungen, Entscheidungen
  F1–F6, Aufgaben). Rules that bind any change. (1) **The full text goes into the
  record's OWN `textContent`** (user decision F1), sent as the RAW text under
  `Content-Type: application/json` with `mimetype=text/plain` — a JSON string body
  is stored with its quotes (2026-07-31), text/plain|markdown bodies get 415, and
  `GET textContent` extracts nothing from `text/markdown`. `POST textContent`
  writes the record's CONTENT, and a record WITH a file LOSES it — measured
  2026-11-13, the first day staging accepted content writes again
  (text/x-web-markdown 47 bytes → text/plain 29 bytes, another hash; the file
  survives only in the version list). There is ONE content slot. So the
  safeguard `keepsBinary()` stays false as a rule, not a placeholder, and such a
  record is refused BEFORE any key (`would_replace_file`) — content includes a
  text written here before. `tests/live/fulltext.test.ts` pins the answer and
  turns red if a repository ever keeps the file. A LINKED record is refused (`link_record`): the repository reads a link's
  text from the page. (2) **The server decides per field** in `wlo_update_contents`
  (F5, `field-routing.ts`): title, description, keywords, subject, educational
  level, content type are written; everything editorial becomes a suggestion; the
  preview shows before → after, and the old value is part of the approval.
  (3) **Plans run in waves of at most `PLAN_POOL`** — the budget is checked between
  waves, and an unbounded wave of 200 independent items had no time limit at all;
  a call that read first gets only the rest of its budget, and a wave that would,
  judged by the last one, end past it waits for the next call. A confirmation
  looks for a plan its own key already started BEFORE it redeems the key — two
  confirmations at once otherwise answer `confirm_unknown`, and the new preview
  that invites writes every record twice. (6) **A plan re-checks right before
  each write**: it writes up to 30 minutes after its approval, so W2 refuses a
  record that gained content meanwhile (`would_replace_file`) and W3 a field that
  no longer holds the approved "before" (`changed_since_preview`) — nothing is
  sent, `outcomeOpen: false`. (4) After a key, a 4xx
  is a refusal (`outcomeOpen: false`), a 5xx or an unreadable 200 is open — the
  one exception is the repository's OWN 500 on a full-text write, where a
  read-back that answers an EMPTY text proves nothing landed; a 502/503/504 may
  be a proxy while the work continues, and a body naming no text is no answer. (5) The
  batch role (W4, `wlo.ablage-vorgang@2`) lives in the manifest only, never as a
  record property (F4).

- **Batch submission and tree metadata (S4/S3, 2026-11-14).**
  `wlo_submit_contents` (`services/write/submit-plan.ts`) is a plan like the
  other batch tools. Its step reads the record RIGHT BEFORE the write: the
  confirming call reads again anyway (a change before it changes the preview,
  and the key no longer fits), so the look in the step is for the plan's later
  calls. A status found there after OUR request left (`item.sent`) is our
  submission (`submitted`), otherwise `already` — a second submission would
  leave a receipt that is not its own. A record that cannot be read right then
  is not submitted blind (`pending`/`not_checked`). `wlo_create_collection_tree`
  carries `discipline` / `educationalContext` / `keywords` per node and
  `shared` for the tree (`flattenTree`); a node's own value REPLACES the shared
  one. They travel as `CollectionFields.extra` beside the description — one
  metadata write, one read-back — and a collection taken over by `merge` gets
  none of it, which the preview line says.
- **Moving a collection, and proposals (S5 / S8 / S9, 2026-11-14).** Measured
  with TWO accounts (`npm run measure:moves` and the plan's third table —
  re-measure before contradicting). `_move` keeps id, sub-tree and locally set
  permissions, and the repository does NOT refuse a namesake at the target, so
  `planMove` (`services/write/collection-move.ts`) refuses it, a target inside
  the moved sub-tree (the repository answers 500) and "already there" before
  any key. Whether the CALLER may write a collection is on its DTO
  (`access` holds `Write`); who may read and not write may PROPOSE
  (`?asProposal=true` → 200 where a filing → 403). So the two filing tools
  propose there (`FilingTarget.readOnly`, decided in `readFilingTarget` /
  `mayWrite`), and the PREVIEW says which of the two the key authorises — a
  proposal is not a filing, and a move into such a target is refused. A
  proposer cannot read a proposal back (listing 403, usage empty); the
  read-back is the same PUT answering 409 (`proposeForCollection`) — do not
  "simplify" that second request away. Accepting is two writes in ONE order:
  file and read back, THEN mark (`decideProposal`), the rule the metadata
  suggestions follow. `isPublic: false` means "only its owner"; `true` promises
  nothing (a collection shared with one account reports `true` to it), so the
  filing previews say the NEGATIVE only (`tools/curation-public.ts`).
- **Maintaining a tree (S1 set / S6 / S7, 2026-11-14).** Four measurements
  bind it (`npm run measure:moves`, re-measure before contradicting): `POST
  …/order` positions ONLY the ids it is given (an incomplete list leaves two
  children on one position) and takes a content's REFERENCE id — the
  original's answers 400; `DELETE …/references/{originalId}` answers 200 and
  removes nothing (again); sub-collections and contents share one position
  space but are listed apart; and after a reference is removed the usage
  lookup for that material answers 500 for 2–5 s, then recovers. So
  `planOrder` (`services/write/collection-order.ts`) refuses a list that does
  not name every child of ONE kind, and resolves originals to references;
  `removalOf` (`remove-plan.ts`) is the one place a plan turns "this material,
  this collection" into the reference's DELETE and into a state; a MOVE
  (`removeFrom`, `filing-plan.ts`) files and reads back FIRST and removes
  THEN — a failed removal is `not_removed` (in both), never a lost material;
  `wlo_delete_collections` reads "empty" from the two listings (never the
  counters), in the preview AND right before each delete, children first and
  one at a time. The tree tool sets the order it creates, from the LAST step
  of a parent's children; a failure there is `order_not_set` on a step that
  keeps its status. **A record can lie in a collection DIRECTLY, as the
  original (no reference), and `DELETE …/references/{its id}` deletes the
  MATERIAL (measured 2026-11-14).** `findReference` says `direct` for it, and
  every removal refuses (`IS_ORIGINAL` / `is_original`) — the single tool, the
  batch, the removal half of a move. The single tool had promised "the
  material stays" over that DELETE since it was written; no test could see it,
  because every fixture filed references. A filed move never ends as `failed`:
  `item.filed` is remembered (a second PUT answers 409, and right after a
  removal "is it there?" is unknown), and a removal that stays open is ended by
  the step itself as `not_removed`. Every one of these steps follows one reading of a failed
  write: a 4xx wrote nothing (`outcomeOpen: false`), anything else stays
  `pending` and is LOOKED AT again by the next call before it sends again.

- **What the audit of 2026-11-14 and its two review rounds added — each binds.**
  (1) **One reading of a failed write: `wroteNothing(status)`** (`src/upstream-error.ts`) — a 4xx other than 429.
  Everything else is open or stays `pending`. It was written out in nine places, and five took a 429 for "nothing
  written". A new status comparison in the write side is a second copy. Single tools answer through
  `failedWriteReply` / `reportMutation`: 401/403 `forbidden`, 404 `not_found`, another 4xx `refused`
  (`outcomeOpen: false`); 429/503 `upstream_busy`; the status travels as `httpStatus` on the outcome, never parsed
  out of a detail text.
  (2) **A file replacement is read back against what was SENT**: the byte size, and a changed `content.hash` where
  both sides have one. Equal size without that proof is `unverified`. The upload's outcome is part of the coded
  result (`reportWithUpload`), not a line above a success.
  (3) **Sub-collections are matched by the COLLECTION title** (`services/write/collection-children.ts`, one lister
  for tree, move and order). The tree compared the record title chain and missed collections titled by `cm:title`.
  (4) **Every plan step keeps a non-4xx `pending` and LOOKS before it sends again** — the tree's create step
  included (a create that answered 500 may have created; it is looked up by title under the parent first). Whether
  OUR request left is remembered (`item.sent`, `item.filingSent`): found afterwards it is `added` / `submitted`,
  not `already`. One label function (`planItemLabel`) words every closed status that carries `outcomeOpen: true`
  as open.
  (5) **Budgets and trust.** Per-identity caps go by `accountBudget()`: a confirmed account keys as `acct:…`, a
  namespace an unproven `Basic` credential cannot produce — with `user:<name>` for both, typing someone's account
  name evicted that person's pending keys (found by the second review, with a test). The BINDING of a key or a plan
  (who may redeem or continue it) is a different thing and did not change.
  (6) A removal the preview can already see is refused THERE (`not_in_collection`, `is_original`, `not_checked`),
  and `wlo_create_collection` refuses a parent the caller may not write before any key.
  (7) `TypeError: terminated` (the connection broke while the body was read) is an open outcome
  (`isConnectionLost`), and no accident (`src/accident.ts`).

- **`idempotentHint` is a statement about the second run (2026-11-15).** It is `true` only when the same operation
  run again — a fresh preview and a fresh confirmation with the same arguments, not the spent key — leaves the
  repository as it is in EVERY mode of the tool; one mode that writes again (a file upload in `wlo_update_content`, the
  proposal route in `wlo_update_contents`) makes the tool `false`. It was set by copy before, so siblings disagreed.
  The list of tools that stay `false` is pinned in `tests/server.test.ts`; a new write tool is decided there on
  purpose. Not measured, read from code: whether the repository stores a new version for a byte-identical upload, and
  whether a stored value that differs from the sent one (normalised text) makes a change set that never empties.
  Three places where `true` rests on more than our own check: a PROPOSAL for a collection the login cannot write
  is sent again on every run and changes nothing only because the repository answers 409 (measured 2026-11-14); a
  material that lies TWICE in one collection (an older state — a second filing answers 409 today) loses one
  reference per removal by its original id; `wlo_order_collection` answers `no_change` only when the listing
  returns a position for every child, otherwise it sends the same order again. The batch store tools stay `false`:
  they answer `already` for the spent approval only, and a fresh one files again.
  Read-only tools carry no `idempotentHint`.

- **b-api flows through the repository's proxy (2026-11-17/18; plan `2026-11-17-kestra-flows-ueber-repository-proxy.md`).**
  On where the repository serves the b-api proxy (`services/bapi/proxy-switch.ts`, 2026-11-18: unless the operator
  sets `WLO_BAPI_VIA_REPOSITORY` to `1`/`0`, an ANONYMOUS probe of the flow list at start, repeated until a
  verdict — `200` with a list is the proxy, `404` with a JSON object (`{error, message}`) none, both measured; any other answer decides nothing (a 404 page, 3xx, 401/403
  are no proof of absence), keeps the tools off and asks again; an unknown value is off; started only from
  `http.ts`, guarded — stdio has no personal login and never asks). Startable flows are `WLO_BAPI_FLOWS`, unset =
  `node-metadata-write`, `none` = none. Rules. (1) `{repository}/rest/bapi` is
  called in ONE module (`services/bapi/jobs.ts`, guarded), with a login only on the four paths of the job surface (`isJobPath`;
  no part of dots, no `..` — such a part leaves the surface once the URL is normalised), and only with a PERSONAL
  login: never the service account, never nobody — without a person the flow list answers 200 and EMPTY (measured),
  which would read as "nothing released". Every call carries `DisableGuest: true`. The ONE exception is the
  start-up probe (`probeBapiProxy`, `jobs.ts`): `GET …/jobs/flows` only, anonymous and WITHOUT `DisableGuest` on
  purpose — with it the anonymous call is refused 401 and every repository would read as "no proxy". It never
  carries a login and is called only by `proxy-switch.ts` (guarded). It rests on the proxy answering the GUEST on
  the flow list (`200 []`); if the proxy stops doing that (401/403), no verdict comes and the operator sets `1`.
  Every b-api answer, the probe's included, is read up to `MAX_ANSWER_BYTES` (8 MB) and cut there: a status
  `200` past it is a failed query (`status: failed`, `isError`, as every failed query — contract of 2026-11-18)
  with `reason: upstream_error`, `code: answer_too_large` (a list too; a start accepted that far is
  open), never a guess from a cut body; any other status keeps its meaning. (2) Starting is a write: preview, then a key
  bound to the flow and its exact inputs (for `node-metadata-write` the checked ids and the language; for another
  flow the inputs' hash). Whether a refusal started nothing is `wroteNothing` (`upstream-error.ts`), the one
  reading for every write: a 4xx but 429 did; a 429, a 5xx, an accepted answer without a `jobId` or no answer at
  all is OPEN — a job may run. (3) `node-metadata-write` REPLACES eight fields of every node it is given (measured
  2026-11-18), so the ids are checked as the person first: 1–50, records (`ccm:io`), not a collection, not a reference
  in a collection (the flow would write onto the copy), `access` names `Write`. A read that did not answer is
  "unchecked", not "no". (4) Through the proxy every person carries the repository's ONE b-api key, and the b-api
  keeps jobs per key: another person read a job, report included, by its id (measured 2026-11-18). So this server
  keeps who started which job (`services/bapi/job-owners.ts`, in memory, per account, 30 days, bounded) and asks the
  b-api about the caller's own jobs only — every other is `unknown_job`; a restart forgets, and the tools say so.
  (5) Status passes `progress` as given and `iterations` as counts per state only — no values, no codes; a sampled list
  says `iterationsSampled`. Outputs only on success, at most 1 MB; files never with their download link.
