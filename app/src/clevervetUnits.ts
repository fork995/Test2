/** Explicit CleverVet unit vocabulary. Never infer medical units from names. */
export const UNIT_LABELS = {
  MICROGRAM: "мкг",
  MILLIGRAM: "мг",
  GRAM: "г",
  KILOGRAM: "кг",
  MILLILITRE: "мл",
  INTERNATIONAL_UNIT: "МЕ",
  MILLIMOLE: "ммоль",
  ANIMAL: "животное",
  DROP: "кап",
  CENTIMETRE: "см",
  SQUARE_METRE: "м²",
  TABLET: "таб",
  CAPSULE: "капс",
  VIAL: "фл",
  SACHET: "пак",
  SUPPOSITORY: "супп",
  MICRO_ENEMA: "микроклизма",
  DOSE: "доза",
} as const;
export type UnitCode = keyof typeof UNIT_LABELS;
export const TIME_LABELS = { MINUTE: "мин", HOUR: "ч", DAY: "сут" } as const;
export type TimeCode = keyof typeof TIME_LABELS;
export type ParsedUnits =
  | {
      ok: true;
      numerator: UnitCode;
      denominator: UnitCode | null;
      time: TimeCode | null;
      label: string;
    }
  | { ok: false; label: string; reason: string };
const aliases: Record<string, UnitCode> = {
  GRAMME: "GRAM",
  мкг: "MICROGRAM",
  µg: "MICROGRAM",
  mcg: "MICROGRAM",
  мг: "MILLIGRAM",
  mg: "MILLIGRAM",
  г: "GRAM",
  g: "GRAM",
  кг: "KILOGRAM",
  kg: "KILOGRAM",
  мл: "MILLILITRE",
  ml: "MILLILITRE",
  МЕ: "INTERNATIONAL_UNIT",
  ммоль: "MILLIMOLE",
  кап: "DROP",
  drop: "DROP",
  см: "CENTIMETRE",
  "м²": "SQUARE_METRE",
  таб: "TABLET",
  капс: "CAPSULE",
  фл: "VIAL",
  пак: "SACHET",
  животное: "ANIMAL",
};
const times: Record<string, TimeCode> = {
  мин: "MINUTE",
  min: "MINUTE",
  ч: "HOUR",
  час: "HOUR",
  h: "HOUR",
  сут: "DAY",
  day: "DAY",
};
function atom(value: unknown): UnitCode | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return Object.hasOwn(UNIT_LABELS, v) ? (v as UnitCode) : (aliases[v] ?? null);
}
function time(value: unknown): TimeCode | null {
  if (typeof value !== "string") return null;
  return Object.hasOwn(TIME_LABELS, value)
    ? (value as TimeCode)
    : (times[value] ?? null);
}
function fail(label = ""): ParsedUnits {
  return { ok: false, label, reason: "единицы не подтверждены" };
}
export function parseCleverVetUnits(raw: unknown): ParsedUnits {
  let numerator: UnitCode | null = null,
    denominator: UnitCode | null = null,
    rate: TimeCode | null = null;
  if (typeof raw === "string") {
    const pieces = raw
      .trim()
      .split("/")
      .map((s) => s.trim());
    if (!pieces.length || pieces.length > 3) return fail(raw);
    numerator = atom(pieces[0]);
    if (pieces.length > 1) {
      denominator = atom(pieces[1]);
      if (!denominator) rate = time(pieces[1]);
      if (!denominator && !rate) return fail(raw);
    }
    if (pieces.length === 3) {
      rate = time(pieces[2]);
      if (!denominator || !rate) return fail(raw);
    }
  } else if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    if (
      Object.keys(r).some((k) => !["substance", "volume", "time"].includes(k))
    )
      return fail();
    numerator = atom(r.substance);
    if (r.volume !== undefined && r.volume !== null) {
      denominator = atom(r.volume);
      if (!denominator) return fail();
    }
    if (r.time !== undefined && r.time !== null) {
      rate = time(r.time);
      if (!rate) return fail();
    }
  } else return fail();
  if (!numerator) return fail(typeof raw === "string" ? raw : "");
  return {
    ok: true,
    numerator,
    denominator,
    time: rate,
    label:
      UNIT_LABELS[numerator] +
      (denominator ? `/${UNIT_LABELS[denominator]}` : "") +
      (rate ? `/${TIME_LABELS[rate]}` : ""),
  };
}
export function massFactorMg(code: UnitCode): number | null {
  return (
    (
      {
        MICROGRAM: 0.001,
        MILLIGRAM: 1,
        GRAM: 1000,
        KILOGRAM: 1000000,
      } as Partial<Record<UnitCode, number>>
    )[code] ?? null
  );
}
export function compatibleAmount(from: UnitCode, to: UnitCode): number | null {
  if (from === to) return 1;
  const a = massFactorMg(from),
    b = massFactorMg(to);
  return a !== null && b !== null ? a / b : null;
}
export function formatClinicalNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  // No rounding of intermediate calculations. Preserve small nonzero quantities.
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 10,
    maximumSignificantDigits: 8,
    useGrouping: false,
  }).format(value);
}
const ROUTES: Record<string, string> = {
  ORAL: "п/о",
  INTRAVENOUS: "в/в",
  INTRAMUSCULAR: "в/м",
  SUBCUTANEOUS: "п/к",
  RECTAL: "ректально",
  INHALATIONAL: "ингаляционно",
  TOPICAL: "местно",
};
export function medicationRoute(raw: unknown): {
  label: string;
  known: boolean;
} {
  if (typeof raw !== "string" || !raw.trim())
    return { label: "Путь введения не указан", known: false };
  const value = raw.trim();
  if (ROUTES[value]) return { label: ROUTES[value], known: true };
  if (Object.values(ROUTES).includes(value))
    return { label: value, known: true };
  return { label: `Неизвестный путь: ${value}`, known: false };
}
