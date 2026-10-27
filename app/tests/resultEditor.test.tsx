// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ResultEditor } from "../src/ResultEditor";
import { App } from "../src/App";
import { normalizeChains, normalizePatients } from "../src/model";
import {
  ResultWriteError,
  type ResultWriter,
  type ResultTarget,
  type ResultInput,
} from "../src/resultWriter";
const at = Date.parse("2026-10-18T08:00:00Z"),
  iso = (n: number) => new Date(n).toISOString();
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
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
    vi.fn(() => Promise.reject(Error("No live API"))),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const button = (text: string, scope: ParentNode = container) => {
  const b = [...scope.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  if (!b) throw Error(`Missing ${text}`);
  return b;
};
async function click(e: Element) {
  await act(async () => {
    e.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
async function textInput(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function setup(existing = false, manual = false) {
  const patient = normalizePatients([
    {
      id: "p",
      name: "Учебный пациент",
      card: {
        id: "card",
        status: "ACTIVE",
        treatment: {
          sheets: [
            {
              id: "s",
              start: iso(at - 3600000),
              end: iso(at + 86400000),
              locked: false,
            },
          ],
        },
      },
    },
  ])[0];
  const chain = normalizeChains([
    {
      id: "c",
      name: "Учебный препарат",
      type: "MEDICATION",
      elements: [
        {
          id: "r",
          dates: { start: iso(at), periodicity: manual ? null : 1 },
          specifics: {
            dosage: {
              value: 1,
              units: { substance: "MILLIGRAM", volume: "KILOGRAM" },
            },
            weightKg: 4,
            concentration: {
              value: 10,
              units: { substance: "MILLIGRAM", volume: "MILLILITRE" },
            },
            route: "INTRAVENOUS",
          },
          results: existing
            ? [
                {
                  id: "result",
                  status: "EXECUTED",
                  comment: "38,5\nУчебная запись 🐈",
                  hour: iso(at),
                  creationDate: iso(at + 1000),
                  color: "violet",
                },
              ]
            : [],
        },
      ],
    },
  ])[0];
  const target: ResultTarget = {
    patient,
    chainId: chain.id,
    revision: chain.elements[0],
    at,
    zone: "UTC",
    existing: chain.elements[0].results[0],
  };
  const save = vi.fn(async (_target: ResultTarget, _input: ResultInput) => ({
      patient,
      chains: [chain],
    })),
    remove = vi.fn(async (_target: ResultTarget) => ({
      patient,
      chains: [chain],
    }));
  const writer: ResultWriter = {
    save,
    remove,
    setEnabled: vi.fn(),
    isEnabled: () => true,
    close: vi.fn(),
  };
  const onSaved = vi.fn(),
    onClose = vi.fn(),
    onRefresh = vi.fn(async () => {}),
    onExpire = vi.fn();
  return {
    chain,
    target,
    writer,
    save,
    remove,
    onSaved,
    onClose,
    onRefresh,
    onExpire,
  };
}
async function render(f: ReturnType<typeof setup>) {
  await act(async () =>
    root.render(
      <ResultEditor
        initial={f.target}
        chain={f.chain}
        writer={f.writer}
        onClose={f.onClose}
        onSaved={f.onSaved}
        onRefresh={f.onRefresh}
        onExpire={f.onExpire}
      />,
    ),
  );
  // Result-entry regressions explicitly choose execution for an unmarked cell.
  if (!f.target.existing) await click(button("✓ Выполнено"));
}
it("shows patient, exact time, shared medication calculation and optional free text", async () => {
  const f = setup();
  await render(f);
  expect(container.textContent).toContain("Учебный пациент");
  expect(container.textContent).toContain("0,4 мл");
  expect(container.textContent).toContain("4 мг");
  expect(container.textContent).toContain("08:00");
  expect(
    container.querySelector("textarea")?.getAttribute("inputmode"),
  ).toBeNull();
  expect(container.textContent).not.toContain("parentId");
  await textInput(
    container.querySelector("textarea")!,
    "38,5\nПроизвольный текст 🐈",
  );
  await click(button("Сохранить"));
  expect(f.save.mock.calls[0][1]).toMatchObject({
    status: "EXECUTED",
    comment: "38,5\nПроизвольный текст 🐈",
  });
  expect(f.onSaved).toHaveBeenCalled();
});
it("EXECUTED without comment can be saved", async () => {
  const f = setup();
  await render(f);
  await click(button("Сохранить"));
  expect(f.save.mock.calls[0][1].comment).toBe("");
});
it("NOT_EXECUTED starts without default reason and cannot save until selected", async () => {
  const f = setup();
  await render(f);
  await click(button("Не выполнено"));
  const select = container.querySelector("select")!;
  expect(select.value).toBe("");
  expect(button("Сохранить").disabled).toBe(true);
  expect(select.options).toHaveLength(6);
  await act(async () => {
    select.value = "ON_DIAGNOSTICS";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(button("Сохранить"));
  expect(f.save.mock.calls[0][1]).toMatchObject({
    status: "NOT_EXECUTED",
    reason: "ON_DIAGNOSTICS",
  });
});
it("existing comment is prefilled and can be cleared", async () => {
  const f = setup(true);
  await render(f);
  const area = container.querySelector("textarea")!;
  expect(area.value).toBe("38,5\nУчебная запись 🐈");
  await textInput(area, "");
  await click(button("Сохранить"));
  expect(f.save.mock.calls[0][1].comment).toBe("");
  expect(f.save.mock.calls[0][0].existing?.id).toBe("result");
});
it("delete needs a separate explicit confirmation", async () => {
  const f = setup(true);
  await render(f);
  await click(button("Удалить ошибочную"));
  expect(f.remove).not.toHaveBeenCalled();
  await click(button("Оставить"));
  expect(f.remove).not.toHaveBeenCalled();
  await click(button("Удалить ошибочную"));
  await click(button("Подтвердить удаление"));
  expect(f.remove).toHaveBeenCalledTimes(1);
  expect(f.onSaved.mock.calls[0][1]).toBe(true);
});
it("manual event allows choosing date/time in selected zone", async () => {
  const f = setup(false, true);
  await render(f);
  await textInput(
    container.querySelector('[aria-label="Время события"]') as HTMLInputElement,
    "08:17",
  );
  await click(button("Сохранить"));
  expect(f.save.mock.calls[0][0].at).toBe(at + 17 * 60000);
});
it("inactive cells cannot save", async () => {
  const f = setup();
  f.target.revision.start = null;
  await render(f);
  expect(button("Сохранить").disabled).toBe(true);
  expect(container.textContent).toContain("неактивна");
  expect(f.save).not.toHaveBeenCalled();
});
it("double submission locks the form until GET verification resolves", async () => {
  const f = setup();
  let resolve!: () => void;
  f.save.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = () => r({ patient: f.target.patient, chains: [f.chain] });
      }),
  );
  await render(f);
  await click(button("Сохранить"));
  expect(container.querySelector("fieldset")!.disabled).toBe(true);
  expect(f.onSaved).not.toHaveBeenCalled();
  await click(button("Проверка и сохранение"));
  expect(f.save).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  expect(f.onSaved).toHaveBeenCalledTimes(1);
});
for (const kind of ["Conflict", "Unverified"] as const)
  it(`${kind} keeps original result and blocks blind retry`, async () => {
    const f = setup(true);
    f.save.mockRejectedValue(new ResultWriteError(kind));
    await render(f);
    await click(button("Сохранить"));
    expect(f.onSaved).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")!.value).toContain("38,5");
    expect(button("Обновить и закрыть")).toBeTruthy();
    await click(button("Обновить и закрыть"));
    expect(f.onRefresh).toHaveBeenCalledTimes(1);
    expect(f.save).toHaveBeenCalledTimes(1);
  });
it("cancel does not write", async () => {
  const f = setup();
  await render(f);
  await click(button("Отмена"));
  expect(f.onClose).toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});
it("full demo flow: editing enabled by default, save, history edit and confirmed delete update feed", async () => {
  await act(async () => root.render(<App />));
  await click(button("Открыть демо"));
  await click(button("Настройки", container.querySelector(".bottom-nav")!));
  const enable = container.querySelector(
    '[aria-label="Разрешить редактирование"]',
  ) as HTMLInputElement;
  expect(enable.checked).toBe(true);
  await click(button("Общая лента", container.querySelector(".bottom-nav")!));
  await click(container.querySelector(".current-block .work-patient-toggle")!);
  await click(container.querySelector(".current-block .work-item")!);
  await click(button("Отметить выполнение"));
  await click(button("✓ Выполнено"));
  await textInput(
    container.querySelector("textarea")!,
    "Демо-значение 🐈\nСтрока 2",
  );
  await click(button("Сохранить"));
  expect(container.textContent).toContain("Статус сохранён");
  expect(container.querySelector(".result-editor")).toBeNull();
  await click(button("История отметок"));
  await click(button("08:00", container.querySelector(".work-history")!));
  await click(container.querySelector(".work-history .work-patient-toggle")!);
  const row = [...container.querySelectorAll(".work-item")].find((r) =>
    r.textContent?.includes("Демо-значение"),
  );
  expect(row).toBeTruthy();
  await click(row!);
  await click(button("Изменить отметку"));
  expect(container.querySelector("textarea")!.value).toBe(
    "Демо-значение 🐈\nСтрока 2",
  );
  await click(button("Удалить ошибочную"));
  await click(button("Подтвердить удаление"));
  expect(container.textContent).toContain("Статус сохранён");
  expect(fetch).not.toHaveBeenCalled();
});

it("new result starts without a fabricated color; enabling paint requires explicit selection", async () => {
  const f = setup();
  await render(f);
  const paint = container.querySelector(
    '[aria-label="Подкрашивать"]',
  ) as HTMLInputElement;
  expect(paint.checked).toBe(false);
  expect(container.querySelector(".result-palette")).toBeNull();
  await click(paint);
  expect(button("Сохранить").disabled).toBe(true);
  expect(container.querySelectorAll(".palette-swatch")).toHaveLength(7);
  await click(container.querySelector('[aria-label="Голубой"]')!);
  await click(button("Сохранить"));
  expect(f.save.mock.calls[0][1]).toMatchObject({
    colorChange: { kind: "set", value: "lightblue" },
  });
});
it("existing result color is preselected and untouched status/text editing keeps it", async () => {
  const f = setup(true);
  await render(f);
  expect(
    (container.querySelector('[aria-label="Подкрашивать"]') as HTMLInputElement)
      .checked,
  ).toBe(true);
  expect(
    container
      .querySelector('[aria-label="Фиолетовый"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  await textInput(container.querySelector("textarea")!, "Изменён комментарий");
  await click(button("Сохранить"));
  expect(f.save.mock.calls[0][1]).not.toHaveProperty("colorChange");
});
it("switching status does not reset a deliberately selected result color", async () => {
  const f = setup(true);
  await render(f);
  await click(container.querySelector('[aria-label="Розовый"]')!);
  await click(button("Не выполнено"));
  const reason = container.querySelector(
    '[aria-label="Причина невыполнения"]',
  ) as HTMLSelectElement;
  await act(async () => {
    reason.value = "DEVICE_ABSENT";
    reason.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(button("Сохранить"));
  expect(f.save.mock.calls[0][1]).toMatchObject({
    status: "NOT_EXECUTED",
    reason: "DEVICE_ABSENT",
    colorChange: { kind: "set", value: "pink" },
  });
});
it("turning paint off clears only individual color; toggling off and back on leaves it unchanged", async () => {
  const f = setup(true);
  await render(f);
  const paint = container.querySelector('[aria-label="Подкрашивать"]')!;
  await click(paint);
  await click(paint);
  await click(button("Сохранить"));
  expect(f.save.mock.calls[0][1]).not.toHaveProperty("colorChange");
});
it("explicit paint off sends clear intent without changing the source revision", async () => {
  const f = setup(true);
  const color = f.target.revision.color;
  await render(f);
  await click(container.querySelector('[aria-label="Подкрашивать"]')!);
  await click(button("Сохранить"));
  expect(f.save.mock.calls[0][1].colorChange).toEqual({ kind: "clear" });
  expect(f.target.revision.color).toBe(color);
});
it("manual event can choose a result color without inventing periodicity", async () => {
  const f = setup(false, true);
  await render(f);
  await click(container.querySelector('[aria-label="Подкрашивать"]')!);
  await click(container.querySelector('[aria-label="Оранжевый"]')!);
  await click(button("Сохранить"));
  expect(f.save.mock.calls[0][1].colorChange).toEqual({
    kind: "set",
    value: "orange",
  });
  expect(f.target.revision.periodicity).toBeNull();
});
