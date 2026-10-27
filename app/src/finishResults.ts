/** Original AH/iA + bN.excludeResult; distinct from moving a patient between departments. */
export const FINISH_LABELS = {
  DISCHARGED: "Выписан",
  DIED: "Умер",
  TRANSFERRED_TO_DAY_HOSPITAL: "Переведён в дневной стационар",
  TRANSFERRED_TO_ROUND_THE_CLOCK_HOSPITAL:
    "Переведён в круглосуточный стационар",
  INTERRUPTED_BY_OWNER: "Лечение прервано по инициативе владельца",
} as const;
export type FinishResult = keyof typeof FINISH_LABELS;
export const FINISH_RESULTS = Object.keys(FINISH_LABELS) as FinishResult[];
export function availableFinishResults(hospital: string): FinishResult[] {
  const excluded =
    hospital === "DAY"
      ? "TRANSFERRED_TO_DAY_HOSPITAL"
      : hospital === "ROUND_THE_CLOCK"
        ? "TRANSFERRED_TO_ROUND_THE_CLOCK_HOSPITAL"
        : null;
  return FINISH_RESULTS.filter((r) => r !== excluded);
}
export function isFinishResult(value: unknown): value is FinishResult {
  return typeof value === "string" && Object.hasOwn(FINISH_LABELS, value);
}
