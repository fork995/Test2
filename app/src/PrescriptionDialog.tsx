import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { obj, type Patient, type Chain } from "./model";
import { dayKey, formatTime, formatStamp, zonedStart, HOUR } from "./time";
import { hourStart } from "./hourlySummary";
import {
  clinicalNumeric,
  medicationCalculation,
  calculatedText,
} from "./medication";
import { RESULT_COLORS } from "./resultColors";
import {
  CONCENTRATION_SUBSTANCES,
  CONCENTRATION_VOLUMES,
  DOSAGE_SUBSTANCES,
  DOSAGE_VOLUMES,
  PRESCRIPTION_TIMES,
  PRESCRIPTION_ROUTES,
} from "./prescriptionCatalog";
import {
  PrescriptionError,
  prescriptionError,
  draftProblem,
  deletionProblem,
  earliestRevisionEnd,
  type PrescriptionAction,
  type PrescriptionDraft,
  type PrescriptionService,
  type PrescriptionReceipt,
  type PrescriptionType,
} from "./prescriptions";
export function PrescriptionDialog({
  patient,
  chain,
  action = "create",
  zone,
  service,
  onClose,
  onSaved,
  onSnapshot,
  onExpire,
}: {
  patient: Patient;
  chain?: Chain;
  action?: "create" | PrescriptionAction;
  zone: string;
  service: PrescriptionService;
  onClose: () => void;
  onSaved: (r: PrescriptionReceipt) => void;
  onSnapshot: (chains: Chain[]) => void;
  onExpire: () => void;
}) {
  const last = chain?.elements.at(-1),
    s = obj(last?.specifics),
    dose = obj(s.dosage),
    du = obj(dose.units),
    con = obj(s.concentration),
    cu = obj(con.units);
  const [type, setType] = useState<PrescriptionType>(
    chain?.type === "NURSING" ? "NURSING" : "MEDICATION",
  );
  const [name, setName] = useState(chain?.name ?? ""),
    [instruction, setInstruction] = useState(last?.instruction ?? ""),
    [color, setColor] = useState(last ? last.color : "yellow");
  const [periodKind, setPeriodKind] = useState(
      last
        ? last.periodicity == null
          ? "manual"
          : last.periodicity === 0
            ? "once"
            : "periodic"
        : "",
    ),
    [period, setPeriod] = useState(String(last?.periodicity ?? ""));
  const [time, setTime] = useState(() => {
    const n =
      action === "create"
        ? hourStart(Date.now(), zone)
        : Math.max(
            hourStart(Date.now(), zone) + HOUR,
            last ? (earliestRevisionEnd(last, zone) ?? 0) : 0,
          );
    return `${dayKey(n, zone)}T${formatTime(n, zone)}`;
  });
  const [dv, setDv] = useState(String(dose.value ?? "")),
    [ds, setDs] = useState(String(du.substance ?? "")),
    [dd, setDd] = useState(String(du.volume ?? "")),
    [dt, setDt] = useState(String(du.time ?? ""));
  const [cv, setCv] = useState(String(con.value ?? "")),
    [cs, setCs] = useState(String(cu.substance ?? "")),
    [cd, setCd] = useState(String(cu.volume ?? "")),
    [route, setRoute] = useState(String(s.route ?? "")),
    [weight, setWeight] = useState(
      String(s.weightKg ?? (action === "create" ? patient.weight : "")),
    );
  const [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    sending = useRef(false),
    live = useRef(true);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      live.current = false;
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  const editing = action === "create" || action === "revise",
    deleting = action === "deleteChain" || action === "deleteRevision";
  const at = zonedStart(time.slice(0, 10), time.slice(11, 16), zone);
  const { weightKg: _oldWeight, ...unchangedSpecifics } = s;
  const specifics = {
    ...unchangedSpecifics,
    concentration: {
      value: clinicalNumeric(cv),
      units: { substance: cs, volume: cd },
    },
    dosage: {
      value: clinicalNumeric(dv),
      units: { substance: ds, volume: dd, ...(dt ? { time: dt } : {}) },
    },
    route,
    ...(weight.trim() ? { weightKg: clinicalNumeric(weight) } : {}),
    viewMode: s.viewMode ?? "DOSAGE",
  };
  const draft: PrescriptionDraft = {
    name,
    type,
    start: at === null ? "" : new Date(at).toISOString(),
    periodicity:
      periodKind === "manual"
        ? null
        : periodKind === "once"
          ? 0
          : (clinicalNumeric(period) ?? NaN),
    color,
    instruction,
    ...(type === "MEDICATION" ? { specifics } : {}),
    zone,
  };
  const minimum = last ? earliestRevisionEnd(last, zone) : null;
  const boundaryProblem =
    chain &&
    !deleting &&
    (at === null ||
      minimum === null ||
      at < minimum ||
      at !== hourStart(at, zone))
      ? "Выберите начало часа не ранее границы, указанной ниже."
      : null;
  const problem =
    deleting && chain
      ? deletionProblem(chain, action === "deleteRevision")
      : at === null
        ? "Проверьте дату и время в выбранном часовом поясе."
        : boundaryProblem
          ? boundaryProblem
          : editing
            ? periodKind === ""
              ? "Выберите режим расписания."
              : periodKind === "periodic" &&
                  !(
                    Number.isFinite(draft.periodicity) && draft.periodicity! > 0
                  )
                ? "Интервал должен быть больше нуля."
                : draftProblem(draft, last?.color)
            : null;
  const calc =
    type === "MEDICATION" && editing ? medicationCalculation(specifics) : null;
  const title =
    action === "create"
      ? "Новое назначение"
      : action === "revise"
        ? "Изменить параметры"
        : action === "finish"
          ? "Завершить действие"
          : action === "deleteRevision"
            ? "Удалить последнюю редакцию"
            : "Удалить назначение";
  function select(
    label: string,
    value: string,
    set: (v: string) => void,
    options: Readonly<Record<string, string>>,
    optional = false,
  ) {
    return (
      <label>
        {label}
        <select
          aria-label={label}
          value={value}
          onChange={(e) => set(e.target.value)}
          required={!optional}
        >
          <option value="">
            {optional ? "Без единиц времени" : "Выберите"}
          </option>
          {value && !Object.hasOwn(options, value) && (
            <option value={value} disabled>
              Неизвестное значение: {value}
            </option>
          )}
          {Object.entries(options).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
    );
  }
  function number(
    label: string,
    value: string,
    set: (v: string) => void,
    required = true,
  ) {
    return (
      <label>
        {label}
        <input
          aria-label={label}
          inputMode="decimal"
          value={value}
          onChange={(e) => set(e.target.value)}
          required={required}
          autoComplete="off"
        />
      </label>
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current || blocked || problem) return;
    if (action !== "create" && !confirmed) {
      setConfirmed(true);
      return;
    }
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt =
        action === "create"
          ? await service.create(patient, draft)
          : action === "revise"
            ? await service.revise(patient, chain!, draft)
            : action === "finish"
              ? await service.finish(
                  patient,
                  chain!,
                  new Date(at!).toISOString(),
                  zone,
                )
              : action === "deleteRevision"
                ? await service.deleteRevision(patient, chain!)
                : await service.deleteChain(patient, chain!);
      if (live.current) onSaved(receipt);
    } catch (e) {
      if (!live.current) return;
      const cause = e instanceof PrescriptionError ? e.causeError : e;
      if (cause instanceof ApiError && cause.kind === "Unauthorized") {
        onExpire();
        return;
      }
      if (e instanceof PrescriptionError && e.snapshot) onSnapshot(e.snapshot);
      setError(prescriptionError(e));
      if (
        e instanceof PrescriptionError &&
        ["Partial", "Unverified", "Conflict"].includes(e.kind)
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
      className="bottom-sheet prescription-dialog"
      aria-labelledby="prescription-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="sheet-handle" />
      <header className="sheet-header">
        <div>
          <p className="eyebrow">{patient.name}</p>
          <h2 id="prescription-title">{title}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть назначение"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <form onSubmit={submit}>
        <fieldset disabled={busy || blocked}>
          {confirmed ? (
            <section className="prescription-confirm">
              <h3>{chain?.name}</h3>
              <p>{patient.name}</p>
              {deleting ? (
                <p>
                  {action === "deleteRevision"
                    ? "Будет удалена только последняя редакция без отметок. Предыдущие редакции сохранятся."
                    : "Будет удалена вся цепочка назначения. Это действие не удаляет пациента."}
                </p>
              ) : (
                <>
                  <p>
                    {formatStamp(at, zone)} · {zone}
                  </p>
                  <p>
                    {blocked
                      ? "Проверьте фактическое состояние назначения. Повторная отправка из этого окна заблокирована."
                      : action === "revise"
                        ? "Текущая редакция завершится, затем будет создана новая. История отметок сохранится."
                        : "Назначение перестанет действовать с выбранного времени. История отметок сохранится."}
                  </p>
                </>
              )}
              <button
                type="button"
                className="secondary small"
                onClick={() => setConfirmed(false)}
              >
                Назад
              </button>
            </section>
          ) : (
            <>
              {editing && (
                <>
                  {!chain && (
                    <label>
                      Тип назначения
                      <select
                        aria-label="Тип назначения"
                        value={type}
                        onChange={(e) =>
                          setType(e.target.value as PrescriptionType)
                        }
                      >
                        <option value="MEDICATION">Препарат</option>
                        <option value="NURSING">Процедура</option>
                      </select>
                    </label>
                  )}
                  <label>
                    Название
                    <input
                      aria-label="Название назначения"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      disabled={!!chain}
                    />
                  </label>
                  {type === "MEDICATION" && (
                    <>
                      {number("Концентрация", cv, setCv)}
                      <div className="prescription-pair">
                        {select(
                          "Единицы концентрации",
                          cs,
                          setCs,
                          CONCENTRATION_SUBSTANCES,
                        )}
                        {select(
                          "На единицу препарата",
                          cd,
                          setCd,
                          CONCENTRATION_VOLUMES,
                        )}
                      </div>
                      {number("Дозировка", dv, setDv)}
                      <div className="prescription-pair">
                        {select(
                          "Единицы дозировки",
                          ds,
                          setDs,
                          DOSAGE_SUBSTANCES,
                        )}
                        {select(
                          "На единицу массы / животное",
                          dd,
                          setDd,
                          DOSAGE_VOLUMES,
                        )}
                      </div>
                      {select(
                        "Единицы времени",
                        dt,
                        setDt,
                        PRESCRIPTION_TIMES,
                        true,
                      )}
                      {select(
                        "Путь введения",
                        route,
                        setRoute,
                        PRESCRIPTION_ROUTES,
                      )}
                      {number(
                        "Масса для расчёта, кг",
                        weight,
                        setWeight,
                        dd === "KILOGRAM",
                      )}
                      {(s.solvent || s.supplementarySolvent) && (
                        <p className="micro">
                          Параметры разведения сохранены из исходного
                          назначения; здесь они не меняются.
                        </p>
                      )}
                      {calc && (calc.total || calc.amount) && (
                        <p className="prescription-calculation">
                          {calc.total && (
                            <>
                              Полная доза: {calculatedText(calc.total)}
                              <br />
                            </>
                          )}
                          {calc.amount && (
                            <>Набрать: {calculatedText(calc.amount)}</>
                          )}
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
              {!deleting ? (
                <label>
                  {action === "finish" ? "Завершить с" : "Начало действия"}
                  <input
                    aria-label={
                      action === "finish" ? "Завершить с" : "Начало действия"
                    }
                    type="datetime-local"
                    step="60"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    required
                  />
                  <span className="micro">
                    {zone}
                    {chain && (
                      <>
                        {" "}
                        · не ранее{" "}
                        {formatStamp(earliestRevisionEnd(last!, zone), zone)}
                      </>
                    )}
                  </span>
                </label>
              ) : (
                <p>{chain?.name}</p>
              )}
              {editing && (
                <>
                  <label>
                    Расписание
                    <select
                      aria-label="Расписание"
                      value={periodKind}
                      onChange={(e) => setPeriodKind(e.target.value)}
                      required
                    >
                      <option value="">Выберите</option>
                      <option value="manual">По необходимости</option>
                      <option value="once">Однократно</option>
                      <option value="periodic">Каждые N часов</option>
                    </select>
                  </label>
                  {periodKind === "periodic" &&
                    number("Интервал, часов", period, setPeriod)}
                  {select(
                    "Цвет назначения",
                    color,
                    setColor,
                    Object.fromEntries([
                      ...RESULT_COLORS.map((c) => [c.value, c.label]),
                      ...(last?.color
                        ? [
                            [
                              last.color,
                              RESULT_COLORS.find((c) => c.value === last.color)
                                ?.label ?? "Исходный цвет (сохранить)",
                            ],
                          ]
                        : []),
                    ]),
                  )}
                  <label>
                    Комментарий / инструкция
                    <textarea
                      aria-label="Комментарий / инструкция"
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      rows={2}
                    />
                  </label>
                </>
              )}
            </>
          )}
        </fieldset>
        {problem && !confirmed && <p className="micro warning">{problem}</p>}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <footer className="sheet-actions">
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
            className={deleting ? "danger" : "primary"}
            disabled={busy || blocked || !!problem}
          >
            {busy
              ? "Проверка…"
              : confirmed
                ? "Подтвердить"
                : action === "create"
                  ? "Создать назначение"
                  : "Продолжить"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
