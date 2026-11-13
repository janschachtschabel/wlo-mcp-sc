/**
 * auth-i18n.js — German and English for the three access pages.
 *
 * German is the page as served: it is in the HTML, it works without this file,
 * and it is what WLO's own editors read. English is laid over it here, because
 * the same pages are where an English-speaking ChatGPT or Claude user lands
 * when their client asks them to sign in — on a password page in a language
 * they cannot read (audit 2026-11-12, F-2).
 *
 * Which language: `?lang=de|en` when given, else the browser's first German or
 * English preference, else English for everybody who reads neither. Nothing is
 * stored — these pages keep nothing in `localStorage`, a cookie or the URL, and
 * a language choice is no reason to start.
 *
 * Every English text is OURS, written in this file. That is the only reason
 * `innerHTML` is acceptable below; nothing a server or a caller sent goes
 * through it. Messages the SERVER returns stay German and are shown as such.
 */

/** @type {Record<string, string>} */
export const EN = {
  // shared
  footer: 'WirLernenOnline · <a href="/">Back to the launcher</a>',
  user_label: 'WLO user name',
  user_hint: 'The name you sign in to WirLernenOnline with.',
  secret_label: 'WLO password',
  secret_hint: 'It is <strong>encrypted in your browser</strong> and leaves this device only as an unreadable block. We do not store it.',
  fill_both: 'Please enter user name and password.',
  unknown_error: 'Unknown error.',
  server_said: 'The server answered (in German): ',

  // auth.html — issue an access block
  issue_doc_title: 'MCP access with your WLO account · WirLernenOnline',
  issue_title: 'MCP access with your WLO account',
  issue_lede: 'So that you can work in your AI client with your own rights — and changes appear under your name in the WLO history.',
  issue_form: 'Create access',
  issue_submit: 'Create access',
  issue_revoke_link: 'Revoke an access',
  issue_result: 'Your access block',
  issue_block_label: 'Value for the "Authorization" field of your AI client',
  issue_block_hint: 'For a header field copy it completely, including <code class="mono">Bearer</code> at the start. If a field asks for the block alone, use the second button — <code class="mono">Bearer</code> twice in a header makes the access invalid.',
  issue_copy: 'Copy with "Bearer"',
  issue_copy_plain: 'Copy the block only',
  issue_howto: 'How to enter it',
  issue_step1: 'Open the settings of the WLO connection in your AI client.',
  issue_step2: 'Enter the block where additional headers are kept.',
  issue_step3: 'Reconnect and call <code class="mono">wlo_auth_status</code> in the chat — if it says <code class="mono">mode: user</code>, your access is in effect.',
  issue_warn1: '<strong>Treat the block like a password.</strong> Whoever has it can work through this server with your WLO rights. It is valid until you revoke it.',
  issue_warn2: 'Lost the block? Changing your WLO password makes <em>all</em> your blocks invalid at once.',
  issue_busy: 'Encrypting and checking …',
  issue_done: 'Access created. It is valid until you revoke it.',
  issue_failed: 'The access could not be created.',
  copied_header: 'Header value copied.',
  copied_block: 'Block copied.',
  copy_denied: 'Copying is not allowed — the value is selected now.',

  // auth-revoke.html
  revoke_doc_title: 'Revoke MCP access · WirLernenOnline',
  revoke_title: 'Revoke MCP access',
  revoke_lede: 'A revoked block stops working at once — also when somebody else has it.',
  revoke_form: 'Revoke a block',
  revoke_block_label: 'Access block',
  revoke_block_hint: 'The value from the settings of your AI client. With or without <code class="mono">Bearer</code> at the start — both work.',
  revoke_submit: 'Revoke this access',
  revoke_new_link: 'Get a new access',
  revoke_all_heading: 'No block at hand? Revoke all accesses',
  revoke_all_text: 'If you signed in through <strong>"Connect with WLO"</strong>, you never saw the block — it went straight to your AI client. Sign in here and <em>all</em> accesses of your account are revoked.',
  revoke_all_secret_hint: 'It is encrypted in the browser and passed to WLO only to be checked — exactly as when an access is created.',
  revoke_all_submit: 'Revoke all my accesses',
  revoke_pw_heading: 'Changed your password?',
  revoke_pw_text: 'A <strong>change of your WLO password</strong> also makes <em>all</em> your access blocks unusable at once, because each of them contains the old password. The entries stay listed, though — to clean up completely, revoke them above <strong>before</strong> the change.',
  revoke_need_block: 'Please paste the access block.',
  revoke_busy: 'Revoking …',
  revoke_failed: 'The block could not be revoked.',
  revoke_done: 'Revoked. This access stops working immediately.',
  revoke_was_gone: 'This block was already revoked or never active. It does not work.',
  revoke_all_busy: 'Checking the sign-in and revoking …',
  revoke_all_failed: 'The accesses could not be revoked.',
  revoke_all_one: '1 access was revoked. Affected AI clients have to be reconnected.',
  revoke_all_many: '{n} accesses were revoked. Affected AI clients have to be reconnected.',
  revoke_all_none: 'No access was active for this account. Nothing is open.',

  // authorize.html — the OAuth consent screen
  consent_doc_title: 'Allow access · WirLernenOnline',
  consent_title: 'Allow access to your WLO account',
  consent_lede: 'An AI client wants to work through WirLernenOnline with your rights. Sign in if you want to allow that.',
  consent_who: 'Who is asking',
  consent_destination: 'Your access will be sent here',
  consent_name: 'Name the client gave itself',
  consent_name_hint: 'The client chooses the name itself — <strong>what counts is the address above</strong>. Allow access only if you recognise it.',
  consent_scope_hint: 'Afterwards the client can search in your name and — as far as your account allows — edit content. You can end the access at any time under <a href="/auth-revoke.html">"Revoke an access"</a>.',
  consent_form: 'Sign in',
  consent_submit: 'Sign in and allow',
  consent_deny: 'Deny',
  consent_anonymous: 'Connect without a WLO account of my own',
  consent_anonymous_hint: 'You then see everything that is public without signing in — search, collections, topic pages and full texts. <strong>Creating or changing content is not possible that way.</strong> You can sign in later at any time by setting the connection up again.',
  consent_warn: '<strong>Sign in only if you have just connected this client yourself.</strong> Whoever gets the access can work with your WLO rights until it is revoked.',
  consent_checking: 'being checked …',
  consent_checking_request: 'Checking the request …',
  consent_stale: 'This request is no longer valid. Please connect again in the client.',
  consent_unknown: 'unknown',
  consent_busy: 'Encrypting and signing in …',
  consent_failed: 'The sign-in could not be completed.',
  consent_done: 'Signed in. Back to the client …',
  consent_denied: 'Denied. You can close this window.',
  consent_connecting: 'Connecting …',
};

/**
 * The language for this visit. Pure, so it can be tested without a browser.
 * @param {string} search    `location.search`
 * @param {readonly string[]} languages  `navigator.languages`
 * @returns {'de' | 'en'}
 */
export function pickLang(search, languages) {
  const asked = new URLSearchParams(search).get('lang');
  if (asked === 'de' || asked === 'en') return asked;
  for (const tag of languages ?? []) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (base === 'de' || base === 'en') return base;
  }
  return 'en';
}

/** @type {'de' | 'en'} */
let lang = 'de';
/** German as served, kept so switching back needs no second dictionary. */
const german = new Map();

/** The language in effect. */
export function currentLang() {
  return lang;
}

/**
 * A message from script: the English text for `key`, or the German one given.
 * The German stays where it is used, so a missing key can only ever cost the
 * translation, never the message.
 * @param {string} key
 * @param {string} de
 * @param {Record<string, string | number>} [vars]
 */
export function msg(key, de, vars) {
  let text = lang === 'en' && EN[key] ? EN[key] : de;
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(`{${name}}`, String(value));
  return text;
}

/** A message the SERVER sent. It is German; in English mode that is said, not hidden. */
export function serverMessage(text) {
  return lang === 'en' ? `${EN.server_said}${text}` : text;
}

function apply(next) {
  lang = next;
  document.documentElement.lang = next;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (!german.has(el)) german.set(el, el.innerHTML);
    // Ours either way: the page's own markup, or a text from the table above.
    el.innerHTML = next === 'en' && EN[key] ? EN[key] : german.get(el);
  }
  const title = document.documentElement.getAttribute('data-i18n-title');
  if (title) {
    if (!german.has(document)) german.set(document, document.title);
    document.title = next === 'en' && EN[title] ? EN[title] : german.get(document);
  }
  // The one-line English pointer is for a reader of the German page.
  for (const el of document.querySelectorAll('.lang-note')) el.hidden = next === 'en';
  for (const button of document.querySelectorAll('[data-lang]')) {
    button.setAttribute('aria-pressed', String(button.getAttribute('data-lang') === next));
  }
  // The choice travels to the sibling page, and only there — never into storage.
  for (const link of document.querySelectorAll('a[href^="/auth"]')) {
    const url = new URL(link.getAttribute('href'), location.origin);
    if (next === 'en') url.searchParams.set('lang', 'en'); else url.searchParams.delete('lang');
    link.setAttribute('href', url.pathname + url.search);
  }
}

/** Set the page to the visitor's language and wire the DE/EN switch. Call once, first. */
export function initI18n() {
  apply(pickLang(location.search, navigator.languages));
  for (const button of document.querySelectorAll('[data-lang]')) {
    button.addEventListener('click', () => apply(button.getAttribute('data-lang') === 'en' ? 'en' : 'de'));
  }
}
