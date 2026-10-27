import type { Entry, IndexedChain, Revision } from "./model";
import { safeColor } from "./model";
import {
  classifySchedule,
  hasScheduledTaskOn,
  hourStart,
} from "./hourlySummary";
/** Presentation only. Keep source and individual result colors independent. */
export function cellRevisions(
  index: IndexedChain,
  at: number,
  zone: string,
  entries: Entry[] = [],
): Revision[] {
  const active = index.chain.elements.filter((r) => {
    const kind = classifySchedule(r);
    return kind === "MANUAL_AS_NEEDED"
      ? hourStart(r.start!, zone) <= at && (r.end === null || at < r.end)
      : hasScheduledTaskOn(r, at, zone);
  });
  // Preserve the source revision for historical/manual results even outside an automatic slot.
  return [...new Set([...active, ...entries.map((e) => e.revision)])].sort(
    (a, b) =>
      (a.start ?? Infinity) - (b.start ?? Infinity) || a.id.localeCompare(b.id),
  );
}
export function cellFill(revisions: Revision[], entries: Entry[] = []): string {
  const colors = [
    ...new Set(
      revisions.flatMap((revision) => {
        const results = entries.filter(
          (e) => e.revision.id === revision.id && e.result.at !== null,
        );
        const manual = classifySchedule(revision) === "MANUAL_AS_NEEDED";
        if (!results.length)
          return manual || !revision.color.trim()
            ? []
            : [safeColor(revision.color)];
        return results.flatMap(({ result }) => {
          const color = result.color.trim()
            ? result.color
            : manual
              ? ""
              : revision.color;
          return color.trim() ? [safeColor(color)] : [];
        });
      }),
    ),
  ].slice(0, 8);
  return colors.length > 1
    ? `linear-gradient(90deg,${colors.join(",")})`
    : (colors[0] ?? "#131f23");
}
