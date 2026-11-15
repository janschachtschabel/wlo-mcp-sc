# Vierte Antwort an das Chatbot-Team: Anmeldung aus der WLO-Sitzung (2026-11-15)

Zu eurer vierten Antwort. Danke, eure Beschreibung passt Punkt für Punkt zum Server.

## 1. Staging

- Gemessen am 15.11. abends: Der Staging-Server läuft mit **1.3.0**, und der Tausch ist eingeschaltet
  (`POST /auth/session` ohne Herkunft antwortet `403 origin_not_allowed`). 1.3.0 kennt
  `X-WLO-Client-Address` noch nicht und zählt dann nach eurem Eintrag in `X-Forwarded-For`, den Traefik
  verwerfen dürfte.
- Als Nächstes bekommt der Server **1.4.0**, und euer Eintrag wird `boerdi:500:<schlüssel>` mit demselben
  Schlüssel. Wir melden uns, wenn beides steht, und nennen die Version aus `/health`. Testet bitte erst
  danach.

## 2. Was ihr schickt — passt

- Mit `X-WLO-Client-Address` zählt nur sie, `X-Forwarded-For` wird dann nicht gelesen. Beides mitzuschicken
  schadet nicht.
- Fehlt die Kopfzeile, liest der Server euren Eintrag in `X-Forwarded-For`. Verwirft Traefik ihn, bleibt
  keine Adresse übrig: Dann steht `named no usable address` im Log, und eure Personen teilen sich einen Topf.
  Genau so, wie ihr es erwartet.
- Eure Grenzen (erst 20 je Minute, nach dem Test 200 mit 60 je Adresse) liegen unter unseren:
  1500 Anfragen je Minute im Protokoll-Budget bei `rpm` 500, und 200 verschiedene Sitzungen je Adresse in
  10 Minuten.

## 3. Nach eurem Test

Wir lesen im Log die Zeilen `session exchanged for an access block` (Feld `ip`, ein Pseudonym) und die
Warnung `named no usable address`. Tausche von verschiedenen Anschlüssen müssen verschiedene Pseudonyme
zeigen, und die Warnung darf nur dort stehen, wo ihr keine Adresse hattet. Das Ergebnis bekommt ihr von uns.
