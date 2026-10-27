import { useEffect, useRef, useState } from "react";
import type { Patient } from "./model";
import {
  PHOTO_UPLOAD_UNAVAILABLE,
  preparePatientPhoto,
  type PreparedPatientPhoto,
} from "./patientPhotoProcessing";

type Processor = (file: File) => Promise<PreparedPatientPhoto>;

export function PatientPhotoDialog({
  patient,
  onClose,
  processor = preparePatientPhoto,
}: {
  patient: Patient;
  onClose: () => void;
  processor?: Processor;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const previewRef = useRef<string | null>(null);
  const sequence = useRef(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedPatientPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasPhoto = !!patient.photo;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      sequence.current++;
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      dialog.current?.close();
      previous?.focus();
    };
  }, []);

  async function choose(file?: File) {
    if (!file) return;
    const current = ++sequence.current;
    setBusy(true);
    setError("");
    setPrepared(null);
    try {
      const next = await processor(file);
      if (current !== sequence.current) return;
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      const url = URL.createObjectURL(next.blob);
      previewRef.current = url;
      setPreview(url);
      setPrepared(next);
    } catch (cause) {
      if (current !== sequence.current) return;
      setPreview(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось подготовить фотографию.",
      );
    } finally {
      if (current === sequence.current) setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="bottom-sheet patient-photo-dialog"
      aria-labelledby="patient-photo-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="sheet-handle" />
      <header className="sheet-header">
        <div>
          <p className="eyebrow">{patient.name}</p>
          <h2 id="patient-photo-title">
            {hasPhoto ? "Заменить фото" : "Добавить фото"}
          </h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть выбор фотографии"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {preview ? (
        <img className="patient-photo-preview" src={preview} alt="Предпросмотр" />
      ) : (
        <div className="patient-photo-preview empty" aria-hidden="true">
          {patient.name.slice(0, 1)}
        </div>
      )}

      <label className="secondary full patient-photo-picker">
        {busy ? "Подготовка изображения…" : "Выбрать изображение"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif"
          disabled={busy}
          onChange={(event) => void choose(event.target.files?.[0])}
        />
      </label>
      {prepared && (
        <p className="micro" role="status">
          JPEG · {prepared.width} × {prepared.height} · готов к предварительному
          просмотру
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="sheet-actions">
        <button type="button" className="quiet" disabled={busy} onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !prepared}
          onClick={() => setError(PHOTO_UPLOAD_UNAVAILABLE)}
        >
          Сохранить
        </button>
      </div>
    </dialog>
  );
}
