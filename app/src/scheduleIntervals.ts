import type { IndexedChain, Revision } from "./model";

export interface ScheduleInterval {
  revision: Revision;
  start: number | null;
  end: number | null;
  reasons: string[];
}

// Resolve only temporal ownership. Missing historical fields are not chain-wide vetoes.
export function scheduleIntervals(index: IndexedChain): ScheduleInterval[] {
  const revisions = index.chain.elements;
  const byId = new Map<string, Revision[]>();
  const children = new Map<string, Revision[]>();
  for (const revision of revisions) {
    byId.set(revision.id, [...(byId.get(revision.id) ?? []), revision]);
    if (revision.parentId)
      children.set(revision.parentId, [
        ...(children.get(revision.parentId) ?? []),
        revision,
      ]);
  }
  return revisions.map((revision) => {
    const reasons: string[] = [];
    const nextStarts: number[] = [];
    // A dated descendant can close an undated ancestor, even through an undated edit.
    const visit = (current: Revision, path: Set<Revision>) => {
      for (const child of children.get(current.id) ?? []) {
        if (path.has(child)) {
          if (child === revision)
            reasons.push(
              "В рассматриваемой последовательности редакций найден цикл.",
            );
          continue;
        }
        if (child.start !== null) nextStarts.push(child.start);
        else visit(child, new Set([...path, child]));
      }
    };
    visit(revision, new Set([revision]));
    // Detect cycles in the ancestry, including dated nodes at which visit stops.
    let current: Revision | undefined = revision;
    const ancestors = new Set<Revision>();
    const ancestry: Revision[] = [];
    while (current) {
      if (ancestors.has(current)) {
        if (ancestry.slice(ancestry.indexOf(current)).includes(revision))
          reasons.push(
            "В рассматриваемой последовательности редакций найден цикл.",
          );
        break;
      }
      ancestors.add(current);
      ancestry.push(current);
      current = byId.get(current.parentId)?.[0];
    }
    if ((byId.get(revision.id)?.length ?? 0) > 1)
      reasons.push("Повторяются идентификаторы рассматриваемых редакций.");
    const successor = nextStarts.length ? Math.min(...nextStarts) : null;
    const end =
      revision.end === null
        ? successor
        : successor === null
          ? revision.end
          : Math.min(revision.end, successor);
    if (
      revision.start !== null &&
      successor !== null &&
      successor < revision.start
    )
      reasons.push("Начало дочерней редакции раньше начала родительской.");
    const parent = byId.get(revision.parentId)?.[0];
    if (
      revision.start !== null &&
      parent?.start !== null &&
      parent?.start !== undefined &&
      parent.start > revision.start
    )
      reasons.push("Последовательность начал редакций противоречива.");
    if (revision.rawEnd && revision.end === null)
      reasons.push("Не удалось определить явно указанное окончание редакции.");
    if (revision.end !== null && revision.endSource !== "endDate")
      reasons.push(
        "Источник окончания редакции не подтверждён: требуется endDate.",
      );
    if (revision.start !== null && end !== null && end < revision.start)
      reasons.push("Окончание редакции раньше начала.");
    return {
      revision,
      start: revision.start,
      end,
      reasons: [...new Set(reasons)],
    };
  });
}
