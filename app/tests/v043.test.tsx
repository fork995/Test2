// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workspace } from "../src/Workspace";
import { PatientPhoto, patientPhotoUrl } from "../src/PatientPhoto";
import { SaveNotice } from "../src/SaveNotice";
import { createSessionApi } from "../src/session";
import { API } from "../src/api";
import {
  CATEGORIES,
  indexChains,
  normalizeChains,
  normalizePatients,
} from "../src/model";
import { cellFill, cellRevisions } from "../src/cellAppearance";
import {
  buildPatientSchedule,
  API_SCHEDULE_POLICY,
} from "../src/scheduleEngine";
import { branches } from "./fixtures";
import type { Source } from "../src/source";
const NOW = Date.parse("2026-10-18T17:41:00Z"),
  END = new Date(NOW).toISOString(),
  H = 3600000;
const PHOTO =
  "https:" +
  "//storage.yandexcloud.net/clevervet-patient-photos/synthetic-patient.jpg";
let container: HTMLDivElement, root: Root, source: Source | undefined;
function patients() {
  return [1, 2, 3].map((n) => ({
    id: `synthetic-patient-${n}`,
    name: `ДЕМО · Учебный пациент ${n}`,
    photo: n === 1 ? PHOTO : undefined,
    card: {
      id: `synthetic-card-${n}`,
      status: "ACTIVE",
      treatment: {
        start: "2026-10-18T07:00:00Z",
        sheets: [
          {
            id: `sheet-${n}`,
            start: "2026-10-18T07:00:00Z",
            end: "2026-10-19T07:00:00Z",
          },
        ],
      },
    },
  }));
}
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("Live network forbidden");
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  source?.close();
  source = undefined;
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
function button(name: string, scope: ParentNode = container) {
  const el = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (e) => e.textContent?.includes(name),
  );
  if (!el) throw Error(`Missing ${name}`);
  return el;
}
async function mount(mode: "ok" | "error" | "unverified" = "ok", hold = false) {
  let done = false,
    release = () => {};
  const gate = hold
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  const data = patients(),
    calls: { path: string; method: string; body?: unknown }[] = [];
  const fetcher = vi.fn(
    async (url: string | URL | Request, o?: RequestInit) => {
      const path = String(url).replace(API, ""),
        method = o?.method ?? "GET";
      calls.push({
        path,
        method,
        body: o?.body ? JSON.parse(o.body as string) : undefined,
      });
      if (method === "PATCH") {
        await gate;
        if (mode === "error") return new Response("", { status: 500 });
        done = true;
        return new Response("", { status: 200 });
      }
      if (path.endsWith("/prescription-chains")) return Response.json([]);
      if (path === "/branches/b/patients/synthetic-patient-1")
        return Response.json(
          done && mode !== "unverified"
            ? {
                ...data[0],
                card: {
                  ...data[0].card,
                  status: "ARCHIVED",
                  treatment: { ...data[0].card.treatment, end: END },
                },
              }
            : data[0],
        );
      if (path.endsWith("/patients"))
        return Response.json(
          done && mode !== "unverified" ? data.slice(1) : data,
        );
      throw Error("Unexpected mock endpoint");
    },
  );
  source = createSessionApi("SYNTHETIC_NOT_JWT", fetcher);
  await act(async () =>
    root.render(
      <Workspace
        source={source!}
        branches={branches}
        onExpire={() => {}}
        onLogout={() => {}}
      />,
    ),
  );
  await click(button("Пациенты", container.querySelector(".bottom-nav")!));
  return { calls, release };
}
async function openDischarge() {
  await click(container.querySelector(".patient-card")!);
  container.querySelector<HTMLDetailsElement>(".patient-actions")!.open = true;
  await click(button("Завершить лечение"));
}
async function submit() {
  const choice = container.querySelector<HTMLSelectElement>(
    '[aria-label="Результат завершения"]',
  );
  if (choice) {
    await act(async () => {
      choice.value = "DISCHARGED";
      choice.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector(".discharge-dialog form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
  }
  await act(async () => {
    container
      .querySelector(".discharge-dialog form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
it("shows patient thumbnails and larger card photo with nonblocking local fallback", async () => {
  await mount();
  const list = container.querySelectorAll(".patient-photo");
  expect(list).toHaveLength(3);
  expect(list[0].querySelector("img")?.getAttribute("src")).toBe(PHOTO);
  expect(list[1].querySelector("img")).toBeNull();
  expect(list[0].querySelector("img")?.getAttribute("loading")).toBe("lazy");
  expect(list[0].querySelector("img")?.getAttribute("referrerpolicy")).toBe(
    "no-referrer",
  );
  await click(container.querySelector(".patient-card")!);
  expect(
    container.querySelector(".patient-heading .patient-photo-large img"),
  ).not.toBeNull();
});
it("opens confirmation with patient, department and Moscow time; cancel sends no PATCH", async () => {
  const { calls } = await mount();
  await openDischarge();
  const d = container.querySelector(".discharge-dialog")!;
  expect(d.textContent).toContain("ДЕМО · Учебный пациент 1");
  expect(d.textContent).toContain("Хирургический стационар");
  expect(
    d.querySelector<HTMLInputElement>('[aria-label="Дата завершения"]')!.value,
  ).toBe("2026-10-18");
  expect(
    d.querySelector<HTMLInputElement>('[aria-label="Время завершения"]')!.value,
  ).toBe("20:41");
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  await click(button("Отмена", d));
  expect(container.querySelector(".discharge-dialog")).toBeNull();
  expect(container.querySelector(".patient-heading")!.textContent).toContain(
    "Учебный пациент 1",
  );
});
it("updates active list only after PATCH 200 and both fresh GET confirmations; locks double submit", async () => {
  const { calls, release } = await mount("ok", true);
  await openDischarge();
  await submit();
  expect(button("Подтверждение").disabled).toBe(true);
  await submit();
  expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  expect(container.querySelector(".patient-heading")!.textContent).toContain(
    "Учебный пациент 1",
  );
  await act(async () => release());
  expect(calls.slice(-2).map((c) => c.method)).toEqual(["GET", "GET"]);
  expect(container.querySelectorAll(".patient-card")).toHaveLength(2);
  expect(container.querySelector(".patient-list")!.textContent).not.toContain(
    "Учебный пациент 1",
  );
  expect(container.querySelector(".save-notice")!.textContent).toBe(
    "Лечение завершено",
  );
  expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({
    result: "DISCHARGED",
    end: END,
  });
});
it.each(["error", "unverified"] as const)(
  "keeps patient in place on %s discharge and blocks blind retry",
  async (mode) => {
    const { calls } = await mount(mode);
    await openDischarge();
    await submit();
    expect(
      container.querySelector(".discharge-dialog [role=alert]")!.textContent,
    ).toContain("не подтверждено");
    expect(container.querySelector(".patient-heading")!.textContent).toContain(
      "Учебный пациент 1",
    );
    expect(container.querySelector(".save-notice")).toBeNull();
    expect(button("Подтвердить завершение").disabled).toBe(true);
    await submit();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    await click(
      button("Отмена", container.querySelector(".discharge-dialog")!),
    );
    await click(button("Пациенты", container.querySelector(".bottom-nav")!));
    expect(container.querySelectorAll(".patient-card")).toHaveLength(3);
  },
);
it("removes permanent editing banner; success acknowledgement is transient and errors independent", async () => {
  await mount();
  expect(container.textContent).not.toContain("Запись отметок включена");
  vi.useFakeTimers();
  const expired = vi.fn();
  await act(async () =>
    root.render(<SaveNotice message="Отметка сохранена" onExpire={expired} />),
  );
  expect(container.querySelector(".save-notice")!.textContent).toBe(
    "Отметка сохранена",
  );
  await act(async () => vi.advanceTimersByTime(4999));
  expect(expired).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(expired).toHaveBeenCalledTimes(1);
  await act(async () =>
    root.render(<SaveNotice message="" onExpire={expired} />),
  );
  expect(container.querySelector(".save-notice")).toBeNull();
});
it("photo load failure restores the original letter without breaking layout or card", async () => {
  const patient = normalizePatients(patients())[0];
  await act(async () => root.render(<PatientPhoto patient={patient} />));
  const img = container.querySelector("img")!;
  await act(async () => img.dispatchEvent(new Event("load")));
  expect(img.className).toBe("loaded");
  await act(async () => img.dispatchEvent(new Event("error")));
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toBe("Д");
});
it.each([
  undefined,
  null,
  "",
  "http://storage.yandexcloud.net/clevervet-patient-photos/a.jpg",
  "https://evil.invalid/a.jpg",
  PHOTO + "?token=MOCK",
  PHOTO + "#MOCK",
  "https://user:secret@storage.yandexcloud.net/clevervet-patient-photos/a.jpg",
  "https://storage.yandexcloud.net/other-bucket/a.jpg",
  "data:image/png;base64,bad",
])("does not request unconfirmed photo URL %s", (value) =>
  expect(patientPhotoUrl(value)).toBeNull(),
);
it("allows only the confirmed HTTPS image bucket, not identifiers inferred as URLs", () => {
  expect(patientPhotoUrl(PHOTO)).toBe(PHOTO);
  expect(patientPhotoUrl("attachment-id")).toBeNull();
});
it.each(
  CATEGORIES.flatMap((type) =>
    [undefined, null].map((periodicity) => ({ type, periodicity })),
  ),
)(
  "manual $type / $periodicity has no painted strip, tasks or overdue; actual result colors only its slot",
  ({ type, periodicity }) => {
    const p = normalizePatients(patients())[0];
    const [index] = indexChains(
      normalizeChains([
        {
          id: "chain",
          name: "Учебное",
          type,
          elements: [
            {
              id: "revision",
              color: "yellow",
              dates: { start: "2026-10-18T17:21:00Z", periodicity },
              results: [
                {
                  id: "real-result",
                  hour: "2026-10-18T18:17:00Z",
                  creationDate: END,
                  status: "EXECUTED",
                  color: "pink",
                },
              ],
            },
          ],
        },
      ]),
    );
    const start = Date.parse("2026-10-18T17:00:00Z"),
      entry = index.entries[0];
    for (let i = 0; i < 4; i++) {
      const at = start + i * H,
        entries = i === 1 ? [entry] : [];
      expect(
        cellFill(cellRevisions(index, at, "Europe/Moscow", entries), entries),
      ).toBe(i === 1 ? "pink" : "#131f23");
    }
    expect(cellFill(cellRevisions(index, start + H, "Europe/Moscow"))).toBe(
      "#131f23",
    );
    const s = buildPatientSchedule(
      [index],
      p,
      {
        start,
        end: start + 4 * H,
        source: "shift",
        key: "test",
        warnings: [],
        patients: 1,
      },
      API_SCHEDULE_POLICY,
      "ALL",
      "Europe/Moscow",
    );
    expect(s.tasks).toHaveLength(0);
    expect(s.issues).toHaveLength(0);
    expect(index.chain.elements[0].color).toBe("yellow");
  },
);
