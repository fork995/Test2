import { instant, obj, text } from "./model";
import { addDay, zonedStart } from "./time";
export const ARCHIVE_PAGE_SIZE = 30;
export interface ArchiveRecord {
  id: string;
  patientId: string;
  name: string;
  number: string;
  owner: string;
  hospital: string;
  diagnoses: string;
  start: number | null;
  end: number | null;
  result: string;
  departmentId: string;
  department: string;
  arrivalDepartment: string;
}
export interface ArchiveQuery {
  search: string;
  result: string;
  hospital: string;
  department: string;
  dateField: "start" | "end";
  from: string;
  to: string;
}
export const emptyArchiveQuery = (): ArchiveQuery => ({
  search: "",
  result: "",
  hospital: "",
  department: "",
  dateField: "end",
  from: "",
  to: "",
});
export const archiveId = (v: string) =>
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(v);
export function normalizeArchiveRecord(raw: unknown): ArchiveRecord {
  const r = obj(raw),
    p = obj(r.patient),
    o = obj(p.owner),
    t = obj(r.treatment),
    start = obj(t.start),
    end = obj(t.finish),
    dept = obj(obj(end.branch).department),
    arrival = obj(obj(start.branch).department);
  const id = text(r.id),
    patientId = text(p.id);
  if (!archiveId(id) || !archiveId(patientId)) throw Error("ArchiveShape");
  return {
    id,
    patientId,
    name: text(p.name),
    number: text(r.number),
    owner: [text(o.surname), text(o.name), text(o.patronymic)]
      .filter(Boolean)
      .join(" "),
    hospital: text(r.hospital),
    diagnoses: Array.isArray(r.diagnoses)
      ? r.diagnoses.map(text).filter(Boolean).join(", ")
      : "",
    start: instant(start.date),
    end: instant(end.date),
    result: text(end.result),
    departmentId: text(dept.id),
    department: text(dept.name),
    arrivalDepartment: text(arrival.name),
  };
}
const folded = (v: string) =>
  v.trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
/** Filters are local stream predicates, never unconfirmed URL parameters. */
export function archivePredicate(
  q: ArchiveQuery,
  zone: string,
): (r: ArchiveRecord) => boolean {
  if (q.search.length > 256 || q.department.length > 256) throw Error("Query");
  const from = q.from ? zonedStart(q.from, "00:00", zone) : null,
    to = q.to ? zonedStart(addDay(q.to, 1), "00:00", zone) : null;
  if (
    (q.from && from === null) ||
    (q.to && to === null) ||
    (from !== null && to !== null && from >= to)
  )
    throw Error("Query");
  const needle = folded(q.search),
    department = folded(q.department);
  return (r) =>
    (!needle ||
      [r.name, r.owner, r.number].some((v) => folded(v).includes(needle))) &&
    (!q.result || r.result === q.result) &&
    (!q.hospital || r.hospital === q.hospital) &&
    (!department || folded(r.department).includes(department)) &&
    ((from === null && to === null) ||
      (r[q.dateField] !== null &&
        (from === null || r[q.dateField]! >= from) &&
        (to === null || r[q.dateField]! < to)));
}
export interface ArchiveProgress {
  bytes: number;
  scanned: number;
  matched: number;
}
export interface ArchivePage extends ArchiveProgress {
  rows: ArchiveRecord[];
  page: number;
  complete: true;
}
