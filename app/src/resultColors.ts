/** Original CleverVet AN enum and Fv palette, main-CQEG7G2F.js. */
export const RESULT_COLORS = [
  { value: "yellow", label: "Жёлтый" },
  { value: "orange", label: "Оранжевый" },
  { value: "lightgreen", label: "Зелёный" },
  { value: "lightblue", label: "Голубой" },
  { value: "violet", label: "Фиолетовый" },
  { value: "pink", label: "Розовый" },
  { value: "lightyellow", label: "Светло-жёлтый" },
] as const;
export type ResultColor = (typeof RESULT_COLORS)[number]["value"];
export type ResultColorChange =
  | { kind: "set"; value: ResultColor }
  | { kind: "clear" };
export function isResultColor(value: unknown): value is ResultColor {
  return RESULT_COLORS.some((c) => c.value === value);
}
/** Undefined means leave the current result color alone, including legacy colors. */
export function validColorChange(
  change: unknown,
): change is ResultColorChange | undefined {
  if (change === undefined) return true;
  if (!change || typeof change !== "object" || Array.isArray(change))
    return false;
  const c = change as Record<string, unknown>;
  return (
    (c.kind === "clear" && Object.keys(c).length === 1) ||
    (c.kind === "set" && isResultColor(c.value) && Object.keys(c).length === 2)
  );
}
export function resultColorAfter(
  change: ResultColorChange | undefined,
  existing: string | undefined,
): string | undefined {
  return change?.kind === "clear"
    ? undefined
    : change?.kind === "set"
      ? change.value
      : existing || undefined;
}
