import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { BELONGING_STATUSES, calendarDate, type Belonging } from "./belongings";
import {
  EntityError,
  entityError,
  type BelongingChange,
  type EntityService,
} from "./entities";
import { newResultId } from "./resultWriter";
import { dayKey } from "./time";
export function BelongingsPanel({
  patientId,
  service,
  enabled,
  zone,
  onExpire,
}: {
  patientId: string;
  service: EntityService;
  enabled: boolean;
  zone: string;
  onExpire: () => void;
}) {
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<Belonging[] | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [blocked, setBlocked] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState<Belonging | null>(null),
    [before, setBefore] = useState<Belonging | undefined>(),
    [action, setAction] = useState<{
      kind: "delete" | "RETURNED" | "CONSUMED" | "receive";
      before: Belonging;
    } | null>(null),
    [date, setDate] = useState(() => dayKey(Date.now(), zone));
  const lifetime = useRef(new AbortController()),
    sending = useRef(false);
  useEffect(() => () => lifetime.current.abort(), []);
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    setLoading(true);
    setError("");
    service
      .list(patientId, c.signal)
      .then((r) => {
        if (!c.signal.aborted) {
          setRows(r);
          setBlocked(false);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          if (e instanceof ApiError && e.kind === "Unauthorized") onExpire();
          else setError(entityError(e));
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [open, patientId, service, refresh]);
  async function save(change: BelongingChange) {
    if (sending.current || blocked || !enabled) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await service.change(
        patientId,
        change,
        lifetime.current.signal,
      );
      if (!lifetime.current.signal.aborted) {
        setRows(r);
        setForm(null);
        setAction(null);
        setNotice("Список вещей обновлён");
      }
    } catch (e) {
      if (lifetime.current.signal.aborted) return;
      if (
        (e instanceof ApiError && e.kind === "Unauthorized") ||
        (e instanceof EntityError && e.apiError?.kind === "Unauthorized")
      )
        onExpire();
      else {
        setError(entityError(e));
        if (
          e instanceof EntityError &&
          ["Unverified", "Conflict"].includes(e.kind)
        )
          setBlocked(true);
      }
    } finally {
      sending.current = false;
      if (!lifetime.current.signal.aborted) setBusy(false);
    }
  }
  return (
    <details
      className="belongings"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Личные вещи{rows ? ` · ${rows.length}` : ""}</summary>
      <div className="belongings-toolbar">
        <button
          className="secondary small"
          disabled={loading || busy}
          onClick={() => {
            setForm(null);
            setAction(null);
            setRefresh((n) => n + 1);
          }}
        >
          Обновить вещи
        </button>
        <button
          className="secondary small"
          disabled={!enabled || loading || busy || blocked || rows === null}
          onClick={() => {
            setBefore(undefined);
            setAction(null);
            setForm({
              id: newResultId(),
              name: "",
              receivingDate: dayKey(Date.now(), zone),
              status: "RECEIVED",
              comment: "",
              creationDate: new Date(Date.now()).toISOString(),
            });
            setNotice("");
          }}
        >
          Добавить вещь
        </button>
      </div>
      {loading && <p role="status">Загрузка вещей…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="micro" role="status">
          {notice}
        </p>
      )}
      {!loading && rows?.length === 0 && (
        <p className="micro">Личных вещей нет</p>
      )}
      {rows?.map((b) => (
        <article className="belonging-row" key={b.id}>
          <strong>{b.name}</strong>
          <p className="micro">
            {b.receivingDate} ·{" "}
            {BELONGING_STATUSES[b.status as keyof typeof BELONGING_STATUSES] ||
              b.status}
            {b.returnDate ? ` · ${b.returnDate}` : ""}
          </p>
          {b.comment && <p className="pre-wrap">{b.comment}</p>}
          <div className="entity-actions">
            <button
              className="secondary small"
              disabled={!enabled || busy || blocked}
              onClick={() => {
                setBefore(b);
                setForm({ ...b });
                setAction(null);
              }}
            >
              Изменить
            </button>
            <button
              className="quiet small danger-text"
              disabled={!enabled || busy || blocked}
              onClick={() => {
                setForm(null);
                setAction({ kind: "delete", before: b });
              }}
            >
              Удалить
            </button>
            {b.status === "RECEIVED"
              ? ["RETURNED", "CONSUMED"].map((status) => (
                  <button
                    key={status}
                    className="quiet small"
                    disabled={!enabled || busy || blocked}
                    onClick={() => {
                      setForm(null);
                      setDate(dayKey(Date.now(), zone));
                      setAction({
                        kind: status as "RETURNED" | "CONSUMED",
                        before: b,
                      });
                    }}
                  >
                    {status === "RETURNED"
                      ? "Вернуть владельцу"
                      : "Израсходовано"}
                  </button>
                ))
              : ["RETURNED", "CONSUMED"].includes(b.status) && (
                  <button
                    className="quiet small"
                    disabled={!enabled || busy || blocked}
                    onClick={() => {
                      setForm(null);
                      setAction({ kind: "receive", before: b });
                    }}
                  >
                    Снова принято
                  </button>
                )}
          </div>
        </article>
      ))}
      {form && (
        <form
          className="belonging-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.name.trim() && calendarDate(form.receivingDate))
              void save(
                before
                  ? {
                      kind: "edit",
                      value: { ...form, name: form.name.trim() },
                      before,
                    }
                  : { kind: "add", value: { ...form, name: form.name.trim() } },
              );
          }}
        >
          <fieldset disabled={busy || blocked || !enabled}>
            <legend>{before ? "Изменить вещь" : "Новая вещь"}</legend>
            <label>
              Название вещи
              <input
                required
                aria-label="Название вещи"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Дата приёма
              <input
                required
                type="date"
                aria-label="Дата приёма вещи"
                value={form.receivingDate}
                onChange={(e) =>
                  setForm({ ...form, receivingDate: e.target.value })
                }
              />
            </label>
            <p className="micro">
              Статус:{" "}
              {BELONGING_STATUSES[
                form.status as keyof typeof BELONGING_STATUSES
              ] || form.status}
            </p>
            <label>
              Комментарий
              <textarea
                aria-label="Комментарий вещи"
                value={form.comment}
                onChange={(e) => setForm({ ...form, comment: e.target.value })}
              />
            </label>
            <div className="entity-actions">
              <button
                type="submit"
                disabled={
                  !form.name.trim() || !calendarDate(form.receivingDate)
                }
              >
                Сохранить вещь
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setForm(null)}
              >
                Отмена
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {action && (
        <section
          className="operation-confirmation"
          role="group"
          aria-label="Подтверждение действия с вещью"
        >
          <p>
            {action.kind === "delete"
              ? `Удалить вещь „${action.before.name}“?`
              : action.kind === "receive"
                ? `Снова принять вещь „${action.before.name}“?`
                : `${action.kind === "RETURNED" ? "Вернуть владельцу" : "Отметить израсходованной"} вещь „${action.before.name}“?`}
          </p>
          {["RETURNED", "CONSUMED"].includes(action.kind) && (
            <label>
              Дата
              <input
                type="date"
                aria-label="Дата завершения вещи"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          )}
          <div className="entity-actions">
            <button
              disabled={
                busy ||
                blocked ||
                !enabled ||
                (["RETURNED", "CONSUMED"].includes(action.kind) &&
                  (!calendarDate(date) || date < action.before.receivingDate))
              }
              onClick={() =>
                void save(
                  action.kind === "delete"
                    ? { kind: "delete", before: action.before }
                    : action.kind === "receive"
                      ? { kind: "receive", before: action.before }
                      : {
                          kind: "finish",
                          status: action.kind,
                          before: action.before,
                          date,
                        },
                )
              }
            >
              Подтвердить действие с вещью
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setAction(null)}
            >
              Отмена
            </button>
          </div>
        </section>
      )}
    </details>
  );
}
