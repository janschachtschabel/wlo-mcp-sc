/**
 * vocabs-lrt.ts – the `new_lrt` vocabulary (educational object types).
 *
 * GENERATED — do not edit by hand. Run `node scripts/generate-lrt-vocab.mjs`
 * to regenerate from https://vocabs.openeduhub.de/w3id.org/openeduhub/vocabs/new_lrt/index.json
 *
 * This is the vocabulary a curator picks from when setting `ccm:oeh_lrt`. It is
 * NOT the same axis as `new_lrt_aggregated` (which `src/vocabs.ts` carries for
 * search filters): that one is a flat list of media types, this one a hierarchy
 * of educational object types.
 *
 * We never write `ccm:oeh_lrt_aggregated` — the repository derives it, and the
 * derivation rule is published in this vocabulary itself. `AGGREGATION` carries
 * that rule so a tool can tell a curator, before they choose, that 6
 * of the concepts map to nothing and material tagged only with those stays
 * invisible to aggregated content-type facets.
 *
 * Generated 220 concepts · 214 with an aggregation · 6 without.
 */

export const LRT_BASE = 'http://w3id.org/openeduhub/vocabs/new_lrt/';
export const LRT_AGGREGATED_BASE = 'http://w3id.org/openeduhub/vocabs/new_lrt_aggregated/';

export interface LrtConcept {
  /** Full URI, written to `ccm:oeh_lrt`. */
  uri: string;
  /** German prefLabel. */
  label: string;
  /** The aggregated concept the repository derives, or null for the 6 without one. */
  aggregatedUri: string | null;
  /** Label of the parent concept — what tells two same-named concepts apart. */
  path: string;
  /** German altLabels, if any. */
  aliases: string[];
}

/** [label, uuid, aggregatedUuid | '', parentLabel, aliases?] */
type Row = [string, string, string, string, string[]?];

const ROWS: Row[] = [
  ['Quelle', '3869b453-d3c1-4b34-8f25-9127e9d68766', '2e678af3-1026-4171-b88e-3b3a915d1673', ''],
  ['Kollektion, Sammlung oder Kanal', '04693b11-8b39-42aa-964f-578be063a851', '2e678af3-1026-4171-b88e-3b3a915d1673', 'Quelle'],
  ['Wörterbuch', '5176beb5-147b-446a-8baf-a2ae693431ec', '2e678af3-1026-4171-b88e-3b3a915d1673', 'Quelle'],
  ['Portal', '5bc29626-4b74-47d3-9428-f3baff9fc9ee', '2e678af3-1026-4171-b88e-3b3a915d1673', 'Quelle'],
  ['Stream und RSS', '834969d7-c70d-4685-94a4-17cebf0dec7d', '2e678af3-1026-4171-b88e-3b3a915d1673', 'Quelle'],
  ['Lexikon oder Enzyklopädie', '9f40cd56-8def-46cc-a21b-63d9557dc93d', '2e678af3-1026-4171-b88e-3b3a915d1673', 'Quelle'],
  ['Datenbank', 'ac0ad1e8-d1a2-42f2-961e-5aa9b8157fa5', '2e678af3-1026-4171-b88e-3b3a915d1673', 'Quelle'],
  ['Repository', 'b84255b1-f760-4420-a8f5-b0b608a53cd9', '2e678af3-1026-4171-b88e-3b3a915d1673', 'Quelle'],
  ['Suchmaschine', 'ce6c29f7-7bfd-4b84-a676-ac51e8601969', '2e678af3-1026-4171-b88e-3b3a915d1673', 'Quelle'],
  ['Referatory', 'e0496c2f-0ce0-4c1d-8381-796ea4d7a98a', '2e678af3-1026-4171-b88e-3b3a915d1673', 'Quelle'],
  ['Bildungsangebot', '03ab835b-c39c-48d1-b5af-7611de2f6464', '6b6786df-9ce9-44bf-8a04-caebd4456fcf', ''],
  ['Studiengang', '337eb29c-1ea8-41dc-9caf-e469eea29177', '6b6786df-9ce9-44bf-8a04-caebd4456fcf', 'Bildungsangebot'],
  ['Schulbildung(sangebot)', '37ff95b3-5093-455e-9696-045a76cac057', '6b6786df-9ce9-44bf-8a04-caebd4456fcf', 'Bildungsangebot'],
  ['Ausbildungsberuf', '44439cda-f3a8-4603-937b-71be3a64cfa4', '6b6786df-9ce9-44bf-8a04-caebd4456fcf', 'Bildungsangebot'],
  ['Fortbildungsangebot', '4fe167ea-1f40-44b7-8c17-355f256b4fc9', '6b6786df-9ce9-44bf-8a04-caebd4456fcf', 'Bildungsangebot'],
  ['Frühkindliches Bildungsangebot und KITA', '65330f23-2802-4789-86ee-c21f9afe74b1', '6b6786df-9ce9-44bf-8a04-caebd4456fcf', 'Bildungsangebot'],
  ['außerschulische Angebot (Bildungsangebot)', 'c903a62a-17b0-4646-b2b8-a1a02a84e8cc', '6b6786df-9ce9-44bf-8a04-caebd4456fcf', 'Bildungsangebot'],
  ['Termin, Event und Veranstaltung', '955590ae-5f06-4513-98e9-91dfa8d5a05e', 'b06c5816-60c7-4f1b-bcd7-95d70aaa4740', ''],
  ['Wettbewerbe', '81578410-73df-4320-83fd-2e6e0c0fd189', 'b06c5816-60c7-4f1b-bcd7-95d70aaa4740', 'Termin, Event und Veranstaltung'],
  ['außerschulisches Angebot', '92dcc3ec-fe94-451c-95ac-ea305e0e7597', 'b06c5816-60c7-4f1b-bcd7-95d70aaa4740', 'Termin, Event und Veranstaltung'],
  ['Fortbildungsangebot (Termin)', 'bd471374-c6f3-4c1b-905b-1b369a6fe63b', 'b06c5816-60c7-4f1b-bcd7-95d70aaa4740', 'Termin, Event und Veranstaltung'],
  ['Messe', 'e0f073ae-9c5d-453c-89eb-dbad42f3ec7a', 'b06c5816-60c7-4f1b-bcd7-95d70aaa4740', 'Termin, Event und Veranstaltung'],
  ['Workshop und Barcamp', 'e9dc6f6b-5e9d-44da-8701-74212b75eb31', 'b06c5816-60c7-4f1b-bcd7-95d70aaa4740', 'Termin, Event und Veranstaltung'],
  ['Fachtagung', 'ffff857b-e450-49b2-882b-5820bada2a42', 'b06c5816-60c7-4f1b-bcd7-95d70aaa4740', 'Termin, Event und Veranstaltung'],
  ['Methode', '0a79a1d0-583b-47ce-86a7-517ab352d796', '101c0c66-5202-4eba-9ebf-79f4903752b9', ''],
  ['Pädagogische Methode, Konzept', '477115fd-5042-4174-ac39-7c05f8a24766', '101c0c66-5202-4eba-9ebf-79f4903752b9', 'Methode'],
  ['Icebreaker', '07659554-35b3-4b6b-82cd-d6b2db3fbc56', '101c0c66-5202-4eba-9ebf-79f4903752b9', 'Pädagogische Methode, Konzept'],
  ['Energizer und Auflockerungsübung', '3e0501ce-980f-4898-8ba4-cde0e47d15b2', '101c0c66-5202-4eba-9ebf-79f4903752b9', 'Pädagogische Methode, Konzept'],
  ['Entdeckendes Lernen', '55e55bef-c93f-462f-9163-7731e130a94d', '101c0c66-5202-4eba-9ebf-79f4903752b9', 'Pädagogische Methode, Konzept'],
  ['Gruppenarbeit', '59c470f9-cea2-4a26-bc10-f46f3764af24', '101c0c66-5202-4eba-9ebf-79f4903752b9', 'Pädagogische Methode, Konzept'],
  ['Stationenlernen', '74a7c3cb-82db-4e63-8c0d-1726e2fe53b4', '101c0c66-5202-4eba-9ebf-79f4903752b9', 'Pädagogische Methode, Konzept'],
  ['Barcamp', '81898764-d52b-4d25-9ee9-04d9c3553b23', '101c0c66-5202-4eba-9ebf-79f4903752b9', 'Pädagogische Methode, Konzept'],
  ['Projekt', '85b94e6e-3246-4371-a0dc-36f309901625', '101c0c66-5202-4eba-9ebf-79f4903752b9', 'Pädagogische Methode, Konzept'],
  ['Rollenspiel', 'abfd1f4c-c649-4086-a985-5d5567d0980f', '101c0c66-5202-4eba-9ebf-79f4903752b9', 'Pädagogische Methode, Konzept'],
  ['Experiment', 'fe298cb9-fe5e-400e-8319-9b5b2e77352e', '101c0c66-5202-4eba-9ebf-79f4903752b9', 'Pädagogische Methode, Konzept'],
  ['Tool-Einsatzszenarien', 'dd9e02fa-0501-4779-aeb2-6f50c4d0d502', '101c0c66-5202-4eba-9ebf-79f4903752b9', 'Methode'],
  ['Unterrichtsgerüst (edu-pattern)', '67b7cd56-d98b-4731-baec-465fb03703e7', '101c0c66-5202-4eba-9ebf-79f4903752b9', 'Methode'],
  ['Tool', 'cefccf75-cba3-427d-9a0f-35b4fedcbba1', '37a3ad9c-727f-4b74-bbab-27d59015c695', ''],
  ['Präsentation (Tool)', '4277f19c-35ce-45c6-bb95-0463a6f4526b', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Tool'],
  ['Präsentations-Software', '0b9bbaf6-936a-473f-a75a-751f82cc360d', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Präsentation (Tool)'],
  ['Visualisierungs-Software', 'a05f4ecd-0bc9-4338-b9a7-a2f59887b2a7', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Präsentation (Tool)'],
  ['Inhalteverwaltung, Suche', '512d27e9-0bde-4af2-ba45-d36adffebd71', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Tool'],
  ['Web-Content-Managment', '10bd1bb6-bcdd-4645-b627-be3391ee1880', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Inhalteverwaltung, Suche'],
  ['Suchmaschine', '58bb5be8-301d-488d-a0b1-b74ac9435209', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Inhalteverwaltung, Suche'],
  ['Medien-Management', '5d3959ea-ede0-4d8e-828c-e8bbf5e95166', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Inhalteverwaltung, Suche'],
  ['Dateiablage', '9e72b43f-5d88-437d-96b3-ec40b63dc4ad', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Inhalteverwaltung, Suche'],
  ['Lerninhalte-Management, Repositorien und Referatorien', 'c4768d67-9d76-4606-bfd5-3c7b81c4acb7', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Inhalteverwaltung, Suche'],
  ['Nachschlagewerk', 'e0ddbb5f-9400-4d7a-89c9-dc1a18a4d576', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Inhalteverwaltung, Suche'],
  ['Datenbank-System', 'fa0c53f3-699c-482a-89c4-c69e986d8495', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Inhalteverwaltung, Suche'],
  ['Lernen, Quiz und Spiel', 'a120ce77-59f5-4564-8d49-73f4a0de1594', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Tool'],
  ['E-Portfolio, Personal Learning Environment (PLE)', '11408883-904a-467e-8697-6a899f89f793', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Lernen, Quiz und Spiel'],
  ['Mathematik-Tool', '1b7ae292-22ac-4304-bdac-9ea166c22e4a', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Lernen, Quiz und Spiel'],
  ['Quiz', '7d591b84-9171-47cb-809a-74ef07f07261', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Lernen, Quiz und Spiel'],
  ['E-Tests und Selbsttest-Tools', '84b79e36-875d-425c-8b8c-308689707db6', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Lernen, Quiz und Spiel'],
  ['E-Prüfungs-Software', '88823c13-aba8-45d4-80a1-cc34897e6abc', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Lernen, Quiz und Spiel'],
  ['Lernspiel-Umgebung', '975e6e9c-807d-4cc5-93eb-d4d7cb9eedef', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Lernen, Quiz und Spiel'],
  ['Vokabel-Trainer und Karteikarten-Lernen', 'e2d8fddf-fbb4-4aa3-8103-b35ca16f8d33', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Lernen, Quiz und Spiel'],
  ['Lern-App', 'e5ed8ec2-2c7e-4f46-aba9-e67148ef6656', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Lernen, Quiz und Spiel'],
  ['Sprachlern-Tool und -App', 'efe83201-de1c-4a54-b8f9-60373eeae630', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Lernen, Quiz und Spiel'],
  ['Unterrichtsorganisation und Verwaltung Bildungsorganisation', 'ef1fd35b-1c05-45a2-9f41-bf98b6541dd0', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Tool'],
  ['Kalender', '123f4829-f0b8-4c86-8846-497868567c5c', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Unterrichtsorganisation und Verwaltung Bildungsorganisation'],
  ['Klassenverwaltungs-App', '16c8a6df-e2f7-4aeb-9902-4f689b509a68', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Unterrichtsorganisation und Verwaltung Bildungsorganisation'],
  ['Lernplattform und Kursorganisation', '8aa00490-b9b9-453f-8fa7-55557507ab5f', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Unterrichtsorganisation und Verwaltung Bildungsorganisation'],
  ['Stundenplan-Software', 'c570a463-f249-4a50-b853-e532179ede7f', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Unterrichtsorganisation und Verwaltung Bildungsorganisation'],
  ['Bildungsverwaltungssoftware', 'c5afed02-a926-456a-949d-9716bbbbbf28', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Unterrichtsorganisation und Verwaltung Bildungsorganisation'],
  ['Kommunikation und Feedback', 'fd0b97e1-25ba-4477-b769-b41e9623cf65', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Tool'],
  ['Messenger', '15d1f836-27f9-4a6b-bbde-80830d325971', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Kommunikation und Feedback'],
  ['Diskussionsforen', '4e847242-cea0-4821-a13c-c621e475b372', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Kommunikation und Feedback'],
  ['Live-Umfrage', '5ab897b3-76f4-46f3-8f08-1256629fdc4c', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Kommunikation und Feedback'],
  ['Argumentation, Plattformen für strukturierte Diskussion', '61462395-8303-44bf-95a4-6a4297013283', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Kommunikation und Feedback'],
  ['Umfrage und Evaluations-Plattform', '89f00268-4219-48f4-be37-9c2c2f197280', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Kommunikation und Feedback'],
  ['Videokonferenzen', '91d21425-d229-489b-9c13-baa4e76f8cc9', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Kommunikation und Feedback'],
  ['Mail', '9d33119a-ada2-4022-b78b-17537b0fcbbf', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Kommunikation und Feedback'],
  ['Audiokonferenz', 'a7b216cb-6582-4396-b046-072cda3b7da5', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Kommunikation und Feedback'],
  ['Kooperation, Kollaboration und Kreatives', '1d8386f6-7cd7-4651-b293-96a330c3ecfb', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Tool'],
  ['Interaktives Concept Board', '32e8367c-9e96-44ac-8a17-ca36056d92ff', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Kooperation, Kollaboration und Kreatives'],
  ['Mindmap', '38bceae0-28c3-425f-9c56-fba079f98f92', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Kooperation, Kollaboration und Kreatives'],
  ['File-Sharing', '82f54655-016d-42bc-b4c9-efda354ec82e', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Kooperation, Kollaboration und Kreatives'],
  ['Kollaboratives Editieren, Gestalten und Sammeln', 'df4bbf3a-c5e2-40e4-8361-747d97850a3f', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Kooperation, Kollaboration und Kreatives'],
  ['Editoren', '8a201942-c69b-47ef-a211-922c4160c12d', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Tool'],
  ['Editor Officedateiformate', '55153d6d-50a2-442e-a2d0-280ce413b9f5', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Editoren'],
  ['Folieneditor', '1008b9eb-4aa8-4b2f-bf35-55c0012eb2df', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Editor Officedateiformate'],
  ['Tabellenkalkulation', '267e6b73-595c-47ad-9e2e-8573239a2d68', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Editor Officedateiformate'],
  ['Texteditor', 'd2399757-27ce-4978-830f-45bde426afdc', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Editor Officedateiformate'],
  ['für weitere Formate', '405081ee-9005-4d02-a7d2-351a034e565a', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Editoren'],
  ['Landkarten Editor (geographisch)', '1dd5f4f8-904f-4887-aac6-75b6a22d9887', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'für weitere Formate'],
  ['Concept Map Editor und Wissenslandkarten', '20cc966f-7957-4c03-a614-ab7a151c82c5', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'für weitere Formate'],
  ['Webseiten-Editor, Web CMS', '51c863b8-323d-4c16-bc86-ff1bbed584bb', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'für weitere Formate'],
  ['Mindmap-Editor', '6c82f612-2661-43fb-90a4-5e3ceb6f7f85', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'für weitere Formate'],
  ['Formeleditor', 'a7cc50ac-75d7-4e30-a0c6-c93e660c28a8', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'für weitere Formate'],
  ['Markdown- oder HTML-Editor', 'ab19d1cf-8a2c-49e8-8536-b8f0355b0927', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'für weitere Formate'],
  ['Noteneditor (Musikeditor)', 'ee1790c4-7d42-452c-800d-e03ea3a26ce1', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'für weitere Formate'],
  ['Bildungsinhalte-Formate (Editor)', 'f6f27241-86e0-44e8-a17b-5b563e61a4c8', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Editoren'],
  ['E-Prüfungs-Editor (z.B. QTI-Editor)', '2239a895-0a0a-4e13-b7f2-8a0c4115858a', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Bildungsinhalte-Formate (Editor)'],
  ['Umfragen, Evaluationen (Editor für)', '2d2b2302-db11-43f4-9ebf-35ba60e2f30c', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Bildungsinhalte-Formate (Editor)'],
  ['Kompetenz-, Lehrplan- und Lernzieleditor', '6a318b06-0b6e-4a7b-9105-2935fa46b40f', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Bildungsinhalte-Formate (Editor)'],
  ['Quiz-, Voting- und Selbsttest-Editor', '9c47bca7-fa9d-4c3e-b64c-a32e4b654e2b', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Bildungsinhalte-Formate (Editor)'],
  ['Kurseditor und Lernplattform', 'c04f9445-180d-4402-ab27-61918a888a47', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Bildungsinhalte-Formate (Editor)'],
  ['Lernabläufe und Lernszenarien (z.B. H5P)', 'f55cb96b-b51f-4493-957b-fd1707bfedbd', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Bildungsinhalte-Formate (Editor)'],
  ['Medienbearbeitung', '26383370-f3f5-44f2-b66c-435ac0b44bdf', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Editoren'],
  ['Simulationen (Editor für)', '2311a549-743c-4061-983b-629d4c4ac30b', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Medienbearbeitung'],
  ['Audio-Editor (Tonschnitt-Software, Ton-Editor, Musik-Editor)', '5585a490-36a7-4053-8beb-aeff219d6003', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Medienbearbeitung'],
  ['Animationen (Editor für)', '6eeef573-cdc4-45a3-b4eb-ca18c02f365a', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Medienbearbeitung'],
  ['Fotos und Rastergrafiken (Editor für)', '74a636eb-0d4a-4ce2-b022-304479acc76f', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Medienbearbeitung'],
  ['Vektorgrafiken (Editor für)', '8586bf22-12b5-4cf8-97e1-abc509a8eb0d', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Medienbearbeitung'],
  ['Augmented Reality Editor', 'd2a406f2-4bf4-495d-a456-21d032edbb60', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Medienbearbeitung'],
  ['Video-Editor (Videoschnitt)', 'e1b7864c-5205-4fa2-aff9-d039ebfd9f8d', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Medienbearbeitung'],
  ['interaktive Medien, Mixed Media z.B. H5P', 'e34026bf-eddf-4b7f-b240-cd8bc04b3fcc', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Medienbearbeitung'],
  ['Virtual Reality Editor', 'e821e29e-217d-42fb-ba49-e669454c279a', '37a3ad9c-727f-4b74-bbab-27d59015c695', 'Medienbearbeitung'],
  ['Material', '1846d876-d8fd-476a-b540-b8ffd713fedb', '', ''],
  ['Dokumente und textbasierte Inhalte', '0cef3ce9-e106-47ae-836a-48f9ed04384e', '', 'Material'],
  ['sonstiges Buch und E-Book', '01551356-a6a3-44fc-9662-7d366d7af0ac', '3927fdb6-0477-422c-9f5a-6285948aeaf4', 'Dokumente und textbasierte Inhalte'],
  ['Checkliste', '44868358-7b1f-42e4-a6b9-c3889d9d2623', '99f3bb30-22c0-4b46-871c-43ab4b6baf6f', 'Dokumente und textbasierte Inhalte'],
  ['Anleitung', 'f61c6708-0427-4f0d-9c33-cec4253d2cad', '', 'Dokumente und textbasierte Inhalte'],
  ['Webblog (dynamisch)', '5204fc81-5dac-4cc4-a28b-aad5c241fa19', 'ac4987d7-5d09-4a21-82c6-268ed6cdc7eb', 'Dokumente und textbasierte Inhalte'],
  ['Skript, Handout und Handreichung', '6a15628c-0e59-43e3-9fc5-9a7f7fa261c4', '9abf6ace-85bc-44e2-af4f-93a6bd255a21', 'Dokumente und textbasierte Inhalte'],
  ['Schülerarbeit und Studienarbeit', '6abe9218-0f55-46ba-b4c8-af22a63e1bb7', 'fece0442-c686-4496-b97e-06d87782009b', 'Dokumente und textbasierte Inhalte'],
  ['Wiki (dynamisch)', '6b9748e4-fb3b-4082-ae08-c7a11c717256', '6f669beb-273a-4153-bdb6-4c6d59b2366d', 'Dokumente und textbasierte Inhalte'],
  ['Handbuch, Dokumentation und Regularien', '776652a6-de35-4d2f-817e-6130dd2fa248', 'ac925aae-1f3c-4817-a9dd-b9b24c336b0d', 'Dokumente und textbasierte Inhalte'],
  ['Wort- und Vokabelliste', '95f90f7d-0b59-4a1a-be67-7eb3e10b578a', '9337a93e-777d-4d76-99a5-51f5e9935e63', 'Dokumente und textbasierte Inhalte'],
  ['Lehrbuch und Grundlagenwerk (auch E-Book)', 'a5897142-bf57-4cd0-bcd9-7d0f1932e87a', '3927fdb6-0477-422c-9f5a-6285948aeaf4', 'Dokumente und textbasierte Inhalte'],
  ['Primärmaterial', 'ab5b99ea-551c-42f3-995b-e4b5f469ad7e', '1c610f61-9bf0-4d77-8536-b713a3733510', 'Dokumente und textbasierte Inhalte'],
  ['Artikel und Einzelpublikation', 'b98c0c8c-5696-4537-82fa-dded7236081e', 'c77df53a-2611-4029-9712-f9c0eeb032a3', 'Dokumente und textbasierte Inhalte'],
  ['Nachschlagewerk und Glossareintrag', 'c022c920-c236-4234-bae1-e264a3e2bdf6', 'cf8929a7-d521-4f17-bbe3-96748c862486', 'Dokumente und textbasierte Inhalte'],
  ['Webseite', 'd8c3ef03-b3ab-4a5e-bcc9-5a546fefa2e9', '55761ec6-0cd4-4677-86ee-6f395934dae7', 'Dokumente und textbasierte Inhalte'],
  ['Noten', 'f7e92628-4132-4985-bcf5-93c285e300a8', '854e5bcf-d898-43ca-bc70-caf2a7e33673', 'Dokumente und textbasierte Inhalte'],
  ['Audio', 'ec2682af-08a9-4ab1-a324-9dca5151e99f', '39197d6f-dfb1-4e82-92e5-79f906e9d2a9', 'Material'],
  ['Erklär-Audio', '0877626e-0cce-481a-b0ed-c64988ed5989', '39197d6f-dfb1-4e82-92e5-79f906e9d2a9', 'Audio'],
  ['Sprach- und Lernaudio', '5dc0b5de-4c75-43aa-8366-fb6d7e3a7553', '39197d6f-dfb1-4e82-92e5-79f906e9d2a9', 'Audio'],
  ['Radio, Podcastfolge und Interview', '6e821748-ad12-4ac1-bb14-9b54493e2c50', '39197d6f-dfb1-4e82-92e5-79f906e9d2a9', 'Audio'],
  ['Klang und Tonaufnahme', '78cc5a71-5ae2-4fa3-be5f-5cef40c23328', '39197d6f-dfb1-4e82-92e5-79f906e9d2a9', 'Audio'],
  ['Musik', '9c23511c-73d0-407b-b443-c93e36364de2', '39197d6f-dfb1-4e82-92e5-79f906e9d2a9', 'Audio'],
  ['Vortrag (Audio-Aufzeichnung / Lesung)', 'e3ca3de5-faf2-4584-bc25-d5f9e784b2b4', '39197d6f-dfb1-4e82-92e5-79f906e9d2a9', 'Audio'],
  ['Hörverstehen', 'ed4f4834-c098-4b05-b27d-a9d9fbd31307', '39197d6f-dfb1-4e82-92e5-79f906e9d2a9', 'Audio'],
  ['Weiteres Material', '213ed49d-f4b2-49b6-8a32-7e9261901ec5', '', 'Material'],
  ['bekannte Persönlichkeit', '098e3d34-dd41-4c55-943d-640917577b16', 'b1e25325-d403-44f0-814a-ff2f5d866931', 'Weiteres Material'],
  ['Nachricht und Neuigkeit', 'dc5763ab-6f47-4aa3-9ff3-1303efbeef6e', '9bbb50a2-10c5-4a8b-9e0e-6a5fc86c40fe', 'Weiteres Material'],
  ['Fachliche News', '0f519bd5-069c-4d32-b6d3-a373ac96724c', '9bbb50a2-10c5-4a8b-9e0e-6a5fc86c40fe', 'Nachricht und Neuigkeit'],
  ['Alltags News', '49f02705-6e39-4071-aaaf-1f9bad1d01f0', '9bbb50a2-10c5-4a8b-9e0e-6a5fc86c40fe', 'Nachricht und Neuigkeit'],
  ['Pädagogische News', 'e1283c68-4a06-47ae-9965-0e664fd36abf', '9bbb50a2-10c5-4a8b-9e0e-6a5fc86c40fe', 'Nachricht und Neuigkeit'],
  ['Daten', '345cba59-9fa0-4ec8-ba93-2c75f4a40003', '620a3fee-ac87-40e6-8408-20b48b430eca', 'Weiteres Material'],
  ['Tabellen', '933ceef8-c7ae-4af3-9229-4bd86334dfea', 'a0b83e5a-eaa4-4df8-9eec-3678abd60c25', 'Weiteres Material'],
  ['Formel und mathematischer Inhalt', 'b1075505-364d-4e69-90a3-8ad463cfb587', 'c2fc554c-a7ae-4af7-a785-d727c5a8d0db', 'Weiteres Material'],
  ['Modell und 3D-Druck', 'f4e21a45-46c7-48a7-a23e-243660ea2e8c', '25957b6b-338e-4379-ba4f-67fc7654ef34', 'Weiteres Material'],
  ['Unterrichtsplanung', '7381f17f-50a6-4ce1-b3a0-9d85a482eec0', '', 'Material'],
  ['Stundenentwurf', '0d23ff13-9d92-4944-92fa-2b5fe1dde80b', '8526273b-2b21-46f2-ac8d-bbf362c8a690', 'Unterrichtsplanung'],
  ['Unterrichtsbaustein', '5098cf0b-1c12-4a1b-a6d3-b3f29621e11d', 'f1341358-3f91-449b-b6eb-f58636f756a0', 'Unterrichtsplanung'],
  ['Unterrichtsidee', '94222751-6c90-4623-9c7e-09e21d885599', '11f438d7-cb11-49c2-8e67-2dd7df677092', 'Unterrichtsplanung'],
  ['Unterrichtsreihe', '962560fe-d8d0-43e2-ad60-97f070b935c6', '8526273b-2b21-46f2-ac8d-bbf362c8a690', 'Unterrichtsplanung'],
  ['Go & Teach', '6ed79b37-c27c-4f53-9921-fb1a96da7160', 'f1341358-3f91-449b-b6eb-f58636f756a0', 'Unterrichtsplanung'],
  ['Unterrichtseinheit und -sequenz', 'ef58097d-c1de-4e6a-b4da-6f10e3716d3d', '8526273b-2b21-46f2-ac8d-bbf362c8a690', 'Unterrichtsplanung'],
  ['Interaktives Medium', '4665caac-99d7-4da3-b9fb-498d8ece034f', '05aa0f49-7e1b-498b-a7d5-c5fc8e73b2e2', 'Material'],
  ['Virtual Reality', '11cd7e41-1d65-4de9-9ab8-de9530cac19e', '05aa0f49-7e1b-498b-a7d5-c5fc8e73b2e2', 'Interaktives Medium'],
  ['Simulation', '2e4157ad-e29a-4f10-b4e6-370e0fd59d26', '05aa0f49-7e1b-498b-a7d5-c5fc8e73b2e2', 'Interaktives Medium'],
  ['Animation', '2e67ce4e-49ce-468b-bd94-96a74e4832aa', '05aa0f49-7e1b-498b-a7d5-c5fc8e73b2e2', 'Interaktives Medium'],
  ['Augmented Reality', '518ae9d5-2420-4567-b32d-f75c27e2cf70', '05aa0f49-7e1b-498b-a7d5-c5fc8e73b2e2', 'Interaktives Medium'],
  ['Lehr- und Lernmaterial', '588efe4f-976f-48eb-84aa-8bcb45679f85', '', 'Material'],
  ['Recherche- und Lernauftrag', '1cac68e6-dafe-4ce4-a52f-f33cde26da59', '90a082d8-ee5f-4b33-bd5c-f1738262c47d', 'Lehr- und Lernmaterial'],
  ['Projekt (Lehr- und Lernmaterial)', '22823ca9-7175-4b24-892e-19ebbf5fe0e7', '71c71f72-fc8d-4263-902f-abf1366a73ca', 'Lehr- und Lernmaterial'],
  ['Arbeitsblatt', '36e68792-6159-481d-a97b-2c00901f4f78', 'c8e52242-361b-4a2a-b95d-25e516b28b45', 'Lehr- und Lernmaterial'],
  ['Experiment (Lehr- und Lernmaterial)', '4735c61a-429b-4909-9f3c-cbf975e2aa0e', 'ffe4d8e8-3cfd-4e9a-b025-83f129eb5c9d', 'Lehr- und Lernmaterial'],
  ['Kurs', '4e16015a-7862-49ed-9b5e-6c1c6e0ffcd1', 'e10e9add-700e-4b57-a9c5-8f1088bb0545', 'Lehr- und Lernmaterial'],
  ['Sprachkurs', '8d5195dd-2e48-44d4-a9c1-6bccbf85ec96', 'e10e9add-700e-4b57-a9c5-8f1088bb0545', 'Kurs'],
  ['Fachkurs', '8e157383-9ca3-4e20-849d-0881b648fd99', 'e10e9add-700e-4b57-a9c5-8f1088bb0545', 'Kurs'],
  ['Propädeutika', 'ff20ae9f-5d83-4f29-ba4f-993cbd743e5c', 'e10e9add-700e-4b57-a9c5-8f1088bb0545', 'Kurs'],
  ['Soft Skills', '89abe72e-d4c6-4797-ac36-175cfce25107', 'e10e9add-700e-4b57-a9c5-8f1088bb0545', 'Kurs'],
  ['Business Skills', 'b0774ec7-49c0-49e0-8093-dce3ee6d02a0', 'e10e9add-700e-4b57-a9c5-8f1088bb0545', 'Kurs'],
  ['Digital Skills', '4d64241b-3d8c-4d67-b9fe-9970f240d991', 'e10e9add-700e-4b57-a9c5-8f1088bb0545', 'Kurs'],
  ['Academic Skills', '6f030e55-6193-4587-a374-d002cd43d787', 'e10e9add-700e-4b57-a9c5-8f1088bb0545', 'Kurs'],
  ['Career Skills', '9ac858a9-fc06-41a1-a18e-faf7a1525198', 'e10e9add-700e-4b57-a9c5-8f1088bb0545', 'Kurs'],
  ['Fallstudie', '88da6c0d-e0f9-4f37-a382-5ed7e609de8d', '41eaccae-899b-4209-8a54-c793a3cdf538', 'Lehr- und Lernmaterial'],
  ['Präsentation', '92c7a50c-6243-45d9-8b11-e79cbbda6305', '1e300ea3-a687-45a3-b215-9c240c1666dc', 'Lehr- und Lernmaterial'],
  ['Entdeckendes Lernen (Lehr- und Lernmaterial)', '9a86beb5-1a65-48ca-99c8-e8c789cfe2f8', 'ec402e87-c623-47e2-8d2e-1c4ea6923409', 'Lehr- und Lernmaterial'],
  ['Übungsmaterial', 'a33ef73d-9210-4305-97f9-7357bbf43486', '0b2d7dec-8eb1-4a28-9cf2-4f3a4f5a511b', 'Lehr- und Lernmaterial'],
  ['Rollenspiel (Lehr- und Lernmaterial)', 'ac82dc13-3be1-464d-9cdc-88e608d99c39', 'd0c115e4-848d-4aea-8e31-23869e9add3e', 'Lehr- und Lernmaterial'],
  ['Lernpfad, Lernobjekt', 'ad9b9299-0913-40fb-8ad3-50c5fd367b6a', '3469a5e7-86d1-4376-bd3d-1f2b183ed94a', 'Lehr- und Lernmaterial'],
  ['Lernspiel', 'b0495f44-b05d-4bde-9dc5-34d7b5234d76', 'ded96854-280a-45ac-ad3a-f5b9b8dd0a03', 'Lehr- und Lernmaterial'],
  ['EduBreakout', '7005a7b7-7b67-4797-960e-894ded60283a', 'ded96854-280a-45ac-ad3a-f5b9b8dd0a03', 'Lernspiel', ['Edu-Breakout']],
  ['offene und kreative Aktivität (Lehr- und Lernmaterial)', '68a43516-889e-4ce9-8e03-248307bd99ff', '57bfc743-4c94-4bdd-bdfa-c638a062d151', 'Lehr- und Lernmaterial'],
  ['Stationenlernen', 'ee738203-44af-4150-986f-ef01fb883f00', '57bfc743-4c94-4bdd-bdfa-c638a062d151', 'offene und kreative Aktivität (Lehr- und Lernmaterial)'],
  ['Bild (Material)', 'a6d1ac52-c557-4151-bc6f-0d99b0b96fb9', 'b8fb5fb2-d8bf-4bbe-ab68-358b65a26bed', 'Material'],
  ['Veranschaulichung, Schaubild und Tafelbild', '1dc4ed81-718c-4b76-86cb-947a86875973', 'b8fb5fb2-d8bf-4bbe-ab68-358b65a26bed', 'Bild (Material)'],
  ['Mal- und Bastelvorlage', '39db0dbd-cb6f-4153-910f-9f11177b48f2', 'b8fb5fb2-d8bf-4bbe-ab68-358b65a26bed', 'Bild (Material)'],
  ['Cliparts, Pictogramme und Icons', '3b8045af-8fc6-45b5-a352-db46893f7918', 'b8fb5fb2-d8bf-4bbe-ab68-358b65a26bed', 'Bild (Material)'],
  ['Cartoon, Comic', '667f5063-70b9-400c-b1f7-7702ec9487f1', 'b8fb5fb2-d8bf-4bbe-ab68-358b65a26bed', 'Bild (Material)'],
  ['Karte', 'b6ceade0-58d3-4179-af71-d53ebc6e49d4', 'b8fb5fb2-d8bf-4bbe-ab68-358b65a26bed', 'Bild (Material)'],
  ['Poster und Plakat', 'c382a478-74e0-42f1-96dd-fcfb5c27f746', 'b8fb5fb2-d8bf-4bbe-ab68-358b65a26bed', 'Bild (Material)'],
  ['Gemälde, Kunstwerke und Zeichnungen', 'e3ddae8a-d94c-40d8-b7f7-9bdaf0cb8325', 'b8fb5fb2-d8bf-4bbe-ab68-358b65a26bed', 'Bild (Material)'],
  ['Graph, Diagramm und Charts', 'f7228fb5-105d-4313-afea-66dd59b1b6f8', 'b8fb5fb2-d8bf-4bbe-ab68-358b65a26bed', 'Bild (Material)'],
  ['Foto', 'f9630e1c-2247-42ed-87b0-b1e18e4ec02b', 'b8fb5fb2-d8bf-4bbe-ab68-358b65a26bed', 'Bild (Material)'],
  ['Video (Material)', '7a6e9608-2554-4981-95dc-47ab9ba924de', '38774279-af36-4ec2-8e70-811d5a51a6a1', 'Material'],
  ['Schul- und Bildungssendung (Material)', '233d0527-7945-4acb-a174-5c23d24513a3', '38774279-af36-4ec2-8e70-811d5a51a6a1', 'Video (Material)'],
  ['TV-Sendung und Video-Podcast', '3616febb-8cf8-4503-8f80-ebc552d85506', '38774279-af36-4ec2-8e70-811d5a51a6a1', 'Video (Material)'],
  ['Lern- und Übungsvideo', '62a09b63-320e-4f4d-9da6-8cab9cdef55b', '38774279-af36-4ec2-8e70-811d5a51a6a1', 'Video (Material)'],
  ['Erklärvideo und gefilmtes Experiment', 'a0218a48-a008-4975-a62a-27b1a83d454f', '38774279-af36-4ec2-8e70-811d5a51a6a1', 'Video (Material)'],
  ['Vortrags- und Unterrichtsaufzeichnung', 'facc2239-a827-462a-b2d2-bbab6cfb1178', '38774279-af36-4ec2-8e70-811d5a51a6a1', 'Video (Material)'],
  ['Test und Fragebogen', 'cd625d33-5d7b-4a86-a54a-9a897ded729f', '02bfd0fe-96ab-4dd6-a306-ec362ec25ea0', 'Material'],
  ['Selbst-Testaufgabe', '29f0d682-38c6-4a64-a1fa-04e673c28128', '02bfd0fe-96ab-4dd6-a306-ec362ec25ea0', 'Test und Fragebogen'],
  ['Lösungs(beispiel) und Erwartungshorizont', '7c236821-bfae-4eeb-bc79-590bf8ea1d96', '02bfd0fe-96ab-4dd6-a306-ec362ec25ea0', 'Test und Fragebogen'],
  ['Klausur, Klassenarbeit und Test', '9cf3c183-f37c-4b6b-8beb-65f530595dff', '02bfd0fe-96ab-4dd6-a306-ec362ec25ea0', 'Test und Fragebogen'],
  ['Fragebogen und Umfrage', 'd31a5b68-611f-4015-8be9-56bd5eb44c64', '02bfd0fe-96ab-4dd6-a306-ec362ec25ea0', 'Test und Fragebogen'],
  ['Textbaustein zum Wiederverwenden', '67f579a9-382c-497f-8b5b-06d95638aa0d', '2c151a4e-556e-42db-9e44-3a581deb5834', 'Material'],
  ['Darstellung Sachverhalt', '5bba65b9-fe31-41b9-bb71-a7a2090c7b98', '2c151a4e-556e-42db-9e44-3a581deb5834', 'Textbaustein zum Wiederverwenden'],
  ['Definition', '6a360309-969b-46ce-a7a2-566051587ce8', '2c151a4e-556e-42db-9e44-3a581deb5834', 'Textbaustein zum Wiederverwenden'],
  ['Merksatz', '6eb493be-e072-4afc-a5b4-aea34beeca70', '2c151a4e-556e-42db-9e44-3a581deb5834', 'Textbaustein zum Wiederverwenden'],
  ['(Wirkungs-) Zusammenhang und Gesetzmäßigkeit', '9f47559b-fb38-423e-9184-ea517446d027', '2c151a4e-556e-42db-9e44-3a581deb5834', 'Textbaustein zum Wiederverwenden'],
  ['Regelung und Vorgabe', 'aa7b0bde-b41e-4e75-944b-bfd6ccbe359c', '2c151a4e-556e-42db-9e44-3a581deb5834', 'Textbaustein zum Wiederverwenden'],
  ['Fakt', 'affb1113-d4a0-417a-b809-575048fb358e', '2c151a4e-556e-42db-9e44-3a581deb5834', 'Textbaustein zum Wiederverwenden'],
  ['Beispiel', 'e6ae7ead-4379-4b6d-b1c4-e30b57e69f3d', '2c151a4e-556e-42db-9e44-3a581deb5834', 'Textbaustein zum Wiederverwenden'],
  ['Regelungsintrumente (Gesetze, Normen, Konventionen, Empfehlungen)', 'b0f611f0-27a6-4500-afdc-f378661a69d7', '0d1f8d25-7a81-44d5-b250-1c42bb71c167', ''],
  ['Gesetz, Verordnung', '5c545174-49d8-4e9c-85c3-bf038f9cdd5a', '0d1f8d25-7a81-44d5-b250-1c42bb71c167', 'Regelungsintrumente (Gesetze, Normen, Konventionen, Empfehlungen)'],
  ['Norm, Standard', '3dd6bad2-8cc3-4f4b-8f85-44fa50b5050a', '0d1f8d25-7a81-44d5-b250-1c42bb71c167', 'Regelungsintrumente (Gesetze, Normen, Konventionen, Empfehlungen)'],
  ['Policy', '7bf98baf-9229-46d4-bc95-ce0b30508ae2', '0d1f8d25-7a81-44d5-b250-1c42bb71c167', 'Regelungsintrumente (Gesetze, Normen, Konventionen, Empfehlungen)'],
  ['Konvention, informeller Standard, Leitlinien', '343066ad-4a22-4025-938b-15524e102cd8', '0d1f8d25-7a81-44d5-b250-1c42bb71c167', 'Regelungsintrumente (Gesetze, Normen, Konventionen, Empfehlungen)'],
  ['Studien-/Ausbildungsordnung', 'c9fb123f-bd85-4e6e-80c0-96629ece7248', '0d1f8d25-7a81-44d5-b250-1c42bb71c167', 'Regelungsintrumente (Gesetze, Normen, Konventionen, Empfehlungen)'],
  ['Orientierungsinstrumente', '16ceb92d-1b90-4c3a-b0f4-9b2f577eb9e4', '9c2acd39-7207-4e28-87a5-06e60d59c9e1', ''],
  ['Handlungsempfehlung, Resolution', '970bca11-4283-4fd2-ae53-1b162d122962', '9c2acd39-7207-4e28-87a5-06e60d59c9e1', 'Orientierungsinstrumente'],
  ['Positionspapier', 'cd1686cd-43f0-45b2-b22e-b4d125b8be31', '9c2acd39-7207-4e28-87a5-06e60d59c9e1', 'Orientierungsinstrumente'],
  ['Strategie, Aktionsplan', '723fd31c-9c9a-4f14-8acc-f9cecf02a487', '9c2acd39-7207-4e28-87a5-06e60d59c9e1', 'Orientierungsinstrumente'],
  ['Whitepaper', 'b147e042-3d9d-440d-a442-404573c0d402', '9c2acd39-7207-4e28-87a5-06e60d59c9e1', 'Orientierungsinstrumente'],
];

export const LRT_CONCEPTS: LrtConcept[] = ROWS.map(([label, uuid, aggUuid, path, aliases]) => ({
  uri: LRT_BASE + uuid,
  label,
  aggregatedUri: aggUuid ? LRT_AGGREGATED_BASE + aggUuid : null,
  path,
  aliases: aliases ?? [],
}));

/**
 * Concept URI → the aggregated URI the repository derives from it. Published by
 * the vocabulary, not inferred by us.
 */
export const AGGREGATION: Record<string, string> = Object.fromEntries(
  LRT_CONCEPTS.filter(c => c.aggregatedUri).map(c => [c.uri, c.aggregatedUri as string]),
);

/**
 * Labels of the concepts the vocabulary maps to no aggregated concept. Material
 * tagged only with one of these carries no `ccm:oeh_lrt_aggregated`, so it does
 * not appear under the aggregated content-type facets — measured on live nodes,
 * and the reason a tool surfaces this rather than hiding it.
 */
export const UNMAPPED: string[] = LRT_CONCEPTS.filter(c => c.aggregatedUri === null).map(c => c.label);

export type LrtResolution =
  | { status: 'ok'; uri: string }
  | { status: 'ambiguous'; candidates: { uri: string; label: string; path: string }[] }
  | { status: 'unknown' };

const BY_TERM = (() => {
  const index = new Map<string, LrtConcept[]>();
  for (const c of LRT_CONCEPTS) {
    for (const term of [c.label, ...c.aliases]) {
      const key = term.toLowerCase();
      const list = index.get(key);
      if (list) list.push(c);
      else index.set(key, [c]);
    }
  }
  return index;
})();

/**
 * Resolve a label, alias or URI to a concept URI.
 *
 * A label two concepts share comes back as `ambiguous` with both candidates
 * rather than resolved to whichever sits earlier in the hierarchy. Two of the
 * 220 labels are shared (suchmaschine, stationenlernen), and they mean genuinely different
 * things — silently picking one would write a content type the curator did not
 * choose, which is the same class of defect as an invented licence.
 *
 * A URI from another vocabulary is `unknown`, not passed through: for a write,
 * an unverified URI is a value nobody chose.
 */
export function resolveLrt(input: string): LrtResolution {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return { status: 'unknown' };

  if (trimmed.startsWith('http')) {
    return LRT_CONCEPTS.some(c => c.uri === trimmed)
      ? { status: 'ok', uri: trimmed }
      : { status: 'unknown' };
  }

  const hits = BY_TERM.get(trimmed.toLowerCase());
  if (!hits || hits.length === 0) return { status: 'unknown' };
  if (hits.length === 1) return { status: 'ok', uri: hits[0]!.uri };
  return {
    status: 'ambiguous',
    candidates: hits.map(c => ({ uri: c.uri, label: c.label, path: c.path })),
  };
}
