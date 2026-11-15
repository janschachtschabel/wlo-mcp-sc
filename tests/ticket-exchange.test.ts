/**
 * ticket-exchange.test.ts – ein edu-sharing-Ticket wird zu einem Zugangsblock.
 *
 * Der Tausch ist die eine Stelle, an der ein ROHES Ticket diesen Server
 * erreicht (danach lebt es nur noch verschlüsselt im Block). Drei Regeln
 * tragen ihn, und alle drei stehen hier als Zusicherung statt als Kommentar:
 *
 *  - **Die Authority entscheidet, nie der Status.** Ein 200 mit `esguest` ist
 *    kein Login (P0-Messung) — ein Ticket, das als Gast ankommt, ergibt keinen
 *    Block.
 *  - **Deterministische `jti`.** Ein eingebettetes Widget tauscht bei jedem
 *    Seiten-Neuladen. Bekäme jeder Tausch eine frische Id, drängte ein
 *    Reload-Sturm die übrigen Blöcke desselben Kontos aus der Registry
 *    (`MAX_BLOCKS_PER_LABEL`); mit der Ticket-Hash-Id bleibt derselbe Tausch
 *    derselbe Eintrag.
 *  - **Erst die Drossel, dann das Repositorium.** Wer Tickets durchprobiert,
 *    erreicht WLO gar nicht erst — dieselbe Reihenfolge wie beim Block-Prüfen
 *    (`access-verify.ts`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exchangeTicket, isWellFormedTicket } from '../src/auth/ticket-exchange.js';
import { decodeAccessToken, loadAuthKeys, type AuthKeys } from '../src/auth/access-token.js';
import { openRegistry, SESSION_BLOCK_TTL_S, type AccessRegistry } from '../src/auth/access-registry.js';
import { createDistinctValueLimiter } from '../src/rate-limit.js';

const TICKET = 'TICKET_c001d00dfeedface0123456789abcdef01234567';

/** Fake-Upstream wie in auth-endpoints.test.ts — zählt zusätzlich die Aufrufe. */
function upstream(authority: string | null, opts: { status?: number; fail?: boolean } = {}) {
  const original = globalThis.fetch;
  const calls: { header: string | null }[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    // `wloFetch` reicht die Kopfzeilen als `Headers`-Objekt weiter — ein
    // Record-Zugriff läse daran vorbei.
    calls.push({ header: new Headers(init?.headers).get('authorization') });
    if (opts.fail) throw new Error('network down');
    return new Response(
      JSON.stringify(authority ? { person: { authorityName: authority, profile: { firstName: 'Léa', lastName: 'K' } } } : {}),
      { status: opts.status ?? 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

async function support(
  t: { after: (fn: () => void) => void },
): Promise<{ keys: AuthKeys; registry: AccessRegistry; path: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'wlo-ticket-'));
  const path = join(dir, 'registry.json');
  const registry = await openRegistry(path);
  assert.ok(registry);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = loadAuthKeys({ current: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert.ok(keys);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { keys, registry, path };
}

function deps(s: { keys: AuthKeys; registry: AccessRegistry }, limit = 5) {
  return {
    ip: '198.51.100.9',
    authAbuseLimiter: createDistinctValueLimiter(limit, 600_000),
    support: { keys: s.keys, registry: s.registry },
  };
}

const entriesOnDisk = (path: string): unknown[] =>
  (JSON.parse(readFileSync(path, 'utf8')) as { entries: unknown[] }).entries;

// ── Form ─────────────────────────────────────────────────────────────────────

test('die Formprüfung lässt echte Tickets durch und hält Kopfzeilen-Gift heraus', () => {
  assert.equal(isWellFormedTicket(TICKET), true);
  assert.equal(isWellFormedTicket('TICKET_' + 'a'.repeat(40)), true);

  assert.equal(isWellFormedTicket(''), false, 'leer');
  assert.equal(isWellFormedTicket('kurz'), false, 'unter der Mindestlänge');
  assert.equal(isWellFormedTicket('mit leerzeichen_im_wert'), false, 'Leerzeichen');
  assert.equal(isWellFormedTicket('evil\r\nX-Injected: 1'), false, 'CR/LF — Kopfzeilen-Injektion');
  assert.equal(isWellFormedTicket('tick\u0000et'), false, 'Steuerzeichen');
  assert.equal(isWellFormedTicket('x'.repeat(513)), false, 'über der Obergrenze');
});

// ── Der Tausch ───────────────────────────────────────────────────────────────

test('ein angenommenes Ticket ergibt einen dekodierbaren Ticket-Block mit Registry-Eintrag', async (t) => {
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);

  const outcome = await exchangeTicket(TICKET, deps(s), Date.now());
  assert.ok(outcome.ok, 'Tausch angenommen');
  assert.equal(outcome.authority, 'lehrerin');
  assert.equal(outcome.displayName, 'Léa K');

  // Upstream lief mit dem EDU-TICKET-Schema — nie als Basic, nie als Bearer.
  assert.equal(up.calls[0]?.header, `EDU-TICKET ${TICKET}`);

  const payload = decodeAccessToken(outcome.block, s.keys);
  assert.ok(payload, 'der Block ist einer von uns');
  assert.equal(payload.k, 'ticket');
  assert.equal(payload.secret, TICKET);
  assert.equal(payload.u, 'lehrerin');
  assert.ok(s.registry.has(payload.jti), 'die Id steht auf der Erlaubnisliste');
  assert.ok(!outcome.block.includes(TICKET), 'das Ticket steht nicht lesbar im Block');
});

test('derselbe Tausch ist derselbe Eintrag — Neuladen flutet die Registry nicht', async (t) => {
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);

  const erster = await exchangeTicket(TICKET, deps(s), Date.now());
  const zweiter = await exchangeTicket(TICKET, deps(s), Date.now());
  assert.ok(erster.ok && zweiter.ok);
  const a = decodeAccessToken(erster.block, s.keys);
  const b = decodeAccessToken(zweiter.block, s.keys);
  assert.ok(a && b);
  assert.equal(a.jti, b.jti, 'deterministische Id je Ticket');
  assert.equal(entriesOnDisk(s.path).length, 1, 'ein Eintrag, nicht zwei');
});

test('ein wiederholter Tausch schreibt die Registry nicht neu', async (t) => {
  // Die Registry ist der EINZIGE Schreiber auf Platte zur Laufzeit, und `add`
  // committet immer — es serialisiert die ganze Liste und benennt sie um. Ein
  // eingebettetes Widget tauscht bei jedem Seitenaufruf, also kostete jeder
  // Seitenaufruf ein volles Neuschreiben, dessen einziger Unterschied das
  // aufgefrischte `iat` war. Steht die Id schon auf der Liste, ist nichts zu
  // ergänzen: der Eintrag behält den Zeitpunkt seines ersten Tauschs, was
  // ohnehin genauer ist.
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);

  const t0 = Date.now();
  assert.ok((await exchangeTicket(TICKET, deps(s), t0)).ok);
  const vorher = entriesOnDisk(s.path) as { iat: number }[];
  // Ab hier scheitert jedes Schreiben (der Platz der Temp-Datei ist belegt):
  // gelingt der zweite Tausch trotzdem, hat er nichts geschrieben.
  mkdirSync(`${s.path}.tmp`);
  t.after(() => rmSync(`${s.path}.tmp`, { recursive: true, force: true }));
  assert.ok((await exchangeTicket(TICKET, deps(s), t0 + 60_000)).ok, 'derselbe Tausch, eine Minute später, ohne zu schreiben');

  const eintraege = entriesOnDisk(s.path) as { iat: number }[];
  assert.equal(eintraege.length, 1);
  assert.ok(Number(vorher[0]?.iat) >= t0 / 1000);
  assert.equal(eintraege[0]?.iat, vorher[0]?.iat, 'der Eintrag behält seinen ersten Zeitpunkt, auf die Millisekunde');
});

test('ein Ticket-Block läuft nach 12 h ab — und ein neuer Tausch desselben Tickets erneuert ihn', async (t) => {
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);

  const t0 = 1_800_000_000_000;
  const erster = await exchangeTicket(TICKET, deps(s), t0);
  assert.ok(erster.ok);
  const jti = decodeAccessToken(erster.block, s.keys)!.jti;
  assert.equal(s.registry.expiresAt(jti), t0 / 1000 + SESSION_BLOCK_TTL_S, 'iat + 12 h');

  const spaeter = t0 + SESSION_BLOCK_TTL_S * 1000 + 1;
  assert.equal(s.registry.has(jti, spaeter), false, 'abgelaufen');
  assert.ok((await exchangeTicket(TICKET, deps(s), spaeter)).ok);
  assert.equal(s.registry.has(jti, spaeter), true, 'erneuert');
  assert.equal(Math.round((s.registry.expiresAt(jti)! - s.registry.listedAt(jti)!) * 1000), SESSION_BLOCK_TTL_S * 1000, 'zwölf Stunden ab der neuen Eintragung');
});

test('ein Gast-Ticket ergibt keinen Block — die Authority entscheidet, nicht der Status', async (t) => {
  const s = await support(t);
  const up = upstream('esguest');
  t.after(up.restore);

  const outcome = await exchangeTicket(TICKET, deps(s), Date.now());
  assert.equal(outcome.ok, false);
  assert.equal(!outcome.ok && outcome.status, 400);
  assert.equal(entriesOnDisk(s.path).length, 0, 'nichts gelistet');
});

test('ein abgelehntes oder unerreichbares Repositorium ergibt keinen Block', async (t) => {
  const s = await support(t);
  const refused = upstream(null, { status: 401 });
  const erste = await exchangeTicket(TICKET, deps(s), Date.now());
  refused.restore();
  assert.equal(erste.ok, false, '401 → abgelehnt');

  const down = upstream(null, { fail: true });
  t.after(down.restore);
  const zweite = await exchangeTicket(TICKET, deps(s), Date.now());
  assert.equal(zweite.ok, false, 'Netzfehler → kein Block');
  assert.equal(entriesOnDisk(s.path).length, 0);
});

test('ein missgeformtes Ticket erreicht das Repositorium gar nicht erst', async (t) => {
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);

  const outcome = await exchangeTicket('evil\r\nX: 1', deps(s), Date.now());
  assert.equal(outcome.ok, false);
  assert.equal(!outcome.ok && outcome.status, 400);
  assert.equal(up.calls.length, 0, 'kein Upstream-Aufruf für Müll');
});

test('die Drossel zählt verschiedene Tickets und greift VOR dem Repositorium', async (t) => {
  const s = await support(t);
  const up = upstream('lehrerin');
  t.after(up.restore);

  const d = deps(s, 2);
  const now = Date.now();
  assert.ok((await exchangeTicket(`${TICKET}aa`, d, now)).ok);
  assert.ok((await exchangeTicket(`${TICKET}bb`, d, now)).ok);
  const dritte = await exchangeTicket(`${TICKET}cc`, d, now);
  assert.equal(dritte.ok, false);
  assert.equal(!dritte.ok && dritte.status, 429);
  assert.equal(up.calls.length, 2, 'der dritte Versuch erreichte WLO nicht');

  // Dasselbe Ticket erneut ist KEIN weiterer distinkter Versuch — der
  // legitime Fall (Neuladen der Seite) bleibt unter der Drossel.
  assert.ok((await exchangeTicket(`${TICKET}aa`, d, now)).ok);
});

// ── audit 2026-11-12, review of P1: the binding and the ticket path ───────────

test('ein Ticket-Block kommt durch die Namensbindung — auch nach erneutem Tausch (Review P1, 6)', async (t) => {
  const { credentialFromHeader, setAccessSupport } = await import('../src/auth/credential.js');
  const s = await support(t);
  setAccessSupport({ keys: s.keys, registry: s.registry });
  t.after(() => setAccessSupport(null));
  // Eine Authority, die die Textbereinigung verändert (über 120 Zeichen): Label
  // und `u` müssen trotzdem DENSELBEN Wert tragen, sonst sperrt die Bindung jedes Widget aus.
  const long = `sso-${'x'.repeat(140)}`;
  const up = upstream(long);
  t.after(up.restore);

  for (const round of [1, 2]) {
    const outcome = await exchangeTicket(TICKET, deps(s), Date.now());
    assert.ok(outcome.ok, `Tausch ${round}`);
    const cred = credentialFromHeader(`Bearer ${outcome.block}`);
    assert.ok(cred, `Tausch ${round}: der Block meldet an`);
    assert.equal(cred.header, `EDU-TICKET ${TICKET}`);
  }
});

// ── one listing per block (chatbot team, 2026-11-15: the same rule as sessions) ─

/** Exchange, and whether the block it gave signs in right now. */
async function signsIn(block: string): Promise<boolean> {
  const { credentialFromHeader } = await import('../src/auth/credential.js');
  return credentialFromHeader(`Bearer ${block}`) !== null;
}

test('a ticket block carries its listing: a reload during it gets a block of the SAME listing', async (t) => {
  const { setAccessSupport } = await import('../src/auth/credential.js');
  const s = await support(t);
  setAccessSupport({ keys: s.keys, registry: s.registry });
  t.after(() => setAccessSupport(null));
  const up = upstream('lehrerin');
  t.after(up.restore);
  const t0 = Date.now();
  const first = await exchangeTicket(TICKET, deps(s), t0);
  const reload = await exchangeTicket(TICKET, deps(s), t0 + 5_000);
  assert.ok(first.ok && reload.ok);
  if (!first.ok || !reload.ok) return;
  const jti = decodeAccessToken(first.block, s.keys)!.jti;
  assert.equal(decodeAccessToken(reload.block, s.keys)?.iat, s.registry.listedAt(jti), 'the listing\'s instant, not the reload\'s');
  assert.equal(await signsIn(first.block), true);
  assert.equal(await signsIn(reload.block), true, 'both blocks of one listing work side by side');
});

test('after a revocation, the next exchange of the same ticket does not revive the old block', async (t) => {
  // Before 2026-11-15 a logout lasted until the next exchange of the same ticket
  // (R2): the id is the ticket's hash, and listing it again revived every block.
  const { setAccessSupport } = await import('../src/auth/credential.js');
  const s = await support(t);
  setAccessSupport({ keys: s.keys, registry: s.registry });
  t.after(() => setAccessSupport(null));
  const up = upstream('lehrerin');
  t.after(up.restore);
  const t0 = Date.now();
  const taken = await exchangeTicket(TICKET, deps(s), t0);
  assert.ok(taken.ok);
  if (!taken.ok) return;
  await s.registry.remove(decodeAccessToken(taken.block, s.keys)!.jti);
  const again = await exchangeTicket(TICKET, deps(s), t0 + 1);
  assert.ok(again.ok);
  if (!again.ok) return;
  assert.equal(await signsIn(again.block), true, 'the person is still signed in at the repository: a new block');
  assert.equal(await signsIn(taken.block), false, 'the revoked block stays revoked — one millisecond later already');
});

test('after the twelve hours, the next exchange of the same ticket does not revive the old block either', async (t) => {
  const { setAccessSupport } = await import('../src/auth/credential.js');
  const s = await support(t);
  setAccessSupport({ keys: s.keys, registry: s.registry });
  t.after(() => setAccessSupport(null));
  const up = upstream('lehrerin');
  t.after(up.restore);
  // A listing is stamped by the registry's own clock, never earlier than now —
  // so the time after the twelve hours is reached with a later caller clock.
  const old = await exchangeTicket(TICKET, deps(s), Date.now());
  const renewed = await exchangeTicket(TICKET, deps(s), Date.now() + SESSION_BLOCK_TTL_S * 1000 + 5_000);
  assert.ok(old.ok && renewed.ok);
  if (!old.ok || !renewed.ok) return;
  assert.equal(await signsIn(renewed.block), true);
  assert.equal(await signsIn(old.block), false, 'a block taken in the first hour is worthless after the renewal');
});

test('two exchanges of the same ticket at once get blocks of ONE listing', async (t) => {
  const { setAccessSupport } = await import('../src/auth/credential.js');
  const s = await support(t);
  setAccessSupport({ keys: s.keys, registry: s.registry });
  t.after(() => setAccessSupport(null));
  const up = upstream('lehrerin');
  t.after(up.restore);
  const t0 = Date.now();
  const [a, b] = await Promise.all([exchangeTicket(TICKET, deps(s), t0), exchangeTicket(TICKET, deps(s), t0 + 3)]);
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.equal(await signsIn(a.block), true, 'the first tab\'s block is not dead on arrival');
  assert.equal(await signsIn(b.block), true);
});

test('a ticket block whose instant is not the listing\'s is refused', async (t) => {
  const { setAccessSupport } = await import('../src/auth/credential.js');
  const { encodeAccessToken } = await import('../src/auth/access-token.js');
  const s = await support(t);
  setAccessSupport({ keys: s.keys, registry: s.registry });
  t.after(() => setAccessSupport(null));
  const up = upstream('lehrerin');
  t.after(up.restore);
  // A caller instant with a fraction, ahead of the clock, so the write keeps it.
  const now = Math.floor(Date.now() / 1000) * 1000 + 60_123;
  const got = await exchangeTicket(TICKET, deps(s), now);
  assert.ok(got.ok);
  if (!got.ok) return;
  const p = decodeAccessToken(got.block, s.keys)!;
  assert.equal(p.iat, now / 1000);
  const forged = encodeAccessToken({ ...p, iat: Math.floor(p.iat) }, s.keys.publicKeyPem);
  assert.equal(await signsIn(forged), false, 'rounded, the instant is another listing\'s');
  const shifted = encodeAccessToken({ ...p, iat: p.iat + 0.001 }, s.keys.publicKeyPem);
  assert.equal(await signsIn(shifted), false);
});

test('rollout: an entry the previous code wrote keeps working for its first block — a reload block of it answers 401 once', async (t) => {
  // Before 2026-11-15 a ticket entry carried a whole second, and every reload got
  // a block stamped with ITS second. After the change the entry is reused as it
  // stands: the block of the first exchange still matches, a reload block from
  // before does not, and the next exchange hands out one that does.
  const { setAccessSupport } = await import('../src/auth/credential.js');
  const { encodeAccessToken } = await import('../src/auth/access-token.js');
  const s = await support(t);
  setAccessSupport({ keys: s.keys, registry: s.registry });
  t.after(() => setAccessSupport(null));
  const up = upstream('lehrerin');
  t.after(up.restore);
  // The id comes from the code under test; then the entry is rewritten in the old shape.
  const probe = await exchangeTicket(TICKET, deps(s), Date.now());
  assert.ok(probe.ok);
  if (!probe.ok) return;
  const jti = decodeAccessToken(probe.block, s.keys)!.jti;
  const t0 = Math.floor(Date.now() / 1000) - 60;
  await s.registry.add({ jti, label: 'lehrerin', iat: t0, exp: t0 + SESSION_BLOCK_TTL_S, k: 'ticket' });
  const oldFirst = encodeAccessToken({ v: 2, jti, u: 'lehrerin', secret: TICKET, iat: t0, k: 'ticket' }, s.keys.publicKeyPem);
  const oldReload = encodeAccessToken({ v: 2, jti, u: 'lehrerin', secret: TICKET, iat: t0 + 5, k: 'ticket' }, s.keys.publicKeyPem);
  assert.equal(await signsIn(oldFirst), true, 'the first exchange\'s block of the old code');
  assert.equal(await signsIn(oldReload), false, 'a reload block of the old code: the one 401');
  const next = await exchangeTicket(TICKET, deps(s), Date.now());
  assert.ok(next.ok);
  if (!next.ok) return;
  assert.equal(decodeAccessToken(next.block, s.keys)?.iat, t0, 'the old entry is reused as it stands');
  assert.equal(await signsIn(next.block), true, 'and the widget\'s next exchange signs in again');
});
