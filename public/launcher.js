/**
 * launcher.js – the prompt launcher's script, as a file.
 *
 * Served as `/launcher.js` and loaded by `launcher.html`, so that page's
 * Content-Security-Policy can say `script-src 'self'`: it shares its origin with
 * the pages a WLO password is typed on (audit 2026-11-14). No inline script goes
 * back into the page — `tests/launcher-script-file.test.ts` fails on one.
 */
// ── launcher script ──
  (function () {
    "use strict";

    var I18N = {
      de: {
        title: "WLO-Launcher", subtitle: "mit Boerdi, der WLO-Eule",
        owl_alt: "Boerdi, die WLO-Eule",
        speech: 'Hallo, ich bin <strong>Boerdi</strong>! Ich helfe dir, die Dienste von WirLernenOnline in deiner KI zu nutzen. Wähle deine KI, klick auf „Öffnen“ – und dein Chat weiß, wie er offene Bildungsinhalte findet und fertige Skills anwendet.',
        use_h: "Öffne WLO in deiner KI",
        use_lead: "Wähle deine KI. Der „Öffnen“-Button übergibt ihr die Anleitung, wie sie die WLO-Dienste selbst nutzt.",
        app_legend: "Deine KI", app_copy: "Nur kopieren",
        open: "In KI öffnen", copy: "Anleitung kopieren",
        gemini_note: "Gemini füllt das Eingabefeld nicht automatisch. Beim Öffnen wird die Anleitung in die Zwischenablage kopiert – bitte in Gemini einfügen.",
        skills_h: "Fertige Skills",
        skills_lead: "Neben der Suche liefert Boerdi fertige „Skills“ – kurze Anleitungen aus einer WirLernenOnline-Sammlung. Titel und Beschreibung sagen, was ein Skill tut und wann du ihn nutzt; das rohe Markdown wird über die Download-URL des Treffers geladen.",
        skills_url_label: "Skill-Liste (der Chat lädt hier die verfügbaren Skills):",
        skills_native: 'Hast du den WLO-MCP nativ in deiner KI eingetragen? Dann nutze das Tool <code class="inline">find_wlo_skills</code> – es findet passende Skills und liefert ihre Instruktionen direkt.',
        adv_summary: "🔍 Gezielte Suche (optional)",
        q_label: "Suchbegriff",
        q_hint: "Wird zum ersten Suchauftrag in der Anleitung – bei Claude entfällt damit das Rein-Kopieren – und dient für „RAW-Ergebnis laden“.",
        fach_label: "Fach", stufe_label: "Bildungsstufe", any: "beliebig", typ_label: "Materialtyp",
        test: "RAW-Ergebnis laden",
        preview_summary: "📋 Vorschau: Was der Chat bekommt",
        prompt_label: "Diese Nachricht bekommt der Chat",
        exampleurl_label: "Beispiel-Such-URL (RAW-JSON):", deeplink_label: "Deeplink:",
        install_h: "WLO-Dienste einrichten",
        install_lead: "Zwei Wege, wie deine KI WLO nutzt – Boerdi hilft bei beiden:",
        install_a: "<strong>Ohne Installation:</strong> diese Seite. Wähle oben deine KI und klick „Öffnen“ – fertig.",
        install_b: '<strong>Nativ (MCP):</strong> trägst du den WLO-MCP-Server in deiner KI (z. B. Claude Desktop) ein, hast du alle WLO-Tools direkt, inkl. <code class="inline">find_wlo_skills</code>.',
        mcp_url_label: "Diese Adresse trägst du in deiner KI ein:",
        mcp_copy: "Adresse kopieren",
        mcp_anon: "Ohne Anmeldung kannst du <strong>suchen und lesen</strong> – mehr braucht es für den Anfang nicht. Nur zum <strong>Anlegen und Bearbeiten</strong> von WLO-Inhalten ist ein WLO-Konto nötig.",
        mcp_auth_get: '<a href="/auth">Zugang holen</a> – wenn deine KI ein Feld für einen Schlüssel hat.',
        mcp_auth_revoke: '<a href="/auth-revoke.html">Zugang sperren</a> – per Block oder per WLO-Anmeldung, wenn du den Block nie gesehen hast.',
        mcp_copied: "Adresse in die Zwischenablage kopiert.",
        // Own key rather than the shared `copy_failed`, which sends people to
        // the preview field — that holds the instructions, not this address.
        mcp_copy_failed: "Kopieren nicht möglich – bitte die Adresse oben markieren und von Hand kopieren.",
        nav_h: "Alle Seiten dieses Servers",
        nav_home: "Startseite (diese Seite)", nav_auth: "Zugang holen", nav_revoke: "Zugang sperren",
        nav_search: "Beispiel-Suche im Browser", nav_llms: "Selbstbeschreibung für KI-Programme",
        nav_bookmarklet: "Bookmarklet",
        footer_html: 'Öffentliche, nur lesende Schnittstelle von WirLernenOnline. Schnellzugriff per <a href="bookmarklet.md">Bookmarklet</a>.',
        need_query: "Für „RAW-Ergebnis laden“ bitte einen Suchbegriff eingeben.",
        copied: "Anleitung in die Zwischenablage kopiert.",
        copied_open: "Anleitung kopiert – im Chat einfügen, falls sie nicht automatisch übernommen wird.",
        copy_failed: "Kopieren nicht möglich – bitte den Text im Vorschau-Feld manuell markieren.",
        testing: "WLO-API wird abgefragt …",
        no_hits: "Keine Treffer für „{q}“.",
        search_incomplete: "Die Suche nach „{q}“ hat nicht vollständig geantwortet — das ist kein Befund „keine Treffer“. Bitte erneut versuchen.",
        no_hits_more: "Auf dieser Seite nichts für „{q}“ — der Katalog hält mehr.",
        incomplete_suffix: " Suche unvollständig: eine Quelle hat nicht geantwortet, die Liste kann Treffer auslassen.",
        hits: "{c} Inhalte, {s} Sammlungen, {t} Themenseiten gefunden.",
        wiki_suffix: " (inkl. Wikipedia: {title})",
        test_error: "Die API konnte nicht erreicht werden ({msg}).",
        instruction_tpl:
          "Ich möchte offene Bildungsmaterialien (OER) von WirLernenOnline finden. Dafür gibt es eine öffentliche, nur lesende REST-API (Antworten sind JSON) – bitte nutze sie so: Ist der WLO-MCP nativ eingebunden, nutze bevorzugt dessen Tools. Wenn ich ein Thema nenne, rufe die Such-URL sofort mit deinem Web-/Abruf-Werkzeug auf und antworte aus den echten Treffern – schlage nicht nur Filter oder eine URL vor. Mache keinen Test- oder Probeaufruf; habe ich noch kein Thema genannt, erkläre mir kurz die Möglichkeiten (Thema, optional Fach, Bildungsstufe, Materialtyp) und frag zuerst danach. Kannst du eine URL nicht abrufen (manche Chats laden nur vom Nutzer gepostete Links), gib die fertige URL aus und bitte mich, sie in den Chat zu kopieren – danach kannst du sie laden. Liefert eine korrekt gebaute Such-URL HTTP 400, hat dein Abruf-Werkzeug vermutlich den Query-String entfernt (Schutzmechanismus mancher Chats bei selbst gebauten URLs) – behandle das genauso: URL ausgeben, ums Rein-Kopieren bitten, nicht blind wiederholen. Kannst du Endpunkte generell nicht abrufen (z. B. nur Websuche/Reader statt HTTP): versuche zuerst die URL mit ?format=html – dieselben Treffer als lesbare Webseite. Klappt auch das nicht, bitte mich als letzte Stufe, die URL im Browser zu öffnen und die JSON-Antwort in den Chat zu kopieren – werte dann dieses JSON aus.\n\n" +
          "1) Suche: GET {base}/api/search/<Suchbegriff>  (Alias: {base}/api/search?q=<Suchbegriff>)\n" +
          "   Die Pfad-Form funktioniert auch, wenn dein Werkzeug Query-Parameter entfernt – dann fehlen höchstens die Filter.\n" +
          "   URL-Muster (Beispielbegriff \"OER\" – ersetze ihn durch mein Thema): {base}/api/search/OER\n" +
          "   Optionale Parameter: ?discipline=<Fach>&educationalContext=<Stufe>&learningResourceType=<Typ>&includeWikipedia=true&includeCompendium=true\n" +
          "   → Lade die URL und werte das JSON aus (Felder: content, collections, topicPages, optional wikipedia). Prüfe: Das Feld \"query\" der Antwort muss dem Suchbegriff entsprechen, sonst behandle sie als veraltet und sag das. Fasse Treffer mit Titel, kurzer sinngemäßer Beschreibung (\"description\" kann Scraping-Reste enthalten – nicht wörtlich übernehmen) und Link (Feld \"url\") zusammen; leere \"license\" als \"Lizenz unklar\" nennen. Erfinde keine Treffer.\n\n" +
          "2) Weitere Endpunkte: {base}/api/topic-page?collectionId=<id> · {base}/api/compendium?ids=<id1,id2> · {base}/api/wikipedia?q=<Begriff>\n\n" +
          "3) Fertige Anleitungen („Skills“) aus WirLernenOnline: Liste per GET {base}/api/collection — je Treffer sagen \"title\" und \"description\", was der Skill tut und wann du ihn nutzt. Lade den rohen Markdown über das Feld \"downloadUrl\" des Treffers und wende ihn an. (Hast du den WLO-MCP nativ eingebunden, nutze stattdessen das Tool find_wlo_skills.){example}",
        example_line: "\n\n4) Meine erste Suche (im Launcher gewählt): {url} – bitte direkt abrufen und die Treffer zusammenfassen."
      },
      en: {
        title: "WLO Launcher", subtitle: "with Boerdi, the WLO owl",
        owl_alt: "Boerdi, the WLO owl",
        speech: 'Hi, I’m <strong>Boerdi</strong>! I help you use the WirLernenOnline services in your AI. Pick your AI, click “Open” – and your chat knows how to find open educational resources and apply ready-made skills.',
        use_h: "Open WLO in your AI",
        use_lead: "Pick your AI. The “Open” button hands it the instructions for using the WLO services itself.",
        app_legend: "Your AI", app_copy: "Copy only",
        open: "Open in AI", copy: "Copy instructions",
        gemini_note: "Gemini does not pre-fill the input box automatically. On open, the instructions are copied to the clipboard – please paste them into Gemini.",
        skills_h: "Ready-made skills",
        skills_lead: "Besides search, Boerdi delivers ready-made “skills” – short guides from a WirLernenOnline collection. Title and description say what a skill does and when to use it; the raw Markdown is loaded from each result’s download URL.",
        skills_url_label: "Skill list (the chat loads the available skills here):",
        skills_native: 'Registered the WLO MCP natively in your AI? Then use the <code class="inline">find_wlo_skills</code> tool – it finds matching skills and returns their instructions directly.',
        adv_summary: "🔍 Targeted search (optional)",
        q_label: "Search term",
        q_hint: "Becomes the first search task in the instructions – with Claude this skips the paste-back step – and is used for “Load raw result”.",
        fach_label: "Subject", stufe_label: "Educational level", any: "any", typ_label: "Resource type",
        test: "Load raw result",
        preview_summary: "📋 Preview: what the chat receives",
        prompt_label: "This message goes to the chat",
        exampleurl_label: "Example search URL (raw JSON):", deeplink_label: "Deep link:",
        install_h: "Set up the WLO services",
        install_lead: "Two ways your AI can use WLO – Boerdi helps with both:",
        install_a: "<strong>No install:</strong> this page. Pick your AI above and click “Open” – done.",
        install_b: '<strong>Native (MCP):</strong> register the WLO MCP server in your AI (e.g. Claude Desktop) to get all WLO tools directly, incl. <code class="inline">find_wlo_skills</code>.',
        mcp_url_label: "Enter this address in your AI app:",
        mcp_copy: "Copy address",
        mcp_anon: "Without signing in you can <strong>search and read</strong> — that is all you need to start. A WLO account is only required to <strong>create and edit</strong> WLO content.",
        mcp_auth_get: '<a href="/auth">Get access</a> — if your AI app has a field for a key.',
        mcp_auth_revoke: '<a href="/auth-revoke.html">Revoke access</a> — by block, or by WLO sign-in if you never saw the block.',
        mcp_copied: "Address copied to the clipboard.",
        mcp_copy_failed: "Could not copy – please select the address above and copy it by hand.",
        nav_h: "All pages on this server",
        nav_home: "Start page (this page)", nav_auth: "Get access", nav_revoke: "Revoke access",
        nav_search: "Example search in the browser", nav_llms: "Self-description for AI apps",
        nav_bookmarklet: "Bookmarklet",
        footer_html: 'Public, read-only interface of WirLernenOnline. Quick access via <a href="bookmarklet.md">bookmarklet</a>.',
        need_query: "For “Load raw result”, please enter a search term.",
        copied: "Instructions copied to clipboard.",
        copied_open: "Instructions copied – paste them into the chat if not filled in automatically.",
        copy_failed: "Could not copy – please select the text in the preview field manually.",
        testing: "Querying the WLO API …",
        no_hits: "No results for “{q}”.",
        search_incomplete: "The search for “{q}” did not answer in full — this is not a finding of “no results”. Please try again.",
        no_hits_more: "Nothing for “{q}” on this page — the catalogue holds more.",
        incomplete_suffix: " Search incomplete: a source did not answer, the list may be missing results.",
        hits: "{c} content, {s} collections, {t} topic pages found.",
        wiki_suffix: " (incl. Wikipedia: {title})",
        test_error: "Could not reach the API ({msg}).",
        instruction_tpl:
          "I want to find open educational resources (OER) from WirLernenOnline. There is a public, read-only REST API for this (responses are JSON) – please use it like this: If the WLO MCP is registered natively, prefer its tools. When I name a topic, call the search URL right away with your web/fetch tool and answer from the real hits – do not just suggest filters or a URL. Make no test or warm-up call; if I have not named a topic yet, briefly explain the options (topic, optionally subject, educational level, resource type) and ask for it first. If you cannot fetch a URL (some chats only load links posted by the user), output the ready-to-open URL and ask me to paste it into the chat – after that you can load it. If a correctly built search URL returns HTTP 400, your fetch tool has probably stripped the query string (a safeguard some chats apply to self-built URLs) – handle it the same way: output the URL, ask for a paste-back, do not blindly retry. If you cannot fetch endpoints at all (e.g. web search/reader only, no HTTP): first try the URL with ?format=html – the same hits as a readable web page. If that also fails, as the last resort ask me to open the URL in my browser and paste the JSON response into the chat – then evaluate that JSON.\n\n" +
          "1) Search: GET {base}/api/search/<search term>  (alias: {base}/api/search?q=<search term>)\n" +
          "   The path form also works when your tool strips query parameters – you only lose the filters.\n" +
          "   URL pattern (example term \"OER\" – replace it with my topic): {base}/api/search/OER\n" +
          "   Optional parameters: ?discipline=<subject>&educationalContext=<level>&learningResourceType=<type>&includeWikipedia=true&includeCompendium=true\n" +
          "   → Load the URL and evaluate the JSON (fields: content, collections, topicPages, optional wikipedia). Check: the response field \"query\" must match the search term, otherwise treat it as stale and say so. Summarise hits with title, a short paraphrased description (\"description\" may contain scraping noise – do not quote it verbatim) and a link (field \"url\"); report an empty \"license\" as \"licence unclear\". Do not invent hits.\n\n" +
          "2) More endpoints: {base}/api/topic-page?collectionId=<id> · {base}/api/compendium?ids=<id1,id2> · {base}/api/wikipedia?q=<term>\n\n" +
          "3) Ready-made guides (\"skills\") from WirLernenOnline: list via GET {base}/api/collection — each result’s \"title\" and \"description\" say what the skill does and when to use it. Load the raw Markdown from the result’s \"downloadUrl\" field and apply it. (If you have the WLO MCP registered natively, use the find_wlo_skills tool instead.){example}",
        example_line: "\n\n4) My first search (picked in the launcher): {url} – please fetch it right away and summarise the hits."
      }
    };

    var DEEPLINKS = {
      claude: function (text) { return "https://claude.ai/new?q=" + encodeURIComponent(text); },
      chatgpt: function (text) { return "https://chatgpt.com/?q=" + encodeURIComponent(text); },
      copilot: function (text) { return "https://copilot.microsoft.com/?q=" + encodeURIComponent(text); },
      gemini: function () { return "https://gemini.google.com/app"; }
    };

    var lang = "de";
    var $ = function (id) { return document.getElementById(id); };
    function t(key) { return (I18N[lang] && I18N[lang][key]) || I18N.de[key] || key; }
    function targetValue() {
      var el = document.querySelector('input[name="target"]:checked');
      return el ? el.value : "claude";
    }

    function base() { return location.origin; }
    function skillsUrl() { return base() + "/api/collection"; }
    /* The value someone types into their AI app's connector field. Built from
       the origin like every other URL here, so it is right on each deployment
       instead of being a literal that goes stale on the next host change. */
    function mcpUrl() { return base() + "/mcp"; }

    function exampleSearchUrl() {
      var q = $("q").value.trim();
      if (!q) return null;
      // Path form: the term survives fetch layers that strip query strings
      // from model-built URLs; filters stay optional query params.
      var params = new URLSearchParams();
      ["discipline", "educationalContext", "learningResourceType"].forEach(function (name) {
        var v = $(name).value.trim();
        if (v) params.set(name, v);
      });
      var qs = params.toString();
      return base() + "/api/search/" + encodeURIComponent(q) + (qs ? "?" + qs : "");
    }

    function instructionText() {
      var ex = exampleSearchUrl();
      var example = ex ? t("example_line").replace("{url}", ex) : "";
      return t("instruction_tpl").split("{base}").join(base()).replace("{example}", example);
    }

    function currentDeeplink() {
      var fn = DEEPLINKS[targetValue()];
      return fn ? fn(instructionText()) : "";
    }

    function refresh() {
      $("prompt").value = instructionText();
      $("skills-url").textContent = skillsUrl();
      $("mcp-url").textContent = mcpUrl();
      // The wayfinder's one dynamic link: a search someone can actually click
      // and see JSON from, rather than a path they have to assemble.
      $("nav-search").href = base() + "/api/search/Bruchrechnung";

      var ex = exampleSearchUrl();
      $("example-label").hidden = !ex;
      $("rest-url").hidden = !ex;
      $("rest-url").textContent = ex || "";

      var target = targetValue();
      var isCopy = target === "copy";
      $("gemini-note").hidden = target !== "gemini";

      var open = $("open");
      if (isCopy) {
        open.hidden = true;
        $("deeplink-label").hidden = true;
        $("deeplink").hidden = true;
      } else {
        open.hidden = false;
        open.setAttribute("href", currentDeeplink());
        $("deeplink-label").hidden = false;
        $("deeplink").hidden = false;
        $("deeplink").textContent = currentDeeplink();
      }
      $("test").disabled = !ex;
    }

    function setStatus(node, msg, kind, busy) {
      var s = $(node);
      s.className = "status" + (kind ? " " + kind : "");
      s.textContent = "";
      if (busy) { var sp = document.createElement("span"); sp.className = "spin"; sp.setAttribute("aria-hidden", "true"); s.appendChild(sp); s.appendChild(document.createTextNode(" ")); }
      s.appendChild(document.createTextNode(msg));
    }

    /**
     * Put `text` on the clipboard. Resolves only if it actually got there.
     *
     * The fallback exists because the Clipboard API needs a secure context.
     * It used to select `#prompt` regardless of what it was asked to copy,
     * which was invisible while the instructions were the only thing copied
     * and wrong the moment a second caller passed the MCP address — worse,
     * `#prompt` sits inside a collapsed <details> and cannot be focused, so
     * nothing was copied at all while the page said it had been. Hence the
     * throwaway field, and hence checking the return value: `execCommand`
     * reports a refusal by returning false rather than throwing.
     */
    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      }
      return new Promise(function (resolve, reject) {
        var scratch = document.createElement("textarea");
        scratch.value = text;
        scratch.setAttribute("readonly", "");
        scratch.setAttribute("aria-hidden", "true");
        scratch.tabIndex = -1;
        // Off-screen rather than hidden: display:none and visibility:hidden
        // are not selectable, and a visible field would flash on screen.
        scratch.style.position = "fixed";
        scratch.style.top = "-1000px";
        document.body.appendChild(scratch);
        try {
          scratch.select();
          if (document.execCommand("copy")) resolve();
          else reject(new Error("clipboard write refused"));
        } catch (e) {
          reject(e);
        } finally {
          document.body.removeChild(scratch);
        }
      });
    }

    function copyInstructions() {
      copyText(instructionText()).then(
        function () { setStatus("status", t("copied"), "ok"); },
        function () { setStatus("status", t("copy_failed"), "error"); }
      );
    }

    function openTarget() {
      copyText(instructionText()).then(
        function () { setStatus("status", t("copied_open"), "ok"); },
        function () { /* navigation still proceeds; clipboard is best-effort */ }
      );
    }

    function loadRaw() {
      var url = exampleSearchUrl();
      if (!url) { setStatus("adv-status", t("need_query"), "error"); return; }
      setStatus("adv-status", t("testing"), null, true);
      $("results").hidden = true; $("results").textContent = "";
      fetch(url, { headers: { Accept: "application/json" } })
        .then(function (resp) { if (!resp.ok) throw new Error("HTTP " + resp.status); return resp.json(); })
        .then(function (data) { renderRaw(data, $("q").value.trim()); })
        .catch(function (err) { setStatus("adv-status", t("test_error").replace("{msg}", String(err.message || err)), "error"); });
    }

    function bucketCount(b) { return b && typeof b.count === "number" ? b.count : 0; }

    // Scheme guard for untrusted result URLs (publisher-supplied ccm:wwwurl):
    // return the URL only when it is http(s)/mailto, else "" (no link) — mirrors
    // the widgets' safe-url.ts so a javascript:/data: value can't become a
    // click-to-execute href. The launcher is self-contained and cannot import it.
    // Covered by tests/launcher-safe-url.test.ts (extracts + exercises this fn).
    function safeUrl(u) {
      var s = (u == null ? "" : String(u)).trim();
      if (!s) return "";
      try {
        return /^(https?|mailto):$/.test(new URL(s, "https://wlo.invalid").protocol) ? s : "";
      } catch (_e) { return ""; }
    }

    // "No results" is a statement about the catalogue. An envelope says two
    // things that make it false: a bucket whose source did not answer
    // (`incomplete`) and a page that is exhausted while the catalogue is not
    // (`more`). The outage comes first — it is the one a retry can change.
    function emptyStatusKey(data) {
      var buckets = [data.content, data.collections, data.topicPages];
      if (buckets.some(function (b) { return b && b.incomplete; })) return "search_incomplete";
      if (buckets.some(function (b) { return b && b.more; })) return "no_hits_more";
      return "no_hits";
    }

    function renderRaw(data, q) {
      var c = bucketCount(data.content), s = bucketCount(data.collections), tp = bucketCount(data.topicPages);
      if (c + s + tp === 0 && !data.wikipedia) {
        var key = emptyStatusKey(data);
        setStatus("adv-status", t(key).replace("{q}", q), key === "search_incomplete" ? "error" : null);
        return;
      }
      var msg = t("hits").replace("{c}", c).replace("{s}", s).replace("{t}", tp);
      if (data.wikipedia && data.wikipedia.title) msg += t("wiki_suffix").replace("{title}", data.wikipedia.title);
      // With hits shown too: the counts are real, and not the whole answer.
      if (emptyStatusKey(data) === "search_incomplete") msg += t("incomplete_suffix");
      setStatus("adv-status", msg, "ok");
      var list = $("results"); list.textContent = "";
      var items = (data.content && data.content.results) || [];
      items.slice(0, 5).forEach(function (n) {
        var li = document.createElement("li");
        var safe = safeUrl(n.url);
        if (safe) {
          var a = document.createElement("a");
          a.href = safe; a.target = "_blank"; a.rel = "noopener noreferrer";
          a.textContent = n.title || n.nodeId;
          li.appendChild(a);
        } else { li.textContent = n.title || n.nodeId; }
        list.appendChild(li);
      });
      list.hidden = items.length === 0;
    }

    function applyLang(next) {
      lang = next;
      document.documentElement.lang = next;
      $("lang-de").setAttribute("aria-pressed", String(next === "de"));
      $("lang-en").setAttribute("aria-pressed", String(next === "en"));
      document.querySelectorAll("[data-i18n]").forEach(function (el) {
        var key = el.getAttribute("data-i18n");
        var val = I18N[next][key];
        if (val == null) return;
        // Entries that carry inline markup (strong/code/a) render as HTML; the
        // strings are static, author-controlled constants — no user input.
        if (/[<][a-z]/i.test(val)) el.innerHTML = val; else el.textContent = val;
      });
      refresh();
    }

    document.getElementById("launcher").addEventListener("input", refresh);
    document.getElementById("launcher").addEventListener("change", refresh);
    document.getElementById("apps").addEventListener("change", refresh);
    $("copy").addEventListener("click", copyInstructions);
    $("copy-mcp").addEventListener("click", function () {
      copyText(mcpUrl()).then(
        function () { setStatus("mcp-status", t("mcp_copied"), "ok"); },
        // Same honesty as the instruction copy: clipboard access can be denied,
        // and the address stays selectable on screen either way.
        function () { setStatus("mcp-status", t("mcp_copy_failed"), "error"); }
      );
    });
    $("open").addEventListener("click", openTarget);
    $("test").addEventListener("click", loadRaw);
    $("lang-de").addEventListener("click", function () { applyLang("de"); });
    $("lang-en").addEventListener("click", function () { applyLang("en"); });

    // Prefill from ?q= (bookmarklet integration) → open the search panel.
    try {
      var pre = new URLSearchParams(location.search).get("q");
      if (pre) { $("q").value = pre; $("adv").open = true; }
    } catch (_e) { /* ignore malformed query string */ }

    refresh();
  })();
