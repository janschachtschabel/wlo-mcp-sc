# Metadatenfelder: Erhebung (Qualität, Recht, Zugänglichkeit)

**Gemessen am 2026-08-17 gegen Staging** (`repository.staging.openeduhub.net`),
Korpus **590 186** Datensätze (`contentType=FILES`).
Erzeugt von `npm run survey:metadata` (`scripts/survey-metadata.mjs`) — das Skript
meldet und schreibt nie.

Dies ist **T3.2** aus `2026-08-17-original-id-und-metadatenflaeche.md` und die
Sperre vor Phase 4: T4.1 und T4.3 nehmen ihre Feldlisten aus diesem Dokument,
nicht aus Vermutung.

> **Teilweise überholt am 2026-08-18** — `2026-08-18-vokabular-abgleich.md`.
> Zwei Dinge stimmen hier nicht mehr. (1) Die drei Muster unten verfehlen
> `ccm:price` (339 687 Belegungen) und `ccm:containsAdvertisement` (69 688); die
> Feldfläche ist fünf Felder groß, nicht drei. Beide standen in der Liste der
> übrigen Felder in Abschnitt 8 — genau dafür gibt es sie. (2) Die Begründung in
> Abschnitt 5 („Lesen ist bei diesen Feldern wertlos") ist im Ergebnis richtig und
> in der Ursache ungenau: es liegt nicht an der Schreibweise, sondern daran, dass
> `_DISPLAYNAME` nur auflöst, was das Widget DEKLARIERT. Gemessen an einem
> Datensatz mit sieben dieser Felder.

---

## 1. Die Frage, die Phase 4 blockiert hat

> **F9, ANGENOMMEN:** dass es `ccm:oeh_quality_*`-Felder in `mds_oeh` überhaupt gibt.

**Es gibt sie: 14 Stück.** F9 war nicht falsch, sondern eine andere Aussage — auf
*einem* Datensatz nicht gefunden zu werden ist mit „existiert" vereinbar, wenn
kaum jemand das Feld pflegt. Genau das ist der Fall: die vier
Rechtsprüfungs-Felder tragen 80 bis 86 Belegungen bei 590 186 Datensätzen.

Der Metadatensatz „Wir Lernen Online" führt **234 Widgets, 208 verschiedene
Felder**. Er ist 17,3 MB groß und in **1,0 s** geladen — das im Skill notierte
„nichts für den Anfrage-Pfad" betrifft die Größe, nicht die Latenz.

---

## 2. Qualität — 14 Felder, `/^ccm:oeh_quality_/`

| Feld | Vokabular | Belegungen | davon außerhalb des Vokabulars | Empfehlung |
|---|---|---|---|---|
| `ccm:oeh_quality_login` | 2 | 72 787 | 0 | **lesen** |
| `ccm:oeh_quality_protection_of_minors` | 5 | 3 432 | **3 392** (98,8 %) | nichts |
| `ccm:oeh_quality_relevancy_for_education` | 2 | 105 | 2 | nichts |
| `ccm:oeh_quality_criminal_law` | 5 | 86 | 44 | nichts |
| `ccm:oeh_quality_copyright_law` | 5 | 85 | 45 | nichts |
| `ccm:oeh_quality_personal_law` | 5 | 80 | 42 | nichts |
| `ccm:oeh_quality_neutralness` | 6 | 67 | 30 | nichts |
| `ccm:oeh_quality_correctness` | 5 | 41 | **41** (100 %) | nichts |
| `ccm:oeh_quality_currentness` | 6 | 41 | 0 | nichts |
| `ccm:oeh_quality_medial` | 6 | 39 | 26 | nichts |
| `ccm:oeh_quality_data_privacy` | 6 | 39 | 6 | nichts |
| `ccm:oeh_quality_transparentness` | 6 | 35 | 26 | nichts |
| `ccm:oeh_quality_didactics` | 6 | 34 | 20 | nichts |
| `ccm:oeh_quality_language` | 6 | 30 | **30** (100 %) | nichts |

**Schreiben: keines.** Der Entwurf hatte das mit „ein Qualitätsfeld ist ein
redaktionelles Prüfsiegel" begründet, und das bleibt der erste Grund. Die Messung
liefert einen zweiten, der unabhängig davon trägt — siehe Abschnitt 5.

**Lesen: nur `ccm:oeh_quality_login`**, und das ist kein Qualitätsurteil,
sondern eine Tatsache über den Zugang (`0` = nur mit Login, `1` = ohne). Es ist
das einzige Feld der Gruppe mit nennenswerter Abdeckung und ohne Fremdwerte.

> **Aber:** `ccm:conditionsOfAccess` (Abschnitt 3) sagt dasselbe, dreiwertig
> statt zweiwertig, und ist auf **198 699** Datensätzen gesetzt statt auf 72 787.
> Beide zu lesen hieße, dieselbe Tatsache zweimal auszugeben — mit der
> Möglichkeit, dass sie sich widersprechen. **T4.2 nimmt `ccm:conditionsOfAccess`
> und lässt `ccm:oeh_quality_login` weg.**

---

## 3. Zugänglichkeit — 7 Felder, `/accessib|conditionsOfAccess|restricted_access/i`

| Feld | Vokabular | Belegungen | außerhalb | Empfehlung |
|---|---|---|---|---|
| `ccm:conditionsOfAccess` | 3 | 198 699 | 0 | **lesen** |
| `ccm:accessibilitySummary` | 6 | 3 475 | 0 | **lesen** |
| `ccm:oeh_accessibility_open` | 6 | 57 | 28 | nichts |
| `ccm:restricted_access` | — | 9 | — | nichts |
| `ccm:oeh_accessibility_security` | 1 (`TODO`) | 5 | 0 | nichts |
| `ccm:oeh_accessibility_find` | 1 (`TODO`) | 5 | 0 | nichts |
| `virtual:amb_conditionsOfAccess` | 2 | 0 | — | nichts |

Zwei Felder taugen, und beide sind vokabular-rein:

- **`ccm:conditionsOfAccess`** — `no_login` (192 022) · `login` (4 366) ·
  `login_for_additional_features` (2 311). Für eine Suche nach frei zugänglichem
  Material ist das die aussagekräftigste Eigenschaft, die wir heute nicht lesen.
- **`ccm:accessibilitySummary`** — `none` · `a` · `aa` · `aaa` · `bitv` · `wcag`.
  Barrierefreiheits-Konformität, 3 475 Belegungen.

`ccm:oeh_accessibility_security` und `_find` führen als einzigen Vokabularwert
die Zeichenkette **`TODO`** mit der Beschriftung `TODO` — im Metadatensatz selbst
unfertig. Fünf Belegungen. Nicht anfassen.

---

## 4. Recht — 9 Felder, `/licen[sc]|copyright|urheb/i`

| Feld | Vokabular | Belegungen | außerhalb | Empfehlung |
|---|---|---|---|---|
| `ccm:commonlicense_key` | — | 418 115 | — | lesen+schreiben **wie bisher** |
| `ccm:license_oer` | 3 | 1 121 | 0 | **lesen** |
| `ccm:oeh_quality_copyright_law` | 5 | 85 | 45 | nichts (s. Abschnitt 2) |
| `ccm:license_to` | — (Datum) | 56 | — | nichts |
| `ccm:custom_license` | 8 | 0 | — | nichts |
| `virtual:editorial_license` | 5 | 0 | — | nichts |
| `ccm:tool_instance_license` | — | 0 | — | nichts |
| `license` | 4 | 0 | — | nichts |
| `ccm:commonlicense_ai_tool` | 2 | 0 | — | nichts |

**`ccm:license_oer`** — dreiwertig: `oer/0` alles OER, `oer/1` teils OER, `oer/2`
kein OER. Vokabular-rein, 1 121 Belegungen. Lesen ja;
**schreiben nein**, weil der Wert aus der Lizenz folgt und ein selbst gesetzter
`license_oer` dem `commonlicense_key` widersprechen kann, ohne dass irgendetwas
den Widerspruch bemerkt.

Fünf der neun Felder sind **im gesamten Korpus unbenutzt**. Die Rechtsfläche ist
faktisch `ccm:commonlicense_key` — das wir bereits lesen und schreiben — plus
`ccm:license_oer`.

---

## 5. Der Befund, der T4.3 entscheidet

**Bei 11 der 14 Qualitätsfelder liegen die gespeicherten Werte teilweise oder
vollständig außerhalb des Vokabulars, das dasselbe Feld deklariert.** Es sind
keine Müllwerte, sondern **dieselbe Skala in einer zweiten Schreibweise**:

```
ccm:oeh_quality_didactics
  deklariert: …/vocabs/quality_didactics/0 … /5     (URIs)
  gespeichert: 14 × URI-Form  +  20 × "4" "3" "5"    (nackte Ziffern)

ccm:oeh_quality_currentness
  deklariert: 0 … 5                                 (nackte Ziffern!)
  gespeichert: nur Ziffern → „konform"
```

Dieselbe Sterne-Skala ist einmal als URI und einmal als Ziffer modelliert, je
nach Feld — und der Korpus trägt beide Formen **nebeneinander im selben Feld**.

Zwei Felder sind schlimmer als uneinheitlich:

- **`ccm:oeh_quality_correctness`** deklariert das *Befund*-Vokabular
  (`human_findings`, `no_human_findings`, …), gespeichert sind aber zu **100 %**
  Sternebewertungen (`"4"`×23, `"5"`×14, `"0"`×3, `"3"`×1). Das Feld hat seine
  Bedeutung gewechselt und die Altdaten sind nie migriert worden.
- **`ccm:oeh_quality_protection_of_minors`**: 3 389 der 3 432 Belegungen sind die
  nackte `"0"` — in einem Befund-Vokabular ohne numerische Mitglieder ein Wert
  **ohne jede Bedeutung**. Das ist zugleich das am besten gefüllte Prüffeld.

Daraus folgen zwei Regeln für Phase 4:

1. **Schreiben ist bei diesen Feldern nicht definiert.** Wer schreibt, muss eine
   Schreibweise wählen und ist damit zur Hälfte des Bestands inkonsistent. Das
   ist ein zweiter, vom Prüfsiegel-Argument unabhängiger Grund — er gilt auch
   dann noch, wenn jemand das erste Argument nicht teilt.
2. **Lesen ist bei diesen Feldern wertlos.** Ein Feld, dessen Inhalt wir nicht
   beschriften können, gibt `"0"` oder `"4"` an ein Modell weiter. Deshalb steht
   in Abschnitt 2 dreizehnmal „nichts" und nicht „nur lesen".

---

## 6. Was Phase 4 daraus bekommt

Die erweiterte Metadatenfläche ist **erheblich kleiner als der Entwurf annahm** —
drei Felder statt dreier Feldgruppen:

| | Feld | Belegungen |
|---|---|---|
| Zugänglichkeit | `ccm:conditionsOfAccess` | 198 699 |
| Zugänglichkeit | `ccm:accessibilitySummary` | 3 475 |
| Recht | `ccm:license_oer` | 1 121 |

Alle drei sind vokabular-rein, alle drei werden **nur gelesen**.

**Folgen für die Aufgaben:**

- **T4.1** — `QUALITY_PROPS` entfällt: es gibt kein Qualitätsfeld, das die
  Messung trägt. `RIGHTS_PROPS` = `['ccm:license_oer']`, `ACCESSIBILITY_PROPS` =
  `['ccm:conditionsOfAccess', 'ccm:accessibilitySummary']`. Ob drei Felder in
  zwei Gruppen mit zwei Parametern noch die richtige Form sind, entscheidet T4.2
  — eine Gruppe mit einem Feld ist ein Parameter, den niemand braucht.
  Das Label↔URI-Material für `src/vocabs-quality.ts` (dann besser anders benannt)
  steht vollständig in der Ausgabe des Erhebungsskripts.
- **T4.2** — bleibt wie geplant, inklusive der Zusicherung, dass die Ausgabe ohne
  Parameter byte-gleich bleibt.
- **T4.3** — **entfällt.** Kein neues Feld ist zum Schreiben empfohlen. Die
  Begründung gehört als Kommentar an die Property-Gruppen, nicht nur hierher.

---

## 7. Nebenbefunde (außerhalb dieses Plans, nicht behoben)

Beim Messen mit Facetten aufgefallen. Beides betrifft `services/license-search.ts`
und gehört **nicht** in diesen Plan — hier festgehalten, damit es nicht verloren
geht.

### 7a. `facetLimit` ist keine Obergrenze für Buckets

`wlo-search.ts` dokumentiert `FACET_LIMIT = 20` als „How many buckets a facet
aggregation may return". Gemessen 2026-08-17:

| `facetLimit` | `ccm:license_to` | `ccm:commonlicense_key` |
|---|---|---|
| 5 | 25 Buckets | 23 |
| 20 | **47** | 23 |
| 100 / 1 000 / 10 000 | 47 | 23 |

Der Server liefert also **mehr** Buckets als das gesetzte Limit, und ab 20 ändert
sich nichts mehr. Damit ist `license-search.ts:106`
(`if (buckets.length >= FACET_LIMIT) return null`) kein Abschneide-Test: er
schlägt bei einer *vollständigen* Liste von 23 an und würde bei einer echt
abgeschnittenen Liste von 18 schweigen. Der Test, der funktioniert, ist zweimal
fragen und auf Sättigung prüfen.

Zusatz: `facetMinCount` ist **erforderlich** — ohne ihn antwortet der Endpunkt
mit null Buckets, unabhängig vom Limit. `ngsearch` setzt ihn bereits.

### 7b. Staging hält 23 Lizenzschlüssel, nicht 16

`tests/vocabs.test.ts` pinnt 16 (gemessen 2026-08-12); korpusweit sind es heute
**23**. Der Test bleibt grün — er prüft Auflösung, nicht Anzahl —, aber sein
Kommentar „Staging holds 16, so this does not fire there" in `license-search.ts`
stimmt nicht mehr, und die gepinnten Datensatzzahlen beschreiben den 12. August
(`COPYRIGHT_FREE` 12 445 → **39 071**).

Die sieben neuen Schlüssel sind zu großen Teilen **Freitext im Lizenzfeld**:

| Schlüssel | Datensätze | löst auf zu |
|---|---|---|
| `weimar GmbH Gesellschaft für Wirtschaftsförderung, …` | 11 | — |
| `CC BY-ND` | 2 | `CC_BY_ND` |
| `© 2006-2026 Weimar, Kulturstadt Europas` | 2 | — |
| `CC BY 2024 - 2025 FOERBICO - soweit nicht anders angegeben` | 1 | `CC_BY` |
| `CC By 4.0` | 1 | `CC_BY` |
| `Keine oder unbekannte Lizenz. Nutzung und Quellenangabe …` | 1 | — |
| `OTHER` | 1 | — |

15 Datensätze mit einem nicht auflösbaren Schlüssel — praktisch bedeutungslos für
die Filterung, aber die Ursache dafür, dass die Bucket-Zahl über 20 gestiegen ist
und 7a jetzt praktisch greift.

---

## 8. Wiederholen

```bash
npm run survey:metadata
```

Braucht `.env` (die Erhebung liest mit dem Dienstkonto; anonym ungeprüft). Läuft
**7–8 s** (drei Läufe: 8 · 8 · 7): ein Abruf des Metadatensatzes plus eine
Facettenabfrage je Feld jeder Gruppe, mit vier gleichzeitigen Anfragen.

Die Ausgabe endet mit der Liste **aller** übrigen Felder des Metadatensatzes
(179 bei diesem Lauf; seit der vierten Gruppe vom 2026-08-18 sind es 177).
Sie kostet keine Anfrage und ist der einzige Weg zu sehen, ob ein Muster etwas
übersehen hat — ohne sie sind die Gruppen eine Behauptung über den
Metadatensatz, die niemand prüfen kann. Genau daran hat es sich entschieden:
`ccm:price` und `ccm:containsAdvertisement` standen hier, und niemand hat
hingesehen.
