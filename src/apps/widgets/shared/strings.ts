/**
 * strings.ts – Tiny widget i18n table (German default, English fallback).
 *
 * Widget UI copy is not model-facing, so it must be localizable. The host
 * passes a locale hint via `window.openai.locale`; `resolveLocale` maps it to
 * one of the two supported languages and `t` looks up a string. Pure, DOM-free.
 */

export type Locale = 'de' | 'en';

const STRINGS = {
  de: {
    quoteOpen: '„',
    quoteClose: '“',
    previewAlt: 'Vorschaubild:',
    sectionTopicPages: 'Themenseiten',
    sectionCollections: 'Sammlungen',
    sectionContent: 'Inhalte',
    moreOnTopicPage: 'Mehr auf der Themenseite',
    noResults: 'Keine Treffer gefunden.',
    resultsFor: 'Ergebnisse für',
    subjectPortals: 'Fachportale',
    back: 'Zurück',
    open: 'Öffnen',
    badgeTopicPage: 'Themenseite',
    details: 'Details',
    detailsFor: 'Details zu',
    licenseLabel: 'Lizenz',
    sourceLabel: 'Quelle',
    openContent: 'Inhalt öffnen',
    openTopicPage: 'Zur Themenseite',
    askContents: 'Inhalte anzeigen',
    askPromptPrefix: 'Zeige mir die Inhalte der WLO-Sammlung',
  },
  en: {
    quoteOpen: '“',
    quoteClose: '”',
    previewAlt: 'Preview image:',
    sectionTopicPages: 'Topic pages',
    sectionCollections: 'Collections',
    sectionContent: 'Content',
    moreOnTopicPage: 'More on the topic page',
    noResults: 'No results found.',
    resultsFor: 'Results for',
    subjectPortals: 'Subject portals',
    back: 'Back',
    open: 'Open',
    badgeTopicPage: 'Topic page',
    details: 'Details',
    detailsFor: 'Details for',
    licenseLabel: 'License',
    sourceLabel: 'Source',
    openContent: 'Open content',
    openTopicPage: 'Open topic page',
    askContents: 'Show contents',
    askPromptPrefix: 'Show me the contents of the WLO collection',
  },
} as const;

export type StringKey = keyof (typeof STRINGS)['de'];

/** Map a raw BCP-47-ish locale hint to a supported language (German default). */
export function resolveLocale(raw: string | undefined): Locale {
  return typeof raw === 'string' && raw.toLowerCase().startsWith('en') ? 'en' : 'de';
}

export function t(locale: Locale, key: StringKey): string {
  return STRINGS[locale]?.[key] ?? STRINGS.de[key];
}
