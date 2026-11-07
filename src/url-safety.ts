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
import { BlockList, isIP } from 'node:net';

/** One DNS answer, narrowed to the part that matters here. */
type ResolvedAddress = { address: string };

/** Hex pair `xxxx:yyyy` → dotted quad, or null when it is not one. */
function hexPairToIpv4(rest: string): string | null {
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
  if (!hex) return null;
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
 * Rewrite an IPv6 address that CARRIES an IPv4 to that IPv4; anything else is
 * returned unchanged. Three carriers exist, and each reaches a private host
 * when only the IPv6 shape is judged (audit 2026-11-05, measured by executing
 * the old check):
 *
 * - IPv4-mapped `::ffff:a.b.c.d` — `new URL()` normalises
 *   `http://[::ffff:127.0.0.1]/` to `[::ffff:7f00:1]`, so the dotted quad is
 *   already gone before any check runs (measured 2026-08-03), while
 *   `dns.lookup` hands back the dotted form.
 * - NAT64 `64:ff9b::a.b.c.d` (RFC 6052) — a NAT64 gateway forwards it to the
 *   embedded IPv4.
 * - IPv4-compatible `::a.b.c.d` (deprecated, still parsed) — `[::127.0.0.1]`
 *   becomes `[::7f00:1]`.
 *
 * Judging only the prefix would be wrong in the other direction:
 * `::ffff:808:808` is 8.8.8.8 and public.
 */
function unwrapEmbeddedIpv4(host: string): string {
  const carried = /^(?:::ffff:|64:ff9b::|::)(.+)$/.exec(host)?.[1];
  if (!carried) return host;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(carried)) return carried;
  return hexPairToIpv4(carried) ?? host;
}

/**
 * Every range a fetch must not reach, as CIDR — checked with the standard
 * library's `net.BlockList` rather than hand-written comparisons, which is how
 * 100.64.0.0/10 and most of fe80::/10 went missing.
 */
const PRIVATE_RANGES: ReadonlyArray<readonly [string, number, 'ipv4' | 'ipv6']> = [
  ['0.0.0.0', 8, 'ipv4'],        // "this network"
  ['10.0.0.0', 8, 'ipv4'],       // RFC 1918
  ['100.64.0.0', 10, 'ipv4'],    // shared address space (CGNAT; Alibaba metadata 100.100.100.200)
  ['127.0.0.0', 8, 'ipv4'],      // loopback
  ['169.254.0.0', 16, 'ipv4'],   // link-local incl. cloud metadata
  ['172.16.0.0', 12, 'ipv4'],    // RFC 1918
  ['192.0.0.0', 24, 'ipv4'],     // IETF protocol assignments
  ['192.168.0.0', 16, 'ipv4'],   // RFC 1918
  ['198.18.0.0', 15, 'ipv4'],    // benchmarking
  ['224.0.0.0', 4, 'ipv4'],      // multicast
  ['240.0.0.0', 4, 'ipv4'],      // reserved, incl. broadcast
  ['::', 128, 'ipv6'],           // unspecified
  ['::1', 128, 'ipv6'],          // loopback
  ['64:ff9b:1::', 48, 'ipv6'],   // NAT64 local-use (RFC 8215)
  ['fc00::', 7, 'ipv6'],         // unique local
  ['fe80::', 10, 'ipv6'],        // link-local
  ['ff00::', 8, 'ipv6'],         // multicast
];

const blockList = new BlockList();
for (const [address, prefix, family] of PRIVATE_RANGES) blockList.addSubnet(address, prefix, family);

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
  const host = unwrapEmbeddedIpv4(hostname.toLowerCase().replace(/^\[|\]$/g, ''));

  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const family = isIP(host);
  if (family === 4) return blockList.check(host, 'ipv4');
  if (family === 6) return blockList.check(host, 'ipv6');
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
