// @vitest-environment jsdom
// Synthetic names, owners, API responses and intercepted operations only.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workspace } from "../src/Workspace";
import { createSessionApi } from "../src/session";
import type { Source } from "../src/source";
import { API } from "../src/api";
import { FINISH_LABELS, type FinishResult } from "../src/finishResults";
import { SEVERITIES } from "../src/patientPresentation";
const AT = Date.parse("2026-10-18T17:41:00Z"),
  END = new Date(AT).toISOString();
const branches = [
  {
    id: "b",
    name: "ИВЦ Запад",
    workShiftStart: "08:00",
    departments: [
      { id: "d", name: "Хирургический стационар" },
      { id: "other", name: "Учебная терапия" },
    ],
  },
  {
    id: "b2",
    name: "Учебный филиал",
    workShiftStart: "08:00",
    departments: [{ id: "d2", name: "Учебное отделение" }],
  },
];
let root: Root, container: HTMLDivElement, source: Source | undefined;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, "now").mockReturnValue(AT);
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
      throw Error("No live API");
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
});
const button = (name: string, parent: ParentNode = container) => {
  const b = [...parent.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.includes(name),
  );
  if (!b) throw Error(`Missing ${name}`);
  return b;
};
async function click(e: Element) {
  await act(async () => {
    e.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
async function select(label: string, value: string) {
  await act(async () => {
    const el = container.querySelector<HTMLSelectElement>(
      `[aria-label="${label}"]`,
    )!;
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit(dialog: string) {
  await act(async () => {
    container
      .querySelector(`${dialog} form`)!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function mount({
  severity = "MODERATE",
  hospital = "ROUND_THE_CLOCK",
  owner = true,
  fail = false,
  hold = false,
} = {}) {
  const p = {
    id: "test-patient",
    name: "Учебный пациент",
    severity,
    owner: owner
      ? {
          surname: "Учебная",
          name: "Анна",
          patronymic: "Вымышленная",
          phone: "HIDDEN_PHONE",
          email: "HIDDEN_EMAIL",
        }
      : undefined,
    card: {
      id: "test-card",
      status: "ACTIVE",
      diagnoses: ["Вымышленный длинный диагноз; только интерфейсный тест"],
      hospital,
      treatment: {
        start: "2026-10-18T08:00:00Z",
        sheets: [
          {
            id: "sheet",
            start: "2026-10-18T08:00:00Z",
            end: "2026-10-19T08:00:00Z",
          },
        ],
      },
    },
  };
  const chains = [
    {
      id: "chain",
      name: "Учебное по необходимости",
      type: "NURSING",
      elements: [
        {
          id: "revision",
          dates: { start: "2026-10-18T08:00:00Z" },
          results: [
            {
              id: "result",
              hour: "2026-10-18T08:17:00Z",
              status: "EXECUTED",
              comment: "Учебный текст",
            },
          ],
        },
      ],
    },
  ];
  let moved = false,
    finished = false,
    release = () => {};
  const gate = hold
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const f = vi.fn(async (url: string | URL | Request, o?: RequestInit) => {
    const path = String(url).replace(API, ""),
      method = o?.method ?? "GET";
    calls.push({
      path,
      method,
      body: o?.body ? JSON.parse(o.body as string) : undefined,
    });
    if (method === "PATCH") {
      await gate;
      if (fail) return new Response("", { status: 403 });
      if (path.endsWith("/finish")) finished = true;
      else moved = true;
      return new Response("", { status: 200 });
    }
    if (path === "/branches") return Response.json(branches);
    if (path === "/branches/b/departments/d/patients")
      return Response.json(finished || moved ? [] : [p]);
    if (path === "/branches/b2/departments/d2/patients")
      return Response.json(moved ? [p] : []);
    if (path === "/branches/b/patients/test-patient")
      return Response.json(
        finished
          ? {
              ...p,
              card: {
                ...p.card,
                status: "ARCHIVED",
                treatment: { ...p.card.treatment, end: END },
              },
            }
          : p,
      );
    if (path.endsWith("/prescription-chains")) return Response.json(chains);
    throw Error("Unexpected mock path");
  });
  source = createSessionApi("MOCK_NOT_JWT", f);
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
  return { calls, release, chains };
}
async function openPatient() {
  await click(container.querySelector(".patient-card")!);
  container.querySelector<HTMLDetailsElement>(".patient-actions")!.open = true;
}
it.each(Object.entries(SEVERITIES))(
  "shows Russian severity %s with original RGB in list and patient details",
  async (key, expected) => {
    await mount({ severity: key });
    const badge = container.querySelector<HTMLElement>(".severity-badge")!;
    expect(badge.textContent).toBe(expected.label);
    expect(badge.style.getPropertyValue("--severity-rgb")).toBe(expected.rgb);
    await openPatient();
    expect(
      container.querySelector(".patient-heading .severity-badge")!.textContent,
    ).toBe(expected.label);
  },
);
it("shows owner below diagnosis in both views without extra personal fields", async () => {
  await mount();
  const owner = container.querySelector(".patient-owner")!;
  expect(owner.previousElementSibling?.className).toBe("diagnosis");
  expect(owner.textContent).toBe("Владелец: Учебная Анна Вымышленная");
  expect(container.textContent).not.toMatch(/HIDDEN_PHONE|HIDDEN_EMAIL/);
  await openPatient();
  expect(container.querySelector(".patient-owner")!.textContent).toContain(
    "Учебная Анна Вымышленная",
  );
});
it("omits empty owner row and keeps letter avatar", async () => {
  await mount({ owner: false });
  expect(container.querySelector(".patient-owner")).toBeNull();
  expect(container.querySelector(".patient-photo")!.textContent).toBe("У");
  await openPatient();
  expect(container.querySelector(".patient-owner")).toBeNull();
});
it.each(Object.keys(FINISH_LABELS) as FinishResult[])(
  "requires explicit result and separate confirmation for %s",
  async (result) => {
    await mount({
      hospital:
        result === "TRANSFERRED_TO_ROUND_THE_CLOCK_HOSPITAL"
          ? "DAY"
          : "ROUND_THE_CLOCK",
    });
    await openPatient();
    await click(button("Завершить лечение"));
    expect(button("Далее").disabled).toBe(true);
    await select("Результат завершения", result);
    await submit(".discharge-dialog");
    expect(
      container.querySelector(".operation-confirmation")!.textContent,
    ).toContain(FINISH_LABELS[result]);
    expect(
      container.querySelector(".operation-confirmation")!.textContent,
    ).toContain("20:41");
    expect(
      container.querySelector(".discharge-dialog strong")!.textContent,
    ).toBe("Учебный пациент");
    await click(
      button("Отмена", container.querySelector(".discharge-dialog")!),
    );
    expect(container.querySelector(".discharge-dialog")).toBeNull();
  },
);
it.each(["DIED", "INTERRUPTED_BY_OWNER"] as const)(
  "writes selected %s only after confirmation and then verifies GET",
  async (result) => {
    const { calls } = await mount();
    await openPatient();
    await click(button("Завершить лечение"));
    await select("Результат завершения", result);
    await submit(".discharge-dialog");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    await submit(".discharge-dialog");
    expect(calls.filter((c) => c.method === "PATCH")).toEqual([
      {
        method: "PATCH",
        path: "/medical-records/test-card/finish",
        body: { result, end: END },
      },
    ]);
    expect(calls.slice(-2).every((c) => c.method === "GET")).toBe(true);
    expect(container.querySelector(".patient-card")).toBeNull();
    expect(container.querySelector(".save-notice")!.textContent).toBe(
      "Лечение завершено",
    );
  },
);
it("excludes current hospital result and current transfer department", async () => {
  const { calls } = await mount();
  await openPatient();
  await click(button("Завершить лечение"));
  const choices = [
    ...container.querySelectorAll<HTMLSelectElement>(
      '[aria-label="Результат завершения"] option',
    ),
  ].map((e) => e.value);
  expect(choices).not.toContain("TRANSFERRED_TO_ROUND_THE_CLOCK_HOSPITAL");
  await click(button("Отмена", container.querySelector(".discharge-dialog")!));
  await click(button("Перевести в другое отделение"));
  await select("Филиал назначения", "b");
  expect(
    container.querySelector(
      '[aria-label="Отделение назначения"] option[value="d"]',
    ),
  ).toBeNull();
  expect(
    container.querySelector(
      '[aria-label="Отделение назначения"] option[value="other"]',
    ),
  ).not.toBeNull();
  await click(button("Отмена", container.querySelector(".transfer-dialog")!));
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
});
it("transfers only after review, keeps card/history and prevents duplicate send", async () => {
  const { calls, release, chains } = await mount({ hold: true });
  const original = structuredClone(chains);
  await openPatient();
  await click(button("Перевести в другое отделение"));
  await select("Филиал назначения", "b2");
  await select("Отделение назначения", "d2");
  await submit(".transfer-dialog");
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  expect(container.querySelector(".transfer-dialog")!.textContent).toContain(
    "Хирургический стационар",
  );
  expect(
    container.querySelector(".operation-confirmation")!.textContent,
  ).toContain("Учебное отделение");
  await submit(".transfer-dialog");
  await submit(".transfer-dialog");
  expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  expect(container.querySelector(".patient-heading")!.textContent).toContain(
    "Учебный пациент",
  );
  await act(async () => release());
  expect(container.querySelector(".patient-card")).toBeNull();
  expect(container.querySelector(".save-notice")!.textContent).toBe(
    "Пациент переведён",
  );
  expect(calls.find((c) => c.method === "PATCH")).toEqual({
    method: "PATCH",
    path: "/branches/b/departments/d/patients/test-patient/branch",
    body: { id: "b2", department: "d2" },
  });
  expect(chains).toEqual(original);
});
it.each(["finish", "transfer"])(
  "keeps patient on %s access error and blocks blind retry",
  async (operation) => {
    const { calls } = await mount({ fail: true });
    await openPatient();
    if (operation === "finish") {
      await click(button("Завершить лечение"));
      await select("Результат завершения", "DIED");
      await submit(".discharge-dialog");
      await submit(".discharge-dialog");
    } else {
      await click(button("Перевести в другое отделение"));
      await select("Филиал назначения", "b2");
      await select("Отделение назначения", "d2");
      await submit(".transfer-dialog");
      await submit(".transfer-dialog");
    }
    expect(container.querySelector('dialog [role="alert"]')).not.toBeNull();
    expect(container.querySelector(".patient-heading")!.textContent).toContain(
      "Учебный пациент",
    );
    expect(container.querySelector(".save-notice")).toBeNull();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  },
);
