// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Archive } from "../src/Archive";
import type { ArchiveApi } from "../src/archiveApi";
import { ApiError } from "../src/api";
import { ArchiveReadError } from "../src/archiveStream";
import {
  emptyArchiveQuery,
  type ArchivePage,
  type ArchiveRecord,
  type ArchiveQuery,
  type ArchiveProgress,
} from "../src/archiveModel";
import { normalizeChains, normalizePatients } from "../src/model";
const branch = {
    id: "b",
    name: "Учебная клиника",
    workShiftStart: "8",
    departments: [{ id: "d", name: "Учебный стационар" }],
  },
  branches = [branch, { ...branch, id: "b2", name: "Другая учебная клиника" }];
const row = (n = 0): ArchiveRecord => ({
  id: `card-${n}`,
  patientId: `patient-${n}`,
  name: `Учебный ${n}`,
  number: `УЧ-${n}`,
  owner: "Вымышленный Владелец",
  diagnoses: "Учебный диагноз",
  hospital: "ROUND_THE_CLOCK",
  start: Date.parse("2026-10-18T05:00:00Z"),
  end: Date.parse("2026-10-19T05:00:00Z"),
  result: "DISCHARGED",
  departmentId: "d",
  department: "Учебный стационар",
  arrivalDepartment: "Учебный стационар",
});
const patient = normalizePatients([
  {
    id: "patient-0",
    name: "Учебный 0",
    species: "Кошка",
    card: {
      id: "card-0",
      status: "ARCHIVED",
      treatment: {
        start: "2026-10-18T05:00:00Z",
        end: "2026-10-19T05:00:00Z",
        sheets: [
          {
            id: "sheet",
            start: "2026-10-18T05:00:00Z",
            end: "2026-10-19T05:00:00Z",
          },
        ],
      },
    },
  },
])[0];
const chains = normalizeChains([
  {
    id: "chain",
    name: "Учебный контроль",
    type: "MONITORING",
    elements: [
      {
        id: "revision",
        color: "yellow",
        dates: { start: "2026-10-18T05:00:00Z", periodicity: 1 },
        results: [
          {
            id: "result",
            status: "EXECUTED",
            comment: "Учебный результат ✓",
            hour: "2026-10-18T06:00:00Z",
            creationDate: "2026-10-18T08:15:00Z",
          },
        ],
      },
    ],
  },
]);
function page(rows: ArchiveRecord[] = [row()]): ArchivePage {
  return {
    rows,
    page: 0,
    scanned: rows.length,
    matched: rows.length,
    bytes: 1000,
    complete: true,
  };
}
function mock() {
  return {
    page: vi.fn(
      async (
        _b: string,
        _q: ArchiveQuery,
        _p: number,
        _z: string,
        _s: AbortSignal,
        _progress?: (p: ArchiveProgress) => void,
      ) => page(),
    ),
    patient: vi.fn(async () => patient),
    chains: vi.fn(async () => chains),
    belongings: vi.fn(async () => []),
    close: vi.fn(),
  } satisfies ArchiveApi;
}
let root: Root, box: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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
    vi.fn(() => Promise.reject(Error("Live requests forbidden"))),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(api: ArchiveApi, expire = vi.fn()) {
  await act(async () =>
    root.render(
      <Archive
        api={api}
        branches={branches}
        initialBranch="b"
        zone="Europe/Moscow"
        demo={false}
        onExpire={expire}
      />,
    ),
  );
}
const button = (name: string) => {
  const b = [...box.querySelectorAll("button")].find(
    (x) => x.textContent === name || x.textContent?.trim() === name,
  );
  if (!b) throw Error("Missing " + name);
  return b;
};
const click = async (b: Element) =>
  act(async () => {
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
async function value(label: string, v: string) {
  const el = box.querySelector(`[aria-label="${label}"]`) as
    | HTMLInputElement
    | HTMLSelectElement;
  await act(async () => {
    if (el instanceof HTMLInputElement) {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      el.value = v;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}
it("empty archive displays an honest empty state", async () => {
  const a = mock();
  a.page.mockResolvedValue(page([]));
  await render(a);
  expect(box.textContent).toContain("Архив пуст");
  expect(a.patient).not.toHaveBeenCalled();
});
it("list does not fan out patient/cards; filters and search apply only on submit", async () => {
  const a = mock();
  await render(a);
  expect(box.querySelectorAll(".archive-row")).toHaveLength(1);
  expect(a.patient).not.toHaveBeenCalled();
  expect(a.chains).not.toHaveBeenCalled();
  await value("Поиск в архиве", "Учебный");
  await value("Результат в архиве", "DIED");
  expect(a.page).toHaveBeenCalledTimes(1);
  await click(button("Найти"));
  expect(a.page).toHaveBeenCalledTimes(2);
  expect(a.page.mock.calls[1][1]).toEqual({
    ...emptyArchiveQuery(),
    search: "Учебный",
    result: "DIED",
  });
  expect(a.page.mock.calls[1][2]).toBe(0);
});
it("renders only a page and refetches when advancing; does not claim server pagination", async () => {
  const a = mock();
  a.page.mockResolvedValue({
    ...page(Array.from({ length: 30 }, (_, i) => row(i))),
    scanned: 15000,
    matched: 15000,
  });
  await render(a);
  expect(box.querySelectorAll(".archive-row")).toHaveLength(30);
  await click(button("Далее"));
  expect(a.page.mock.calls[1][2]).toBe(1);
  expect(box.textContent).toContain("порядок сервера");
});
it("branch switch aborts previous stream and ignores late response", async () => {
  const a = mock();
  let finish!: (p: ArchivePage) => void;
  a.page.mockImplementationOnce(() => new Promise((r) => (finish = r)));
  await render(a);
  const old = a.page.mock.calls[0][4];
  await value("Филиал архива", "b2");
  expect(old.aborted).toBe(true);
  expect(a.page.mock.calls[1][0]).toBe("b2");
  await act(async () =>
    finish(page([{ ...row(), name: "OLD MUST NOT SHOW" }])),
  );
  expect(box.textContent).not.toContain("OLD MUST NOT SHOW");
  expect(a.patient).not.toHaveBeenCalled();
});
it("cancel leaves no partial successful list and permits retry", async () => {
  const a = mock();
  a.page.mockImplementationOnce(() => new Promise(() => {}));
  await render(a);
  const s = a.page.mock.calls[0][4];
  await click(button("Отменить загрузку"));
  expect(s.aborted).toBe(true);
  expect(box.querySelector(".archive-row")).toBeNull();
  expect(box.textContent).toContain("Полный список не получен");
  await click(button("Обновить архив"));
  expect(box.querySelector(".archive-row")).not.toBeNull();
});
it("authorization error expires session; no server text appears", async () => {
  const a = mock(),
    expire = vi.fn();
  a.page.mockRejectedValue(new ApiError("Unauthorized", 401));
  await render(a, expire);
  expect(expire).toHaveBeenCalled();
  expect(box.querySelector(".archive-row")).toBeNull();
});
it("oversized archive shows clear limit warning without partial rows", async () => {
  const a = mock();
  a.page.mockRejectedValue(new ArchiveReadError("Limit"));
  await render(a);
  expect(box.querySelector("[role=alert]")?.textContent).toContain(
    "безопасный предел",
  );
  expect(box.querySelector(".archive-row")).toBeNull();
});
it("opens card read-only, lazily loads history by slot hour and shares grid data", async () => {
  const a = mock();
  await render(a);
  await click(box.querySelector(".archive-row")!);
  expect(a.patient).toHaveBeenCalled();
  expect(box.textContent).toContain("Архив · просмотр");
  expect(box.textContent).toContain("Учебный диагноз");
  expect(a.chains).not.toHaveBeenCalled();
  await click(button("Отметки"));
  expect(a.chains).toHaveBeenCalledTimes(1);
  expect(box.querySelector(".archive-event")?.textContent).toContain("09:00");
  expect(box.querySelector(".archive-event")?.textContent).not.toContain(
    "11:15",
  );
  expect(box.textContent).toContain("Учебный результат ✓");
  await click(box.querySelector(".archive-event")!);
  expect(box.querySelector("dialog[open]")).not.toBeNull();
  expect(
    [...box.querySelectorAll("button")].some((b) =>
      /Изменить отметку|Сохранить|Удалить пациента|Выписать/.test(
        b.textContent ?? "",
      ),
    ),
  ).toBe(false);
  await click(box.querySelector("dialog button[aria-label]")!);
  await click(button("Сетка"));
  expect(box.querySelector(".grid-scroll")).not.toBeNull();
  expect(a.chains).toHaveBeenCalledTimes(1);
  await click(button("Данные"));
  await act(async () => {
    const details = box.querySelector(".belongings") as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  expect(a.belongings).toHaveBeenCalledTimes(1);
  expect(box.textContent).toContain("Личных вещей нет");
  expect(box.querySelector("form")).toBeNull();
});
it("different card identity leaves summary visible but blocks chains and write controls", async () => {
  const a = mock();
  a.patient.mockRejectedValue(new ArchiveReadError("DifferentCard"));
  await render(a);
  await click(box.querySelector(".archive-row")!);
  expect(box.textContent).toContain("другую медицинскую карту");
  expect(box.querySelector(".archive-tabs")).toBeNull();
  expect(a.chains).not.toHaveBeenCalled();
  expect(box.textContent).toContain("Учебный диагноз");
});
