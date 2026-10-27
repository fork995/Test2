import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import {
  DISCHARGE_ZONE,
  DischargeError,
  dischargeError,
  dischargeTime,
  type Discharger,
  type DischargeReceipt,
} from "./discharge";
import type { Patient } from "./model";
import { dayKey, formatTime, formatStamp } from "./time";
import {
  FINISH_LABELS,
  availableFinishResults,
  isFinishResult,
  type FinishResult,
} from "./finishResults";
import { PatientPhoto } from "./PatientPhoto";
export function DischargeDialog({
  patient,
  department,
  discharger,
  demo,
  onClose,
  onSaved,
  onExpire,
}: {
  patient: Patient;
  department: string;
  discharger: Discharger;
  demo: boolean;
  onClose: () => void;
  onSaved: (receipt: DischargeReceipt) => void;
  onExpire: (message?: string) => void;
}) {
  const [initial] = useState(Date.now),
    [date, setDate] = useState(() => dayKey(initial, DISCHARGE_ZONE)),
    [clock, setClock] = useState(() => formatTime(initial, DISCHARGE_ZONE));
  const [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [confirmation, setConfirmation] = useState<{
    end: number;
    result: FinishResult;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    sending = useRef(false),
    live = useRef(true);
  const at = dischargeTime(date, clock);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      live.current = false;
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      sending.current ||
      blocked ||
      at === null ||
      !isFinishResult(result) ||
      !availableFinishResults(patient.hospital).includes(result)
    )
      return;
    if (!confirmation) {
      setConfirmation({ end: at, result });
      return;
    }
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = await discharger.finish(
        patient,
        confirmation.end,
        confirmation.result,
      );
      if (live.current) onSaved(receipt);
    } catch (error) {
      if (!live.current) return;
      if (error instanceof ApiError && error.kind === "Unauthorized") {
        onExpire();
        return;
      }
      if (
        error instanceof DischargeError &&
        error.apiError?.kind === "Unauthorized"
      ) {
        onExpire(
          "Сеанс истёк. Завершение не подтверждено; после входа проверьте карту перед повтором.",
        );
        return;
      }
      setError(dischargeError(error));
      if (
        error instanceof DischargeError &&
        ["Unverified", "Conflict"].includes(error.kind)
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
      className="bottom-sheet discharge-dialog"
      aria-labelledby="discharge-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!sending.current) onClose();
      }}
    >
      <div className="sheet-handle" />
      <div className="sheet-header">
        <h2 id="discharge-title">
          {confirmation ? "Подтвердить завершение?" : "Завершение лечения"}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть завершение лечения"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="discharge-patient">
        <PatientPhoto patient={patient} demo={demo} large />
        <div>
          <strong>{patient.name}</strong>
          <p>{department}</p>
        </div>
      </div>
      <p>
        Лечение будет завершено, карта перейдёт в архив. Отменить завершение в
        этом приложении нельзя.
      </p>
      {demo && (
        <p className="micro">
          Демо · изменятся только вымышленные данные в памяти.
        </p>
      )}
      <form onSubmit={submit}>
        {confirmation ? (
          <section
            className="operation-confirmation"
            aria-label="Подтверждение завершения"
          >
            <p>
              <strong>{FINISH_LABELS[confirmation.result]}</strong>
            </p>
            <p>{formatStamp(confirmation.end, DISCHARGE_ZONE)} · Москва</p>
            <button
              type="button"
              className="quiet"
              disabled={busy || blocked}
              onClick={() => setConfirmation(null)}
            >
              Изменить выбор
            </button>
          </section>
        ) : (
          <fieldset disabled={busy || blocked}>
            <legend>Время завершения · Москва</legend>
            <div className="inline">
              <label>
                Дата
                <input
                  type="date"
                  required
                  aria-label="Дата завершения"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                Время
                <input
                  type="time"
                  required
                  aria-label="Время завершения"
                  value={clock}
                  onChange={(e) => setClock(e.target.value)}
                />
              </label>
            </div>
            <label className="finish-result">
              Результат
              <select
                required
                aria-label="Результат завершения"
                value={result}
                onChange={(e) => setResult(e.target.value)}
              >
                <option value="" disabled>
                  Выберите результат
                </option>
                {availableFinishResults(patient.hospital).map((r) => (
                  <option key={r} value={r}>
                    {FINISH_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        )}
        {at === null && (
          <p className="error" role="alert">
            Укажите корректную дату и время.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
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
            className="danger"
            disabled={busy || blocked || at === null || !isFinishResult(result)}
          >
            {busy
              ? "Подтверждение…"
              : confirmation
                ? "Подтвердить завершение"
                : "Далее"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
