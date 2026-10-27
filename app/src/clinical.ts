import { obj, text, describe, type Chain, type Revision } from "./model";
import { parseCleverVetUnits, formatClinicalNumber } from "./clevervetUnits";
import { medicationFields, sourceQuantity } from "./medication";
export interface ClinicalField {
  label: string;
  value: string;
  path: string;
}
// Quantities use an explicit unit parser, never describe() for medical units.
function quantity(value: unknown): string {
  const o = obj(value),
    n = o.value ?? o.amount ?? value;
  const scalar = typeof n === "number" ? formatClinicalNumber(n) : text(n);
  const units = parseCleverVetUnits(o.units ?? o.unit);
  return scalar ? `${scalar}${units.ok ? ` ${units.label}` : ""}` : "";
}
export function clinicalFields(
  chain: Chain,
  revision?: Revision,
): ClinicalField[] {
  if (!revision) return [];
  if (chain.type === "MEDICATION")
    return medicationFields(revision.specifics).fields;
  const s = revision.specifics,
    fields: ClinicalField[] = [];
  if (chain.type === "SOLUTION") {
    const name = describe(s.solution ?? s.solutionName);
    if (name)
      fields.push({
        label: "Раствор",
        value: name,
        path: "specifics.solution",
      });
    const rate = quantity(obj(s.scarce).value);
    if (rate)
      fields.push({
        label: "Скорость инфузии",
        value: `${rate} мл/ч`,
        path: "specifics.scarce.value",
      });
  }
  return fields;
}
export function workClinicalFields(
  chain: Chain,
  revision?: Revision,
): { fields: ClinicalField[]; warnings: string[] } {
  if (chain.type === "MEDICATION" && revision) {
    const { fields, warnings } = medicationFields(revision.specifics, true);
    return { fields, warnings };
  }
  return {
    fields: clinicalFields(chain, revision).filter(
      (f) => f.label === "Скорость инфузии",
    ),
    warnings: [],
  };
}

/** Same source-dose/route summary everywhere; never substitute calculated ml. */
export function clinicalParameters(chain: Chain, revision?: Revision): string {
  if (!revision) return "";
  if (chain.type === "MEDICATION") {
    const c = medicationFields(revision.specifics, true).calculation;
    const parts: string[] = [];
    if (c.dosage.value !== null) parts.push(sourceQuantity(c.dosage));
    if (c.route.label !== "Путь введения не указан") parts.push(c.route.label);
    return parts.join(" · ");
  }
  if (chain.type === "SOLUTION")
    return (
      clinicalFields(chain, revision).find(
        (f) => f.path === "specifics.scarce.value",
      )?.value ?? ""
    );
  return "";
}
export function clinicalTitle(chain: Chain, revision?: Revision): string {
  const parameters = clinicalParameters(chain, revision);
  return chain.name + (parameters ? ` · ${parameters}` : "");
}
