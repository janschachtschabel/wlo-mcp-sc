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
    // Split from the count so the number can be composed in without an
    // interpolating `t()`; both halves are one sentence in the rendering.
    noResultsLicense: 'Kein Treffer mit genau der gewählten Lizenz.',
    licenseCandidatesChecked: 'geprüfte Kandidaten',
    licenseFamilyHint: 'Das Repository filtert Lizenzen nur als Familie — die genaue Auswahl passiert danach.',
    resultsFor: 'Ergebnisse für',
    subjectPortals: 'Fachportale',
    back: 'Zurück',
    open: 'Öffnen',
    badgeTopicPage: 'Themenseite',
    details: 'Details',
    detailsFor: 'Details zu',
    licenseLabel: 'Lizenz',
    licenseUnknown: 'nicht angegeben',
    sourceLabel: 'Quelle',
    openContent: 'Inhalt öffnen',
    openTopicPage: 'Zur Themenseite',
    askContents: 'Inhalte anzeigen',
    // W5 Lesetext
    originRepository: 'WLO-Repository',
    originExternal: 'verlinkte Seite',
    truncatedNote: 'Gekürzt — der vollständige Text ist länger.',
    actionsTitle: 'Weiterarbeiten',
    actionLabel_summarize: 'Zusammenfassen',
    actionLabel_simplify: 'Einfacher formulieren',
    actionLabel_exercises: 'Aufgaben ableiten',
    reasonNoText: 'Zu diesem Material ist kein Text hinterlegt.',
    reasonAccessDenied: 'Dieses Material ist nicht öffentlich zugänglich — der Text kann nicht gelesen werden.',
    reasonExtractionFailed: 'Der Text der verlinkten Seite konnte nicht gelesen werden.',
    reasonNodeNotFound: 'Dieses Material wurde nicht gefunden.',
    // Auswahl in der Kachelansicht
    selectLabel: 'Auswählen',
    treeMore: '… mehr vorhanden',
    selectionCount: 'ausgewählt',
    selectionUse: 'Ausgewählte weiterverwenden',
    selectionClear: 'Auswahl aufheben',
    selectionPrompt: 'Arbeite mit diesen WLO-Materialien weiter:',
    selectionPromptTail: 'Rufe dazu {tool} mit diesen {param} auf.',
    // Folgeaktionen auf Kacheln und in der Einzelansicht
    followUpTool: 'Rufe dazu {tool} mit dieser {param} auf.',
    followUp_contents: 'Zeige mir die Inhalte der WLO-Sammlung',
    followUp_topicPage: 'Zeige mir die WLO-Themenseite',
    followUp_text: 'Zeige mir den Volltext von',
    followUp_related: 'Zeige mir ähnliche Inhalte zu',
    followUp_summarize: 'Fasse den Inhalt zusammen von',
    followUp_simplify: 'Formuliere den Inhalt einfacher (leichtere Sprache) von',
    followUp_exercises: 'Leite Übungsaufgaben ab aus',
    actionContents: 'Inhalte anzeigen',
    actionTopicPage: 'Themenseite öffnen',
    actionText: 'Volltext anzeigen',
    actionRelated: 'Ähnliche Inhalte',
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
    noResultsLicense: 'Nothing carries exactly the licence you asked for.',
    licenseCandidatesChecked: 'candidates checked',
    licenseFamilyHint: 'The repository can only filter licence families — the exact selection happens afterwards.',
    resultsFor: 'Results for',
    subjectPortals: 'Subject portals',
    back: 'Back',
    open: 'Open',
    badgeTopicPage: 'Topic page',
    details: 'Details',
    detailsFor: 'Details for',
    licenseLabel: 'License',
    licenseUnknown: 'not stated',
    sourceLabel: 'Source',
    openContent: 'Open content',
    openTopicPage: 'Open topic page',
    askContents: 'Show contents',
    // W5 reading view
    originRepository: 'WLO repository',
    originExternal: 'linked page',
    truncatedNote: 'Shortened — the full text is longer.',
    actionsTitle: 'Work with this',
    actionLabel_summarize: 'Summarize',
    actionLabel_simplify: 'Simplify wording',
    actionLabel_exercises: 'Derive exercises',
    reasonNoText: 'No text is stored for this material.',
    reasonAccessDenied: 'This material is not publicly accessible — its text cannot be read.',
    reasonExtractionFailed: 'The text of the linked page could not be read.',
    reasonNodeNotFound: 'This material was not found.',
    // Tile selection
    selectLabel: 'Select',
    treeMore: '… more available',
    selectionCount: 'selected',
    selectionUse: 'Use selected',
    selectionClear: 'Clear selection',
    selectionPrompt: 'Continue working with these WLO materials:',
    selectionPromptTail: 'Call {tool} with these {param}.',
    // Follow-up actions on tiles and in the detail view
    followUpTool: 'Call {tool} with this {param}.',
    followUp_contents: 'Show me the contents of the WLO collection',
    followUp_topicPage: 'Show me the WLO topic page',
    followUp_text: 'Show me the full text of',
    followUp_related: 'Show me content similar to',
    followUp_summarize: 'Summarize the content of',
    followUp_simplify: 'Rewrite in simpler language the content of',
    followUp_exercises: 'Derive practice exercises from',
    actionContents: 'Show contents',
    actionTopicPage: 'Open topic page',
    actionText: 'Show full text',
    actionRelated: 'Similar content',
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
