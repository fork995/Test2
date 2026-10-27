// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../src/App";
import { Details } from "../src/Details";
import { Grid } from "../src/Grid";
import { cellFill, cellRevisions } from "../src/cellAppearance";
import {
  normalizeChains,
  indexChains,
  normalizePatients,
  CATEGORIES,
  LABELS,
  type Chain,
} from "../src/model";
import { readPreferences } from "../src/preferences";
import { workClinicalFields, clinicalFields } from "../src/clinical";
import { medicationCalculation } from "../src/medication";
const at = Date.parse("2026-10-18T08:00:00Z"),
  H = 3600000,
  iso = (n: number) => new Date(n).toISOString();
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  readPreferences();
  readPreferences(true);
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(Date, "now").mockReturnValue(at + 31 * 60000);
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
      throw Error("No live requests");
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const button = (name: string, scope: ParentNode = container) => {
  const b = [...scope.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(name),
  );
  if (!b) throw Error(`Missing ${name}`);
  return b;
};
async function click(e: Element) {
  await act(async () => {
    e.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
async function input(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function select(el: HTMLSelectElement, value: string) {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function nav(name: string) {
  await click(button(name, container.querySelector(".bottom-nav")!));
}
const branches = [
  {
    id: "another-branch",
    name: "Другая клиника",
    workShiftStart: "08:00",
    departments: [{ id: "another-dept", name: "Терапия" }],
  },
  {
    id: "west-branch",
    name: "ИВЦ Запад",
    workShiftStart: "08:00",
    departments: [
      { id: "other-west", name: "Терапия" },
      { id: "surgery-dept", name: "Хирургический стационар" },
    ],
  },
];
const patients = [
  {
    id: "fake-patient",
    name: "Учебный пациент",
    weightKg: 4,
    card: {
      id: "fake-card",
      status: "ACTIVE",
      treatment: {
        sheets: [
          {
            id: "fake-sheet",
            start: iso(at),
            end: iso(at + 24 * H),
            locked: false,
          },
        ],
      },
    },
  },
];
function rawMedication(value = 50) {
  return {
    id: "lid-chain",
    name: "Лидокаин · учебное назначение",
    type: "MEDICATION",
    elements: [
      {
        id: "lid-revision",
        color: "yellow",
        dates: { start: iso(at), periodicity: 1 },
        specifics: {
          dosage: {
            value,
            units: {
              substance: "MICROGRAM",
              volume: "KILOGRAM",
              time: "MINUTE",
            },
          },
          weightKg: 4,
          concentration: {
            value: 10,
            units: { substance: "MILLIGRAM", volume: "MILLILITRE" },
          },
          route: "INTRAVENOUS",
        },
        results: [] as Record<string, unknown>[],
      },
    ],
  };
}
function mockServer(raw = [rawMedication()], available = branches) {
  const calls: {
    url: string;
    method: string;
    body?: Record<string, unknown>;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit) => {
      const method = options.method ?? "GET";
      const body = options.body
        ? JSON.parse(options.body as string)
        : undefined;
      calls.push({ url, method, body });
      if (method === "GET") {
        const data = url.endsWith("/branches")
          ? available
          : url.endsWith("/patients")
            ? patients
            : raw;
        return new Response(JSON.stringify(data), { status: 200 });
      }
      const parts =
        /\/prescriptions\/([^/]+)\/execution-results\/([^/]+)$/.exec(url);
      expect(parts).not.toBeNull();
      const revision = raw
        .flatMap((c) => c.elements)
        .find((r) => r.id === parts![1])!;
      if (method === "PUT")
        revision.results = revision.results
          .filter((r) => r.id !== body.id)
          .concat(body);
      else if (method === "DELETE")
        revision.results = revision.results.filter((r) => r.id !== parts![2]);
      else throw Error("Unexpected mutation");
      return new Response(null, { status: 204 });
    }),
  );
  return calls;
}
async function login() {
  await act(async () => root.render(<App />));
  (container.querySelector("#jwt") as HTMLInputElement).value =
    "MOCK_VALUE_NOT_JWT";
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function remount() {
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => {
    root.render(<App />);
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
it("initial login selects authorized target IDs without wrong or duplicate startup requests", async () => {
  const calls = mockServer();
  await login();
  expect(
    calls.map((c) => c.url.replace("https://backend.clevervet.tech/api", "")),
  ).toEqual([
    "/branches",
    "/branches/west-branch/departments/surgery-dept/patients",
    "/medical-records/fake-card/prescription-chains",
  ]);
  expect(container.textContent).toContain("Хирургический стационар");
  expect(calls.every((c) => c.method === "GET")).toBe(true);
  await click(container.querySelector(".current-block .work-patient-toggle")!);
  await click(container.querySelector(".current-block .work-item")!);
  expect(button("Отметить выполнение")).toBeTruthy();
});
it("manual department choice, disabled editing and auth survive reload", async () => {
  const calls = mockServer();
  await login();
  await nav("Настройки");
  const enabled = container.querySelector(
    '[aria-label="Разрешить редактирование"]',
  ) as HTMLInputElement;
  expect(enabled.checked).toBe(true);
  await click(enabled);
  await select(
    container.querySelector('[aria-label="Филиал"]')!,
    "another-branch",
  );
  await select(
    container.querySelector('[aria-label="Отделение"]')!,
    "another-dept",
  );
  const count = calls.length;
  await remount();
  expect(
    calls
      .slice(count)
      .filter((c) => c.url.endsWith("/patients"))
      .map((c) => c.url),
  ).toEqual([
    "https://backend.clevervet.tech/api/branches/another-branch/departments/another-dept/patients",
  ]);
  await nav("Настройки");
  expect(
    (
      container.querySelector(
        '[aria-label="Разрешить редактирование"]',
      ) as HTMLInputElement
    ).checked,
  ).toBe(false);
  expect(localStorage.getItem("clevervet.mobile.preferences.v1")).not.toContain(
    "Учебный пациент",
  );
  expect(localStorage.getItem("clevervet.mobile.preferences.v1")).not.toContain(
    "MOCK_VALUE_NOT_JWT",
  );
});
it("default enabled editing survives a page reload without toggling", async () => {
  mockServer();
  await login();
  await remount();
  await nav("Настройки");
  expect(
    (
      container.querySelector(
        '[aria-label="Разрешить редактирование"]',
      ) as HTMLInputElement
    ).checked,
  ).toBe(true);
});
it("unavailable default shows a selector on the main screen and does not fetch random patients", async () => {
  const calls = mockServer(undefined, branches.slice(0, 1));
  await login();
  expect(container.textContent).toContain("недоступно этой учётной записи");
  expect(container.querySelector('[aria-label="Филиал"]')).not.toBeNull();
  expect(calls).toHaveLength(1);
  await select(
    container.querySelector('[aria-label="Филиал"]')!,
    "another-branch",
  );
  await select(
    container.querySelector('[aria-label="Отделение"]')!,
    "another-dept",
  );
  expect(calls.filter((c) => c.url.endsWith("/patients"))).toHaveLength(1);
});
for (const status of ["EXECUTED", "NOT_EXECUTED"] as const)
  it(`${status}: save, reread, edit and delete preserve source cell color and write payload`, async () => {
    const raw = rawMedication(20);
    const calls = mockServer([raw]);
    await login();
    await nav("Пациенты");
    await click(container.querySelector(".patient-card")!);
    await click(button("Сетка"));
    const cell = () =>
      container.querySelector(
        '.hour-cell[aria-label*="08:00"]',
      ) as HTMLButtonElement;
    const original = cell().style.getPropertyValue("--cell-fill");
    expect(original).toBe("yellow");
    await click(cell());
    await click(button("Отметить выполнение"));
    if (status === "EXECUTED") await click(button("✓ Выполнено"));
    if (status === "NOT_EXECUTED") {
      await click(button("Не выполнено"));
      const reason = container.querySelector(
        '[aria-label="Причина невыполнения"]',
      ) as HTMLSelectElement;
      expect(reason.value).toBe("");
      await select(reason, "DEVICE_ABSENT");
    } else
      await input(
        container.querySelector("textarea")!,
        "38,5\nУчебная запись 🐈",
      );
    await click(button("Сохранить"));
    expect(cell().style.getPropertyValue("--cell-fill")).toBe(original);
    expect(cell().textContent).toContain(status === "EXECUTED" ? "✓" : "×");
    const written = calls.find((c) => c.method === "PUT")!.body!;
    expect(written).not.toHaveProperty("color");
    expect(written.hour).toBe(iso(at));
    expect(written.status).toBe(status);
    if (status === "EXECUTED") {
      expect(written.comment).toBe("38,5\nУчебная запись 🐈");
      expect(written).not.toHaveProperty("reason");
    } else expect(written.reason).toBe("DEVICE_ABSENT");
    raw.elements[0].results[0].color = "violet";
    await click(button("Обновить"));
    expect(cell().style.getPropertyValue("--cell-fill")).toBe("violet");
    await click(cell());
    await click(button("Изменить отметку"));
    if (status === "EXECUTED") {
      expect(container.querySelector("textarea")!.value).toBe(
        "38,5\nУчебная запись 🐈",
      );
      await input(container.querySelector("textarea")!, "Изменено 🐾");
    }
    await click(button("Сохранить"));
    expect(cell().style.getPropertyValue("--cell-fill")).toBe("violet");
    expect(calls.filter((c) => c.method === "PUT").at(-1)!.body!.color).toBe(
      "violet",
    );
    await click(cell());
    await click(button("Изменить отметку"));
    await click(button("Удалить ошибочную"));
    await click(button("Подтвердить удаление"));
    expect(cell().style.getPropertyValue("--cell-fill")).toBe(original);
    expect(cell().textContent).toContain("—");
    expect(raw.elements[0].color).toBe("yellow");
    expect(calls.some((c) => ["POST", "PATCH"].includes(c.method))).toBe(false);
  });
for (const value of [10, 20, 40, 50])
  it(`Lidocaine ${value} µg/kg/min is visible in general feed, individual feed, details, and editor`, async () => {
    const calls = mockServer([rawMedication(value)]);
    await login();
    await click(
      container.querySelector(".current-block .work-patient-toggle")!,
    );
    expect(
      container.querySelector(".current-block .work-item")?.textContent,
    ).toContain(`${value} мкг/кг/мин`);
    await click(container.querySelector(".current-block .work-item")!);
    expect(container.querySelector("dialog")?.textContent).toContain(
      `${value} мкг/кг/мин`,
    );
    expect(container.querySelector(".revision-history")).toBeNull();
    await click(container.querySelector('[aria-label="Закрыть детали"]')!);
    await nav("Пациенты");
    await click(container.querySelector(".patient-card")!);
    if (!container.querySelector(".current-block .work-item"))
      await click(
        container.querySelector(".current-block .work-patient-toggle")!,
      );
    expect(
      container.querySelector(".current-block .work-item")?.textContent,
    ).toContain(`${value} мкг/кг/мин`);
    await click(container.querySelector(".current-block .work-item")!);
    await click(button("Отметить выполнение"));
    expect(container.querySelector(".result-editor")?.textContent).toContain(
      `${value} мкг/кг/мин`,
    );
    expect(calls).toHaveLength(3);
  });
for (const type of CATEGORIES)
  it(`compact ${type} details keep category, value/time/status/edit without view label or revision-history UI`, async () => {
    const raw = rawMedication();
    raw.type = type;
    raw.elements[0].results = [
      {
        id: "result",
        status: "EXECUTED",
        comment: "38,5",
        hour: iso(at),
        creationDate: iso(at + 60000),
        color: "violet",
      },
    ];
    const chain = normalizeChains([raw])[0],
      index = indexChains([chain])[0];
    const patient = normalizePatients(patients)[0];
    const onEdit = vi.fn();
    await act(async () =>
      root.render(
        <Details
          selection={{
            index,
            patient,
            revision: chain.elements[0],
            at,
            entries: [index.entries[0]],
          }}
          zone="UTC"
          onClose={() => {}}
          onEdit={onEdit}
        />,
      ),
    );
    const dialog = container.querySelector("dialog")!;
    expect(dialog.querySelector(".eyebrow")?.textContent?.trim()).toBe(
      LABELS[type],
    );
    expect(dialog.textContent).not.toMatch(
      /Только просмотр|ТОЛЬКО ПРОСМОТР|Вся история редакций/,
    );
    expect(dialog.querySelector(".revision-history")).toBeNull();
    expect(dialog.textContent).toContain("Выполнено");
    expect(dialog.textContent).toContain("08:00");
    expect(dialog.textContent).toContain("38,5");
    await click(button("Изменить отметку"));
    expect(onEdit.mock.calls[0][0].id).toBe("lid-revision");
    expect(chain.elements[0].results).toHaveLength(1);
  });
it("grid keeps revision colors and confines individual result color to its marked slot", async () => {
  const raw = rawMedication();
  raw.elements.push({
    ...structuredClone(raw.elements[0]),
    id: "second-revision",
    color: "chartreuse",
    dates: { start: iso(at + H), periodicity: 1 },
  });
  const chain = normalizeChains([raw])[0];
  chain.elements[0].end = at + H;
  chain.elements[0].results = [
    {
      id: "r",
      idConfirmed: true,
      at,
      hour: iso(at),
      created: iso(at),
      status: "NOT_EXECUTED",
      reason: "DEVICE_ABSENT",
      color: "blue",
      comment: "",
    },
  ];
  const index = indexChains([chain])[0];
  expect(cellFill(cellRevisions(index, at, "UTC", index.entries))).toBe(
    "yellow",
  );
  expect(cellFill(cellRevisions(index, at + H, "UTC"))).toBe("chartreuse");
  await act(async () =>
    root.render(
      <Grid
        indexes={[index]}
        start={at}
        end={at + 2 * H}
        now={at}
        zone="UTC"
        onSelect={() => {}}
      />,
    ),
  );
  const cells = container.querySelectorAll<HTMLElement>(".hour-cell");
  expect(cells[0].style.getPropertyValue("--cell-fill")).toBe("blue");
  expect(cells[1].style.getPropertyValue("--cell-fill")).toBe("chartreuse");
  expect(cells[0].style.getPropertyValue("--result-color")).toBe("");
});
it("original rate units and calculation stay distinct from ml/h and do not depend on a drug name", () => {
  const raw = rawMedication(40);
  raw.name = "Любое другое название";
  const chain: Chain = normalizeChains([raw])[0],
    revision = chain.elements[0];
  expect(
    workClinicalFields(chain, revision).fields.find(
      (f) => f.path === "specifics.dosage",
    )?.value,
  ).toBe("40 мкг/кг/мин");
  expect(
    clinicalFields(chain, revision).find((f) => f.path === "specifics.dosage")
      ?.value,
  ).toBe("40 мкг/кг/мин");
  const before = medicationCalculation(revision.specifics);
  expect(before.total?.value).toBe(160);
  expect(before.total?.time).toBe("MINUTE");
  expect(before.amount?.value).toBe(0.016);
  expect(before.amount?.time).toBe("MINUTE");
  expect(
    workClinicalFields(chain, revision).fields.some((f) =>
      f.value.includes("мл/ч"),
    ),
  ).toBe(false);
});
