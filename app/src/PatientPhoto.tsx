import { useState } from "react";
import type { Patient } from "./model";

/** Confirmed patient.photo URL, never an attachment ID or a token-bearing URL. */
export function patientPhotoUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "storage.yandexcloud.net" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/clevervet-patient-photos\/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(
        url.pathname,
      )
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function PatientPhoto({
  patient,
  large = false,
  demo = false,
  onEdit,
}: {
  patient: Patient;
  large?: boolean;
  demo?: boolean;
  onEdit?: () => void;
}) {
  // The bundled demo illustration is synthetic. Real URLs remain only in session memory/DOM.
  const src =
    demo && patient.photo === "demo-illustration"
      ? new URL("./demo-patient.svg", import.meta.url).href
      : patientPhotoUrl(patient.photo);
  const photo = (
    <Photo key={src ?? "letter"} src={src} name={patient.name} large={large} />
  );
  return onEdit ? (
    <button
      type="button"
      className="patient-photo-action"
      aria-label={src ? "Заменить фото" : "Добавить фото"}
      onClick={onEdit}
    >
      {photo}
      <span className="patient-photo-edit" aria-hidden="true">
        ✎
      </span>
    </button>
  ) : (
    photo
  );
}
function Photo({
  src,
  name,
  large,
}: {
  src: string | null;
  name: string;
  large: boolean;
}) {
  const [failed, setFailed] = useState(false),
    [loaded, setLoaded] = useState(false);
  return (
    <span
      className={`avatar patient-photo${large ? " patient-photo-large" : ""}`}
      aria-hidden="true"
    >
      <span>{name.slice(0, 1)}</span>
      {src && !failed && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className={loaded ? "loaded" : ""}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
