/**
 * Sitzungs-Cookie-Probe für M2 (Session-Berechtigung am MCP).
 *
 * Beantwortet vier Fragen, die der Entwurf offen lässt — und gibt dabei KEIN
 * Geheimnis aus. Gedruckt werden nur Cookie-NAMEN, ihre ATTRIBUTE, Statuscodes
 * und die gemeldete `authority`. Passwort und Cookie-Werte bleiben im Speicher
 * dieses Prozesses und landen weder in der Ausgabe noch auf der Platte.
 *
 *   1. Trägt JSESSIONID HttpOnly/Secure/SameSite, und auf welchen Domain/Path?
 *   2. Genügt der Cookie-Satz allein — ohne Basic-Header?
 *   3. Was passiert OHNE INGRESSCOOKIE? (stille Gast-Antwort oder ehrlicher 401)
 *   4. Was passiert mit UNGÜLTIGER JSESSIONID? (dito)
 *
 * 3 und 4 sind die eigentlich teuren: an dieser API antwortet ein NICHT
 * angemeldeter Aufruf mit 200 (gemessen 2026-08-04), also ist der Statuscode
 * kein Anmeldebeweis — nur die `authority` ist einer. Wenn eine kaputte
 * Sitzung still auf `esguest` fällt, sähe der Nutzer sich angemeldet und bekäme
 * Gast-Ergebnisse.
 *
 * Nur lesende Aufrufe (GET auf `/iam/v1/people/-home-/-me-`, den Endpunkt, den
 * `auth/identity.ts` selbst benutzt). Es wird nichts geschrieben.
 *
 * Zugangsdaten, Anmeldung und Schwärzung liegen in `probe-session.mjs` — dort
 * steht auch die Rangfolge der Quellen.
 *
 * Aufruf:  node session-cookie-probe.mjs [repository-url]
 * Vorgabe: https://repository.staging.openeduhub.net/edu-sharing
 */

import { randomBytes } from 'node:crypto';

import {
  loadCredentialFiles, resolveRepositoryUrl, obtainCredentials,
  redact, openSession, cookieHeader, reportIdentity,
} from './probe-session.mjs';

// Erst die Dateien lesen, dann die Adresse bestimmen: `WLO_REPOSITORY_URL` kann
// aus genau diesen Dateien kommen.
const quellen = loadCredentialFiles();
const REPO = resolveRepositoryUrl(process.argv[2]);
const ME = `${REPO}/rest/iam/v1/people/-home-/-me-`;

const main = async () => {
  console.log(`\nSitzungs-Cookie-Probe gegen ${REPO}`);
  console.log('Nur lesende Aufrufe. Es werden keine Werte gedruckt.');
  for (const [name, n] of quellen) console.log(`${name} gelesen (${n} Angaben übernommen).`);
  console.log('');

  // Quelle wird benannt, damit niemand rätselt, WELCHES Konto gerade läuft —
  // der Name ist kein Geheimnis, das Passwort erscheint nirgends.
  const { user, basic, fromEnvironment } = await obtainCredentials();
  if (!basic) { console.log('\nAbbruch: beide Angaben nötig.'); process.exit(1); }
  console.log(`  Konto: ${user}  ·  Passwort aus: ${fromEnvironment ? 'Umgebung/probe.env' : 'Eingabe'}`);

  // ── 1. Anmelden und die Set-Cookie-Zeilen ansehen ───────────────────────
  console.log('\n[1] Basic-Anmeldung — welche Cookies setzt der Server?\n');
  const { status, lines, jar } = await openSession(ME, basic);
  console.log(`  Anmeldung: HTTP ${status}`);
  if (!lines.length) {
    console.log('  KEIN Set-Cookie in der Antwort.');
    console.log('  → Entweder ist die Anmeldung gescheitert (Status prüfen), oder die');
    console.log('    Sitzung entsteht an einem anderen Endpunkt. Dann hier abbrechen.');
  }
  for (const zeile of lines) {
    const { name, len, attrs } = redact(zeile);
    console.log(`  ${name}  <Wert: ${len} Zeichen>`);
    console.log(`      Attribute: ${attrs || '(KEINE — kein HttpOnly, kein Secure, kein SameSite, kein Path)'}`);
  }
  const alle = [...jar.keys()];

  if (!jar.size) { console.log('\nOhne Cookies sind die weiteren Proben sinnlos. Ende.\n'); process.exit(0); }

  // ── 2..4. Was trägt, was fällt — und wie laut ───────────────────────────
  console.log('\n[2] Nur Cookies, KEIN Basic-Header — genügt der Satz allein?\n');
  await reportIdentity(ME, { Cookie: cookieHeader(jar, alle), Accept: 'application/json' }, 'voller Cookie-Satz');

  console.log('\n[3] INGRESSCOOKIE weggelassen — bricht es laut oder still?\n');
  const ohneIngress = alle.filter((n) => !/^INGRESSCOOKIE$/i.test(n));
  if (ohneIngress.length === alle.length) {
    console.log('  (kein INGRESSCOOKIE gesetzt — Probe entfällt)');
  } else {
    await reportIdentity(ME, { Cookie: cookieHeader(jar, ohneIngress), Accept: 'application/json' }, 'nur JSESSIONID');
    console.log('  ACHTUNG: läuft dort nur EINE Replik, beweist ein Erfolg hier nichts');
    console.log('  über den Betrieb mit mehreren. Die Bindung wird erst dann scharf.');
  }

  console.log('\n[4] JSESSIONID verfälscht — so sieht eine abgelaufene Sitzung aus\n');
  const sess = alle.find((n) => /^JSESSIONID$/i.test(n));
  if (!sess) {
    console.log('  (keine JSESSIONID gefunden — Probe entfällt)');
  } else {
    const echt = jar.get(sess);
    const falsch = randomBytes(Math.ceil(echt.length / 2)).toString('hex').slice(0, echt.length).toUpperCase();
    const gefaelscht = alle
      .map((n) => `${n}=${n === sess ? falsch : jar.get(n)}`).join('; ');
    await reportIdentity(ME, { Cookie: gefaelscht, Accept: 'application/json' }, 'ungültige Sitzungskennung');
  }

  console.log('\n[5] Kontrolle: gar keine Anmeldung\n');
  await reportIdentity(ME, { Accept: 'application/json' }, 'ohne alles');

  console.log('\nFertig. Die Ausgabe enthält keine Werte und kann geteilt werden.\n');
};

main().catch((e) => { console.error('\nAbbruch:', e?.message ?? e); process.exit(1); });
