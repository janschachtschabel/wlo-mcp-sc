# Zweite Antwort an das Chatbot-Team: Anmeldung aus der WLO-Sitzung (2026-11-15)

Zu eurer zweiten Antwort vom selben Tag. Der Weiterreicher ist eine gute Lösung — danke. Gebaut ist
beides, worum ihr gebeten habt: das Budget für euer Backend und die Bindung für Ticket-Blöcke.

## 1. Weg B über euren Weiterreicher

Verstanden und so vorgesehen: Euer Pfad auf dem Repository-Host führt zu eurem Backend, das den Tausch
von Server zu Server an `POST /auth/session` an der Wurzel weiterreicht. Am MCP braucht es dafür weder
das Chart noch `WLO_SESSION_MOUNT_PATH`. Die Herkunftsprüfung bleibt, wie sie ist: Ohne
`WLO_SESSION_ALLOWED_ORIGINS` gilt die Herkunft aus `WLO_REPOSITORY_URL`.

### Budget (euer Punkt 2) — gebaut

Mit eurem Schlüssel aus `TRUSTED_CLIENT_KEYS` im Kopf `X-WLO-Client-Key` gilt an `/auth/session` und
`/auth/revoke`:

- **Anfragen** zählen nicht mehr im Adress-Topf (`API_RATE_LIMIT_RPM`), sondern im **Protokoll-Budget
  eures Clients**: 3 × die `rpm` eures Eintrags. Bei `boerdi:360:…` sind das 1080 je Minute. Es ist
  derselbe Topf, aus dem eure POSTs an `/mcp` und eure Abfragen an `/auth/status` zahlen. Eure eigene
  Grenze von 20 Tauschen je Minute könnt ihr danach bemessen.
- **Der Schutz vor vielen verschiedenen Sitzungen** (`TICKET_CREDENTIAL_LIMIT`, 200 in 10 Minuten) zählt
  **je Adresse, die ihr für die Person nennt**, innerhalb eures Clients. Eine Schulklasse hinter einer
  Adresse teilt sich also 200, jede andere Adresse hat ihre eigenen 200.
- Gelesen wird **der Eintrag, den euer Backend an `X-Forwarded-For` anhängt**: Ruft euer Backend den MCP
  direkt, ist es der letzte Eintrag. Läuft der Weg über unseren Proxy (`TRUST_PROXY` an), ist es der
  vorletzte, denn den letzten schreibt unser Proxy mit eurer Adresse. Bitte **anhängen**, nicht voranstellen
  und nicht ersetzen. Was weiter links steht, hat der Browser behauptet und wird nicht gelesen.
- Ohne gültigen Schlüssel ändert sich nichts. Ein erfundenes `X-Forwarded-For` teilt dann keinen Topf auf;
  ein Test hält das fest.
- Steht kein brauchbarer Eintrag da (fehlt, Port dran, keine Adresse), zählt euer ganzer Client als eine
  Adresse: Das ist vorsichtiger, aber wieder der alte Engpass.
- Die Pfade mit Passwort (`/auth/issue`, `/auth/revoke-all`) und `/auth/ticket` behalten die Adresse.
- Die 429-Antworten sind die bekannten: `rate_limited` für das Anfrage-Budget, `too_many_logins` für den
  Schutz, je mit der genauen Wartezeit in `retryAfter`.

### Staging (euer Punkt 1)

Gemessen am 15.11.: Der Staging-Server meldet in `/health` noch **Version 1.0.0**, und `/auth/session`
antwortet dort 404. Die Variable allein genügt also nicht; der Server bekommt erst den aktuellen Stand und
dann `WLO_SESSION_EXCHANGE=1` sowie euren Schlüssel in `TRUSTED_CLIENT_KEYS`. Wir melden uns, sobald das
läuft.

### Doku (euer Punkt 3)

Die Startmeldung, `docs/AUTH.md` §5d, die Variablen-Tabellen und die Chart-README nennen den
Weiterreicher jetzt als zweite Form. Dort steht auch: Das Budget hängt am Schlüssel, und `TRUST_PROXY` muss
nur zu eurem Weg zum MCP passen.

## 2. Bindung auch für Ticket-Blöcke — gebaut

Dieselbe Regel wie beim Sitzungs-Block: Ein Ticket-Block trägt den Zeitpunkt seiner Eintragung auf die
Millisekunde, und beim Prüfen muss er dem Eintrag gleichen. Ein Widerruf hält jetzt auch dann, wenn
dasselbe Ticket noch einmal getauscht wird, in einem anderen Tab oder beim stillen Erneuern nach 12 Stunden.
Solange die Eintragung besteht, bekommt ein Neuladen einen Block derselben Eintragung, und beide gelten.

**Beim Einspielen** antwortet ein Ticket-Block, den vorher ein Neuladen ausgestellt hat (nicht der erste
Tausch einer Eintragung), einmal mit 401. Das Widget tauscht dann neu, wie ihr geschrieben habt.

## 3. Was offen bleibt

- Neuer Stand auf dem Staging-Server, danach euer Test im Browser.
- Bindung an den Client-Schlüssel: weiter notiert, nicht gebaut.
