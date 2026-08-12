/**
 * services/write/prepared-request.ts – a write described instead of performed.
 *
 * Built for the embedded case (`boerdi-chat/docs/plans/2026-08-12-einbettung-ohne-repo-aenderung.md`,
 * package E2): the chatbot runs inside a repository page, the visitor is already
 * signed in there, and the change should be made with THEIR rights rather than a
 * shared account's. This server knows which call to make; only the page can make
 * it. So the answer to a confirmed change becomes a description of the request,
 * and the page sends it.
 *
 * The descriptor is deliberately the same knowledge the executing code would
 * otherwise have to reproduce. Endpoint quirks measured over weeks — which id a
 * removal takes, which body a create needs, which field the collection route
 * silently discards — live in `collections.ts` and `nodes.ts` and must not gain
 * a second, drifting copy in a browser bundle.
 *
 * What is NOT in here: any credential. The descriptor travels to a page that has
 * its own session; adding one of ours would hand a foreign context rights it was
 * never meant to have.
 */

/** The methods a curation step can use. Reading is not prepared — it is done here. */
export type PreparedMethod = 'POST' | 'PUT' | 'DELETE';

export interface PreparedRequest {
  method: PreparedMethod;
  /**
   * Path from the ORIGIN, e.g. `/edu-sharing/rest/collection/v1/…`, never an
   * absolute address. The executing page is same-origin with the repository and
   * prefixes its own; ours may be an internal name that means nothing there.
   */
  path: string;
  /** Serialised JSON body. Absent where the endpoint takes none. */
  body?: string;
}

/**
 * The answer to "describe this change" — which is not always a request.
 *
 * Some of these descriptors cannot be written down from the tool's arguments
 * alone. Taking material out of a collection addresses the REFERENCE node, and
 * the caller names the material; resolving one to the other takes a lookup here,
 * and that lookup has two honest ways to end without an id: the collection does
 * not hold the material, or the listing could not be read.
 *
 * Neither is an error in this server, so neither throws — but neither may become
 * a request either. A guessed path would be handed to a page that then sends it
 * with a real person's rights.
 */
export type PrepareOutcome =
  | { status: 'ready'; request: PreparedRequest }
  /** German, and shown to whoever asked for the change. */
  | { status: 'refused'; detail: string };

/**
 * Strip the origin from a repository address, refusing anything else.
 *
 * The refusal is the point. `wlo-fetch.ts` holds the rule that a credential goes
 * only to the repository host; this is its counterpart for the other direction —
 * an instruction we hand out must not send a foreign page anywhere but the
 * repository it belongs to. A caller passing something else is a bug here, not
 * user input, so it throws rather than returning a value someone might use.
 *
 * @param url          absolute address built by one of the write services
 * @param repositoryUrl the configured repository base (`WLO_REPOSITORY_URL`)
 */
export function toRepositoryPath(url: string, repositoryUrl: string): string {
  let target: URL;
  let base: URL;
  try {
    target = new URL(url);
    base = new URL(repositoryUrl);
  } catch {
    throw new Error(`A prepared request needs an absolute address, got: ${url}`);
  }

  // `origin` covers scheme, host and port in one comparison — a different port
  // or a downgrade to http is a different server, not a detail.
  const sameOrigin = target.origin === base.origin;
  // Compared segment-wise, because `/edu-sharing-evil` starts with
  // `/edu-sharing` and a prefix test would wave it through.
  const root = base.pathname.replace(/\/+$/, '');
  const inside = target.pathname === root || target.pathname.startsWith(`${root}/`);

  if (!sameOrigin || !inside) {
    throw new Error(`A prepared request may only address the repository (${base.origin}${root}), got: ${url}`);
  }
  return `${target.pathname}${target.search}`;
}
