# Zweite Antwort an das Chatbot-Team: Anmeldung aus der WLO-Sitzung (2026-11-15)

Zu eurer zweiten Antwort vom selben Tag. Der Weiterreicher ist eine gute Lösung — danke. Gebaut ist
beides, worum ihr gebeten habt, und es steckt in **Version 1.3.0** (Tag `v1.3.0`, Image
`ghcr.io/janschachtschabel/wlo-mcp:1.3.0`, Chart `oci://ghcr.io/janschachtschabel/charts/wlo-mcp`
1.3.0). An Werkzeugen, Parametern und Fehlercodes hat sich gegenüber 1.2.0 nichts geändert.

Kurz:
- Euer Backend bekommt an `/auth/session` und `/auth/revoke` ein eigenes Budget über seinen Schlüssel.
  Der Schutz vor vielen Sitzungen zählt je Adresse, die ihr für die Person nennt (Abschnitt 1).
- Ticket-Blöcke sind jetzt an ihre Eintragung gebunden; beim Einspielen einmal 401 (Abschnitt 2).
- Auf Staging läuft das noch nicht: Der Server bekommt erst 1.3.0 (Abschnitt 3).

## 1. Budget für den Weiterreicher

### Was zählt, wo

Euer Backend schickt seinen Schlüssel im Kopf `X-WLO-Client-Key`. Er steht auf dem Server in
`TRUSTED_CLIENT_KEYS` als `name:rpm:schlüssel`. Dann gilt:

| | ohne Schlüssel (bisher) | mit eurem Schlüssel |
|---|---|---|
| Anfragen an `/auth/session` und `/auth/revoke` | je Adresse 30 je Minute (`API_RATE_LIMIT_RPM`), geteilt mit allen anderen `/auth*`-Seiten derselben Adresse | **euer Protokoll-Budget: 3 × `rpm` je Minute** |
| Verschiedene Sitzungen (`TICKET_CREDENTIAL_LIMIT`) | 200 je 10-Minuten-Fenster für die eine Adresse eures Backends, also für alle Personen zusammen | **200 je 10-Minuten-Fenster je Adresse, die ihr für die Person nennt** |

Das Protokoll-Budget ist **ein Topf**. Daraus zahlen auch alle eure POSTs an `/mcp` und eure Abfragen an
`/auth/status`. Bei `rpm` = 360 (unsere Empfehlung, weil BOERDi sich selbst bei 300 Werkzeugaufrufen je Minute
begrenzt) sind das 1080 Anfragen je Minute insgesamt. Gehen davon bis zu 300 an `/mcp`, bleiben rund
780 je Minute für Tauschen, Abmelden und Status.

**Eure eigene Grenze von 20 Tauschen je Minute** könnt ihr daher deutlich anheben. Etwa 200 je Minute
lassen genug Luft. Zehn davon für das Abmelden freizuhalten ist nicht mehr nötig: Abmelden zahlt aus
demselben großen Topf.

Ein Neuladen mit **derselben** Sitzung zählt im Sitzungs-Schutz nicht neu, nur eine andere Sitzung tut es.
Eine Schulklasse hinter einem Router teilt sich also 200 verschiedene Anmeldungen je 10 Minuten. Jede andere
Adresse hat ihre eigenen 200.

### Welche Adresse wir lesen

Gelesen wird **der Eintrag, den euer Backend an `X-Forwarded-For` anhängt**. Was weiter links steht, hat der
Browser behauptet, und wird nicht gelesen.

- Ruft euer Backend den MCP **direkt** auf, ist es der letzte Eintrag (`TRUST_PROXY` aus).
- Geht der Weg **über den Proxy vor dem MCP**, ist es der vorletzte (`TRUST_PROXY` an); den letzten
  schreibt der Proxy mit der Adresse eures Backends. So ist der Staging-Server eingerichtet: Traefik
  davor, `TRUST_PROXY=1`.

Bitte die Adresse der Person also **anhängen**, nicht voranstellen und nicht ersetzen. Fehlt der Eintrag
oder ist er keine reine Adresse (etwa mit Port), zählt euer ganzer Client als eine Adresse. Das ist
vorsichtig, aber wieder der alte Engpass. IPv6-Adressen zählen je /64, wie überall bei uns.

Ohne gültigen Schlüssel ändert sich nichts: Ein erfundenes `X-Forwarded-For` teilt dann keinen Topf auf.
Die Pfade mit Passwort (`/auth/issue`, `/auth/revoke-all`) und `/auth/ticket` behalten die Adresse.

### Was ihr bei einer Grenze bekommt

Beide Antworten tragen `429`, die Kopfzeile `Retry-After` und den Rumpf
`{"error": "…", "code": "…", "retryAfter": <Sekunden>}`:

- `code: "rate_limited"` — euer Protokoll-Budget ist erschöpft. Die Wartezeit ist der Rest des
  Minutenfensters.
- `code: "too_many_logins"` — für **diese** Adresse sind 200 verschiedene Sitzungen erreicht. Die Wartezeit
  ist der Rest ihres 10-Minuten-Fensters. Andere Adressen sind davon nicht betroffen.

Das sind dieselben Codes wie bisher; neu ist nur, wo gezählt wird.

### Was wir nicht verschweigen

Mit eurem Schlüssel begrenzt am Ende nur euer Protokoll-Budget, wie viele verschiedene Sitzungen ihr
insgesamt vorlegt: Die Adresse nennt ja ihr. Eine Sitzungskennung ist nicht zu erraten, darum nehmen wir
das hin. Der Schlüssel ist damit aber so viel wert wie der Zugang zu diesem Budget: bitte nur im Backend
halten, nie im Widget.

## 2. Bindung auch für Ticket-Blöcke — gebaut

Dieselbe Regel wie beim Sitzungs-Block. Ein Ticket-Block trägt den Zeitpunkt seiner Eintragung auf die
Millisekunde, und beim Prüfen muss er dem Eintrag gleichen.

- **Ein Abmelden hält jetzt.** Wird dasselbe Ticket noch einmal getauscht, in einem anderen Tab oder beim
  stillen Erneuern nach 12 Stunden, bekommt ihr einen **neuen** Block. Der alte bleibt ungültig.
- **Ein Neuladen während einer Eintragung** bekommt einen Block derselben Eintragung, und beide gelten
  nebeneinander. Zwei Tabs, die gleichzeitig tauschen, landen in derselben Eintragung.
- **Einmal 401 beim Einspielen:** Ein Ticket-Block, den vor 1.3.0 ein Neuladen ausgestellt hat (nicht der
  erste Tausch einer Eintragung), trägt einen anderen Zeitpunkt. Er antwortet einmal mit 401, das Widget
  tauscht neu, und der neue Block gilt.
- Aus dem Review: Jede neue Eintragung bekommt ihren Zeitpunkt jetzt beim Schreiben, strikt nach der
  vorigen. Zwei Tausche im selben Moment rund um einen Widerruf können sich so keinen Zeitpunkt mehr teilen.
  An eurem Ablauf ändert das nichts.

**Ein Hinweis zum Abmelden:** Widerrufen wird über die Kennung des Blocks (`/auth/revoke`). Schickt euer
Backend einen **alten** Block derselben Sitzung oder desselben Tickets, beendet das auch die **aktuelle**
Eintragung. Ein Tab, den die Person inzwischen neu geöffnet hat, ist dann ebenfalls abgemeldet. Das ist die
sichere Richtung und so gewollt; ein Abmelde-Versuch mit einem veralteten Block ist also nicht harmlos.

## 3. Staging

Gemessen am 15.11.: Der Staging-Server meldet in `/health` noch **Version 1.0.0**, und `/auth/session`
antwortet dort 404. Er bekommt jetzt:

1. Version 1.3.0,
2. `WLO_SESSION_EXCHANGE=1` (ohne Chart und ohne `WLO_SESSION_MOUNT_PATH`; ihr ruft `/auth/session` an der
   Wurzel),
3. euren Schlüssel in `TRUSTED_CLIENT_KEYS`, falls er dort noch fehlt,
4. `WLO_AUTH_PRIVATE_KEY`, wie für Weg A ohnehin.

Die Herkunftsprüfung bleibt: Ohne `WLO_SESSION_ALLOWED_ORIGINS` gilt die Herkunft aus `WLO_REPOSITORY_URL`
(Staging: `https://repository.staging.openeduhub.net`). Euer Backend reicht `Origin` nur weiter, wenn der
Browser genau diese geschickt hat, das passt.

Wir melden uns, sobald der Server läuft; danach euer Test im Browser.

## 4. Doku

Die Startmeldung, `docs/AUTH.md` §5c und §5d, `docs/rules/chatbot-contract.md`, die Variablen-Tabellen,
`docs/openapi.yaml` (`X-WLO-Client-Key` an beiden Pfaden) und die Chart-README nennen den Weiterreicher als
zweite Form. Dort steht auch: Das Budget hängt am Schlüssel, und `TRUST_PROXY` muss zu eurem Weg zum MCP
passen.

## Offen

- 1.3.0 auf dem Staging-Server, danach euer Test im Browser.
- Bindung an den Client-Schlüssel: weiter notiert, nicht gebaut.
