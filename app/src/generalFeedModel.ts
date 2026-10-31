import type { Entry } from './model';
import type { WorkItem } from './scheduleEngine';

export type FeedState = 'unmarked' | 'executed' | 'notExecuted' | 'unknown';
export interface FeedSlot { slot: WorkItem; entries: Entry[]; state: FeedState }
/** Preserve conflicting and unsupported results for review instead of marking them complete. */
export function feedSlot(slot: WorkItem): FeedSlot {
  const entries = slot.index.entries.filter(e => e.revision.id === slot.revision.id && e.result.at === slot.at);
  const statuses = new Set(entries.map(e => e.result.status));
  const state: FeedState = !entries.length ? 'unmarked' : statuses.size !== 1 ? 'unknown' : statuses.has('EXECUTED') ? 'executed' : statuses.has('NOT_EXECUTED') ? 'notExecuted' : 'unknown';
  return { slot, entries, state };
}

import type { IndexedChain, Revision } from './model';
import { classifySchedule } from './hourlySummary';

export interface ManualFeedResult {
  key: string;
  index: IndexedChain;
  revision: Revision;
  at: number;
  entries: Entry[];
  state: FeedState;
}
/** Only actual results become rows; manual prescriptions without a result create no task. */
export function manualFeedResults(index: IndexedChain, start: number, end: number): ManualFeedResult[] {
  const groups = new Map<string, ManualFeedResult>();
  for (const entry of index.entries) {
    const at = entry.result.at;
    if (at === null || at < start || at >= end || classifySchedule(entry.revision) !== 'MANUAL_AS_NEEDED') continue;
    const key = JSON.stringify([index.chain.id, entry.revision.id, at]);
    const group = groups.get(key) ?? { key, index, revision: entry.revision, at, entries: [], state: 'unknown' as FeedState };
    group.entries.push(entry);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const statuses = new Set(group.entries.map(entry => entry.result.status));
    group.state = statuses.size !== 1 ? 'unknown' : statuses.has('EXECUTED') ? 'executed' : statuses.has('NOT_EXECUTED') ? 'notExecuted' : 'unknown';
  }
  return [...groups.values()].sort((a, b) => a.at - b.at);
}
