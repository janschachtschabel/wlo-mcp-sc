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
    loading: 'Wird geladen …',
    loadError: 'Inhalt konnte nicht geladen werden.',
    back: 'Zurück',
    open: 'Öffnen',
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
    loading: 'Loading …',
    loadError: 'Content could not be loaded.',
    back: 'Back',
    open: 'Open',
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
