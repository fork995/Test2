import { ApiError, safeError } from "./api";
import {
  cardState,
  instant,
  type Chain,
  type Patient,
  type Result,
  type Revision,
} from "./model";
import { classifySchedule, hourStart } from "./hourlySummary";
import { HOUR } from "./time";
import { revisionEnabled } from "./cellAvailability";
import {
  validColorChange,
  resultColorAfter,
  type ResultColorChange,
} from "./resultColors";

export const RESULT_REASONS = {
  DEVICE_ABSENT: "Отсутствует оборудование",
  MEDICATION_ABSENT: "Отсутствует препарат",
  ON_DIAGNOSTICS: "Пациент на диагностике",
  ORGANIZATIONAL: "Организационная причина",
  BODY_CONDITION_CHANGED: "Изменение состояния пациента",
} as const;
export type ResultReason = keyof typeof RESULT_REASONS;
export interface ResultPayload {
  id: string;
  status: "EXECUTED" | "NOT_EXECUTED";
  reason?: ResultReason;
  comment: string;
  color?: string;
  hour: string;
  creationDate: string;
}
export interface ResultTarget {
  patient: Patient;
  chainId: string;
  revision: Revision;
  at: number;
  zone: string;
  existing?: Result;
  /** Full server chain for effective parent/successor boundaries. */
  chain?: Chain;
}
export interface ResultInput {
  status: ResultPayload["status"];
  reason?: string;
  comment: string;
  colorChange?: ResultColorChange;
}
export interface WriteReceipt {
  chains: Chain[];
  patient: Patient;
}
type WriteKind =
  | "Disabled"
  | "Busy"
  | "Unavailable"
  | "ReasonRequired"
  | "InvalidColor"
  | "Conflict"
  | "AmbiguousSlot"
  | "Unverified";
export class ResultWriteError extends Error {
  constructor(
    public readonly kind: WriteKind,
    public readonly apiError?: ApiError,
  ) {
    super(kind);
    this.name = "ResultWriteError";
  }
}
export function writeError(error: unknown): string {
  if (!(error instanceof ResultWriteError)) return safeError(error);
  const message = {
    Disabled: "Запись выключена. Включите её в настройках.",
    Busy: "Дождитесь завершения предыдущей записи.",
    Unavailable:
      "Эта ячейка недоступна для записи. Обновите данные и проверьте лист в CleverVet.",
    ReasonRequired: "Выберите причину невыполнения.",
    InvalidColor:
      "Выберите цвет из палитры CleverVet или отключите подкрашивание.",
    AmbiguousSlot:
      "В этом часе несколько результатов. Возврат в запланированное неоднозначен. Проверьте отметки в оригинальном CleverVet.",
    Conflict:
      "Ячейка или назначение изменились. Обновите данные и откройте отметку заново; сохранение отклонено.",
    Unverified:
      "Результат операции не подтверждён. Сервер мог принять изменение. Обновите данные и проверьте отметку перед повторной записью.",
  }[error.kind];
  return error.apiError ? `${message} ${safeError(error.apiError)}` : message;
}
const validId = (id: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id);
// Original Wi = uuid.v7. A cryptographically random RFC 9562 v7 ID, generated once per operation.
export function newResultId(now = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let timestamp = BigInt(Math.trunc(now));
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(timestamp & 255n);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6] & 15) | 0x70;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
// Fail closed for unknown sheet permissions; this does not alter the read-only schedule engine.
export function cellWriteProblem(target: ResultTarget): string | null {
  const { patient, revision, at, existing, zone } = target;
  if (
    !validId(patient.cardId) ||
    !validId(target.chainId) ||
    !validId(revision.id) ||
    revision.idConfirmed !== true ||
    (!!revision.rawEnd && revision.end === null) ||
    cardState(patient) !== "active"
  )
    return "Не подтверждены идентификаторы или активная карта.";
  if (
    existing &&
    (!validId(existing.id) ||
      existing.idConfirmed !== true ||
      existing.at !== at ||
      instant(existing.created) === null)
  )
    return "Не подтверждены исходные данные результата.";
  const kind = classifySchedule(revision);
  if (!revisionEnabled(revision, at, zone, target.chain))
    return "Ячейка неактивна: в этот час нет действующей редакции назначения.";
  if (kind !== "MANUAL_AS_NEEDED" && !existing && at !== hourStart(at, zone))
    return "Выберите начало часовой колонки.";
  const hour = hourStart(at, zone);
  if (
    (patient.treatmentStart != null && patient.treatmentStart >= hour + HOUR) ||
    (patient.treatmentEnd != null && patient.treatmentEnd <= hour)
  )
    return "Время вне периода лечения.";
  const sheets = patient.sheets.filter((s) =>
    kind === "MANUAL_AS_NEEDED" && at !== hour
      ? s.start <= at && at < s.end
      : s.start < at + HOUR && at < s.end,
  );
  if (
    sheets.length !== 1 ||
    sheets[0].source !== "direct" ||
    sheets[0].locked !== false
  )
    return sheets.some((s) => s.locked)
      ? "Лист лечения заблокирован."
      : "Доступность листа не подтверждена. Обновите данные.";
  return null;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function revisionState(r: Revision) {
  const { results: _results, ...fields } = r;
  return canonical(fields);
}
function slotState(r: Revision, at: number) {
  return canonical(
    r.results
      .filter((x) => x.at === at)
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}
export interface ResultTransport {
  put(
    card: string,
    revision: string,
    payload: ResultPayload,
    signal: AbortSignal,
  ): Promise<void>;
  remove(
    card: string,
    revision: string,
    result: string,
    signal: AbortSignal,
  ): Promise<void>;
  close(): void;
}
export interface ResultWriter {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  save(target: ResultTarget, input: ResultInput): Promise<WriteReceipt>;
  remove(target: ResultTarget): Promise<WriteReceipt>;
  close(): void;
}
export function createResultWriter(
  transport: ResultTransport,
  readChains: (card: string, signal: AbortSignal) => Promise<Chain[]>,
  readPatient: (patient: Patient, signal: AbortSignal) => Promise<Patient>,
): ResultWriter {
  let enabled = false,
    closed = false,
    controller: AbortController | null = null;
  async function change(
    target: ResultTarget,
    input?: ResultInput,
  ): Promise<WriteReceipt> {
    if (closed || !enabled) throw new ResultWriteError("Disabled");
    if (controller) throw new ResultWriteError("Busy");
    if (cellWriteProblem(target)) throw new ResultWriteError("Unavailable");
    if (!input && !target.existing) throw new ResultWriteError("Unavailable");
    if (input && input.status !== "EXECUTED" && input.status !== "NOT_EXECUTED")
      throw new ResultWriteError("Unavailable");
    if (
      input?.status === "NOT_EXECUTED" &&
      !Object.hasOwn(RESULT_REASONS, input.reason ?? "")
    )
      throw new ResultWriteError("ReasonRequired");
    if (input && !validColorChange(input.colorChange))
      throw new ResultWriteError("InvalidColor");
    if (input && typeof input.comment !== "string")
      throw new ResultWriteError("Unavailable");
    const operation = new AbortController();
    controller = operation;
    let sent = false,
      acknowledged = false;
    try {
      const patient = await readPatient(target.patient, operation.signal);
      const fresh = await readChains(patient.cardId, operation.signal);
      const matches = fresh
        .filter((c) => c.id === target.chainId)
        .flatMap((c) => c.elements.filter((r) => r.id === target.revision.id));
      const revision = matches[0];
      if (
        patient.cardId !== target.patient.cardId ||
        matches.length !== 1 ||
        revisionState(revision) !== revisionState(target.revision) ||
        slotState(revision, target.at) !== slotState(target.revision, target.at)
      )
        throw new ResultWriteError("Conflict");
      const existing = target.existing
        ? revision.results.find((r) => r.id === target.existing!.id)
        : undefined;
      if (
        target.existing &&
        (!existing ||
          revision.results.filter((r) => r.id === target.existing!.id)
            .length !== 1 ||
          canonical(existing) !== canonical(target.existing))
      )
        throw new ResultWriteError("Conflict");
      if (
        !target.existing &&
        revision.results.some((r) =>
          classifySchedule(revision) !== "MANUAL_AS_NEEDED"
            ? r.at !== null &&
              hourStart(r.at, target.zone) === hourStart(target.at, target.zone)
            : r.at === target.at,
        )
      )
        throw new ResultWriteError("Conflict");
      if (
        !input &&
        classifySchedule(revision) !== "MANUAL_AS_NEEDED" &&
        revision.results.filter((r) => r.at === target.at).length !== 1
      )
        throw new ResultWriteError("AmbiguousSlot");
      if (
        cellWriteProblem({
          ...target,
          patient,
          revision,
          existing,
          chain: fresh.find((c) => c.id === target.chainId),
        })
      )
        throw new ResultWriteError("Unavailable");
      if (!enabled || closed || operation.signal.aborted)
        throw new ResultWriteError("Disabled");
      const id = existing?.id ?? newResultId();
      let payload: ResultPayload | undefined;
      if (input) {
        const color = resultColorAfter(input.colorChange, existing?.color);
        payload = {
          id,
          status: input.status,
          comment: input.comment,
          hour: new Date(target.at).toISOString(),
          creationDate: existing
            ? new Date(instant(existing.created)!).toISOString()
            : new Date(Date.now()).toISOString(),
          ...(input.status === "NOT_EXECUTED"
            ? { reason: input.reason as ResultReason }
            : {}),
          ...(color ? { color } : {}),
        };
        sent = true;
        await transport.put(
          patient.cardId,
          revision.id,
          payload,
          operation.signal,
        );
      } else {
        sent = true;
        await transport.remove(
          patient.cardId,
          revision.id,
          id,
          operation.signal,
        );
      }
      acknowledged = true;
      const verified = await readChains(patient.cardId, operation.signal);
      const revisions = verified
        .filter((c) => c.id === target.chainId)
        .flatMap((c) => c.elements.filter((r) => r.id === revision.id));
      const results = revisions.flatMap((r) =>
        r.results.filter((x) => x.id === id),
      );
      const actual = results[0];
      const otherResults = (r: Revision) =>
        canonical(
          r.results
            .filter((x) => x.at === target.at && x.id !== id)
            .sort((a, b) => a.id.localeCompare(b.id)),
        );
      if (
        revisions.length !== 1 ||
        revisionState(revisions[0]) !== revisionState(revision) ||
        otherResults(revisions[0]) !== otherResults(revision) ||
        (payload
          ? results.length !== 1 ||
            actual.status !== payload.status ||
            actual.comment !== payload.comment ||
            actual.at !== target.at ||
            instant(actual.created) !== instant(payload.creationDate) ||
            actual.reason !== (payload.reason ?? "") ||
            actual.color !== (payload.color ?? "")
          : results.length !== 0)
      )
        throw new ResultWriteError("Unverified");
      if (closed || operation.signal.aborted)
        throw new ResultWriteError("Unverified");
      return { chains: verified, patient };
    } catch (error) {
      if (
        !acknowledged &&
        error instanceof ApiError &&
        [409, 412].includes(error.status ?? 0)
      )
        throw new ResultWriteError("Conflict");
      if (
        sent &&
        (acknowledged ||
          !(
            error instanceof ApiError &&
            [401, 403, 409, 412].includes(error.status ?? 0)
          ))
      )
        throw new ResultWriteError(
          "Unverified",
          error instanceof ApiError ? error : undefined,
        );
      throw error;
    } finally {
      if (controller === operation) controller = null;
    }
  }
  return {
    setEnabled(value) {
      enabled = !closed && value;
      if (!enabled) controller?.abort();
    },
    isEnabled: () => enabled && !closed,
    save: (t, input) => change(t, input),
    remove: (t) => change(t),
    close() {
      closed = true;
      enabled = false;
      controller?.abort();
      transport.close();
    },
  };
}
