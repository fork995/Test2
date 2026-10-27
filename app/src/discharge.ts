import { ApiError, safeError } from "./api";
import type { DischargeApi } from "./dischargeApi";
import {
  classifySchedule,
  hasScheduledTaskOn,
  hourColumns,
} from "./hourlySummary";
import type { Chain, Patient } from "./model";
import type { Source } from "./source";
import { HOUR, zonedStart } from "./time";
import {
  availableFinishResults,
  isFinishResult,
  type FinishResult,
} from "./finishResults";
export { FINISH_RESULTS } from "./finishResults";

export const DISCHARGE_ZONE = "Europe/Moscow";
export function dischargeTime(date: string, clock: string): number | null {
  return /^\d{4}-\d\d-\d\d$/.test(date) && /^\d\d:\d\d$/.test(clock)
    ? zonedStart(date, clock, DISCHARGE_ZONE)
    : null;
}
/** Original gN min, last sheet max, Ase/rNe unfinished-task validator. No schedule mutation. */
export function dischargeProblem(
  patient: Patient,
  chains: Chain[],
  end: number,
): string | null {
  if (patient.cardStatus !== "ACTIVE" || !patient.cardId)
    return "Карта уже завершена или недоступна для завершения лечения. Обновите данные.";
  if (!Number.isFinite(end))
    return "Укажите корректную дату и время завершения лечения.";
  const start = patient.admissionStart;
  if (start == null || !Number.isFinite(start) || !patient.sheets.length)
    return "Не удалось проверить период лечения. Обновите карту перед завершением лечения.";
  const revisions = chains.flatMap((c) => c.elements);
  if (revisions.some((r) => r.results.some((v) => v.at === null)))
    return "Не удалось проверить время одной из отметок. Проверьте карту в CleverVet перед завершением лечения.";
  const resultTimes = revisions.flatMap((r) =>
    r.results.map((v) => v.at).filter((v): v is number => v !== null),
  );
  const min =
    (resultTimes.length
      ? resultTimes.reduce((a, b) => Math.max(a, b), -Infinity)
      : start) + 60000;
  const max = Math.max(...patient.sheets.map((s) => s.end));
  if (end < Math.max(start + 60000, min))
    return "Время завершения лечения должно быть позже начала лечения и последней отметки минимум на минуту.";
  if (end > max)
    return "Время завершения лечения выходит за границы последнего листа назначений.";
  for (const r of revisions) {
    const kind = classifySchedule(r);
    if (kind === "INACTIVE" || kind === "MANUAL_AS_NEEDED" || r.start! >= end)
      continue;
    if (kind === "UNCONFIRMED" || (r.end !== null && r.end < r.start!))
      return "Расписание содержит неоднозначные данные. Проверьте карту в CleverVet перед завершением лечения.";
    const stop = Math.min(end, r.end ?? end);
    if (stop <= r.start!) continue;
    if (stop - r.start! > 10000 * HOUR)
      return "Слишком большой период для проверки завершения. Используйте оригинальный CleverVet.";
    if (
      hourColumns({ start: r.start!, end: stop }, DISCHARGE_ZONE).some(
        (at) =>
          hasScheduledTaskOn(r, at, DISCHARGE_ZONE) &&
          !r.results.some((result) => result.at === at),
      )
    )
      return "Есть незавершённые задания до времени завершения лечения. Проверьте их в карте CleverVet.";
  }
  return null;
}
export class DischargeError extends Error {
  constructor(
    public kind: "Disabled" | "Busy" | "Conflict" | "Unverified" | "Validation",
    public detail = "",
    public apiError?: ApiError,
  ) {
    super(kind);
    this.name = "DischargeError";
  }
}
export function dischargeError(error: unknown): string {
  if (!(error instanceof DischargeError)) return safeError(error);
  return error.kind === "Validation"
    ? error.detail
    : {
        Disabled: "Редактирование отключено в настройках.",
        Busy: "Дождитесь завершения предыдущей завершения лечения.",
        Conflict:
          "Карта пациента изменилась. Обновите данные перед завершением лечения.",
        Unverified:
          "Завершение лечения не подтверждено. Сервер мог завершить лечение. Обновите данные и проверьте карту в CleverVet перед повтором.",
      }[error.kind];
}
export interface DischargeReceipt {
  patients: Patient[];
  patient: Patient;
}
export interface Discharger {
  setEnabled(value: boolean): void;
  finish(
    patient: Patient,
    end: number,
    result?: FinishResult,
  ): Promise<DischargeReceipt>;
  close(): void;
}
export function createDischarger(
  reader: Source,
  api: DischargeApi,
  context: (card: string) => [string, string] | undefined,
): Discharger {
  let enabled = false,
    closed = false,
    controller: AbortController | null = null;
  return {
    setEnabled(value) {
      enabled = value && !closed;
    },
    async finish(patient, end, result = "DISCHARGED") {
      if (!enabled || closed) throw new DischargeError("Disabled");
      if (controller) throw new DischargeError("Busy");
      const location = context(patient.cardId);
      if (!location || !Number.isFinite(end))
        throw new DischargeError("Conflict");
      if (
        !isFinishResult(result) ||
        !availableFinishResults(patient.hospital).includes(result)
      )
        throw new DischargeError(
          "Validation",
          "Выберите доступный результат завершения лечения.",
        );
      const operation = new AbortController();
      controller = operation;
      let sent = false;
      try {
        const fresh = await api.patient(
          location[0],
          patient.id,
          operation.signal,
        );
        if (
          fresh.id !== patient.id ||
          fresh.cardId !== patient.cardId ||
          fresh.cardStatus !== "ACTIVE"
        )
          throw new DischargeError("Conflict");
        if (!availableFinishResults(fresh.hospital).includes(result))
          throw new DischargeError("Conflict");
        const chains = await reader.chains(
          patient.cardId,
          operation.signal,
          true,
        );
        const problem = dischargeProblem(fresh, chains, end);
        if (problem) throw new DischargeError("Validation", problem);
        if (closed || !enabled || operation.signal.aborted)
          throw new DischargeError("Disabled");
        sent = true;
        await api.finish(
          patient.cardId,
          new Date(end).toISOString(),
          operation.signal,
          result,
        );
        // Both readbacks always start after a successful response, even when one fails.
        const [card, list] = await Promise.allSettled([
          api.patient(location[0], patient.id, operation.signal),
          reader.patients(...location, operation.signal, true),
        ]);
        if (card.status === "rejected") throw card.reason;
        if (list.status === "rejected") throw list.reason;
        const confirmed = card.value;
        if (
          closed ||
          operation.signal.aborted ||
          confirmed.id !== patient.id ||
          confirmed.cardId !== patient.cardId ||
          confirmed.treatmentEnd !== end ||
          !confirmed.cardStatus ||
          confirmed.cardStatus === "ACTIVE" ||
          list.value.some(
            (p) => p.cardId === patient.cardId && p.cardStatus === "ACTIVE",
          )
        )
          throw new DischargeError("Unverified");
        return {
          patient: confirmed,
          patients: list.value.filter((p) => p.cardId !== patient.cardId),
        };
      } catch (error) {
        if (sent && !(error instanceof DischargeError))
          throw new DischargeError(
            "Unverified",
            "",
            error instanceof ApiError ? error : undefined,
          );
        throw error;
      } finally {
        if (controller === operation) controller = null;
      }
    },
    close() {
      closed = true;
      enabled = false;
      controller?.abort();
      controller = null;
      api.close();
    },
  };
}
