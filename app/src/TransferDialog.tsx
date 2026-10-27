import { useEffect, useRef, useState } from "react";
import { ApiError, safeError } from "./api";
import type { Branch, Patient } from "./model";
import type { Source } from "./source";
import type { Location } from "./transferApi";
import {
  transferTargets,
  TransferError,
  transferError,
  type TransferReceipt,
} from "./transfer";
import { PatientPhoto } from "./PatientPhoto";
export function TransferDialog({
  patient,
  current,
  currentLabel,
  source,
  onClose,
  onSaved,
  onExpire,
}: {
  patient: Patient;
  current: Location;
  currentLabel: string;
  source: Source;
  onClose: () => void;
  onSaved: (receipt: TransferReceipt) => void;
  onExpire: (message?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    sending = useRef(false),
    live = useRef(true);
  const [branches, setBranches] = useState<Branch[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [branchId, setBranchId] = useState(""),
    [departmentId, setDepartmentId] = useState(""),
    [retry, setRetry] = useState(0);
  const [confirmation, setConfirmation] = useState<
      (Location & { label: string }) | null
    >(null),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false);
  const targets = transferTargets(branches, current),
    chosen = targets.find(
      (v) => v.branchId === branchId && v.departmentId === departmentId,
    );
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      live.current = false;
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    source
      .branches(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setBranches(data);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.kind === "Unauthorized")
          onExpire();
        else setError(safeError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [source, retry]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current || blocked || !chosen || !source.transfer) return;
    if (!confirmation) {
      setConfirmation({ ...chosen });
      return;
    }
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = await source.transfer.move(patient, confirmation);
      if (live.current) onSaved(receipt);
    } catch (error) {
      if (!live.current) return;
      if (
        (error instanceof ApiError && error.kind === "Unauthorized") ||
        (error instanceof TransferError &&
          error.apiError?.kind === "Unauthorized")
      ) {
        onExpire(
          "Сеанс истёк. Проверьте фактическое отделение пациента перед повтором.",
        );
        return;
      }
      setError(transferError(error));
      if (
        error instanceof TransferError &&
        ["Conflict", "Unverified"].includes(error.kind)
      )
        setBlocked(true);
    } finally {
      sending.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="bottom-sheet discharge-dialog transfer-dialog"
      aria-labelledby="transfer-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!sending.current) onClose();
      }}
    >
      <div className="sheet-handle" />
      <div className="sheet-header">
        <h2 id="transfer-title">
          {confirmation ? "Подтвердить перевод?" : "Перевод в другое отделение"}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть перевод"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="discharge-patient">
        <PatientPhoto patient={patient} demo={source.demo} large />
        <strong>{patient.name}</strong>
      </div>
      <p className="micro">Текущее отделение</p>
      <p>{currentLabel}</p>
      <p className="micro">
        Медицинская карта и назначения не завершаются. Перевод меняет отделение
        пациента.
      </p>
      <form onSubmit={submit}>
        {confirmation ? (
          <section className="operation-confirmation">
            <p className="micro">Новое отделение</p>
            <p>
              <strong>{confirmation.label}</strong>
            </p>
            <button
              type="button"
              className="quiet"
              disabled={busy || blocked}
              onClick={() => setConfirmation(null)}
            >
              Изменить выбор
            </button>
          </section>
        ) : loading ? (
          <p role="status">Загрузка доступных отделений…</p>
        ) : (
          <fieldset disabled={busy || blocked}>
            <label>
              Филиал назначения
              <select
                aria-label="Филиал назначения"
                value={branchId}
                required
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setDepartmentId("");
                }}
              >
                <option value="" disabled>
                  Выберите филиал
                </option>
                {branches
                  .filter((b) => targets.some((t) => t.branchId === b.id))
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Отделение назначения
              <select
                aria-label="Отделение назначения"
                required
                value={departmentId}
                disabled={!branchId}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                <option value="" disabled>
                  Выберите отделение
                </option>
                {branches
                  .find((b) => b.id === branchId)
                  ?.departments.filter((d) =>
                    targets.some(
                      (t) => t.branchId === branchId && t.departmentId === d.id,
                    ),
                  )
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </label>
            {!targets.length && (
              <p className="notice">
                Нет других доступных отделений для перевода.
              </p>
            )}
          </fieldset>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!loading && !branches.length && (
          <button
            type="button"
            className="secondary"
            onClick={() => setRetry((n) => n + 1)}
          >
            Повторить загрузку отделений
          </button>
        )}
        <div className="sheet-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={busy || blocked || loading || !chosen}
          >
            {busy
              ? "Подтверждение…"
              : confirmation
                ? "Подтвердить перевод"
                : "Далее"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
