import { obj, type Obj } from "./model";
import {
  parseCleverVetUnits,
  compatibleAmount,
  UNIT_LABELS,
  TIME_LABELS,
  formatClinicalNumber as fmt,
  medicationRoute,
  type ParsedUnits,
  type TimeCode,
  type UnitCode,
} from "./clevervetUnits";
export interface MedicationQuantity {
  value: number | null;
  units: ParsedUnits;
  source: string;
}
export interface CalculatedQuantity {
  value: number;
  unit: UnitCode;
  time: TimeCode | null;
}
export interface MedicationCalculation {
  dosage: MedicationQuantity;
  concentration: MedicationQuantity;
  route: ReturnType<typeof medicationRoute>;
  weightKg: number | null;
  total: CalculatedQuantity | null;
  amount: CalculatedQuantity | null;
  effectiveConcentration: number | null;
  reconstituted: boolean;
  warnings: string[];
}
export function clinicalNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (
    typeof value === "string" &&
    /^[+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value.trim())
  ) {
    const n = Number(value.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
export function readMedicationQuantity(
  raw: unknown,
  source: string,
  unit?: unknown,
): MedicationQuantity {
  const o = obj(raw);
  return {
    value: clinicalNumeric(o.value ?? o.amount ?? raw),
    units: parseCleverVetUnits(o.units ?? o.unit ?? unit),
    source,
  };
}
export function medicationCalculation(s: Obj): MedicationCalculation {
  // Canonical API dosage wins over legacy display-only aliases. Only weightKg is
  // confirmed as the prescribed calculation weight; never take current patient weight.
  const doseKey =
    s.dosage !== undefined
      ? "dosage"
      : s.dose !== undefined
        ? "dose"
        : "doseValue";
  const dosage = readMedicationQuantity(
    s[doseKey],
    `specifics.${doseKey}`,
    s[`${doseKey}Unit`] ?? s.doseUnit,
  );
  const concentration = readMedicationQuantity(
    s.concentration,
    "specifics.concentration",
  );
  const route = medicationRoute(
    s.route ?? s.administrationRoute ?? s.routeOfAdministration,
  );
  const weightKg = clinicalNumeric(s.weightKg);
  const out: MedicationCalculation = {
    dosage,
    concentration,
    route,
    weightKg,
    total: null,
    amount: null,
    effectiveConcentration: null,
    reconstituted: false,
    warnings: [],
  };
  const warn = (s: string) => out.warnings.push(s);
  if (!route.known) warn(route.label);
  if (dosage.value === null || dosage.value < 0) {
    warn("Доза не задана или некорректна");
    return out;
  }
  if (!dosage.units.ok) {
    warn("Доза: единицы не подтверждены");
    return out;
  }
  const d = dosage.units;
  if (
    d.denominator !== null &&
    d.denominator !== "ANIMAL" &&
    d.denominator !== "KILOGRAM"
  ) {
    warn("Для этой размерности дозы расчёт не подтверждён");
    return out;
  }
  if (d.denominator === "KILOGRAM" && (weightKg === null || weightKg <= 0)) {
    warn("Нет массы назначения для расчёта");
    return out;
  }
  const total = dosage.value * (d.denominator === "KILOGRAM" ? weightKg! : 1);
  if (!Number.isFinite(total) || (dosage.value > 0 && total === 0)) {
    warn("Расчёт дозы вне допустимого диапазона");
    return out;
  }
  const hasPreparation = s.solvent !== undefined && s.solvent !== null;
  // A dosage already in ml is itself a volume, never divide it by mass concentration.
  if (d.numerator === "MILLILITRE" && !hasPreparation) {
    out.total = { value: total, unit: d.numerator, time: d.time };
    out.amount = { value: total, unit: "MILLILITRE", time: d.time };
    if (s.supplementarySolvent !== undefined && s.supplementarySolvent !== null)
      warn("Дополнительное разведение: итоговый объём смеси не рассчитан");
    return out;
  }
  if (!concentration.units.ok) {
    warn("Концентрация: единицы не подтверждены");
    return out;
  }
  if (concentration.value === null || concentration.value <= 0) {
    warn("Концентрация должна быть больше нуля");
    return out;
  }
  const c = concentration.units;
  if (
    ![
      "MILLILITRE",
      "VIAL",
      "TABLET",
      "CAPSULE",
      "SACHET",
      "SUPPOSITORY",
      "MICRO_ENEMA",
      "DOSE",
      "GRAM",
    ].includes(c.denominator ?? "")
  ) {
    warn("Не подтверждена единица количества препарата в концентрации");
    return out;
  }
  if (c.time !== null || c.denominator === null) {
    warn("Некорректная размерность концентрации");
    return out;
  }
  const conversion = compatibleAmount(d.numerator, c.numerator);
  if (conversion === null) {
    warn("Размерности дозы и концентрации несовместимы");
    return out;
  }
  out.total = { value: total, unit: d.numerator, time: d.time };
  let effective = concentration.value,
    denominator = c.denominator;
  if (hasPreparation) {
    const solvent = obj(s.solvent),
      volume = clinicalNumeric(solvent.volume);
    // Original xv also applies to ml/vial: source-drug ml and prepared ml are distinct.
    if (denominator !== "VIAL" || volume === null || volume <= 0) {
      warn("Не подтверждены параметры восстановления препарата");
      return out;
    }
    effective /= volume;
    denominator = "MILLILITRE";
    out.reconstituted = true;
  }
  if (!Number.isFinite(effective) || effective <= 0) {
    warn("Расчёт концентрации вне допустимого диапазона");
    return out;
  }
  out.effectiveConcentration = effective;
  const amount = (total * conversion) / effective;
  if (!Number.isFinite(amount) || (total > 0 && amount === 0)) {
    warn("Расчёт количества вне допустимого диапазона");
    return out;
  }
  out.amount = { value: amount, unit: denominator, time: d.time };
  if (s.supplementarySolvent !== undefined && s.supplementarySolvent !== null)
    warn("Дополнительное разведение: итоговый объём смеси не рассчитан");
  return out;
}
export function calculatedText(q: CalculatedQuantity): string {
  return `${fmt(q.value)} ${UNIT_LABELS[q.unit]}${q.time ? `/${TIME_LABELS[q.time]}` : ""}`;
}
export function sourceQuantity(q: MedicationQuantity): string {
  return `${q.value === null ? "—" : fmt(q.value)}${q.units.ok ? ` ${q.units.label}` : ""}`;
}
export interface MedicationField {
  label: string;
  value: string;
  path: string;
}
export function medicationFields(
  s: Obj,
  compact = false,
): {
  fields: MedicationField[];
  warnings: string[];
  calculation: MedicationCalculation;
} {
  const c = medicationCalculation(s),
    fields: MedicationField[] = [];
  const add = (label: string, value: string, path: string) =>
    fields.push({ label, value, path });
  add("Путь введения", c.route.label, "specifics.route");
  add("Доза из API", sourceQuantity(c.dosage), c.dosage.source);
  if (c.total)
    add(
      c.total.time
        ? "Доза в единицу времени"
        : !compact &&
            c.dosage.units.ok &&
            c.dosage.units.denominator === "KILOGRAM"
          ? `На массу ${fmt(c.weightKg!)} кг`
          : "Полная доза",
      calculatedText(c.total),
      "calculated.total",
    );
  if (!compact && s.concentration !== undefined)
    add(
      "Концентрация",
      sourceQuantity(c.concentration),
      "specifics.concentration",
    );
  if (!compact && s.solvent !== undefined && s.solvent !== null) {
    const solvent = obj(s.solvent),
      volume = clinicalNumeric(solvent.volume);
    if (typeof solvent.name === "string" && solvent.name.trim())
      add("Растворитель", solvent.name, "specifics.solvent.name");
    if (volume !== null)
      add(
        "Объём приготовления",
        `${fmt(volume)} мл`,
        "specifics.solvent.volume",
      );
  }
  if (
    !compact &&
    s.supplementarySolvent !== undefined &&
    s.supplementarySolvent !== null
  ) {
    const volume = clinicalNumeric(obj(s.supplementarySolvent).volume);
    if (volume !== null)
      add(
        "Дополнительное разведение из API",
        `${fmt(volume)} мл`,
        "specifics.supplementarySolvent.volume",
      );
  }
  if (
    !compact &&
    c.reconstituted &&
    c.effectiveConcentration !== null &&
    c.concentration.units.ok
  )
    add(
      "После восстановления",
      `${fmt(c.effectiveConcentration)} ${UNIT_LABELS[c.concentration.units.numerator]}/мл`,
      "calculated.effectiveConcentration",
    );
  if (c.amount) {
    const liquid = c.amount.unit === "MILLILITRE";
    add(
      c.amount.time
        ? liquid
          ? "Скорость препарата"
          : "Количество в единицу времени"
        : liquid
          ? c.reconstituted
            ? "Набрать из приготовленного препарата"
            : "Набрать"
          : "Количество препарата",
      calculatedText(c.amount),
      "calculated.amount",
    );
  }
  if (!compact && c.weightKg !== null)
    add("Масса в назначении", `${fmt(c.weightKg)} кг`, "specifics.weightKg");
  if (!compact && c.weightKg === null) {
    const key = ["patientWeightKg", "patientWeight", "weight"].find(
      (k) => s[k] !== undefined,
    );
    if (key) {
      const value = s[key],
        parsed = readMedicationQuantity(value, `specifics.${key}`);
      const amount = clinicalNumeric(value);
      if (key.endsWith("Kg") && amount !== null)
        add(
          "Масса из исходных данных",
          `${fmt(amount)} кг`,
          `specifics.${key}`,
        );
      else if (parsed.value !== null && parsed.units.ok)
        add(
          "Масса из исходных данных",
          sourceQuantity(parsed),
          `specifics.${key}`,
        );
    }
  }
  return { fields, warnings: c.warnings, calculation: c };
}
