import { ApiError, safeError } from "./api";
import type { Branch, Chain, Patient } from "./model";
import type { Source } from "./source";
import type { Location, TransferApi } from "./transferApi";
export function transferTargets(branches: Branch[], current: Location) {
  return branches.flatMap((b) =>
    b.departments
      .filter((d) => b.id !== current.branchId || d.id !== current.departmentId)
      .map((d) => ({
        branchId: b.id,
        departmentId: d.id,
        label: `${b.name} · ${d.name}`,
      })),
  );
}
export function preservedHistory(before: Chain[], after: Chain[]): boolean {
  return before.every((c) => {
    const matches = after.filter((v) => v.id === c.id);
    return (
      matches.length === 1 &&
      c.elements.every((r) => {
        const revisions = matches[0].elements.filter((v) => v.id === r.id);
        return (
          revisions.length === 1 &&
          r.results.every((result) =>
            revisions[0].results.some(
              (v) => v.id === result.id && v.hour === result.hour,
            ),
          )
        );
      })
    );
  });
}
export class TransferError extends Error {
  constructor(
    public kind: "Disabled" | "Busy" | "Conflict" | "Unverified",
    public apiError?: ApiError,
  ) {
    super(kind);
    this.name = "TransferError";
  }
}
export function transferError(error: unknown): string {
  if (!(error instanceof TransferError)) return safeError(error);
  return (
    {
      Disabled: "Редактирование отключено.",
      Busy: "Дождитесь завершения предыдущего перевода.",
      Conflict:
        "Пациент или доступные отделения изменились. Обновите данные перед переводом.",
      Unverified:
        "Перевод не подтверждён. Сервер мог принять изменение. Проверьте оба отделения в CleverVet перед повтором.",
    }[error.kind] +
    (error.apiError?.kind === "Forbidden" ? " Доступ запрещён." : "")
  );
}
export interface TransferReceipt {
  patients: Patient[];
  patient: Patient;
  destination: Location;
}
export interface TransferService {
  setEnabled(value: boolean): void;
  move(patient: Patient, to: Location): Promise<TransferReceipt>;
  close(): void;
}
export function createTransferService(
  reader: Source,
  api: TransferApi,
  context: (card: string) => [string, string] | undefined,
): TransferService {
  let enabled = false,
    closed = false,
    controller: AbortController | null = null;
  return {
    setEnabled(value) {
      enabled = value && !closed;
    },
    async move(patient, destination) {
      if (closed || !enabled) throw new TransferError("Disabled");
      if (controller) throw new TransferError("Busy");
      const original = context(patient.cardId);
      if (!original || patient.cardStatus !== "ACTIVE")
        throw new TransferError("Conflict");
      const from = { branchId: original[0], departmentId: original[1] },
        to = { ...destination };
      const operation = new AbortController();
      controller = operation;
      let sent = false;
      try {
        const branches = await reader.branches(operation.signal);
        if (
          !transferTargets(branches, from).some(
            (v) =>
              v.branchId === to.branchId && v.departmentId === to.departmentId,
          )
        )
          throw new TransferError("Conflict");
        const current = await reader.patients(
          ...original,
          operation.signal,
          true,
        );
        const matches = current.filter(
          (p) =>
            p.id === patient.id &&
            p.cardId === patient.cardId &&
            p.cardStatus === "ACTIVE",
        );
        if (matches.length !== 1) throw new TransferError("Conflict");
        const before = await reader.chains(
          patient.cardId,
          operation.signal,
          true,
        );
        if (!enabled || closed || operation.signal.aborted)
          throw new TransferError("Disabled");
        sent = true;
        await api.move(from, patient.id, to, operation.signal);
        // All three checks complete before the visible list is changed.
        const [oldList, newList, chains] = await Promise.allSettled([
          reader.patients(...original, operation.signal, true),
          reader.patients(to.branchId, to.departmentId, operation.signal, true),
          reader.chains(patient.cardId, operation.signal, true),
        ]);
        if (oldList.status === "rejected") throw oldList.reason;
        if (newList.status === "rejected") throw newList.reason;
        if (chains.status === "rejected") throw chains.reason;
        const found = newList.value.filter(
          (p) =>
            p.id === patient.id &&
            p.cardId === patient.cardId &&
            p.cardStatus === "ACTIVE",
        );
        if (
          closed ||
          operation.signal.aborted ||
          found.length !== 1 ||
          oldList.value.some(
            (p) => p.id === patient.id && p.cardId === patient.cardId,
          ) ||
          !preservedHistory(before, chains.value)
        )
          throw new TransferError("Unverified");
        return { patients: oldList.value, patient: found[0], destination: to };
      } catch (error) {
        if (sent && !(error instanceof TransferError))
          throw new TransferError(
            "Unverified",
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
