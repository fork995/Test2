/** Incremental top-level object-array parser. Only a single bounded object is parsed at once. */
export class ArchiveReadError extends Error {
  constructor(
    public kind: "Limit" | "Format" | "StreamingUnavailable" | "DifferentCard",
  ) {
    super(kind);
    this.name = "ArchiveReadError";
  }
}
export class ObjectArrayParser {
  private state: "open" | "first" | "next" | "object" | "comma" | "done" =
    "open";
  private stack: string[] = [];
  private quoted = false;
  private escaped = false;
  private buffer = "";
  constructor(
    private accept: (value: unknown) => void,
    private maxObjectChars = 131072,
  ) {}
  write(chunk: string) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (this.state === "object") {
        this.buffer += c;
        if (this.buffer.length > this.maxObjectChars)
          throw new ArchiveReadError("Limit");
        if (this.quoted) {
          if (this.escaped) this.escaped = false;
          else if (c === "\\") this.escaped = true;
          else if (c === '"') this.quoted = false;
          continue;
        }
        if (c === '"') {
          this.quoted = true;
          continue;
        }
        if (c === "{" || c === "[") {
          this.stack.push(c);
          if (this.stack.length > 48) throw new ArchiveReadError("Limit");
        } else if (c === "}" || c === "]") {
          if (this.stack.pop() !== (c === "}" ? "{" : "["))
            throw new ArchiveReadError("Format");
          if (!this.stack.length) {
            let value: unknown;
            try {
              value = JSON.parse(this.buffer);
            } catch {
              throw new ArchiveReadError("Format");
            }
            this.buffer = "";
            this.state = "comma";
            this.accept(value);
          }
        }
        continue;
      }
      if (/\s/.test(c)) {
        if (c !== " " && c !== "\n" && c !== "\r" && c !== "\t")
          throw new ArchiveReadError("Format");
        continue;
      }
      if (this.state === "open" && c === "[") {
        this.state = "first";
        continue;
      }
      if ((this.state === "first" || this.state === "next") && c === "{") {
        this.state = "object";
        this.stack = ["{"];
        this.buffer = "{";
        continue;
      }
      if ((this.state === "first" || this.state === "comma") && c === "]") {
        this.state = "done";
        continue;
      }
      if (this.state === "comma" && c === ",") {
        this.state = "next";
        continue;
      }
      throw new ArchiveReadError("Format");
    }
  }
  finish() {
    if (this.state !== "done") throw new ArchiveReadError("Format");
  }
}
export interface ReadLimits {
  maxBytes: number;
  maxObjectChars: number;
  maxRecords: number;
}
export const ARCHIVE_LIMITS: ReadLimits = {
  maxBytes: 32 * 1024 * 1024,
  maxObjectChars: 128 * 1024,
  maxRecords: 100000,
};
export const DETAIL_LIMITS: ReadLimits = {
  maxBytes: 8 * 1024 * 1024,
  maxObjectChars: 1024 * 1024,
  maxRecords: 2000,
};
function decode(
  decoder: TextDecoder,
  bytes?: Uint8Array,
  stream = false,
): string {
  try {
    return decoder.decode(bytes, { stream });
  } catch {
    throw new ArchiveReadError("Format");
  }
}
const checkAbort = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
};
/** Fetch stream is mandatory. Never falls back to unbounded response.json()/text(). */
export async function readObjectArray(
  response: Response,
  signal: AbortSignal,
  accept: (v: unknown) => void,
  limits: ReadLimits = ARCHIVE_LIMITS,
  progress?: (bytes: number, records: number) => void,
) {
  const body = response.body;
  if (!body || typeof body.getReader !== "function")
    throw new ArchiveReadError("StreamingUnavailable");
  const reader = body.getReader();
  let bytes = 0,
    records = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const parser = new ObjectArrayParser((value) => {
    checkAbort(signal);
    if (++records > limits.maxRecords) throw new ArchiveReadError("Limit");
    accept(value);
  }, limits.maxObjectChars);
  try {
    checkAbort(signal);
    while (true) {
      const next = await reader.read();
      checkAbort(signal);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limits.maxBytes) throw new ArchiveReadError("Limit");
      // Small slices bound transient decoded strings and yield so Safari can handle cancel/input.
      for (let i = 0; i < next.value.length; i += 16384) {
        checkAbort(signal);
        parser.write(decode(decoder, next.value.subarray(i, i + 16384), true));
        if ((i + 16384) % 65536 === 0) {
          progress?.(bytes, records);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      progress?.(bytes, records);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    parser.write(decode(decoder));
    parser.finish();
    progress?.(bytes, records);
    return { bytes, records };
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
/** A single patient's DTO is bounded before JSON parsing, unlike a full archive. */
export async function readSingleObject(
  response: Response,
  signal: AbortSignal,
  maxBytes = 2 * 1024 * 1024,
): Promise<unknown> {
  if (!response.body?.getReader)
    throw new ArchiveReadError("StreamingUnavailable");
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    bytes = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    checkAbort(signal);
    while (true) {
      const next = await reader.read();
      checkAbort(signal);
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > maxBytes) throw new ArchiveReadError("Limit");
      text += decode(decoder, next.value, true);
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    text += decode(decoder);
    try {
      return JSON.parse(text);
    } catch {
      throw new ArchiveReadError("Format");
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
