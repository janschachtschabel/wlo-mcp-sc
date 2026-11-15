# Antwort an das Chatbot-Team: Anmeldung aus der WLO-Sitzung (2026-11-15)

Zu eurer Antwort vom selben Tag. 1a und 1b sind umgesetzt, 1c beantwortet. Danke für das Nachmessen
in Abschnitt 4 — es deckt sich mit unseren Tests.

## 1a. Der Sitzungs-Pfad im Helm-Chart

Gebaut, nach dem Muster des md-editor:

- **`sessionIngress`** in `deploy/helm/wlo-mcp/values.yaml`, ohne Vorgabe aus. Es legt ein eigenes
  Ingress-Objekt `wlo-mcp-session` an, mit `sessionIngress.host` (der Repository-Host) und
  `sessionIngress.path` (Vorgabe `/edu-sharing/services/wlo-mcp`).
- Es leitet **nur** `<path>/auth/session` weiter (`pathType: Exact`), **unverändert**. Der MCP beantwortet
  genau diesen Pfad selbst (`WLO_SESSION_MOUNT_PATH`, setzt das Chart). Bewusst ohne Umschreibung wie beim
  md-editor: Bei ingress-nginx schaltet `rewrite-target` Regex-Pfade für alle Ingress-Objekte des Hosts ein,
  also auch für das des Repositorys. Kein anderer Pfad des Servers ist dort erreichbar.
- `helm template` bricht ab, wenn der Pfad nicht unter `/edu-sharing/` liegt, mit `/` endet oder der
  Host fehlt.
- Eingeschaltet setzt es `WLO_SESSION_EXCHANGE=1`; über `config` lässt sich die Variable nicht mehr
  getrennt setzen. Wer das Routing anders regelt (anderer Controller, die Ingress-Regel des Repositorys),
  nimmt `sessionIngress.createIngress: false`; dann wird nur der Tausch eingeschaltet.
- Mit eingeschalteter NetworkPolicy kommt der Controller des Repository-Hosts, falls er in einem anderen
  Namespace läuft, in `sessionIngress.controllerNamespace`.
- In der Chart-README steht: `Cookie` und `Origin` müssen durchkommen, `TRUST_PROXY` muss zur
  Proxy-Kette des Repository-Ingress passen. Weil der Pfad unverändert weitergereicht wird, braucht das
  Ingress-Objekt keine Annotation eines bestimmten Controllers.

**Zur Frage dahinter** — ihr habt recht: Die Regel funktioniert nur, wenn der MCP im Cluster des
Repositorys läuft, wie der md-editor. Der Staging-Server auf dem eigenen Rechner kann Weg B so nicht
anbieten. Ob und wann der MCP in diesen Cluster kommt, entscheidet der Betrieb mit T6; geplant ist es
bisher nicht. Wir haben es als offenen Punkt aufgenommen. Bis dahin bleibt Weg A.

## 1b. Ein alter Sitzungs-Block gilt nach einem neuen Tausch nicht wieder

Eure Lesart stimmte, und beide Fälle traten ein. Umgesetzt ist euer erster Vorschlag:

- Ein Sitzungs-Block trägt den **Zeitpunkt seiner Eintragung** (auf die Millisekunde), und beim Prüfen
  muss er dem Eintrag gleichen.
- Solange die Kennung eingetragen ist, bekommt ein weiterer Tausch (Neuladen, zweiter Tab) einen Block
  **derselben** Eintragung; beide gelten nebeneinander. Zwei Tabs, die gleichzeitig tauschen, landen in
  derselben Eintragung.
- Nach einem Widerruf oder nach den 12 Stunden trägt der nächste Tausch die Kennung **neu** ein, mit
  neuem Zeitpunkt. Die Blöcke der alten Eintragung gelten nicht wieder.

Für eure zwei Fälle heißt das: Ein in der ersten Stunde mitgenommener Block ist nach dem stillen Erneuern
nach den 12 Stunden wertlos (während der 12 Stunden gilt er weiter), und der in Tab 1 widerrufene Block bleibt widerrufen, auch wenn Tab 2 neu tauscht. Tab 2 bekommt
einen neuen Block, denn die Person ist im Repository weiter angemeldet.

Für Ticket-Blöcke (Weg A) bleibt das Verhalten von R2 (Abmelden hält bis zum nächsten Tausch desselben
Tickets), so wie am 7.11. mit euch vereinbart. Wollt ihr die Bindung dort auch, sagt Bescheid. Der Wechsel
kostet beim Einspielen einmal eine 401 für Blöcke, die bei einem späteren Neuladen ausgestellt wurden.

Die Bindung an euren Client-Schlüssel (`X-WLO-Client-Key`) haben wir notiert, nicht gebaut.

## 1c. `/auth/status` am Ende der Sitzung

- **Nach dem Abmelden im Repository** antwortet `/auth/status` mit 200, `authenticated: false`,
  `authority: null` und **`upstream: "ok"`**. Grund: Jeder Aufruf mit einem Sitzungs-Block trägt
  `DisableGuest: true`, das Repository antwortet auf eine beendete Sitzung mit 401, und ein 401 ist für
  uns eine Antwort, kein Ausfall. `upstream: "unreachable"` steht nur bei 429, 5xx oder ohne Antwort.
  Die Antwort ist bis zu 60 Sekunden alt.
- **Am Werkzeug** kommt bei beendeter Sitzung `login_rejected`, so wie ihr es aus `apps/tool-defaults.ts`
  gelesen habt.
- **`expiresAt`** steht für einen Sitzungs-Block in `/auth/status` und in `wlo_auth_status`: das Ende der
  12 Stunden als ISO-Zeit.
- **401 an `/auth/status`** heißt: Der Block selbst gilt nicht mehr (abgelaufen, widerrufen oder seit 1b
  von einer früheren Eintragung).

## Zu 2 und 3

- Euer Ablauf im Widget passt zum Server. Der Vergleich der `authority` Zeichen für Zeichen ist richtig;
  dass Konten mit ungewöhnlichen Namen dadurch ohne Anmeldung bleiben, nehmen wir mit euch hin.
- Die Kopfzeile `WLO-Access-Block` statt eines Felds im Körper ist eure Entscheidung und für uns gleich;
  am MCP kommt der Block weiter als `Authorization: Bearer` an.
- Der Hinweis, dass „im Arbeitsspeicher“ kein Schutz vor Skripten der Seite ist, steht bei uns genauso
  (`docs/AUTH.md` §5d). 1b begrenzt, wie lange ein so abgegriffener Block nützt.

## Offen

- Ob der MCP im Cluster des Repositorys laufen soll (Voraussetzung für Weg B).
- Bindung auch für Ticket-Blöcke: auf euren Wunsch.
- Bindung an den Client-Schlüssel: notiert.
