/**
 * apps/instructions.ts – The MCP server `instructions` block: cross-tool
 * guidance the model reads once (advertised at initialize). The first
 * paragraph is self-contained (the token-efficient fast path) so it stays
 * useful even if a host truncates. Model-facing → English.
 */

// Fast path first — a host may truncate, and each tool's own description carries
// its detail. Model-facing → English, except the German trigger words, which are
// the point: they are quoted as the user would type them.
//
// The NAMES line is not decoration. Users call this repository WirLernenOnline,
// WLO, edu-sharing or openeduhub interchangeably, and until 2026-08-06 only one
// of those appeared anywhere in the surface — so "leg das bei WirLernenOnline
// an" matched nothing. One line here beats repeating the aliases in thirteen
// write-tool descriptions. Pinned by `tests/tool-descriptions.test.ts`.
export const WLO_SERVER_INSTRUCTIONS = `WirLernenOnline (WLO) — also called edu-sharing or openeduhub — is a curated index of German teaching material (OER). All four names mean this server, and it can both READ and, with a login, CHANGE records: search and browse, read a material's own text, and create/edit/file/delete records and collections (the wlo_* tools; each previews first and writes only on a second, confirmed call).

Anything a teacher asks for in everyday words belongs here, not in a web search: "ein Video zu Bruchrechnung", "Medien zum Klimawandel", "ein Arbeitsblatt", "Material für Klasse 7", "eine Unterrichtsstunde zu …". Call search_wlo_all ONCE — materials, collections and topic pages together — and name the medium as a filter rather than picking another tool. Put only the TOPIC in "query": the repository ANDs every word, so "Unterrichtsstunde zur Französischen Revolution" finds nothing where "Französische Revolution" finds 480. Medium, level and subject belong in learningResourceType / educationalContext / discipline. Enrich in the SAME call (includeWikipedia / includeCompendium / includeTopicPageContent / includeTextContent).
Asked for ONE material's own text — summarize, simplify, build exercises? get_wlo_content_text with its nodeId; one already in the conversation is enough.
Working with a COLLECTION? Its editors may declare which skills (prepared work instructions) apply to it. get_skill_registry with the collection's nodeId answers that; search_skill finds skills independently of any collection. Neither is looked up automatically — ask when the task is about how to work with a collection, not merely what is in it.

ALWAYS carry a result's URL and nodeId into your answer, written out and linked. They are in every record; a user cannot open or cite what you paraphrase away.`;
