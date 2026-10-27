import { ApiError, safeError } from "./api";
import {
  cardState,
  normalizeChains,
  instant,
  obj,
  type Chain,
  type Patient,
  type Revision,
  type Obj,
} from "./model";
import type { Source } from "./source";
import type { PrescriptionApi } from "./prescriptionApi";
import { newResultId } from "./resultWriter";
import { hourStart } from "./hourlySummary";
import { HOUR, validZone } from "./time";
import { isResultColor } from "./resultColors";
import {
  CONCENTRATION_SUBSTANCES,
  CONCENTRATION_VOLUMES,
  DOSAGE_SUBSTANCES,
  DOSAGE_VOLUMES,
  PRESCRIPTION_TIMES,
  PRESCRIPTION_ROUTES,
  ROUTES_BY_VOLUME,
} from "./prescriptionCatalog";
export type PrescriptionType = "MEDICATION" | "NURSING";
export type PrescriptionAction =
  | "revise"
  | "finish"
  | "deleteRevision"
  | "deleteChain";
export interface PrescriptionDraft {
  name: string;
  type: PrescriptionType;
  start: string;
  periodicity: number | null;
  color: string;
  instruction: string;
  specifics?: Obj;
  zone: string;
}
export interface PrescriptionPayload {
  id: string;
  color: string;
  instruction: string;
  dates: { start: string; periodicity?: number };
  specifics?: Obj;
  results: never[];
  parentId?: string;
  creationDate: string;
}
export interface NewPrescriptionChain {
  id: string;
  name: string;
  type: PrescriptionType;
  prescription: PrescriptionPayload;
}
export interface PrescriptionReceipt {
  patient: Patient;
  chains: Chain[];
}
export class PrescriptionError extends Error {
  constructor(
    public kind:
      | "Disabled"
      | "Busy"
      | "Invalid"
      | "Conflict"
      | "History"
      | "Unavailable"
      | "Partial"
      | "Unverified",
    public snapshot?: Chain[],
    public causeError?: unknown,
  ) {
    super(kind);
    this.name = "PrescriptionError";
  }
}
export function prescriptionError(e: unknown) {
  if (!(e instanceof PrescriptionError)) return safeError(e);
  return (
    {
      Disabled: "Редактирование отключено.",
      Busy: "Дождитесь завершения предыдущего действия.",
      Invalid: "Проверьте обязательные поля, числа и единицы.",
      Conflict:
        "Назначение изменилось. Обновите данные и откройте форму заново.",
      History:
        "Удаление недоступно: есть отметки, дочерние редакции или заблокированная история.",
      Unavailable: "Период действия или доступность листа не подтверждены.",
      Partial:
        "Предыдущая редакция завершена, но новая редакция не подтверждена. Показано перечитанное состояние. Проверьте назначение перед дальнейшими действиями.",
      Unverified:
        "Изменение не подтверждено. Сервер мог принять запрос. Обновите данные и проверьте назначение перед повтором.",
    }[e.kind] +
    (e.causeError instanceof ApiError
      ? ` ${e.causeError.kind === "Http" ? "Сервер отклонил запрос." : safeError(e.causeError)}`
      : "")
  );
}
const positive = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v > 0;
function validQuantity(
  value: unknown,
  substances: object,
  volumes: object,
  timeAllowed: boolean,
) {
  const q = obj(value),
    u = obj(q.units);
  return (
    positive(q.value) &&
    Object.hasOwn(substances, String(u.substance)) &&
    Object.hasOwn(volumes, String(u.volume)) &&
    (!timeAllowed
      ? u.time == null
      : u.time == null || Object.hasOwn(PRESCRIPTION_TIMES, String(u.time)))
  );
}
export function draftProblem(
  d: PrescriptionDraft,
  existingColor?: string,
): string | null {
  if (
    !validZone(d.zone) ||
    !["MEDICATION", "NURSING"].includes(d.type) ||
    !d.name.trim() ||
    instant(d.start) === null ||
    !(
      isResultColor(d.color) ||
      (!!existingColor?.trim() && d.color === existingColor)
    ) ||
    typeof d.instruction !== "string" ||
    !(
      d.periodicity === null ||
      (typeof d.periodicity === "number" &&
        Number.isFinite(d.periodicity) &&
        d.periodicity >= 0)
    )
  )
    return "Проверьте название, начало, периодичность и цвет.";
  if (d.type === "NURSING")
    return d.specifics === undefined
      ? null
      : "У процедуры не должно быть лекарственных параметров.";
  const s = obj(d.specifics),
    den = obj(obj(s.concentration).units).volume;
  if (
    !validQuantity(
      s.concentration,
      CONCENTRATION_SUBSTANCES,
      CONCENTRATION_VOLUMES,
      false,
    ) ||
    !validQuantity(s.dosage, DOSAGE_SUBSTANCES, DOSAGE_VOLUMES, true) ||
    !Object.hasOwn(PRESCRIPTION_ROUTES, String(s.route)) ||
    !ROUTES_BY_VOLUME[String(den)]?.includes(String(s.route)) ||
    !["DOSAGE", "TOTAL_SUBSTANCE", "TOTAL_VOLUME"].includes(String(s.viewMode))
  )
    return "Проверьте концентрацию, дозировку, единицы и путь введения.";
  if (
    (obj(obj(s.dosage).units).volume === "KILOGRAM" && !positive(s.weightKg)) ||
    (s.weightKg != null && !positive(s.weightKg))
  )
    return "Укажите корректную массу для расчёта.";
  return null;
}
export function makePrescription(
  d: PrescriptionDraft,
  parentId?: string,
  existingColor?: string,
): PrescriptionPayload {
  if (draftProblem(d, existingColor)) throw new PrescriptionError("Invalid");
  return {
    id: newResultId(),
    color: d.color,
    instruction: d.instruction,
    dates: {
      start: new Date(instant(d.start)!).toISOString(),
      ...(d.periodicity === null ? {} : { periodicity: d.periodicity }),
    },
    ...(d.type === "MEDICATION"
      ? { specifics: structuredClone(d.specifics) }
      : {}),
    results: [],
    ...(parentId ? { parentId } : {}),
    creationDate: new Date().toISOString(),
  };
}
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => JSON.stringify(k) + ":" + canonical(x))
          .join(",")}}`
      : (JSON.stringify(v) ?? "undefined");
// Compare instants, not equivalent ISO spellings returned by different serializers.
const chainState = (chain: Chain) =>
  canonical({
    ...chain,
    elements: chain.elements.map((r) => ({
      ...r,
      rawStart: r.start ?? r.rawStart,
      rawEnd: r.end ?? r.rawEnd,
      created: instant(r.created) ?? r.created,
      results: [...r.results]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((x) => ({
          ...x,
          hour: x.at ?? x.hour,
          created: instant(x.created) ?? x.created,
        })),
    })),
  });
const chainsState = (chains: Chain[]) =>
  [...chains]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(chainState)
    .join("\n");
export function deletionProblem(
  chain: Chain,
  revisionOnly = false,
): string | null {
  const last = chain.elements.at(-1);
  if (
    !last ||
    (revisionOnly && chain.elements.length < 2) ||
    (revisionOnly && chain.elements.some((r) => r.parentId === last.id)) ||
    (revisionOnly ? [last] : chain.elements).some((r) => r.results.length > 0)
  )
    return "Удаление недоступно: есть отметки или удаляется не последняя редакция.";
  return null;
}
export function earliestRevisionEnd(r: Revision, zone: string): number | null {
  if (r.start === null || r.results.some((x) => x.at === null)) return null;
  return r.results.reduce(
    (min, x) => Math.max(min, x.at! + HOUR),
    hourStart(r.start, zone) + HOUR,
  );
}
export interface PrescriptionService {
  setEnabled(v: boolean): void;
  create(
    patient: Patient,
    draft: PrescriptionDraft,
  ): Promise<PrescriptionReceipt>;
  revise(
    patient: Patient,
    chain: Chain,
    draft: PrescriptionDraft,
  ): Promise<PrescriptionReceipt>;
  finish(
    patient: Patient,
    chain: Chain,
    end: string,
    zone: string,
  ): Promise<PrescriptionReceipt>;
  deleteRevision(patient: Patient, chain: Chain): Promise<PrescriptionReceipt>;
  deleteChain(patient: Patient, chain: Chain): Promise<PrescriptionReceipt>;
  close(): void;
}
export function createPrescriptionService(
  reader: Source,
  api: PrescriptionApi,
  readPatient: (p: Patient, s: AbortSignal) => Promise<Patient>,
): PrescriptionService {
  let enabled = false,
    closed = false,
    busy: AbortController | null = null;
  async function change(
    patient: Patient,
    action: "create" | PrescriptionAction,
    original?: Chain,
    draft?: PrescriptionDraft,
    end?: string,
    zone = "Europe/Moscow",
  ): Promise<PrescriptionReceipt> {
    if (closed || !enabled) throw new PrescriptionError("Disabled");
    if (busy) throw new PrescriptionError("Busy");
    if (draft && draftProblem(draft, original?.elements.at(-1)?.color))
      throw new PrescriptionError("Invalid");
    const signalController = new AbortController();
    busy = signalController;
    const signal = signalController.signal;
    let sent = false,
      finished = false,
      before: Chain[] = [];
    let freshPatient = patient;
    const checkEnabled = () => {
      if (closed || !enabled || signal.aborted)
        throw new PrescriptionError("Disabled");
    };
    const read = () => reader.chains(patient.cardId, signal, true);
    try {
      freshPatient = await readPatient(patient, signal);
      if (
        freshPatient.id !== patient.id ||
        freshPatient.cardId !== patient.cardId ||
        cardState(freshPatient) !== "active"
      )
        throw new PrescriptionError("Unavailable");
      before = await read();
      checkEnabled();
      const matches = before.filter((c) => c.id === original?.id),
        chain = matches[0],
        last = chain?.elements.at(-1);
      if (
        action !== "create" &&
        (!original ||
          matches.length !== 1 ||
          chainState(chain) !== chainState(original) ||
          !last?.idConfirmed ||
          chain.elements.filter((r) => r.id === last.id).length !== 1)
      )
        throw new PrescriptionError("Conflict");
      if (chain && !["MEDICATION", "NURSING"].includes(chain.type))
        throw new PrescriptionError("Unavailable");
      if (
        last &&
        ((last.rawEnd && last.end === null) ||
          (last.end !== null && last.endSource !== "endDate"))
      )
        throw new PrescriptionError("Unavailable");
      let time = instant(draft?.start ?? end ?? "");
      if (action.startsWith("delete")) time = Date.now();
      if (time === null || !Number.isFinite(time))
        throw new PrescriptionError("Invalid");
      const ending = action === "finish" || action === "revise";
      const sheets = freshPatient.sheets.filter((s) =>
        ending
          ? s.start < time! && time! <= s.end
          : s.start <= time! && time! < s.end,
      );
      if (
        sheets.length !== 1 ||
        sheets[0].source !== "direct" ||
        sheets[0].locked !== false
      )
        throw new PrescriptionError("Unavailable");
      if (ending) {
        const minimum = earliestRevisionEnd(last!, draft?.zone ?? zone);
        if (
          minimum === null ||
          last!.end !== null ||
          time < minimum ||
          time !== hourStart(time, draft?.zone ?? zone)
        )
          throw new PrescriptionError("Unavailable");
      }
      if (
        action === "revise" &&
        (draft!.type !== chain!.type || draft!.name !== chain!.name)
      )
        throw new PrescriptionError("Invalid");
      if (action.startsWith("delete")) {
        if (deletionProblem(chain!, action === "deleteRevision"))
          throw new PrescriptionError("History");
        const affected =
          action === "deleteRevision" ? [last!] : chain!.elements;
        if (
          affected.some(
            (r) =>
              r.start !== null &&
              freshPatient.sheets.some(
                (s) =>
                  s.locked !== false &&
                  s.start < (r.end ?? Infinity) &&
                  s.end > r.start!,
              ),
          )
        )
          throw new PrescriptionError("History");
      }
      const replacement =
        action === "revise"
          ? makePrescription(draft!, last!.id, last!.color)
          : undefined;
      if (
        replacement &&
        before.some(
          (c) =>
            c.id === replacement.id ||
            c.elements.some((r) => r.id === replacement.id),
        )
      )
        throw new PrescriptionError("Conflict");
      let expected = structuredClone(before);
      if (action === "create") {
        const body: NewPrescriptionChain = {
          id: newResultId(),
          name: draft!.name.trim(),
          type: draft!.type,
          prescription: makePrescription(draft!),
        };
        if (
          before.some(
            (c) =>
              c.id === body.id ||
              c.elements.some((r) => r.id === body.prescription.id),
          ) ||
          body.id === body.prescription.id
        )
          throw new PrescriptionError("Conflict");
        expected.push(
          normalizeChains([{ ...body, elements: [body.prescription] }])[0],
        );
        checkEnabled();
        sent = true;
        await api.create(patient.cardId, body, signal);
      } else if (ending) {
        const iso = new Date(time).toISOString(),
          expectedChain = expected.find((c) => c.id === chain!.id)!;
        const expectedLast = expectedChain.elements.at(-1)!;
        expectedLast.end = time;
        expectedLast.rawEnd = iso;
        expectedLast.endSource = "endDate";
        checkEnabled();
        sent = true;
        await api.finish(patient.cardId, chain!.id, last!.id, iso, signal);
        finished = true;
        const stopped = await read();
        if (chainsState(stopped) !== chainsState(expected))
          throw new PrescriptionError("Unverified", stopped);
        if (action === "revise") {
          const payload = replacement!;
          expectedChain.elements.push(
            normalizeChains([{ id: chain!.id, elements: [payload] }])[0]
              .elements[0],
          );
          checkEnabled();
          await api.addRevision(patient.cardId, chain!.id, payload, signal);
        } else return { patient: freshPatient, chains: stopped };
      } else if (action === "deleteRevision") {
        expected.find((c) => c.id === chain!.id)!.elements.pop();
        checkEnabled();
        sent = true;
        await api.deleteRevision(patient.cardId, chain!.id, last!.id, signal);
      } else {
        expected = expected.filter((c) => c.id !== chain!.id);
        checkEnabled();
        sent = true;
        await api.deleteChain(patient.cardId, chain!.id, signal);
      }
      const verified = await read();
      if (
        closed ||
        signal.aborted ||
        chainsState(verified) !== chainsState(expected)
      )
        throw new PrescriptionError("Unverified", verified);
      return { patient: freshPatient, chains: verified };
    } catch (e) {
      if (!sent) throw e;
      let snapshot: Chain[] | undefined;
      try {
        snapshot = await read();
      } catch {
        /* Unverified state must never be represented as success. */
      }
      if (finished && action === "revise")
        throw new PrescriptionError("Partial", snapshot, e);
      if (e instanceof PrescriptionError && e.kind === "Unverified")
        throw new PrescriptionError("Unverified", snapshot, e.causeError);
      if (
        e instanceof ApiError &&
        [401, 403, 409, 412].includes(e.status ?? 0)
      ) {
        if (snapshot && chainsState(snapshot) === chainsState(before)) throw e;
      }
      throw new PrescriptionError("Unverified", snapshot, e);
    } finally {
      if (busy === signalController) busy = null;
    }
  }
  return {
    setEnabled(v) {
      enabled = v && !closed;
      if (!enabled) busy?.abort();
    },
    create: (p, d) => change(p, "create", undefined, d),
    revise: (p, c, d) => change(p, "revise", c, d),
    finish: (p, c, e, z) => change(p, "finish", c, undefined, e, z),
    deleteRevision: (p, c) => change(p, "deleteRevision", c),
    deleteChain: (p, c) => change(p, "deleteChain", c),
    close() {
      closed = true;
      enabled = false;
      busy?.abort();
      api.close();
    },
  };
}
