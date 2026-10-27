import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { clinicalFields, workClinicalFields, clinicalTitle } from "./clinical";
import { classifySchedule, hasScheduledTaskOn } from "./hourlySummary";
import { STATUS, safeColor, type Chain } from "./model";
import { dayKey, formatStamp, formatTime, zonedStart } from "./time";
import {
  cellWriteProblem,
  RESULT_REASONS,
  ResultWriteError,
  writeError,
  type ResultTarget,
  type ResultWriter,
  type WriteReceipt,
} from "./resultWriter";
import {
  RESULT_COLORS,
  isResultColor,
  type ResultColorChange,
} from "./resultColors";
export function ResultEditor({
  initial,
  chain,
  writer,
  onClose,
  onSaved,
  onRefresh,
  onExpire,
}: {
  initial: ResultTarget;
  chain: Chain;
  writer: ResultWriter;
  onClose: () => void;
  onSaved: (receipt: WriteReceipt, deleted: boolean) => void;
  onRefresh: () => Promise<void>;
  onExpire: (message?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    sending = useRef(false),
    live = useRef(true);
  const [status, setStatus] = useState<
    "unmarked" | "EXECUTED" | "NOT_EXECUTED" | null
  >(
    !initial.existing
      ? "unmarked"
      : initial.existing.status === "EXECUTED" ||
          initial.existing.status === "NOT_EXECUTED"
        ? initial.existing.status
        : null,
  );
  const [comment, setComment] = useState(initial.existing?.comment ?? "");
  const [reason, setReason] = useState(
    initial.existing?.status === "NOT_EXECUTED" ? initial.existing.reason : "",
  );
  const [paint, setPaint] = useState(!!initial.existing?.color);
  const [pickedColor, setPickedColor] = useState<string | null>(
    initial.existing?.color || null,
  );
  const [colorTouched, setColorTouched] = useState(false);
  const colorMissing =
    paint &&
    !isResultColor(pickedColor) &&
    !(pickedColor && pickedColor === initial.existing?.color);
  let colorChange: ResultColorChange | undefined;
  if (colorTouched) {
    if (!paint) colorChange = { kind: "clear" };
    else if (
      pickedColor !== initial.existing?.color &&
      isResultColor(pickedColor)
    )
      colorChange = { kind: "set", value: pickedColor };
  }
  const [date, setDate] = useState(dayKey(initial.at, initial.zone));
  const [clock, setClock] = useState(formatTime(initial.at, initial.zone));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [blocked, setBlocked] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const manualSchedule =
    classifySchedule(initial.revision) === "MANUAL_AS_NEEDED";
  const asNeeded =
    manualSchedule ||
    !hasScheduledTaskOn(initial.revision, initial.at, initial.zone);
  const manual = manualSchedule && !initial.existing;
  const chosen = manual ? zonedStart(date, clock, initial.zone) : initial.at;
  const target = { ...initial, at: chosen ?? NaN };
  const clinical = workClinicalFields(chain, initial.revision);
  const problem =
    chosen === null
      ? "Время не существует или неоднозначно в выбранном часовом поясе."
      : cellWriteProblem(target);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      live.current = false;
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  async function submit(deleting = false) {
    if (sending.current || blocked) return;
    const resetting = deleting || status === "unmarked";
    if ((resetting && !initial.existing) || (!resetting && status === null))
      return;
    if (problem) {
      setError(problem);
      return;
    }
    if (
      !resetting &&
      status === "NOT_EXECUTED" &&
      !Object.hasOwn(RESULT_REASONS, reason)
    ) {
      setError("Выберите причину невыполнения.");
      return;
    }
    if (!resetting && colorMissing) {
      setError(
        "Выберите цвет из палитры CleverVet или отключите подкрашивание.",
      );
      return;
    }
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = resetting
        ? await writer.remove(target)
        : await writer.save(target, {
            status: status as "EXECUTED" | "NOT_EXECUTED",
            reason: status === "NOT_EXECUTED" ? reason : undefined,
            comment: status === "EXECUTED" ? comment : "",
            ...(colorChange ? { colorChange } : {}),
          });
      if (live.current) onSaved(receipt, resetting);
    } catch (e) {
      if (!live.current) return;
      if (e instanceof ApiError && e.kind === "Unauthorized") {
        onExpire();
        return;
      }
      if (
        e instanceof ResultWriteError &&
        e.apiError?.kind === "Unauthorized"
      ) {
        onExpire(
          "Сеанс истёк. Результат записи не подтверждён; после входа обновите данные и проверьте отметку перед повтором.",
        );
        return;
      }
      setError(writeError(e));
      if (
        e instanceof ResultWriteError &&
        ["Unverified", "Conflict"].includes(e.kind)
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
      className="bottom-sheet result-editor"
      aria-labelledby="result-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!sending.current) onClose();
      }}
    >
      <div className="sheet-handle" />
      <header className="sheet-header">
        <div>
          <p className="eyebrow">
            {initial.patient.name} ·{" "}
            {initial.existing ? "Изменение отметки" : "Новая отметка"}
          </p>
          <h2 id="result-title">{clinicalTitle(chain, initial.revision)}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть отметку"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <p className="result-time">
        {formatStamp(chosen, initial.zone)} · {initial.zone}
      </p>
      <p className="micro">
        Сейчас:{" "}
        {initial.existing
          ? STATUS[initial.existing.status] ||
            initial.existing.status ||
            "Статус не определён"
          : asNeeded
            ? "Без отметки"
            : "Запланировано"}
      </p>
      <dl className="result-clinical">
        {clinical.fields
          .filter(
            (f) =>
              !["Доза из API", "Путь введения", "Скорость инфузии"].includes(
                f.label,
              ),
          )
          .map((f) => (
            <div key={f.path}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
      </dl>
      {clinical.warnings.length > 0 && (
        <p className="micro warning">{clinical.warnings.join(" · ")}</p>
      )}
      {chain.type === "MEDICATION" && (
        <details className="result-source">
          <summary>Исходные параметры</summary>
          <dl>
            {clinicalFields(chain, initial.revision).map((f) => (
              <div key={f.path}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {initial.revision.instruction && (
        <p className="micro pre-wrap">{initial.revision.instruction}</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy || blocked}>
          {manual && (
            <>
              <p className="micro">По необходимости · время события</p>
              <div className="inline">
                <label>
                  Дата
                  <input
                    aria-label="Дата события"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label>
                  Время
                  <input
                    aria-label="Время события"
                    type="time"
                    value={clock}
                    onChange={(e) => setClock(e.target.value)}
                  />
                </label>
              </div>
            </>
          )}
          <div
            className="result-status-options"
            role="group"
            aria-label="Статус отметки"
          >
            <button
              type="button"
              aria-pressed={status === "unmarked"}
              className={status === "unmarked" ? "active" : ""}
              onClick={() => {
                setStatus("unmarked");
                setConfirmDelete(false);
              }}
            >
              {asNeeded ? "Без отметки" : "Запланировано"}
            </button>
            <button
              type="button"
              aria-pressed={status === "EXECUTED"}
              className={status === "EXECUTED" ? "active" : ""}
              onClick={() => {
                setStatus("EXECUTED");
                setConfirmDelete(false);
              }}
            >
              ✓ Выполнено
            </button>
            <button
              type="button"
              aria-pressed={status === "NOT_EXECUTED"}
              className={status === "NOT_EXECUTED" ? "active" : ""}
              onClick={() => {
                setStatus("NOT_EXECUTED");
                setConfirmDelete(false);
              }}
            >
              × Не выполнено
            </button>
          </div>
          {status === "EXECUTED" ? (
            <label>
              Значение / комментарий
              <textarea
                aria-label="Значение / комментарий"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Необязательно · число или свободный текст"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          ) : status === "NOT_EXECUTED" ? (
            <label>
              Причина невыполнения
              <select
                aria-label="Причина невыполнения"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
              >
                <option value="" disabled>
                  Выберите причину
                </option>
                {Object.entries(RESULT_REASONS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {status === "unmarked" && (
            <p className="micro" role="status">
              {initial.existing
                ? asNeeded
                  ? "Будет удалена только эта отметка события. Автоматическое задание не создаётся."
                  : "Будет удалена отметка только этого часа. Если час прошёл, назначение снова станет просроченным."
                : asNeeded
                  ? "Событие ещё не зарегистрировано. Автоматического задания нет."
                  : "Результат ещё не зарегистрирован."}
            </p>
          )}
          {status !== "unmarked" && status !== null && (
            <div className="result-paint">
              <label className="checkbox">
                <input
                  type="checkbox"
                  aria-label="Подкрашивать"
                  checked={paint}
                  onChange={(e) => {
                    setPaint(e.target.checked);
                    setColorTouched(true);
                  }}
                />
                Подкрашивать
              </label>
              {paint && (
                <>
                  <div
                    className="result-palette"
                    role="group"
                    aria-label="Цвет отметки"
                  >
                    {RESULT_COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        className="palette-swatch"
                        style={{ background: c.value }}
                        aria-label={c.label}
                        title={c.label}
                        aria-pressed={pickedColor === c.value}
                        onClick={() => {
                          setPickedColor(c.value);
                          setColorTouched(true);
                        }}
                      >
                        <span aria-hidden="true">
                          {pickedColor === c.value ? "✓" : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                  {pickedColor && !isResultColor(pickedColor) && (
                    <p className="micro">
                      <i
                        className="swatch"
                        style={{ background: safeColor(pickedColor) }}
                      />
                      Сохранённый цвет из API останется прежним, пока вы не
                      выберете другой.
                    </p>
                  )}
                  {colorMissing && <p className="micro">Выберите цвет.</p>}
                </>
              )}
              <p className="micro">
                Подкраска только этой отметки. Цвет назначения не меняется.
              </p>
            </div>
          )}
        </fieldset>
        {problem && (
          <p className="notice" role="status">
            {problem}
          </p>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        {blocked ? (
          <button
            type="button"
            className="secondary full"
            disabled={busy}
            onClick={async () => {
              if (sending.current) return;
              sending.current = true;
              setBusy(true);
              await onRefresh();
              if (live.current) onClose();
            }}
          >
            Обновить и закрыть
          </button>
        ) : (
          <div className="result-actions">
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
              className="primary"
              disabled={
                busy ||
                !!problem ||
                status === null ||
                (status === "unmarked" ? !initial.existing : colorMissing) ||
                (status === "NOT_EXECUTED" &&
                  !Object.hasOwn(RESULT_REASONS, reason))
              }
            >
              {busy ? "Проверка и сохранение…" : "Сохранить"}
            </button>
          </div>
        )}
      </form>
      {initial.existing && !blocked && (
        <div className="result-delete">
          {confirmDelete ? (
            <>
              <p>Удалить эту отметку? Назначение останется без изменения.</p>
              <div className="result-actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  Оставить
                </button>
                <button
                  className="danger"
                  disabled={busy || !!problem}
                  onClick={() => void submit(true)}
                >
                  Подтвердить удаление
                </button>
              </div>
            </>
          ) : (
            <button
              className="quiet danger-text"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              Удалить ошибочную отметку…
            </button>
          )}
        </div>
      )}
    </dialog>
  );
}
