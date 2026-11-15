# WLO Launcher Bookmarklet

*Deutsch unten — [English below](#english).*

---

## Deutsch

Ein Bookmarklet, das den auf einer beliebigen Webseite **markierten Text** nimmt
und damit den [WLO Prompt-Launcher](launcher.html) öffnet (Feld „Suchbegriff"
vorausgefüllt). So kommst du aus jedem Artikel, jeder Aufgabe oder jeder E-Mail in
einem Klick zu passenden offenen Bildungsinhalten (OER) von WirLernenOnline.

### Der Code

Ersetze `https://DEIN-WLO-HOST` durch die Adresse deiner Launcher-Instanz
(z. B. `https://wlo-mcp.example.org`) und lege den gesamten String als Lesezeichen-**URL** an:

```
javascript:(function(){var s=window.getSelection?String(window.getSelection()):'';window.open('https://DEIN-WLO-HOST/launcher.html?q='+encodeURIComponent(s.trim()),'_blank','noopener');})();
```

### Installation

1. Lesezeichenleiste einblenden (Strg/⌘ + Umschalt + B).
2. Ein neues Lesezeichen anlegen (Rechtsklick auf die Leiste → „Seite hinzufügen…"
   bzw. „Lesezeichen hinzufügen").
3. Als **Name** z. B. `WLO-Suche` eintragen.
4. Als **URL/Adresse** den obigen `javascript:`-Code einfügen (mit ersetztem Host).
5. Speichern.

### Nutzung

1. Auf einer beliebigen Seite ein Wort oder einen Satz markieren.
2. Auf das Lesezeichen `WLO-Suche` klicken.
3. Der Launcher öffnet sich in einem neuen Tab mit vorausgefülltem Suchbegriff –
   Aktion und KI-Ziel wählen, dann „In KI öffnen" oder „API testen".

Ohne Markierung öffnet das Lesezeichen den Launcher mit leerem Suchfeld.

> **Hinweis:** Manche Browser kürzen beim Einfügen das führende `javascript:` weg
> (Sicherheitsmaßnahme). Tippe das `javascript:` in dem Fall am Anfang der
> URL-Zeile von Hand nach.

---

## English

A bookmarklet that takes the **text you selected** on any web page and opens the
[WLO Prompt Launcher](launcher.html) with the "Search term" field pre-filled. From
any article, exercise, or e-mail you reach matching open educational resources
(OER) from WirLernenOnline in one click.

### The code

Replace `https://YOUR-WLO-HOST` with the address of your launcher instance
(e.g. `https://wlo-mcp.example.org`) and save the whole string as the bookmark's **URL**:

```
javascript:(function(){var s=window.getSelection?String(window.getSelection()):'';window.open('https://YOUR-WLO-HOST/launcher.html?q='+encodeURIComponent(s.trim()),'_blank','noopener');})();
```

### Install

1. Show the bookmarks bar (Ctrl/⌘ + Shift + B).
2. Create a new bookmark (right-click the bar → "Add page…" / "Add bookmark").
3. Set the **name** to e.g. `WLO Search`.
4. Set the **URL/address** to the `javascript:` code above (with the host replaced).
5. Save.

### Use

1. Select a word or sentence on any page.
2. Click the `WLO Search` bookmark.
3. The launcher opens in a new tab with the search term pre-filled — pick an
   action and AI target, then "Open in AI" or "Test API".

With nothing selected, the bookmark opens the launcher with an empty search field.

> **Note:** Some browsers strip the leading `javascript:` when you paste (a safety
> measure). If so, type `javascript:` back at the start of the URL line by hand.
