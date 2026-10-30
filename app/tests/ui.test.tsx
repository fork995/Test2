// @vitest-environment jsdom
import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../src/App";
import { workChains } from "./workFixtures";
import { T, rawPatients, rawChains, branches } from "./fixtures";
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-18T08:42:00Z"));
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("Live requests forbidden in tests"))),
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function render() {
  await act(async () => root.render(<App />));
}
function button(text: string, scope: ParentNode = container) {
  const found = [...scope.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  if (!found) throw Error(`Missing button ${text}`);
  return found;
}
async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
async function nav(text: string) {
  await click(button(text, container.querySelector(".bottom-nav")!));
}
async function openDemo(big = false) {
  await render();
  if (big) await click(container.querySelector("input[type=checkbox]")!);
  await click(button("Открыть демо"));
}
async function connect() {
  await render();
  (container.querySelector("#jwt") as HTMLInputElement).value =
    "Bearer MOCK_VALUE_NOT_JWT";
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function changeSelect(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function realMock(chains: unknown = workChains()) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit) => {
      calls.push(url);
      expect(options.method).toBe("GET");
      expect(url).not.toContain("MOCK_VALUE");
      const body = url.endsWith("/branches")
        ? branches
        : url.endsWith("/patients")
          ? rawPatients()
          : chains;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}
async function openFirstPatient() {
  await nav("Пациенты");
  await click(container.querySelector(".patient-card")!);
}
async function expandCurrent() {
  await click(container.querySelector(".current-block .work-patient-toggle")!);
  return container.querySelector(".current-block .work-patient")!;
}
it("Tranexam yellow every 8 hours appears at 15:00 Moscow while different result colors stay in history", async () => {
  const options = new Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...options,
    timeZone: "Europe/Moscow",
  });
  vi.spyOn(Date, "now").mockReturnValue(
    Date.parse("2026-10-18T15:00:00+03:00"),
  );
  const prescription = (
    id: string,
    name: string,
    color: string,
    status?: string,
    resultColor?: string,
  ) => ({
    id,
    name,
    type: "MEDICATION",
    elements: [
      {
        id: `${id}-revision`,
        color,
        dates: { start: "2026-10-18T15:00:00+03:00", periodicity: 8 },
        endDate: "2026-10-20T08:00:00+03:00",
        results: status
          ? [
              {
                id: `${id}-result`,
                hour: "2026-10-18T15:00:00+03:00",
                status,
                color: resultColor,
              },
            ]
          : [],
      },
    ],
  });
  realMock([
    prescription("tranexam", "Транексам · тест", "yellow"),
    prescription("done", "Учебное выполненное", "violet", "EXECUTED", "blue"),
    prescription(
      "not",
      "Учебное отмеченное невыполненным",
      "chartreuse",
      "NOT_EXECUTED",
      "orange",
    ),
  ]);
  await connect();
  const group = await expandCurrent();
  const task = group.querySelector(".work-item") as HTMLButtonElement;
  expect(group.querySelectorAll(".work-item")).toHaveLength(1);
  expect(task.textContent).toContain("15:00");
  expect(task.textContent).toContain("Транексам");
  expect(task.textContent).toContain("Запланировано, без отметки");
  expect(task.style.getPropertyValue("--prescription-color")).toBe("yellow");
  await click(
    button("История отметок", container.querySelector(".work-view-filter")!),
  );
  await click(container.querySelector(".work-history .time-toggle")!);
  await click(container.querySelector(".work-history .work-patient-toggle")!);
  const cards = [
    ...container.querySelectorAll<HTMLButtonElement>(
      ".work-history .work-item",
    ),
  ];
  expect(cards).toHaveLength(2);
  const executed = cards.find((c) =>
    c.textContent?.includes("Учебное выполненное"),
  )!;
  expect(executed.style.getPropertyValue("--prescription-color")).toBe(
    "violet",
  );
  expect(
    executed.querySelector(".work-mark i")?.getAttribute("style"),
  ).toContain("blue");
  await click(executed);
  expect(
    (container.querySelector("dialog .revision-detail .swatch") as HTMLElement)
      .style.background,
  ).toBe("violet");
  expect(
    (container.querySelector("dialog .result-detail") as HTMLElement).style
      .borderColor,
  ).toBe("violet");
});
it("missing revision color does not filter current or next-hour schedules", async () => {
  realMock([
    {
      id: "no-color",
      name: "Synthetic without color",
      type: "MEDICATION",
      elements: [
        {
          id: "r",
          dates: { start: T(18, 8), periodicity: 1 },
          endDate: T(19, 8),
          results: [],
        },
      ],
    },
  ]);
  await connect();
  const current = await expandCurrent();
  expect(current.querySelector(".work-item")?.textContent).toContain(
    "Synthetic without color",
  );
  expect(
    container.querySelector(".next-block .work-patient-toggle"),
  ).not.toBeNull();
  expect(container.querySelector(".schedule-alert")).toBeNull();
});
it("at 10:31 the API worklist shows hourly current 10:00 and next 11:00 without extra GET on expansion", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(T(18, 10, 31)));
  const calls = realMock([
    {
      id: "hourly",
      name: "Учебное каждый час",
      type: "MEDICATION",
      elements: [
        {
          id: "hourly-r",
          color: "violet",
          dates: { start: T(18, 8), periodicity: 1 },
          endDate: T(19, 8),
          results: [],
        },
      ],
    },
  ]);
  await connect();
  expect(container.querySelector(".schedule-alert")).toBeNull();
  const current = await expandCurrent();
  expect(current.querySelector(".work-item time")?.textContent).toBe("10:00");
  expect(current.querySelector(".work-item")?.textContent).toContain(
    "Запланировано, без отметки",
  );
  await click(container.querySelector(".next-block .work-patient-toggle")!);
  expect(
    container.querySelector(".next-block .work-item time")?.textContent,
  ).toBe("11:00");
  expect(
    container.querySelector(".next-block .work-item")?.textContent,
  ).toContain("Запланировано, без отметки");
  expect(calls).toHaveLength(4);
});
it("zero with an exact mark is done, has no repeated work, and preserves history and grid", async () => {
  realMock([
    {
      id: "manual",
      name: "Учебное ручное",
      type: "PROCEDURE",
      elements: [
        {
          id: "manual-r",
          dates: { start: T(18, 8), periodicity: 0 },
          endDate: T(19, 8),
          results: [
            { id: "manual-a", hour: T(18, 8), status: "EXECUTED" },
            { id: "manual-b", hour: T(18, 8, 18), status: "NOT_EXECUTED" },
          ],
        },
      ],
    },
  ]);
  await connect();
  expect(
    container.querySelector(".current-block .work-patient-toggle"),
  ).toBeNull();
  expect(
    container.querySelector(".next-block .work-patient-toggle"),
  ).toBeNull();
  expect(container.querySelector(".schedule-alert")).toBeNull();
  expect(
    container.querySelector(".schedule-clarification .work-patient-toggle"),
  ).toBeNull();
  await click(
    button("История отметок", container.querySelector(".work-view-filter")!),
  );
  await click(container.querySelector(".work-history .time-toggle")!);
  await click(container.querySelector(".work-history .work-patient-toggle")!);
  expect(container.querySelectorAll(".work-history .work-item")).toHaveLength(
    2,
  );
  expect(container.querySelector(".work-history")?.textContent).toContain(
    "Выполнено",
  );
  expect(container.querySelector(".work-history")?.textContent).toContain(
    "Не выполнено",
  );
  await openFirstPatient();
  await click(button("Сетка", container.querySelector(".view-switch")!));
  await click(container.querySelector(".hour-cell.missed")!);
  expect(container.querySelectorAll("dialog .result-detail")).toHaveLength(2);
  expect(container.querySelector("dialog")?.textContent).toContain("Выполнено");
  expect(container.querySelector("dialog")?.textContent).toContain(
    "Не выполнено",
  );
});
it("opens a compact time-first worklist with collapsed patient rows and honest incomplete warning", async () => {
  const calls = realMock();
  await connect();
  expect(container.querySelector(".current-block h2")?.textContent).toContain(
    "Текущий час",
  );
  expect(
    container.querySelectorAll(".current-block .work-patient-toggle"),
  ).toHaveLength(2);
  expect(container.querySelector(".work-item")).toBeNull();
  const patient = await expandCurrent();
  expect(patient.querySelectorAll(".work-item")).toHaveLength(3);
  expect(patient.querySelector(".work-patient-toggle")?.textContent).toContain(
    "4.2 кг",
  );
  expect(patient.querySelector(".work-item")?.textContent).not.toContain(
    "Демо пациент",
  );
  expect(patient.textContent).not.toContain("Учебное выполненное");
  expect(patient.textContent).not.toContain("Учебное с отказом");
  expect(container.querySelector(".schedule-alert")?.textContent).toContain(
    "Рабочий список неполон",
  );
  expect(
    container.querySelector(".schedule-clarification")?.textContent,
  ).toContain("Расписание требует уточнения");
  expect(calls).toHaveLength(4);
});
it("shows exact next-hour time, dose, route, concentration, instruction and solution rate without raw technical fields", async () => {
  realMock();
  await connect();
  let patient = await expandCurrent();
  const text = patient.querySelector(".work-item")!.textContent!;
  expect(text).toContain("08:00");
  expect(text).toContain("5 мг");
  expect(text).toContain("в/в");
  expect(text).toContain("Набрать: 0,5 мл");
  expect(text).toContain("Учебная инструкция");
  expect(text).not.toMatch(
    /weightKg|viewMode|parentId|4.2|Ожидает|единицы не указаны/,
  );
  expect(patient.textContent).toContain("15 мл/ч");
  await click(container.querySelector(".next-block .work-patient-toggle")!);
  expect(
    container.querySelector(".next-block .work-item")?.textContent,
  ).toContain("09:00");
  expect(
    container.querySelector(".next-block .work-item")?.textContent,
  ).toContain("Учебное следующее");
});
it("unknown periodicity remains visible in clarification, not inserted into current tasks", async () => {
  realMock();
  await connect();
  const section = container.querySelector(".schedule-clarification")!;
  await click(section.querySelector(".work-patient-toggle")!);
  expect(section.querySelector(".work-item")?.textContent).toContain(
    "Учебное неясное",
  );
  expect(section.querySelector(".work-item")?.textContent).not.toMatch(
    /Ожидает|Просрочено|Не выполнено/,
  );
  await click(section.querySelector(".work-item")!);
  expect(container.querySelector("dialog")?.textContent).toContain(
    "Расписание требует уточнения",
  );
});
it("global category filters apply to every patient's current and next-hour groups", async () => {
  realMock();
  await connect();
  await expandCurrent();
  await click(button("Растворы", container.querySelector(".category-tabs")!));
  expect(
    container.querySelectorAll(".current-block .work-patient-toggle"),
  ).toHaveLength(2);
  expect(
    container.querySelector(".current-block .work-item")?.textContent,
  ).toContain("15 мл/ч");
  expect(
    container.querySelector(".current-block .work-item")?.textContent,
  ).not.toContain("5 мг");
  expect(
    container.querySelector(".next-block .work-patient-toggle"),
  ).toBeNull();
});
it("individual patient defaults to the same worklist and can switch to grid and back without GET", async () => {
  const calls = realMock();
  await connect();
  const group = await expandCurrent();
  await click(group.querySelector(".work-open-patient")!);
  expect(container.querySelector(".individual-workspace")).not.toBeNull();
  expect(
    container.querySelectorAll(".current-block .work-patient-toggle"),
  ).toHaveLength(1);
  expect(container.querySelector(".current-block .work-item")).not.toBeNull();
  await click(button("Сетка", container.querySelector(".view-switch")!));
  expect(container.querySelector("[role=table]")).not.toBeNull();
  await click(container.querySelector(".hour-cell.done")!);
  expect(container.querySelector("dialog[open]")?.textContent).toContain(
    "Выполнено",
  );
  await click(container.querySelector('[aria-label="Закрыть детали"]')!);
  await click(button("Лента", container.querySelector(".view-switch")!));
  expect(container.querySelector(".current-block .work-item")).not.toBeNull();
  expect(calls).toHaveLength(4);
});
it("history alone shows EXECUTED and NOT_EXECUTED with original colors and reasons in details", async () => {
  realMock();
  await connect();
  await click(
    button("История отметок", container.querySelector(".work-view-filter")!),
  );
  await click(container.querySelector(".work-history .time-toggle")!);
  await click(container.querySelector(".work-history .work-patient-toggle")!);
  expect(container.querySelectorAll(".work-history .work-item")).toHaveLength(
    2,
  );
  const card = [...container.querySelectorAll(".work-history .work-item")].find(
    (e) => e.textContent?.includes("Не выполнено"),
  )!;
  expect(card.textContent).toContain("Учебный комментарий");
  await click(card);
  const dialog = container.querySelector("dialog")!;
  expect(dialog.textContent).toContain("Не выполнено");
  expect(dialog.textContent).toContain("Отсутствует препарат");
  expect(dialog.textContent).not.toContain("MEDICATION_ABSENT");
  expect(
    (dialog.querySelector(".revision-detail .swatch") as HTMLElement).style
      .background,
  ).toBe("rgb(51, 68, 85)");
  expect(
    (dialog.querySelector(".result-detail") as HTMLElement).style.borderColor,
  ).toBe("rgb(51, 68, 85)");
  expect(dialog.textContent).not.toContain("Вся история редакций");
});
it("monitoring comments remain readable in history without invented units", async () => {
  realMock(rawChains);
  await connect();
  await click(button("Мониторинг", container.querySelector(".category-tabs")!));
  await click(
    button("История отметок", container.querySelector(".work-view-filter")!),
  );
  await click(container.querySelector(".work-history .time-toggle")!);
  await click(container.querySelector(".work-history .work-patient-toggle")!);
  expect(
    container.querySelector(".work-history .work-item")?.textContent,
  ).toContain("38.7");
});
it("partial API failures keep successful patients usable and do not claim full success", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("/branches")
              ? branches
              : url.endsWith("/patients")
                ? rawPatients()
                : workChains(),
          ),
          { status: url.includes("/c2/") ? 403 : 200 },
        ),
    ),
  );
  await connect();
  await expandCurrent();
  expect(container.querySelector(".current-block .work-item")).not.toBeNull();
  expect(container.querySelector(".work-unloaded")?.textContent).toContain(
    "Ошибка загрузки",
  );
  expect(container.querySelector(".load-progress")?.textContent).toContain(
    "Ошибок: 1",
  );
  expect(container.querySelector(".refresh-status")?.textContent).not.toContain(
    "Успешное обновление",
  );
  await nav("Настройки");
  expect(container.textContent).toContain("Доступ запрещён");
});
it("large worklists use windowing rather than pages, and grid stays virtualized", async () => {
  await openDemo(true);
  const group = await expandCurrent();
  expect(group.querySelector(".windowed-list")).not.toBeNull();
  expect(group.querySelectorAll(".work-item").length).toBeLessThan(25);
  expect(container.querySelector(".pager")).toBeNull();
  const scroller = group.querySelector(".windowed-list")!;
  await act(async () => {
    scroller.scrollTop = 3000;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  expect(group.querySelectorAll(".work-item").length).toBeLessThan(25);
  await openFirstPatient();
  await click(button("Сетка", container.querySelector(".view-switch")!));
  expect(
    container.querySelector("[role=table]")?.getAttribute("aria-rowcount"),
  ).toBe("361");
  expect(container.querySelectorAll(".hour-cell").length).toBeLessThan(400);
  expect(fetch).not.toHaveBeenCalled();
});
it("refresh removes a newly marked task, keeps other tasks, expansion and scroll container", async () => {
  let updated = false;
  let resolve!: (r: Response) => void;
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/branches"))
        return new Response(JSON.stringify(branches));
      if (url.endsWith("/patients"))
        return new Response(JSON.stringify(rawPatients()));
      const data = workChains();
      if (updated)
        data[0].elements[0].results = [
          { id: "new-mark", hour: T(18, 8), status: "EXECUTED" },
        ];
      if (updated && url.includes("/c1/"))
        return new Promise<Response>((r) => (resolve = r));
      return new Response(JSON.stringify(data));
    }),
  );
  await connect();
  const group = await expandCurrent();
  const toggle = group.querySelector(".work-patient-toggle")!;
  container.scrollTop = 240;
  updated = true;
  await click(button("Обновить", container.querySelector(".compact-title")!));
  expect(
    container.querySelector(".current-block .work-item")?.textContent,
  ).toContain("Учебное текущее");
  const data = workChains();
  data[0].elements[0].results = [
    { id: "new-mark", hour: T(18, 8), status: "EXECUTED" },
  ];
  await act(async () => resolve(new Response(JSON.stringify(data))));
  expect(group.querySelector(".work-patient-toggle")).toBe(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(group.textContent).not.toContain("Учебное текущее");
  expect(group.textContent).toContain("Учебное второе");
  expect(container.scrollTop).toBe(240);
  expect(calls).toHaveLength(7);
});
it("a failed department refresh remains retryable and never advances the successful timestamp", async () => {
  let fail = false;
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      if (fail) return new Response("", { status: 500 });
      return new Response(
        JSON.stringify(
          url.endsWith("/branches")
            ? branches
            : url.endsWith("/patients")
              ? rawPatients()
              : workChains(),
        ),
      );
    }),
  );
  await connect();
  await expandCurrent();
  const stamp = container.querySelector(".refresh-status")!.textContent;
  fail = true;
  await click(button("Обновить", container.querySelector(".compact-title")!));
  expect(container.querySelector(".refresh-status")!.textContent).toBe(stamp);
  expect(
    [...container.querySelectorAll(".schedule-alert")].some((e) =>
      e.textContent?.includes("Список пациентов не обновлён"),
    ),
  ).toBe(true);
  expect(
    button("Обновить", container.querySelector(".compact-title")!).disabled,
  ).toBe(false);
  expect(container.querySelector(".current-block .work-item")).not.toBeNull();
  fail = false;
  await click(button("Обновить", container.querySelector(".compact-title")!));
  expect(container.textContent).not.toContain("Список пациентов не обновлён");
  expect(calls).toHaveLength(8);
});
it("auto-refresh is optional, preserves expansion, and hour changes regroup without fetching on scroll", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T(18, 8, 42)));
  const calls = realMock();
  await connect();
  await expandCurrent();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(calls).toHaveLength(4);
  await nav("Настройки");
  await click(
    container.querySelector('[aria-label="Автообновление каждые 60 секунд"]')!,
  );
  await nav("Общая лента");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(calls).toHaveLength(7);
  expect(
    container
      .querySelector(".current-block .work-patient-toggle")
      ?.getAttribute("aria-expanded"),
  ).toBe("true");
  expect(container.querySelector(".refresh-status")?.textContent).toContain(
    "авто 60 с",
  );
  vi.setSystemTime(new Date(T(18, 9, 1)));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(
    container.querySelector(".current-block .work-item")?.textContent,
  ).toContain("Учебное следующее");
  expect(calls).toHaveLength(7);
});

it("login stays explicit, token is not persisted or requested before user action", async () => {
  await render();
  expect(container.textContent).toContain("Подключение к CleverVet");
  expect(fetch).not.toHaveBeenCalled();
  expect(
    container
      .querySelector("input[type=password]")
      ?.getAttribute("autocomplete"),
  ).toBe("off");
});
it("technical controls and logout are in settings, not above prescriptions", async () => {
  await openDemo();
  expect(
    container.querySelector('[aria-label="Часовой пояс IANA"]'),
  ).toBeNull();
  expect(container.querySelector(".time-settings")).toBeNull();
  await nav("Настройки");
  expect(
    container.querySelector('[aria-label="Часовой пояс IANA"]'),
  ).not.toBeNull();
  expect(
    container.querySelector('[aria-label="Источник интервала"]'),
  ).not.toBeNull();
  expect(container.textContent).toContain("Диагностика");
  await click(button("Выйти и очистить данные"));
  expect(container.querySelector("#jwt")).not.toBeNull();
  expect(container.querySelector(".work-patient")).toBeNull();
});
it("existing patient selection, department selector and empty state still work", async () => {
  await openDemo();
  await nav("Пациенты");
  expect(container.querySelectorAll(".patient-card")).toHaveLength(2);
  expect(container.querySelector('[aria-label="Отделение"]')).toBeNull();
  await nav("Настройки");
  await changeSelect(
    container.querySelector('[aria-label="Отделение"]')!,
    "demo-empty",
  );
  await nav("Пациенты");
  expect(container.querySelectorAll(".patient-card")).toHaveLength(0);
  expect(container.textContent).toContain(
    "Нет пациентов с подтверждёнными активными картами",
  );
});
it("patient list uses compact two-column card content and opens existing actions from ellipsis", async () => {
  await openDemo();
  await nav("Пациенты");
  const tiles = [...container.querySelectorAll<HTMLElement>(".patient-tile")];
  expect(tiles).toHaveLength(2);
  const first = tiles[0];
  expect(first.querySelector(".patient-card-photo .patient-photo img")).not.toBeNull();
  expect(first.querySelector(".patient-card-name")?.textContent).toContain(
    "Барс",
  );
  expect(first.querySelector(".patient-card-meta")?.textContent).toBe(
    "Кошка··4.2 кг",
  );
  expect(first.querySelector(".patient-card-diagnosis")?.textContent).toContain(
    "восстановление",
  );
  expect(first.querySelector(".patient-card-severity .severity-badge")).not.toBeNull();
  expect(first.querySelector(".patient-card-counters")?.textContent).toContain(
    "Сейчас:",
  );
  expect(first.querySelector(".patient-card-counters")?.textContent).toContain(
    "След. час:",
  );
  expect(first.textContent).not.toMatch(/Владелец|Клетка|Метис/);
  expect(tiles[1].querySelector(".patient-photo img")).toBeNull();
  expect(tiles[1].querySelector(".patient-card-diagnosis.is-empty")).not.toBeNull();

  await click(first.querySelector(".patient-card-menu")!);
  expect(container.querySelector(".patient-heading h1")?.textContent).toContain(
    "Барс",
  );
  expect(container.querySelector<HTMLDetailsElement>(".patient-actions")?.open).toBe(
    true,
  );
});
it("loaded medical records are reused through all view/tab switches and scrolling", async () => {
  const calls = realMock();
  await connect();
  expect(calls).toHaveLength(4);
  expect(calls[2]).toContain("/medical-records/c1/");
  expect(calls[3]).toContain("/medical-records/c2/");
  await openFirstPatient();
  await click(button("Сетка", container.querySelector(".view-switch")!));
  const scroll = container.querySelector(".grid-scroll")!;
  await act(async () => {
    scroll.scrollLeft = 500;
    scroll.scrollTop = 500;
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await click(button("Лента", container.querySelector(".view-switch")!));
  await nav("Общая лента");
  await nav("Настройки");
  await nav("Общая лента");
  expect(calls).toHaveLength(4);
  expect(container.innerHTML).not.toContain("MOCK_VALUE");
});
it("401 expires connection and cleans all loaded groups", async () => {
  let n = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(++n === 1 ? branches : []), {
          status: n === 1 ? 200 : 401,
        }),
    ),
  );
  await connect();
  expect(container.textContent).toContain("истёк");
  expect(container.querySelector("#jwt")).not.toBeNull();
  expect(container.querySelector(".work-patient")).toBeNull();
});
it("CORS/network TypeError has no raw private message and 403 can be retried at login", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("MOCK_PRIVATE_DATA");
    }),
  );
  await connect();
  expect(container.textContent).toContain("Возможные причины: CORS, сеть, TLS");
  expect(container.innerHTML).not.toContain("MOCK_PRIVATE_DATA");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 403 })),
  );
  (container.querySelector("#jwt") as HTMLInputElement).value = "MOCK_VALUE";
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(container.textContent).toContain("Доступ запрещён");
  expect((container.querySelector("#jwt") as HTMLInputElement).value).toBe("");
});
it("pagehide keeps the active session for Safari tab restoration", async () => {
  await openDemo();
  await act(async () => {
    window.dispatchEvent(new Event("pagehide"));
    expect(container.querySelector(".work-patient")).not.toBeNull();
  });
  expect(container.querySelector("#jwt")).toBeNull();
});
it("shift navigation uses real boundaries rather than opening minutes", async () => {
  realMock();
  await connect();
  expect(container.querySelector(".compact-day small")?.textContent).toContain(
    "08:00",
  );
  expect(
    container.querySelector(".compact-day small")?.textContent,
  ).not.toContain("08:42");
  const label = container.querySelector(".compact-day")!.textContent;
  await click(container.querySelector('[aria-label="Предыдущая смена"]')!);
  expect(container.querySelector(".compact-day")!.textContent).not.toBe(label);
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("progress remains loading until every queued patient has settled", async () => {
  const waits = new Map<string, (response: Response) => void>();
  let chainCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith("/branches"))
        return new Response(JSON.stringify(branches));
      if (url.endsWith("/patients"))
        return new Response(JSON.stringify(rawPatients(5)));
      chainCalls++;
      const card = /medical-records\/([^/]+)/.exec(url)![1];
      return new Promise<Response>((resolve, reject) => {
        waits.set(card, resolve);
        options.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Mock abort", "AbortError")),
          { once: true },
        );
      });
    }),
  );
  await connect();
  expect(chainCalls).toBe(3);
  expect(container.querySelector(".load-progress")?.textContent).toContain(
    "Загрузка: 0 / 5",
  );
  await act(async () =>
    waits.get("c1")!(new Response(JSON.stringify(rawChains))),
  );
  expect(chainCalls).toBe(4);
  expect(container.querySelector(".load-progress")?.textContent).toContain(
    "Загрузка: 1 / 5",
  );
  for (const card of ["c2", "c3", "c4", "c5"])
    await act(async () =>
      waits.get(card)!(new Response(JSON.stringify(rawChains))),
    );
  expect(container.querySelector(".load-progress")).toBeNull();
});
it("a 48-hour actual sheet is available in the grid with horizontal virtualization", async () => {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls++;
      const patients = rawPatients(1);
      patients[0].card.treatment.sheets = [
        {
          id: "long-sheet",
          start: "2026-10-18T08:00:00Z",
          end: "2026-10-20T08:00:00Z",
        },
      ];
      return new Response(
        JSON.stringify(
          url.endsWith("/branches")
            ? branches
            : url.endsWith("/patients")
              ? patients
              : rawChains,
        ),
      );
    }),
  );
  await connect();
  await openFirstPatient();
  await click(button("Сетка", container.querySelector(".view-switch")!));
  expect(
    container.querySelector("[role=table]")?.getAttribute("aria-colcount"),
  ).toBe("49");
  const scroll = container.querySelector(".grid-scroll")!;
  await act(async () => {
    scroll.scrollLeft = 24 * 56;
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  expect(container.querySelector(".hour-cell.done")).not.toBeNull();
  expect(container.querySelectorAll(".hour-cell").length).toBeLessThan(100);
  expect(calls).toBe(3);
});
it("details show the selected revision without the removed revision-history control", async () => {
  const data = rawChains.map((chain) => ({
    ...chain,
    elements: chain.elements.map((revision) => ({
      ...revision,
      dates: { ...revision.dates, periodicity: -1 },
    })),
  }));
  realMock(data);
  await connect();
  await click(
    container.querySelector(".schedule-clarification .work-patient-toggle")!,
  );
  const card = [
    ...container.querySelectorAll(".schedule-clarification .work-item"),
  ].find((e) => e.textContent?.includes("Учебный препарат"))!;
  await click(card);
  expect(container.querySelector(".revision-history")).toBeNull();
  expect(container.querySelector("dialog")?.textContent).not.toContain(
    "Только просмотр",
  );
  expect(data.find((c) => c.id === "med")!.elements).toHaveLength(2);
  expect(fetch).toHaveBeenCalledTimes(4);
});

it("rounded zero-window assignment moves from next hour to done and the patient counters reuse cached data", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(T(18, 10, 31)));
  const raw = [
    {
      id: "once",
      name: "Synthetic once",
      type: "MEDICATION",
      elements: [
        {
          id: "p",
          color: "",
          dates: { start: T(18, 11, 21), periodicity: 0 },
          endDate: T(18, 12),
          results: [] as { id: string; hour: string; status: string }[],
        },
      ],
    },
  ];
  const calls = realMock(raw);
  await connect();
  const next = container.querySelector(".next-block")!;
  await click(next.querySelector(".work-patient-toggle")!);
  expect(next.querySelector(".work-item time")?.textContent).toBe("11:00");
  expect(next.querySelector(".work-item")?.textContent).toContain(
    "Synthetic once",
  );
  const beforeNavigation = calls.length;
  await nav("Пациенты");
  const counters = container.querySelector(
    '.patient-card [aria-label="Почасовая сводка"]',
  )!;
  expect(counters.textContent).toContain("След. час: 1");
  expect(counters.querySelector('[data-status="planned"]')).not.toBeNull();
  await nav("Общая лента");
  expect(calls.length).toBe(beforeNavigation);
  raw[0].elements[0].results = [
    { id: "mark", hour: T(18, 11), status: "NOT_EXECUTED" },
  ];
  await click(button("Обновить", container.querySelector(".compact-title")!));
  expect(container.querySelector(".next-block .work-item")).toBeNull();
  expect(
    container.querySelector('.next-block [data-status="done"]')?.textContent,
  ).toBe("✓");
  expect(
    container.querySelector(".next-block .work-empty")?.textContent,
  ).toContain("имеют отметку");
  const beforeSecondNavigation = calls.length;
  await nav("Пациенты");
  expect(
    container.querySelector('.patient-card [data-status="done"]')?.textContent,
  ).toContain("След. час: 0");
  expect(calls.length).toBe(beforeSecondNavigation);
});

it("inactive editions do not trigger clarification; their stored data remain inspectable", async () => {
  const calls = realMock([
    {
      id: "inactive-chain",
      name: "Synthetic inactive",
      type: "PROCEDURE",
      elements: [
        {
          id: "inactive-prescription",
          dates: { periodicity: 0 },
          color: "yellow",
          creationDate: T(18, 8),
          instruction: "Synthetic preserved instruction",
          specifics: { dose: { value: 1, unit: "мг" } },
          results: [{ id: "stored", hour: T(18, 8), status: "EXECUTED" }],
        },
      ],
    },
  ]);
  await connect();
  expect(container.querySelector(".schedule-alert")).toBeNull();
  expect(
    container.querySelector(".current-block .work-patient-toggle"),
  ).toBeNull();
  expect(
    container.querySelector(".next-block .work-patient-toggle"),
  ).toBeNull();
  expect(
    container.querySelector(".schedule-clarification .work-patient-toggle"),
  ).toBeNull();
  expect(
    container.querySelector(".later-block .time-toggle")?.textContent,
  ).toContain("0");
  await nav("Пациенты");
  const counters = container.querySelector('[aria-label="Почасовая сводка"]')!;
  expect(counters.querySelectorAll('[data-status="nothing"]')).toHaveLength(2);
  expect(counters.textContent).not.toContain("⚠");
  await nav("Настройки");
  expect(container.textContent).toContain("Предупреждений о редакциях: 0");
  expect(
    container.querySelectorAll(".diagnostic-table-scroll tbody tr"),
  ).toHaveLength(0);
  await nav("Пациенты");
  await click(container.querySelector(".patient-card")!);
  await click(button("Сетка", container.querySelector(".view-switch")!));
  await click(container.querySelector(".hour-cell.done")!);
  expect(container.querySelector("dialog")?.textContent).toContain(
    "Synthetic preserved instruction",
  );
  expect(container.querySelector("dialog")?.textContent).toContain("Выполнено");
  expect(container.querySelector("dialog .warning")).toBeNull();
  expect(container.querySelector("dialog")?.textContent).not.toContain(
    "неоднозначны",
  );
  expect(calls).toHaveLength(4);
});

it.each([undefined, null])(
  "manual periodicity %s creates no work/clarification and retains exact results in history/details",
  async (periodicity) => {
    const dates =
      periodicity === undefined
        ? { start: T(18, 8, 21) }
        : { start: T(18, 8, 21), periodicity };
    const calls = realMock([
      {
        id: "as-needed",
        name: "Synthetic manual event",
        type: "MONITORING",
        elements: [
          {
            id: "manual-p",
            dates,
            color: "yellow",
            results: [
              {
                id: "a",
                hour: T(18, 8, 17),
                creationDate: T(18, 10, 42),
                status: "EXECUTED",
                comment: "Synthetic recorded value",
              },
              {
                id: "b",
                hour: T(18, 8, 27),
                creationDate: T(18, 11),
                status: "NOT_EXECUTED",
              },
              {
                id: "c",
                hour: T(18, 8, 31),
                creationDate: T(18, 11),
                status: "CUSTOM_STATUS",
              },
            ],
          },
        ],
      },
    ]);
    await connect();
    expect(container.querySelector(".schedule-alert")).toBeNull();
    expect(
      container.querySelector(".current-block .work-patient-toggle"),
    ).toBeNull();
    expect(
      container.querySelector(".next-block .work-patient-toggle"),
    ).toBeNull();
    expect(
      container.querySelector(".schedule-clarification .work-patient-toggle"),
    ).toBeNull();
    expect(
      container.querySelector(".later-block .time-toggle")?.textContent,
    ).toContain("0");
    await click(
      button("История отметок", container.querySelector(".work-view-filter")!),
    );
    await click(container.querySelector(".work-history .time-toggle")!);
    await click(container.querySelector(".work-history .work-patient-toggle")!);
    const rows = container.querySelectorAll(".work-history .work-item");
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector("time")?.textContent).toBe("08:17");
    expect(rows[0].textContent).toContain("Synthetic recorded value");
    expect(rows[1].textContent).toContain("Не выполнено");
    expect(rows[2].textContent).toContain("CUSTOM_STATUS");
    await click(rows[0]);
    expect(container.querySelector("dialog")?.textContent).toContain(
      "По необходимости · отмечается вручную",
    );
    expect(container.querySelector("dialog")?.textContent).toContain("10:42");
    expect(container.querySelector("dialog .warning")).toBeNull();
    expect(calls).toHaveLength(4);
  },
);

it("structured mg/kg yields the same dose/volume in both feeds and details; diagnostics hides raw IDs by default", async () => {
  const prescriptionId = "synthetic-prescription-long-id-00000000";
  const calls = realMock([
    {
      id: "dose-case",
      name: "Учебный препарат",
      type: "MEDICATION",
      elements: [
        {
          id: prescriptionId,
          parentId: "synthetic-parent-long-id",
          dates: { start: T(18, 8, 21), periodicity: 1 },
          endDate: T(18, 10),
          color: "yellow",
          specifics: {
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
          },
          results: [],
        },
      ],
    },
  ]);
  await connect();
  const current = await expandCurrent();
  expect(current.textContent).toContain("Полная доза: 4 мг");
  expect(current.textContent).toContain("Набрать: 0,4 мл");
  expect(current.textContent).toContain("в/в");
  expect(current.textContent).not.toContain("единицы не подтверждены");
  expect(container.querySelector(".schedule-clarification")).toBeNull();
  expect(container.querySelector(".schedule-alert")).toBeNull();
  await openFirstPatient();
  if (!container.querySelector(".current-block .work-item"))
    await expandCurrent();
  expect(
    container.querySelector(".current-block .work-item")?.textContent,
  ).toContain("Набрать: 0,4 мл");
  await click(container.querySelector(".current-block .work-item")!);
  const dialog = container.querySelector("dialog")!;
  expect(dialog.textContent).toContain("1 мг/кг");
  expect(dialog.textContent).toContain("На массу 4 кг");
  expect(dialog.textContent).toContain("10 мг/мл");
  expect(dialog.textContent).toContain("0,4 мл");
  expect(dialog.textContent).not.toContain(prescriptionId);
  expect(dialog.textContent).not.toContain("parentId");
  expect(dialog.textContent).not.toContain("dates.periodicity");
  await click(container.querySelector('[aria-label="Закрыть детали"]')!);
  await nav("Настройки");
  await click(
    container.querySelector('[aria-label="Технические детали назначений"]')!,
  );
  await nav("Общая лента");
  if (!container.querySelector(".current-block .work-item"))
    await expandCurrent();
  await click(container.querySelector(".current-block .work-item")!);
  expect(container.querySelector("dialog")?.textContent).toContain(
    prescriptionId,
  );
  expect(container.querySelector("dialog")?.textContent).toContain("parentId");
  expect(calls).toHaveLength(4);
});
it("rate dosage stays per minute in the working feed and never says to draw a bolus", async () => {
  realMock([
    {
      id: "rate-med",
      name: "Учебная скорость",
      type: "MEDICATION",
      elements: [
        {
          id: "r",
          dates: { start: T(18, 8), periodicity: 1 },
          endDate: T(18, 10),
          specifics: {
            dosage: {
              value: 2,
              units: {
                substance: "MICROGRAM",
                volume: "KILOGRAM",
                time: "MINUTE",
              },
            },
            concentration: {
              value: 10,
              units: { substance: "MILLIGRAM", volume: "MILLILITRE" },
            },
            weightKg: 4,
            route: "INTRAVENOUS",
          },
          results: [],
        },
      ],
    },
  ]);
  await connect();
  const group = await expandCurrent();
  expect(group.textContent).toContain("8 мкг/мин");
  expect(group.textContent).toContain("0,0008 мл/мин");
  expect(group.textContent).not.toContain("Набрать");
  expect(group.querySelector(".work-warning-icon")).toBeNull();
});
it("unknown dose units produce only a local warning while the valid medication stays clear", async () => {
  const make = (id: string, substance: string) => ({
    id,
    name: `Synthetic ${id}`,
    type: "MEDICATION",
    elements: [
      {
        id: `${id}-revision`,
        dates: { start: T(18, 8), periodicity: 1 },
        endDate: T(18, 10),
        specifics: {
          dosage: { value: 1, units: { substance, volume: "KILOGRAM" } },
          concentration: {
            value: 10,
            units: { substance: "MILLIGRAM", volume: "MILLILITRE" },
          },
          weightKg: 4,
          route: "INTRAVENOUS",
        },
        results: [],
      },
    ],
  });
  realMock([make("good", "MILLIGRAM"), make("bad", "UNKNOWN")]);
  await connect();
  const group = await expandCurrent(),
    rows = [...group.querySelectorAll(".work-item")];
  const good = rows.find((r) => r.textContent?.includes("Synthetic good"))!,
    bad = rows.find((r) => r.textContent?.includes("Synthetic bad"))!;
  expect(good.querySelector(".work-warning-icon")).toBeNull();
  expect(good.textContent).toContain("0,4 мл");
  expect(bad.textContent).toContain("Доза: единицы не подтверждены");
  expect(bad.textContent).not.toContain("Набрать");
  expect(container.querySelector(".schedule-alert")).toBeNull();
  expect(container.querySelector(".schedule-clarification")).toBeNull();
});
