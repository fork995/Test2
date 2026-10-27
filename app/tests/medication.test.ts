import { it, expect } from "vitest";
import {
  parseCleverVetUnits as parse,
  formatClinicalNumber,
  medicationRoute,
} from "../src/clevervetUnits";
import {
  medicationCalculation as calc,
  medicationFields,
} from "../src/medication";
const unit = (substance: string, volume?: string, time?: string) => ({
  substance,
  ...(volume ? { volume } : {}),
  ...(time ? { time } : {}),
});
const q = (
  value: number,
  substance: string,
  volume?: string,
  time?: string,
) => ({ value, units: unit(substance, volume, time) });
const standard = (extra: Record<string, unknown> = {}) => ({
  dosage: q(1, "MILLIGRAM", "KILOGRAM"),
  concentration: q(10, "MILLIGRAM", "MILLILITRE"),
  weightKg: 4,
  route: "INTRAVENOUS",
  ...extra,
});
it.each([
  ["MILLIGRAM", "мг"],
  ["MICROGRAM", "мкг"],
  ["GRAM", "г"],
  ["GRAMME", "г"],
  ["KILOGRAM", "кг"],
  ["MILLILITRE", "мл"],
  ["MILLIGRAM/KILOGRAM", "мг/кг"],
  ["MICROGRAM/KILOGRAM", "мкг/кг"],
  ["MILLIGRAM/MILLILITRE", "мг/мл"],
  ["MICROGRAM/MILLILITRE", "мкг/мл"],
  ["мг/кг/ч", "мг/кг/ч"],
  ["мкг/кг/мин", "мкг/кг/мин"],
])("parses explicit unit %s as %s", (raw, label) =>
  expect(parse(raw)).toMatchObject({ ok: true, label }),
);
it.each([
  "TABLET",
  "CAPSULE",
  "VIAL",
  "SACHET",
  "INTERNATIONAL_UNIT",
  "DROP",
  "ANIMAL",
])("recognizes observed/package unit %s", (code) =>
  expect(parse(code).ok).toBe(true),
);
it("parses structured units with a real time dimension", () =>
  expect(parse(unit("MICROGRAM", "KILOGRAM", "MINUTE"))).toMatchObject({
    ok: true,
    label: "мкг/кг/мин",
    time: "MINUTE",
  }));
it.each([
  null,
  undefined,
  { name: "мг" },
  { substance: "MILLIGRAM", volume: "unknown" },
  { substance: "MILLIGRAM", time: "unknown" },
  { substance: "MILLIGRAM", time: "" },
  "UNKNOWN",
  "мг/кг/unknown",
])("rejects incomplete/unknown units %j", (raw) =>
  expect(parse(raw).ok).toBe(false),
);
it("1 mg/kg x 4 kg at 10 mg/ml = 4 mg and 0.4 ml", () => {
  const result = calc(standard());
  expect(result.total).toEqual({ value: 4, unit: "MILLIGRAM", time: null });
  expect(result.amount).toEqual({ value: 0.4, unit: "MILLILITRE", time: null });
  expect(result.warnings).toEqual([]);
});
it("15 mg/kg x 4.8 kg at 50 mg/ml = 72 mg and 1.44 ml", () => {
  const result = calc(
    standard({
      dosage: q(15, "MILLIGRAM", "KILOGRAM"),
      weightKg: 4.8,
      concentration: q(50, "MILLIGRAM", "MILLILITRE"),
    }),
  );
  expect(result.total?.value).toBe(72);
  expect(result.amount?.value).toBe(1.44);
});
it.each([
  [1000, "MICROGRAM", 1, "MILLIGRAM", 1],
  [1, "MILLIGRAM", 1000, "MICROGRAM", 1],
  [0.001, "GRAMME", 1, "MILLIGRAM", 1],
  [1000, "MILLIGRAM", 1, "GRAM", 1],
] as const)(
  "converts %s %s against %s %s/ml",
  (dose, du, concentration, cu, expected) => {
    expect(
      calc(
        standard({
          dosage: q(dose, du, "ANIMAL"),
          concentration: q(concentration, cu, "MILLILITRE"),
        }),
      ).amount?.value,
    ).toBeCloseTo(expected, 12);
  },
);
it("absolute doses do not multiply by patient weight, including explicit ANIMAL", () => {
  for (const d of [q(2, "MILLIGRAM"), q(2, "MILLIGRAM", "ANIMAL")])
    expect(calc(standard({ dosage: d, weightKg: 100 })).amount?.value).toBe(
      0.2,
    );
});
it.each([0, null, undefined, -1, NaN])(
  "missing/invalid required prescribed weight %s blocks calculations",
  (weightKg) => {
    const c = calc(standard({ weightKg, patientWeightKg: 4, weight: 4 }));
    expect(c.total).toBeNull();
    expect(c.amount).toBeNull();
  },
);
it.each([0, -1, NaN, Infinity])(
  "invalid concentration %s blocks calculated dose and volume",
  (value) => {
    const c = calc(
      standard({ concentration: q(value, "MILLIGRAM", "MILLILITRE") }),
    );
    expect(c.total).toBeNull();
    expect(c.amount).toBeNull();
  },
);
it("incompatible substance dimensions and unknown concentration units block the calculation", () => {
  for (const concentration of [
    q(10, "INTERNATIONAL_UNIT", "MILLILITRE"),
    { value: 10, units: { substance: "UNKNOWN", volume: "MILLILITRE" } },
  ]) {
    const c = calc(standard({ concentration }));
    expect(c.amount).toBeNull();
    expect(c.total).toBeNull();
    expect(c.warnings.length).toBeGreaterThan(0);
  }
});
it("unknown dose units cannot be inferred from a drug's name", () => {
  const c = calc(
    standard({
      drugName: "Synthetic 10 mg/ml",
      dosage: { value: 1, units: { substance: "UNKNOWN" } },
    }),
  );
  expect(c.amount).toBeNull();
  expect(c.total).toBeNull();
});
it.each(["MINUTE", "HOUR", "DAY"] as const)(
  "rate remains a rate per %s; no bolus volume",
  (time) => {
    const c = calc(standard({ dosage: q(2, "MICROGRAM", "KILOGRAM", time) }));
    expect(c.total).toEqual({ value: 8, unit: "MICROGRAM", time });
    expect(c.amount?.value).toBeCloseTo(0.0008, 12);
    expect(c.amount?.time).toBe(time);
    const fields = medicationFields(
      standard({ dosage: q(2, "MICROGRAM", "KILOGRAM", time) }),
      true,
    ).fields;
    expect(fields.some((f) => f.label.startsWith("Набрать"))).toBe(false);
    expect(fields.find((f) => f.label === "Скорость препарата")).toBeDefined();
  },
);
it("does not round intermediate dose or conversion", () => {
  const c = calc(
    standard({
      dosage: q(0.123456789, "MICROGRAM", "KILOGRAM"),
      concentration: q(0.0123, "MILLIGRAM", "MILLILITRE"),
      weightKg: 3.333333333,
    }),
  );
  expect(c.amount?.value).toBe((0.123456789 * 3.333333333 * 0.001) / 0.0123);
});
it("formats decimal commas, including small nonzero amounts", () => {
  expect(formatClinicalNumber(0.4)).toBe("0,4");
  expect(formatClinicalNumber(1.44)).toBe("1,44");
  expect(formatClinicalNumber(1e-12)).not.toBe("0");
});
it("vial reconstitution uses the confirmed original xv rule without mixing final solution", () => {
  const c = calc(
    standard({
      concentration: q(100, "MILLIGRAM", "VIAL"),
      solvent: { name: "Synthetic solvent", volume: 10 },
      supplementarySolvent: { name: "Synthetic additional", volume: 20 },
    }),
  );
  expect(c.effectiveConcentration).toBe(10);
  expect(c.amount?.value).toBe(0.4);
  expect(c.reconstituted).toBe(true);
  expect(c.warnings.join(" ")).toContain("итоговый объём смеси не рассчитан");
});
it.each([0, -1, null])(
  "invalid reconstitution volume %s never becomes ordinary stock concentration",
  (volume) => {
    const c = calc(
      standard({
        concentration: q(100, "MILLIGRAM", "VIAL"),
        solvent: { name: "Synthetic", volume },
      }),
    );
    expect(c.amount).toBeNull();
  },
);
it("solvent on an unconfirmed liquid form blocks volume rather than guessing dilution", () => {
  expect(
    calc(standard({ solvent: { name: "Synthetic", volume: 10 } })).amount,
  ).toBeNull();
});
it("tablets and sachets are counts, not ml", () => {
  for (const u of ["TABLET", "SACHET"]) {
    const c = calc(standard({ concentration: q(8, "MILLIGRAM", u) }));
    expect(c.amount).toEqual({ value: 0.5, unit: u, time: null });
  }
});
it("explicit ml/kg dose is already volume; no mass concentration conversion", () => {
  const c = calc(standard({ dosage: q(0.1, "MILLILITRE", "KILOGRAM") }));
  expect(c.amount).toEqual({ value: 0.4, unit: "MILLILITRE", time: null });
});
it("localizes known routes and identifies unknown routes explicitly", () => {
  expect(medicationRoute("INTRAVENOUS").label).toBe("в/в");
  expect(medicationRoute("ORAL").label).toBe("п/о");
  expect(medicationRoute("UNKNOWN_ROUTE")).toEqual({
    known: false,
    label: "Неизвестный путь: UNKNOWN_ROUTE",
  });
});
it("one shared calculation yields matching compact and detail amounts", () => {
  const compact = medicationFields(standard(), true),
    details = medicationFields(standard());
  expect(compact.fields.find((f) => f.path === "calculated.amount")).toEqual(
    details.fields.find((f) => f.path === "calculated.amount"),
  );
  expect(compact.warnings).toEqual([]);
  expect(details.fields.find((f) => f.label === "На массу 4 кг")?.value).toBe(
    "4 мг",
  );
});

it("ml/vial preparation distinguishes source drug dose from prepared dose volume", () => {
  const c = calc(
    standard({
      dosage: q(2, "MILLILITRE", "ANIMAL"),
      concentration: q(10, "MILLILITRE", "VIAL"),
      solvent: { name: "Synthetic", volume: 20 },
    }),
  );
  expect(c.total).toEqual({ value: 2, unit: "MILLILITRE", time: null });
  expect(c.amount).toEqual({ value: 4, unit: "MILLILITRE", time: null });
  expect(c.effectiveConcentration).toBe(0.5);
  expect(c.warnings).toEqual([]);
});

it("overflow in reconstituted concentration cannot yield a false zero volume", () => {
  const c = calc(
    standard({
      concentration: q(1e308, "MILLIGRAM", "VIAL"),
      solvent: { name: "Synthetic", volume: 1e-308 },
    }),
  );
  expect(c.amount).toBeNull();
  expect(c.effectiveConcentration).toBeNull();
});
it("underflow of a positive calculated quantity cannot be displayed as a true zero", () => {
  const c = calc(
    standard({
      dosage: q(1e-308, "MICROGRAM", "ANIMAL"),
      concentration: q(1e308, "MILLIGRAM", "MILLILITRE"),
    }),
  );
  expect(c.amount).toBeNull();
  expect(c.warnings.length).toBeGreaterThan(0);
});
