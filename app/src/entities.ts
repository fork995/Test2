import { ApiError, safeError } from "./api";
import type { EntityApi } from "./entityApi";
import {
  normalizeBelongings,
  validateBelonging,
  calendarDate,
  type Belonging,
} from "./belongings";
import type { Patient } from "./model";
import { buildPatient, type PatientDraft } from "./patientCreation";
import type { Source } from "./source";
import type { Location } from "./transferApi";
export class EntityError extends Error {
  constructor(
    public kind: "Disabled" | "Busy" | "Conflict" | "Unverified",
    public apiError?: ApiError,
  ) {
    super(kind);
    this.name = "EntityError";
  }
}
export function entityError(e: unknown): string {
  if (!(e instanceof EntityError))
    return e instanceof ApiError
      ? safeError(e)
      : "Не удалось завершить действие. Проверьте введённые данные.";
  return (
    {
      Disabled: "Редактирование отключено.",
      Busy: "Дождитесь завершения предыдущего действия.",
      Conflict: "Данные изменились. Обновите список перед повтором.",
      Unverified:
        "Результат не подтверждён. Сервер мог принять изменение. Обновите данные и проверьте их в CleverVet перед повтором.",
    }[e.kind] + (e.apiError?.kind === "Forbidden" ? " Доступ запрещён." : "")
  );
}
export type BelongingChange =
  | { kind: "add"; value: Belonging }
  | { kind: "edit"; value: Belonging; before: Belonging }
  | { kind: "delete"; before: Belonging }
  | {
      kind: "finish";
      before: Belonging;
      status: "RETURNED" | "CONSUMED";
      date: string;
    }
  | { kind: "receive"; before: Belonging };
export interface EntityService {
  setEnabled(value: boolean): void;
  list(patient: string, signal: AbortSignal): Promise<Belonging[]>;
  change(
    patient: string,
    change: BelongingChange,
    signal: AbortSignal,
  ): Promise<Belonging[]>;
  create(
    location: Location,
    draft: PatientDraft,
    zone: string,
  ): Promise<{ patients: Patient[]; patient: Patient }>;
  remove(patient: Patient, confirmation: string): Promise<Patient[]>;
  close(): void;
}
export function createEntityService(
  reader: Source,
  api: EntityApi,
  context: (card: string) => [string, string] | undefined,
): EntityService {
  let enabled = false,
    closed = false,
    running: AbortController | null = null;
  async function mutate<T>(
    task: (signal: AbortSignal, sent: () => void) => Promise<T>,
    external?: AbortSignal,
  ): Promise<T> {
    if (!enabled || closed) throw new EntityError("Disabled");
    if (running) throw new EntityError("Busy");
    const c = new AbortController();
    running = c;
    const abort = () => c.abort();
    external?.addEventListener("abort", abort, { once: true });
    if (external?.aborted) c.abort();
    let sent = false;
    try {
      return await task(c.signal, () => {
        if (c.signal.aborted || closed || !enabled)
          throw new EntityError("Disabled");
        sent = true;
      });
    } catch (e) {
      if (sent && !(e instanceof EntityError))
        throw new EntityError(
          "Unverified",
          e instanceof ApiError ? e : undefined,
        );
      throw e;
    } finally {
      external?.removeEventListener("abort", abort);
      if (running === c) running = null;
    }
  }
  const list = async (p: string, s: AbortSignal) =>
    normalizeBelongings(await api.belongings(p, s));
  return {
    setEnabled(v) {
      enabled = v && !closed;
    },
    list,
    change(patient, change, external) {
      return mutate(async (s, sent) => {
        const fresh = await list(patient, s),
          before = change.kind === "add" ? undefined : change.before;
        if (
          before &&
          JSON.stringify(fresh.find((b) => b.id === before.id)) !==
            JSON.stringify(before)
        )
          throw new EntityError("Conflict");
        if (change.kind === "add" || change.kind === "edit") {
          validateBelonging(change.value);
          if (
            change.kind === "add" &&
            (fresh.some((b) => b.id === change.value.id) ||
              change.value.status !== "RECEIVED")
          )
            throw new EntityError("Conflict");
          if (
            change.kind === "edit" &&
            (!before ||
              change.value.id !== before.id ||
              change.value.creationDate !== before.creationDate ||
              change.value.status !== before.status ||
              change.value.returnDate !== before.returnDate)
          )
            throw new EntityError("Conflict");
          sent();
          await (change.kind === "add"
            ? api.addBelonging(patient, change.value, s)
            : api.updateBelonging(patient, change.value, s));
        } else if (change.kind === "delete") {
          sent();
          await api.deleteBelonging(patient, change.before.id, s);
        } else if (change.kind === "finish") {
          if (
            !["RETURNED", "CONSUMED"].includes(change.status) ||
            change.before.status !== "RECEIVED" ||
            !calendarDate(change.date) ||
            change.date < change.before.receivingDate
          )
            throw new EntityError("Conflict");
          sent();
          await api.finishBelonging(
            patient,
            change.before.id,
            change.status,
            change.date,
            s,
          );
        } else {
          if (!["RETURNED", "CONSUMED"].includes(change.before.status))
            throw new EntityError("Conflict");
          sent();
          await api.receiveBelonging(patient, change.before.id, s);
        }
        const after = await list(patient, s),
          target = after.find(
            (b) =>
              b.id ===
              (change.kind === "add" || change.kind === "edit"
                ? change.value.id
                : change.before.id),
          );
        const ok =
          change.kind === "delete"
            ? !target
            : change.kind === "add" || change.kind === "edit"
              ? target &&
                [
                  "id",
                  "name",
                  "receivingDate",
                  "status",
                  "comment",
                  "creationDate",
                  "returnDate",
                ].every(
                  (k) =>
                    target[k as keyof Belonging] ===
                    change.value[k as keyof Belonging],
                )
              : change.kind === "finish"
                ? target?.status === change.status &&
                  target.returnDate === change.date
                : target?.status === "RECEIVED" && !target.returnDate;
        if (!ok || s.aborted || closed) throw new EntityError("Unverified");
        return after;
      }, external);
    },
    create(location, draft, zone) {
      return mutate(async (s, sent) => {
        const branch = (await reader.branches(s)).find(
          (b) =>
            b.id === location.branchId &&
            b.departments.some((d) => d.id === location.departmentId),
        );
        if (!branch) throw new EntityError("Conflict");
        const payload = buildPatient(draft, branch, zone);
        sent();
        await api.createPatient(location, payload, s);
        const patients = await reader.patients(
            location.branchId,
            location.departmentId,
            s,
            true,
          ),
          matches = patients.filter(
            (p) =>
              p.id === payload.id &&
              p.cardId === payload.card.id &&
              p.cardStatus === "ACTIVE",
          );
        if (matches.length !== 1 || s.aborted || closed)
          throw new EntityError("Unverified");
        return { patients, patient: matches[0] };
      });
    },
    remove(patient, confirmation) {
      return mutate(async (s, sent) => {
        const l = context(patient.cardId);
        if (!l || confirmation !== patient.name)
          throw new EntityError("Conflict");
        const before = await reader.patients(...l, s, true);
        const matches = before.filter(
          (p) =>
            p.id === patient.id &&
            p.cardId === patient.cardId &&
            p.name === confirmation,
        );
        if (matches.length !== 1) throw new EntityError("Conflict");
        sent();
        await api.deletePatient(
          { branchId: l[0], departmentId: l[1] },
          patient.id,
          s,
        );
        const after = await reader.patients(...l, s, true);
        if (after.some((p) => p.id === patient.id) || s.aborted || closed)
          throw new EntityError("Unverified");
        return after;
      });
    },
    close() {
      closed = true;
      enabled = false;
      running?.abort();
      running = null;
      api.close();
    },
  };
}
