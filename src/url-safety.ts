/**
 * url-safety.ts – Is this URL safe to hand to a service that will fetch it?
 *
 * The question is not "is this a valid URL" but "does asking a fetching service
 * for it turn that service into a probe for the network it sits in". It has its
 * own module because two callers ask it with very different inputs: the curated
 * `ccm:wwwurl` fallback in `services/content-text.ts`, where the URL comes from
 * a curator, and (planned) the `get_url_text` tool, where it comes from whoever
 * is talking to the model.
 *
 * What this CANNOT decide, deliberately: we never fetch the target ourselves —
 * the extraction service does, with Playwright, in its own process. A URL that
 * passes here and then REDIRECTS to a private address, or whose DNS answer
 * changes between our lookup and the service's, is invisible at this layer.
 * Closing that needs resolution-time enforcement inside the fetching service.
 */

import { lookup as dnsLookup } from 'node:dns/promises';

/** One DNS answer, narrowed to the part that matters here. */
type ResolvedAddress = { address: string };

/**
 * Rewrite an IPv4-mapped IPv6 address to the IPv4 it carries; anything else is
 * returned unchanged.
 *
 * Both spellings occur and neither is optional. `new URL()` normalises
 * `http://[::ffff:127.0.0.1]/` to hostname `[::ffff:7f00:1]`, so the dotted
 * quad is already gone before any check runs (measured 2026-08-03) — while
 * `dns.lookup` hands back the dotted form. Judging only the prefix would be
 * wrong in the other direction: `::ffff:808:808` is 8.8.8.8 and public.
 */
function unwrapMappedIpv4(host: string): string {
  const rest = /^::ffff:(.+)$/.exec(host)?.[1];
  if (!rest) return host;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rest)) return rest;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
  if (!hex) return host;
  // Built with arithmetic rather than shifts: `0xffff << 16` is negative in
  // JavaScript's 32-bit signed bitwise domain.
  const n = parseInt(hex[1]!, 16) * 65536 + parseInt(hex[2]!, 16);
  return [
    Math.floor(n / 16777216) % 256,
    Math.floor(n / 65536) % 256,
    Math.floor(n / 256) % 256,
    n % 256,
  ].join('.');
}

/**
 * Reject a hostname that points into a private network.
 *
 * Note the limitation this check has ON ITS OWN: it looks at the literal host,
 * so a public name that RESOLVES to a private address still passes. That is
 * narrow while the input is a curated repository field and wide once it is a
 * tool argument — which is what `resolvesToPrivateAddress` is for.
 *
 * Decimal and hex IPv4 literals (`http://2130706433/`, `http://0x7f.0.0.1/`)
 * need no special handling here: `new URL()` normalises both to `127.0.0.1`
 * before a caller ever reads `.hostname` (measured 2026-08-03).
 */
export function isPrivateHost(hostname: string): boolean {
  const host = unwrapMappedIpv4(hostname.toLowerCase().replace(/^\[|\]$/g, ''));

  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||                        // "this network"
      a === 127 ||                      // loopback
      a === 10 ||                       // RFC 1918
      (a === 169 && b === 254) ||       // link-local incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  if (host.includes(':')) {
    return (
      host === '::1' || host === '::' ||
      /^f[cd]/.test(host) ||            // unique local (fc00::/7)
      host.startsWith('fe80')           // link-local
    );
  }
  return false;
}

/**
 * Resolve `hostname` and judge every address it answers with.
 *
 * This is the check `isPrivateHost` cannot do: `internal.example.com` is a
 * one-line DNS entry away from `10.0.0.5`, and nothing about the string says so.
 *
 * A name that cannot be resolved comes back `'unresolvable'` rather than
 * `'public'`, and callers must treat that as a refusal — the fetching service
 * may well resolve it, and not necessarily to what we would have seen.
 *
 * @param lookup injectable so tests need no DNS; defaults to the resolver.
 */
export async function resolvesToPrivateAddress(
  hostname: string,
  lookup: (h: string) => Promise<ResolvedAddress[]> =
    h => dnsLookup(h, { all: true }) as Promise<ResolvedAddress[]>,
): Promise<'public' | 'private' | 'unresolvable'> {
  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return 'unresolvable';
  }
  if (addresses.length === 0) return 'unresolvable';
  // ONE private answer is enough: a name carrying both a public and a private
  // record is exactly the shape a rebinding attempt takes.
  return addresses.some(a => isPrivateHost(a.address)) ? 'private' : 'public';
}
