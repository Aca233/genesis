export interface FactionSectionInput {
  overview: string;
  territory: string;
  faith: string;
  keyCharacterRefs: Array<{ ref: string }>;
  keyFigures: string[];
}

export interface MajorCharacterName {
  ref: string;
  name: string;
}

export function factionSections(
  faction: FactionSectionInput,
  majorCharacters: MajorCharacterName[],
) {
  const namesByRef = new Map(majorCharacters.map((character) => [character.ref, character.name]));
  const keyFigures = faction.keyCharacterRefs.length > 0
    ? faction.keyCharacterRefs.flatMap((reference) => {
      const name = namesByRef.get(reference.ref);
      return name === undefined ? [] : [name];
    })
    : faction.keyFigures;

  return [
    { key: "overview", content: { text: faction.overview } },
    { key: "territory", content: { text: faction.territory } },
    { key: "faith", content: { text: faction.faith } },
    { key: "keyFigures", content: { names: keyFigures } },
  ];
}
