// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ResultEditor } from "../src/ResultEditor";
import { HourlyOverview } from "../src/HourlyOverview";
import { App } from "../src/App";
import {
  normalizePatients,
  normalizeChains,
  indexChains,
  type Chain,
} from "../src/model";
import { type ResultTarget, type ResultWriter } from "../src/resultWriter";
import {
  buildPatientSchedule,
  API_SCHEDULE_POLICY,
} from "../src/scheduleEngine";
import { type CardData } from "../src/store";
import { API } from "../src/api";
const H = 3600000,
  at = Date.parse("2026-10-19T07:00:00Z"),
  now = at + 3 * H,
  iso = (t: number) => new Date(t).toISOString(),
  zone = "Europe/Moscow";
const patientRaw = () => ({
  id: "patient",
  name: "Учебный пациент",
  card: {
    id: "record",
    status: "ACTIVE",
    treatment: {
      start: iso(at - 2 * H),
      sheets: [
        {
          id: "sheet",
          start: iso(at - 2 * H),
          end: iso(at + 22 * H),
          locked: false,
        },
      ],
    },
  },
});
const rawChain = (status?: string, periodicity: unknown = 0, n = 0) => ({
  id: `chain-${n}`,
  name: `Учебное назначение ${n + 1}`,
  type: "NURSING",
  elements: [
    {
      id: `revision-${n}`,
      color: "yellow",
      dates: { start: iso(at), periodicity },
      results: status
        ? [
            {
              id: `result-${n}`,
              status,
              reason: status === "NOT_EXECUTED" ? "DEVICE_ABSENT" : undefined,
              comment: status === "EXECUTED" ? "Учебная запись" : "",
              color: "violet",
              hour: iso(at),
              creationDate: iso(now - 60000),
            },
          ]
        : [],
    },
  ],
});
const period = {
  start: at - 2 * H,
  end: at + 22 * H,
  source: "sheet" as const,
  key: "shift",
  patients: 1,
  warnings: [],
};
let root: Root, box: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(Date, "now").mockReturnValue(now);
  const original = new Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...original,
    timeZone: zone,
  });
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(Error("No live API"))),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const button = (text: string, scope: ParentNode = box) => {
  const b = [...scope.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.trim() === text || b.textContent?.trim().endsWith(text),
  );
  if (!b) throw Error("Missing " + text);
  return b;
};
async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
async function text(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function setup(status?: string, p: unknown = 0) {
  const chain = normalizeChains([rawChain(status, p)])[0],
    patient = normalizePatients([patientRaw()])[0],
    target: ResultTarget = {
      patient,
      chainId: chain.id,
      revision: chain.elements[0],
      at,
      zone,
      existing: chain.elements[0].results[0],
    };
  const save = vi.fn(async () => ({ patient, chains: [chain] })),
    remove = vi.fn(async () => ({ patient, chains: [chain] })),
    onSaved = vi.fn();
  const writer: ResultWriter = {
    save,
    remove,
    setEnabled: vi.fn(),
    isEnabled: () => true,
    close: vi.fn(),
  };
  return { chain, target, writer, save, remove, onSaved };
}
async function editor(f: ReturnType<typeof setup>) {
  await act(async () =>
    root.render(
      <ResultEditor
        initial={f.target}
        chain={f.chain}
        writer={f.writer}
        onClose={() => {}}
        onSaved={f.onSaved}
        onRefresh={async () => {}}
        onExpire={() => {}}
      />,
    ),
  );
}
it("missing result starts planned, not executed; no-op save sends nothing", async () => {
  const f = setup();
  await editor(f);
  expect(button("Запланировано").getAttribute("aria-pressed")).toBe("true");
  expect(box.textContent).toContain("Сейчас: Запланировано");
  expect(box.querySelector("textarea")).toBeNull();
  expect(button("Сохранить").disabled).toBe(true);
  expect(f.save).not.toHaveBeenCalled();
  expect(f.remove).not.toHaveBeenCalled();
});
it.each(["EXECUTED", "NOT_EXECUTED"])(
  "%s → planned hides reason/comment/color, deletes only on Save and verifies before callback",
  async (status) => {
    const f = setup(status);
    let resolve!: (v: any) => void;
    f.remove.mockImplementation(() => new Promise((r) => (resolve = r)));
    await editor(f);
    await click(button("Запланировано"));
    expect(f.remove).not.toHaveBeenCalled();
    expect(box.querySelector("textarea")).toBeNull();
    expect(box.querySelector("select")).toBeNull();
    expect(box.querySelector(".result-paint")).toBeNull();
    expect(box.textContent).toContain("Если час прошёл");
    await click(button("Сохранить"));
    expect(f.save).not.toHaveBeenCalled();
    expect(f.remove).toHaveBeenCalledTimes(1);
    expect(f.onSaved).not.toHaveBeenCalled();
    await act(async () =>
      resolve({ patient: f.target.patient, chains: [f.chain] }),
    );
    expect(f.onSaved.mock.calls[0][1]).toBe(true);
  },
);
it("manual empty result uses No mark and does not label it scheduled or overdue", async () => {
  const f = setup(undefined, null);
  await editor(f);
  expect(button("Без отметки").getAttribute("aria-pressed")).toBe("true");
  expect(box.textContent).not.toContain("Запланировано");
  expect(box.textContent).toContain("Автоматического задания нет");
  await click(button("✓ Выполнено"));
  expect(box.querySelector("textarea")).not.toBeNull();
});
it("unknown API status is not falsely preselected; user explicitly chooses state", async () => {
  const f = setup("UNKNOWN_API");
  await editor(f);
  expect(
    box.querySelector(".result-status-options [aria-pressed=true]"),
  ).toBeNull();
  expect(button("Сохранить").disabled).toBe(true);
  await click(button("Запланировано"));
  expect(button("Сохранить").disabled).toBe(false);
});
it("double Save to planned sends one DELETE", async () => {
  const f = setup("EXECUTED");
  let resolve!: (v: any) => void;
  f.remove.mockImplementation(() => new Promise((r) => (resolve = r)));
  await editor(f);
  await click(button("Запланировано"));
  const b = button("Сохранить");
  await act(async () => {
    b.click();
    b.click();
  });
  expect(f.remove).toHaveBeenCalledTimes(1);
  await act(async () =>
    resolve({ patient: f.target.patient, chains: [f.chain] }),
  );
});
it("DELETE error keeps actual existing status and never calls success callback", async () => {
  const f = setup("EXECUTED");
  f.remove.mockRejectedValue(new Error("PRIVATE"));
  await editor(f);
  await click(button("Запланировано"));
  await click(button("Сохранить"));
  expect(box.textContent).toContain("Сейчас: Выполнено");
  expect(box.querySelector("[role=alert]")).not.toBeNull();
  expect(box.textContent).not.toContain("PRIVATE");
  expect(f.onSaved).not.toHaveBeenCalled();
});
async function overview(chains: Chain[], clock = now) {
  const patient = normalizePatients([patientRaw()])[0],
    data: CardData = {
      phase: "ready",
      chains,
      indexes: indexChains(chains),
      receivedAt: now,
      error: "",
      diagnostic: false,
      hasData: true,
    };
  await act(async () =>
    root.render(
      <HourlyOverview
        open
        onToggle={() => {}}
        patients={[patient]}
        snapshot={new Map([["record", data]])}
        schedules={
          new Map([
            [
              "record",
              buildPatientSchedule(
                data.indexes,
                patient,
                period,
                API_SCHEDULE_POLICY,
                "ALL",
                zone,
              ),
            ],
          ])
        }
        period={period}
        zone={zone}
        now={clock}
        onPatient={() => {}}
      />,
    ),
  );
}
const summaryCell = () =>
  box.querySelector(`.overview-cell[data-hour="${at}"]`)!;
it("summary immediately shows overdue 1, 2, 3; any registered status clears pending", async () => {
  for (let count = 1; count <= 3; count++) {
    await overview(
      normalizeChains(
        Array.from({ length: 3 }, (_, i) =>
          rawChain(
            i < count ? undefined : i % 2 ? "NOT_EXECUTED" : "EXECUTED",
            0,
            i,
          ),
        ),
      ),
    );
    expect(summaryCell().getAttribute("data-status")).toBe("overdue");
    expect(summaryCell().textContent).toBe(String(count));
  }
  await overview(
    normalizeChains([
      rawChain("EXECUTED", 0, 0),
      rawChain("NOT_EXECUTED", 0, 1),
    ]),
  );
  expect(summaryCell().getAttribute("data-status")).toBe("done");
  expect(summaryCell().textContent).toBe("✓");
  expect(fetch).not.toHaveBeenCalled();
});
it("future pending is not overdue; manual and inactive slots do not create counts", async () => {
  await overview(normalizeChains([rawChain(undefined)]), at - H);
  expect(summaryCell().getAttribute("data-status")).toBe("planned");
  const manual = rawChain(undefined, null),
    inactive = rawChain(undefined, 1, 1) as any;
  delete inactive.elements[0].dates.start;
  await overview(normalizeChains([manual, inactive]));
  expect(summaryCell().getAttribute("data-status")).toBe("nothing");
  expect(summaryCell().textContent).toBe("—");
});
it.each(["EXECUTED", "NOT_EXECUTED"])(
  "App: past %s → planned updates grid, overdue feed and opened overview without page reload",
  async (status) => {
    let data = [rawChain(status)];
    const calls: { method: string; path: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string | URL | Request, o?: RequestInit) => {
        const path = String(u).replace(API, ""),
          method = o?.method ?? "GET";
        calls.push({ path, method });
        if (method === "DELETE") {
          expect(path).toBe(
            "/medical-records/record/prescriptions/revision-0/execution-results/result-0",
          );
          data[0].elements[0].results = [];
          return new Response(null, { status: 200 });
        }
        expect(method).toBe("GET");
        if (path === "/branches")
          return Response.json([
            {
              id: "b",
              name: "ИВЦ Запад",
              workShiftStart: "08:00",
              departments: [{ id: "d", name: "Хирургический стационар" }],
            },
          ]);
        if (path.endsWith("/prescription-chains")) return Response.json(data);
        if (path.endsWith("/patients")) return Response.json([patientRaw()]);
        throw Error("Unexpected mocked endpoint");
      }),
    );
    await act(async () => root.render(<App />));
    await text(box.querySelector("#jwt")!, "MOCK_NOT_JWT");
    await click(button("Подключиться →"));
    await act(async () => {
      const d = box.querySelector(".hourly-overview") as HTMLDetailsElement;
      d.open = true;
      d.dispatchEvent(new Event("toggle"));
    });
    expect(summaryCell().textContent).toBe("✓");
    await click(summaryCell());
    await click(box.querySelector('.hour-cell[aria-label*="10:00"]')!);
    await click(button("Изменить отметку"));
    await click(button("Запланировано"));
    await click(button("Сохранить"));
    expect(box.textContent).toContain("Статус сохранён");
    expect(
      box.querySelector('.hour-cell[aria-label*="10:00"] .cell-status')!
        .textContent,
    ).toBe("—");
    expect(
      (
        box.querySelector('.hour-cell[aria-label*="10:00"]') as HTMLElement
      ).style.getPropertyValue("--cell-fill"),
    ).toBe("yellow");
    await click(button("Общая лента", box.querySelector(".bottom-nav")!));
    expect(
      (box.querySelector(".hourly-overview") as HTMLDetailsElement).open,
    ).toBe(true);
    expect(summaryCell().textContent).toBe("1");
    expect(summaryCell().getAttribute("data-status")).toBe("overdue");
    const past = box.querySelector(".past-block")!;
    expect(past.querySelector(".time-toggle")?.textContent).toContain("1");
    await click(past.querySelector(".time-toggle")!);
    await click(past.querySelector(".work-patient-toggle")!);
    expect(past.querySelector(".work-item")).not.toBeNull();
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect(calls.at(-1)!.method).toBe("GET");
  },
);
