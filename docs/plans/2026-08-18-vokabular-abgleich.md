# Vokabular-Abgleich: welche URI, welcher Wert, welches Label

**Gemessen am 2026-08-18 gegen Staging** (`repository.staging.openeduhub.net`),
Korpus **590 209** Datensätze (`contentType=FILES`).

Nachfolger von `2026-08-17-metadatenfelder-erhebung.md`. Jene Erhebung fragte,
welche Felder es GIBT und wer sie PFLEGT. Sie fragte nicht, **wovon eine
Beschriftung eigentlich abhängt** — und ihre drei Suchmuster sahen zwei Felder
nie an.

---

## 1. Der Mechanismus

> **`<property>_DISPLAYNAME` beschriftet genau das, was das WIDGET im
> Metadatensatz deklariert.** Nicht die URI-Form, nicht das veröffentlichte
> Vokabular.

Belegt an **einem** Datensatz (`7affb314-3f66-4a86-955d-161239ec63b2`), einem
Lesevorgang, sieben Feldern und zwei Ausgängen:

| Feld | gespeichert | `_DISPLAYNAME` |
|---|---|---|
| `ccm:oeh_quality_login` | `1` | **„Ohne Login zugänglich"** |
| `ccm:oeh_quality_didactics` | `3` | — |
| `ccm:oeh_quality_language` | `3` | — |
| `ccm:oeh_quality_medial` | `3` | — |
| `ccm:oeh_quality_neutralness` | `4` | — |
| `ccm:oeh_quality_transparentness` | `5` | — |
| `ccm:oeh_quality_protection_of_minors` | `0` | — |

Die Trennlinie liegt **nicht** bei „Ziffer oder URI". `ccm:oeh_quality_login`
speichert eine nackte Ziffer und wird beschriftet, weil sein Widget `0`/`1` mit
Beschriftung deklariert. `didactics` speichert dieselbe Art Ziffer und bekommt
nichts, weil sein Widget URIs deklariert. Die Gegenprobe in der anderen Richtung:
`containsAdvertisement/yes` ist eine saubere URI aus einem veröffentlichten
Vokabular und bleibt **unbeschriftet** (3 von 3 lesbaren Trägern) — weil das
Widget dieses Vokabular nicht nennt.

Damit ist die Aussage vom 17.8. („ihr Inhalt ist nicht beschriftbar") bestätigt,
aber sie war erschlossen und ist jetzt gemessen — und ihre Begründung war
ungenau: es liegt nicht an der Schreibweise, sondern an der Deklaration.

---

## 2. Zwei Felder, die die Erhebung vom 17.8. nie gesehen hat

Ihre Muster (`^ccm:oeh_quality_`, `accessib|conditionsOfAccess|restricted_access`,
`licen[sc]|copyright|urheb`) passten auf keines der beiden.

| Feld | Belegungen | Anteil | ohne Beschriftung |
|---|---|---|---|
| **`ccm:price`** „Kosten" | 339 687 | 58 % | **0 %** |
| **`ccm:containsAdvertisement`** „Werbung" | 69 688 | 12 % | **100 %** |

**`ccm:price`** ist das am besten gepflegte lesbare Feld, das wir nicht gelesen
haben — dreiwertig (`price/yes` 608 · `price/yes_for_additional` 1 058 ·
`price/no` 338 017), vokabular-rein bis auf vier Datensätze mit `true`/`false`,
und vom Repository beschriftet.

**`ccm:containsAdvertisement`** ist der Sonderfall, der eine Projektregel
einschränkt. Sein Widget deklariert die **Sterne-Skala**
`quality_advertisement/0…5`, während der Korpus 69 628 der 69 688 Werte als
`containsAdvertisement/no` (63 081) und `/yes` (6 547) speichert. Beide
Vokabulare sind veröffentlicht, das Widget nennt das falsche, also schweigt das
Repository. Die restlichen 60 Belegungen sind Sterne-Reste (`5`×28, `4`×11, …)
und ein Paar echter `quality_advertisement/*`-URIs.

---

## 3. Vokabulare ohne Feld

Von den dreizehn veröffentlichten Vokabularen deklariert kein Staging-Feld:

| Vokabular | Lage |
|---|---|
| `quality_relevance` „Aktualitätsqualität" | `ccm:oeh_quality_currentness` deklariert stattdessen nackte Ziffern **mit** eigenen Beschriftungen — dieselbe Skala, zweite Modellierung |
| `containsAdvertisement` | siehe oben: das Feld nennt `quality_advertisement` |
| `copyrightAndOtherRestrictions` | im Metadatensatz **gar nicht** vorhanden |

---

## 4. Die vollständige Tabelle

„ohne Beschriftung" = Belegungen, deren Wert das Widget nicht deklariert.

| Feld | deklariert | gespeichert | Belegungen | ohne Beschriftung |
|---|---|---|---|---|
| `ccm:price` | `price/…` | `price/…` | 339 687 | 4 (0 %) |
| `ccm:conditionsOfAccess` | `conditionsOfAccess/…` | dito | 198 699 | 0 |
| `ccm:oeh_quality_login` | Ziffern 0,1 | Ziffern | 72 787 | 0 |
| `ccm:containsAdvertisement` | `quality_advertisement/…` | `containsAdvertisement/…` | 69 688 | **69 678 (100 %)** |
| `ccm:accessibilitySummary` | `accessibilitySummary/…` | dito | 3 475 | 0 |
| `ccm:oeh_quality_protection_of_minors` | `quality/…` | `quality/…` + `0`×3 389 | 3 444 | 3 392 (98 %) |
| `ccm:license_oer` | `oer/…` | dito | 1 121 | 0 |
| `ccm:oeh_quality_criminal_law` | `quality/…` | + Ziffern | 98 | 44 (45 %) |
| `ccm:oeh_quality_copyright_law` | `quality/…` | + Ziffern | 97 | 45 (46 %) |
| `ccm:oeh_quality_neutralness` | `quality_neutrality/…` | + Ziffern | 79 | 30 (38 %) |
| `ccm:oeh_accessibility_open` | `accessibility_openness/…` | + Ziffern | 57 | 28 (49 %) |
| `ccm:oeh_quality_data_privacy` | `quality_data_privacy/…` | + Ziffern | 50 | 6 (12 %) |
| `ccm:oeh_quality_currentness` | Ziffern 0–5 | Ziffern | 41 | 0 |
| `ccm:oeh_quality_correctness` | `quality/…` | **nur** Ziffern | 41 | 41 (100 %) |
| `ccm:oeh_quality_medial` | `quality_media/…` | + Ziffern | 39 | 26 (67 %) |
| `ccm:oeh_quality_transparentness` | `quality_transparency/…` | + Ziffern | 35 | 26 (74 %) |
| `ccm:oeh_quality_didactics` | `quality_didactics/…` | + Ziffern | 34 | 20 (59 %) |
| `ccm:oeh_quality_language` | `quality_language/…` | **nur** Ziffern | 30 | 30 (100 %) |

---

## 5. Was daraus gebaut wurde

`src/node-access.ts` liest jetzt **fünf** Felder statt drei: `ccm:price` und
`ccm:containsAdvertisement` kommen hinzu.

Für `ccm:containsAdvertisement` gibt es eine lokale Tabelle mit **zwei**
Einträgen (`yes` → „Ja", `no` → „Nein", die `prefLabel.de` des veröffentlichten
Vokabulars). Sie ist eine **Rückfallebene, kein Vorrang**: liegt ein
`_DISPLAYNAME` vor, gewinnt es. Repariert das Repository seinen Metadatensatz,
greift die Tabelle von selbst nicht mehr.

Das schränkt die Regel „**Keine Vokabular-Tabelle**" (P4, 2026-08-17) ein, ohne
sie aufzuheben. Ihre Begründung war, eine eigene Tabelle sei eine dritte Quelle,
die mit einer Instanz Schritt halten muss. Hier gibt es nichts, womit Schritt zu
halten wäre: das Repository beschriftet dieses Feld nachweislich nicht, auf
69 688 Datensätzen, und der Wertebereich ist ein geschlossenes Ja/Nein.

**Nicht aufgenommen:** die Qualitätsfelder (Abschnitt 1) und
`ccm:oeh_quality_login`. Letzteres ist sauber beschriftet und mit 72 787
Belegungen gut gepflegt, sagt aber dasselbe wie `ccm:conditionsOfAccess` —
zweiwertig statt dreiwertig, auf einem Drittel der Datensätze. Beide zu lesen
hieße, dieselbe Tatsache zweimal auszugeben, mit der Möglichkeit zu
widersprechen.

---

## 6. Nebenbefunde

- **Kein einziges** der zwölf geprüften Felder ist als ngsearch-Kriterium
  brauchbar — alle antworten HTTP 400, `ccm:price` und
  `ccm:containsAdvertisement` eingeschlossen. Die Regel „ablesbar, nicht
  suchbar" gilt damit für die ganze Fläche.
- **`skipCount` jenseits von ~10 000 antwortet HTTP 500.** Eine frühere Sonde
  schien mit 550 000 durchzukommen; sie hatte die Schleife vorher verlassen.
  Wer über den Korpus streuen will, streut über SUCHWÖRTER, nicht über Offsets.
- **Der Kopf einer leeren Anfrage ist keine Stichprobe.** 300 Datensätze
  enthielten keinen einzigen Träger von `ccm:oeh_quality_login` — einem Feld auf
  12 % des Korpus.
- **Ein Datensatz kann im Suchindex stehen und beim Knotenlesen 404 antworten**
  (`f28f4d6e-7ab7-43f7-83b1-0d87f1636b98`). Wer Träger sucht, braucht mehrere
  Kandidaten je Feld.
- Drift gegenüber dem 17.8.: `protection_of_minors` 3 432 → 3 444,
  `criminal_law` 86 → 98, `copyright_law` 85 → 97, `neutralness` 67 → 79.

---

## 7. Wiederholen

```bash
npm run survey:metadata
```

Das Skript hat eine **vierte Gruppe** bekommen (`Kosten & Werbung`,
`/price|advertisement/i`), denn seine drei Muster verfehlten genau die zwei
Felder, um die es hier geht. Beide standen die ganze Zeit in der Liste der
„übrigen Felder", die das Skript am Ende ausgibt — genau dafür gibt es sie, und es
brauchte eine zweite Erhebung, sie tatsächlich zu lesen.

Was das Skript **nicht** beantwortet, ist Abschnitt 1: es vergleicht Gespeichertes
gegen Deklariertes, fragt aber keinen echten Datensatz, ob eine Beschriftung
zurückkommt. Die Sonden dafür liefen einmalig aus dem Scratchpad und sind nicht
Teil des Repositorys; wer sie wiederholt, braucht mehrere Kandidaten je Feld
(Abschnitt 6) und streut über Suchwörter statt über Offsets.
