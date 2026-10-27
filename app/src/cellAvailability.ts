import { type Chain, type Revision } from "./model";
import { hourStart } from "./hourlySummary";
import { scheduleIntervals } from "./scheduleIntervals";
import { HOUR } from "./time";

/** Original Rp.enabledOn: continuous revision interval intersects the hour.
 * Deliberately independent of recurrence, category, colors and results.
 * Parent/successor boundaries use the existing interval resolver, not a new schedule.
 */
const intervals = new WeakMap<Chain, ReturnType<typeof scheduleIntervals>>();
export function enabledRevision(
  chain: Chain,
  at: number,
  zone: string,
): Revision | undefined {
  if (!Number.isFinite(at)) return undefined;
  const hour = hourStart(at, zone);
  let ranges = intervals.get(chain);
  if (!ranges) {
    ranges = scheduleIntervals({
      chain,
      entries: [],
      unplaced: [],
      intervals: [],
      intervalByRevision: new Map(),
    });
    intervals.set(chain, ranges);
  }
  return ranges.find(
    ({ start, end, reasons }) =>
      start !== null &&
      Number.isFinite(start) &&
      reasons.length === 0 &&
      start < hour + HOUR &&
      (end === null || hour < end),
  )?.revision;
}

export function revisionEnabled(
  revision: Revision,
  at: number,
  zone: string,
  chain?: Chain,
): boolean {
  const owner = enabledRevision(
    chain ?? {
      id: "availability-only",
      name: "",
      type: "",
      elements: [revision],
    },
    at,
    zone,
  );
  return owner?.id === revision.id;
}
