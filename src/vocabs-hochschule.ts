/**
 * vocabs-hochschule.ts – University subject labels (Hochschulfächersystematik).
 *
 * DISPLAY-ONLY (URI -> German label) for the 344 concepts of the
 * Hochschulfächersystematik SKOS vocabulary
 * (https://vocabs.openeduhub.de/w3id.org/openeduhub/vocabs/hochschulfaechersystematik/index.json).
 *
 * Why separate from vocabs.ts DISCIPLINE and why NOT wired into resolveVocab:
 * many labels are shared with the SCHOOL subject vocabulary ("Mathematik",
 * "Physik", "Informatik", ...), so using them for INPUT (label -> URI) would make
 * a filter like discipline="Mathematik" ambiguous. Keyed by the URI slug (n<NN>,
 * disjoint from the school vocab keys), this table only ever turns a university
 * subject URI that appears in a facet/result back INTO a readable label. Input
 * resolution stays school-only in vocabs.ts.
 *
 * Generated data — regenerate from the vocab index.json above (id slug -> prefLabel.de).
 */

import { levenshtein } from './text-distance.js';

const HOCHSCHUL_SUBJECT_LABELS: Readonly<Record<string, string>> = {
  n0: "Fachübergreifend",
  n1: "Geisteswissenschaften",
  n01: "Geisteswissenschaften allgemein",
  n004: "Interdisziplinäre Studien (Schwerpunkt Geisteswissenschaften)",
  n090: "Lernbereich Geisteswissenschaften",
  n02: "Evang. Theologie, -Religionslehre",
  n161: "Diakoniewissenschaft",
  n544: "Evang. Religionspädagogik, kirchliche Bildungsarbeit",
  n053: "Evang. Theologie, -Religionslehre",
  n03: "Kath. Theologie, -Religionslehre",
  n162: "Caritaswissenschaft",
  n545: "Kath. Religionspädagogik, kirchliche Bildungsarbeit",
  n086: "Kath. Theologie, -Religionslehre",
  n04: "Studienbereich Philosophie",
  n169: "Ethik",
  n127: "Philosophie",
  n136: "Religionswissenschaft",
  n05: "Studienbereich Geschichte",
  n272: "Alte Geschichte",
  n012: "Archäologie",
  n068: "Geschichte",
  n273: "Mittlere und neuere Geschichte",
  n548: "Ur- und Frühgeschichte",
  n183: "Wirtschafts-/Sozialgeschichte",
  n275: "Wissenschaftsgeschichte/Technikgeschichte",
  n06: "Informations- und Bibliothekswissenschaften",
  n022: "Informations- und Bibliothekswissenschaften (nicht für Verwaltungsfachhochschulen)",
  n037: "Archiv- und Dokumentationswissenschaft",
  n07: "Allgemeine und vergleichende Literatur- und Sprachwissenschaft",
  n188: "Allgemeine Literaturwissenschaft",
  n152: "Allgemeine Sprachwissenschaft/Indogermanistik",
  n284: "Angewandte Sprachwissenschaft",
  n018: "Berufsbezogene Fremdsprachenausbildung",
  n160: "Computerlinguistik",
  n08: "Altphilologie (klass. Philologie), Neugriechisch",
  n031: "Byzantinistik",
  n070: "Griechisch",
  n005: "Klassische Philologie",
  n095: "Latein",
  n043: "Neugriechisch",
  n09: "Germanistik (Deutsch, germanische Sprachen ohne Anglistik)",
  n034: "Dänisch",
  n271: "Deutsch als Fremdsprache oder als Zweitsprache",
  n067: "Germanistik/Deutsch",
  n189: "Niederdeutsch",
  n119: "Niederländisch",
  n120: "Nordistik/Skandinavistik (Nordische Philologie, Einzelsprachen a.n.g.)",
  n10: "Anglistik, Amerikanistik",
  n006: "Amerikanistik/Amerikakunde",
  n008: "Anglistik/Englisch",
  n11: "Romanistik",
  n059: "Französisch",
  n084: "Italienisch",
  n131: "Portugiesisch",
  n137: "Romanistik (Roman. Philologie, Einzelsprachen a.n.g.)",
  n150: "Spanisch",
  n12: "Slawistik, Baltistik, Finno-Ugristik",
  n016: "Baltistik",
  n056: "Finno-Ugristik",
  n206: "Polnisch",
  n139: "Russisch",
  n146: "Slawistik (Slaw. Philologie)",
  n207: "Sorabistik",
  n153: "Südslawisch (Bulgarisch, Serbokroatisch Slowenisch usw.)",
  n209: "Tschechisch",
  n130: "Westslawisch (allgemein und a.n.g.)",
  n13: "Sonstige Sprach- und Kulturwissenschaften",
  n002: "Afrikanistik",
  n001: "Ägyptologie",
  n010: "Arabisch/Arabistik",
  n187: "Asiatische Sprachen und Kulturen/Asienwissenschaften",
  n015: "Außereuropäische Sprachen und Kulturen in Ozeanien und Amerika",
  n073: "Judaistik/Hebräisch",
  n078: "Indologie",
  n081: "Iranistik",
  n083: "Islamwissenschaft",
  n085: "Japanologie",
  n180: "Kaukasistik",
  n122: "Orientalistik/Altorientalistik",
  n145: "Sinologie/Koreanistik",
  n158: "Turkologie",
  n14: "Kulturwissenschaften i.e.S.",
  n173: "Ethnologie",
  n024: "Europäische Ethnologie und Kulturwissenschaft",
  n174: "Volkskunde",
  n18: "Islamische Studien/Islamische Theologie",
  n292: "Islamische Studien/Islamische Theologie",
  n19: "Medienwissenschaft",
  n302: "Medienwissenschaft",
  n2: "Sport",
  n22: "Sport, Sportwissenschaft",
  n098: "Sportpädagogik/Sportpsychologie",
  n029: "Sportwissenschaft",
  n3: "Rechts-, Wirtschafts- und Sozialwissenschaften",
  n23: "Rechts-, Wirtschafts- und Sozialwissenschaften allgemein",
  n030: "Interdisziplinäre Studien (Schwerpunkt Rechts-, Wirtschafts- und Sozialwissenschaften)",
  n154: "Lernbereich Gesellschaftslehre",
  n055: "Orientierungsstudium Gesellschaftswissenschaften",
  n24: "Regionalwissenschaften",
  n038: "Lateinamerika-Studien",
  n044: "Ost- und Südosteuropa-Studien",
  n036: "Sonstige Regionalwissenschaften",
  n25: "Politikwissenschaft",
  n129: "Politikwissenschaft/Politologie",
  n26: "Sozialwissenschaften/Soziologie",
  n147: "Sozialkunde",
  n148: "Sozialwissenschaften",
  n149: "Soziologie",
  n27: "Studienbereich Sozialwesen",
  n208: "Soziale Arbeit",
  n245: "Sozialpädagogik",
  n253: "Sozialwesen",
  n28: "Rechtswissenschaften",
  n135: "Rechtswissenschaft",
  n042: "Wirtschaftsrecht",
  n29: "Verwaltungswissenschaften",
  n257: "Arbeits- und Berufsberatung",
  n258: "Arbeitsverwaltung",
  n255: "Archivwesen",
  n259: "Auswärtige Angelegenheiten",
  n265: "Bankwesen",
  n262: "Bibliothekswesen",
  n260: "Bundeswehrverwaltung",
  n266: "Finanzverwaltung",
  n261: "Innere Verwaltung",
  n168: "Justizvollzug",
  n263: "Polizei/Verfassungsschutz",
  n256: "Rechtspflege",
  n264: "Sozialversicherung",
  n268: "Verkehrswesen",
  n172: "Verwaltungswissenschaft/-wesen",
  n269: "Zoll- und Steuerverwaltung",
  n30: "Studienbereich Wirtschaftswissenschaften",
  n011: "Arbeitslehre/Wirtschaftslehre",
  n021: "Betriebswirtschaftslehre",
  n167: "Europäische Wirtschaft",
  n182: "Internationale Betriebswirtschaft/Management",
  n304: "Medienwirtschaft/Medienmanagement",
  n166: "Sportmanagement/Sportökonomie",
  n274: "Tourismuswirtschaft",
  n210: "Verkehrswirtschaft",
  n175: "Volkswirtschaftslehre",
  n181: "Wirtschaftspädagogik",
  n184: "Wirtschaftswissenschaften",
  n31: "Studienbereich Wirtschaftsingenieurwesen mit wirtschaftswissenschaftlichem Schwerpunkt",
  n464: "Facility Management",
  n179: "Wirtschaftsingenieurwesen mit wirtschaftswissenschaftlichem Schwerpunkt",
  n32: "Studienbereich Psychologie",
  n132: "Psychologie",
  n33: "Erziehungswissenschaften",
  n117: "Ausländerpädagogik",
  n270: "Berufs- und Wirtschaftspädagogik",
  n321: "Erwachsenenbildung und außerschulische Jugendbildung",
  n052: "Erziehungswissenschaft (Pädagogik)",
  n115: "Grundschul-/Primarstufenpädagogik",
  n365: "Pädagogik der frühen Kindheit",
  n254: "Sachunterricht (einschl. Schulgarten)",
  n361: "Schulpädagogik",
  n190: "Sonderpädagogik",
  n34: "Kommunikationswissenschaft/Publizistik",
  n303: "Kommunikationswissenschaft/Publizistik",
  n4: "Mathematik, Naturwissenschaften",
  n36: "Mathematik, Naturwissenschaften allgemein",
  n049: "Interdisziplinäre Studien (Schwerpunkt Naturwissenschaften)",
  n186: "Lernbereich Naturwissenschaften/Sachunterricht",
  n019: "Orientierungsstudium MINT",
  n312: "Statistik",
  n37: "Mathematik",
  n105: "Mathematik",
  n118: "Technomathematik",
  n276: "Wirtschaftsmathematik",
  n39: "Physik, Astronomie",
  n014: "Astrophysik und Astronomie",
  n0128: "Physik",
  n40: "Studienbereich Chemie",
  n025: "Biochemie",
  n032: "Chemie",
  n096: "Lebensmittelchemie",
  n41: "Studienbereich Pharmazie",
  n126: "Pharmazie",
  n42: "Studienbereich Biologie",
  n009: "Anthropologie (Humanbiologie)",
  n026: "Biologie",
  n300: "Biomedizin",
  n282: "Biotechnologie",
  n43: "Geowissenschaften (ohne Geographie)",
  n065: "Geologie/Paläontologie",
  n385: "Geoökologie",
  n066: "Geophysik",
  n039: "Geowissenschaften allgemein",
  n110: "Meteorologie",
  n111: "Mineralogie",
  n124: "Ozeanographie",
  n44: "Geographie",
  n283: "Landschaftsökologie/Biogeographie",
  n050: "Geographie/Erdkunde",
  n178: "Wirtschafts-/Sozialgeographie",
  n5: "Humanmedizin/Gesundheitswissenschaften",
  n48: "Gesundheitswissenschaften allgemein",
  n195: "Gesundheitspädagogik",
  n232: "Gesundheitswissenschaft/-management",
  n233: "Nichtärztliche Heilberufe/Therapien",
  n234: "Pflegewissenschaft/-management",
  n49: "Humanmedizin (ohne Zahnmedizin)",
  n107: "Medizin (Allgemein-Medizin)",
  n50: "Studienbereich Zahnmedizin",
  n185: "Zahnmedizin",
  n7: "Agrar-, Forst- und Ernährungswissenschaften, Veterinärmedizin",
  n51: "Veterinärmedizin",
  n156: "Tiermedizin/Veterinärmedizin",
  n57: "Landespflege, Umweltgestaltung",
  n093: "Landespflege/Landschaftsgestaltung",
  n061: "Meliorationswesen",
  n064: "Naturschutz",
  n58: "Agrarwissenschaften, Lebensmittel- und Getränketechnologie",
  n138: "Agrarbiologie",
  n125: "Agrarökonomie",
  n003: "Agrarwissenschaft/Landwirtschaft",
  n028: "Brauwesen/Getränketechnologie",
  n060: "Gartenbau",
  n097: "Lebensmitteltechnologie",
  n220: "Milch- und Molkereiwirtschaft",
  n353: "Pflanzenproduktion",
  n371: "Tierproduktion",
  n227: "Weinbau und Kellerwirtschaft",
  n59: "Forstwissenschaft, Holzwirtschaft",
  n058: "Forstwissenschaft, -wirtschaft",
  n075: "Holzwirtschaft",
  n60: "Ernährungs- und Haushaltswissenschaften",
  n320: "Ernährungswissenschaft",
  n071: "Haushalts- und Ernährungswissenschaft",
  n333: "Haushaltswissenschaft",
  n8: "Ingenieurwissenschaften",
  n61: "Ingenieurwesen allgemein",
  n140: "Angewandte Systemwissenschaften",
  n072: "Interdisziplinäre Studien (Schwerpunkt Ingenieurwissenschaften)",
  n199: "Lernbereich Technik",
  n380: "Mechatronik",
  n305: "Medientechnik",
  n310: "Regenerative Energien",
  n201: "Werken (technisch)/Technologie",
  n62: "Bergbau, Hüttenwesen",
  n390: "Archäometrie (Ingenieurarchäologie)",
  n020: "Bergbau/Bergtechnik",
  n076: "Hütten- und Gießereiwesen",
  n103: "Markscheidewesen",
  n63: "Maschinenbau/Verfahrenstechnik",
  n141: "Abfallwirtschaft",
  n143: "Augenoptik",
  n033: "Chemie-Ingenieurwesen/Chemieverfahrenstechnik",
  n231: "Druck- und Reproduktionstechnik",
  n211: "Energieverfahrenstechnik",
  n212: "Feinwerktechnik",
  n202: "Fertigungs-/Produktionstechnik",
  n215: "Gesundheitstechnik",
  n216: "Glastechnik/Keramik",
  n082: "Holz-/Fasertechnik",
  n219: "Kunststofftechnik",
  n104: "Maschinenbau/-wesen",
  n108: "Metalltechnik",
  n224: "Physikalische Technik/Mechanische Verfahrenstechnik",
  n144: "Technische Kybernetik",
  n225: "Textil- und Bekleidungstechnik/-gewerbe",
  n074: "Transport-/Fördertechnik",
  n457: "Umwelttechnik (einschl. Recycling)",
  n226: "Verfahrenstechnik",
  n213: "Versorgungstechnik",
  n64: "Elektrotechnik und Informationstechnik",
  n316: "Elektrische Energietechnik",
  n048: "Elektrotechnik/Elektronik",
  n222: "Kommunikations- und Informationstechnik",
  n157: "Mikroelektronik",
  n286: "Mikrosystemtechnik",
  n088: "Optoelektronik",
  n65: "Verkehrstechnik, Nautik",
  n235: "Fahrzeugtechnik",
  n057: "Luft- und Raumfahrttechnik",
  n223: "Nautik/Seefahrt",
  n142: "Schiffbau/Schiffstechnik",
  n089: "Verkehrsingenieurwesen",
  n66: "Architektur, Innenarchitektur",
  n013: "Architektur",
  n242: "Innenarchitektur",
  n67: "Studienbereich Raumplanung",
  n134: "Raumplanung",
  n458: "Umweltschutz",
  n68: "Bauingenieurwesen",
  n017: "Bauingenieurwesen/Ingenieurbau",
  n197: "Holzbau",
  n429: "Stahlbau",
  n094: "Wasserbau",
  n077: "Wasserwirtschaft",
  n69: "Vermessungswesen",
  n280: "Kartographie",
  n171: "Vermessungswesen (Geodäsie)",
  n70: "Studienbereich Wirtschaftsingenieurwesen mit ingenieurwissenschaftlichem Schwerpunkt",
  n370: "Wirtschaftsingenieurwesen mit ingenieurwissenschaftlichem Schwerpunkt",
  n71: "Studienbereich Informatik",
  n221: "Bioinformatik",
  n200: "Computer- und Kommunikationstechniken",
  n079: "Informatik",
  n123: "Ingenieurinformatik/Technische Informatik",
  n121: "Medieninformatik",
  n247: "Medizinische Informatik",
  n277: "Wirtschaftsinformatik",
  n72: "Materialwissenschaft und Werkstofftechnik",
  n294: "Materialwissenschaft",
  n177: "Werkstofftechnik",
  n9: "Kunst, Kunstwissenschaft",
  n74: "Kunst, Kunstwissenschaft allgemein",
  n040: "Interdisziplinäre Studien (Schwerpunkt Kunst, Kunstwissenschaft)",
  n091: "Kunsterziehung",
  n092: "Kunstgeschichte, Kunstwissenschaft",
  n101: "Restaurierungskunde",
  n75: "Studienbereich Bildende Kunst",
  n023: "Bildende Kunst/Graphik",
  n205: "Bildhauerei/Plastik",
  n204: "Malerei",
  n287: "Neue Medien",
  n76: "Gestaltung",
  n007: "Angewandte Kunst",
  n159: "Edelstein- und Schmuckdesign",
  n069: "Graphikdesign/Kommunikationsgestaltung",
  n203: "Industriedesign/Produktgestaltung",
  n116: "Textilgestaltung",
  n176: "Werkerziehung",
  n77: "Darstellende Kunst, Film und Fernsehen, Theaterwissenschaft",
  n035: "Darstellende Kunst/Bühnenkunst/Regie",
  n054: "Film und Fernsehen",
  n102: "Schauspiel",
  n106: "Tanzpädagogik",
  n155: "Theaterwissenschaft",
  n78: "Musik, Musikwissenschaft",
  n192: "Dirigieren",
  n230: "Gesang",
  n080: "Instrumentalmusik",
  n164: "Jazz und Popularmusik",
  n193: "Kirchenmusik",
  n191: "Komposition",
  n113: "Musikerziehung",
  n114: "Musikwissenschaft/-geschichte",
  n165: "Orchestermusik",
  n163: "Rhythmik",
  n194: "Tonmeister",
};

/**
 * German label for a Hochschulfächersystematik subject URI, or null when the URI
 * is not from that vocabulary / is unknown. Guarded on the vocab name so a
 * school-subject URI can never accidentally match here.
 */
export function universitySubjectLabel(uri: string): string | null {
  if (!uri || !uri.includes('hochschulfaechersystematik')) return null;
  const path = uri.split(/[#?]/)[0]!;
  const slug = path.split('/').filter(Boolean).pop() ?? '';
  // Own-property guard: bracket access would otherwise return an inherited
  // Object.prototype member (e.g. a `toString` slug → the function).
  return Object.hasOwn(HOCHSCHUL_SUBJECT_LABELS, slug) ? HOCHSCHUL_SUBJECT_LABELS[slug]! : null;
}

/** Concept-URI prefix WLO stores in `ccm:taxonid` for this vocabulary (verified
 *  against the live discipline facet, e.g. `…/hochschulfaechersystematik/n8`). */
const HOCHSCHUL_URI_PREFIX = 'http://w3id.org/openeduhub/vocabs/hochschulfaechersystematik/';

const MAX_UNI_SUGGESTIONS = 8;
const MAX_UNI_EDIT_DISTANCE = 2;
const MIN_UNI_TOKEN_LEN = 3;

export interface UniversitySubjectMatch {
  /** Full Hochschulfächersystematik concept URI — usable as a `discipline` filter. */
  uri: string;
  /** German prefLabel of the concept. */
  label: string;
}

interface RankedMatch extends UniversitySubjectMatch { tier: number; dist: number }

/**
 * Model-free fuzzy lookup over the Hochschulfächersystematik labels: turn a
 * free-text term into a SHORT, deduplicated candidate list of `{uri, label}` for
 * a chatbot to pick from — never an automatic single match (the reason this vocab
 * is deliberately kept out of `resolveVocab`; the model, not the server, makes
 * the final pick). Ranking: exact label, then substring, then a per-word
 * Levenshtein hit (≤ 2). The returned URI is the real `ccm:taxonid` form, so the
 * chosen candidate works directly as a `discipline` filter value (URI pass-through).
 *
 * Purely local and O(vocab) — no ML, no I/O, no runtime dependency.
 *
 * @param input free-text subject term (e.g. "Maschinenbau")
 * @param limit maximum candidates to return (default 8)
 * @returns ranked `{uri, label}` candidates; `[]` for empty input
 */
export function suggestUniversitySubjects(input: string, limit = MAX_UNI_SUGGESTIONS): UniversitySubjectMatch[] {
  const needle = input?.trim().toLowerCase();
  if (!needle) return [];

  const ranked: RankedMatch[] = [];
  for (const [slug, label] of Object.entries(HOCHSCHUL_SUBJECT_LABELS)) {
    const hay = label.toLowerCase();
    let tier: number | null = null;
    let dist = 0;

    if (hay === needle) {
      tier = 0;
    } else if (
      needle.length >= MIN_UNI_TOKEN_LEN && hay.length >= MIN_UNI_TOKEN_LEN &&
      (hay.includes(needle) || needle.includes(hay))
    ) {
      tier = 1;
      dist = Math.abs(hay.length - needle.length); // tighter (label ≈ query) ranks first
    } else {
      let best = Infinity;
      for (const word of hay.split(/[^a-zà-ÿ0-9]+/i)) {
        if (word.length < MIN_UNI_TOKEN_LEN) continue;
        const d = levenshtein(needle, word);
        if (d < best) best = d;
      }
      if (best <= MAX_UNI_EDIT_DISTANCE) { tier = 2; dist = best; }
    }

    if (tier !== null) ranked.push({ uri: HOCHSCHUL_URI_PREFIX + slug, label, tier, dist });
  }

  ranked.sort((a, b) =>
    a.tier - b.tier || a.dist - b.dist || a.label.length - b.label.length || a.label.localeCompare(b.label),
  );

  // One entry per label keeps the choice list clean — the vocab has genuine
  // duplicate prefLabels (e.g. "Physik") on different concept URIs; showing the
  // same label twice would defeat the point of a disambiguation pick.
  const out: UniversitySubjectMatch[] = [];
  const seen = new Set<string>();
  for (const r of ranked) {
    if (seen.has(r.label)) continue;
    seen.add(r.label);
    out.push({ uri: r.uri, label: r.label });
    if (out.length >= limit) break;
  }
  return out;
}
