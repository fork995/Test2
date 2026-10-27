import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { EntityError, entityError, type EntityService } from "./entities";
import type { Patient, Branch } from "./model";
import {
  emptyPatientDraft,
  buildPatient,
  GENDERS,
  HOSPITALS,
  type PatientDraft,
} from "./patientCreation";
import { SEVERITIES } from "./patientPresentation";
import type { Location } from "./transferApi";
export function PatientEntityDialog({
  service,
  patient,
  branch,
  location,
  zone,
  onClose,
  onCreated,
  onRemoved,
  onExpire,
}: {
  service: EntityService;
  patient?: Patient;
  branch: Branch;
  location: Location;
  zone: string;
  onClose: () => void;
  onCreated: (r: { patients: Patient[]; patient: Patient }) => void;
  onRemoved: (patients: Patient[]) => void;
  onExpire: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    live = useRef(true),
    sending = useRef(false);
  const [draft, setDraft] = useState(() => emptyPatientDraft(Date.now(), zone)),
    [phase, setPhase] = useState(false),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      live.current = false;
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  const set = (k: keyof PatientDraft, v: string) =>
    setDraft((d) => ({ ...d, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current || blocked) return;
    if (patient && !phase) {
      setPhase(true);
      return;
    }
    if (patient && confirmation !== patient.name) return;
    if (!patient) {
      try {
        buildPatient(draft, branch, zone);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Проверьте поля формы.");
        return;
      }
    }
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      if (patient) {
        const r = await service.remove(patient, confirmation);
        if (live.current) onRemoved(r);
      } else {
        const r = await service.create(location, draft, zone);
        if (live.current) onCreated(r);
      }
    } catch (e) {
      if (!live.current) return;
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
      if (live.current) setBusy(false);
    }
  }
  const input = (
    key: keyof PatientDraft,
    label: string,
    required = false,
    type = "text",
    wide = false,
  ) => (
    <label className={wide ? "wide" : ""} key={key}>
      {label}
      <input
        aria-label={label}
        type={type}
        required={required}
        value={draft[key]}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );
  const choice = (
    key: keyof PatientDraft,
    label: string,
    values: Record<string, string>,
  ) => (
    <label key={key}>
      {label}
      <select
        aria-label={label}
        required
        value={draft[key]}
        onChange={(e) => set(key, e.target.value)}
      >
        <option value="" disabled>
          Выберите
        </option>
        {Object.entries(values).map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <dialog
      ref={dialog}
      className="bottom-sheet patient-ops-dialog"
      aria-labelledby="patient-entity-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!sending.current) onClose();
      }}
    >
      <div className="sheet-handle" />
      <div className="sheet-header">
        <h2 id="patient-entity-title">
          {patient ? "Удалить пациента?" : "Новый пациент"}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть форму пациента"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="micro">
        {branch.name} ·{" "}
        {branch.departments.find((d) => d.id === location.departmentId)?.name}
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy || blocked}>
          {patient ? (
            <>
              <p>
                <strong>{patient.name}</strong>
              </p>
              <p className="error">
                Удаление может быть необратимым. Будут удалены сведения о
                пациенте и лечении.
              </p>
              {phase && (
                <label>
                  Введите кличку для подтверждения
                  <input
                    required
                    autoComplete="off"
                    aria-label="Кличка для удаления"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
              )}
            </>
          ) : (
            <>
              <p className="micro">Начало лечения: {zone}.</p>
              <div className="patient-create-grid">
                {input("name", "Кличка", true)}
                {input("species", "Вид животного", true)}
                {input("breed", "Порода", true)}
                {choice("gender", "Пол", GENDERS)}
                {choice("castrated", "Кастрация / стерилизация", {
                  yes: "Да",
                  no: "Нет",
                })}
                {input("weight", "Масса, кг", true)}
                {input("years", "Возраст: годы", true, "number")}
                {input("months", "Возраст: месяцы", true, "number")}
                {input("days", "Возраст: дни", true, "number")}
                {choice(
                  "severity",
                  "Тяжесть состояния",
                  Object.fromEntries(
                    Object.entries(SEVERITIES).map(([v, t]) => [v, t.label]),
                  ),
                )}
                {input("cage", "Номер клетки")}
                {choice("hospital", "Тип стационара", HOSPITALS)}
                {input("surname", "Фамилия владельца", true)}
                {input("firstName", "Имя владельца", true)}
                {input("patronymic", "Отчество владельца")}
                {input("email", "Email владельца", false, "email")}
                <label className="wide">
                  Диагнозы · по одному в строке
                  <textarea
                    required
                    aria-label="Диагнозы"
                    value={draft.diagnoses}
                    onChange={(e) => set("diagnoses", e.target.value)}
                  />
                </label>
                {input("allergies", "Аллергии", false, "text", true)}
                {input("date", "Дата начала лечения", true, "date")}
                {input("clock", "Время начала лечения", true, "time")}
              </div>
            </>
          )}
        </fieldset>
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
            className={patient ? "danger-text" : ""}
            disabled={
              busy ||
              blocked ||
              (!!patient && phase && confirmation !== patient.name)
            }
          >
            {busy
              ? "Подтверждение…"
              : patient
                ? phase
                  ? "Удалить пациента навсегда"
                  : "Продолжить удаление"
                : "Создать пациента"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
