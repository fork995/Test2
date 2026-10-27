import type { Branch, Patient, Chain, Category } from "./model";
import { mockData } from "./mock";
const timestamps = new WeakMap<object, number>();
export function markFetched<T extends object>(data: T): T {
  timestamps.set(data, Date.now());
  return data;
}
export function receivedAt(data: object): number | null {
  return timestamps.get(data) ?? null;
}
export interface Source {
  prescriptions?: import("./prescriptions").PrescriptionService;
  archive?: import("./archiveApi").ArchiveApi;
  entities?: import("./entities").EntityService;
  transfer?: import("./transfer").TransferService;
  discharge?: import("./discharge").Discharger;
  results?: import("./resultWriter").ResultWriter;
  demo: boolean;
  branches(signal?: AbortSignal): Promise<Branch[]>;
  patients(
    branch: string,
    department: string,
    signal?: AbortSignal,
    refresh?: boolean,
  ): Promise<Patient[]>;
  chains(
    card: string,
    signal?: AbortSignal,
    refresh?: boolean,
    diagnostic?: boolean,
  ): Promise<Chain[]>;
  clearCache?(): void;
  close(): void;
}
export const diagnosticTypes: readonly Category[] = [
  "MONITORING",
  "ACTIVITY",
  "SOLUTION",
  "MEDICATION",
  "PROCEDURE",
  "NURSING",
];
export function createMock(big = false): Source {
  let data: ReturnType<typeof mockData> | null = mockData(big);
  markFetched(data.patients);
  markFetched(data.chains);
  return {
    demo: true,
    branches: async () => data?.branches || [],
    patients: async (_b, d) => (d === "demo-empty" ? [] : data?.patients || []),
    chains: async (card) =>
      markFetched(
        card === "medical-card-102"
          ? data?.chains.slice(0, 6) || []
          : data?.chains || [],
      ),
    close: () => {
      data = null;
    },
  };
}
