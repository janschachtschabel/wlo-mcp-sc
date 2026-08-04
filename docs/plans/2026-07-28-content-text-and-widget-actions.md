# Design: Volltext-Abruf, Lizenz-Ehrlichkeit und Auswahl-Aktionen in den Widgets

Status: **Plan — Freigabe ausstehend** (erstellt 2026-07-28)
Auslöser: Nutzer-Rückmeldung zu Kachel-Layout, Lizenzangabe, Auswahl-Buttons und
fehlendem Zugriff auf die eigentlichen Inhalte (nicht nur Metadaten).

## Untersuchungsergebnisse (gemessen, nicht vermutet)

### 1. Lizenz — die Eigenschaft ist da, die Daten fehlen

`ccm:commonlicense_key` steht in `DISPLAY_PROPS`, wird in `formatNode` zu
`FormattedNode.license` und von `renderTile` als Faktenzeile „Lizenz“ gerendert.
Der Pfad ist vollständig.

Bei sechs geprüften Tutory-Arbeitsblättern ist das Feld jedoch **auch mit voller
`-all-`-Projektion nicht gesetzt**. edu-sharing selbst liefert dort nur ein
Objekt `license: { icon: ".../licenses/none.svg", url: null }`. Andere Treffer
(z. B. das YouTube-Video) tragen sehr wohl eine Lizenz.

→ Kein Fehler in unserer Kette, sondern eine Datenlücke. **Aber:** Wir lassen die
Zeile bei fehlender Lizenz weg. Für Lehrende ist „keine Lizenzangabe“ eine
sicherheitsrelevante Information — sie dürfen das Material dann gerade **nicht**
als frei nachnutzbar behandeln. Das Weglassen ist die schlechteste Variante.

### 2. Volltext-Abruf — WLO hat den Text meistens schon

Stichprobe über 32 Inhalte aus vier Suchen (Arbeitsblatt, Eiszeit, Photosynthese,
Gedichtanalyse):

| Befund | Anzahl |
|---|---|
| `/textContent` liefert brauchbaren Text (> 200 Zeichen) | **29 von 32 (91 %)** |
| leer oder sehr kurz | 3 |
| Fehler | 0 |
| davon leer **und** mit `ccm:wwwurl` | 3 ← nur hier hilft der externe Dienst |

Textlängen reichen von 329 bis **41 300 Zeichen**. edu-sharing hat also für die
große Mehrheit bereits konvertiert — bei extern verlinkten Seiten ebenso wie bei
angehängten Dateien. **Der Abruf über `wwwurl` oder Datei ist damit die Ausnahme,
nicht die Regel.**

Der Extraktionsdienst bietet ausschließlich `POST /from-url` (dazu `/metrics`,
`/_ping`) — **keinen Datei-Upload**. Ihm die edu-sharing-Download-URL eines
Knotens zu geben, scheitert mit **424 Failed Dependency** (geprüft). Er ist damit
ausschließlich für externe `wwwurl` brauchbar, genau wie beschrieben.

→ **Reihenfolge: `/textContent` zuerst, Extraktionsdienst nur als Rückfall.**
edu-sharing-eigene und angehängte Daten kommen so aus dem Repository, ohne
externen Dienst. **Markitdown wird nicht gebraucht** — und wäre auch die falsche
Wahl, siehe Punkt 3.

Zwei Zahlen, die die Umsetzung prägen:
- `/textContent` ist **langsam**: Median 4647 ms, Maximum 9189 ms. Das liegt
  gefährlich nah an der Standard-Zeitgrenze von 10 s (`WLO_FETCH_TIMEOUT_MS`) —
  der Volltext-Abruf braucht eine eigene, höhere Grenze.
- 41 300 Zeichen aus einem einzigen Knoten würden das Kontextfenster fluten. Die
  `maxChars`-Grenze ist Pflicht, nicht Komfort.

### 3. Blockieren — durch das Design ausgeschlossen

Beide Wege sind **entfernte HTTP-Aufrufe**, also asynchrone Ein-/Ausgabe. Node
gibt währenddessen den Thread frei; andere Nutzer sind nicht betroffen (durch die
Nebenläufigkeitsmessung belegt: fünf gleichzeitige Aufrufe kosten pro Aufruf
genauso viel wie ein einzelner). **Eine Konvertierung im eigenen Prozess
(Markitdown, PDF-Parser) wäre dagegen CPU-gebunden und würde den einzigen Thread
blockieren** — genau das, was vermieden werden soll. Das ist der ausschlaggebende
Grund gegen einen eigenen Konverter, unabhängig davon, dass wir ihn nicht
brauchen.

### 4. Kachel-Layout — eine sichere Ursache, eine offene

`base.css` ist für Kacheln allein zuständig (`search-results/styles.css`
enthält nur `max-width`). Das Raster stretcht Kacheln einer Zeile auf gleiche
Höhe, **aber die Elemente im Inneren richten sich nicht aneinander aus**: Die
Faktenzeilen (Lizenz/Quelle) und der „Details“-Button folgen direkt auf die
Beschreibung. Ist diese kürzer, rutschen sie nach oben. Das erklärt das im
Screenshot sichtbare Versetzen.

Offen: Die Vorschaubilder erscheinen im Screenshot hochkant, obwohl
`.wlo-tile__thumb` ein `aspect-ratio: 16/9` mit `object-fit: cover` setzt. Das
muss im Host live nachgeprüft werden, bevor daran etwas geändert wird — eine
Vermutung ins Blaue wäre hier fehl am Platz.

## Umfang

Enthalten:
- Lizenz-Ehrlichkeit: fehlende Lizenz wird ausgewiesen statt verschwiegen.
- Neues Werkzeug für den Volltext eines Inhalts (beide Wege, mit Herkunftsangabe).
- Adressen externer Dienste über Umgebungsvariablen konfigurierbar.
- Kachel-Layout: Fußbereich der Kachel ausrichten; Bildproblem erst nach
  Live-Prüfung.
- Auswahl-Aktionen in der Kachelansicht mit Rückgabe der nodeIds.

Nicht enthalten:
- Eigene Dateikonvertierung (siehe Punkt 3).
- Schreibende Funktionen (eigener Plan, Auth).
- Zwischenspeichern der Volltexte (erst messen, dann entscheiden).

## Architektur

### Neues Werkzeug `get_wlo_content_text`

Zweck: den **tatsächlichen Inhalt** eines Materials liefern, nicht seine
Metadaten — damit ein Arbeitsblatt auch inhaltlich verarbeitet werden kann.

```
Eingabe:  nodeId (Pflicht) · maxChars (Default 8000) · preferSource ('auto'|'repository'|'external')
Ausgabe:  { nodeId, title, text, source, sourceUrl, truncated, charCount, reason? }
          source: 'external-extraction' | 'repository' | 'none'
```

Ablauf (Repository zuerst — es hat den Text in 91 % der Fälle schon):
1. `/textContent` von edu-sharing lesen. Ergibt das > 200 Zeichen → fertig,
   `source: 'repository'`. Kein externer Dienst im Spiel.
2. Nur wenn leer/zu kurz: Knoten-Metadaten schmal lesen (`ccm:wwwurl`) und —
   sofern eine externe URL existiert und ein Dienst konfiguriert ist — `POST
   /from-url` (`output_format: markdown`, `lang: auto`),
   `source: 'external-extraction'`.
3. Kein Text auf beiden Wegen → `source: 'none'` mit `reason`
   (`no_text_no_url` | `extraction_failed` | `node_not_found`), analog zu den
   Ursachen-Codes bei `get_topic_page_content`.
4. Auf `maxChars` kürzen, `truncated` ausweisen.

Die Reihenfolge spart im Normalfall den externen Aufruf **und** eine
Metadaten-Abfrage: Erst wenn das Repository nichts hat, wird überhaupt nach einer
`wwwurl` gesehen.

Der Extraktionsdienst wird **nur mit der öffentlichen Material-URL** aufgerufen —
keine Nutzerdaten, keine Tokens. Der bestehende Host-Guard in `wloFetch` hängt
Authentifizierung ohnehin ausschließlich an das konfigurierte Repository.

### Neue Umgebungsvariablen

```
WLO_TEXT_EXTRACTION_URL   Default https://text-extraction.staging.openeduhub.net
                          Leer  → externer Weg abgeschaltet, nur /textContent
WLO_TEXT_TIMEOUT_MS       Default 25000 — gilt für BEIDE Volltext-Wege
```

Begründung für eine eigene Zeitgrenze: `WLO_FETCH_TIMEOUT_MS` (10 s) ist auf
normale edu-sharing-Aufrufe zugeschnitten. Gemessen liegt `/textContent` aber bei
Median 4,6 s und Maximum 9,2 s — ein langsamer Knoten würde die Standardgrenze
reißen und einen Volltext verlieren, den es gibt. Der Extraktionsdienst rendert
Seiten und ist ebenfalls langsam (3,9 s gemessen). Jedes Repository bringt seinen
eigenen Extraktionsdienst mit, daher gehört dessen Adresse in die Konfiguration
und nicht in den Code.

### Lizenz-Ehrlichkeit

`FormattedNode.license` bleibt unverändert (leer bei fehlender Angabe) — die
Rohdaten sollen ehrlich bleiben. Die **Darstellung** ändert sich:
- Kachel (`tile.ts`): fehlende Lizenz → Zeile „Lizenz: nicht angegeben“.
- Markdown-Ausgabe (`formatter.ts`): dieselbe Aussage.
Das REST-Suchergebnis nutzt bereits „Lizenz unklar“ — die Formulierung wird
angeglichen.

### Neues Widget W5 — Lesetext (Markdown)

Zweck: Volltexte und Kompendiumstexte im Apps-SDK-Host lesbar darstellen statt
als Textwand. Angehängt an `get_wlo_content_text` und `get_compendium_text`.

**Kein Markdown-Paket.** Die Texte stammen von fremden Anbietern und aus einem
externen Konvertierungsdienst — also aus unvertrauenswürdiger Quelle. Ein
generischer Renderer vergrößert die Angriffsfläche, und die Widget-Bündel liegen
heute bei 7–9 kB (`marked` allein wäre ein Vielfaches). Stattdessen ein bewusst
**enger Teilmengen-Renderer** in der Art der bestehenden `escape.ts`/`tile.ts`:
Überschriften, Absätze, Fett/Kursiv, Aufzählungen (nummeriert und nicht),
Zitatblöcke, Code, Trennlinien, Links. Alles andere wird als Text escaped.
Links laufen durch das vorhandene `safeHref` (nur http/https). Reine Funktion,
DOM-frei, unit-getestet — wie alle anderen Renderer.

**Für Nutzer ohne Apps-SDK-Host mitgedacht** — dieselbe Information erreicht sie
über drei bereits bestehende Wege, ohne Zusatzarbeit:
- Der Text steht wie immer im `content[0].text`-Block, also in jedem MCP-Client.
- `outputFormat: 'markdown'` liefert ihn direkt lesbar in der Konversation.
- Der REST-Weg kann ihn analog zu `rest/search-page.ts` als HTML-Seite ausgeben
  (`?format=html`) — dieselbe Renderfunktion, serverseitig verwendet.

Der letzte Punkt ist der eigentliche Gewinn der eigenen Renderfunktion: Sie ist
in Widget **und** REST-Schicht nutzbar, ein Markdown-Paket im Widget-Bündel wäre
es nicht.

### Auswahl-Aktionen in der Kachelansicht

Randbedingung aus der Widget-Historie: Widget-initiierte Tool-Aufrufe scheitern
in ChatGPT (das Ergebnis wird als neues `toolOutput` zurückgespiegelt und setzt
den Zustand zurück — live 2026-07-17). Die Auswahl darf daher **nicht** selbst
ein Tool rufen, sondern reicht die Auswahl an die Konversation weiter:

- Pro Inhaltskachel eine Auswahl-Checkbox (`data-node-id`), Zustand lokal im
  Widget-State (überlebt Repaints wie der Baum-Zustand).
- Ein Aktionsbalken erscheint, sobald mindestens eine Kachel gewählt ist:
  „N ausgewählt · Weiterverwenden“.
- Der Button sendet über `host.sendFollowUp` eine Nachricht in Nutzerstimme, die
  **Titel und nodeIds explizit aufführt** — die Lehre aus dem „Inhalte
  anzeigen“-Button, der ohne nodeId scheiterte.
- Capability-gebunden über `canFollowUp()`; ohne Host-Unterstützung erscheinen
  weder Checkboxen noch Balken (keine toten Bedienelemente).

## Risiken

- Der Extraktionsdienst ist eine **externe Abhängigkeit** und läuft auf einer
  Staging-Adresse. Fällt er aus, muss der Repository-Weg greifen (Fallback ist
  Teil des Ablaufs, nicht Kür). Bei leerer Env-Variable ist er ganz abgeschaltet.
- Volltexte sind groß. Ohne die `maxChars`-Grenze läuft das Kontextfenster des
  Modells voll — die Grenze ist Pflicht, nicht Komfort.
- Auswahl-Zustand im Widget: ChatGPT kann das iframe neu einhängen. Der Zustand
  gehört daher in `setWidgetState`, wie beim Baum.

## Pakete

**P1 — Lizenz-Ehrlichkeit** (klein, sofort). Kachel + Markdown weisen eine
fehlende Lizenz aus. Tests: Kachel mit/ohne Lizenz.

**P2 — Volltext-Werkzeug** (mittel). Neues Modul `src/services/content-text.ts`
+ Werkzeug `src/tools/content-text.ts` + Env-Konfiguration. Tests mit
`fetchMock`: Repository-Weg, Rückfall auf den Dienst, abgeschalteter Dienst,
Kürzung, alle `reason`-Werte, und ein Pin darauf, dass der externe Dienst bei
vorhandenem Repository-Text **nicht** aufgerufen wird.

**P3 — Markdown-Renderer + Widget W5** (mittel, UI). Teilmengen-Renderer als
gemeinsame reine Funktion, Widget-Einbindung an Volltext und Kompendium, plus
die REST-HTML-Ausgabe für Nutzer ohne Apps-SDK-Host. Paired mit
`/better-coding-frontend`. XSS-Tests mit bösartigem Markdown sind Pflicht.

**P4 — Kachel-Layout** (klein). Fußbereich der Kachel ausrichten; das Bildformat
erst nach Live-Prüfung im Host anfassen. Paired mit `/better-coding-frontend`.

**P5 — Auswahl-Aktionen** (mittel, UI). Checkboxen, Aktionsbalken,
Follow-up-Nachricht mit nodeIds, Zustandssicherung. Paired mit
`/better-coding-frontend`.

Reihenfolge: P1 → P2 → P3 → P4 → P5. P1 und P2 sind unabhängig von der
Widget-Arbeit und liefern sofort Nutzen; P3 baut auf P2 auf (ohne Volltext gibt
es nichts zu rendern); P4 gehört vor P5, damit die Kacheln stabil sind, bevor
Bedienelemente hinzukommen.
