/**
 * wikipedia-relevance.ts – pick the article a query is actually about, out of
 * the fuzzy candidates Wikipedia's opensearch returns.
 *
 * WHY this exists, and why HERE rather than on the finished summary:
 * measured live against de.wikipedia.org on 2026-08-02, every wrong article the
 * server produced came from the opensearch fallback, never from the direct
 * lookup:
 *
 *   Bruchrechnen  → direct 200 "Bruchrechnung"                 (right)
 *   Stadt Berlin  → direct 404, opensearch "Stadt Bern"        (wrong)
 *   Dreiecke      → direct 404, opensearch "Dreiecker"         (wrong — a mountain)
 *   Feinoptik     → direct 404, opensearch "Feinoptiker"       (acceptable)
 *
 * A direct hit is either the exact title or a Wikipedia REDIRECT, and a
 * redirect is a human editorial statement that the two names denote the same
 * topic. Checking those would only produce false negatives — "Bruchrechnen" and
 * "Bruchrechnung" share no prefix a rule could relate without a stemmer. So the
 * direct path is trusted and only opensearch candidates come through here.
 *
 * The second measured fact shapes the interface: for "Dreiecke" the CORRECT
 * article ("Dreieck") sat at position 5 while the wrong one was first. Judging
 * the single title opensearch happens to return first can therefore only ever
 * reject; choosing among a wider list can also get it right. This module picks,
 * it does not merely veto.
 *
 * Pure and I/O-free so the rules are testable without the network.
 */

/**
 * Preferred minimum length for the word taken to carry the topic — it keeps a
 * qualifier from outvoting the subject. Not a hard floor: when nothing longer
 * survives the stop words, the short words are used rather than answering
 * nothing (see `pickRelevantTitle`).
 */
const MIN_CONTENT_LENGTH = 4;

/**
 * Shortest title word that may take part in a morphological comparison. Guards
 * the prefix rules below from anchoring on a syllable.
 */
const MIN_STEM_LENGTH = 5;

/**
 * Words that cannot carry a topic on their own. Written post-normalization (no
 * diacritics), with "fuer" alongside "fur" because both spellings occur.
 *
 * The CLASSIFIER group is the one that earns its keep, and it is not optional
 * decoration. The topic is taken from the longest content word, so a generic
 * noun that happens to be longer than the proper name hijacks the whole match.
 * Measured live against the real client before these entries existed:
 *
 *   Insel Rab    → "Insel (Album)"     (a music album)
 *   Element Zinn → "Élément moral"     (a French legal concept)
 *   Fluss Po     → "Fluss-Greiskraut"  (a plant)
 *
 * In each case the classifier matched and the proper name was never weighed.
 * A query that IS the classifier ("Insel", "Stadt") is unaffected: it resolves
 * through the direct lookup, which never reaches these rules.
 *
 * The list is necessarily open-ended — an unlisted classifier can still hijack
 * a two-word query. When the log shows one, add it here.
 */
const STOP_WORDS = new Set([
  // grammar
  'und', 'oder', 'der', 'die', 'das', 'den', 'dem', 'des',
  'ein', 'eine', 'einer', 'einem', 'eines', 'fur', 'fuer', 'von', 'vom', 'zum', 'zur',
  // schooling qualifiers
  'klasse', 'schule', 'stufe', 'sek', 'fach', 'thema', 'unterricht',
  // classifiers: a generic noun in front of a proper name
  'stadt', 'land', 'ort', 'dorf', 'gemeinde', 'staat', 'bundesland', 'kanton',
  'insel', 'fluss', 'berg', 'gebirge', 'meer', 'ozean', 'region', 'gebiet',
  'element', 'stoff', 'begriff', 'sprache', 'tier', 'pflanze', 'planet',
]);

/**
 * Endings by which a German article title may legitimately extend the query
 * ("Feinoptik" → "Feinoptiker"). One-character endings are DELIBERATELY absent:
 * "Dreiecke" + "r" is "Dreiecker", a mountain in the Allgäu, not an inflection.
 * That single rule is what separates the measured false hit from a real one.
 */
const SAFE_SUFFIXES = new Set([
  'ung', 'heit', 'keit', 'schaft', 'tum', 'lich', 'bar', 'isch',
  'iker', 'iger', 'haft', 'lein', 'chen',
  'en', 'es', 'em', 'ern', 'ens', 'eln', 'er',
]);

/**
 * Fold a string to comparable tokens: strip diacritics (ü→u, é→e), lowercase,
 * and treat everything that is not a letter, digit or ß as a separator — so
 * "Stadt Überlingen (Schiff, 1929)" becomes ["stadt","uberlingen","schiff","1929"].
 *
 * The umlauts are NOT in the keep-class: NFKD has already decomposed them by
 * that point, so listing them would suggest a protection that does nothing. ß
 * does not decompose and is kept.
 */
export function normalizeTokens(raw: string): string[] {
  return (raw ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9ß]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * How strongly a QUERY word relates to a TITLE word. The argument order is not
 * decorative — the two prefix rules are deliberately asymmetric:
 *
 *  - a query LONGER than the title word is a compound or inflection of it
 *    ("bruchrechnung" ⊃ "bruch"): the article is the base concept, which is
 *    what the caller asked about. Accepted on the prefix alone.
 *
 *    KNOWN COST, measured: the remainder is unbounded, so a compound reaches
 *    the article of its MODIFIER — "wasserstoffperoxid" + ["Wasser"] yields
 *    "Wasser". German compounds are head-final, so the first element is
 *    precisely the wrong half to match on. No length ratio separates the two
 *    cases: "bruch" is 5 of 13 characters (38%), "wasser" 6 of 18 (33%), so any
 *    threshold that rejects the peroxide also rejects "Bruchrechnung" → "Bruch"
 *    — which the hand-over specifies as a REQUIRED hit. The looseness is
 *    therefore deliberate, and it only bites when the direct lookup already
 *    404'd and no better candidate exists.
 *  - a title LONGER than the query is something MORE SPECIFIC ("dreiecke" →
 *    "dreiecker"), which is where the measured false hits live. Accepted only
 *    when the extra part is a recognised derivation.
 *
 * @returns 2 for the same word, 1 for a morphological relation, 0 for none.
 */
function relate(queryWord: string, titleWord: string): 0 | 1 | 2 {
  if (queryWord === titleWord) return 2;
  if (titleWord.length >= MIN_STEM_LENGTH && queryWord.length > titleWord.length
      && queryWord.startsWith(titleWord)) {
    return 1;
  }
  if (queryWord.length >= MIN_STEM_LENGTH && titleWord.length > queryWord.length
      && titleWord.startsWith(queryWord)
      && SAFE_SUFFIXES.has(titleWord.slice(queryWord.length))) {
    return 1;
  }
  return 0;
}

/** Best relation between one word and any of a list. */
function relateBest(queryWord: string, titleWords: string[]): 0 | 1 | 2 {
  let best: 0 | 1 | 2 = 0;
  for (const tw of titleWords) {
    const r = relate(queryWord, tw);
    if (r > best) best = r;
    if (best === 2) break;
  }
  return best;
}

/**
 * Choose the candidate the query is about, or null when none of them is.
 *
 * A candidate must satisfy BOTH directions, which is what separates "the
 * article about my topic" from "an article that mentions my topic":
 *
 *  1. the query's longest content word must appear in the title — otherwise the
 *     title is not about the topic at all ("Stadt Bern" for "Stadt Berlin");
 *  2. the title's leading word must appear in the query — otherwise the topic
 *     is only a qualifier of some other subject ("Stabi Berlin", the state
 *     library, for "Stadt Berlin").
 *
 * Leading stop words are skipped in (2) so "Der Zauberberg" still leads with
 * "Zauberberg".
 *
 * Ties go to the shortest title, then to opensearch's own order: among
 * "Dreieck Essen-Ost" (a motorway junction) and "Dreieck", the plain concept is
 * the shorter one. The same "shortest title wins" rule as `matchSubjectPortal`.
 */
export function pickRelevantTitle(query: string, candidates: string[]): string | null {
  const queryTokens = normalizeTokens(query);
  if (!queryTokens.length) return null;

  const meaningful = queryTokens.filter(w => !STOP_WORDS.has(w));
  if (!meaningful.length) return null;

  // The length floor removes qualifiers while a real topic word is present. It
  // must not remove the topic itself: "Stadt Rom" is "stadt" (a stop word) plus
  // "rom" (three letters), which left nothing to match on and answered nothing
  // for a perfectly good query. Falling back to the short words is safe because
  // they can then only match a WHOLE word — `relate`'s morphological branches
  // keep their own MIN_STEM_LENGTH guard, so "rom" never reaches "Romane".
  const longEnough = meaningful.filter(w => w.length >= MIN_CONTENT_LENGTH);
  const contentWords = longEnough.length ? longEnough : meaningful;

  // The longest content word carries the topic; shorter ones are qualifiers
  // ("Klasse 7", "Satz"). Requiring ALL of them would reject "Photosynthese
  // Biologie" against the article "Photosynthese".
  const key = contentWords.reduce((a, b) => (b.length > a.length ? b : a));
  const queryJoined = queryTokens.join(' ');

  let best: { title: string; score: 1 | 2; covered: number; length: number } | null = null;

  for (const candidate of candidates) {
    const titleWords = normalizeTokens(candidate);
    if (!titleWords.length) continue;

    const titleJoined = titleWords.join(' ');
    if (titleJoined === queryJoined) return candidate;

    const score = relateBest(key, titleWords);
    if (score === 0) continue;

    const lead = titleWords.find(w => !STOP_WORDS.has(w)) ?? titleWords[0]!;
    if (!contentWords.some(qw => relate(qw, lead) > 0)) continue;

    // How much of the QUERY the candidate accounts for. Ranked below the topic
    // word (a title that nails the topic beats one that merely echoes two
    // qualifiers) but above title length: for "Satz Pythagoras", both
    // "Pythagoras" and "Satz des Pythagoras" relate to the topic, and the
    // second answers the actual question.
    const covered = contentWords.filter(qw => relateBest(qw, titleWords) > 0).length;

    if (best === null
        || score > best.score
        || (score === best.score && covered > best.covered)
        || (score === best.score && covered === best.covered && titleJoined.length < best.length)) {
      best = { title: candidate, score, covered, length: titleJoined.length };
    }
  }

  return best?.title ?? null;
}
