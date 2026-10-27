// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Details } from "../src/Details";
import { ResultEditor } from "../src/ResultEditor";
import { normalizeChains, normalizePatients, indexChains } from "../src/model";
import type {
  ResultWriter,
  ResultTarget,
  ResultInput,
} from "../src/resultWriter";
const H = 3600000,
  at = Date.parse("2026-10-19T17:00:00Z"),
  iso = (n: number) => new Date(n).toISOString();
let box: HTMLDivElement, root: Root;
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
    vi.fn(() => Promise.reject(Error("No real requests"))),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.unstubAllGlobals();
});
function fixture(p: unknown = 0, start: string | null = iso(at)) {
  const chain = normalizeChains([
    {
      id: "chain",
      name: "Демо · Измерение",
      type: "MONITORING",
      elements: [
        {
          id: "revision",
          color: "yellow",
          dates: start ? { start, periodicity: p } : undefined,
          results: [],
        },
      ],
    },
  ])[0];
  const patient = normalizePatients([
    {
      id: "patient",
      name: "Демо",
      card: {
        id: "card",
        status: "ACTIVE",
        treatment: {
          sheets: [
            {
              id: "sheet",
              start: iso(at - H),
              end: iso(at + 23 * H),
              locked: false,
            },
          ],
        },
      },
    },
  ])[0];
  return { chain, patient };
}
for (const p of [0, 3])
  it(`periodicity ${p}: off-schedule cell opens manual editor, scheduled cell keeps usual editor`, async () => {
    const { chain, patient } = fixture(p),
      onEdit = vi.fn();
    await act(async () =>
      root.render(
        <Details
          selection={{
            index: indexChains([chain])[0],
            patient,
            at: at + H,
            entries: [],
          }}
          zone="Europe/Moscow"
          onClose={() => {}}
          onEdit={onEdit}
        />,
      ),
    );
    const button = [...box.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Добавить событие по необходимости"),
    )!;
    expect(button).toBeTruthy();
    expect(box.textContent).toContain("Назначение");
    await act(async () => button.click());
    expect(onEdit).toHaveBeenCalledWith(chain.elements[0], at + H);
    await act(async () =>
      root.render(
        <Details
          selection={{
            index: indexChains([chain])[0],
            patient,
            at,
            entries: [],
          }}
          zone="Europe/Moscow"
          onClose={() => {}}
          onEdit={onEdit}
        />,
      ),
    );
    expect(box.textContent).toContain("Отметить выполнение");
    expect(box.textContent).not.toContain("Добавить событие по необходимости");
  });
it("GET-like new server snapshot activates draft without page reload, missing or ended start stays unavailable", async () => {
  const old = fixture(0, null);
  const render = async (chain = old.chain) =>
    act(async () =>
      root.render(
        <Details
          selection={{
            index: indexChains([chain])[0],
            patient: old.patient,
            at: at + H,
            entries: [],
          }}
          zone="UTC"
          onClose={() => {}}
          onEdit={() => {}}
        />,
      ),
    );
  await render();
  expect(box.textContent).not.toContain("Добавить событие");
  const next = fixture().chain;
  await render(next);
  expect(box.textContent).toContain("Добавить событие по необходимости");
  const ended = structuredClone(next);
  ended.elements[0].end = at + H;
  ended.elements[0].rawEnd = iso(at + H);
  ended.elements[0].endSource = "endDate";
  await render(ended);
  expect(box.textContent).not.toContain("Добавить событие");
});
it("existing manual off-schedule event offers edit and suppresses add", async () => {
  const { chain, patient } = fixture(3),
    revision = chain.elements[0];
  revision.results = [
    {
      id: "manual",
      idConfirmed: true,
      at: at + H,
      hour: iso(at + H),
      status: "EXECUTED",
      comment: "Учебный текст",
      reason: "",
      color: "violet",
      created: iso(at + H),
    },
  ];
  const index = indexChains([chain])[0],
    onEdit = vi.fn();
  await act(async () =>
    root.render(
      <Details
        selection={{ index, patient, at: at + H, entries: index.entries }}
        zone="UTC"
        onClose={() => {}}
        onEdit={onEdit}
      />,
    ),
  );
  const edit = [...box.querySelectorAll("button")].find(
    (b) => b.textContent === "Изменить отметку",
  )!;
  expect(edit.disabled).toBe(false);
  expect(box.textContent).not.toContain("Добавить событие по необходимости");
  await act(async () => edit.click());
  expect(onEdit).toHaveBeenCalledWith(revision, at + H, revision.results[0]);
});
it("off-schedule editor labels unmarked as absence, sends exact selected column hour", async () => {
  const { chain, patient } = fixture(3),
    save = vi.fn(async (_target: ResultTarget, _input: ResultInput) => ({
      chains: [chain],
      patient,
    }));
  const writer = {
    save,
    remove: vi.fn(),
    setEnabled: vi.fn(),
    isEnabled: () => true,
    close: vi.fn(),
  } as unknown as ResultWriter;
  await act(async () =>
    root.render(
      <ResultEditor
        initial={{
          chain,
          chainId: chain.id,
          revision: chain.elements[0],
          patient,
          at: at + H,
          zone: "Europe/Moscow",
        }}
        chain={chain}
        writer={writer}
        onClose={() => {}}
        onSaved={() => {}}
        onRefresh={async () => {}}
        onExpire={() => {}}
      />,
    ),
  );
  expect(box.textContent).toContain("Без отметки");
  expect(box.textContent).not.toContain("Запланировано");
  expect(box.querySelector('input[type="time"]')).toBeNull();
  const button = (s: string) =>
    [...box.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === s,
    )!;
  await act(async () => button("✓ Выполнено").click());
  await act(async () =>
    box
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0].at).toBe(at + H);
});
