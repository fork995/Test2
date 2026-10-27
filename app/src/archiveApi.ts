import { API, ApiError, safeError } from "./api";
import {
  normalizeArchiveRecord,
  archivePredicate,
  archiveId,
  ARCHIVE_PAGE_SIZE,
  type ArchiveQuery,
  type ArchivePage,
  type ArchiveRecord,
  type ArchiveProgress,
} from "./archiveModel";
import {
  readObjectArray,
  readSingleObject,
  ArchiveReadError,
  DETAIL_LIMITS,
} from "./archiveStream";
import {
  normalizePatients,
  normalizeChains,
  obj,
  type Patient,
  type Chain,
} from "./model";
import { normalizeBelongings, type Belonging } from "./belongings";
export interface ArchiveApi {
  page(
    branch: string,
    query: ArchiveQuery,
    page: number,
    zone: string,
    signal: AbortSignal,
    progress?: (p: ArchiveProgress) => void,
  ): Promise<ArchivePage>;
  patient(
    branch: string,
    record: ArchiveRecord,
    signal: AbortSignal,
  ): Promise<Patient>;
  chains(card: string, signal: AbortSignal): Promise<Chain[]>;
  belongings(patient: string, signal: AbortSignal): Promise<Belonging[]>;
  close(): void;
}
export function archiveError(e: unknown): string {
  if (e instanceof ApiError && e.kind === "Timeout")
    return "Сервер не завершил чтение за 60 секунд. Повторите позже или используйте оригинальный CleverVet. Полный список не получен.";
  if (e instanceof ArchiveReadError)
    return {
      Limit:
        "Загрузка остановлена: превышен безопасный предел объёма архива или карты. Полный список не получен. Используйте оригинальный CleverVet; для большего архива нужен подтверждённый API с серверной пагинацией.",
      Format:
        "Не удалось прочитать архив: формат ответа отличается от подтверждённого. Неполный список не показан.",
      StreamingUnavailable:
        "Браузер не поддерживает безопасное потоковое чтение этого ответа. Откройте актуальную Safari; полная загрузка в память отключена.",
      DifferentCard:
        "Этот запрос вернул другую медицинскую карту пациента. Историческая карта не подтверждена; её назначения не загружены.",
    }[e.kind];
  return safeError(e);
}
/** Archive-only GET transport; no mutations, query parameters, or unbounded full-array JSON parse. */
export function createArchiveApi(
  initialToken: string,
  fetchImpl: typeof fetch = fetch,
  onUnauthorized: () => void = () => {},
  timeoutMs = 60000,
): ArchiveApi {
  let token = initialToken,
    closed = false;
  initialToken = "";
  const running = new Set<AbortController>();
  function close() {
    closed = true;
    token = "";
    running.forEach((c) => c.abort());
    running.clear();
  }
  const id = (s: string) => {
    if (!archiveId(s)) throw new ApiError("InvalidResponse");
    return encodeURIComponent(s);
  };
  async function get<T>(
    path: string,
    external: AbortSignal,
    read: (r: Response, s: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (closed || !token || external.aborted) throw new ApiError("Cancelled");
    const c = new AbortController(),
      abort = () => c.abort();
    running.add(c);
    external.addEventListener("abort", abort, { once: true });
    let timeout = false;
    const timer = setTimeout(() => {
      timeout = true;
      c.abort();
    }, timeoutMs);
    try {
      const r = await fetchImpl(API + path, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: c.signal,
      });
      if (r.status !== 200) {
        void r.body?.cancel().catch(() => {});
        if (r.status === 401) {
          close();
          onUnauthorized();
          throw new ApiError("Unauthorized", 401);
        }
        if (r.status === 403) throw new ApiError("Forbidden", 403);
        throw new ApiError("Http", r.status);
      }
      const value = await read(r, c.signal);
      if (c.signal.aborted || closed) throw new ApiError("Cancelled");
      return value;
    } catch (e) {
      if (timeout) throw new ApiError("Timeout");
      if (
        c.signal.aborted &&
        !(e instanceof ApiError && e.kind === "Unauthorized")
      )
        throw new ApiError("Cancelled");
      if (e instanceof ApiError || e instanceof ArchiveReadError) throw e;
      throw new ApiError(
        e instanceof TypeError ? "NetworkOrCors" : "Unexpected",
      );
    } finally {
      clearTimeout(timer);
      external.removeEventListener("abort", abort);
      running.delete(c);
    }
  }
  return {
    async page(branch, q, page, zone, signal, progress) {
      if (!Number.isSafeInteger(page) || page < 0)
        return Promise.reject(new ApiError("InvalidResponse"));
      let match: (r: ArchiveRecord) => boolean;
      try {
        match = archivePredicate(q, zone);
      } catch {
        return Promise.reject(new ApiError("InvalidResponse"));
      }
      return get(
        `/branches/${id(branch)}/archive/medical-records`,
        signal,
        async (r, s) => {
          const rows: ArchiveRecord[] = [];
          let matched = 0;
          const stats = await readObjectArray(
            r,
            s,
            (value) => {
              let row: ArchiveRecord;
              try {
                row = normalizeArchiveRecord(value);
              } catch {
                throw new ArchiveReadError("Format");
              }
              if (match(row)) {
                if (
                  matched >= page * ARCHIVE_PAGE_SIZE &&
                  rows.length < ARCHIVE_PAGE_SIZE
                )
                  rows.push(row);
                matched++;
              }
            },
            undefined,
            (bytes, scanned) => progress?.({ bytes, scanned, matched }),
          );
          return {
            rows,
            page,
            matched,
            scanned: stats.records,
            bytes: stats.bytes,
            complete: true,
          };
        },
      );
    },
    async patient(branch, row, signal) {
      // Original zf → gA: patient link scoped to the finishing department, if supplied.
      const dept = row.departmentId
        ? `/departments/${id(row.departmentId)}`
        : "";
      return get(
        `/branches/${id(branch)}${dept}/patients/${id(row.patientId)}`,
        signal,
        async (r, s) => {
          const raw = await readSingleObject(r, s);
          if (!obj(raw).card) throw new ApiError("InvalidResponse");
          const p = normalizePatients([raw])[0];
          if (p?.id !== row.patientId || p.cardId !== row.id)
            throw new ArchiveReadError("DifferentCard");
          return p;
        },
      );
    },
    async chains(card, signal) {
      return get(
        `/medical-records/${id(card)}/prescription-chains`,
        signal,
        async (r, s) => {
          const chains: Chain[] = [];
          let results = 0;
          await readObjectArray(
            r,
            s,
            (value) => {
              const raw = obj(value);
              if (
                !archiveId(String(raw.id ?? "")) ||
                !Array.isArray(raw.elements)
              )
                throw new ArchiveReadError("Format");
              const [chain] = normalizeChains([value]);
              for (const rev of chain.elements) results += rev.results.length;
              if (results > 20000) throw new ArchiveReadError("Limit");
              chains.push(chain);
            },
            DETAIL_LIMITS,
          );
          return chains;
        },
      );
    },
    async belongings(patient, signal) {
      return get(
        `/patients/${id(patient)}/personal-belongings`,
        signal,
        async (r, s) => {
          const rows: Belonging[] = [];
          await readObjectArray(
            r,
            s,
            (value) => rows.push(...normalizeBelongings([value])),
            { maxBytes: 1024 * 1024, maxObjectChars: 65536, maxRecords: 1000 },
          );
          return rows;
        },
      );
    },
    close,
  };
}
