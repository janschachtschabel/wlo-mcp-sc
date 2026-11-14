# Documentation — who reads what

One line per document: the question it answers. Pick your role.

## You operate the server

| Document | Answers |
|---|---|
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | How do I run it (Docker Compose behind a proxy), which settings matter, how much memory does it need, how do I watch it, what do I back up? |
| [`STECKBRIEF.md`](STECKBRIEF.md) (German) | What is this service, in the shape a platform team expects: ports, probes, state, secrets, sizing — and what it deliberately is not? |
| [`../.env.example`](../.env.example) | Every setting the server reads, with its default and a comment. The file to copy. |
| [`AUTH.md`](AUTH.md) | How does a person sign in (access block, OAuth 2.1, ticket exchange), how do I switch it on, rotate the key, revoke access — and which decisions must not be undone? |
| [`PRIVACY.md`](PRIVACY.md) | What data does the server process, why, and for how long? A baseline for the policy an operator publishes. |
| [`../deploy/helm/wlo-mcp/README.md`](../deploy/helm/wlo-mcp/README.md) | The draft Helm chart: required values, what it leaves out on purpose, the alert rules. |

## You integrate it (a chatbot, a portal, an AI host)

| Document | Answers |
|---|---|
| [`INTEGRATION.md`](INTEGRATION.md) (German) | What is there to call — tools, addresses, sign-in — and which behaviour will surprise my integration (two-step writes, licence filter, limits)? Start here. |
| [`MCP-REFERENZ.md`](MCP-REFERENZ.md) (German) | The reference: every tool with its parameters, every error code, every setting, every status a write can end in. |
| [`TOOLS-KOMPAKT.md`](TOOLS-KOMPAKT.md) (German) | All tools on one page, one line each. |
| [`TOOLS.md`](TOOLS.md) (German) | The same tools in full, with trigger examples, the four widgets and the public REST endpoints. |
| [`openapi.yaml`](openapi.yaml) | The HTTP surface outside MCP (`/api/*`, `/auth*`, `/oauth/*`, `/health`, `/ready`, `/metrics`), machine-readable. |
| [`apps-sdk-submission-checklist.md`](apps-sdk-submission-checklist.md), [`apps-sdk-golden-prompts.md`](apps-sdk-golden-prompts.md) | What an OpenAI Apps-SDK submission needs from this server, and the prompts to test it with. |

## You change the code

| Document | Answers |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How is it put together — layers, the dependency rule, the write pipeline, caching — and which rules does a change have to respect? |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | How do I work here: tests, language, commits, dependencies, keeping the six tool tables in step (`npm run docs:tools`). |
| `CLAUDE.md` (repository root, local — not published) | The working instructions for coding agents: what binds every change, in short form. |
| [`rules/`](rules/README.md) | The binding rules by area — write support, auth, skills, search, reading collections, the chatbot contract, unsafe tools, modules — each with the measurement, date and reason behind it. Read the file of the area you are about to change. |
| [`plans/`](plans/) | The design documents and the measurements they rest on; `plans/STATUS.md` is the short current state, its history is in `plans/archive/`. |
| [`AUTH-CONCEPT.md`](AUTH-CONCEPT.md) (German) | Why the sign-in looks the way it does, and how it compares with the alternatives that were measured and rejected. |
| [`../PERFORMANCE.md`](../PERFORMANCE.md) | Where the time goes, and what was measured. |

## You curate skills (editorial team)

| Document | Answers |
|---|---|
| [`SKILLS.md`](SKILLS.md) | How do I file a skill, build a skill registry in a collection, and group it into contexts? |
| [`SKILL-TRIGGER.md`](SKILL-TRIGGER.md) (German) | What happens, step by step, when a collection carries a registry — how a skill ends up being used. |

## Which language a document is in

The rule as it is, not as a principle:

- **English:** the code, its comments, commit messages, `CHANGELOG.md`,
  `README.md`, `CONTRIBUTING.md`, and the documents for operators and developers
  in general (`ARCHITECTURE.md`, `DEPLOYMENT.md`, `AUTH.md`, `PRIVACY.md`,
  `SKILLS.md`).
- **German:** the documents written for the German-speaking teams that integrate
  or run the service (`INTEGRATION.md`, `MCP-REFERENZ.md`, `TOOLS.md`,
  `TOOLS-KOMPAKT.md`, `STECKBRIEF.md`, `AUTH-CONCEPT.md`, `SKILL-TRIGGER.md`).
  The plans in `plans/` are in either language, as they were written.
- **Both:** the README and the contribution guide exist as a pair
  (`README.de.md`, `CONTRIBUTING.de.md`, `PERFORMANCE.de.md`).
- **Tool descriptions and tool output are German** on purpose — they are read by
  the people using WLO and by the model answering them.

A document keeps its language when it is edited.
