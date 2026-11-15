# Design: Inhalt anlegen ohne Quell-URL (Datei am Datensatz)

**Status:** UMGESETZT 2026-08-06. Abweichungen vom Entwurf stehen unten unter
"Was beim Bauen anders entschieden wurde".
**Vorgeschichte:** `docs/plans/STATUS.md` → „Datei-Upload statt Quell-URL".

## Ziel

`wlo_create_content` verlangt heute eine `ccm:wwwurl`. Was im Chat entsteht — ein
Arbeitsblatt in Markdown, ein erzeugtes Bild — hat keine. Der Datensatz soll die
Datei stattdessen **selbst tragen**: Datei erzeugen → Knoten anlegen → Datei
dranhängen. Das ist der Weg, den edu-sharing dafür vorsieht.

## Was gemessen ist (nicht erneut herleiten)

Aus `wlo-content-files`, **validiert 2026-05-08 gegen prod UND staging**, sowie
aus der `openapi.json` von Staging, gezogen 2026-08-06:

| Frage | Antwort | Beleg |
|---|---|---|
| `ccm:io` ohne `ccm:wwwurl` anlegbar? | **Ja.** Der Child-IO-Pfad legt genau so einen an (`cm:name`, kein `wwwurl`). | Skill, validiert |
| Bytes anhängen | `POST /node/v1/nodes/-home-/{id}/content?mimetype=…&versionComment=…`, multipart-Feld `file` | Skill + openapi |
| Woran erkennt man, dass Bytes ankamen? | Ein Knoten **ohne** Datei hat `size: null` und `downloadUrl: null`; danach sind beide gesetzt | Skill |
| Taugt `/textContent` als Speicher? | **Nein.** Antwortet 200, legt den Rumpf wörtlich als Binärinhalt ab, `GET` liefert danach `{"text": null}` | Skill, gemessen 2026-07-31 |
| Versionierung | Jeder Upload erzeugt eine neue Version. `PUT`-Metadaten versionieren nicht, `POST` schon | Skill |

**Ungemessen und deshalb nicht benutzt:** `POST …/children/_content` (Anlegen und
Bytes in einem Aufruf) steht in der `openapi.json`, ist aber nie gelaufen. Der
zweistufige Weg ist der validierte — im Zweifel der gemessene Pfad, nicht der
elegantere. Wer `_content` später will, misst es zuerst.

## Entscheidungen des Nutzers (2026-08-06)

1. **Markdown als Text**, damit Arbeitsblätter direkt gehen — **plus Base64 für
   Bilder**. Kein allgemeiner Binär-Upload (PDF o. Ä.): das Modell hat solche
   Bytes ohnehin selten, und sie sprengen Kontext wie Body-Limit.
2. **Dublettenprüfung über den Titel im eigenen Ablageort.** Ohne URL gibt es
   den bisherigen Anker nicht; nach gleichem Titel im eigenen Home bzw. im
   Posteingang zu suchen fängt den häufigen Fall — derselbe Auftrag zweimal.

## Schnittstelle

`wlo_create_content` wird erweitert, kein neues Werkzeug: es ist derselbe Vorgang
mit einer anderen Inhaltsquelle, und ein zweites Werkzeug hieße, den ganzen
Bestätigungsablauf ein zweites Mal zu haben.

```
url          optional (bisher Pflicht)   Quell-URL, wie bisher
content      optional                    der Text selbst (Markdown/HTML/Text)
contentFormat  markdown | html | text    Vorgabe markdown; bestimmt mimetype + Dateiendung
imageBase64  optional                    Bilddaten, base64
imageName    optional                    Dateiname inkl. Endung
imageMimeType optional                   image/png | image/jpeg | image/webp | image/svg+xml
```

**Genau eine Quelle** muss angegeben sein (`url`, `content` oder `imageBase64`);
mehrere zugleich werden abgelehnt statt still priorisiert. `title` bleibt Pflicht.

## Ablauf

```
1. Quelle bestimmen und validieren  (genau eine, Größe, MIME gegen Inhalt)
2. Bytes erzeugen                    (Text → UTF-8; Bild → base64 dekodieren)
3. Dublettenprüfung
     url vorhanden  → wie bisher über ccm:wwwurl
     sonst          → Titelsuche im Ablageort (-userhome- bzw. WLO_INBOX_ID)
4. Vorschau + Bestätigungsschlüssel   ← der Fingerabdruck deckt die Bytes ab
5. Knoten anlegen                     (ccm:io, OHNE ccm:wwwurl)
6. Bytes anhängen                     POST …/content?mimetype=…
7. Restliche Metadaten schreiben      (Titel usw., wie heute)
8. RÜCKLESEN                          size != null && downloadUrl != null
```

Schritt 6 fehlgeschlagen heißt: es existiert ein Knoten **ohne** Inhalt. Das wird
gemeldet, samt nodeId, und nicht stillschweigend als Erfolg verbucht — ein
leerer Datensatz, der wie ein fertiger aussieht, ist schlimmer als gar keiner.

## Die drei bindenden Regeln

1. **Der Fingerabdruck deckt die Bytes.** Der Bestätigungs-Token ist an die
   gezeigte Änderungsmenge gebunden. Bytes sind Nutzlast, also gehören in die
   Vorschau — und zwar so, dass ein Mensch sie prüfen kann: **Dateiname, MIME,
   Größe in Bytes und ein SHA-256-Präfix**. Ohne das genehmigt jemand „Datensatz
   anlegen", und wir laden zusätzlich etwas hoch, das er nie gesehen hat.
   Bei Text zusätzlich die ersten Zeilen im Klartext (durch `capText`), denn den
   kann man wirklich lesen.
2. **Rücklesen.** `size`/`downloadUrl` nach dem Upload. edu-sharing verwirft
   Schreibvorgänge und antwortet trotzdem mit 200 — hier gibt es endlich ein
   Merkmal, an dem sich das feststellen lässt.
3. **Kein `/textContent`.** Gemessen wirkungslos. Wer es einbaut, baut den
   stillen Datenverlust wieder ein.

## Größen und das Body-Limit

`MAX_BODY_BYTES` steht auf **1 MB** und begrenzt den ganzen JSON-RPC-Rumpf.
Base64 bläht um ein Drittel, es passen also gut 700 KB Bilddaten samt Metadaten.
Der Kommentar an der Stelle („an MCP JSON-RPC request is tiny") stimmt nicht mehr,
sobald Bilder mitkommen.

Zwei Änderungen gehören dazu:

- **Vorgabe anheben** auf einen Wert, bei dem ein erzeugtes Bild durchgeht
  (Vorschlag: 4 MB), dokumentiert in `.env.example` und README. Das ist eine
  bewusste Erhöhung der Angriffsfläche für Speicherverbrauch — deshalb
  ausdrücklich und nicht nebenbei.
- **Der 413 muss sagen, was zu tun ist.** Heute antwortet er
  `Request body exceeds N bytes` auf Englisch, bevor das Werkzeug läuft — das
  Modell sieht einen Transportfehler ohne Handlungsanweisung. Er soll benennen,
  dass die Datei zu groß ist und dass `MAX_BODY_BYTES` die Stellschraube ist.

Zusätzlich eine **eigene Grenze im Werkzeug** (Vorschlag: 2 MB dekodiert), damit
die Fehlermeldung aus dem Werkzeug kommt und nicht aus der Transportschicht.

## Validierung der Bilddaten

- Base64 muss dekodierbar sein; ein Fehlschlag ist eine Ablehnung, kein 500.
- **MIME gegen Inhalt prüfen** (Magic Bytes: PNG `89 50 4E 47`, JPEG `FF D8 FF`,
  WebP `RIFF`/`WEBP`, SVG als Text). Ein `image/png`, das ein Skript ist, darf
  nicht unter falschem MIME im Repository landen und dort ausgeliefert werden.
- SVG ist aktiv ausführbarer Inhalt. Entweder ganz weglassen oder nur mit einer
  bewussten Entscheidung aufnehmen — nicht mitschleifen, weil es ein Bildformat ist.
- Dateiname niemals ungeprüft übernehmen: er wird zu `cm:name`. Durch
  `sanitizeText`, und Pfadanteile (`/`, `\`, `..`) fallen raus.

## Nicht in diesem Vorhaben

- **Child-IOs** (Arbeitsblatt mit angehängten Bildern als Serienobjekte). Der
  Skill beschreibt den validierten Weg, aber ein Datensatz trägt hier genau eine
  Datei. Mehrteilige Anhänge sind ein eigener Entwurf.
- Beliebige Binärdateien (PDF, DOCX) über Base64.
- `_content` als Einzelaufruf.

## Was beim Bauen anders entschieden wurde

Drei Abweichungen, alle in Richtung kleiner und sicherer:

1. **HTML gestrichen.** Der Entwurf sah `markdown | html | text` vor. Eine
   hochgeladene HTML-Datei, die das Repository von seiner eigenen Domain
   ausliefert, ist gespeichertes XSS. Markdown deckt ab, wofuer Arbeitsblaetter
   gebraucht werden. Uebrig: `markdown | text`.
2. **Kein MIME-Parameter und kein Dateiname-Parameter.** Der Entwurf hatte
   `imageMimeType` und `imageName`. Beide sind weg: der Typ wird aus den Magic
   Bytes gelesen, der Dateiname aus dem Titel abgeleitet. Was der Aufrufer nicht
   angeben kann, kann er auch nicht falsch angeben — und ein Pfad-Traversal
   ueber einen erfundenen Dateinamen existiert damit gar nicht erst.
3. **Die Dublettenpruefung per Titel warnt, sie blockiert nicht.** Sie laeuft in
   der Vorschau als Notiz neben der Aenderungsmenge, nicht im Fingerabdruck: ein
   Titeltreffer ist schwaecheres Indiz als eine gleiche URL, und zwei
   Arbeitsblaetter duerfen denselben Namen tragen.

Ausserdem beim Bauen entstanden: `services/write/duplicates.ts`. Die zweite Art,
nach einer Dublette zu fragen, war die eine Verantwortung zu viel fuer
`nodes-lifecycle.ts` — die Datei stand bei 275 Zeilen und waere sonst darueber
gewachsen.
