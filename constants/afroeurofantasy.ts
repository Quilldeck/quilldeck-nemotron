// Quilldeck — Afroeurofantasy primer
//
// "Afroeurofantasy" is a coined subgenre (Phoenix F. Black / The Silent One)
// with zero presence in the model's training data. Left alone, the model
// treats it as a generic label and produces generic "African magic meets
// European magic" copy. This primer grounds the model in the actual
// definitional rules from the Afroeurofantasy Foundational Record v1.0:
// co-constitution (both traditions must shape the world's reality, not
// decorate it), named specificity (never generic "African"/"European"
// magic), and no "mixed heritage = magically special" shortcut.
//
// Works with or without author-supplied tradition names. If left blank,
// the model is instructed to infer and name specific traditions from the
// synopsis itself rather than defaulting to a generic pairing.

export const AFROEUROFANTASY_GENRE = 'Afroeurofantasy';

export function buildAfroeurofantasyPrimer(
  africanTradition?: string,
  europeanTradition?: string,
): string {
  const african =
    africanTradition?.trim() ||
    'a specific African tradition (e.g. Yoruba, Akan, Igbo — never generic "African magic")';
  const european =
    europeanTradition?.trim() ||
    'a specific European tradition (e.g. Norse, Celtic, Anglo-Saxon — never generic "European magic")';

  return `This is an Afroeurofantasy: ${african} and ${european} mythic-cultural systems must be co-constitutive of this world's reality, not decoration layered on top of each other. Ground the magic, cosmology, and stakes in these traditions specifically. Neither tradition should function as mere setting or aesthetic backdrop for the other; both must meaningfully shape the story's world and stakes. Do not imply that mixed heritage alone grants magical or narrative significance — any significance must come from the specific story, not from ancestry itself. The encounter between these two traditions should read as consequential, reshaping what's at stake, not just combining two aesthetics.`;
}
