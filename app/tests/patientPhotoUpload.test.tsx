// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PatientPhotoDialog } from "../src/PatientPhotoDialog";
import { PatientPhoto } from "../src/PatientPhoto";
import {
  containedImageSize,
  preparePatientPhoto,
  supportedPatientPhoto,
} from "../src/patientPhotoProcessing";
import type { Patient } from "../src/model";

const patient: Patient = {
  id: "synthetic-patient",
  name: "Демо пациент",
  species: "Кошка",
  breed: "",
  gender: "",
  weight: "4",
  severity: "MODERATE",
  cage: "",
  diagnoses: "",
  cardId: "synthetic-card",
  cardStatus: "ACTIVE",
  hospital: "ROUND_THE_CLOCK",
  sheets: [],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(Error("Network forbidden"))));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function click(name: string) {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === name,
  );
  if (!button) throw Error(`Missing button ${name}`);
  await act(async () => button.click());
}

it("calculates a bounded JPEG size without stretching", () => {
  expect(containedImageSize(4000, 2000)).toEqual({ width: 1600, height: 800 });
  expect(containedImageSize(800, 1200)).toEqual({ width: 800, height: 1200 });
  expect(() => containedImageSize(0, 20)).toThrow();
});

it("accepts confirmed browser image formats and rejects unsafe input", () => {
  for (const type of ["image/jpeg", "image/png", "image/heic", "image/heif"])
    expect(supportedPatientPhoto({ type, size: 100 })).toBe(true);
  expect(supportedPatientPhoto({ type: "image/svg+xml", size: 100 })).toBe(false);
  expect(supportedPatientPhoto({ type: "image/jpeg", size: 0 })).toBe(false);
  expect(
    supportedPatientPhoto({ type: "image/jpeg", size: 31 * 1024 * 1024 }),
  ).toBe(false);
});

it("decodes, scales and emits JPEG entirely in browser memory", async () => {
  const revoke = vi.fn();
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:source"),
    revokeObjectURL: revoke,
  });
  vi.stubGlobal(
    "Image",
    class {
      decoding = "";
      src = "";
      naturalWidth = 4000;
      naturalHeight = 2000;
      decode = vi.fn(async () => {});
    },
  );
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback, type) => callback(new Blob(["jpeg"], { type })),
  );
  const result = await preparePatientPhoto(
    new File(["png"], "photo.png", { type: "image/png" }),
  );
  expect(result).toMatchObject({ width: 1600, height: 800 });
  expect(result.blob.type).toBe("image/jpeg");
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800);
  expect(revoke).toHaveBeenCalledWith("blob:source");
});

it("previews a selected file but blocks save before any network write", async () => {
  const close = vi.fn();
  const prepared = {
    blob: new Blob(["jpeg"], { type: "image/jpeg" }),
    width: 1200,
    height: 800,
  };
  const processor = vi.fn(async () => prepared);
  const createObjectURL = vi.fn(() => "blob:preview");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  await act(async () =>
    root.render(
      <PatientPhotoDialog
        patient={patient}
        onClose={close}
        processor={processor}
      />,
    ),
  );
  expect(container.textContent).toContain("Добавить фото");
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(["png"], "photo.png", { type: "image/png" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(processor).toHaveBeenCalledWith(file);
  expect(container.querySelector<HTMLImageElement>(".patient-photo-preview")?.src).toBe(
    "blob:preview",
  );
  expect(container.textContent).toContain("JPEG · 1200 × 800");
  await click("Сохранить");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "CORS 403",
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it("labels replacement and cancellation without changing the patient", async () => {
  const close = vi.fn();
  const replacement = {
    ...patient,
    photo:
      "https://storage.yandexcloud.net/clevervet-patient-photos/existing.jpg",
  };
  const before = structuredClone(replacement);
  await act(async () =>
    root.render(
      <PatientPhotoDialog patient={replacement} onClose={close} />,
    ),
  );
  expect(container.textContent).toContain("Заменить фото");
  await click("Отмена");
  expect(close).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
  expect(replacement).toEqual(before);
});

it("makes only an explicitly editable card photo actionable", async () => {
  const edit = vi.fn();
  await act(async () =>
    root.render(<PatientPhoto patient={patient} large onEdit={edit} />),
  );
  const action = container.querySelector<HTMLButtonElement>(
    '[aria-label="Добавить фото"]',
  );
  expect(action).not.toBeNull();
  await act(async () => action!.click());
  expect(edit).toHaveBeenCalledOnce();
});
