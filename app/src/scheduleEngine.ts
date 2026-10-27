import {
  type Patient,
  type IndexedChain,
  type Revision,
  type Entry,
} from "./model";
import type { Period } from "./period";
import { scheduleIntervals } from "./scheduleIntervals";
import {
  hasScheduledTaskOn,
  classifySchedule,
  scheduleWindowContains,
  hourColumns,
  hourStart,
  overlapsHour,
  summarizeCounts,
  type HourSummary,
  type TimeRange,
} from "./hourlySummary";
import { HOUR } from "./time";
export interface ScheduleRule {
  readonly id: string;
  readonly periodicity: number;
  readonly kind: "elapsed";
  readonly stepMs: number;
  readonly anchor: "dates.start";
  readonly evidence: string;
  readonly scope: "fixture" | "api-contract";
  readonly status: "verified" | "hypothesis";
}
export interface SchedulePolicy {
  readonly id: string;
  readonly rules: readonly ScheduleRule[];
  readonly domain: "api" | "fixture";
  readonly positiveHoursEvidence?: string;
}
// Original CleverVet hourly summary: rounded start; positive N hours; zero = one 60-minute window.
function hourlyRule(
  periodicity: number,
  domain: "api" | "fixture",
  evidence: string,
): ScheduleRule {
  return Object.freeze({
    id: `${domain}-every-${periodicity}-hours`,
    periodicity,
    kind: "elapsed" as const,
    stepMs: periodicity * HOUR,
    anchor: "dates.start" as const,
    evidence,
    scope: domain === "api" ? ("api-contract" as const) : ("fixture" as const),
    status: "verified" as const,
  });
}
const API_EVIDENCE =
  "Original CleverVet Ss/Vl + ga + KR: rounded dates.start; positive N hourly windows; zero one 60-minute window";
export const API_SCHEDULE_POLICY: SchedulePolicy = Object.freeze({
  id: "api-original-hourly-summary-v037",
  domain: "api" as const,
  positiveHoursEvidence: API_EVIDENCE,
  rules: Object.freeze(
    [0, 1, 5, 24].map((n) => hourlyRule(n, "api", API_EVIDENCE)),
  ),
});
export const DEMO_SCHEDULE_POLICY: SchedulePolicy = Object.freeze({
  id: "synthetic-original-hourly-summary-v037",
  domain: "fixture" as const,
  positiveHoursEvidence:
    "Synthetic fixture following the original hourly summary algorithm",
  rules: Object.freeze(
    [0, 1, 5, 24].map((n) =>
      hourlyRule(n, "fixture", "Synthetic fixture contract"),
    ),
  ),
});
function ruleFor(
  value: unknown,
  policy: SchedulePolicy,
): ScheduleRule | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return;
  const known = policy.rules.find(
    (r) =>
      r.periodicity === value &&
      r.status === "verified" &&
      r.scope === (policy.domain === "api" ? "api-contract" : "fixture"),
  );
  return (
    known ??
    (policy.positiveHoursEvidence
      ? hourlyRule(value, policy.domain, policy.positiveHoursEvidence)
      : undefined)
  );
}
export interface RuleComparison {
  ruleId: string;
  periodicity: number;
  observed: number;
  matched: number;
  contradictions: number;
  unplaced: number;
}
export interface WorkItem {
  key: string;
  index: IndexedChain;
  revision: Revision;
  at: number;
  entry?: Entry;
  ruleId: string;
}
export interface ScheduleIssue {
  key: string;
  index: IndexedChain;
  revision?: Revision;
  reasons: string[];
}
export interface PatientSchedule {
  slots: WorkItem[];
  tasks: WorkItem[];
  issues: ScheduleIssue[];
  totalChains: number;
  complete: boolean;
}
export function compareRule(
  index: IndexedChain,
  rule: ScheduleRule,
  zone = "UTC",
): RuleComparison {
  const result: RuleComparison = {
    ruleId: rule.id,
    periodicity: rule.periodicity,
    observed: 0,
    matched: 0,
    contradictions: 0,
    unplaced: 0,
  };
  for (const revision of index.chain.elements) {
    if (
      revision.start === null ||
      !Number.isFinite(revision.start) ||
      revision.periodicity !== rule.periodicity
    )
      continue;
    for (const value of revision.results) {
      if (value.at === null) {
        result.unplaced++;
        continue;
      }
      result.observed++;
      const match = hasScheduledTaskOn(revision, value.at, zone);
      if (match) result.matched++;
      else result.contradictions++;
    }
  }
  return result;
}
export function compareSchedules(
  indexes: IndexedChain[],
  zone = "UTC",
): RuleComparison[] {
  const values = [
    ...new Set(
      indexes.flatMap((index) =>
        index.chain.elements
          .filter((r) => r.start !== null && Number.isFinite(r.start))
          .map((r) => r.periodicity),
      ),
    ),
  ]
    .filter(
      (n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0,
    )
    .sort((a, b) => a - b);
  return values
    .map((value) => ruleFor(value, API_SCHEDULE_POLICY)!)
    .map((rule) =>
      indexes.reduce(
        (sum, index) => {
          const n = compareRule(index, rule, zone);
          return {
            ...sum,
            observed: sum.observed + n.observed,
            matched: sum.matched + n.matched,
            contradictions: sum.contradictions + n.contradictions,
            unplaced: sum.unplaced + n.unplaced,
          };
        },
        {
          ruleId: rule.id,
          periodicity: rule.periodicity,
          observed: 0,
          matched: 0,
          contradictions: 0,
          unplaced: 0,
        },
      ),
    );
}
// Default API column key; the UI passes its explicitly selected IANA zone.
export const apiHourColumn = (at: number) => Math.floor(at / HOUR) * HOUR;
export const currentHourStart = hourStart;

export function treatmentRange(patient: Patient): TimeRange | null {
  if (!patient.sheets.length) return null;
  const start =
    patient.treatmentStart ?? Math.min(...patient.sheets.map((s) => s.start));
  const end = Math.max(...patient.sheets.map((s) => s.end));
  return end > start ? { start, end } : null;
}

export function summaryForHour(
  schedule: PatientSchedule,
  at: number,
  now: number,
  zone = "UTC",
): HourSummary {
  const slots = schedule.slots.filter((s) => s.at === at);
  return summarizeCounts(
    slots.length,
    slots.filter((s) => !s.entry).length,
    at,
    now,
    zone,
  );
}

export function buildPatientSchedule(
  indexes: IndexedChain[],
  patient: Patient,
  period: Period | null,
  policy: SchedulePolicy,
  category = "ALL",
  zone = "UTC",
): PatientSchedule {
  const output: PatientSchedule = {
    slots: [],
    tasks: [],
    issues: [],
    totalChains: 0,
    complete: true,
  };
  const treatment = treatmentRange(patient);
  const columns = period ? hourColumns(period, zone) : [];
  for (const index of indexes) {
    if (category !== "ALL" && index.chain.type !== category) continue;
    output.totalChains++;
    const reasons = new Set<string>();
    const affected = new Set<Revision>();
    const problem = (reason: string, revision?: Revision) => {
      reasons.add(reason);
      if (revision) affected.add(revision);
    };
    // Inference is used only to locate warnings about incomplete history. The original
    // listForStat flattens revisions: parentId does NOT shorten their explicit dates.
    const intervals = scheduleIntervals(index);
    if (!intervals.length) problem("Цепочка не содержит редакций.");
    const marks = new Map<string, Entry>();
    for (const entry of index.entries) {
      const key = JSON.stringify([entry.revision.id, entry.result.at]);
      if (!marks.has(key)) marks.set(key, entry); // Bc.filledAt: first exact result, any status.
    }
    for (const interval of intervals) {
      const revision = interval.revision;
      // An inactive cell is a normal API state, not an incomplete schedule.
      // Skip before period/rule/end/result validation; never reconstruct its start.
      const kind = classifySchedule(revision);
      if (kind === "INACTIVE" || kind === "MANUAL_AS_NEEDED") continue;
      if (revision.start === null) continue;
      const warningRelevant =
        !period ||
        ((interval.start === null ||
          hourStart(interval.start, zone) < period.end) &&
          (interval.end === null ||
            interval.end > hourStart(period.start, zone)));
      const fail = (reason: string) => {
        if (warningRelevant) problem(reason, revision);
      };
      if (!period || !columns.length) {
        fail("Не определён допустимый выбранный интервал.");
        continue;
      }
      if (revision.end !== null && revision.end <= columns[0]) continue;
      const rule = ruleFor(revision.periodicity, policy);
      if (!rule || !rule.evidence) {
        fail("Правило dates.periodicity не подтверждено.");
        continue;
      }
      if (
        (revision.rawEnd && revision.end === null) ||
        (revision.end !== null &&
          (revision.endSource !== "endDate" || revision.end < revision.start))
      ) {
        fail("Не подтверждено корректное endDate редакции.");
        continue;
      }
      if (index.chain.elements.filter((r) => r.id === revision.id).length > 1) {
        fail(
          "Повторяются идентификаторы редакций; сопоставление отметок неоднозначно.",
        );
        continue;
      }
      if (!treatment) {
        fail("Не определён период лечения пациента по данным карты и листов.");
        continue;
      }
      if (index.unplaced.some((e) => e.revision.id === revision.id))
        fail(
          "У редакции есть отметка с неоднозначным hour; она не закрывает часовой слот.",
        );
      const anchor = hourStart(revision.start, zone);
      for (const at of columns) {
        if (
          !overlapsHour(treatment, at) ||
          (revision.end !== null && at >= revision.end) ||
          !scheduleWindowContains(anchor, rule.periodicity, at)
        )
          continue;
        const entry = marks.get(JSON.stringify([revision.id, at]));
        output.slots.push({
          key: JSON.stringify([index.chain.id, revision.id, at]),
          index,
          revision,
          at,
          entry,
          ruleId: rule.id,
        });
      }
    }
    if (reasons.size)
      output.issues.push({
        key: index.chain.id,
        index,
        revision: affected.size === 1 ? [...affected][0] : undefined,
        reasons: [...reasons],
      });
  }
  output.slots.sort((a, b) => a.at - b.at);
  output.tasks = output.slots.filter((item) => !item.entry);
  output.complete = output.issues.length === 0;
  return output;
}
export type TimeBucket = "overdue" | "current" | "next" | "later";
export function timeBucket(at: number, now: number, zone: string): TimeBucket {
  const start = currentHourStart(now, zone);
  return at < start
    ? "overdue"
    : at < start + HOUR
      ? "current"
      : at < start + 2 * HOUR
        ? "next"
        : "later";
}
