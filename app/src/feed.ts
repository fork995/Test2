import {
  entriesInRange,
  revisionIntervals,
  instant,
  type IndexedChain,
  type Revision,
  type Entry,
} from "./model";
import type { Period } from "./period";
import { classifySchedule } from "./hourlySummary";
export interface FeedItem {
  key: string;
  index: IndexedChain;
  revision?: Revision;
  entry?: Entry;
  at: number | null;
  kind: "result" | "unscheduled" | "unplaced";
  warnings: string[];
  confidence?: "bounded" | "uncertain";
}
export interface FeedData {
  events: FeedItem[];
  unscheduled: FeedItem[];
  unplaced: FeedItem[];
  warnings: string[];
}
const diagnosticsCache = new WeakMap<IndexedChain, string[]>();
export function revisionDiagnostics(index: IndexedChain): string[] {
  const cached = diagnosticsCache.get(index);
  if (cached) return cached;
  const warnings = new Set<string>();
  const byId = new Map(index.chain.elements.map((e) => [e.id, e]));
  if (byId.size !== index.chain.elements.length)
    warnings.add("Повторяются идентификаторы редакций.");
  // Inactive drafts also cannot make a dated sibling/parent interval ambiguous.
  // This is a derived view; keep every raw edition and result in index unchanged.
  const datedIntervals = revisionIntervals({
    ...index.chain,
    elements: index.chain.elements.filter((r) => r.start !== null),
  });
  for (const i of datedIntervals) {
    if (i.ambiguous)
      warnings.add("Есть редакции с неполными или неоднозначными интервалами.");
    if (i.revision.parentId && !byId.has(i.revision.parentId))
      warnings.add("Не найдена родительская редакция.");
  }
  const visited = new Set<string>();
  for (const start of index.chain.elements) {
    const path = new Set<string>();
    let e: Revision | undefined = start;
    while (e && !visited.has(e.id)) {
      if (path.has(e.id)) {
        warnings.add("В связях редакций найден цикл.");
        break;
      }
      path.add(e.id);
      e = byId.get(e.parentId);
    }
    path.forEach((id) => visited.add(id));
  }
  const bounds = datedIntervals
    .filter((i) => i.start !== null && i.end !== null && !i.ambiguous)
    .sort((a, b) => a.start! - b.start!);
  let furthest = -Infinity;
  for (const i of bounds) {
    if (i.start! < furthest)
      warnings.add(
        "Интервалы редакций пересекаются; одновременное действие не подтверждено.",
      );
    furthest = Math.max(furthest, i.end!);
  }
  const result = [...warnings];
  diagnosticsCache.set(index, result);
  return result;
}

function unscheduled(index: IndexedChain, period: Period): FeedItem | null {
  const candidates = index.intervals.filter(
    (i) =>
      i.start !== null &&
      classifySchedule(i.revision) !== "MANUAL_AS_NEEDED" &&
      i.start < period.end &&
      (i.end === null || i.end > period.start),
  );
  if (!candidates.length) {
    const warnings = [...revisionDiagnostics(index)];
    if (!index.chain.elements.length)
      warnings.push(
        "Цепочка не содержит редакций; активность и расписание не подтверждены.",
      );
    if (!warnings.length) return null;
    return {
      key: `diagnostic:${index.chain.id}`,
      index,
      at: null,
      kind: "unscheduled",
      confidence: "uncertain",
      warnings,
    };
  }
  // Prefer a unique descendant among revisions which overlap this period. Older revisions remain in history/results.
  const candidateIds = new Set(candidates.map((i) => i.revision.id));
  const superseded = new Set(
    candidates
      .map((i) => i.revision.parentId)
      .filter((id) => candidateIds.has(id)),
  );
  const leaves = candidates.filter((i) => !superseded.has(i.revision.id));
  const warnings = [...revisionDiagnostics(index)];
  const selected = leaves.length === 1 ? leaves[0] : undefined;
  const confidence =
    selected &&
    !selected.ambiguous &&
    selected.start !== null &&
    selected.end !== null &&
    !warnings.length
      ? "bounded"
      : "uncertain";
  if (!selected)
    warnings.push(
      "Нельзя однозначно выбрать редакцию. Клинические параметры доступны раздельно в истории.",
    );
  else if (confidence === "uncertain")
    warnings.push(
      "Активность редакции не подтверждена: окончание или последовательность неизвестны.",
    );
  return {
    key: `unscheduled:${index.chain.id}`,
    index,
    revision: selected?.revision,
    at: null,
    kind: "unscheduled",
    warnings: [...new Set(warnings)],
    confidence,
  };
}
export function buildFeed(
  indexes: IndexedChain[],
  period: Period | null,
  category = "ALL",
): FeedData {
  const data: FeedData = {
    events: [],
    unscheduled: [],
    unplaced: [],
    warnings: [],
  };
  const filtered = indexes.filter(
    (i) => category === "ALL" || i.chain.type === category,
  );
  for (const index of filtered) {
    const diagnostics = revisionDiagnostics(index);
    diagnostics.forEach((w) => data.warnings.push(`${index.chain.name}: ${w}`));
    const seen = new Set<string>();
    for (const entry of period
      ? entriesInRange(index, period.start, period.end)
      : []) {
      const key = `${index.chain.id}:${entry.revision.id}:${entry.result.id}:${entry.result.at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const bound = index.intervalByRevision.get(entry.revision)!;
      const outside =
        entry.revision.start !== null &&
        classifySchedule(entry.revision) !== "MANUAL_AS_NEEDED" &&
        (bound.ambiguous ||
          bound.start === null ||
          bound.end === null ||
          entry.result.at! < bound.start ||
          entry.result.at! >= bound.end);
      data.events.push({
        key,
        index,
        revision: entry.revision,
        entry,
        at: entry.result.at,
        kind: "result",
        warnings: outside
          ? [
              "Принадлежность результата действующему интервалу редакции не подтверждена.",
            ]
          : [],
      });
    }
    if (period) {
      const item = unscheduled(index, period);
      if (item) data.unscheduled.push(item);
    } else if (
      index.chain.elements.some(
        (r) => r.start !== null && classifySchedule(r) !== "MANUAL_AS_NEEDED",
      )
    )
      data.unscheduled.push({
        key: `unknown:${index.chain.id}`,
        index,
        at: null,
        kind: "unscheduled",
        confidence: "uncertain",
        warnings: ["Без выбранного интервала активность не определяется."],
      });
    for (const entry of index.unplaced) {
      const key = `unplaced:${index.chain.id}:${entry.revision.id}:${entry.result.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      data.unplaced.push({
        key,
        index,
        revision: entry.revision,
        entry,
        at: null,
        kind: "unplaced",
        warnings: [
          "Час результата неоднозначен; запись не отфильтрована по смене.",
        ],
      });
    }
  }
  data.events.sort(
    (a, b) =>
      a.at! - b.at! ||
      a.index.chain.name.localeCompare(b.index.chain.name, "ru") ||
      a.key.localeCompare(b.key),
  );
  // creationDate is only a history order hint, never a scheduled/execution hour.
  data.unscheduled.sort(
    (a, b) =>
      (a.revision?.start ?? instant(a.revision?.created) ?? Infinity) -
        (b.revision?.start ?? instant(b.revision?.created) ?? Infinity) ||
      a.index.chain.name.localeCompare(b.index.chain.name, "ru"),
  );
  data.warnings = [...new Set(data.warnings)];
  return data;
}
