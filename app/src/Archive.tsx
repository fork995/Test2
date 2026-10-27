import { useEffect, useRef, useState } from "react";
import type { ArchiveApi } from "./archiveApi";
import { archiveError } from "./archiveApi";
import {
  ARCHIVE_PAGE_SIZE,
  archivePredicate,
  emptyArchiveQuery,
  type ArchivePage,
  type ArchiveProgress,
  type ArchiveRecord,
} from "./archiveModel";
import { type Branch, normalizePatients } from "./model";
import { FINISH_LABELS } from "./finishResults";
import { HOSPITALS } from "./patientCreation";
import { formatStamp } from "./time";
import { PatientPhoto } from "./PatientPhoto";
import { ErrorBox, Loader, Pager } from "./ui";
import { ApiError } from "./api";
import { ArchiveCard } from "./ArchiveCard";
export function Archive({
  api,
  branches,
  initialBranch,
  zone,
  demo,
  onExpire,
}: {
  api: ArchiveApi;
  branches: Branch[];
  initialBranch: string;
  zone: string;
  demo: boolean;
  onExpire: () => void;
}) {
  const [branch, setBranch] = useState(initialBranch),
    [draft, setDraft] = useState(emptyArchiveQuery),
    [request, setRequest] = useState(() => ({
      query: emptyArchiveQuery(),
      page: 0,
      revision: 0,
    })),
    [page, setPage] = useState<ArchivePage | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [progress, setProgress] = useState<ArchiveProgress | null>(null),
    [selected, setSelected] = useState<ArchiveRecord | null>(null);
  const running = useRef<AbortController | null>(null),
    expire = useRef(onExpire);
  expire.current = onExpire;
  useEffect(() => {
    setPage(null);
    setSelected(null);
    setError("");
    setProgress(null);
    if (!branch) return;
    const c = new AbortController();
    running.current = c;
    setLoading(true);
    let last = 0;
    api
      .page(branch, request.query, request.page, zone, c.signal, (p) => {
        if (!c.signal.aborted && performance.now() - last > 100) {
          last = performance.now();
          setProgress(p);
        }
      })
      .then((data) => {
        if (!c.signal.aborted) setPage(data);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          if (e instanceof ApiError && e.kind === "Unauthorized")
            expire.current();
          else setError(archiveError(e));
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => {
      c.abort();
      if (running.current === c) running.current = null;
    };
  }, [api, branch, request, zone]);
  function search() {
    try {
      archivePredicate(draft, zone);
    } catch {
      setError("Проверьте даты и длину поискового запроса.");
      return;
    }
    setRequest((r) => ({
      query: { ...draft },
      page: 0,
      revision: r.revision + 1,
    }));
  }
  if (selected)
    return (
      <ArchiveCard
        key={`${branch}/${selected.id}`}
        api={api}
        record={selected}
        branch={branches.find((b) => b.id === branch)}
        zone={zone}
        demo={demo}
        onBack={() => setSelected(null)}
        onExpire={onExpire}
      />
    );
  return (
    <section className="archive-screen" aria-label="Архив пациентов">
      <div className="page-title">
        <h1>Архив</h1>
        <span className="read-badge">Просмотр</span>
      </div>
      <label>
        Филиал архива
        <select
          aria-label="Филиал архива"
          value={branch}
          onChange={(e) => {
            running.current?.abort();
            setLoading(false);
            setPage(null);
            setBranch(e.target.value);
            setRequest((r) => ({ ...r, page: 0, revision: r.revision + 1 }));
            setSelected(null);
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
      <form
        className="archive-search"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <label>
          Кличка, владелец или номер карты
          <input
            type="search"
            aria-label="Поиск в архиве"
            maxLength={256}
            value={draft.search}
            onChange={(e) => setDraft({ ...draft, search: e.target.value })}
          />
        </label>
        <details className="archive-filters">
          <summary>Фильтры</summary>
          <div className="patient-create-grid">
            <label>
              Результат
              <select
                aria-label="Результат в архиве"
                value={draft.result}
                onChange={(e) => setDraft({ ...draft, result: e.target.value })}
              >
                <option value="">Все результаты</option>
                {Object.entries(FINISH_LABELS).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Стационар
              <select
                aria-label="Стационар в архиве"
                value={draft.hospital}
                onChange={(e) =>
                  setDraft({ ...draft, hospital: e.target.value })
                }
              >
                <option value="">Все</option>
                {Object.entries(HOSPITALS).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              Отделение завершения
              <input
                aria-label="Отделение в архиве"
                maxLength={256}
                value={draft.department}
                onChange={(e) =>
                  setDraft({ ...draft, department: e.target.value })
                }
              />
            </label>
            <label className="wide">
              Период
              <select
                aria-label="Поле даты архива"
                value={draft.dateField}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    dateField: e.target.value as "start" | "end",
                  })
                }
              >
                <option value="end">Завершение лечения</option>
                <option value="start">Поступление</option>
              </select>
            </label>
            <label>
              С даты
              <input
                type="date"
                aria-label="Архив с даты"
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </label>
            <label>
              По дату
              <input
                type="date"
                aria-label="Архив по дату"
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            </label>
          </div>
          <p className="micro">
            Даты: {zone}. Фильтры применяются кнопкой «Найти».
          </p>
        </details>
        <div className="entity-actions">
          <button className="primary" type="submit" disabled={!branch}>
            Найти
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={!branch || loading}
            onClick={() =>
              setRequest((r) => ({ ...r, revision: r.revision + 1 }))
            }
          >
            Обновить архив
          </button>
          {loading && (
            <button
              type="button"
              className="secondary small"
              onClick={() => {
                running.current?.abort();
                setLoading(false);
                setPage(null);
                setError("Загрузка отменена. Полный список не получен.");
              }}
            >
              Отменить загрузку
            </button>
          )}
        </div>
      </form>
      {loading && (
        <>
          <Loader text="Чтение архива…" />
          <p className="micro" role="status">
            Проверено записей: {progress?.scanned ?? 0}. Результаты появятся
            после завершения чтения.
          </p>
        </>
      )}
      {error && <ErrorBox message={error} />}
      {page && !loading && (
        <>
          <p className="micro" role="status">
            Найдено: {page.matched} · порядок сервера
          </p>
          {page.rows.length === 0 && (
            <p className="empty">
              {page.scanned === 0
                ? "Архив пуст"
                : "По выбранным условиям записей нет"}
            </p>
          )}
          <div className="archive-list">
            {page.rows.map((row) => (
              <button
                className="patient-card archive-row"
                key={row.id}
                onClick={() => setSelected(row)}
              >
                <span className="patient-card-top">
                  <PatientPhoto
                    patient={
                      normalizePatients([
                        { id: row.patientId, name: row.name },
                      ])[0]
                    }
                  />
                  <span>
                    <strong>{row.name || "Кличка не указана"}</strong>
                    {row.number && (
                      <span className="micro">Карта № {row.number}</span>
                    )}
                  </span>
                  <span aria-hidden="true">›</span>
                </span>
                {row.owner && (
                  <span className="archive-owner">Владелец: {row.owner}</span>
                )}
                <span className="micro">
                  Поступление: {formatStamp(row.start, zone)}
                  <br />
                  Завершение: {formatStamp(row.end, zone)}
                </span>
                <span>
                  {FINISH_LABELS[row.result as keyof typeof FINISH_LABELS] ||
                    row.result ||
                    "Результат не указан"}
                  {row.department ? ` · ${row.department}` : ""}
                </span>
              </button>
            ))}
          </div>
          <Pager
            page={page.page}
            count={page.matched}
            size={ARCHIVE_PAGE_SIZE}
            label="Страницы архива"
            onChange={(p) =>
              setRequest((r) => ({ ...r, page: p, revision: r.revision + 1 }))
            }
          />
        </>
      )}
      <details className="archive-loading-note">
        <summary>Как загружается архив</summary>
        <p className="micro">
          Список читается по частям, в памяти остаётся одна страница. Новый
          поиск или переход страницы повторно загружает ответ филиала. При
          превышении безопасного предела чтение прекращается; неполный список не
          выдаётся за полный.
        </p>
      </details>
    </section>
  );
}
