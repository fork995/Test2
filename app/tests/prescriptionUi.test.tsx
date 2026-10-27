// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PrescriptionDialog } from "../src/PrescriptionDialog";
import { App } from "../src/App";
import { normalizeChains, normalizePatients } from "../src/model";
import {
  PrescriptionError,
  type PrescriptionService,
} from "../src/prescriptions";
import { prescriptionServer, P_NOW } from "./prescriptionFixtures";
let root: Root, box: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(P_NOW);
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
    vi.fn(() => Promise.reject(Error("Real network forbidden"))),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const button = (text: string, scope: ParentNode = box) => {
  const b = [...scope.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.trim() === text || b.textContent?.trim().endsWith(text),
  );
  if (!b) throw Error("Missing " + text);
  return b;
};
async function click(e: Element) {
  await act(async () => {
    e.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
async function input(label: string, value: string) {
  await act(async () => {
    const e = box.querySelector(`[aria-label="${label}"]`) as
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement;
    if (!e) throw Error("Missing input " + label);
    const prototype =
      e.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : e.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(e, value);
    e.dispatchEvent(
      new Event(e.tagName === "SELECT" ? "change" : "input", { bubbles: true }),
    );
  });
}
function setup() {
  const server = prescriptionServer(),
    patient = normalizePatients([server.rawPatient])[0],
    chain = normalizeChains(server.data)[0],
    saved = vi.fn(),
    snapshot = vi.fn(),
    close = vi.fn(),
    create = vi.fn(async () => ({ patient, chains: [chain] })),
    revise = vi.fn(async () => ({ patient, chains: [chain] })),
    finish = vi.fn(async () => ({ patient, chains: [chain] })),
    deleteChain = vi.fn(async () => ({ patient, chains: [] })),
    deleteRevision = vi.fn(async () => ({ patient, chains: [chain] }));
  const service = {
    create,
    revise,
    finish,
    deleteChain,
    deleteRevision,
    setEnabled: vi.fn(),
    close: vi.fn(),
  } as PrescriptionService;
  return {
    server,
    patient,
    chain,
    saved,
    snapshot,
    close,
    create,
    revise,
    finish,
    deleteChain,
    deleteRevision,
    service,
  };
}
async function render(
  f: ReturnType<typeof setup>,
  action:
    | "create"
    | "revise"
    | "finish"
    | "deleteChain"
    | "deleteRevision" = "create",
) {
  await act(async () =>
    root.render(
      <PrescriptionDialog
        patient={f.patient}
        chain={action === "create" ? undefined : f.chain}
        action={action}
        zone="Europe/Moscow"
        service={f.service}
        onClose={f.close}
        onSaved={f.saved}
        onSnapshot={f.snapshot}
        onExpire={() => {}}
      />,
    ),
  );
}
it("NURSING form omits all medication fields and sends only its confirmed structure", async () => {
  const f = setup();
  await render(f);
  await input("Тип назначения", "NURSING");
  await input("Название назначения", "ДЕМО · Кормление");
  await input("Расписание", "periodic");
  await input("Интервал, часов", "8");
  await input("Комментарий / инструкция", "Демо\n✓");
  expect(box.querySelector('[aria-label="Концентрация"]')).toBeNull();
  await click(button("Создать назначение"));
  expect(f.create).toHaveBeenCalledOnce();
  const d = (f.create.mock.calls as any)[0][1];
  expect(d.type).toBe("NURSING");
  expect(d.specifics).toBeUndefined();
  expect(d.periodicity).toBe(8);
  expect(d.start).toBe("2026-10-19T12:00:00.000Z");
});
it("medication form uses shared calculation and sends raw dose, units and route rather than computed volume", async () => {
  const f = setup();
  await render(f);
  await input("Название назначения", "ДЕМО · Препарат");
  await input("Концентрация", "10");
  await input("Единицы концентрации", "MILLIGRAM");
  await input("На единицу препарата", "MILLILITRE");
  await input("Дозировка", "1");
  await input("Единицы дозировки", "MILLIGRAM");
  await input("На единицу массы / животное", "KILOGRAM");
  await input("Путь введения", "INTRAVENOUS");
  await input("Расписание", "once");
  expect(box.textContent).toContain("0,4 мл");
  await click(button("Создать назначение"));
  const d = (f.create.mock.calls as any)[0][1];
  expect(d.specifics.dosage.value).toBe(1);
  expect(d.specifics.weightKg).toBe(4);
  expect(d.specifics.concentration.value).toBe(10);
  expect(d.periodicity).toBe(0);
});
it("edit requires confirmation, preserves unknown preparation fields, does not rename chain", async () => {
  const f = setup();
  f.chain.elements[0].specifics.solvent = { volume: 5 };
  await render(f, "revise");
  await input("Концентрация", "50");
  await click(button("Продолжить"));
  expect(f.revise).not.toHaveBeenCalled();
  expect(box.textContent).toContain("История отметок сохранится");
  await click(button("Подтвердить"));
  expect(f.revise).toHaveBeenCalledOnce();
  const d = (f.revise.mock.calls as any)[0][2];
  expect(d.name).toBe(f.chain.name);
  expect(d.specifics.solvent).toEqual({ volume: 5 });
  expect(d.specifics.dosage).toEqual(f.chain.elements[0].specifics.dosage);
});
it("delete confirmation can be cancelled with zero requests", async () => {
  const f = setup();
  await render(f, "deleteChain");
  await click(button("Продолжить"));
  expect(f.deleteChain).not.toHaveBeenCalled();
  await click(button("Отмена"));
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.deleteChain).not.toHaveBeenCalled();
});
it("history blocks whole-chain deletion before confirmation", async () => {
  const f = setup();
  f.chain.elements[0].results = [
    {
      id: "done",
      status: "EXECUTED",
      reason: "",
      comment: "",
      color: "",
      created: new Date(P_NOW).toISOString(),
      hour: new Date(P_NOW).toISOString(),
      at: P_NOW,
    },
  ];
  await render(f, "deleteChain");
  expect(button("Продолжить").disabled).toBe(true);
  expect(f.deleteChain).not.toHaveBeenCalled();
});
it("partial error adopts read-back snapshot, stays open, blocks blind retry", async () => {
  const f = setup(),
    stopped = structuredClone(f.chain);
  stopped.elements[0].end = P_NOW;
  f.revise.mockRejectedValueOnce(new PrescriptionError("Partial", [stopped]));
  await render(f, "revise");
  await click(button("Продолжить"));
  await click(button("Подтвердить"));
  expect(f.saved).not.toHaveBeenCalled();
  expect(f.snapshot).toHaveBeenCalledWith([stopped]);
  expect(box.querySelector('[role="alert"]')?.textContent).toContain(
    "Предыдущая редакция завершена",
  );
  expect(button("Подтвердить").disabled).toBe(true);
});
it("App: create procedure, verify GET, refresh grid and delete chain with separate confirmation", async () => {
  const server = prescriptionServer();
  vi.stubGlobal("fetch", server.fetcher);
  await act(async () => root.render(<App />));
  (box.querySelector("#jwt") as HTMLInputElement).value = "SYNTHETIC_NOT_A_JWT";
  await act(async () => {
    box
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await click(button("Пациенты", box.querySelector(".bottom-nav")!));
  await click(box.querySelector(".patient-card")!);
  await click(button("+ Назначение"));
  await input("Тип назначения", "NURSING");
  await input("Название назначения", "ДЕМО · Новая процедура");
  await input("Расписание", "once");
  await click(button("Создать назначение"));
  expect(server.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  expect(server.calls.at(-1)?.method).toBe("GET");
  expect(box.querySelector(".prescription-dialog")).toBeNull();
  await click(button("Сетка"));
  const row = [...box.querySelectorAll(".grid-row")].find((e) =>
    e.textContent?.includes("ДЕМО · Новая процедура"),
  )!;
  expect(row).toBeTruthy();
  await click(row.querySelector(".name-cell")!);
  const actions = box.querySelector(".prescription-actions")!;
  expect(actions).toBeTruthy();
  await click(button("Удалить назначение", actions));
  await click(button("Продолжить"));
  expect(server.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  await click(button("Подтвердить"));
  expect(server.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  expect(server.calls.at(-1)?.method).toBe("GET");
  expect(
    [...box.querySelectorAll(".grid-row")].some((e) =>
      e.textContent?.includes("ДЕМО · Новая процедура"),
    ),
  ).toBe(false);
});
