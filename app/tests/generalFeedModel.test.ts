import { describe, expect, it } from 'vitest';
import { feedSlot } from '../src/generalFeedModel';
import type { WorkItem } from '../src/scheduleEngine';
function item(statuses: string[]): WorkItem {
 const revision = { id: 'r' };
 return { key:'x', at:100, ruleId:'r', revision, index:{entries:statuses.map(status=>({revision,result:{at:100,status}}))} } as unknown as WorkItem;
}
describe('general feed status presentation', () => {
 it.each([[[], 'unmarked'], [['EXECUTED'], 'executed'], [['NOT_EXECUTED'], 'notExecuted'], [['OTHER'], 'unknown'], [['EXECUTED','OTHER'], 'unknown'], [['EXECUTED','NOT_EXECUTED'], 'unknown'], [['EXECUTED','EXECUTED'], 'executed']] as const)('%j → %s', (statuses,state) => expect(feedSlot(item([...statuses])).state).toBe(state));
});

import { manualFeedResults } from '../src/generalFeedModel';
import type { IndexedChain } from '../src/model';
function manual(statuses: [number, string][], periodicity: number | null | undefined = null): IndexedChain {
 const revision = {id:'revision', start:0, periodicity};
 return {chain:{id:'chain'}, entries:statuses.map(([at,status], i)=>({revision, result:{id:`result-${i}`,at,status}}))} as unknown as IndexedChain;
}
describe('manual results use actual timestamps only', () => {
 it('does not create an event without a result', () => expect(manualFeedResults(manual([]),0,200)).toEqual([]));
 it('groups conflicting results once and preserves identities', () => {
  const rows=manualFeedResults(manual([[100,'EXECUTED'],[100,'OTHER']]),0,200);
  expect(rows).toHaveLength(1); expect(rows[0].state).toBe('unknown');
  expect(rows[0].entries.map(e=>e.result.id)).toEqual(['result-0','result-1']);
 });
 it('includes unknown results on both sides of midnight only within the selected period', () => {
  const midnight=Date.parse('2026-10-19T00:00:00Z');
  const rows=manualFeedResults(manual([[midnight-1,'OTHER'],[midnight,'OTHER'],[midnight+1,'OTHER']]),midnight-1,midnight+1);
  expect(rows.map(r=>r.at)).toEqual([midnight-1,midnight]);
 });
 it('does not add periodic results as manual events', () => expect(manualFeedResults(manual([[100,'OTHER']],0),0,200)).toEqual([]));
 it('classifies known results without creating pending work', () => expect(manualFeedResults(manual([[100,'EXECUTED'],[101,'NOT_EXECUTED']]),0,200).map(r=>r.state)).toEqual(['executed','notExecuted']));
});
