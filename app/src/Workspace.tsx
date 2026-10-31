import { PrescriptionDialog } from "./PrescriptionDialog";
import type { PrescriptionAction } from "./prescriptions";
import { HourlyOverview } from "./HourlyOverview";
import { Archive } from "./Archive";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ApiError, safeError } from "./api";
import { cardState, LABELS, type Branch, type Patient } from "./model";
import { type Source, receivedAt } from "./source";
import { PrescriptionStore, type CardData } from "./store";
import { WorkBoard } from "./WorkBoard";
import { ScheduleDiagnostics } from "./ScheduleDiagnostics";
import { useOptionalRefresh } from "./useRefresh";
import { Grid, type Selection } from "./Grid";
import { Details } from "./Details";
import { ResultEditor } from "./ResultEditor";
import { DischargeDialog } from "./DischargeDialog";
import { TransferDialog } from "./TransferDialog";
import { BelongingsPanel } from "./BelongingsPanel";
import { PatientEntityDialog } from "./PatientEntityDialog";
import { SeverityBadge } from "./patientPresentation";
import { PatientPhoto } from "./PatientPhoto";
import { PatientPhotoDialog } from "./PatientPhotoDialog";
import { SaveNotice } from "./SaveNotice";
import { type ResultTarget } from "./resultWriter";
import { ErrorBox, Loader } from "./ui";
import {
  readPreferences,
  saveEditingPreference,
  saveDepartmentPreference,
} from "./preferences";
import { initialDepartment } from "./departmentSelection";
import {
  deviceZone,
  validZone,
  shiftClock,
  formatTime,
  formatDate,
  formatStamp,
  addDay,
  HOUR,
} from "./time";
import {
  initialDay,
  sheetPeriods,
  resolvePeriod,
  adjacentPeriod,
  patientPeriodWarnings,
} from "./period";
import { revisionDiagnostics } from "./feed";
import {
  buildPatientSchedule,
  API_SCHEDULE_POLICY,
  DEMO_SCHEDULE_POLICY,
  currentHourStart,
  summaryForHour,
} from "./scheduleEngine";
type Tab = "patients" | "general" | "archive" | "settings";
const FILTERS = [
  ["ALL", "Все назначения"],
  ["MEDICATION", "Препараты"],
  ["SOLUTION", "Растворы"],
  ["MONITORING", "Мониторинг"],
  ["PROCEDURE", "Процедуры"],
  ["NURSING", "Уход"],
  ["ACTIVITY", "Активность"],
];
export function Workspace({
  source,
  branches,
  initialTab,
  onExpire,
  onLogout,
}: {
  source: Source;
  branches: Branch[];
  initialTab?: Tab;
  onExpire: (message?: string) => void;
  onLogout: () => void;
}) {
  const [location, setLocation] = useState(() =>
    initialDepartment(
      branches,
      readPreferences(source.demo).department,
      source.demo,
    ),
  );
  const [preferenceWarning, setPreferenceWarning] = useState("");
  const { branchId, departmentId } = location;
  const branch = branches.find((b) => b.id === branchId);
  const selectors = (
    <section className="selectors compact-selectors">
      <label>
        Филиал
        <select
          aria-label="Филиал"
          value={branchId}
          onChange={(e) => {
            const next = branches.find((b) => b.id === e.target.value);
            setLocation({
              branchId: next?.id ?? "",
              departmentId: "",
              notice: next?.departments.length
                ? "Выберите отделение."
                : "В выбранном филиале нет доступных отделений. Выберите другой филиал.",
            });
          }}
        >
          <option value="" disabled>
            Выберите филиал
          </option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Отделение
        <select
          aria-label="Отделение"
          value={departmentId}
          disabled={!branch?.departments.length}
          onChange={(e) => {
            const id = e.target.value;
            if (!branch?.departments.some((d) => d.id === id)) return;
            setLocation({ branchId: branch.id, departmentId: id, notice: "" });
            setPreferenceWarning(
              saveDepartmentPreference(
                { branchId: branch.id, departmentId: id },
                source.demo,
              )
                ? ""
                : "Не удалось сохранить настройки в браузере. Выбор действует в текущем сеансе.",
            );
          }}
        >
          {!!branch?.departments.length && (
            <option value="" disabled>
              Выберите отделение
            </option>
          )}
          {!branch?.departments.length && (
            <option value="">Нет отделений в ответе API</option>
          )}
          {branch?.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
  return (
    <Department
      key={`${branchId}/${departmentId}`}
      source={source}
      branches={branches}
      initialTab={initialTab}
      branch={branch}
      departmentId={departmentId}
      selectors={selectors}
      selectionNotice={location.notice}
      preferenceWarning={preferenceWarning}
      onExpire={onExpire}
      onLogout={onLogout}
    />
  );
}
function MaleIcon() {
  return <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="10" r="3.5"/><path d="M8.5 7.5 14 2M10.5 2H14v3.5"/></svg>;
}
function FemaleIcon() {
  return <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="8" cy="5.5" r="3.5"/><path d="M8 9v5.5M5.5 12h5"/></svg>;
}

function Department({
  source,
  branches,
  initialTab,
  branch,
  departmentId,
  selectors,
  selectionNotice,
  preferenceWarning,
  onExpire,
  onLogout,
}: {
  source: Source;
  branches: Branch[];
  initialTab?: Tab;
  branch?: Branch;
  departmentId: string;
  selectors: React.ReactNode;
  selectionNotice: string;
  preferenceWarning: string;
  onExpire: (message?: string) => void;
  onLogout: () => void;
}) {
  const [detailDiagnostics, setDetailDiagnostics] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [writeEnabled, setWriteEnabled] = useState(
    () => readPreferences(source.demo).editingEnabled,
  );
  const [editingPreferenceWarning, setEditingPreferenceWarning] = useState("");
  const [editing, setEditing] = useState<{
    target: ResultTarget;
    chain: import("./model").Chain;
  } | null>(null);
  const [writeNotice, setWriteNotice] = useState("");
  const clearWriteNotice = useCallback(() => setWriteNotice(""), []);
  const [discharging, setDischarging] = useState<Patient | null>(null);
  const [moving, setMoving] = useState<Patient | null>(null);
  const [photoPatient, setPhotoPatient] = useState<Patient | null>(null);
  const [patientEntity, setPatientEntity] = useState<{
    patient?: Patient;
  } | null>(null);
  const [prescriptionEdit, setPrescriptionEdit] = useState<{
    patient: Patient;
    chain?: import("./model").Chain;
    action: "create" | PrescriptionAction;
  } | null>(null);
  const feedMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = feedMenu.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && feedMenu.current?.open) feedMenu.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, []);
  const dischargingRef = useRef(false);
  useEffect(() => {
    source.prescriptions?.setEnabled(writeEnabled);
    source.results?.setEnabled(writeEnabled);
    source.discharge?.setEnabled(writeEnabled);
    source.transfer?.setEnabled(writeEnabled);
    source.entities?.setEnabled(writeEnabled);
    return () => {
      source.prescriptions?.setEnabled(false);
      source.results?.setEnabled(false);
      source.discharge?.setEnabled(false);
      source.transfer?.setEnabled(false);
      source.entities?.setEnabled(false);
    };
  }, [source, writeEnabled]);
  const [tab, setTab] = useState<Tab>(initialTab ?? "general"),
    [selected, setSelected] = useState<Patient | null>(null),
    [patientActionsOpen, setPatientActionsOpen] = useState(false),
    [mode, setMode] = useState<"feed" | "grid">("feed");
  const [patients, setPatients] = useState<Patient[]>([]),
    [patientsLoading, setPatientsLoading] = useState(true),
    [patientsError, setPatientsError] = useState(""),
    [patientsRefresh, setPatientsRefresh] = useState(0),
    [patientsTime, setPatientsTime] = useState<number | null>(null),
    [unknown, setUnknown] = useState(false);
  const expire = useRef(onExpire);
  expire.current = onExpire;
  const [store] = useState(
    () => new PrescriptionStore(source, () => expire.current()),
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(
    () => () => {
      store.close();
      source.clearCache?.();
    },
    [store, source],
  );
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setPatientsError("");
    if (!branch || !departmentId) {
      setPatientsLoading(false);
      return () => controller.abort();
    }
    setPatientsLoading(true);
    source
      .patients(branch.id, departmentId, controller.signal, patientsRefresh > 0)
      .then((data) => {
        if (live) {
          setPatients(data);
          setPatientsTime(receivedAt(data));
          store.prune(new Set(data.map((p) => p.cardId)));
          setSelected((old) =>
            old ? (data.find((p) => p.cardId === old.cardId) ?? null) : null,
          );
        }
      })
      .catch((error) => {
        if (live) {
          if (error instanceof ApiError && error.kind === "Unauthorized")
            expire.current();
          else setPatientsError(safeError(error));
        }
      })
      .finally(() => {
        if (live) setPatientsLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [source, branch, departmentId, patientsRefresh, store]);
  const active = useMemo(
    () => patients.filter((p) => cardState(p) === "active"),
    [patients],
  );
  const unknownPatients = useMemo(
    () => patients.filter((p) => cardState(p) === "unknown"),
    [patients],
  );
  const visible = useMemo(
    () =>
      patients.filter(
        (p) =>
          cardState(p) === "active" || (unknown && cardState(p) === "unknown"),
      ),
    [patients, unknown],
  );
  useEffect(() => {
    if (tab === "general")
      active.forEach((p) => {
        void store.request(p.cardId);
      });
  }, [active, tab, store]);
  useEffect(() => {
    if (selected) void store.request(selected.cardId);
  }, [selected, store]);
  const [zone, setZone] = useState(deviceZone),
    [zoneDraft, setZoneDraft] = useState(deviceZone),
    [zoneError, setZoneError] = useState(""),
    [manualClock, setManualClock] = useState<string | null>(null);
  const clock =
    manualClock ?? shiftClock(branch?.workShiftStart || "", zone) ?? "";
  const [reference, setReference] = useState(Date.now),
    [now, setNow] = useState(Date.now),
    [day, setDay] = useState(() => initialDay(Date.now(), clock, zone)),
    [choice, setChoice] = useState("auto");
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    const update = () => setNow(Date.now());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, []);
  useEffect(() => {
    setDay(initialDay(Date.now(), clock, zone));
    setChoice("auto");
  }, [clock, zone]);
  const periodPatients = useMemo(
    () =>
      selected && cardState(selected) !== "active"
        ? [...active, selected]
        : active,
    [active, selected],
  );
  const periods = useMemo(() => sheetPeriods(periodPatients), [periodPatients]);
  const period = useMemo(
    () => resolvePeriod(periods, day, clock, zone, choice, reference),
    [periods, day, clock, zone, choice, reference],
  );
  const [category, setCategory] = useState("ALL"),
    [selection, setSelection] = useState<Selection | null>(null),
    [expanded, setExpanded] = useState(new Set<string>()),
    [history, setHistory] = useState(false);
  const select = useCallback(
    (s: Selection) =>
      setSelection({ ...s, patient: s.patient ?? selected ?? undefined }),
    [selected],
  );
  const openPatient = (p: Patient, openActions = false) => {
    setSelected(p);
    setPatientActionsOpen(openActions);
    setMode("feed");
    setHistory(false);
    setTab("patients");
    setSelection(null);
  };
  const changeTab = (next: Tab) => {
    setSelection(null);
    if (next === "general" || next === "patients") {
      setSelected(null);
      setPatientActionsOpen(false);
    }
    setTab(next);
  };
  const selectedData = selected ? snapshot.get(selected.cardId) : undefined;
  const errors = active.filter(
    (p) => snapshot.get(p.cardId)?.phase === "error",
  ).length;
  const finished = active.filter((p) =>
    ["ready", "error"].includes(snapshot.get(p.cardId)?.phase || ""),
  ).length;
  const complete =
    finished === active.length && !patientsLoading && !patientsError;
  const pending =
    patientsLoading ||
    active.some(
      (p) => !["ready", "error"].includes(snapshot.get(p.cardId)?.phase || ""),
    );
  const extraCategories = useMemo(
    () =>
      [
        ...new Set(
          [...snapshot.values()].flatMap((d) => d.chains.map((c) => c.type)),
        ),
      ].filter((t) => !FILTERS.some(([key]) => key === t)),
    [snapshot],
  );
  const diagnostics = useMemo(
    () =>
      [...snapshot].flatMap(([card, data]) =>
        data.indexes.flatMap((index) =>
          revisionDiagnostics(index).map((message) => ({
            card,
            name: index.chain.name,
            message,
          })),
        ),
      ),
    [snapshot],
  );
  const intervalWarningCount = useMemo(
    () =>
      active.filter((p) => patientPeriodWarnings(p, period).length > 0).length +
      (period?.warnings.length || 0),
    [active, period],
  );
  const patientSchedules = useMemo(
    () =>
      new Map(
        active.flatMap((p) => {
          const data = snapshot.get(p.cardId);
          if (!data?.hasData && data?.phase !== "ready") return [];
          return [
            [
              p.cardId,
              buildPatientSchedule(
                data.indexes,
                p,
                period,
                source.demo ? DEMO_SCHEDULE_POLICY : API_SCHEDULE_POLICY,
                "ALL",
                zone,
              ),
            ] as const,
          ];
        }),
      ),
    [active, snapshot, period, source.demo, zone],
  );
  const scheduleDiagnostics = useMemo(
    () =>
      active.flatMap((p) =>
        (patientSchedules.get(p.cardId)?.issues ?? []).map((issue) => ({
          patient: p.name,
          name: issue.index.chain.name,
          reasons: issue.reasons,
        })),
      ),
    [active, patientSchedules],
  );
  const warningCount =
    diagnostics.length +
    intervalWarningCount +
    errors +
    scheduleDiagnostics.length;
  function move(direction: -1 | 1) {
    if (period?.source === "sheet") {
      const next = adjacentPeriod(periods, period, direction);
      if (next) setChoice(next.key);
    } else {
      setDay((d) => addDay(d, direction));
      setChoice("shift");
    }
  }
  function today() {
    setReference(Date.now());
    setDay(initialDay(Date.now(), clock, zone));
    setChoice("auto");
  }
  const periodBar = (
    <>
      <div className="day-nav compact-day">
        <button
          className="icon-button"
          aria-label="Предыдущая смена"
          disabled={
            period?.source === "sheet" && !adjacentPeriod(periods, period, -1)
          }
          onClick={() => move(-1)}
        >
          ‹
        </button>
        <div>
          <b>
            {period ? formatDate(period.start, zone) : "Интервал не определён"}
          </b>
          <small>
            {period
              ? `${formatTime(period.start, zone)} → ${formatDate(period.end, zone)} ${formatTime(period.end, zone)}`
              : "Откройте настройки времени"}
          </small>
        </div>
        <button
          className="icon-button"
          aria-label="Следующая смена"
          disabled={
            period?.source === "sheet" && !adjacentPeriod(periods, period, 1)
          }
          onClick={() => move(1)}
        >
          ›
        </button>
      </div>
      <div className="shift-meta">
        <button className="quiet small" onClick={today}>
          Текущая смена
        </button>
        <span>{zone}</span>
      </div>
    </>
  );
  const filters = (
    <nav className="category-tabs" aria-label="Категории назначений">
      {[...FILTERS, ...extraCategories.map((c) => [c, LABELS[c] || c])].map(
        ([value, label]) => (
          <button
            key={value}
            className={category === value ? "active" : ""}
            aria-pressed={category === value}
            onClick={() => setCategory(value)}
          >
            {label}
          </button>
        ),
      )}
    </nav>
  );
  const individualPatients = useMemo(
    () => (selected ? [selected] : []),
    [selected],
  );
  const [autoRefresh, setAutoRefresh] = useState(false),
    [refreshingAll, setRefreshingAll] = useState(false),
    [lastSuccess, setLastSuccess] = useState<number | null>(null);
  const refreshingRef = useRef(false),
    alive = useRef(true),
    refreshController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      alive.current = false;
      refreshController.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (complete && !errors && lastSuccess === null)
      setLastSuccess(
        Math.max(
          patientsTime ?? 0,
          ...active.map((p) => snapshot.get(p.cardId)?.receivedAt ?? 0),
        ) || null,
      );
  }, [complete, errors, lastSuccess, patientsTime, active, snapshot]);
  async function refreshDepartment() {
    if (
      refreshingRef.current ||
      dischargingRef.current ||
      patientsLoading ||
      pending ||
      !branch ||
      !departmentId
    )
      return;
    refreshingRef.current = true;
    setRefreshingAll(true);
    const controller = new AbortController();
    refreshController.current = controller;
    try {
      const data = await source.patients(
        branch.id,
        departmentId,
        controller.signal,
        true,
      );
      if (!alive.current) return;
      setPatients(data);
      setPatientsTime(receivedAt(data));
      setPatientsError("");
      setSelected((old) =>
        old ? (data.find((p) => p.cardId === old.cardId) ?? null) : null,
      );
      store.prune(new Set(data.map((p) => p.cardId)));
      const cards = data.filter((p) => cardState(p) === "active");
      await Promise.all(cards.map((p) => store.request(p.cardId, true)));
      if (
        alive.current &&
        cards.every((p) => store.getSnapshot().get(p.cardId)?.phase === "ready")
      )
        setLastSuccess(Date.now());
    } catch (error) {
      if (alive.current) {
        if (error instanceof ApiError && error.kind === "Unauthorized")
          expire.current();
        else setPatientsError(safeError(error));
      }
    } finally {
      refreshingRef.current = false;
      if (alive.current) setRefreshingAll(false);
    }
  }
  useOptionalRefresh(autoRefresh && tab !== "archive", refreshDepartment);
  const viewFilter = (
    <div className="work-view-filter" aria-label="Фильтр ленты">
      <button
        className={!history ? "active" : ""}
        aria-pressed={!history}
        onClick={() => setHistory(false)}
      >
        Требуют отметки
      </button>
      <button
        className={history ? "active" : ""}
        aria-pressed={history}
        onClick={() => setHistory(true)}
      >
        История отметок
      </button>
    </div>
  );
  return (
    <>
      <main
        className={`workspace mobile-workspace ${selected && tab === "patients" ? "individual-workspace" : ""}`}
      >
        {selectionNotice && tab !== "archive" && (
          <section className="panel" aria-label="Выбор отделения">
            <p role="status">{selectionNotice}</p>
            {(tab === "general" || (tab === "patients" && !!selected)) &&
              selectors}
          </section>
        )}
        <SaveNotice
          key={writeNotice}
          message={writeNotice}
          onExpire={clearWriteNotice}
        />
        {source.demo && (
          <p className="demo-banner">
            ДЕМО · Вымышленные данные · без запросов к API
          </p>
        )}
        {tab === "archive" ? (
          source.archive ? (
            <Archive
              api={source.archive}
              branches={branches}
              initialBranch={branch?.id ?? ""}
              zone={zone}
              demo={source.demo}
              onExpire={() => expire.current()}
            />
          ) : (
            <p className="notice">Архив недоступен в этом источнике данных.</p>
          )
        ) : tab === "settings" ? (
          <>
            <div className="page-title">
              <h1>Настройки</h1>
              <span className="read-badge">
                v0.5.1 · {writeEnabled ? "Редактирование" : "Просмотр"}
              </span>
            </div>
            <section className="panel">
              <h2>Отделение</h2>
              {selectors}
              {preferenceWarning && (
                <p className="micro warning">{preferenceWarning}</p>
              )}
            </section>
            <section className="panel">
              <h2>Подключение</h2>
              <p>{source.demo ? "Локальное демо" : "Подключено"}</p>
              <p className="micro">
                Токен сохраняется в хранилище Test2 до выхода или истечения.{" "}
                {source.demo
                  ? "API не используется."
                  : "Ошибки 401 завершают сеанс; 403 означает запрет доступа."}
              </p>
              <p className="micro">
                Пациенты:{" "}
                {patientsTime
                  ? formatStamp(patientsTime, zone)
                  : "нет полученного ответа"}
                . Активных карт: {active.length}. Статус неизвестен:{" "}
                {unknownPatients.length}.
              </p>
              <p className="micro">
                Назначения: готово {finished - errors} / {active.length}, ошибок{" "}
                {errors}, незавершённых {active.length - finished}. Не все
                endpoints CORS проверены до реального запроса.
              </p>
              <button className="secondary full" onClick={onLogout}>
                Выйти и очистить данные
              </button>
            </section>
            {source.results && (
              <section className="panel">
                <h2>Отметки выполнения</h2>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    aria-label="Разрешить редактирование"
                    checked={writeEnabled}
                    onChange={(e) => {
                      source.prescriptions?.setEnabled(e.target.checked);
                      source.results!.setEnabled(e.target.checked);
                      source.discharge?.setEnabled(e.target.checked);
                      source.transfer?.setEnabled(e.target.checked);
                      source.entities?.setEnabled(e.target.checked);
                      setWriteEnabled(e.target.checked);
                      setWriteNotice("");
                      setEditingPreferenceWarning(
                        saveEditingPreference(e.target.checked, source.demo)
                          ? ""
                          : "Не удалось сохранить настройку в браузере. Выбор действует в текущем сеансе.",
                      );
                    }}
                  />
                  Разрешить редактирование
                </label>
                <p className="micro">
                  {source.demo
                    ? "Только вымышленные данные; изменения остаются в памяти демо."
                    : "Отметки выполнения и выписка с отдельным подтверждением. Сами назначения, дозы и расписание не меняются. Права доступа проверяются сервером."}
                </p>
                {editingPreferenceWarning && (
                  <p className="micro warning">{editingPreferenceWarning}</p>
                )}
                <p className="micro">
                  По умолчанию включено. Ваш выбор сохраняется в этом браузере;
                  токен и медицинские данные не сохраняются.
                </p>
              </section>
            )}
            <section className="panel">
              <h2>Обновление</h2>
              <label className="checkbox">
                <input
                  aria-label="Автообновление каждые 60 секунд"
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
                Автообновление каждые 60 секунд
              </label>
              <p className="micro">
                По умолчанию выключено. Только GET, очередь до 3 запросов, без
                наложения циклов. В скрытой вкладке опрос приостанавливается.
              </p>
              <p className="micro">
                Последнее полное успешное обновление:{" "}
                {lastSuccess
                  ? formatStamp(lastSuccess, zone)
                  : "ещё не завершено"}
              </p>
              {patientsError && <ErrorBox message={patientsError} />}
            </section>
            <ScheduleDiagnostics
              snapshot={snapshot}
              demo={source.demo}
              zone={zone}
            />
            <section className="panel">
              <h2>Время и интервал</h2>
              <label>
                Часовой пояс IANA
                <div className="inline">
                  <input
                    aria-label="Часовой пояс IANA"
                    value={zoneDraft}
                    onChange={(e) => setZoneDraft(e.target.value)}
                    placeholder="Europe/Moscow"
                  />
                  <button
                    className="secondary small"
                    onClick={() => {
                      if (validZone(zoneDraft)) {
                        setZone(zoneDraft);
                        setZoneError("");
                      } else
                        setZoneError(
                          "Неизвестный часовой пояс. Пример: Europe/Moscow",
                        );
                    }}
                  >
                    Применить
                  </button>
                </div>
              </label>
              {zoneError && <ErrorBox message={zoneError} />}
              <p className="micro">
                По умолчанию зона устройства. Сверьте её с зоной клиники.
              </p>
              <label>
                Начало смены
                <input
                  aria-label="Начало смены"
                  type="time"
                  value={clock}
                  onChange={(e) => setManualClock(e.target.value)}
                />
              </label>
              <p className="micro">
                {manualClock !== null
                  ? "Задано вручную."
                  : clock
                    ? "Из workShiftStart филиала."
                    : "Формат начала смены неизвестен. Укажите время вручную."}{" "}
                При наличии соответствующего листа режим «Авто» использует его
                реальные границы.
              </p>
              <label>
                Источник интервала
                <select
                  aria-label="Источник интервала"
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                >
                  <option value="auto">
                    Авто · реальные листы, затем начало смены
                  </option>
                  <option value="shift">
                    Начало смены · соседние календарные сутки
                  </option>
                  {periods.map((p) => (
                    <option key={p.key} value={p.key}>
                      Лист {formatStamp(p.start, zone)} →{" "}
                      {formatStamp(p.end, zone)} · {p.patients} карт
                    </option>
                  ))}
                </select>
              </label>
              <p className="micro">
                {period
                  ? `${period.source === "sheet" ? "Реальные границы листа" : "Интервал от начала смены"}: ${formatStamp(period.start, zone)} → ${formatStamp(period.end, zone)}`
                  : "Интервал не определён. Неоднозначное время DST не выбирается автоматически."}
              </p>
              {period?.warnings.map((w) => (
                <p key={w} className="notice">
                  {w}
                </p>
              ))}
              {selected &&
                patientPeriodWarnings(selected, period).map((w) => (
                  <p key={w} className="notice">
                    {w}
                  </p>
                ))}
            </section>
            <section className="panel">
              <h2>Диагностика</h2>
              <label className="checkbox">
                <input
                  type="checkbox"
                  aria-label="Технические детали назначений"
                  checked={detailDiagnostics}
                  onChange={(e) => setDetailDiagnostics(e.target.checked)}
                />
                Технические детали назначений
              </label>
              <p className="micro">
                Расписание создаётся только по подтверждённым правилам
                scheduleEngine, внутри действующей редакции и листа. Нет отметки
                ≠ подтверждённое невыполнение. Неоднозначные исторические записи
                доступны в сетке и деталях.
              </p>
              <p className="micro">
                Рабочая лента сгруппирована по времени и пациентам, без
                пагинации. Длинные раскрытые списки и сетка виртуализированы.
                Переключения и прокрутка не создают запросов.
              </p>
              <p className="micro">
                Данные лент сохраняются в RAM выбранного отделения до ручного
                обновления/смены отделения/выхода. Время получения не
                обновляется при переключении.
              </p>
              {active
                .filter((p) => patientPeriodWarnings(p, period).length > 0)
                .map((p) => (
                  <p className="notice micro" key={p.cardId}>
                    {p.name}: {patientPeriodWarnings(p, period).join(" ")}
                  </p>
                ))}
              <p className="micro">
                Предупреждений о редакциях: {diagnostics.length}
              </p>
              <p className="micro">
                Расписание требует уточнения: {scheduleDiagnostics.length}{" "}
                цепочек (все категории).
              </p>
              {scheduleDiagnostics.slice(0, 50).map((d, i) => (
                <p className="micro warning" key={`schedule-${i}`}>
                  {d.patient}: {d.name} — {d.reasons.join(" ")}
                </p>
              ))}
              {scheduleDiagnostics.length > 50 && (
                <p className="micro">
                  Здесь первые 50 цепочек; остальные доступны в разделе
                  уточнения ленты.
                </p>
              )}
              {diagnostics.slice(0, 50).map((d, i) => (
                <p key={`${d.card}-${i}`} className="micro warning">
                  {patients.find((p) => p.cardId === d.card)?.name}: {d.name} —{" "}
                  {d.message}
                </p>
              ))}
              {diagnostics.length > 50 && (
                <p className="micro">
                  Здесь показаны первые 50 предупреждений. Остальные доступны в
                  деталях назначений.
                </p>
              )}
              {patients
                .filter((p) => snapshot.get(p.cardId)?.phase === "error")
                .map((p) => (
                  <div key={p.cardId} className="diagnostic-patient">
                    <b>{p.name}</b>
                    <ErrorBox message={snapshot.get(p.cardId)!.error} />
                    <button
                      className="secondary full"
                      onClick={() => void store.request(p.cardId, true, true)}
                    >
                      Диагностика: 6 GET по категориям
                    </button>
                  </div>
                ))}
            </section>
          </>
        ) : tab === "patients" && !selected ? (
          <>
            <div className="patient-home-header">
              <div className="patient-home-brand"><span className="patient-home-paw" aria-hidden="true"><svg viewBox="0 0 48 48" width="34" height="34" fill="currentColor"><ellipse cx="24" cy="31" rx="12" ry="9"/><ellipse cx="10" cy="19" rx="5" ry="7" transform="rotate(-25 10 19)"/><ellipse cx="19" cy="12" rx="5" ry="7"/><ellipse cx="30" cy="12" rx="5" ry="7"/><ellipse cx="39" cy="19" rx="5" ry="7" transform="rotate(25 39 19)"/></svg></span><span><b>CleverVet Mobile</b><small>СТАЦИОНАР</small></span></div>
              <div className="patient-home-actions">
                <span className="patient-count" aria-label={`Пациентов: ${patientsLoading || patientsError || !departmentId ? "данные недоступны" : active.length}`}>{patientsLoading || patientsError || !departmentId ? "…" : active.length}</span>
                <button type="button" className="patient-header-button" disabled aria-label="Поиск пока недоступен" title="Поиск пока недоступен">⌕</button>
                {source.entities && branch && departmentId && <button type="button" className="patient-header-button" aria-label="Добавить пациента" disabled={!writeEnabled || patientsLoading || refreshingAll} onClick={() => { dischargingRef.current = true; setPatientEntity({}); }}>+</button>}
              </div>
            </div>
            <button className="patient-refresh" disabled={patientsLoading || refreshingAll || !departmentId} onClick={() => setPatientsRefresh((n) => n + 1)} aria-label="Обновить пациентов" title="Обновить пациентов">↻</button>
            {unknownPatients.length > 0 && (
              <label className="notice checkbox">
                <input
                  type="checkbox"
                  checked={unknown}
                  onChange={(e) => setUnknown(e.target.checked)}
                />
                Показать карты с неподтверждённым статусом (
                {unknownPatients.length})
              </label>
            )}
            <div className="patient-list">
              {visible.map((p) => {
                const counters = [0, 1].map((offset) => {
                  const at = currentHourStart(now, zone) + offset * HOUR;
                  const schedule = patientSchedules.get(p.cardId);
                  const data = snapshot.get(p.cardId);
                  const summary = schedule
                    ? summaryForHour(schedule, at, now, zone)
                    : null;
                  return {
                    at,
                    label: offset === 0 ? "Сейчас" : "След. час",
                    icon: offset === 0 ? "⌁" : "◷",
                    status: summary?.status ?? "loading",
                    value: summary ? summary.unmarked : null,
                    partial: !schedule?.complete || data?.phase !== "ready",
                    failed: data?.phase === "error" && !data?.hasData,
                  };
                });
                const meta = [p.species && "species", (p.gender === "MALE" || p.gender === "FEMALE") && "gender", p.weight && "weight"].filter(Boolean);
                return (
                  <article className="patient-tile" key={p.id}>
                    <button
                      type="button"
                      className="patient-card"
                      aria-label={`Открыть карту пациента ${p.name}`}
                      onClick={() => openPatient(p)}
                    >
                      <span className="patient-card-photo">
                        <PatientPhoto patient={p} demo={source.demo} />
                      </span>
                      <span className="patient-card-body">
                        <strong className="patient-card-name">{p.name}</strong>
                        <span className="patient-card-meta">
                          {meta.length ? meta.map((part, i) => <span className="patient-meta-part" key={String(part)}>{i > 0 && <span className="patient-separator" aria-hidden="true">·</span>}{part === "gender" ? <span className="patient-gender-icon" role="img" aria-label={p.gender === "MALE" ? "Самец" : "Самка"}>{p.gender === "MALE" ? <MaleIcon /> : <FemaleIcon />}</span> : <span>{part === "species" ? p.species : `${p.weight} кг`}</span>}</span>) : "Данные не указаны"}
                        </span>
                        <span
                          className={`patient-card-diagnosis${p.diagnoses ? "" : " is-empty"}`}
                        >
                          {p.diagnoses}
                        </span>
                        <span className="patient-card-severity">
                          <SeverityBadge value={p.severity} />
                        </span>
                        <span
                          className="patient-card-counters"
                          aria-label="Почасовая сводка"
                        >
                          {counters.map((counter, offset) => (
                            <span
                              className={
                                offset === 0
                                  ? "patient-hour-now"
                                  : "patient-hour-next"
                              }
                              key={counter.at}
                              data-status={counter.status}
                            >
                              <span className="patient-hour-icon" aria-hidden="true">
                                {counter.icon}
                              </span>
                              <span>{counter.label}: </span>
                              <b>
                                {counter.failed ? "Ошибка" : counter.value === null ? "…" : counter.value}
                              </b>
                              {counter.partial && <span className="patient-counter-warning" aria-label="Данные неполные">⚠</span>}
                            </span>
                          ))}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="patient-card-menu"
                      aria-label={`Действия с пациентом ${p.name}`}
                      onClick={() => openPatient(p, true)}
                    >
                      •••
                    </button>
                  </article>
                );
              })}
            </div>
            {!patientsLoading &&
              !patientsError &&
              departmentId &&
              !visible.length && (
                <p className="empty">
                  Нет пациентов с подтверждёнными активными картами.
                </p>
              )}
          </>
        ) : selected && tab === "patients" ? (
          <>
            <button
              className="secondary small back"
              onClick={() => {
                setSelected(null);
                setPatientActionsOpen(false);
              }}
            >
              ‹ Пациенты
            </button>
            <div className="patient-heading">
              <PatientPhoto
                patient={selected}
                demo={source.demo}
                large
                onEdit={
                  writeEnabled ? () => setPhotoPatient(selected) : undefined
                }
              />
              <div>
                <h1>{selected.name}</h1>
                <p className="micro">
                  {[
                    selected.species,
                    selected.weight ? `${selected.weight} кг` : "",
                    selected.cage ? `Клетка ${selected.cage}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <SeverityBadge value={selected.severity} />
              </div>
              <button
                className="secondary small"
                disabled={
                  selectedData?.phase === "queued" ||
                  selectedData?.phase === "loading"
                }
                onClick={() => void store.request(selected.cardId, true)}
              >
                Обновить
              </button>
            </div>
            {selected.diagnoses && (
              <p className="diagnosis">{selected.diagnoses}</p>
            )}
            {selected.ownerName && (
              <p className="patient-owner">Владелец: {selected.ownerName}</p>
            )}
            {source.discharge && cardState(selected) === "active" && (
              <details
                className="patient-actions"
                open={patientActionsOpen}
                onToggle={(event) =>
                  setPatientActionsOpen(event.currentTarget.open)
                }
              >
                <summary>Действия с пациентом</summary>
                <p className="micro">
                  Завершение лечения выполняется отдельно от отметок назначений.
                </p>
                <button
                  className="secondary danger-text"
                  disabled={
                    !writeEnabled ||
                    patientsLoading ||
                    refreshingAll ||
                    !!editing
                  }
                  onClick={() => {
                    dischargingRef.current = true;
                    setDischarging(selected);
                    setWriteNotice("");
                  }}
                >
                  Завершить лечение
                </button>
                {source.transfer && (
                  <button
                    className="secondary"
                    disabled={
                      !writeEnabled ||
                      patientsLoading ||
                      refreshingAll ||
                      !!editing
                    }
                    onClick={() => {
                      dischargingRef.current = true;
                      setMoving(selected);
                      setWriteNotice("");
                    }}
                  >
                    Перевести в другое отделение
                  </button>
                )}
                {source.entities && (
                  <button
                    className="quiet small danger-text"
                    disabled={
                      !writeEnabled ||
                      patientsLoading ||
                      refreshingAll ||
                      !!editing
                    }
                    onClick={() => {
                      dischargingRef.current = true;
                      setPatientEntity({ patient: selected });
                    }}
                  >
                    Удалить пациента
                  </button>
                )}
                {!writeEnabled && (
                  <p className="micro">
                    Редактирование отключено в настройках.
                  </p>
                )}
              </details>
            )}
            {source.entities && (
              <BelongingsPanel
                key={selected.id}
                patientId={selected.id}
                service={source.entities}
                enabled={writeEnabled}
                zone={zone}
                onExpire={() => expire.current()}
              />
            )}
            {source.prescriptions && (
              <button
                className="secondary small"
                disabled={!writeEnabled || !selectedData?.hasData || !!editing}
                onClick={() => {
                  dischargingRef.current = true;
                  setPrescriptionEdit({ patient: selected, action: "create" });
                  setWriteNotice("");
                }}
              >
                + Назначение
              </button>
            )}
            {periodBar}
            <div className="view-switch" aria-label="Вид назначений">
              <button
                className={mode === "feed" ? "active" : ""}
                aria-pressed={mode === "feed"}
                onClick={() => setMode("feed")}
              >
                Лента
              </button>
              <button
                className={mode === "grid" ? "active" : ""}
                aria-pressed={mode === "grid"}
                onClick={() => setMode("grid")}
              >
                Сетка
              </button>
            </div>
            {filters}
            {mode === "feed" && viewFilter}
            <DataState
              data={selectedData}
              onRetry={() => void store.request(selected.cardId, true)}
            />
            {selectedData &&
              (selectedData.hasData || selectedData.phase === "ready") && (
                <>
                  <p className="data-received">
                    Получено{" "}
                    {selectedData.receivedAt
                      ? formatStamp(selectedData.receivedAt, zone)
                      : "в локальном демо"}
                  </p>
                  {mode === "feed" ? (
                    <WorkBoard
                      patients={individualPatients}
                      snapshot={snapshot}
                      period={period}
                      zone={zone}
                      now={now}
                      category={category}
                      demo={source.demo}
                      history={history}
                      expanded={expanded}
                      setExpanded={setExpanded}
                      onSelect={select}
                      onOpenPatient={openPatient}
                      onRetry={(card) => void store.request(card, true)}
                    />
                  ) : period ? (
                    <>
                      <span className="grid-legend">
                        ✓ выполнено · × не выполнено · — нет результата
                      </span>
                      <Grid
                        key={`${period.key}:${category}`}
                        indexes={selectedData.indexes.filter(
                          (i) =>
                            category === "ALL" || i.chain.type === category,
                        )}
                        start={period.start}
                        end={period.end}
                        zone={zone}
                        now={now}
                        onSelect={select}
                      />
                    </>
                  ) : (
                    <p className="notice">Укажите интервал в настройках.</p>
                  )}
                </>
              )}
          </>
        ) : (
          <>
            <div className="page-title compact-title general-feed-heading">
              <h1>Общая лента</h1>
              <button type="button" className="patient-refresh feed-refresh" aria-label={refreshingAll ? "Обновление общей ленты" : "Обновить общую ленту"} title="Обновить общую ленту" aria-busy={refreshingAll} disabled={pending || refreshingAll || !departmentId} onClick={() => void refreshDepartment()}>{refreshingAll ? "…" : "↻"}</button>
              <details className="feed-extra" ref={feedMenu}>
                <summary aria-label="Дополнительные фильтры"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h4m4 0h8M4 17h8m4 0h4M8 4v6m8 4v6"/></svg></summary>
                <div className="feed-extra-panel" onClick={(event) => {
                  const target = event.target;
                  if (target instanceof Element && target.closest(".category-tabs button, .work-view-filter button")) {
                    if (feedMenu.current) feedMenu.current.open = false;
                  }
                }}>
                  <p className="micro">{branch?.name} · {branch?.departments.find(d => d.id === departmentId)?.name}</p>
                  {filters}
                  {viewFilter}
                  <button className="secondary small" disabled={pending || refreshingAll || !departmentId} onClick={() => void refreshDepartment()}>Обновить</button>
                </div>
              </details>
            </div>
            <div className="general-period">{periodBar}</div>
            <p className="refresh-status" role="status">
              {refreshingAll ? "Обновление… " : ""}
              {lastSuccess
                ? `Успешное обновление: ${formatTime(lastSuccess, zone)}`
                : "Получение данных…"}
              {autoRefresh ? " · авто 60 с" : ""}
            </p>
            {patientsError && (
              <p className="schedule-alert" role="status">
                Список пациентов не обновлён. Отображаются ранее полученные
                данные; рабочий список может быть неполным.
              </p>
            )}
            {!!active.length && (!complete || errors > 0) && (
              <div className="load-progress" role="status" aria-live="polite">
                <progress
                  max={active.length}
                  value={finished}
                  aria-label="Прогресс загрузки пациентов"
                />
                <span>
                  {!complete
                    ? `Загрузка: ${finished} / ${active.length}`
                    : errors
                      ? `Завершено: ${finished} / ${active.length} · Ошибок: ${errors}`
                      : `Загружено: ${finished} / ${active.length}`}
                </span>
              </div>
            )}
            {!patientsLoading &&
              !patientsError &&
              departmentId &&
              !active.length && (
                <p className="empty">
                  Нет пациентов с подтверждёнными активными картами.
                </p>
              )}
            {active.length > 0 && (
              <WorkBoard
                compact
                patients={active}
                snapshot={snapshot}
                period={period}
                zone={zone}
                now={now}
                category={category}
                demo={source.demo}
                history={history}
                expanded={expanded}
                setExpanded={setExpanded}
                onSelect={select}
                onOpenPatient={openPatient}
                onRetry={(card) => void store.request(card, true)}
              />
            )}
            {period && active.length > 0 && (
              <HourlyOverview
                open={overviewOpen}
                onToggle={setOverviewOpen}
                patients={active}
                schedules={patientSchedules}
                snapshot={snapshot}
                period={period}
                zone={zone}
                now={now}
                onPatient={(p) => {
                  openPatient(p);
                  setMode("grid");
                }}
              />
            )}
          </>
        )}
        {tab !== "settings" && tab !== "archive" && patientsLoading && (
          <Loader text="Загрузка пациентов отделения…" />
        )}
        {tab !== "settings" && tab !== "archive" && patientsError && (
          <>
            <ErrorBox message={patientsError} />
            <button
              className="secondary full"
              onClick={() => setPatientsRefresh((n) => n + 1)}
            >
              Повторить загрузку пациентов
            </button>
          </>
        )}
        {tab !== "settings" &&
          tab !== "archive" &&
          (!branch || !departmentId) && (
            <p className="notice">
              Выберите филиал с отделениями в разделе «Настройки».
            </p>
          )}
      </main>
      <nav className="bottom-nav" aria-label="Основная навигация">
        {(
          [
            ["patients", "Пациенты", "👥"],
            ["general", "Общая лента", "≡"],
            ["archive", "Архив", "▣"],
            ["settings", "Настройки", "⚙"],
          ] as const
        ).map(([value, label, icon]) => (
          <button
            key={value}
            className={tab === value ? "active" : ""}
            aria-current={tab === value ? "page" : undefined}
            onClick={() => changeTab(value)}
          >
            <span aria-hidden="true">{icon}</span>
            {label}
            {value === "settings" && warningCount > 0 && (
              <small
                className="nav-warning"
                aria-label={`Предупреждений: ${warningCount}`}
              >
                !
              </small>
            )}
          </button>
        ))}
      </nav>
      {photoPatient && (
        <PatientPhotoDialog
          patient={photoPatient}
          onClose={() => setPhotoPatient(null)}
        />
      )}
      {prescriptionEdit && source.prescriptions && writeEnabled && (
        <PrescriptionDialog
          patient={prescriptionEdit.patient}
          chain={prescriptionEdit.chain}
          action={prescriptionEdit.action}
          zone={zone}
          service={source.prescriptions}
          onClose={() => {
            setPrescriptionEdit(null);
            dischargingRef.current = false;
          }}
          onExpire={() => expire.current()}
          onSnapshot={(chains) => {
            store.acceptVerified(prescriptionEdit.patient.cardId, chains);
            setNow(Date.now());
          }}
          onSaved={(receipt) => {
            store.acceptVerified(receipt.patient.cardId, receipt.chains);
            setNow(Date.now());
            setPrescriptionEdit(null);
            dischargingRef.current = false;
            setWriteNotice("Назначение сохранено");
          }}
        />
      )}
      {editing && source.results && writeEnabled && (
        <ResultEditor
          initial={editing.target}
          chain={editing.chain}
          writer={source.results}
          onClose={() => setEditing(null)}
          onExpire={(message) => expire.current(message)}
          onRefresh={() => store.request(editing.target.patient.cardId, true)}
          onSaved={(receipt) => {
            setNow(Date.now());
            store.acceptVerified(receipt.patient.cardId, receipt.chains);
            setPatients((old) =>
              old.map((p) =>
                p.cardId === receipt.patient.cardId ? receipt.patient : p,
              ),
            );
            setSelected((old) =>
              old?.cardId === receipt.patient.cardId ? receipt.patient : old,
            );
            setEditing(null);
            setWriteNotice("Статус сохранён");
          }}
        />
      )}
      {discharging && source.discharge && (
        <DischargeDialog
          patient={discharging}
          department={[
            branch?.name,
            branch?.departments.find((d) => d.id === departmentId)?.name,
          ]
            .filter(Boolean)
            .join(" · ")}
          discharger={source.discharge}
          demo={source.demo}
          onClose={() => {
            setDischarging(null);
            dischargingRef.current = false;
          }}
          onExpire={(message) => expire.current(message)}
          onSaved={(receipt) => {
            setPatients(receipt.patients);
            setPatientsTime(Date.now());
            store.prune(new Set(receipt.patients.map((p) => p.cardId)));
            setSelected(null);
            setSelection(null);
            setDischarging(null);
            dischargingRef.current = false;
            setWriteNotice("Лечение завершено");
          }}
        />
      )}
      {moving && source.transfer && branch && (
        <TransferDialog
          patient={moving}
          current={{ branchId: branch.id, departmentId }}
          currentLabel={[
            branch.name,
            branch.departments.find((d) => d.id === departmentId)?.name,
          ]
            .filter(Boolean)
            .join(" · ")}
          source={source}
          onClose={() => {
            setMoving(null);
            dischargingRef.current = false;
          }}
          onExpire={(message) => expire.current(message)}
          onSaved={(receipt) => {
            setPatients(receipt.patients);
            setPatientsTime(Date.now());
            store.prune(new Set(receipt.patients.map((p) => p.cardId)));
            setSelected(null);
            setSelection(null);
            setMoving(null);
            dischargingRef.current = false;
            setWriteNotice("Пациент переведён");
          }}
        />
      )}
      {patientEntity && source.entities && branch && (
        <PatientEntityDialog
          service={source.entities}
          patient={patientEntity.patient}
          branch={branch}
          location={{ branchId: branch.id, departmentId }}
          zone={zone}
          onClose={() => {
            setPatientEntity(null);
            dischargingRef.current = false;
          }}
          onExpire={() => expire.current()}
          onCreated={(receipt) => {
            setPatients(receipt.patients);
            setPatientsTime(Date.now());
            setPatientEntity(null);
            dischargingRef.current = false;
            setWriteNotice("Пациент создан");
            openPatient(receipt.patient);
          }}
          onRemoved={(data) => {
            setPatients(data);
            setPatientsTime(Date.now());
            store.prune(new Set(data.map((p) => p.cardId)));
            setSelected(null);
            setSelection(null);
            setPatientEntity(null);
            dischargingRef.current = false;
            setWriteNotice("Пациент удалён");
          }}
        />
      )}
      {selection && (
        <Details
          selection={selection}
          diagnostic={detailDiagnostics}
          zone={zone}
          onClose={() => setSelection(null)}
          onManage={
            writeEnabled &&
            source.prescriptions &&
            selection.patient &&
            ["MEDICATION", "NURSING"].includes(selection.index.chain.type)
              ? (action) => {
                  dischargingRef.current = true;
                  setPrescriptionEdit({
                    patient: selection.patient!,
                    chain: selection.index.chain,
                    action,
                  });
                  setSelection(null);
                  setWriteNotice("");
                }
              : undefined
          }
          onEdit={
            writeEnabled && selection.patient && source.results
              ? (revision, at, existing) => {
                  setEditing({
                    target: {
                      patient: selection.patient!,
                      chainId: selection.index.chain.id,
                      revision,
                      at,
                      zone,
                      existing,
                      chain: selection.index.chain,
                    },
                    chain: selection.index.chain,
                  });
                  setSelection(null);
                  setWriteNotice("");
                }
              : undefined
          }
        />
      )}
    </>
  );
}
function DataState({
  data,
  onRetry,
}: {
  data?: CardData;
  onRetry: () => void;
}) {
  if (!data || (data.phase === "queued" && !data.hasData))
    return (
      <p className="group-pending" role="status">
        В очереди загрузки…
      </p>
    );
  if (data.phase === "loading")
    return data.hasData ? (
      <p className="refresh-status">Обновление…</p>
    ) : (
      <Loader text="Загрузка назначений…" />
    );
  if (data.phase === "error")
    return (
      <>
        <ErrorBox message={data.error} />
        <button className="secondary small" onClick={onRetry}>
          Повторить
        </button>
      </>
    );
  return null;
}
