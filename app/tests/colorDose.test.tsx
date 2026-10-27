// @vitest-environment jsdom
// Invented data and intercepted fetch only. No real JWT, patients or API operations.
import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../src/App";
import { Grid } from "../src/Grid";
import { cellFill, cellRevisions } from "../src/cellAppearance";
import {
  CATEGORIES,
  normalizeChains,
  indexChains,
  type Category,
} from "../src/model";
import { clinicalTitle, clinicalParameters } from "../src/clinical";
import { RESULT_COLORS } from "../src/resultColors";
const AT = Date.parse("2026-10-18T08:00:00Z"),
  H = 3600000,
  iso = (at: number) => new Date(at).toISOString(),
  EMPTY = "#131f23";
interface RawRevision {
  id: string;
  color: string;
  dates: { start: string; periodicity?: number | null };
  specifics: Record<string, unknown>;
  results: Record<string, unknown>[];
  endDate?: string;
}
interface RawChain {
  id: string;
  name: string;
  type: Category;
  elements: RawRevision[];
}
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, "now").mockReturnValue(AT + 31 * 60000);
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
      throw Error("Live API forbidden");
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
  const el = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.includes(name),
  );
  if (!el) throw Error(`Missing ${name}`);
  return el;
};
async function click(el: Element) {
  await act(async () =>
    el.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
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
function rawChain(
  type: Category = "MEDICATION",
  periodicity: number | null | undefined = 1,
): RawChain {
  return {
    id: "synthetic-chain",
    name: `Учебное назначение ${type}`,
    type,
    elements: [
      {
        id: "synthetic-revision",
        color: type === "NURSING" ? "chartreuse" : "yellow",
        dates: {
          start: iso(AT),
          ...(periodicity === undefined ? {} : { periodicity }),
        },
        specifics:
          type === "MEDICATION"
            ? {
                dosage: {
                  value: 1,
                  units: { substance: "MILLIGRAM", volume: "KILOGRAM" },
                },
                concentration: {
                  value: 10,
                  units: { substance: "MILLIGRAM", volume: "MILLILITRE" },
                },
                weightKg: 4,
                route: "INTRAVENOUS",
              }
            : type === "SOLUTION"
              ? { scarce: { value: 15 } }
              : {},
        results: [],
      },
    ],
  };
}
function server(data: RawChain[]) {
  const calls: {
    method: string;
    body?: Record<string, unknown>;
    url: string;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit) => {
      const method = options.method ?? "GET",
        body = options.body ? JSON.parse(options.body as string) : undefined;
      calls.push({ method, body, url });
      if (method === "GET")
        return new Response(
          JSON.stringify(
            url.endsWith("/branches")
              ? [
                  {
                    id: "b",
                    name: "ИВЦ Запад",
                    workShiftStart: "08:00",
                    departments: [{ id: "d", name: "Хирургический стационар" }],
                  },
                ]
              : url.endsWith("/patients")
                ? [
                    {
                      id: "synthetic-patient",
                      name: "ДЕМО · Учебный пациент",
                      card: {
                        id: "synthetic-card",
                        status: "ACTIVE",
                        treatment: {
                          sheets: [
                            {
                              id: "synthetic-sheet",
                              start: iso(AT),
                              end: iso(AT + 24 * H),
                              locked: false,
                            },
                          ],
                        },
                      },
                    },
                  ]
                : data,
          ),
          { status: 200 },
        );
      const parts =
        /\/prescriptions\/([^/]+)\/execution-results\/([^/]+)$/.exec(url);
      expect(parts).not.toBeNull();
      const revision = data
        .flatMap((c) => c.elements)
        .find((r) => r.id === parts![1])!;
      if (method === "PUT")
        revision.results = revision.results
          .filter((r) => r.id !== body.id)
          .concat(body);
      else if (method === "DELETE")
        revision.results = revision.results.filter((r) => r.id !== parts![2]);
      else throw Error("Forbidden method");
      return new Response(null, { status: 204 });
    }),
  );
  return calls;
}
async function login() {
  await act(async () => root.render(<App />));
  (container.querySelector("#jwt") as HTMLInputElement).value = "MOCK_NOT_JWT";
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
async function grid() {
  await nav("Пациенты");
  await click(container.querySelector(".patient-card")!);
  await click(button("Сетка"));
}
async function reload() {
  await act(async () => root.unmount());
  root = createRoot(container);
  await login();
  await grid();
}
const cell = () =>
  container.querySelector(
    '.hour-cell[aria-label*="08:00"]',
  ) as HTMLButtonElement;
const fill = () => cell().style.getPropertyValue("--cell-fill");
async function edit() {
  await click(cell());
  await click(button("Изменить отметку"));
}
for (const type of CATEGORIES)
  for (const status of ["EXECUTED", "NOT_EXECUTED"] as const)
    for (const manual of [false, true])
      it(`${type} ${status} ${manual ? "manual" : "periodic"}: source/result colors survive save/reload/edit/clear/delete`, async () => {
        const chain = rawChain(type, manual ? null : 1),
          calls = server([chain]);
        const sourceColor = chain.elements[0].color,
          base = manual ? EMPTY : sourceColor;
        await login();
        await grid();
        expect(fill()).toBe(base);
        await click(cell());
        await click(
          button(manual ? "Добавить событие" : "Отметить выполнение"),
        );
        if (status === "EXECUTED") await click(button("✓ Выполнено"));
        if (status === "NOT_EXECUTED") {
          await click(button("Не выполнено"));
          const reason = container.querySelector(
            '[aria-label="Причина невыполнения"]',
          ) as HTMLSelectElement;
          expect(reason.value).toBe("");
          await select(reason, "DEVICE_ABSENT");
        }
        expect(
          (
            container.querySelector(
              '[aria-label="Подкрашивать"]',
            ) as HTMLInputElement
          ).checked,
        ).toBe(false);
        await click(button("Сохранить"));
        expect(fill()).toBe(base);
        expect(calls.find((c) => c.method === "PUT")!.body).not.toHaveProperty(
          "color",
        );
        await reload();
        expect(fill()).toBe(base);
        await edit();
        await click(container.querySelector('[aria-label="Подкрашивать"]')!);
        await click(container.querySelector('[aria-label="Светло-жёлтый"]')!);
        await click(button("Сохранить"));
        expect(fill()).toBe("lightyellow");
        expect(chain.elements[0].color).toBe(sourceColor);
        await reload();
        expect(fill()).toBe("lightyellow");
        await click(cell());
        expect(
          (container.querySelector(".result-color-swatch") as HTMLElement).style
            .background,
        ).toBe("lightyellow");
        await click(button("Изменить отметку"));
        expect(
          container
            .querySelector('[aria-label="Светло-жёлтый"]')
            ?.getAttribute("aria-pressed"),
        ).toBe("true");
        await click(button("Сохранить"));
        expect(fill()).toBe("lightyellow");
        expect(
          calls.filter((c) => c.method === "PUT").at(-1)!.body!.color,
        ).toBe("lightyellow");
        await edit();
        await click(container.querySelector('[aria-label="Подкрашивать"]')!);
        await click(button("Сохранить"));
        expect(
          calls.filter((c) => c.method === "PUT").at(-1)!.body,
        ).not.toHaveProperty("color");
        expect(fill()).toBe(base);
        expect(chain.elements[0].color).toBe(sourceColor);
        await edit();
        await click(button("Удалить ошибочную"));
        await click(button("Подтвердить удаление"));
        expect(fill()).toBe(base);
        expect(chain.elements[0].results).toEqual([]);
        expect(chain.elements[0].color).toBe(sourceColor);
        expect(calls.some((c) => ["POST", "PATCH"].includes(c.method))).toBe(
          false,
        );
      });
const doses = [
  ["Ветгаб", 20, "MILLIGRAM", "20 мг/кг"],
  ["Серения", 1, "MILLIGRAM", "1 мг/кг"],
  ["Спазмалгон", 20, "MILLIGRAM", "20 мг/кг"],
  ["Акупан", 0.3, "MILLIGRAM", "0,3 мг/кг"],
  ["Амоксиклав", 20, "MILLIGRAM", "20 мг/кг"],
  ["Лидокаин", 30, "MICROGRAM", "30 мкг/кг/мин"],
] as const;
for (const [name, value, unit, label] of doses)
  it(`${name}: canonical ${label} and route match across all five views`, async () => {
    const chain = rawChain();
    chain.name = name;
    chain.elements[0].specifics.dosage = {
      value,
      units: {
        substance: unit,
        volume: "KILOGRAM",
        ...(unit === "MICROGRAM" ? { time: "MINUTE" } : {}),
      },
    };
    const calls = server([chain]);
    await login();
    await click(
      container.querySelector(".current-block .work-patient-toggle")!,
    );
    const expected = `${name} · ${label} · в/в`;
    expect(
      container.querySelector(".current-block .work-item strong")?.textContent,
    ).toBe(expected);
    await click(container.querySelector(".current-block .work-item")!);
    expect(container.querySelector("#detail-title")?.textContent).toBe(
      expected,
    );
    await click(button("Отметить выполнение"));
    expect(container.querySelector("#result-title")?.textContent).toBe(
      expected,
    );
    expect(container.querySelector(".result-clinical")?.textContent).toMatch(
      /Полная доза|Доза в единицу времени/,
    );
    await click(button("Отмена"));
    await nav("Пациенты");
    await click(container.querySelector(".patient-card")!);
    if (!container.querySelector(".current-block .work-item"))
      await click(
        container.querySelector(".current-block .work-patient-toggle")!,
      );
    expect(
      container.querySelector(".current-block .work-item strong")?.textContent,
    ).toBe(expected);
    await click(button("Сетка"));
    const row = container.querySelector(".name-cell")!;
    expect(row.textContent).toContain(name);
    expect(row.textContent).toContain(`${label} · в/в`);
    expect(row.textContent).not.toMatch(/0,4 мл|мл\/мин/);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
it("SOLUTION shows pump ml/h while monitoring, care, procedures and activity have no invented dose", () => {
  for (const type of CATEGORIES) {
    const raw = rawChain(type);
    const chain = normalizeChains([raw])[0];
    const label = clinicalTitle(chain, chain.elements[0]);
    if (type === "SOLUTION") expect(label).toBe(`${chain.name} · 15 мл/ч`);
    else if (type !== "MEDICATION") expect(label).toBe(chain.name);
  }
});
for (const periodicity of [null, undefined])
  it(`manual ${periodicity} has no prepaint, explicit results paint only their own hour, and deletion clears it`, () => {
    const raw = rawChain("MONITORING", periodicity);
    if (periodicity === undefined) delete raw.elements[0].dates.periodicity;
    let index = indexChains(normalizeChains([raw]))[0];
    expect(cellFill(cellRevisions(index, AT, "UTC"))).toBe(EMPTY);
    raw.elements[0].results = [
      {
        id: "real",
        status: "EXECUTED",
        hour: iso(AT + 17 * 60000),
        creationDate: iso(AT + 20 * 60000),
        color: "pink",
      },
    ];
    index = indexChains(normalizeChains([raw]))[0];
    expect(
      cellFill(cellRevisions(index, AT, "UTC", index.entries), index.entries),
    ).toBe("pink");
    expect(cellFill(cellRevisions(index, AT + H, "UTC"))).toBe(EMPTY);
    raw.elements[0].results = [];
    index = indexChains(normalizeChains([raw]))[0];
    expect(cellFill(cellRevisions(index, AT, "UTC"))).toBe(EMPTY);
    expect(raw.elements[0].color).toBe("yellow");
  });
it("explicit zero retains its source color before execution; missing dates.start stays inactive", () => {
  const raw = rawChain("NURSING", 0);
  raw.elements[0].dates.start = iso(AT + 21 * 60000);
  let index = indexChains(normalizeChains([raw]))[0];
  expect(cellFill(cellRevisions(index, AT, "UTC"))).toBe("chartreuse");
  expect(cellFill(cellRevisions(index, AT + H, "UTC"))).toBe(EMPTY);
  raw.elements[0].dates.start = "";
  index = indexChains(normalizeChains([raw]))[0];
  expect(cellFill(cellRevisions(index, AT, "UTC"))).toBe(EMPTY);
});
it("grid shows each revision's dose in the corresponding hour instead of applying the latest dose to all columns", async () => {
  const raw = rawChain();
  raw.elements[0].specifics.dosage = {
    value: 10,
    units: { substance: "MILLIGRAM", volume: "KILOGRAM" },
  };
  raw.elements[0].endDate = iso(AT + H);
  raw.elements.push({
    ...structuredClone(raw.elements[0]),
    id: "next-revision",
    dates: { start: iso(AT + H), periodicity: 1 },
    endDate: iso(AT + 3 * H),
    specifics: {
      ...raw.elements[0].specifics,
      dosage: {
        value: 40,
        units: { substance: "MICROGRAM", volume: "KILOGRAM", time: "MINUTE" },
      },
    },
  });
  const chain = normalizeChains([raw])[0],
    index = indexChains([chain])[0];
  await act(async () =>
    root.render(
      <Grid
        indexes={[index]}
        start={AT}
        end={AT + 2 * H}
        now={AT}
        zone="UTC"
        onSelect={() => {}}
      />,
    ),
  );
  expect(container.querySelector(".name-cell")?.textContent).toContain(
    "Дозировка менялась",
  );
  const cells = container.querySelectorAll(".hour-cell");
  expect(cells[0].textContent).toContain("10 мг/кг");
  expect(cells[0].textContent).not.toContain("40 мкг/кг/мин");
  expect(cells[1].textContent).toContain("40 мкг/кг/мин");
  expect(clinicalParameters(chain, chain.elements[0])).toBe("10 мг/кг · в/в");
});
it("confirmed palette matches original enum exactly and does not constrain revision colors", () => {
  expect(RESULT_COLORS.map((c) => c.value)).toEqual([
    "yellow",
    "orange",
    "lightgreen",
    "lightblue",
    "violet",
    "pink",
    "lightyellow",
  ]);
  const raw = rawChain("ACTIVITY");
  raw.elements[0].color = "#13579b";
  const index = indexChains(normalizeChains([raw]))[0];
  expect(cellFill(cellRevisions(index, AT, "UTC"))).toBe("#13579b");
});
