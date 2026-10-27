export const CATEGORIES = [
  "MONITORING",
  "ACTIVITY",
  "SOLUTION",
  "MEDICATION",
  "PROCEDURE",
  "NURSING",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const LABELS: Record<string, string> = {
  MONITORING: "Мониторинг",
  ACTIVITY: "Активность",
  SOLUTION: "Растворы",
  MEDICATION: "Препараты",
  PROCEDURE: "Процедуры",
  NURSING: "Уход",
};
export const STATUS: Record<string, string> = {
  EXECUTED: "Выполнено",
  NOT_EXECUTED: "Не выполнено",
};
export const REASONS: Record<string, string> = {
  BODY_CONDITION_CHANGED: "Изменение состояния пациента",
  DEVICE_ABSENT: "Отсутствует оборудование",
  MEDICATION_ABSENT: "Отсутствует препарат",
  ON_DIAGNOSTICS: "Пациент на диагностике",
  ORGANIZATIONAL: "Организационная причина",
};
export type Obj = Record<string, unknown>;
export interface Department {
  id: string;
  name: string;
}
export interface Branch {
  id: string;
  name: string;
  workShiftStart: string;
  departments: Department[];
}
export interface Sheet {
  id: string;
  start: number;
  end: number;
  source: "direct" | "alias";
  locked?: boolean;
}
export interface Patient {
  id: string;
  name: string;
  species: string;
  breed: string;
  gender: string;
  weight: string;
  severity: string;
  cage: string;
  diagnoses: string;
  cardId: string;
  cardStatus: string;
  hospital: string;
  sheets: Sheet[];
  treatmentStart?: number | null;
  admissionStart?: number | null;
  treatmentEnd?: number | null;
  photo?: string;
  ownerName?: string;
}
export interface Result {
  id: string;
  idConfirmed?: boolean;
  status: string;
  reason: string;
  color: string;
  hour: string;
  at: number | null;
  created: string;
  comment: string;
}
export interface Revision {
  id: string;
  idConfirmed?: boolean;
  parentId: string;
  color: string;
  start: number | null;
  end: number | null;
  rawStart: string;
  rawEnd: string;
  endSource: "endDate" | "dates.end" | null;
  instruction: string;
  specifics: Obj;
  periodicity: unknown;
  created: string;
  results: Result[];
}
export interface Chain {
  id: string;
  name: string;
  type: string;
  elements: Revision[];
}
export function obj(value: unknown): Obj {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : {};
}
export function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}
export function describe(value: unknown): string {
  const o = obj(value);
  return text(value) || text(o.name) || text(o.title) || text(o.value);
}
export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
// Only timestamps with an explicit offset are safe to place on the timeline.
export function instant(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)$/i.test(
      value,
    )
  )
    return null;
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const clock = /^(\d\d):(\d\d)(?::(\d\d))?/.exec(timePart);
  if (
    !clock ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    +clock[1] > 23 ||
    +clock[2] > 59 ||
    +(clock[3] || 0) > 59
  )
    return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}
export function safeColor(value: string): string {
  const color = value.trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color))
    return color;
  // Plain CSS names and numeric color functions only; never URLs, variables or declarations.
  const plain =
    /^[a-z]+$/i.test(color) &&
    !/^(?:inherit|initial|unset|revert|revertlayer|currentcolor)$/i.test(color);
  const functional =
    /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([0-9.,%+\-\s/deg]+\)$/i.test(
      color,
    );
  if (
    (plain || functional) &&
    (typeof CSS === "undefined" ||
      typeof CSS.supports !== "function" ||
      CSS.supports("color", color))
  )
    return color;
  return "#6f8790";
}
export function normalizeBranches(raw: unknown[]): Branch[] {
  return raw
    .map(obj)
    .filter((o) => text(o.id))
    .map((o) => ({
      id: text(o.id),
      name: text(o.name) || "Филиал без названия",
      workShiftStart: text(o.workShiftStart),
      departments: list(o.departments)
        .map(obj)
        .filter((d) => text(d.id))
        .map((d) => ({
          id: text(d.id),
          name: text(d.name) || "Отделение без названия",
        })),
    }));
}
export function normalizePatients(raw: unknown[]): Patient[] {
  return raw
    .map(obj)
    .filter((o) => text(o.id))
    .map((o) => {
      const card = obj(o.card);
      const sheets = list(obj(card.treatment).sheets)
        .map(obj)
        .flatMap((s, i) => {
          // These field aliases are defensive adapters, not a claim about the API schema.
          const dates = obj(s.dates),
            start = instant(s.start ?? dates.start ?? s.startDate),
            end = instant(s.end ?? s.endDate ?? dates.end);
          return start !== null && end !== null && end > start
            ? [
                {
                  id: text(s.id) || `sheet-${i}`,
                  start,
                  end,
                  locked:
                    s.locked === undefined
                      ? false
                      : typeof s.locked === "boolean"
                        ? s.locked
                        : undefined,
                  source: (s.start !== undefined && s.end !== undefined
                    ? "direct"
                    : "alias") as "direct" | "alias",
                },
              ]
            : [];
        })
        .sort((a, b) => a.start - b.start);
      return {
        id: text(o.id),
        name: text(o.name) || "Без клички",
        species: describe(o.species),
        breed: describe(o.breed),
        gender: describe(o.gender),
        weight: text(o.weightKg),
        severity: describe(o.severity),
        cage: text(o.cageNumber),
        diagnoses:
          list(card.diagnoses).map(describe).filter(Boolean).join("; ") ||
          describe(card.diagnoses),
        cardId: text(card.id),
        cardStatus: text(card.status),
        hospital: describe(card.hospital),
        sheets,
        treatmentStart: instant(obj(obj(card.treatment).duration).start),
        admissionStart: instant(obj(card.treatment).start),
        treatmentEnd: instant(obj(card.treatment).end),
        photo: text(o.photo),
        ownerName: [
          obj(o.owner).surname,
          obj(o.owner).name,
          obj(o.owner).patronymic,
        ]
          .filter((v): v is string => typeof v === "string" && !!v.trim())
          .map((v) => v.trim())
          .join(" "),
      };
    });
}
// Only ACTIVE is treated as confirmed. Unknown status remains visible with a warning/filter choice.
export function cardState(p: Patient): "active" | "inactive" | "unknown" {
  if (!p.cardId) return "inactive";
  if (p.cardStatus.toUpperCase() === "ACTIVE") return "active";
  if (
    ["CLOSED", "ARCHIVED", "INACTIVE", "DISCHARGED", "DELETED"].includes(
      p.cardStatus.toUpperCase(),
    )
  )
    return "inactive";
  return "unknown";
}
export function normalizeChains(raw: unknown[]): Chain[] {
  return raw
    .map(obj)
    .filter((o) => text(o.id))
    .map((o) => ({
      id: text(o.id),
      name: text(o.name) || "Без названия",
      type: text(o.type) || "UNKNOWN",
      elements: list(o.elements)
        .map(obj)
        .map((e, i) => ({
          id: text(e.id) || `revision-${i}`,
          idConfirmed: !!text(e.id),
          parentId: text(e.parentId),
          color: text(e.color),
          start: instant(obj(e.dates).start),
          end: instant(e.endDate ?? obj(e.dates).end),
          rawStart: text(obj(e.dates).start),
          rawEnd: text(e.endDate ?? obj(e.dates).end),
          endSource:
            e.endDate !== undefined && e.endDate !== null
              ? "endDate"
              : obj(e.dates).end !== undefined
                ? "dates.end"
                : null,
          instruction: describe(e.instruction),
          specifics: obj(e.specifics),
          periodicity: obj(e.dates).periodicity ?? null,
          created: text(e.creationDate),
          results: list(e.results)
            .map(obj)
            .map((r, j) => ({
              id: text(r.id) || `result-${j}`,
              idConfirmed: !!text(r.id),
              status: text(r.status),
              reason: text(r.reason),
              color: text(r.color),
              hour: text(r.hour),
              at: instant(r.hour),
              created: text(r.creationDate),
              comment: text(r.comment),
            })),
        })),
    }));
}
export interface RevisionInterval {
  revision: Revision;
  start: number | null;
  end: number | null;
  inferred: boolean;
  ambiguous: boolean;
}
export function revisionIntervals(chain: Chain): RevisionInterval[] {
  const childrenByParent = new Map<string, Revision[]>();
  for (const e of chain.elements) {
    if (e.parentId)
      childrenByParent.set(e.parentId, [
        ...(childrenByParent.get(e.parentId) || []),
        e,
      ]);
  }
  return chain.elements.map((revision) => {
    const children = childrenByParent.get(revision.id) || [];
    const starts = children
      .map((e) => e.start)
      .filter((n): n is number => n !== null);
    const successor =
      children.length === 1 &&
      starts.length === 1 &&
      revision.start !== null &&
      starts[0] > revision.start
        ? starts[0]
        : null;
    // A direct, unique successor bounds the old revision even if endDate is missing/overlapping.
    const end =
      revision.end !== null && successor !== null
        ? Math.min(revision.end, successor)
        : (revision.end ?? successor);
    return {
      revision,
      start: revision.start,
      end,
      inferred: revision.end === null && successor !== null,
      ambiguous:
        children.length > 1 ||
        revision.start === null ||
        (end !== null && revision.start !== null && end <= revision.start),
    };
  });
}
export interface Entry {
  revision: Revision;
  result: Result;
}
export interface IndexedChain {
  chain: Chain;
  entries: Entry[];
  unplaced: Entry[];
  intervals: RevisionInterval[];
  intervalByRevision: Map<Revision, RevisionInterval>;
}
export function indexChains(chains: Chain[]): IndexedChain[] {
  return chains.map((chain) => {
    const all = chain.elements.flatMap((revision) =>
      revision.results.map((result) => ({ revision, result })),
    );
    const intervals = revisionIntervals(chain);
    return {
      chain,
      entries: all
        .filter((e) => e.result.at !== null)
        .sort((a, b) => a.result.at! - b.result.at!),
      unplaced: all.filter((e) => e.result.at === null),
      intervals,
      intervalByRevision: new Map(intervals.map((i) => [i.revision, i])),
    };
  });
}
export function entriesInRange(
  index: IndexedChain,
  start: number,
  end: number,
): Entry[] {
  let lo = 0,
    hi = index.entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index.entries[mid].result.at! < start) lo = mid + 1;
    else hi = mid;
  }
  const found: Entry[] = [];
  for (
    let i = lo;
    i < index.entries.length && index.entries[i].result.at! < end;
    i++
  )
    found.push(index.entries[i]);
  return found;
}
export function effectiveRevisions(
  index: IndexedChain,
  at: number,
): Revision[] {
  const bounded = index.intervals
    .filter(
      (i) =>
        !i.ambiguous &&
        i.start !== null &&
        i.end !== null &&
        i.start <= at &&
        at < i.end,
    )
    .map((i) => i.revision);
  // Overlapping unrelated revisions are ambiguous, not simultaneous confirmed prescriptions.
  return bounded.length === 1 ? bounded : [];
}
export function parameters(
  value: unknown,
  prefix = "",
  depth = 0,
): [string, string][] {
  if (depth > 3) return [[prefix, "Вложенные данные: формат не подтверждён"]];
  if (value === null || value === undefined) return [];
  if (typeof value === "boolean") return [[prefix, value ? "да" : "нет"]];
  if (typeof value === "string" || typeof value === "number")
    return [[prefix, String(value)]];
  if (Array.isArray(value)) {
    return value
      .slice(0, 40)
      .flatMap((v, i) => parameters(v, `${prefix}[${i}]`, depth + 1));
  }
  return Object.entries(obj(value))
    .slice(0, 40)
    .flatMap(([key, v]) =>
      parameters(v, prefix ? `${prefix}.${key}` : key, depth + 1),
    );
}

export function lastKnownRevision(chain: Chain): Revision | undefined {
  if (chain.elements.some((e) => e.start === null)) return undefined;
  const ordered = [...chain.elements].sort((a, b) => b.start! - a.start!);
  return ordered.length === 1 || ordered[0]?.start !== ordered[1]?.start
    ? ordered[0]
    : undefined;
}
