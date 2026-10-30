import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  entriesInRange,
  safeColor,
  STATUS,
  lastKnownRevision,
  type IndexedChain,
  type Entry,
  type Revision,
} from "./model";
import { clinicalParameters } from "./clinical";
import { cellRevisions, cellFill } from "./cellAppearance";
import { HOUR, hours, formatTime, formatDate } from "./time";
export interface Selection {
  index: IndexedChain;
  patient?: import("./model").Patient;
  revision?: Revision;
  warnings?: string[];
  scheduled?: boolean;
  at?: number;
  entries?: Entry[];
}
export const GRID_ROW = 52,
  GRID_HOUR = 56,
  GRID_HEADER = 40;
const ROW = GRID_ROW;
const GridRow = memo(function GridRow({
  index,
  ticks,
  end,
  zone,
  now,
  onSelect,
  position,
  fromColumn,
  toColumn,
}: {
  index: IndexedChain;
  ticks: number[];
  end: number;
  zone: string;
  now: number;
  onSelect: (s: Selection) => void;
  position: number;
  fromColumn: number;
  toColumn: number;
}) {
  const buckets = useMemo(() => {
    const map = new Map<number, Entry[]>();
    if (!ticks.length) return map;
    entriesInRange(index, ticks[0], end).forEach((e) => {
      const bucket = Math.floor((e.result.at! - ticks[0]) / HOUR);
      map.set(bucket, [...(map.get(bucket) || []), e]);
    });
    return map;
  }, [index, ticks, end]);
  const last = lastKnownRevision(index.chain);
  const summary = useMemo(() => {
    const relevant = [
      ...new Set(
        ticks.flatMap((at, i) =>
          cellRevisions(index, at, zone, buckets.get(i) ?? []),
        ),
      ),
    ];
    const revisions = relevant.length
      ? relevant
      : last
        ? [last]
        : index.chain.elements.slice(-1);
    const byId = new Map(
      revisions.map((r) => [r.id, clinicalParameters(index.chain, r)]),
    );
    const distinct = [...new Set(byId.values())];
    return {
      byId,
      shared: distinct.length === 1 ? distinct[0] : "",
      varied: distinct.length > 1,
    };
  }, [index, ticks, zone, buckets, last]);
  return (
    <div
      className="grid-row"
      role="row"
      aria-rowindex={position + 2}
      style={{ top: position * ROW }}
    >
      <button
        role="rowheader"
        className="name-cell"
        title={[
          index.chain.name,
          summary.shared,
          index.unplaced.length ? `${index.unplaced.length} вне сетки` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
        onClick={() => onSelect({ index })}
        style={
          { "--revision-color": safeColor(last?.color || "") } as CSSProperties
        }
      >
        <span className="chain-name">{index.chain.name}</span>
        {(summary.shared || summary.varied) && (
          <span className="grid-clinical">
            {summary.varied
              ? "Дозировка менялась · см. ячейки"
              : summary.shared}
          </span>
        )}
        {index.unplaced.length > 0 && (
          <span className="micro">{index.unplaced.length} вне сетки</span>
        )}
      </button>
      {ticks.slice(fromColumn, toColumn).map((at, offset) => {
        const i = fromColumn + offset;
        const entries = buckets.get(i) || [],
          executed = entries.every((e) => e.result.status === "EXECUTED"),
          missed = entries.some((e) => e.result.status === "NOT_EXECUTED");
        const revisions = cellRevisions(index, at, zone, entries);
        const parameters = [
          ...new Set(
            revisions
              .map(
                (r) =>
                  summary.byId.get(r.id) ?? clinicalParameters(index.chain, r),
              )
              .filter(Boolean),
          ),
        ].join(" / ");
        return (
          <button
            key={at}
            role="cell"
            className={`hour-cell ${now >= at && now < Math.min(at + HOUR, end) ? "current" : ""} ${entries.length ? (missed ? "missed" : executed ? "done" : "unknown") : ""}`}
            style={
              {
                gridColumn: i + 2,
                "--cell-fill": cellFill(revisions, entries),
              } as CSSProperties
            }
            onClick={() => onSelect({ index, at, entries })}
            title={parameters || index.chain.name}
            aria-label={`${index.chain.name}${parameters ? ` · ${parameters}` : ""}, ${formatTime(at, zone)}: ${entries.length ? entries.map((e) => STATUS[e.result.status] || e.result.status || "Статус неизвестен").join(", ") : "Нет достоверного результата"}`}
          >
            <span className="cell-status" aria-hidden="true">
              {entries.length
                ? entries.length > 1
                  ? entries.length
                  : missed
                    ? "×"
                    : executed
                      ? "✓"
                      : "?"
                : "—"}
            </span>
            {summary.varied && parameters && (
              <span className="grid-cell-clinical">{parameters}</span>
            )}
            {entries.length > 1 && <small>рез.</small>}
          </button>
        );
      })}
    </div>
  );
});
export function Grid({
  indexes,
  start,
  end,
  zone,
  now,
  onSelect,
}: {
  indexes: IndexedChain[];
  start: number;
  end: number;
  zone: string;
  now: number;
  onSelect: (s: Selection) => void;
}) {
  const ticks = useMemo(() => hours(start, end), [start, end]);
  const [viewport, setViewport] = useState({
    row: 0,
    count: 12,
    column: 0,
    columns: 10,
    nameWidth: 110,
  });
  const container = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const initialHour = useRef(now);
  useEffect(() => {
    const el = container.current;
    if (!el || !ticks.length) return;
    const column = Math.max(0, Math.min(ticks.length - 1, Math.floor((initialHour.current - ticks[0]) / HOUR)));
    el.scrollLeft = Math.max(0, (column - 1) * GRID_HOUR);
    setViewport((v) => ({ ...v, column: Math.floor(el.scrollLeft / GRID_HOUR) }));
  }, []);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let x = 0, y = 0, origin = 0, direction = "";
    const startTouch = (e: TouchEvent) => {
      if (e.touches.length !== 1) { direction = "cancel"; return; }
      x = e.touches[0].clientX; y = e.touches[0].clientY;
      origin = el.scrollLeft; direction = "";
    };
    const moveTouch = (e: TouchEvent) => {
      if (e.touches.length !== 1 || direction === "cancel") return;
      const dx = e.touches[0].clientX - x, dy = e.touches[0].clientY - y;
      if (!direction && Math.max(Math.abs(dx), Math.abs(dy)) > 8)
        direction = Math.abs(dx) > Math.abs(dy) * 1.2 ? "horizontal" : "vertical";
      if (direction === "horizontal" && e.cancelable) {
        e.preventDefault();
        el.scrollLeft = origin - dx * 0.7;
      }
    };
    el.addEventListener("touchstart", startTouch, { passive: true });
    el.addEventListener("touchmove", moveTouch, { passive: false });
    return () => { el.removeEventListener("touchstart", startTouch); el.removeEventListener("touchmove", moveTouch); };
  }, []);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const resize = () =>
      setViewport((v) => ({
        ...v,
        nameWidth: Math.min(
          115,
          Math.max(105, Math.round(el.clientWidth * 0.3) || 110),
        ),
        count: Math.ceil(el.clientHeight / ROW) || 12,
        columns: Math.max(
          3,
          Math.ceil(((el.clientWidth || 375) - v.nameWidth) / GRID_HOUR) + 4,
        ),
      }));
    resize();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(el);
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);
  // Fixed row height keeps the mounted cells bounded even with hundreds of chains.
  const first = Math.max(0, viewport.row - 3),
    last = Math.min(indexes.length, viewport.row + viewport.count + 3);
  const width = viewport.nameWidth + ticks.length * GRID_HOUR;
  const fromColumn = Math.max(0, viewport.column - 2),
    toColumn = Math.min(ticks.length, viewport.column + viewport.columns);
  return (
    <div className={`grid-frame${expanded ? " grid-frame-expanded" : ""}`}>
      <div className="grid-toolbar"><button type="button" className="grid-expand" aria-label={expanded ? "Свернуть сетку" : "Расширить сетку"} onClick={() => setExpanded((v) => !v)}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{expanded ? <path d="M4 9h5V4M20 15h-5v5M9 9 3 3M15 15l6 6"/> : <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>}</svg></button></div>
    <div
      ref={container}
      className="grid-scroll"
      tabIndex={0}
      aria-label="Сетка результатов: прокрутка по часам и назначениям"
      onScroll={(e) => {
        const el = e.currentTarget;
        const row = Math.max(0, Math.floor((el.scrollTop - GRID_HEADER) / ROW)),
          count = Math.ceil(el.clientHeight / ROW) || 12,
          column = Math.max(0, Math.floor(el.scrollLeft / GRID_HOUR)),
          columns = Math.max(
            3,
            Math.ceil(
              ((el.clientWidth || 375) - viewport.nameWidth) / GRID_HOUR,
            ) + 4,
          );
        setViewport((v) =>
          v.row === row &&
          v.count === count &&
          v.column === column &&
          v.columns === columns
            ? v
            : { ...v, row, count, column, columns },
        );
      }}
    >
      <div
        role="table"
        aria-label="Результаты выполнения назначений"
        aria-rowcount={indexes.length + 1}
        aria-colcount={ticks.length + 1}
        style={
          {
            width,
            "--columns": `${viewport.nameWidth}px repeat(${ticks.length},${GRID_HOUR}px)`,
          } as CSSProperties
        }
      >
        <div role="row" className="grid-head">
          <div role="columnheader" className="name-head">
            Назначение
          </div>
          {ticks.slice(fromColumn, toColumn).map((at, offset) => (
            <div
              role="columnheader"
              style={{ gridColumn: fromColumn + offset + 2 }}
              key={at}
              className={
                now >= at && now < Math.min(at + HOUR, end) ? "current" : ""
              }
            >
              <b>{formatTime(at, zone)}</b>
              <small>{formatDate(at, zone).slice(0, 6)}</small>
            </div>
          ))}
        </div>
        <div className="grid-body" style={{ height: indexes.length * ROW }}>
          {indexes.slice(first, last).map((index, i) => (
            <GridRow
              key={index.chain.id}
              index={index}
              position={first + i}
              ticks={ticks}
              end={end}
              zone={zone}
              now={now}
              onSelect={onSelect}
              fromColumn={fromColumn}
              toColumn={toColumn}
            />
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}
