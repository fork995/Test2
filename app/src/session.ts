import { createPrescriptionApi, type PrescriptionApi } from "./prescriptionApi";
import { createPrescriptionService } from "./prescriptions";
import { normalizeChains } from "./model";
import { createArchiveApi, type ArchiveApi } from "./archiveApi";
import { createMockArchive } from "./mockArchive";
import { ApiError, createApi } from "./api";
import { createMock, markFetched, type Source } from "./source";
import { createResultTransport } from "./resultTransport";
import { createResultWriter, type ResultTransport } from "./resultWriter";
import { type Chain, instant } from "./model";
import { createDischargeApi, type DischargeApi } from "./dischargeApi";
import { createDischarger } from "./discharge";
import { createTransferApi, type TransferApi } from "./transferApi";
import { createTransferService } from "./transfer";
import { createEntityApi, type EntityApi } from "./entityApi";
import { createEntityService } from "./entities";
import { normalizePatients } from "./model";
import type { Belonging } from "./belongings";
// Session composition keeps the unchanged GET client separate from the mutation transport.
export function createSessionApi(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Source {
  const reader = createApi(token, fetchImpl);
  let session: Source;
  const transport = createResultTransport(token, fetchImpl, () =>
    session.close(),
  );
  const dischargeApi = createDischargeApi(token, fetchImpl, () =>
    session.close(),
  );
  const transferApi = createTransferApi(token, fetchImpl, () =>
    session.close(),
  );
  const entityApi = createEntityApi(token, fetchImpl, () => session.close());
  const archive = createArchiveApi(token, fetchImpl, () => session.close());
  const prescriptionApi = createPrescriptionApi(token, fetchImpl, () =>
    session.close(),
  );
  token = "";
  session = compose(
    reader,
    transport,
    dischargeApi,
    transferApi,
    entityApi,
    archive,
    prescriptionApi,
  );
  return session;
}
function compose(
  reader: Source,
  transport: ResultTransport,
  dischargeApi: DischargeApi,
  transferApi: TransferApi,
  entityApi: EntityApi,
  archive: ArchiveApi,
  prescriptionApi: PrescriptionApi,
): Source {
  const contexts = new Map<string, [string, string]>();
  async function guarded<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof ApiError && error.kind === "Unauthorized") {
        prescriptions.close();
        results.close();
        discharge.close();
        transfer.close();
        entities.close();
        archive.close();
        reader.close();
        contexts.clear();
      }
      throw error;
    }
  }
  const results = createResultWriter(
    transport,
    (card, signal) => guarded(reader.chains(card, signal, true)),
    async (patient, signal) => {
      const context = contexts.get(patient.cardId);
      if (!context) throw new ApiError("InvalidResponse");
      const fresh = await guarded(reader.patients(...context, signal, true));
      const matches = fresh.filter(
        (p) => p.id === patient.id && p.cardId === patient.cardId,
      );
      if (matches.length !== 1) throw new ApiError("InvalidResponse");
      return matches[0];
    },
  );
  const prescriptions = createPrescriptionService(
    reader,
    prescriptionApi,
    async (patient, signal) => {
      const context = contexts.get(patient.cardId);
      if (!context) throw new ApiError("InvalidResponse");
      const fresh = await guarded(reader.patients(...context, signal, true));
      const matches = fresh.filter(
        (p) => p.id === patient.id && p.cardId === patient.cardId,
      );
      if (matches.length !== 1) throw new ApiError("InvalidResponse");
      return matches[0];
    },
  );
  const discharge = createDischarger(reader, dischargeApi, (card) =>
    contexts.get(card),
  );
  const transfer = createTransferService(reader, transferApi, (card) =>
    contexts.get(card),
  );
  const entityService = createEntityService(reader, entityApi, (card) =>
    contexts.get(card),
  );
  const entities = {
    ...entityService,
    async create(...args: Parameters<typeof entityService.create>) {
      const r = await entityService.create(...args);
      contexts.set(r.patient.cardId, [args[0].branchId, args[0].departmentId]);
      return r;
    },
  };
  let closed = false;
  return {
    ...reader,
    results,
    prescriptions,
    discharge,
    transfer,
    entities,
    archive,
    patients: async (branch, department, signal, refresh) => {
      const data = await reader.patients(branch, department, signal, refresh);
      if (!closed)
        data.forEach((p) => contexts.set(p.cardId, [branch, department]));
      return data;
    },
    close() {
      closed = true;
      prescriptions.close();
      results.close();
      discharge.close();
      transfer.close();
      entities.close();
      archive.close();
      reader.close();
      contexts.clear();
    },
  };
}
// Completely local transport for the demonstration; no fetch and no persistent storage.
export function createDemoSession(big = false): Source {
  const base = createMock(big),
    cards = new Map<string, Chain[]>(),
    finished = new Map<string, import("./model").Patient>(),
    moved = new Map<string, import("./transferApi").Location>();
  const added = new Map<string, import("./model").Patient>(),
    removed = new Set<string>(),
    belongings = new Map<string, Belonging[]>();
  let closed = false;
  const reader: Source = {
    ...base,
    patients: async (branch, department, signal) =>
      [
        ...(await base.patients("demo-branch", "demo-department", signal)),
        ...added.values(),
      ].filter(
        (p) =>
          !removed.has(p.id) &&
          !finished.has(p.cardId) &&
          (moved.get(p.cardId)?.branchId ?? "demo-branch") === branch &&
          (moved.get(p.cardId)?.departmentId ?? "demo-department") ===
            department,
      ),
    chains: async (card, signal) => {
      if (closed || signal?.aborted) throw new ApiError("Cancelled");
      if (!cards.has(card))
        cards.set(
          card,
          [...added.values()].some((p) => p.cardId === card)
            ? []
            : structuredClone(await base.chains(card, signal)),
        );
      return markFetched(structuredClone(cards.get(card)!));
    },
    close() {
      closed = true;
      cards.clear();
      finished.clear();
      moved.clear();
      added.clear();
      removed.clear();
      belongings.clear();
      base.close();
    },
  };
  function revision(card: string, id: string) {
    const r = cards
      .get(card)
      ?.flatMap((c) => c.elements)
      .filter((r) => r.id === id);
    if (closed || r?.length !== 1) throw new ApiError("InvalidResponse");
    return r[0];
  }
  const transport: ResultTransport = {
    async put(card, id, p, signal) {
      if (signal.aborted) throw new ApiError("Cancelled");
      const r = revision(card, id);
      r.results = r.results
        .filter((x) => x.id !== p.id)
        .concat({
          id: p.id,
          idConfirmed: true,
          status: p.status,
          reason: p.reason ?? "",
          comment: p.comment,
          color: p.color ?? "",
          hour: p.hour,
          at: instant(p.hour),
          created: p.creationDate,
        });
    },
    async remove(card, id, result, signal) {
      if (signal.aborted) throw new ApiError("Cancelled");
      const r = revision(card, id);
      r.results = r.results.filter((x) => x.id !== result);
    },
    close() {},
  };
  const dischargeApi: DischargeApi = {
    async patient(_branch, id, signal) {
      if (closed || signal.aborted) throw new ApiError("Cancelled");
      const p = [
        ...(await base.patients("demo-branch", "demo-department")),
        ...added.values(),
      ].find((p) => p.id === id);
      if (!p) throw new ApiError("InvalidResponse");
      return structuredClone(finished.get(p.cardId) ?? p);
    },
    async finish(card, end, signal) {
      if (closed || signal.aborted) throw new ApiError("Cancelled");
      const p = [
        ...(await base.patients("demo-branch", "demo-department")),
        ...added.values(),
      ].find((p) => p.cardId === card);
      if (!p) throw new ApiError("InvalidResponse");
      finished.set(card, {
        ...p,
        cardStatus: "ARCHIVED",
        treatmentEnd: instant(end),
      });
    },
    close() {},
  };
  const transferApi: TransferApi = {
    async move(_from, id, to, signal) {
      if (closed || signal.aborted) throw new ApiError("Cancelled");
      const p = [
        ...(await base.patients("demo-branch", "demo-department")),
        ...added.values(),
      ].find((p) => p.id === id);
      if (!p) throw new ApiError("InvalidResponse");
      moved.set(p.cardId, { ...to });
    },
    close() {},
  };
  const check = (s: AbortSignal) => {
    if (closed || s.aborted) throw new ApiError("Cancelled");
  };
  const putItem = (p: string, b: Belonging) =>
    belongings.set(
      p,
      (belongings.get(p) ?? [])
        .filter((v) => v.id !== b.id)
        .concat(structuredClone(b)),
    );
  const entityApi: EntityApi = {
    async belongings(p, s) {
      check(s);
      return structuredClone(belongings.get(p) ?? []);
    },
    async addBelonging(p, b, s) {
      check(s);
      putItem(p, b);
    },
    async updateBelonging(p, b, s) {
      check(s);
      putItem(p, b);
    },
    async deleteBelonging(p, id, s) {
      check(s);
      belongings.set(
        p,
        (belongings.get(p) ?? []).filter((b) => b.id !== id),
      );
    },
    async finishBelonging(p, id, status, date, s) {
      check(s);
      const b = belongings.get(p)?.find((b) => b.id === id);
      if (!b) throw new ApiError("Http", 404);
      putItem(p, { ...b, status, returnDate: date });
    },
    async receiveBelonging(p, id, s) {
      check(s);
      const b = belongings.get(p)?.find((b) => b.id === id);
      if (!b) throw new ApiError("Http", 404);
      const next = { ...b, status: "RECEIVED" };
      delete next.returnDate;
      putItem(p, next);
    },
    async createPatient(l, b, s) {
      check(s);
      const p = normalizePatients([b])[0];
      added.set(p.id, p);
      moved.set(p.cardId, { ...l });
    },
    async deletePatient(_l, p, s) {
      check(s);
      removed.add(p);
      belongings.delete(p);
    },
    close() {},
  };
  const prescriptionApi: PrescriptionApi = {
    async create(card, body, signal) {
      check(signal);
      const current = cards.get(card);
      if (!current) throw new ApiError("InvalidResponse");
      current.push(
        normalizeChains([{ ...body, elements: [body.prescription] }])[0],
      );
    },
    async addRevision(card, chain, body, signal) {
      check(signal);
      const current = cards.get(card)?.find((c) => c.id === chain);
      if (!current) throw new ApiError("InvalidResponse");
      current.elements.push(
        normalizeChains([{ id: chain, elements: [body] }])[0].elements[0],
      );
    },
    async finish(card, chain, id, end, signal) {
      check(signal);
      const current = cards
        .get(card)
        ?.find((c) => c.id === chain)
        ?.elements.find((r) => r.id === id);
      if (!current) throw new ApiError("InvalidResponse");
      current.end = instant(end);
      current.rawEnd = end;
      current.endSource = "endDate";
    },
    async deleteRevision(card, chain, id, signal) {
      check(signal);
      const current = cards.get(card)?.find((c) => c.id === chain);
      if (!current) throw new ApiError("InvalidResponse");
      current.elements = current.elements.filter((r) => r.id !== id);
    },
    async deleteChain(card, chain, signal) {
      check(signal);
      cards.set(
        card,
        (cards.get(card) ?? []).filter((c) => c.id !== chain),
      );
    },
    close() {},
  };
  return compose(
    reader,
    transport,
    dischargeApi,
    transferApi,
    entityApi,
    createMockArchive(),
    prescriptionApi,
  );
}
