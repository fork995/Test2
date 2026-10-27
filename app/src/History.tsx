import { useMemo, useState } from "react";
import {
  instant,
  parameters,
  safeColor,
  type IndexedChain,
  type RevisionInterval,
} from "./model";
import { clinicalFields } from "./clinical";
import { formatStamp } from "./time";
import { Pager } from "./ui";
import { classifySchedule, MANUAL_AS_NEEDED_LABEL } from "./hourlySummary";
function HistoryRevision({
  interval,
  index,
  zone,
  diagnostic,
}: {
  interval: RevisionInterval;
  index: IndexedChain;
  zone: string;
  diagnostic: boolean;
}) {
  const [open, setOpen] = useState(false),
    revision = interval.revision;
  const manual = classifySchedule(revision) === "MANUAL_AS_NEEDED";
  return (
    <details
      className="history-revision"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        {diagnostic ? revision.id : "Изменение от"} ·{" "}
        {interval.start === null
          ? "Не задано · редакция неактивна"
          : formatStamp(interval.start, zone)}
      </summary>
      {open && (
        <>
          {manual && <p className="micro">{MANUAL_AS_NEEDED_LABEL}</p>}
          <dl>
            <dt>Начало</dt>
            <dd>
              {interval.start === null
                ? "Не задано · редакция неактивна"
                : formatStamp(interval.start, zone)}
            </dd>
            <dt>Окончание</dt>
            <dd>
              {interval.end === null
                ? "Не подтверждено"
                : formatStamp(interval.end, zone)}
              {interval.inferred
                ? " · по единственному дочернему элементу"
                : ""}
            </dd>
            {diagnostic && (
              <>
                <dt>Предыдущая редакция</dt>
                <dd>{revision.parentId || "Не указана"}</dd>
              </>
            )}
            <dt>Запись редакции создана</dt>
            <dd>{formatStamp(instant(revision.created), zone)}</dd>
            <dt>Цвет редакции</dt>
            <dd>
              <i
                className="swatch"
                style={{ background: safeColor(revision.color) }}
              />
              {revision.color || "Не указан"}
            </dd>
            {revision.instruction && (
              <>
                <dt>Инструкция</dt>
                <dd className="pre-wrap">{revision.instruction}</dd>
              </>
            )}
            {clinicalFields(index.chain, revision).map((f) => (
              <div key={f.path}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
          {diagnostic &&
            interval.start !== null &&
            !manual &&
            interval.ambiguous && (
              <p className="notice micro">
                Интервал или последовательность неоднозначны.
              </p>
            )}
          {diagnostic && parameters(revision.specifics).length > 0 && (
            <>
              <p className="micro">Исходные параметры этой редакции:</p>
              <dl>
                {parameters(revision.specifics).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </>
      )}
    </details>
  );
}
export function History({
  index,
  zone,
  initialOpen = false,
  diagnostic = false,
}: {
  index: IndexedChain;
  zone: string;
  initialOpen?: boolean;
  diagnostic?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen),
    [page, setPage] = useState(0);
  const intervals = useMemo(
    () =>
      [...index.intervals].sort(
        (a, b) =>
          (a.start ?? instant(a.revision.created) ?? Infinity) -
          (b.start ?? instant(b.revision.created) ?? Infinity),
      ),
    [index],
  );
  return (
    <details
      className="revision-history"
      open={open}
      aria-label="История редакций"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Вся история редакций ({intervals.length})</summary>
      {open && (
        <>
          <p className="micro">
            Редакции показаны как история, а не одновременно действующие
            назначения. Откройте редакцию для её исходных доз, параметров и
            инструкции.
          </p>
          {intervals.slice(page * 20, (page + 1) * 20).map((interval, i) => (
            <HistoryRevision
              key={`${interval.revision.id}-${page * 20 + i}`}
              interval={interval}
              index={index}
              zone={zone}
              diagnostic={diagnostic}
            />
          ))}
          <Pager
            page={page}
            count={intervals.length}
            size={20}
            onChange={setPage}
            label="Страницы истории редакций"
          />
        </>
      )}
    </details>
  );
}
