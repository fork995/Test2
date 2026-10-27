/** Original PRe/FRe/VRe/HRe/zRe, HC/ZR and Cse. Write vocabulary is not the read parser's aliases. */
export const CONCENTRATION_SUBSTANCES = {
  INTERNATIONAL_UNIT: "МЕ",
  MICROGRAM: "мкг",
  MILLIGRAM: "мг",
  GRAMME: "г",
  MILLIMOLE: "ммоль",
  MILLILITRE: "мл",
} as const;
export const CONCENTRATION_VOLUMES = {
  CAPSULE: "капс",
  MILLILITRE: "мл",
  TABLET: "таб",
  VIAL: "фл",
  SACHET: "пак",
  SUPPOSITORY: "супп",
  MICRO_ENEMA: "микроклизма",
  GRAMME: "г",
  DOSE: "доза",
} as const;
export const DOSAGE_SUBSTANCES = {
  ...CONCENTRATION_SUBSTANCES,
  DROP: "кап",
  CENTIMETRE: "см",
} as const;
export const DOSAGE_VOLUMES = {
  ANIMAL: "животное",
  KILOGRAM: "кг",
  SQUARE_METRE: "м²",
} as const;
export const PRESCRIPTION_TIMES = {
  MINUTE: "мин",
  HOUR: "ч",
  DAY: "сут",
} as const;
export const PRESCRIPTION_ROUTES = {
  ORAL: "Перорально · п/о",
  INTRAMUSCULAR: "Внутримышечно · в/м",
  INTRAVENOUS: "Внутривенно · в/в",
  SUBCUTANEOUS: "Подкожно · п/к",
  RECTAL: "Ректально",
  INHALATIONAL: "Ингаляционно",
  TOPICAL: "Местно",
} as const;
export const ROUTES_BY_VOLUME: Record<string, readonly string[]> = {
  CAPSULE: ["ORAL", "RECTAL"],
  MILLILITRE: Object.keys(PRESCRIPTION_ROUTES),
  TABLET: ["ORAL", "RECTAL"],
  VIAL: Object.keys(PRESCRIPTION_ROUTES),
  SACHET: ["ORAL"],
  SUPPOSITORY: ["RECTAL"],
  MICRO_ENEMA: ["RECTAL"],
  GRAMME: ["ORAL"],
  DOSE: ["INHALATIONAL", "SUBCUTANEOUS"],
};
