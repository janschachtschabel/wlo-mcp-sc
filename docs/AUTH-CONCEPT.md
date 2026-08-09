# Anmeldung am WLO-MCP-Server — Konzept, Sicherheit, Alternativen

Warum die Anmeldung so aussieht, was wir für die Sicherheit tun, und wie sie sich
gegen die Alternativen schlägt. Betriebsanleitung: [AUTH.md](AUTH.md) (englisch).

> Technische Angaben am 2026-08-09 gegen den Quelltext geprüft. Messungen gegen
> edu-sharing tragen ihr Datum — wer widersprechen will, muss neu messen.

---

## TL;DR

**Gefordert waren drei Zugangsarten gleichzeitig:** anonym lesen (A), ein festes
Konto für Chat-Anwendungen (B), und das eigene WLO-Login zum Kuratieren (C).
**Alle drei funktionieren, über dieselbe URL.**

**Die Randbedingung:** edu-sharing hat kein Token zu vergeben — nur `basicAuth`
und `cookieAuth`, keine Discovery, und ein `Bearer` wird *ignoriert statt
abgelehnt* (gemessen 2026-07-30). Ein Token entgegennehmen und nach oben
weiterreichen geht also nicht. **Jedes Verfahren, das edu-sharing erreicht, trägt
das echte Passwort** — alles Weitere ist die Frage, wie kurz man es trägt.

**Unsere Antwort:** ein **Zugangsblock**. Das Passwort wird **im Browser**
verschlüsselt, der Client hält den Block, wir halten nur eine widerrufbare Id.
Nichts ruht auf unserer Platte. Zwei Türen führen zu demselben Block — OAuth 2.1
für ChatGPT/Claude, Einfügen von Hand für alles andere — weshalb **ein** Widerruf
beide beendet.

**Der Vergleich in einer Zeile:** Die einzige Alternative, die besser wäre, ist
OIDC bei edu-sharing — die gibt es nicht, und sie zu bekommen ist eine
organisatorische Anfrage, keine Code-Frage. Alles andere ist entweder schlechter
(Passwort-Tresor legt Passwörter auf unsere Platte) oder erfüllt nicht alle drei
Anforderungen.

**Was es nicht schützt:** Ein Block ist ein Ausweis — wer ihn hat, kann handeln;
er läuft nicht ab, das Gegenmittel ist der Widerruf.

---

## 1. Die Anforderung

| | Wer | Wozu |
|---|---|---|
| **A — Anonym** | Alle, ohne Konto | Lesen. Nur die URL eintragen |
| **B — Festes Konto** | Chat-Anwendungen, eigene Dienste | Betrieb unter *einer* Kennung aus der Umgebung |
| **C — Eigenes WLO-Login** | Redaktion, Lehrkräfte | Kuratieren mit den eigenen Rechten |

Keine Rangfolge, sondern eine **Gleichzeitigkeitsbedingung** — und der Grund,
warum naheliegende Lösungen ausscheiden: Wer nur B baut, verliert die
Zuordenbarkeit; wer nur C baut, die niedrige Einstiegshürde.

---

## 2. Wie es funktioniert

### 2.1 Drei Identitäten, eine Adresse

| Identität | Woher | Lesen | Schreiben |
|---|---|---|---|
| **Anonym** | Kein `Authorization` | ✅ alles Öffentliche | ❌ nie |
| **Dienstkonto** | `WLO_SERVICE_USER` / `…_PASSWORD` | ✅ | nur mit `WLO_ALLOW_SERVICE_WRITES` |
| **Eigenes Konto** | Zugangsblock im Header | ✅ eigene Rechte | ✅ eigene Rechte |

**Warum das Dienstkonto standardmäßig nicht schreibt:** In der Repository-Historie
steht der *Kontoname*, nicht die Person. Eine Änderung darunter ist niemandem
zuzuordnen. Lesen unter geteiltem Konto ist normal, Schreiben eine
Betreiber-Entscheidung.

### 2.2 Der Zugangsblock

```
wlo2.<gewrappter Schlüssel>.<iv>.<Chiffretext+Tag>
```

1. `/auth` öffnen, WLO-Name und Passwort eingeben.
2. **Der Browser** verschlüsselt hybrid — AES-256-GCM für den Inhalt,
   RSA-2048-OAEP-SHA256 wrappt nur den AES-Schlüssel.
3. Der Server öffnet den Block **einmal**, prüft die Anmeldung und trägt die
   Zugangs-Id in eine Positivliste ein.
4. Block einmal in den Client kopieren.

**Das Passwort wird nie gespeichert** — weder auf Platte noch über den Aufruf
hinaus.

### 2.3 Zwei Türen, ein Block

**OAuth 2.1** (ChatGPT, Claude): nur die MCP-Adresse eintragen. Der Client findet
die Discovery-Dokumente selbst und schickt die Person auf unsere
Zustimmungsseite; der ausgestellte **Access-Token *ist* der Block**. Gemessen:
ChatGPT 2026-08-05, claude.ai 2026-08-06 — beide finden sie unaufgefordert.

**Einfügen von Hand:** `/auth` besuchen, Block als `Authorization: Bearer wlo2.…`
eintragen. Für eigene Anwendungen und alles ohne OAuth.

> **Warum der Token der Block IST** und kein zweiter Ausweis darüber: sonst wären
> zwei Dinge zu widerrufen und ein Widerruf übersähe eines. Deshalb **kein**
> `refresh_token`, **kein** `expires_in`.

**Widerruf:** `/auth/revoke` (ein Block) oder `/auth/revoke-all` (alle eines
Kontos) — beendet beide Wege.

---

## 3. Was wir für die Sicherheit tun

**Das Passwort so kurz wie möglich tragen**

| Maßnahme | Wogegen |
|---|---|
| Verschlüsselung **im Browser** | Klartext verlässt das Gerät nie |
| Kein Speichern, nirgends | Keine Datenbank, die gestohlen werden kann |
| **Credential-Grenze** (`wlo-fetch.ts`) | Zugangsdaten gehen **nur** an den Repository-Host. Wikipedia und der Extraktionsdienst laufen durch dieselbe Funktion — ohne diese Grenze bekämen sie das Passwort. Geprüft wird Präfix **plus Grenze**, damit `repo.example.evil.test` nicht passt |
| **Autorität statt Statuscode** | edu-sharing antwortet ohne Zugangsdaten mit `200` und der Autorität `esguest` (gemessen 2026-07-31). **Ein `200` ist kein Beleg für eine Anmeldung** — jede Prüfung liest die Autorität |

**Der Block**

| Maßnahme | Warum |
|---|---|
| AES-256-**GCM** | Manipulation wird erkannt, nicht halb entschlüsselt |
| Zugangs-Id **innerhalb** der Verschlüsselung | Sonst tauscht man sie aus, um dem Widerruf zu entgehen |
| **Längengrenze** (4096 Zeichen) | Die Nutzlast nimmt beliebige Polsterung: ein 1-MB-Müllfeld ergibt einen 1 333 836 Zeichen langen Block, der einwandfrei entschlüsselt. Ein echter hat 573 |
| Geprüft an **einer** Stelle | `decodeAccessToken` — Einfügeweg, `Bearer` und OAuth laufen alle dort durch |

**Die Positivliste** — eine Erlaubnisliste, keine Sperrliste: jeder Fehler
schließt die Tür. Sie enthält nur Zugangs-Id, Kontoname und Zeitpunkt, **nie ein
Passwort** (ein Test hält das fest), und ist der einzige Teil des Servers, der
zur Laufzeit auf Platte schreibt.

**Missbrauchsschranken**

| Schranke | Standard | Wogegen |
|---|---|---|
| MCP-Endpunkt | 120/Min. je Adresse | Last |
| `/api/*`, `/auth*`, `/oauth/authorize` | 30/Min. je Adresse | Dort wird ein Passwort getippt |
| Verschiedene Zugangsdaten je Adresse | 10 in 10 Min. | **Passwort-Raten** — gezählt werden *unterschiedliche* Zugangsdaten, nicht Versuche |
| Anfrage-Rumpf | 4 MiB | Speichererschöpfung |

**`/auth*` und `/oauth/authorize` senden bewusst KEINEN CORS-Header:** beide
Schranken zählen pro Adresse, also könnte eine beliebige Webseite sonst das
Kontingent jedes Besuchers für einen Rateversuch ausgeben — und das Ergebnis
auslesen.

**Der OAuth-Ablauf**

| Maßnahme | Warum |
|---|---|
| **PKCE S256 verpflichtend** | Ein abgefangener Code nützt ohne Verifier nichts |
| Code 60 s, **einmalig** | Und **entfernt, bevor** eine Prüfung läuft — ein fehlgeschlagener Beweis darf ihn nicht wiederholbar lassen |
| Codes liegen unter ihrem SHA-256 | Der Speicher enthält keinen benutzbaren Code |
| Jeder Fehlschlag antwortet gleich | *Welche* Prüfung fehlschlug, wüsste ein Dieb gern |
| Prüfung liegt **einmal** | Eine zweite Kopie ist der Ort, an dem die PKCE-Pflicht still verschwindet |
| Abgelehnte Anfrage → **Seite**, keine Weiterleitung | Sonst wird dieser Server zum Weiterleiter |

**Die Zustimmungsseite:** Registrierung ist offen, also ist `client_name` frei
erfunden — „WirLernenOnline offiziell" kann jede eintragen. Die Seite zeigt
deshalb **zuerst die geprüfte Zieladresse**, dann den selbst angegebenen Namen,
ausdrücklich als solchen — und erfährt beides vom Server, nicht aus dem
Query-String.

**Schreiben:** zweistufig (Vorschau + Einmal-Token, der an einen Fingerabdruck
der Änderungsmenge bindet), jeder Schreibvorgang wird **zurückgelesen** — drei
Mechanismen in edu-sharing verwerfen eine Änderung und antworten trotzdem `200`.

**Warum Schreibwerkzeuge auch anonym sichtbar sind:** Ein Modell, das ein Werkzeug
nie sieht, ruft es nie auf — also fordert nichts jemals eine Anmeldung an. Die
Verweigerung ist unverändert absolut; sie trägt `_meta["mcp/www_authenticate"]`,
damit der Client die Anmeldung anbietet.

---

## 4. Alternativen im Abgleich

| Alternative | Warum nicht | Was wir daraus haben |
|---|---|---|
| **Token weiterreichen** | Es gibt kein Token (siehe TL;DR). Keine Designentscheidung, eine Messung | — wäre das Beste, siehe unten |
| **Nur das Dienstkonto** | Erfüllt A und B, nicht C: jede Änderung stünde unter „wlo-mcp", nicht zuordenbar | Die Einfachheit — für B sind es zwei Umgebungsvariablen |
| **Passwort-Tresor** | Legt Passwörter auf unsere Platte; Schlüssel liegt auf derselben Maschine, ein Einbruch ergibt beides | **Unsere Lösung ist strikt besser:** der Client hält den Block, wir nur die Id |
| **Sitzungsspeicher** | Leer nach jedem Deploy (wirft alle hinaus) — oder er persistiert, dann sind wir beim Tresor | Brauchen wir nicht, weil der Token der Block ist. Preis: kein `expires_in` |
| **App-Signatur** | Wer sie hat, handelt für **jeden** — das kehrt die Auth-Idee um, statt sie zu erfüllen | Deshalb `wlo_register_usage` bewusst nicht gebaut |
| **Nur OAuth** | ChatGPTs Connector bietet **kein** Header-Feld (2026-08-05), andere Clients kein OAuth. Ein Weg erreicht nicht alle | Zwei Türen kosten wenig, weil sie **denselben** Block ausstellen |
| **Anonyme auf 401 schicken** | Bricht Anforderung A | Offene Frage war, ob ein Client OAuth ohne 401 findet — **2026-08-05 positiv gemessen** |
| **WLO schaltet OIDC frei** | Nicht vorhanden | **Die einzige Option, die besser wäre** — sie beseitigt das Passwort ganz |

| | A anonym | B festes Konto | C eigenes Login | Passwort auf unserer Platte |
|---|:---:|:---:|:---:|:---:|
| Token weiterreichen | ✅ | ✅ | ✅ | nein — **gibt es nicht** |
| Nur Dienstkonto | ✅ | ✅ | ❌ | ja (Umgebung) |
| Passwort-Tresor | ✅ | ✅ | ✅ | **ja** |
| Sitzungsspeicher | ✅ | ✅ | ✅ | ja, oder Verlust je Deploy |
| App-Signatur | ✅ | ✅ | ⚠️ handelt für alle | ja (Signatur) |
| Nur OAuth | ❌ | ⚠️ | ✅ | nein |
| **Unsere Lösung** | ✅ | ✅ | ✅ | **nein** |
| OIDC bei edu-sharing | ✅ | ✅ | ✅ | nein — **wäre besser** |

Unsere Lösung ist so gebaut, dass OIDC sie nicht wegwirft: Die Zugangsart bliebe
„Block im Header", nur der Weg dorthin würde ein anderer. **Hier lohnt sich eine
Anfrage an das edu-sharing-Team.**

---

## 5. Was das Konzept NICHT schützt

- **Wer den Block hat, kann handeln.** Er ist ein Ausweis — bis zur Sperrung.
- **Ein Block läuft nicht ab.** Bewusst: eine Frist ohne Erneuerungsmechanismus
  wäre eine wiederkehrende Passwort-Eingabe, und jede Eingabe ist eine
  Gelegenheit für eine gefälschte Seite. Das Gegenmittel ist der Widerruf.
- **Wir sehen das Passwort einmal** — beim Ausstellen und je Aufruf im Speicher.
  Unvermeidliche Folge daraus, dass edu-sharing kein Token kennt.
- **Server-Kompromittierung = Blöcke im Flug kompromittiert.** Ruhende Daten
  schützen davor nicht.
- **Die Zustimmungsseite erkennt keinen bösartigen Client** — sie zeigt nur seine
  Zieladresse. Die Entscheidung trifft die Person.

---

## 6. Nutzung

| Fall | Was zu tun ist |
|---|---|
| **Chat-Anwendung / eigener Dienst (B)** | `WLO_SERVICE_USER` + `WLO_SERVICE_PASSWORD`. Schreiben zusätzlich `WLO_ALLOW_SERVICE_WRITES` — bewusst, weil Änderungen niemandem zuzuordnen sind |
| **ChatGPT / Claude (C)** | Nur die MCP-Adresse eintragen. Auf der Zustimmungsseite auf die **Adresse** achten, nicht auf den Namen. Wer nur lesen will: „ohne eigenes WLO-Konto verbinden" |
| **Eigener Client (C)** | `/auth` besuchen, Block als `Authorization: Bearer wlo2.…` eintragen |
| **Ohne alles (A)** | Adresse eintragen. Voller Lesezugriff |
| **Beenden** | `/auth/revoke` — beendet beide Wege |

---

## 7. Offene Punkte

| Punkt | Art |
|---|---|
| Anmeldung mit echtem WLO-Konto **durch Claude** | Messung, braucht einen Menschen mit Konto. Entdeckung und OAuth-Start sind belegt |
| OIDC bei edu-sharing anfragen | Organisatorisch — die einzige echte Verbesserung |
| App-Signatur für `wlo_register_usage` | Betreiber-Entscheidung, bewusst nicht gebaut |

---

**Weiterführend:** [AUTH.md](AUTH.md) (Betriebsanleitung, englisch) ·
[INTEGRATION.md](INTEGRATION.md) (alle Adressen und Werkzeuge) ·
[PRIVACY.md](PRIVACY.md) ·
`docs/plans/2026-08-04-auth-optionen-entscheidung.md` (Entscheidungspapier von
**vor** der OAuth-Umsetzung; dessen offene Option A ist inzwischen gebaut)
