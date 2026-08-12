/**
 * CSRF-Schreibprobe (E1).
 *
 * Eine Frage: verlangt edu-sharing für einen Schreibzugriff ein CSRF-Token —
 * also etwas, das der Code sich erst holen müsste — oder genügt die Sitzung?
 * Davon hängt ab, ob das Widget aus der Repository-Seite heraus überhaupt
 * schreiben kann (Bauvorschlag `2026-08-12-einbettung-ohne-repo-aenderung.md`,
 * Paket E1).
 *
 * DER NORMALLAUF ÄNDERT NICHTS. Er schickt Schreib-Anfragen an eine Sammlung,
 * die es nicht gibt: erreicht so eine Anfrage den Handler des Repositories —
 * erkennbar an dessen eigenem Fehlerobjekt —, dann stand kein Riegel davor. Das
 * ist genau die Frage. Sollte wider Erwarten doch etwas entstehen, wird es
 * sofort wieder gelöscht.
 *
 * Mit `--schreiben` kommt ein zweiter Teil dazu, der WIRKLICH schreibt: eine
 * Sammlung anlegen und sofort löschen. Erst der beweist, dass ein Schreibzugriff
 * allein mit dem Sitzungs-Cookie durchläuft. Bewusst hinter einem Schalter, weil
 * er das Repository anfasst.
 *
 * Es werden keine Werte gedruckt: keine Cookies, kein Passwort. Fehlertexte des
 * Servers werden gekürzt und von etwaigen Cookie-Werten befreit, bevor sie auf
 * den Schirm gehen.
 *
 * Aufruf:  node csrf-write-probe.mjs [repository-url] [--schreiben]
 */

import { randomUUID } from 'node:crypto';

import {
  loadCredentialFiles, resolveRepositoryUrl, obtainCredentials,
  openSession, cookieHeader, reportIdentity, TIMEOUT_MS, GUEST,
} from './probe-session.mjs';
import { classifyResponse, overallVerdict } from './csrf-write-verdict.mjs';

const quellen = loadCredentialFiles();
const SCHREIBEN = process.argv.includes('--schreiben');
const REPO = resolveRepositoryUrl(process.argv.find((a, i) => i > 1 && !a.startsWith('--')));
const ME = `${REPO}/rest/iam/v1/people/-home-/-me-`;
const SAMMLUNGEN = `${REPO}/rest/collection/v1/collections/-home-`;
const EIGENE_HERKUNFT = new URL(REPO).origin;
const FREMDE_HERKUNFT = 'https://fremde-seite.invalid';
const MAX_FEHLERTEXT = 200;

/** Wie die drei Versuche heißen und was sie mitschicken. */
const VARIANTEN = [
  { schluessel: 'ohne', name: 'ohne Herkunft', herkunft: null },
  { schluessel: 'eigene', name: 'eigene Herkunft (der Fall)', herkunft: EIGENE_HERKUNFT },
  { schluessel: 'fremde', name: 'fremde Herkunft', herkunft: FREMDE_HERKUNFT },
];

/** Rumpf einer Sammlung, wie ihn `services/write/collections.ts` schickt. */
function sammlungsRumpf(titel) {
  return JSON.stringify({
    title: titel,
    properties: { 'cm:title': [titel] },
    collection: { type: 'EDITORIAL' },
  });
}

/**
 * Servertext druckfertig machen: Cookie-Werte raus, Zeilenumbrüche weg, gekürzt.
 * Der Ersatz der Werte ist der eigentliche Zweck — ein Fehlertext, der die
 * Sitzung zitiert, würde sie sonst über die Ausgabe verteilen.
 */
function saeubern(text, jar) {
  let t = text ?? '';
  for (const wert of jar.values()) if (wert) t = t.split(wert).join('<Wert>');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > MAX_FEHLERTEXT ? `${t.slice(0, MAX_FEHLERTEXT)}…` : t;
}

/** Ein Schreibversuch. Gibt Status, Text und etwaige neue Cookies zurück. */
async function schreibversuch(url, { methode = 'POST', cookies, herkunft, rumpf }) {
  const headers = { Accept: 'application/json', Cookie: cookies };
  if (rumpf !== undefined) headers['Content-Type'] = 'application/json';
  // Ein Browser setzt beides selbst; ein Filter, der die Herkunft prüft, sieht
  // meist nur eines von beiden an — also beide mitschicken oder beide weglassen.
  if (herkunft) {
    headers['Origin'] = herkunft;
    headers['Referer'] = `${herkunft}/edu-sharing/components/collections`;
  }
  try {
    const res = await fetch(url, {
      method: methode, headers, body: rumpf,
      redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return {
      status: res.status,
      text: await res.text().catch(() => ''),
      neueCookies: (res.headers.getSetCookie?.() ?? []).map((z) => z.split('=')[0]),
    };
  } catch (e) {
    return { status: 0, text: e instanceof Error ? e.message : String(e), neueCookies: [] };
  }
}

/** Eine womöglich doch entstandene Sammlung wieder wegräumen. */
async function aufraeumen(nodeId, cookies) {
  const res = await schreibversuch(`${SAMMLUNGEN}/${encodeURIComponent(nodeId)}`,
    { methode: 'DELETE', cookies, herkunft: EIGENE_HERKUNFT });
  return res.status >= 200 && res.status < 300;
}

/** Steckt in der Antwort eine angelegte Sammlung? Dann muss sie wieder weg. */
function angelegteId(text) {
  try {
    return JSON.parse(text)?.collection?.ref?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Die drei Herkunfts-Varianten gegen eine Sammlung, die es nicht gibt.
 * @returns {Promise<Record<string, string>>} Einstufung je Variante
 */
async function messeHerkunftsVarianten(cookies, jar) {
  const eltern = randomUUID(); // existiert nicht ⇒ der Handler lehnt selbst ab
  const url = `${SAMMLUNGEN}/${eltern}/children`;
  const rumpf = sammlungsRumpf('E1-Messung — es soll nichts entstehen');
  console.log(`  Ziel: POST …/collections/-home-/${eltern.slice(0, 8)}…/children (Elternsammlung existiert nicht)\n`);

  const einstufungen = {};
  for (const v of VARIANTEN) {
    const res = await schreibversuch(url, { cookies, herkunft: v.herkunft, rumpf });
    const art = classifyResponse(res.status, res.text);
    einstufungen[v.schluessel] = art;
    console.log(`  ${v.name.padEnd(28)} HTTP ${String(res.status).padEnd(4)} ${art}`);
    const text = saeubern(res.text, jar);
    if (text) console.log(`      Antwort: ${text}`);
    if (res.neueCookies.length) console.log(`      NEUE Cookies: ${res.neueCookies.join(', ')}`);

    const id = angelegteId(res.text);
    if (id) {
      const weg = await aufraeumen(id, cookies);
      console.log(`      ACHTUNG: es ist doch etwas entstanden (${id}) — ${weg ? 'wieder gelöscht' : 'LÖSCHEN GESCHEITERT, bitte von Hand'}`);
    }
  }
  return einstufungen;
}

/** Der ehrliche Beweis: einmal wirklich schreiben und sofort zurücknehmen. */
async function beweiseEchtenSchreibzugriff(cookies, jar) {
  const titel = `E1-Messung CSRF ${new Date().toISOString().slice(0, 16)} (darf gelöscht werden)`;
  const res = await schreibversuch(`${SAMMLUNGEN}/-root-/children`,
    { cookies, herkunft: EIGENE_HERKUNFT, rumpf: sammlungsRumpf(titel) });
  const art = classifyResponse(res.status, res.text);
  console.log(`  Anlegen                      HTTP ${String(res.status).padEnd(4)} ${art}`);
  const text = saeubern(res.text, jar);
  if (text && art !== 'passed') console.log(`      Antwort: ${text}`);

  const id = angelegteId(res.text);
  if (!id) {
    console.log('  Es wurde nichts angelegt — nichts aufzuräumen.');
    return art;
  }
  const weg = await aufraeumen(id, cookies);
  console.log(`  Löschen                      ${weg ? 'erledigt' : 'GESCHEITERT — bitte von Hand entfernen'}: ${id}`);
  return art;
}

/** Das Urteil in Klartext, mit dem, was es NICHT sagt. */
function berichte(einstufungen) {
  const { result, originChecked } = overallVerdict({
    ownOrigin: einstufungen.eigene, foreignOrigin: einstufungen.fremde,
  });
  const texte = {
    'no-token': 'KEIN CSRF-Token nötig. Die Anfrage aus eigener Herkunft kam beim Handler an,\n'
      + '  ohne dass ein Filter etwas verlangt hätte. E4 kann so gebaut werden.',
    'token-required': 'CSRF-TOKEN NÖTIG. Der Riegel greift auch bei eigener Herkunft.\n'
      + '  E3/E4 müssen das Token beschaffen — der Entwurf ändert sich.',
    'unclear-rights': 'UNKLAR: 403 ohne Token-Nennung. Das kann fehlendes Schreibrecht dieses\n'
      + '  Kontos sein ODER ein stiller Riegel. Mit einem schreibberechtigten Konto\n'
      + '  wiederholen (WLO_USER/WLO_PASSWORD in scripts/probe.env).',
    'unclear-auth': 'UNKLAR: 401 — die Sitzung trug nicht. Erst die Anmeldung klären.',
    'unclear': 'UNKLAR: die Ablehnung war nicht lesbar. Ohne Fehlerobjekt des Repositories\n'
      + '  beweist sie nichts.',
  };
  console.log(`\n  ⇒ ${texte[result]}`);

  if (result === 'no-token') {
    console.log(originChecked
      ? '\n  Die fremde Herkunft wurde abgewiesen: der Server prüft den Origin-Kopf.\n'
        + '  Für E4 unerheblich — das Widget läuft in der Seite und schickt den echten.'
      : '\n  Die fremde Herkunft kam ebenso durch: der Server sieht den Origin-Kopf nicht an.\n'
        + '  Das heißt NICHT, dass das Repository fremdem Code offensteht — die Cookies\n'
        + '  tragen kein SameSite, und Browser behandeln das wie Lax, schicken sie also\n'
        + '  bei einem fremden POST gar nicht erst mit. Dieses Skript ist kein Browser.');
  }
  return result;
}

const main = async () => {
  console.log(`\nCSRF-Schreibprobe (E1) gegen ${REPO}`);
  console.log(SCHREIBEN
    ? 'MIT --schreiben: der letzte Teil legt eine Sammlung an und löscht sie sofort.'
    : 'Normallauf: es wird nichts geändert. (--schreiben ergänzt den echten Beweis.)');
  for (const [name, n] of quellen) console.log(`${name} gelesen (${n} Angaben übernommen).`);
  console.log('');

  const { user, basic, fromEnvironment } = await obtainCredentials();
  if (!basic) { console.log('\nAbbruch: beide Angaben nötig.'); process.exit(1); }
  console.log(`  Konto: ${user}  ·  Passwort aus: ${fromEnvironment ? 'Umgebung/probe.env' : 'Eingabe'}`);

  console.log('\n[1] Anmelden und prüfen, wer wir sind\n');
  const { status, lines, jar } = await openSession(ME, basic);
  console.log(`  Anmeldung: HTTP ${status}, Cookies: ${lines.length ? [...jar.keys()].join(', ') : 'KEINE'}`);
  if (!jar.size) { console.log('\nOhne Sitzung ist die Probe sinnlos. Ende.\n'); process.exit(1); }
  const cookies = cookieHeader(jar, [...jar.keys()]);
  const { authority } = await reportIdentity(ME, { Cookie: cookies, Accept: 'application/json' }, 'nur Cookies');
  if (!authority || authority === GUEST) {
    console.log('\n  Die Cookies führen nicht auf ein Konto — ein Schreibversuch würde nur');
    console.log('  die Anmeldung messen, nicht den CSRF-Schutz. Ende.\n');
    process.exit(1);
  }

  console.log('\n[2] Schreib-Anfragen, die nichts anlegen können — drei Herkünfte\n');
  const einstufungen = await messeHerkunftsVarianten(cookies, jar);
  const urteil = berichte(einstufungen);

  if (SCHREIBEN) {
    console.log('\n[3] Echter Schreibzugriff: anlegen und sofort löschen\n');
    const art = await beweiseEchtenSchreibzugriff(cookies, jar);
    console.log(art === 'passed'
      ? '\n  ⇒ Ein Schreibzugriff allein mit dem Sitzungs-Cookie läuft durch — bewiesen,\n'
        + '    nicht erschlossen.'
      : `\n  ⇒ Der echte Schreibzugriff kam nicht durch (${art}). Das kann an den Rechten\n`
        + '    dieses Kontos liegen; für die CSRF-Frage gilt das Urteil aus [2].');
  } else if (urteil === 'no-token') {
    console.log('\n  Noch nicht belegt: dass ein echter Schreibzugriff durchläuft. Das zeigt');
    console.log('  erst ein Lauf mit --schreiben (legt eine Sammlung an und löscht sie sofort).');
  }

  console.log('\nFertig. Die Ausgabe enthält keine Werte und kann geteilt werden.\n');
};

main().catch((e) => { console.error('\nAbbruch:', e?.message ?? e); process.exit(1); });
