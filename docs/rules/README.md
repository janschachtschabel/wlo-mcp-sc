# Rules by area

The binding rules of this code base, one file per area. `CLAUDE.md` holds the
short form that applies to every change; these files hold the measurements,
dates and reasons behind it. Read the file of the area you are about to change.

| File | Covers |
|---|---|
| [write-support.md](write-support.md) | curation tools, the two-step confirmation, read-backs, the write target (original vs reference), the metadata surface, full text, plans, moving/ordering/removing in collections, proposals |
| [auth.md](auth.md) | the access block, OAuth 2.1, the credential limiter and relay clients, the ticket exchange for embedded widgets |
| [skills.md](skills.md) | `search_skill` / `get_skill`, the skill registry per collection, its cache, contexts |
| [search.md](search.md) | the content search and its paging, the licence filter, the two collection indexes, vocabulary labels, compendium text |
| [collections-reading.md](collections-reading.md) | unreachable vs refused vs empty, the order of sub-collections, the flat tree list, a collection by name |
| [chatbot-contract.md](chatbot-contract.md) | the chatbot wish lists, budgets, overload codes, safe replay, status endpoints, coded errors and output schemas |
| [unsafe-tools.md](unsafe-tools.md) | `get_url_text` and the operator's switch for unsafe tools |
| [modules.md](modules.md) | module by module: what lives where and the rule each one holds |

How to read them: a dated sentence records what was measured or decided that
day. Where a later block says "superseded", the later one holds. A rule is
changed by a new measurement, written down here with its date — not by removing
the old sentence, which is the record of why the code looks the way it does.
