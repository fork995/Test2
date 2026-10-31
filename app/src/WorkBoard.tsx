import { memo, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  type Patient,
  type IndexedChain,
  type Revision,
  type Entry,
  STATUS,
  safeColor,
} from "./model";
import type { CardData } from "./store";
import type { Period } from "./period";
import {
  API_SCHEDULE_POLICY,
  DEMO_SCHEDULE_POLICY,
  buildPatientSchedule,
  currentHourStart,
  summaryForHour,
  type PatientSchedule,
} from "./scheduleEngine";
import { formatTime, formatDate, HOUR } from "./time";
import { workClinicalFields, clinicalTitle } from "./clinical";
import type { Selection } from "./Grid";
import { WindowedList } from "./WindowedList";
import { classifySchedule } from "./hourlySummary";
import { feedSlot, manualFeedResults } from "./generalFeedModel";
import { PatientPhoto } from "./PatientPhoto";
interface Row {
  key: string;
  index: IndexedChain;
  revision?: Revision;
  at: number | null;
  entry?: Entry;
  warnings: string[];
  scheduled?: boolean;
  entries?: Entry[];
  undefinedStatus?: boolean;
  patientName?: string;
}
interface Prepared {
  patient: Patient;
  data?: CardData;
  schedule: PatientSchedule;
}
const rowId = (row: Row) => row.key;
const WorkRow = memo(function WorkRow({
  row,
  zone,
  onSelect,
}: {
  row: Row;
  zone: string;
  onSelect: (s: Selection) => void;
}) {
  const clinical = useMemo(
    () => workClinicalFields(row.index.chain, row.revision),
    [row.index.chain, row.revision],
  );
  const warnings = [...row.warnings, ...clinical.warnings];
  const displayFields = clinical.fields.filter(
    (f) =>
      !["Доза из API", "Путь введения", "Скорость инфузии"].includes(f.label),
  );
  return (
    <button
      className="work-item"
      style={
        {
          "--prescription-color": safeColor(row.revision?.color || ""),
        } as CSSProperties
      }
      onClick={() =>
        onSelect({
          index: row.index,
          revision: row.revision,
          at: row.at ?? undefined,
          entries: row.entries ?? (row.entry ? [row.entry] : row.scheduled ? [] : undefined),
          scheduled: row.scheduled,
          warnings,
        })
      }
    >
      <span className="work-row-top">
        <time>{row.at === null ? "Уточнить" : formatTime(row.at, zone)}</time>
        <strong>{row.patientName ? `${row.patientName} · ` : ""}{clinicalTitle(row.index.chain, row.revision)}</strong>
        {warnings.length > 0 && (
          <span
            className="work-warning-icon"
            title="Требуется уточнение. Подробности в деталях."
            aria-label="Есть предупреждение, открыть детали"
          >
            ⚠
          </span>
        )}
      </span>
      {displayFields.length > 0 && (
        <span className="work-params">
          {displayFields.map((field) => (
            <span key={field.path}>
              {field.label === "Доза" || field.label === "Путь введения"
                ? field.value
                : `${field.label}: ${field.value}`}
            </span>
          ))}
        </span>
      )}
      {clinical.warnings.length > 0 && (
        <span className="work-instruction warning">{clinical.warnings[0]}</span>
      )}
      {row.revision?.instruction && (
        <span className="work-instruction">{row.revision.instruction}</span>
      )}
      {row.undefinedStatus && <span className="work-mark unknown">Статус не определён</span>}
      {row.scheduled && (
        <span className="work-mark">Запланировано, без отметки</span>
      )}
      {row.entry && !row.undefinedStatus && (
        <span
          className={`work-mark ${row.entry.result.status === "EXECUTED" ? "executed" : row.entry.result.status === "NOT_EXECUTED" ? "not-executed" : "unknown"}`}
        >
          <i
            aria-hidden="true"
            style={
              row.entry.result.color.trim()
                ? {
                    boxShadow: `inset 0 -3px 0 ${safeColor(row.entry.result.color)}`,
                  }
                : undefined
            }
          >
            {row.entry.result.status === "EXECUTED"
              ? "✓"
              : row.entry.result.status === "NOT_EXECUTED"
                ? "×"
                : "?"}
          </i>
          {STATUS[row.entry.result.status] || row.entry.result.status}
          {row.entry.result.comment ? ` · ${row.entry.result.comment}` : ""}
        </span>
      )}
    </button>
  );
});
export function WorkBoard({
  patients,
  snapshot,
  period,
  zone,
  now,
  category,
  demo,
  history,
  expanded,
  setExpanded,
  onSelect,
  onOpenPatient,
  onRetry,
  compact = false,
}: {
  patients: Patient[];
  snapshot: Map<string, CardData>;
  period: Period | null;
  zone: string;
  now: number;
  category: string;
  demo: boolean;
  history: boolean;
  expanded: Set<string>;
  setExpanded: (fn: (old: Set<string>) => Set<string>) => void;
  onSelect: (s: Selection) => void;
  onOpenPatient: (p: Patient) => void;
  onRetry: (card: string) => void;
  compact?: boolean;
}) {
  const policy = demo ? DEMO_SCHEDULE_POLICY : API_SCHEDULE_POLICY;
  const cache = useRef(
    new WeakMap<IndexedChain[], Map<string, PatientSchedule>>(),
  );
  const prepared = useMemo(
    () =>
      patients.map((patient) => {
        const data = snapshot.get(patient.cardId);
        const key = JSON.stringify([
          period?.key,
          period?.start,
          period?.end,
          zone,
          patient.treatmentStart,
          patient.sheets.map((s) => [s.start, s.end, s.source]),
          category,
          policy.id,
        ]);
        let schedule: PatientSchedule = {
          slots: [],
          tasks: [],
          issues: [],
          totalChains: 0,
          complete: false,
        };
        if (data?.hasData || data?.phase === "ready") {
          let entries = cache.current.get(data.indexes);
          if (!entries) {
            entries = new Map();
            cache.current.set(data.indexes, entries);
          }
          const found = entries.get(key);
          if (found) schedule = found;
          else {
            schedule = buildPatientSchedule(
              data.indexes,
              patient,
              period,
              policy,
              category,
              zone,
            );
            entries.set(key, schedule);
            while (entries.size > 4)
              entries.delete(entries.keys().next().value!);
          }
        }
        return { patient, data, schedule };
      }),
    [patients, snapshot, period, category, policy, zone],
  );
  const issues = prepared.reduce((sum, p) => sum + p.schedule.issues.length, 0),
    unloaded = prepared.filter(
      (p) => !p.data?.hasData && p.data?.phase !== "ready",
    ),
    stale = prepared.filter((p) => p.data?.phase === "error");
  const refreshing = prepared.filter(
    (p) => p.data?.hasData && ["queued", "loading"].includes(p.data.phase),
  );
  const incomplete =
    issues > 0 ||
    unloaded.length > 0 ||
    stale.length > 0 ||
    refreshing.length > 0 ||
    !period;
  const [laterOpen, setLaterOpen] = useState(false),
    [pastOpen, setPastOpen] = useState(false),
    [historyOpen, setHistoryOpen] = useState(new Set<string>()),
    [openHours, setOpenHours] = useState(new Set<number>());
  const [feedFilter, setFeedFilter] = useState<"all" | "required" | "missed">("all");
  const start = currentHourStart(now, zone);
  const bucketAt = (at: number) =>
    at < start
      ? "overdue"
      : at < start + HOUR
        ? "current"
        : at < start + 2 * HOUR
          ? "next"
          : "later";
  function toggle(key: string) {
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function patientRows(
    key: string,
    groups: { prepared: Prepared; rows: Row[] }[],
  ) {
    return groups.map(({ prepared: p, rows }) => {
      const expansion = `${key}:${p.patient.cardId}`,
        open = expanded.has(expansion);
      return (
        <section className="work-patient" key={p.patient.cardId}>
          <button
            className="work-patient-toggle"
            aria-expanded={open}
            aria-label={`${open ? "Свернуть" : "Раскрыть"} ${p.patient.name}, ${rows.length} назначений, ${key}`}
            onClick={() => toggle(expansion)}
          >
            <span className="work-patient-name">{p.patient.name}</span>
            <span className="work-patient-meta">
              {p.patient.weight ? `${p.patient.weight} кг` : ""}
              {p.patient.cage ? ` · ${p.patient.cage}` : ""}
            </span>
            <b className="work-count">{rows.length}</b>
            <span aria-hidden="true">{open ? "⌃" : "⌄"}</span>
          </button>
          {open && (
            <>
              <button
                className="quiet work-open-patient"
                onClick={() => onOpenPatient(p.patient)}
              >
                Открыть пациента ›
              </button>
              <WindowedList
                items={rows}
                id={rowId}
                render={(row) => (
                  <WorkRow
                    row={row}
                    zone={zone}
                    onSelect={(s) => onSelect({ ...s, patient: p.patient })}
                  />
                )}
              />
            </>
          )}
        </section>
      );
    });
  }
  function taskRows(
    bucket: "overdue" | "current" | "next" | "later",
    hour?: number,
  ) {
    return prepared
      .map((p) => ({
        prepared: p,
        rows: p.schedule.tasks
          .filter(
            (task) =>
              bucketAt(task.at) === bucket &&
              (hour === undefined ||
                (task.at >= hour && task.at < hour + HOUR)),
          )
          .map((task) => ({ ...task, warnings: [], scheduled: true })),
      }))
      .filter((p) => p.rows.length);
  }
  function count(groups: { rows: Row[] }[]) {
    return groups.reduce((sum, p) => sum + p.rows.length, 0);
  }
  const hourDone = (at: number) =>
    !unloaded.length &&
    !stale.length &&
    !refreshing.length &&
    !!period &&
    prepared.reduce(
      (sum, p) => sum + summaryForHour(p.schedule, at, now, zone).scheduled,
      0,
    ) > 0 &&
    prepared.every(
      (p) => summaryForHour(p.schedule, at, now, zone).unmarked === 0,
    );
  const current = taskRows("current"),
    next = taskRows("next"),
    overdue = taskRows("overdue");
  const laterHours = [
    ...new Set(
      prepared.flatMap((p) =>
        p.schedule.tasks
          .filter((t) => bucketAt(t.at) === "later")
          .map((t) => currentHourStart(t.at, zone)),
      ),
    ),
  ].sort((a, b) => a - b);
  const historyGroups = useMemo(() => {
    const map = new Map<number, { prepared: Prepared; rows: Row[] }[]>();
    if (!history || !period) return map;
    for (const p of prepared) {
      const byHour = new Map<number, Row[]>();
      for (const index of p.data?.indexes ?? []) {
        if (category !== "ALL" && index.chain.type !== category) continue;
        for (const entry of index.entries) {
          if (
            entry.result.at! < period.start ||
            entry.result.at! >= period.end ||
            (!compact && !["EXECUTED", "NOT_EXECUTED"].includes(entry.result.status) &&
              classifySchedule(entry.revision) !== "MANUAL_AS_NEEDED")
          )
            continue;
          const hour = currentHourStart(entry.result.at!, zone);
          const bucket = byHour.get(hour) ?? [];
          bucket.push({
            key: `${index.chain.id}:${entry.revision.id}:${entry.result.id}:${entry.result.at}`,
            index,
            revision: entry.revision,
            entry,
            at: entry.result.at,
            warnings: [],
          });
          byHour.set(hour, bucket);
        }
      }
      for (const [hour, rows] of byHour) {
        rows.sort((a, b) => a.at! - b.at!);
        map.set(hour, [...(map.get(hour) ?? []), { prepared: p, rows }]);
      }
    }
    return map;
  }, [history, period, prepared, category, zone, compact]);
  const allSlots = prepared.flatMap(p => p.schedule.slots.map(slot => ({ ...feedSlot(slot), patient: p.patient })));
  const manualUnknown = period ? prepared.flatMap(p => (p.data?.indexes ?? [])
    .filter(index => category === "ALL" || index.chain.type === category)
    .flatMap(index => manualFeedResults(index, period.start, period.end))
    .filter(item => item.state === "unknown")
    .map(item => ({ slot: item, entries: item.entries, state: item.state, patient: p.patient }))) : [];
  const working = [...allSlots.filter(item => item.state === "unmarked" || item.state === "unknown"), ...manualUnknown];
  const missedCount = working.filter(item => item.state === "unmarked" && bucketAt(item.slot.at) === "overdue").length;
  const uncertainPast = working.filter(item => item.state === "unknown" && bucketAt(item.slot.at) === "overdue").length;
  const displayed = working.filter(item => feedFilter === "all" || (item.state === "unmarked" && (feedFilter === "required" || bucketAt(item.slot.at) === "overdue")));
  function compactItems(bucket: "overdue" | "current" | "next" | "later", hour?: number) {
    return displayed.filter(item => bucketAt(item.slot.at) === bucket && (hour === undefined || currentHourStart(item.slot.at, zone) === hour)).sort((a,b) => a.slot.at - b.slot.at);
  }
  function compactRows(bucket: "overdue" | "current" | "next" | "later", hour?: number) {
    const groups = new Map<string, { patient: Patient; rows: Row[] }>();
    for (const item of compactItems(bucket, hour)) {
      const id = JSON.stringify([item.patient.id, item.patient.cardId]);
      const group = groups.get(id) ?? { patient: item.patient, rows: [] };
      group.rows.push({ ...item.slot, at: item.slot.at, warnings: [], scheduled: item.state === "unmarked", undefinedStatus: item.state === "unknown", entries: item.entries });
      groups.set(id, group);
    }
    return [...groups].map(([id, group]) => {
      const key = `compact:${bucket}:${hour ?? "all"}:${id}`;
      const open = expanded.has(key);
      return <section className="compact-feed-patient" key={key}>
        <button type="button" className="compact-feed-patient-toggle" aria-expanded={open} aria-label={`${open ? "Свернуть" : "Раскрыть"} ${group.patient.name}, ${group.rows.length} назначений`} onClick={() => toggle(key)}>
          <PatientPhoto patient={group.patient} demo={demo} animalFallback />
          <strong>{group.patient.name}</strong><span className="compact-feed-patient-count">{group.rows.length}</span><span aria-hidden="true">{open ? "⌃" : "⌄"}</span>
        </button>
        {open && <WindowedList items={group.rows} id={rowId} render={row => <WorkRow row={row} zone={zone} onSelect={selection => onSelect({ ...selection, patient: group.patient })} />}/>} 
      </section>;
    });
  }
  const compactLaterHours = [...new Set(displayed.filter(item => bucketAt(item.slot.at) === "later").map(item => currentHourStart(item.slot.at, zone)))].sort((a,b) => a-b);
  const compactPastCount = displayed.filter(item => bucketAt(item.slot.at) === "overdue").length;
  return (
    <div className="work-board">
      {incomplete && (
        <p className="schedule-alert" role="status">
          Рабочий список неполон
          {issues ? ` · расписание требует уточнения: ${issues}` : ""}
          {unloaded.length
            ? ` · загружается пациентов: ${unloaded.length}`
            : ""}
          {stale.length ? ` · ошибок обновления: ${stale.length}` : ""}
          {refreshing.length ? " · обновляются ранее полученные данные" : ""}.
        </p>
      )}
      {compact && !history ? <>
        <nav className="compact-feed-filters" aria-label="Фильтр заданий">{([["all", "Все", working.length], ["required", "Требуют", working.filter(x => x.state === "unmarked").length], ["missed", "Пропущенные", missedCount]] as const).map(([value,label,total]) => <button key={value} className={feedFilter === value ? "active" : ""} aria-pressed={feedFilter === value} onClick={() => setFeedFilter(value)}>{label} · {total}</button>)}</nav>
        <section className="time-block past-block"><button className="time-toggle" aria-expanded={pastOpen} onClick={() => setPastOpen(v=>!v)}>⚠ Пропущенные <span>{missedCount}{feedFilter === "all" && uncertainPast ? ` · не определено: ${uncertainPast}` : ""} {pastOpen ? "⌃" : "⌄"}</span></button>{pastOpen && (compactPastCount ? compactRows("overdue") : <p className="work-empty">Нет назначений.</p>)}</section>
        {feedFilter !== "missed" && <><section className="time-block current-block"><h2>Сейчас · {formatTime(start,zone)} <span data-status={hourDone(start) ? "done" : "planned"}>{compactItems("current").length}</span></h2>{compactRows("current")}{!compactItems("current").length && hourDone(start) && <p className="work-empty">Все рассчитанные назначения имеют отметку.</p>}</section><section className="time-block next-block"><h2>Следующий час · {formatTime(start + HOUR,zone)} <span data-status={hourDone(start + HOUR) ? "done" : "planned"}>{compactItems("next").length}</span></h2>{compactRows("next")}{!compactItems("next").length && hourDone(start + HOUR) && <p className="work-empty">Все рассчитанные назначения имеют отметку.</p>}</section><section className="time-block later-block"><button className="time-toggle" aria-expanded={laterOpen} onClick={() => setLaterOpen(v=>!v)}>Позже в смене <span>{compactItems("later").length} {laterOpen ? "⌃" : "⌄"}</span></button>{laterOpen && compactLaterHours.map(hour => <div key={hour}><h3>{formatDate(hour,zone)} · {formatTime(hour,zone)}</h3>{compactRows("later",hour)}</div>)}</section></>}
      </> : history ? (
        <section className="work-history">
          <h2>История отметок</h2>
          {[...historyGroups]
            .sort(([a], [b]) => b - a)
            .map(([hour, groups]) => (
              <section key={hour} className="time-block">
                <button
                  className="time-toggle"
                  aria-expanded={historyOpen.has(String(hour))}
                  onClick={() =>
                    setHistoryOpen((old) => {
                      const value = new Set(old);
                      if (value.has(String(hour))) value.delete(String(hour));
                      else value.add(String(hour));
                      return value;
                    })
                  }
                >
                  {formatDate(hour, zone)} · {formatTime(hour, zone)}{" "}
                  <span>{count(groups)}</span>
                </button>
                {historyOpen.has(String(hour)) &&
                  patientRows(`history:${hour}`, groups)}
              </section>
            ))}
          {!historyGroups.size && (
            <p className="work-empty">
              За выбранный интервал отметок не найдено.
            </p>
          )}
        </section>
      ) : (
        <>
          {overdue.length > 0 && (
            <section className="time-block past-block">
              <button
                className="time-toggle"
                aria-expanded={pastOpen}
                onClick={() => setPastOpen((v) => !v)}
              >
                Просроченные · прошедшие часы{" "}
                <span>
                  {count(overdue)} {pastOpen ? "⌃" : "⌄"}
                </span>
              </button>
              {pastOpen && patientRows("overdue", overdue)}
            </section>
          )}
          <section className="time-block current-block">
            <h2>
              Текущий час <time>{formatTime(start, zone)}</time>
              <span data-status={hourDone(start) ? "done" : "planned"}>
                {hourDone(start) ? "✓" : count(current)}
              </span>
            </h2>
            {current.length ? (
              patientRows("current", current)
            ) : (
              <p className="work-empty">
                {hourDone(start)
                  ? "Все рассчитанные назначения имеют отметку"
                  : "Подтверждённых заданий нет"}
                {incomplete ? " · см. уточнения" : ""}.
              </p>
            )}
          </section>
          <section className="time-block next-block">
            <h2>
              Следующий час <time>{formatTime(start + HOUR, zone)}</time>
              <span data-status={hourDone(start + HOUR) ? "done" : "planned"}>
                {hourDone(start + HOUR) ? "✓" : count(next)}
              </span>
            </h2>
            {next.length ? (
              patientRows("next", next)
            ) : (
              <p className="work-empty">
                {hourDone(start + HOUR)
                  ? "Все рассчитанные назначения имеют отметку"
                  : "Подтверждённых заданий нет"}
                {incomplete ? " · см. уточнения" : ""}.
              </p>
            )}
          </section>
          <section className="time-block later-block">
            <button
              className="time-toggle"
              aria-expanded={laterOpen}
              onClick={() => setLaterOpen((v) => !v)}
            >
              Остаток смены{" "}
              <span>
                {count(taskRows("later"))} {laterOpen ? "⌃" : "⌄"}
              </span>
            </button>
            {laterOpen &&
              (laterHours.length ? (
                laterHours.map((hour) => (
                  <details
                    className="later-hour"
                    key={hour}
                    open={openHours.has(hour)}
                    onToggle={(e) => {
                      const isOpen = e.currentTarget.open;
                      setOpenHours((old) => {
                        const value = new Set(old);
                        if (isOpen) value.add(hour);
                        else value.delete(hour);
                        return value;
                      });
                    }}
                  >
                    <summary>
                      {formatDate(hour, zone).slice(0, 6)} ·{" "}
                      {formatTime(hour, zone)} —{" "}
                      {count(taskRows("later", hour))}
                    </summary>
                    {openHours.has(hour) && (
                      <div>
                        {patientRows(`later:${hour}`, taskRows("later", hour))}
                      </div>
                    )}
                  </details>
                ))
              ) : (
                <p className="work-empty">Подтверждённых заданий нет.</p>
              ))}
          </section>
        </>
      )}
      {issues > 0 && (
        <section
          className={`schedule-clarification ${issues ? "has-issues" : ""}`}
          aria-label="Расписание требует уточнения"
        >
          <h2>
            Расписание требует уточнения <span>{issues}</span>
          </h2>
          {issues > 0 ? (
            patientRows(
              "unclear",
              prepared
                .map((p) => ({
                  prepared: p,
                  rows: p.schedule.issues.map((issue) => ({
                    key: issue.key,
                    index: issue.index,
                    revision: issue.revision,
                    at: null,
                    warnings: issue.reasons,
                  })),
                }))
                .filter((p) => p.rows.length),
            )
          ) : (
            <p className="work-empty">
              {unloaded.length
                ? "Проверка ещё не завершена."
                : "Неподтверждённых назначений в текущем фильтре нет."}
            </p>
          )}
        </section>
      )}
      {unloaded.length > 0 && (
        <section className="work-unloaded">
          <h2>Данные пациентов</h2>
          {unloaded.map((p) => (
            <div className="work-load-row" key={p.patient.cardId}>
              <button
                className="quiet"
                onClick={() => onOpenPatient(p.patient)}
              >
                {p.patient.name}
              </button>
              <span>
                {p.data?.phase === "error" ? "Ошибка загрузки" : "Загрузка…"}
              </span>
              {p.data?.phase === "error" && (
                <button
                  className="secondary small"
                  onClick={() => onRetry(p.patient.cardId)}
                >
                  Повторить
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {!history &&
        prepared
          .filter(
            (p) =>
              p.data?.hasData &&
              p.schedule.complete &&
              p.schedule.tasks.length === 0,
          )
          .map((p) => (
            <div key={p.patient.cardId} className="work-idle-patient">
              <button
                className="quiet"
                onClick={() => onOpenPatient(p.patient)}
              >
                {p.patient.name}
              </button>
              <span>0 открытых подтверждённых заданий</span>
            </div>
          ))}
    </div>
  );
}
