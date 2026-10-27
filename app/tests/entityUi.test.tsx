// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BelongingsPanel } from "../src/BelongingsPanel";
import { PatientEntityDialog } from "../src/PatientEntityDialog";
import type { EntityService } from "../src/entities";
import { normalizePatients } from "../src/model";
let root: Root, box: HTMLDivElement;
const patient = normalizePatients([
  {
    id: "patient",
    name: "Учебный пациент",
    card: { id: "card", status: "ACTIVE" },
  },
])[0];
const branch = {
  id: "b",
  name: "Учебный филиал",
  workShiftStart: "8",
  departments: [{ id: "d", name: "Стационар" }],
};
const item = {
  id: "thing",
  name: "Учебная миска",
  receivingDate: "2026-10-19",
  status: "RECEIVED",
  comment: "Красная",
  creationDate: "2026-10-19T08:00:00Z",
};
function service() {
  return {
    list: vi.fn(async (_patient: string, _signal: AbortSignal) => [item]),
    change: vi.fn(async () => []),
    create: vi.fn(),
    remove: vi.fn(async () => []),
    setEnabled: vi.fn(),
    close: vi.fn(),
  } satisfies EntityService;
}
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
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-19T12:00:00Z"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.restoreAllMocks();
});
const click = async (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
const button = (text: string) => {
  const b = [...box.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  if (!b) throw Error("Missing " + text);
  return b;
};
async function type(label: string, value: string) {
  const el = box.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function openThings(s: EntityService, key = "patient") {
  await act(async () =>
    root.render(
      <BelongingsPanel
        key={key}
        patientId={key}
        service={s}
        enabled
        zone="Europe/Moscow"
        onExpire={() => {}}
      />,
    ),
  );
  await act(async () => {
    const d = box.querySelector("details")!;
    d.open = true;
    d.dispatchEvent(new Event("toggle"));
  });
}
it("delete belonging requires confirmation; cancellation sends nothing", async () => {
  const s = service();
  await openThings(s);
  await click(button("Удалить"));
  expect(box.textContent).toContain("Удалить вещь „Учебная миска“?");
  expect(s.change).not.toHaveBeenCalled();
  await click(button("Отмена"));
  expect(s.change).not.toHaveBeenCalled();
  await click(button("Удалить"));
  await click(button("Подтвердить действие"));
  expect(s.change).toHaveBeenCalledWith(
    "patient",
    { kind: "delete", before: item },
    expect.any(AbortSignal),
  );
});
it("double click confirms only one mutation", async () => {
  const s = service();
  let resolve!: (v: any) => void;
  s.change.mockImplementation(() => new Promise((r) => (resolve = r)));
  await openThings(s);
  await click(button("Удалить"));
  const b = button("Подтвердить действие");
  await act(async () => {
    b.click();
    b.click();
  });
  expect(s.change).toHaveBeenCalledTimes(1);
  await act(async () => resolve([]));
});
it("switching patient aborts old fetch and ignores delayed old data", async () => {
  const s = service();
  let resolve!: (v: any) => void;
  s.list.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  await openThings(s, "old");
  const old = s.list.mock.calls[0][1];
  await openThings(s, "new");
  expect(old.aborted).toBe(true);
  await act(async () => resolve([{ ...item, name: "OLD MUST NOT APPEAR" }]));
  expect(box.textContent).not.toContain("OLD MUST NOT APPEAR");
  expect(s.list.mock.calls[1][0]).toBe("new");
});
it("creation form has all requested fields and no invented medical defaults", async () => {
  const s = service();
  await act(async () =>
    root.render(
      <PatientEntityDialog
        service={s}
        branch={branch}
        location={{ branchId: "b", departmentId: "d" }}
        zone="Europe/Moscow"
        onClose={() => {}}
        onCreated={() => {}}
        onRemoved={() => {}}
        onExpire={() => {}}
      />,
    ),
  );
  for (const label of [
    "Кличка",
    "Вид животного",
    "Порода",
    "Масса, кг",
    "Возраст: годы",
    "Возраст: месяцы",
    "Возраст: дни",
    "Фамилия владельца",
    "Имя владельца",
    "Отчество владельца",
    "Email владельца",
    "Диагнозы",
    "Аллергии",
    "Дата начала лечения",
    "Время начала лечения",
  ])
    expect(box.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
  for (const sel of box.querySelectorAll("select")) expect(sel.value).toBe("");
  expect(s.create).not.toHaveBeenCalled();
});
it("patient deletion requires two stages and exact typed name", async () => {
  const s = service(),
    removed = vi.fn(),
    close = vi.fn();
  await act(async () =>
    root.render(
      <PatientEntityDialog
        service={s}
        patient={patient}
        branch={branch}
        location={{ branchId: "b", departmentId: "d" }}
        zone="Europe/Moscow"
        onClose={close}
        onCreated={() => {}}
        onRemoved={removed}
        onExpire={() => {}}
      />,
    ),
  );
  await click(button("Продолжить удаление"));
  expect(s.remove).not.toHaveBeenCalled();
  expect(button("Удалить пациента навсегда").disabled).toBe(true);
  await type("Кличка для удаления", "wrong");
  expect(button("Удалить пациента навсегда").disabled).toBe(true);
  await type("Кличка для удаления", patient.name);
  await click(button("Удалить пациента навсегда"));
  expect(s.remove).toHaveBeenCalledWith(patient, patient.name);
  expect(removed).toHaveBeenCalledWith([]);
});
it("cancel patient deletion never sends request", async () => {
  const s = service(),
    close = vi.fn();
  await act(async () =>
    root.render(
      <PatientEntityDialog
        service={s}
        patient={patient}
        branch={branch}
        location={{ branchId: "b", departmentId: "d" }}
        zone="Europe/Moscow"
        onClose={close}
        onCreated={() => {}}
        onRemoved={() => {}}
        onExpire={() => {}}
      />,
    ),
  );
  await click(button("Продолжить удаление"));
  await click(button("Отмена"));
  expect(close).toHaveBeenCalledOnce();
  expect(s.remove).not.toHaveBeenCalled();
});
it("patient delete error keeps original patient and does not report success", async () => {
  const s = service(),
    removed = vi.fn();
  s.remove.mockRejectedValue(new Error("PRIVATE"));
  await act(async () =>
    root.render(
      <PatientEntityDialog
        service={s}
        patient={patient}
        branch={branch}
        location={{ branchId: "b", departmentId: "d" }}
        zone="Europe/Moscow"
        onClose={() => {}}
        onCreated={() => {}}
        onRemoved={removed}
        onExpire={() => {}}
      />,
    ),
  );
  await click(button("Продолжить удаление"));
  await type("Кличка для удаления", patient.name);
  await click(button("Удалить пациента навсегда"));
  expect(removed).not.toHaveBeenCalled();
  expect(box.querySelector("[role=alert]")).not.toBeNull();
  expect(box.textContent).not.toContain("PRIVATE");
  expect(patient.id).toBe("patient");
});
