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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

  let adds = 0;
  const zaehlend: AccessRegistry = {
    ...s.registry,
    add: async (e) => { adds += 1; return s.registry.add(e); },
  };
  const d = { ...deps(s), support: { keys: s.keys, registry: zaehlend } };

  const t0 = Date.now();
  assert.ok((await exchangeTicket(TICKET, d, t0)).ok);
  assert.ok((await exchangeTicket(TICKET, d, t0 + 60_000)).ok, 'derselbe Tausch, eine Minute später');

  assert.equal(adds, 1, 'der zweite Tausch ergänzt nichts und darf nicht schreiben');
  const eintraege = entriesOnDisk(s.path) as { iat: number }[];
  assert.equal(eintraege.length, 1);
  assert.equal(eintraege[0]?.iat, Math.floor(t0 / 1000), 'der Eintrag behält seinen ersten Zeitstempel');
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
  assert.equal(s.registry.expiresAt(jti), Math.floor(spaeter / 1000) + SESSION_BLOCK_TTL_S);
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
