import type { ArchiveApi } from "./archiveApi";
import {
  archivePredicate,
  ARCHIVE_PAGE_SIZE,
  type ArchiveRecord,
} from "./archiveModel";
import { ApiError } from "./api";
import { normalizeChains, normalizePatients } from "./model";
/** Invented archive, generated one summary at a time; never contacts any server. */
export function createMockArchive(): ArchiveApi {
  let closed = false;
  const end = Math.floor(Date.now() / 86400000) * 86400000,
    check = (s: AbortSignal) => {
      if (closed || s.aborted) throw new ApiError("Cancelled");
    };
  function row(n: number): ArchiveRecord {
    return {
      id: `archive-card-${n}`,
      patientId: `archive-patient-${n}`,
      name: `ДЕМО · Архив ${n + 1}`,
      number: `УЧ-${n + 1}`,
      owner: "Учебный Вымышленный Владелец",
      hospital: "ROUND_THE_CLOCK",
      diagnoses: "Вымышленный диагноз для демонстрации",
      start: end - (n + 2) * 86400000,
      end: end - n * 86400000,
      result: n % 3 === 0 ? "INTERRUPTED_BY_OWNER" : "DISCHARGED",
      departmentId: "demo-department",
      department: "Стационар",
      arrivalDepartment: "Стационар",
    };
  }
  return {
    async page(branch, q, page, zone, s, progress) {
      check(s);
      const match = archivePredicate(q, zone),
        rows: ArchiveRecord[] = [];
      let matched = 0,
        scanned = 0;
      for (let n = 0; branch === "demo-branch" && n < 125; n++) {
        const r = row(n);
        scanned++;
        if (match(r)) {
          if (
            matched >= page * ARCHIVE_PAGE_SIZE &&
            rows.length < ARCHIVE_PAGE_SIZE
          )
            rows.push(r);
          matched++;
        }
      }
      progress?.({ bytes: 0, scanned, matched });
      return { rows, matched, scanned, bytes: 0, page, complete: true };
    },
    async patient(_branch, r, s) {
      check(s);
      return normalizePatients([
        {
          id: r.patientId,
          name: r.name,
          species: "Кошка",
          breed: "Метис",
          photo: "demo-illustration",
          weightKg: 4,
          owner: { surname: "Учебный", name: "Вымышленный Владелец" },
          severity: "SATISFACTORY",
          card: {
            id: r.id,
            status: "ARCHIVED",
            hospital: r.hospital,
            diagnoses: [r.diagnoses],
            treatment: {
              start: new Date(r.start!).toISOString(),
              end: new Date(r.end!).toISOString(),
              sheets: [
                {
                  id: `${r.id}-sheet`,
                  start: new Date(r.start!).toISOString(),
                  end: new Date(r.start! + 86400000).toISOString(),
                  locked: true,
                },
              ],
            },
          },
        },
      ])[0];
    },
    async chains(card, s) {
      check(s);
      const n = Number(card.replace("archive-card-", "")),
        r = row(n),
        stamp = (h: number) => new Date(r.start! + h * 3600000).toISOString();
      return normalizeChains([
        {
          id: `${card}-chain`,
          name: "Учебный контроль",
          type: "MONITORING",
          elements: [
            {
              id: `${card}-revision`,
              color: "yellow",
              dates: { start: stamp(0), periodicity: 8 },
              endDate: stamp(24),
              results: [
                {
                  id: `${card}-result`,
                  status: "EXECUTED",
                  hour: stamp(8),
                  comment: "Учебная отметка",
                  creationDate: stamp(9),
                },
                {
                  id: `${card}-not-result`,
                  status: "NOT_EXECUTED",
                  reason: "ORGANIZATIONAL",
                  hour: stamp(16),
                  creationDate: stamp(17),
                },
              ],
            },
          ],
        },
      ]);
    },
    async belongings(_patient, s) {
      check(s);
      return [
        {
          id: "demo-archive-thing",
          name: "Учебная миска",
          receivingDate: new Date(end - 172800000).toISOString().slice(0, 10),
          status: "RETURNED",
          returnDate: new Date(end).toISOString().slice(0, 10),
          comment: "Вымышленная вещь",
          creationDate: new Date(end - 172800000).toISOString(),
        },
      ];
    },
    close() {
      closed = true;
    },
  };
}
