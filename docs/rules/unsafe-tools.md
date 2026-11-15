# `get_url_text` and the unsafe-tool switch

Binding rules for this area, moved verbatim out of `CLAUDE.md` on 2026-11-14 (the file had grown to 2154 lines).
A dated sentence records what was measured or decided that day; where a later block says "superseded", the later one holds.
Index: [README.md](README.md) · short rules: [`CLAUDE.md`](../../CLAUDE.md).

- **URL-based full-text tool + generic unsafe-tool switch — IMPLEMENTED
  (2026-08-03; P0–P4 done, see the tasks file's progress table):**
  - Design: `docs/plans/2026-08-03-url-text-tool-design.md`
  - Tasks:  `docs/plans/2026-08-03-url-text-tool-tasks.md` (16 tasks, 5 phases)

  Adds ONE read tool, `get_url_text` (arbitrary URL → text via the extraction
  service), and a generic mechanism by which a tool declares itself `unsafe` and
  the operator switches it off with `WLO_DISABLE_UNSAFE_TOOLS`. Unsafe tools are
  registered BY DEFAULT, so a startup warning naming each one is part of the
  design. The tool is documented as **not for production**: we never fetch the
  target ourselves — Playwright inside the extraction service does — so a
  redirect to a private address, or a DNS answer that changes between our lookup
  and the service's, cannot be seen at this layer. Closing that needs
  resolution-time enforcement inside the fetching service. What IS enforced
  (`src/url-safety.ts`): the literal host check — including IPv4-mapped IPv6,
  a hole found and closed 2026-08-03 that was live on the existing `ccm:wwwurl`
  path — plus a check of the RESOLVED addresses, which catches a public name
  whose record points inside. Decimal/hex IPv4 literals need no handling:
  `new URL()` normalises them to dotted quad first (measured). Feeding extracted
  text into the curation path is explicitly out of scope.
