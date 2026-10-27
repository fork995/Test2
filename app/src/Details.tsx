import { deletionProblem, type PrescriptionAction } from "./prescriptions";
import { useEffect, useRef } from "react";
import {
  LABELS,
  STATUS,
  REASONS,
  parameters,
  safeColor,
  instant,
  type Revision,
  type Entry,
  type Result,
  lastKnownRevision,
} from "./model";
import { cellWriteProblem, type ResultTarget } from "./resultWriter";
import { enabledRevision } from "./cellAvailability";
import { hourStart, hasScheduledTaskOn } from "./hourlySummary";
import { formatStamp } from "./time";
import type { Selection } from "./Grid";
import { cellRevisions } from "./cellAppearance";
import { classifySchedule, MANUAL_AS_NEEDED_LABEL } from "./hourlySummary";
import { clinicalFields, workClinicalFields, clinicalTitle } from "./clinical";
export function Details({
  selection,
  zone,
  onClose,
  diagnostic = false,
  onEdit,
  onManage,
}: {
  selection: Selection;
  zone: string;
  onClose: () => void;
  diagnostic?: boolean;
  onEdit?: (revision: Revision, at: number, existing?: Result) => void;
  onManage?: (action: PrescriptionAction) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    { index, at, entries } = selection;
  useEffect(() => {
    const dialog = ref.current,
      previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  const revisions: Revision[] = selection.revision
    ? [selection.revision]
    : entries?.length
      ? [...new Set(entries.map((e) => e.revision))]
      : at !== undefined
        ? [
            ...new Set(
              [
                ...cellRevisions(index, at, zone),
                enabledRevision(index.chain, at, zone),
              ].filter((r): r is Revision => !!r),
            ),
          ]
        : [
            [...index.chain.elements]
              .filter(
                (r) =>
                  r.start !== null &&
                  r.start <= Date.now() &&
                  (r.end === null || Date.now() < r.end),
              )
              .sort((a, b) => b.start! - a.start!)[0] ??
              lastKnownRevision(index.chain) ??
              index.chain.elements.at(-1),
          ].filter((r): r is Revision => !!r);
  const orderedRevisions = [...revisions].sort(
    (a, b) =>
      (a.start ?? instant(a.created) ?? Infinity) -
      (b.start ?? instant(b.created) ?? Infinity),
  );
  function resultView(e: Entry) {
    const r = e.result;
    const interval = index.intervalByRevision.get(e.revision);
    const uncertain =
      diagnostic &&
      e.revision.start !== null &&
      classifySchedule(e.revision) !== "MANUAL_AS_NEEDED" &&
      (!interval ||
        interval.ambiguous ||
        r.at === null ||
        interval.start === null ||
        interval.end === null ||
        r.at < interval.start ||
        r.at >= interval.end);
    return (
      <article
        key={`${e.revision.id}-${r.id}`}
        className="result-detail"
        style={{ borderColor: safeColor(e.revision.color) }}
      >
        <h3>
          {r.color.trim() && (
            <i
              className="swatch result-color-swatch"
              aria-label="Индивидуальная подкраска отметки"
              title="Подкраска этой отметки"
              style={{ background: safeColor(r.color) }}
            />
          )}
          {STATUS[r.status] || r.status || "Статус не указан"}
        </h3>
        {diagnostic && (
          <p className="micro">API status: {r.status || "не указан"}</p>
        )}
        {uncertain && (
          <p className="micro warning">
            Принадлежность результата действующему интервалу редакции не
            подтверждена.
          </p>
        )}
        <dl>
          <dt>Время отметки</dt>
          <dd>{formatStamp(r.at, zone)}</dd>
          <dt>Запись создана</dt>
          <dd>{formatStamp(instant(r.created), zone)}</dd>
          {r.reason && (
            <>
              <dt>Причина</dt>
              <dd>
                {REASONS[r.reason] || r.reason}
                {diagnostic && REASONS[r.reason] ? ` · ${r.reason}` : ""}
              </dd>
            </>
          )}
          {r.comment && (
            <>
              <dt>Комментарий</dt>
              <dd className="pre-wrap">{r.comment}</dd>
            </>
          )}
        </dl>
        {onEdit && r.at !== null && selection.patient && (
          <button
            className="secondary small"
            disabled={
              !!cellWriteProblem({
                patient: selection.patient,
                chainId: index.chain.id,
                revision: e.revision,
                at: r.at,
                zone,
                existing: r,
                chain: index.chain,
              })
            }
            onClick={() => onEdit(e.revision, r.at!, r)}
          >
            Изменить отметку
          </button>
        )}
        {diagnostic && (
          <p className="micro">
            Цвет результата: {r.color || "не указан"}; hour: {r.hour}
          </p>
        )}
      </article>
    );
  }
  return (
    <dialog
      ref={ref}
      className="bottom-sheet appointment-details"
      aria-labelledby="detail-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet-handle" />
      <header className="sheet-header">
        <div>
          <p className="eyebrow">
            {LABELS[index.chain.type] || index.chain.type}
          </p>
          <h2 id="detail-title">
            {clinicalTitle(
              index.chain,
              orderedRevisions.length === 1 ? orderedRevisions[0] : undefined,
            )}
          </h2>
        </div>
        <button
          className="icon-button"
          aria-label="Закрыть детали"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {onManage && (
        <details className="prescription-actions">
          <summary>Действия с назначением</summary>
          <button
            className="secondary small"
            disabled={
              index.chain.elements.at(-1)?.start == null ||
              index.chain.elements.at(-1)?.end !== null
            }
            onClick={() => onManage("revise")}
          >
            Изменить параметры
          </button>
          <button
            className="secondary small"
            disabled={
              index.chain.elements.at(-1)?.start == null ||
              index.chain.elements.at(-1)?.end !== null
            }
            onClick={() => onManage("finish")}
          >
            Завершить действие
          </button>
          {index.chain.elements.length > 1 && (
            <button
              className="secondary small"
              disabled={!!deletionProblem(index.chain, true)}
              onClick={() => onManage("deleteRevision")}
            >
              Удалить последнюю редакцию
            </button>
          )}
          <button
            className="quiet small danger-text"
            disabled={!!deletionProblem(index.chain)}
            onClick={() => onManage("deleteChain")}
          >
            Удалить назначение
          </button>
          {deletionProblem(index.chain) && (
            <p className="micro">
              Назначение с отметками нельзя удалить целиком. История сохранится
              при завершении действия.
            </p>
          )}
        </details>
      )}
      {!diagnostic && !!selection.warnings?.length && entries === undefined && (
        <p className="notice">
          Расписание требует уточнения. Проверьте назначение в CleverVet.
        </p>
      )}
      {diagnostic && selection.warnings?.length ? (
        <p className="notice">{selection.warnings.join(" ")}</p>
      ) : null}
      {at !== undefined && (
        <p className="muted">Время: {formatStamp(at, zone)}</p>
      )}
      {entries !== undefined && entries.length === 0 && (
        <p className="micro">
          {selection.scheduled
            ? "Запланировано, без отметки"
            : "Отметки для этой ячейки нет"}
        </p>
      )}
      {entries?.map(resultView)}
      {onEdit &&
        selection.patient &&
        index.chain.elements.map((revision) => {
          const asNeeded = classifySchedule(revision) === "MANUAL_AS_NEEDED";
          const time =
            at ??
            (asNeeded
              ? Math.floor(Date.now() / 60000) * 60000
              : hourStart(Date.now(), zone));
          const manual = !hasScheduledTaskOn(revision, time, zone);
          const target: ResultTarget = {
            patient: selection.patient!,
            chainId: index.chain.id,
            revision,
            at: time,
            zone,
            chain: index.chain,
          };
          if (
            cellWriteProblem(target) ||
            (entries?.length ?? 0) > 0 ||
            revision.results.some((r) => r.at === time)
          )
            return null;
          return (
            <button
              key={revision.id}
              className="primary full add-result"
              onClick={() => onEdit(revision, time)}
            >
              {manual
                ? "Добавить событие по необходимости"
                : "Отметить выполнение"}
              {index.chain.elements.filter((r) => r.start !== null).length > 1
                ? ` · ${formatStamp(revision.start, zone)}`
                : ""}
            </button>
          );
        })}
      {orderedRevisions.map((revision, i) => {
        const manual = classifySchedule(revision) === "MANUAL_AS_NEEDED",
          fields = clinicalFields(index.chain, revision),
          warnings = workClinicalFields(index.chain, revision).warnings;
        return (
          <section key={revision.id} className="revision-detail">
            <h3>
              <i
                className="swatch"
                style={{ background: safeColor(revision.color) }}
              />
              {diagnostic
                ? `Редакция ${revision.id}`
                : orderedRevisions.length > 1
                  ? `Назначение ${i + 1}`
                  : "Назначение"}
            </h3>
            {manual && <p className="micro">{MANUAL_AS_NEEDED_LABEL}</p>}
            {warnings.length > 0 && (
              <p className="micro warning">{warnings.join(" · ")}</p>
            )}
            <dl>
              {fields.map((f) => (
                <div key={f.path}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
              <dt>Начало</dt>
              <dd>
                {revision.start === null
                  ? "Не задано · редакция неактивна"
                  : formatStamp(revision.start, zone)}
              </dd>
              {revision.end !== null && (
                <>
                  <dt>Окончание</dt>
                  <dd>{formatStamp(revision.end, zone)}</dd>
                </>
              )}
              {revision.instruction && (
                <>
                  <dt>Инструкция</dt>
                  <dd className="pre-wrap">{revision.instruction}</dd>
                </>
              )}
            </dl>
            {diagnostic && (
              <details>
                <summary>Диагностика и исходные параметры</summary>
                <dl>
                  <dt>prescription ID</dt>
                  <dd>{revision.id}</dd>
                  <dt>parentId</dt>
                  <dd>{revision.parentId || "—"}</dd>
                  <dt>dates.periodicity</dt>
                  <dd>
                    {revision.periodicity === null
                      ? "null"
                      : String(revision.periodicity)}
                  </dd>
                  <dt>Цвет редакции</dt>
                  <dd>{revision.color || "не указан"}</dd>
                  <dt>Создана</dt>
                  <dd>{formatStamp(instant(revision.created), zone)}</dd>
                  {parameters(revision.specifics).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </section>
        );
      })}
      {index.unplaced.length > 0 && (
        <details>
          <summary>
            Отметки без точного времени ({index.unplaced.length})
          </summary>
          {index.unplaced.slice(0, 100).map(resultView)}
        </details>
      )}
      <button className="secondary full" onClick={onClose}>
        Закрыть
      </button>
    </dialog>
  );
}
