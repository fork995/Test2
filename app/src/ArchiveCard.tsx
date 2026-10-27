import { useEffect, useMemo, useState } from "react";
import { ApiError } from "./api";
import { archiveError, type ArchiveApi } from "./archiveApi";
import type { ArchiveRecord } from "./archiveModel";
import {
  indexChains,
  normalizePatients,
  LABELS,
  STATUS,
  type Patient,
  type Chain,
  type Branch,
  type IndexedChain,
  type Entry,
} from "./model";
import type { Belonging } from "./belongings";
import { BELONGING_STATUSES } from "./belongings";
import { FINISH_LABELS } from "./finishResults";
import { PatientPhoto } from "./PatientPhoto";
import { SeverityBadge } from "./patientPresentation";
import { formatStamp } from "./time";
import { Grid, type Selection } from "./Grid";
import { Details } from "./Details";
import { clinicalTitle } from "./clinical";
import { ErrorBox, Loader, Pager } from "./ui";
export function ArchiveCard({
  api,
  record,
  branch,
  zone,
  demo,
  onBack,
  onExpire,
}: {
  api: ArchiveApi;
  record: ArchiveRecord;
  branch?: Branch;
  zone: string;
  demo: boolean;
  onBack: () => void;
  onExpire: () => void;
}) {
  const [patient, setPatient] = useState<Patient | null>(null),
    [patientError, setPatientError] = useState(""),
    [retry, setRetry] = useState(0),
    [mode, setMode] = useState<"info" | "prescriptions" | "history" | "grid">(
      "info",
    ),
    [chains, setChains] = useState<Chain[] | null>(null),
    [chainsLoading, setChainsLoading] = useState(false),
    [chainsError, setChainsError] = useState(""),
    [chainRetry, setChainRetry] = useState(0),
    [selection, setSelection] = useState<Selection | null>(null),
    [sheetKey, setSheetKey] = useState("all"),
    [category, setCategory] = useState("ALL"),
    [page, setPage] = useState(0),
    [belongings, setBelongings] = useState<Belonging[] | null>(null),
    [thingsOpen, setThingsOpen] = useState(false),
    [thingsError, setThingsError] = useState(""),
    [thingsRetry, setThingsRetry] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setPatientError("");
    api
      .patient(branch?.id ?? "", record, c.signal)
      .then((p) => {
        if (!c.signal.aborted) setPatient(p);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          if (e instanceof ApiError && e.kind === "Unauthorized") onExpire();
          else setPatientError(archiveError(e));
        }
      });
    return () => c.abort();
  }, [api, branch, record, retry]);
  const wantsChains = mode !== "info";
  useEffect(() => {
    if (!wantsChains || !patient || chains) return;
    const c = new AbortController();
    setChainsLoading(true);
    setChainsError("");
    api
      .chains(record.id, c.signal)
      .then((data) => {
        if (!c.signal.aborted) setChains(data);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          if (e instanceof ApiError && e.kind === "Unauthorized") onExpire();
          else setChainsError(archiveError(e));
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setChainsLoading(false);
      });
    return () => c.abort();
  }, [api, wantsChains, patient, record.id, chainRetry]);
  useEffect(() => {
    if (!thingsOpen || belongings) return;
    const c = new AbortController();
    setThingsError("");
    api
      .belongings(record.patientId, c.signal)
      .then((rows) => {
        if (!c.signal.aborted) setBelongings(rows);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          if (e instanceof ApiError && e.kind === "Unauthorized") onExpire();
          else setThingsError(archiveError(e));
        }
      });
    return () => c.abort();
  }, [api, thingsOpen, record.patientId, thingsRetry, belongings]);
  const indexes = useMemo(() => indexChains(chains ?? []), [chains]);
  const sheets = useMemo(
    () => [...(patient?.sheets ?? [])].sort((a, b) => b.start - a.start),
    [patient],
  );
  const sheet = sheets.find((s) => s.id === sheetKey),
    filtered = useMemo(
      () =>
        indexes.filter((i) => category === "ALL" || i.chain.type === category),
      [indexes, category],
    );
  const events = useMemo(
    () =>
      filtered
        .flatMap((index) =>
          [...index.entries, ...index.unplaced]
            .filter(
              (entry) =>
                !sheet ||
                (entry.result.at !== null &&
                  entry.result.at >= sheet.start &&
                  entry.result.at < sheet.end),
            )
            .map((entry) => ({ index, entry })),
        )
        .sort(
          (a, b) =>
            (a.entry.result.at ?? Infinity) - (b.entry.result.at ?? Infinity),
        ),
    [filtered, sheet],
  );
  const display =
    patient ??
    normalizePatients([{ id: record.patientId, name: record.name }])[0];
  function changeMode(next: typeof mode) {
    setMode(next);
    setPage(0);
    if (next === "grid" && sheetKey === "all" && sheets[0])
      setSheetKey(sheets[0].id);
  }
  function openResult(index: IndexedChain, entry: Entry) {
    setSelection({
      index,
      revision: entry.revision,
      at: entry.result.at ?? undefined,
      entries: [entry],
    });
  }
  return (
    <section className="archive-card" aria-label="Архивная карточка">
      <div className="page-title">
        <button className="secondary small" onClick={onBack}>
          ‹ Архив
        </button>
        <span className="read-badge">Архив · просмотр</span>
      </div>
      <div className="patient-heading">
        <PatientPhoto patient={display} large demo={demo} />
        <div>
          <h1>{record.name || display.name}</h1>
          {patient && (patient.species || patient.breed) && (
            <p>
              {[patient.species, patient.breed].filter(Boolean).join(" · ")}
            </p>
          )}
          <div className="archive-patient-meta">
            {patient?.weight && <span>{patient.weight} кг</span>}
            {patient?.severity && <SeverityBadge value={patient.severity} />}
          </div>
        </div>
      </div>
      {record.owner && (
        <p className="patient-owner">Владелец: {record.owner}</p>
      )}
      <p className="diagnosis">
        {record.diagnoses || patient?.diagnoses || "Диагноз не указан"}
      </p>
      <dl className="archive-dates">
        <dt>Поступление</dt>
        <dd>
          {formatStamp(record.start, zone)}
          {record.arrivalDepartment ? ` · ${record.arrivalDepartment}` : ""}
        </dd>
        <dt>Завершение</dt>
        <dd>
          {formatStamp(record.end, zone)}
          {record.department ? ` · ${record.department}` : ""}
        </dd>
        <dt>Результат</dt>
        <dd>
          {FINISH_LABELS[record.result as keyof typeof FINISH_LABELS] ||
            record.result ||
            "Не указан"}
        </dd>
        {record.number && (
          <>
            <dt>Карта</dt>
            <dd>{record.number}</dd>
          </>
        )}
      </dl>
      {patientError ? (
        <>
          <ErrorBox message={patientError} />
          <button
            className="secondary small"
            onClick={() => setRetry((n) => n + 1)}
          >
            Повторить чтение карты
          </button>
        </>
      ) : (
        !patient && <Loader text="Загрузка архивной карты…" />
      )}
      {patient && (
        <>
          <div className="archive-tabs" aria-label="Разделы архивной карты">
            {(
              [
                ["info", "Данные"],
                ["prescriptions", "Назначения"],
                ["history", "Отметки"],
                ["grid", "Сетка"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={mode === key ? "active primary" : "secondary"}
                aria-pressed={mode === key}
                onClick={() => changeMode(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "info" && (
            <>
              <p className="micro">
                Даты показаны в {zone}. Архивная карта доступна только для
                чтения.
              </p>
              <details
                className="belongings"
                onToggle={(e) => setThingsOpen(e.currentTarget.open)}
              >
                <summary>Личные вещи пациента</summary>
                <p className="micro">
                  Текущий учёт вещей пациента, не снимок на дату завершения
                  лечения.
                </p>
                {thingsError ? (
                  <>
                    <ErrorBox message={thingsError} />
                    <button
                      className="secondary small"
                      onClick={() => setThingsRetry((n) => n + 1)}
                    >
                      Повторить чтение вещей
                    </button>
                  </>
                ) : !belongings && thingsOpen ? (
                  <Loader text="Загрузка вещей…" />
                ) : belongings?.length === 0 ? (
                  <p>Личных вещей нет</p>
                ) : (
                  belongings?.map((b) => (
                    <article className="belonging-row" key={b.id}>
                      <strong>{b.name}</strong>
                      <p>
                        {b.receivingDate} ·{" "}
                        {BELONGING_STATUSES[
                          b.status as keyof typeof BELONGING_STATUSES
                        ] || b.status}
                        {b.returnDate ? ` · ${b.returnDate}` : ""}
                      </p>
                      {b.comment && <p className="pre-wrap">{b.comment}</p>}
                    </article>
                  ))
                )}
              </details>
            </>
          )}
          {wantsChains && (
            <>
              {chainsLoading && (
                <Loader text="Загрузка исторических назначений…" />
              )}
              {chainsError && (
                <>
                  <ErrorBox message={chainsError} />
                  <button
                    className="secondary small"
                    onClick={() => setChainRetry((n) => n + 1)}
                  >
                    Повторить чтение назначений
                  </button>
                </>
              )}
              {chains && (
                <>
                  <div className="patient-create-grid archive-history-filters">
                    <label>
                      Категория
                      <select
                        aria-label="Категория архивных назначений"
                        value={category}
                        onChange={(e) => {
                          setCategory(e.target.value);
                          setPage(0);
                        }}
                      >
                        <option value="ALL">Все назначения</option>
                        {Object.entries(LABELS).map(([v, t]) => (
                          <option key={v} value={v}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Лист лечения
                      <select
                        aria-label="Лист архивного лечения"
                        value={sheetKey}
                        onChange={(e) => {
                          setSheetKey(e.target.value);
                          setPage(0);
                        }}
                      >
                        <option value="all">Вся история</option>
                        {sheets.map((s) => (
                          <option key={s.id} value={s.id}>
                            {formatStamp(s.start, zone)} —{" "}
                            {formatStamp(s.end, zone)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {mode === "prescriptions" && (
                    <>
                      <div className="archive-prescriptions">
                        {filtered
                          .slice(page * 30, (page + 1) * 30)
                          .map((index) => (
                            <button
                              className="secondary archive-prescription"
                              key={index.chain.id}
                              onClick={() => setSelection({ index })}
                            >
                              {index.chain.name}
                              <span className="micro">
                                {LABELS[index.chain.type] || index.chain.type}
                              </span>
                            </button>
                          ))}
                      </div>
                      {!filtered.length && (
                        <p className="empty">Назначений нет</p>
                      )}
                      <Pager
                        page={page}
                        count={filtered.length}
                        size={30}
                        label="Страницы архивных назначений"
                        onChange={setPage}
                      />
                    </>
                  )}
                  {mode === "history" && (
                    <>
                      <div className="archive-events">
                        {events
                          .slice(page * 30, (page + 1) * 30)
                          .map(({ index, entry }, i) => (
                            <button
                              className="secondary archive-event"
                              key={`${index.chain.id}/${entry.revision.id}/${entry.result.id}/${i}`}
                              onClick={() => openResult(index, entry)}
                            >
                              <b>{formatStamp(entry.result.at, zone)}</b>
                              <span>
                                {clinicalTitle(index.chain, entry.revision)}
                              </span>
                              <span className="micro">
                                {STATUS[entry.result.status] ||
                                  entry.result.status ||
                                  "Статус не указан"}
                              </span>
                              {entry.result.comment && (
                                <span className="pre-wrap">
                                  {entry.result.comment}
                                </span>
                              )}
                            </button>
                          ))}
                      </div>
                      {!events.length && (
                        <p className="empty">Отметок за выбранный период нет</p>
                      )}
                      <Pager
                        page={page}
                        count={events.length}
                        size={30}
                        label="Страницы архивных отметок"
                        onChange={setPage}
                      />
                    </>
                  )}
                  {mode === "grid" &&
                    (sheet ? (
                      <>
                        <p className="micro">
                          {formatStamp(sheet.start, zone)} —{" "}
                          {formatStamp(sheet.end, zone)}
                        </p>
                        <Grid
                          indexes={filtered}
                          start={sheet.start}
                          end={sheet.end}
                          zone={zone}
                          now={Date.now()}
                          onSelect={setSelection}
                        />
                      </>
                    ) : (
                      <p className="notice">
                        Выберите существующий лист лечения для просмотра сетки.
                        Если листов нет, результаты доступны в разделе
                        «Отметки».
                      </p>
                    ))}
                </>
              )}
            </>
          )}
        </>
      )}
      {selection && (
        <Details
          selection={selection}
          zone={zone}
          onClose={() => setSelection(null)}
        />
      )}
    </section>
  );
}
