import { ApiError, safeError } from "./api";
import { indexChains, type Chain, type IndexedChain } from "./model";
import { receivedAt, type Source } from "./source";
export interface CardData {
  phase: "queued" | "loading" | "ready" | "error";
  chains: Chain[];
  indexes: IndexedChain[];
  receivedAt: number | null;
  error: string;
  diagnostic: boolean;
  hasData?: boolean;
}
interface Job {
  card: string;
  refresh: boolean;
  diagnostic: boolean;
  controller: AbortController;
  resolve: () => void;
  promise: Promise<void>;
}
export class PrescriptionStore {
  private snapshot = new Map<string, CardData>();
  private listeners = new Set<() => void>();
  private pending = new Map<string, Job>();
  private queue: Job[] = [];
  private running = 0;
  private disposed = false;
  constructor(
    private source: Source,
    private onExpire: () => void,
    private concurrency = 3,
  ) {
    this.concurrency = Math.max(1, Math.min(3, concurrency));
  }
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  getSnapshot = () => this.snapshot;
  private publish(card: string, value: CardData) {
    if (this.disposed) return;
    this.snapshot = new Map(this.snapshot).set(card, value);
    this.listeners.forEach((fn) => fn());
  }
  request(card: string, refresh = false, diagnostic = false): Promise<void> {
    if (this.disposed || !card) return Promise.resolve();
    const existing = this.pending.get(card);
    if (existing) return existing.promise;
    if (!refresh && this.snapshot.has(card)) return Promise.resolve();
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    const job: Job = {
      card,
      refresh,
      diagnostic,
      controller: new AbortController(),
      resolve,
      promise,
    };
    this.pending.set(card, job);
    this.queue.push(job);
    const previous = this.snapshot.get(card);
    this.publish(card, {
      phase: "queued",
      chains: previous?.chains ?? [],
      indexes: previous?.indexes ?? [],
      receivedAt: previous?.receivedAt ?? null,
      hasData: previous?.hasData ?? previous?.phase === "ready",
      error: "",
      diagnostic,
    });
    this.pump();
    return promise;
  }
  private pump() {
    while (
      !this.disposed &&
      this.running < this.concurrency &&
      this.queue.length
    ) {
      const job = this.queue.shift()!;
      this.running++;
      this.publish(job.card, {
        ...this.snapshot.get(job.card)!,
        phase: "loading",
      });
      void Promise.resolve()
        .then(() => {
          if (this.disposed || job.controller.signal.aborted)
            throw new ApiError("Cancelled");
          return this.source.chains(
            job.card,
            job.controller.signal,
            job.refresh,
            job.diagnostic,
          );
        })
        .then((chains) => {
          if (!this.disposed && this.pending.get(job.card) === job)
            this.publish(job.card, {
              phase: "ready",
              hasData: true,
              chains,
              indexes: indexChains(chains),
              receivedAt: receivedAt(chains),
              error: "",
              diagnostic: job.diagnostic,
            });
        })
        .catch((error) => {
          if (this.disposed || this.pending.get(job.card) !== job) return;
          if (error instanceof ApiError && error.kind === "Unauthorized") {
            this.close();
            this.onExpire();
            return;
          }
          this.publish(job.card, {
            ...this.snapshot.get(job.card)!,
            phase: "error",
            error: safeError(error),
            diagnostic: job.diagnostic,
          });
        })
        .finally(() => {
          if (this.pending.get(job.card) === job) this.pending.delete(job.card);
          this.running--;
          job.resolve();
          this.pump();
        });
    }
  }
  acceptVerified(card: string, chains: Chain[]) {
    if (this.disposed) return;
    const job = this.pending.get(card);
    if (job) {
      this.pending.delete(card);
      job.controller.abort();
      job.resolve();
      this.queue = this.queue.filter((x) => x !== job);
    }
    this.publish(card, {
      phase: "ready",
      hasData: true,
      chains,
      indexes: indexChains(chains),
      receivedAt: receivedAt(chains) ?? Date.now(),
      error: "",
      diagnostic: false,
    });
  }
  prune(cards: Set<string>) {
    for (const [card, job] of this.pending)
      if (!cards.has(card)) {
        this.pending.delete(card);
        job.controller.abort();
        job.resolve();
      }
    this.queue = this.queue.filter((job) => cards.has(job.card));
    const next = new Map(
      [...this.snapshot].filter(([card]) => cards.has(card)),
    );
    if (next.size !== this.snapshot.size) {
      this.snapshot = next;
      this.listeners.forEach((fn) => fn());
    }
  }
  close() {
    if (this.disposed) return;
    this.disposed = true;
    for (const job of this.pending.values()) {
      job.controller.abort();
      job.resolve();
    }
    this.pending.clear();
    this.queue = [];
    this.snapshot = new Map();
    this.listeners.forEach((fn) => fn());
    this.listeners.clear();
  }
}
