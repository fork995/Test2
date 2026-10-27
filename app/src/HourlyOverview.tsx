import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Patient } from "./model";
import type { Period } from "./period";
import type { CardData } from "./store";
import { hourColumns } from "./hourlySummary";
import { summaryForHour, type PatientSchedule } from "./scheduleEngine";
import { formatTime, formatDate } from "./time";
import { GRID_ROW, GRID_HOUR, GRID_HEADER } from "./Grid";
interface Props {
  open: boolean;
  onToggle: (open: boolean) => void;
  patients: Patient[];
  schedules: Map<string, PatientSchedule>;
  snapshot: Map<string, CardData>;
  period: Period;
  zone: string;
  now: number;
  onPatient: (p: Patient) => void;
}
/** Displays existing schedule snapshots. No request, status mutation or new scheduling rules. */
export function HourlyOverview(props: Props) {
  return (
    <details
      className="hourly-overview"
      open={props.open}
      onToggle={(e) => props.onToggle(e.currentTarget.open)}
    >
      <summary>Почасовая сводка</summary>
      {props.open && (
        <>
          <p className="micro">
            Все категории. Красное число — без отметки за прошедший час. ✓ — все
            назначения этого часа отмечены.
          </p>
          <OverviewTable {...props} />
        </>
      )}
    </details>
  );
}
function OverviewTable({
  patients,
  schedules,
  snapshot,
  period,
  zone,
  now,
  onPatient,
}: Props) {
  const ref = useRef<HTMLDivElement>(null),
    [viewport, setViewport] = useState({
      row: 0,
      count: 8,
      column: 0,
      columns: 9,
    });
  const ticks = useMemo(() => hourColumns(period, zone), [period, zone]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = () =>
      setViewport((v) => ({
        ...v,
        count: Math.ceil((el.clientHeight || 320) / GRID_ROW),
        columns: Math.ceil(((el.clientWidth || 375) - 110) / GRID_HOUR) + 4,
      }));
    resize();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(el);
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);
  const first = Math.max(0, viewport.row - 3),
    last = Math.min(patients.length, viewport.row + viewport.count + 3),
    from = Math.max(0, viewport.column - 2),
    to = Math.min(ticks.length, viewport.column + viewport.columns);
  const columns = ticks.slice(from, to);
  return (
    <div
      ref={ref}
      className="overview-scroll"
      tabIndex={0}
      aria-label="Почасовая сводка пациентов: прокрутка"
      onScroll={(e) => {
        const el = e.currentTarget;
        setViewport((v) => ({
          ...v,
          row: Math.max(0, Math.floor((el.scrollTop - GRID_HEADER) / GRID_ROW)),
          column: Math.max(0, Math.floor(el.scrollLeft / GRID_HOUR)),
        }));
      }}
    >
      <div
        role="table"
        aria-label="Сводная таблица назначений"
        aria-rowcount={patients.length + 1}
        aria-colcount={ticks.length + 1}
        style={
          {
            width: 110 + ticks.length * GRID_HOUR,
            "--overview-columns": `110px repeat(${ticks.length},${GRID_HOUR}px)`,
          } as CSSProperties
        }
      >
        <div role="row" className="overview-head">
          <div role="columnheader" className="overview-name">
            Пациент
          </div>
          {columns.map((at, i) => (
            <div
              role="columnheader"
              key={at}
              style={{ gridColumn: from + i + 2 }}
            >
              <b>{formatTime(at, zone)}</b>
              <small>{formatDate(at, zone).slice(0, 6)}</small>
            </div>
          ))}
        </div>
        <div
          className="overview-body"
          style={{ height: patients.length * GRID_ROW }}
        >
          {patients.slice(first, last).map((patient, i) => {
            const schedule = schedules.get(patient.cardId),
              data = snapshot.get(patient.cardId),
              partial = data?.phase !== "ready" || !schedule?.complete;
            return (
              <div
                role="row"
                className="overview-row"
                key={patient.cardId}
                aria-rowindex={first + i + 2}
                style={{ top: (first + i) * GRID_ROW }}
              >
                <button
                  role="rowheader"
                  className="overview-name"
                  title={patient.name}
                  onClick={() => onPatient(patient)}
                >
                  {patient.name}
                </button>
                {columns.map((at, j) => {
                  const value = schedule
                    ? summaryForHour(schedule, at, now, zone)
                    : null;
                  const label =
                    value?.status === "done"
                      ? "Все назначения отмечены"
                      : value?.status === "nothing"
                        ? "Назначений нет"
                        : value?.status === "overdue"
                          ? `Просрочено: ${value.unmarked}`
                          : value
                            ? `Без отметки: ${value.unmarked}`
                            : "Загрузка";
                  return (
                    <button
                      role="cell"
                      className="overview-cell"
                      key={at}
                      style={{ gridColumn: from + j + 2 }}
                      data-status={value?.status ?? "loading"}
                      data-hour={at}
                      aria-label={`${patient.name}, ${formatTime(at, zone)}: ${label}${partial ? " · Данные неполные" : ""}`}
                      onClick={() => onPatient(patient)}
                    >
                      <span>
                        {!value
                          ? "…"
                          : value.status === "done"
                            ? "✓"
                            : value.status === "nothing"
                              ? "—"
                              : value.unmarked}
                      </span>
                      {value && partial && (
                        <small aria-label="Данные неполные">⚠</small>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
