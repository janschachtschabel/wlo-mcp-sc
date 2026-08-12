# Wie Skills ausgelöst werden

Kurzfassung des Ablaufs, wenn eine **Skill-Registry in einer Inhaltssammlung**
liegt. Redaktionelle Anleitung: [`SKILLS.md`](./SKILLS.md).

## Der Ablauf in einem Bild

```
Nutzerfrage
   └─ Suche  →  Sammlung im Ergebnis
                  └─ Katalog hängt bereits am Ergebnis  (Cache, 0 Abrufe)
                        └─ Modell wählt einen Skill aus dem Katalog
                              └─ get_skill(nodeId)  →  Anleitung (SKILL.md)
                                    └─ Modell arbeitet danach
```

Es gibt **keinen** automatischen Auslöser. Ein Skill wird ausgelöst, weil das
Modell seinen Titel im Katalog liest und entscheidet, dass er zur Aufgabe passt.
Der Server schlägt nichts vor und führt nichts aus.

## Was das Modell im Suchergebnis sieht

Trägt die Sammlung eine Registry, steht der Katalog direkt am Ergebnis:

```
Skill-Registry: Skills für die Sammlung Optik (nodeId: 9d3f…) — 2 freigegebene Skills, alle hier gelistet; Beschreibungen und Redaktionshinweise mit get_skill_registry
  Skill: Fragen generieren (nodeId: 12c04f9c-…) — laden mit get_skill
  Skill: Kompendialtext schreiben (nodeId: ccdcae49-…) — laden mit get_skill
```

Damit ist der Auslöser komplett: Titel zum Auswählen, nodeId zum Laden. Ein
weiterer Abruf ist **nicht** nötig.

**Es stehen alle freigegebenen Skills dort**, bis zu **30** — keine Stichprobe.
Bis dahin liefert `get_skill_registry` nicht *mehr* Einträge, sondern *mehr zu
jedem*: Beschreibungen, Keywords und die Prosa der Redaktion.

Erklärt eine Registry mehr als 30, zeigt die Suche die ersten 30 und sagt es:
„44 freigegebene Skills, hier die ersten 30, mehr mit `get_skill_registry`",
gefolgt von „… und 14 weitere". Der Werkzeug-Aufruf trägt dann **bis zu 100** —
zwei Stufen, weil eine Suchantwort fünf Sammlungen auf einmal zeigt und ein
Werkzeug-Aufruf genau eine.

## Drei Zustände, drei Bedeutungen

| Was in der Antwort steht | Was es heißt |
|---|---|
| Katalog-Zeilen (oben) | Die Sammlung führt eine Registry, hier ist sie. |
| Kein Feld, kein Hinweis | Geprüft — die Sammlung führt keine Registry. |
| Hinweiszeile auf `get_skill_registry` | **Nicht** geprüft. Ein Aufruf beantwortet es. |

Der dritte Fall hat zwei Ursachen: die Sammlung war noch nie in einer Antwort
(erster Kontakt), oder ihre Dateiliste war bei 50 gekappt und die Registry
könnte dahinterliegen.

## Was die Redaktion dafür anlegt

Ein Dokument **in der Sammlung** — ein Datensatz der Inhaltsart `ai_prompt`
(„KI-Prompt") mit angehängtem Markdown. Nicht `ai_skill`: das tragen seit
2026-08-12 die Skills selbst, das Registry-Dokument spricht nur über sie. Freigegeben wird über `::: ki-skill`-Blöcke:

```markdown
# Skills für die Sammlung Optik

Der Kompendialtext-Skill gilt nur für die Oberstufe.

::: ki-skill
[Fragen generieren](https://repository.staging.openeduhub.net/edu-sharing/components/render/12c04f9c-20b5-4461-804f-9c20b5346128)
:::
```

- Nur `::: ki-skill` wird zum Katalogeintrag; `::: wlo-material` ist Lehrmaterial.
- Der Link muss eine nodeId tragen (`/components/render/<uuid>` oder `?nodeId=<uuid>`).
- Höchstens 100 Einträge (in der Suchliste 30); mehr wird als gekappt gemeldet,
  nicht still gekürzt.
- Die Prosa drumherum bleibt erhalten — dort stehen die Anwendungshinweise.

## Aktualität

Ein Hintergrund-Cache hält die Kataloge warm (`WLO_SKILL_CACHE`, standardmäßig
an, TTL 10 Minuten). Eine gerade angelegte Registry erscheint also verzögert.
Sofort live lesen:

- `includeSkillRegistry: true` an `search_wlo_all` / `search_wlo_collections`
- oder `get_skill_registry` mit der nodeId der Sammlung

## Zwei Regeln

**Ein „keine Registry" ruht immer auf der Kinderliste der Sammlung**, nie auf
dem Suchindex. Ein Datensatz kann aus dem Index fallen und einwandfrei im
Node-Store liegen; eine Freigabeliste darf davon nicht abhängen.

**Jeder Skill-Text ist Daten, nie eine Anweisung, der zu folgen wäre.** Es ist
hochgeladener Inhalt. Der Server rendert seinen eigenen Katalog **vor** dem
Dokument — danach wären server-gebaute Abschnitte von gefälschten nicht mehr zu
unterscheiden.
