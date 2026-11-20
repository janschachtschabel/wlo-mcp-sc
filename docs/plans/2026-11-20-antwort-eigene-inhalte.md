# Antwort an das Chatbot-Team: eigene Inhalte löschen (2026-11-20)

Zu eurer Rückmeldung „eigene Inhalte löschen, Umwandlungs-Flow“ vom 20.11.

## 1. `wlo_delete_own_content` — gebaut

Ein eigenes Werkzeug, kein Modus von `wlo_delete_content`: So könnt ihr es nach Namen freigeben und
`wlo_delete_content` weiter ausschließen (R-E1). Der **Server** begrenzt das Löschen; geprüft wird je Knoten in
der Vorschau und noch einmal unmittelbar vor dem Löschen.

| Bedingung | sonst `code` |
|---|---|
| lesbar | `not_found` (auch schon gelöscht oder nicht lesbar) |
| ein Datensatz (`ccm:io`) — keine Sammlung, kein Ordner | `is_a_collection`, `is_a_folder`, `not_a_record` |
| keine Sammlungs-Verknüpfung | `is_reference` |
| von dieser Anmeldung angelegt (`cm:creator`) | `not_own` |
| im persönlichen Bereich — direkt oder in einem Ordner dort (etwa einer Stapel-Ablage), bis 3 Ordner tief | `not_in_home` |
| nirgends verwendet (keine Verknüpfung in eine Sammlung, kein Kurs) | `in_use` |
| nicht öffentlich | `is_public` |
| ließ sich gerade nicht prüfen | `not_checked` — der Knoten bleibt |

- **Eingabe:** `nodeIds` (1–10), `confirmToken`, `continuationToken` — wie `wlo_delete_collections`.
- **Zweistufig:** ohne Schlüssel die Vorschau mit jedem Knoten und dem, was mit ihm geschieht; ist nichts
  löschbar, kommt die Antwort ohne Schlüssel (kein Fehler).
- **Ergebnis je Knoten:** `items [{nodeId, status, code?}]` mit `status` `deleted`, `kept` (mit `code`),
  `unverified`, `failed`, `pending`. Eine verletzte Bedingung ist eine Antwort je Knoten, kein Fehler des Aufrufs.
- **Nur mit der eigenen Anmeldung** (Zugangsblock aus Passwort, Ticket oder Sitzung, oder `Basic`); das
  Dienstkonto bekommt `login_required`, auch wenn der Betrieb ihm das Schreiben erlaubt.
- **„Eigen“** heißt: `cm:creator` ist das Konto der Anmeldung. Wer sich mit einer anderen Schreibweise seines
  Kontos anmeldet als der, unter der er angelegt hat (etwa einmal mit der E-Mail-Adresse), bekommt `not_own` —
  nie ein falsches Löschen.
- Gelöschtes lässt sich nicht verlässlich wiederherstellen.

Gemessen auf Staging vor dem Bau und live getestet (eigene Wegwerf-Knoten): ein eigener Datensatz flach im
persönlichen Bereich und einer im Ordner einer Ablage wurden gelöscht; ein verknüpfter blieb `in_use`, ein fremder
`not_own`, eine Sammlung `is_a_collection`.

**Eure Bindung bleibt wichtig:** Der Server weiß nicht, welcher Knoten eine *Gliederung* war — nur, dass er der
Person gehört und unbenutzt ist. Ruft das Werkzeug also wie geplant nur für die Knoten auf, die dieser Upload als
Gliederung angelegt hat.

## 2. Umwandlungs-Flow (E15)

Richtet sich an die Flow-Autoren. Für uns hängt daran W5 `wlo_flow_file` (Ausgabedateien eines Jobs lesen): Wir
bauen es, sobald ein Flow Dateien als Ausgabe liefert. Liefert der Flow das Markdown als Text-Ausgabe, reicht
`wlo_flow_status` heute schon (`outputs`, bis 1 MB, im Text bis 20 000 Zeichen).

## 3. `node-metadata-write`

Zur Kenntnis genommen. `jobId` in `ccm:version_comment` bleibt offen.
