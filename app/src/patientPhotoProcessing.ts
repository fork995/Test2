export const PHOTO_UPLOAD_UNAVAILABLE =
  "Сохранение фотографии пока недоступно: Object Storage не разрешает загрузку с GitHub Pages (CORS 403), а текущая сессия не предоставляет разрешённые S3-учётные данные.";

export interface PreparedPatientPhoto {
  blob: Blob;
  width: number;
  height: number;
}

export function containedImageSize(width: number, height: number, limit = 1600) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    limit <= 0
  )
    throw new Error("Некорректный размер изображения.");
  const scale = Math.min(1, limit / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function supportedPatientPhoto(file: Pick<File, "type" | "size">) {
  return (
    file.size > 0 &&
    file.size <= 30 * 1024 * 1024 &&
    ["image/jpeg", "image/png", "image/heic", "image/heif"].includes(
      file.type.toLowerCase(),
    )
  );
}

async function decodeWithImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } catch {
    throw new Error(
      "Safari не смог прочитать изображение. Выберите JPEG или PNG; поддержка HEIC зависит от версии браузера.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function preparePatientPhoto(
  file: File,
  limit = 1600,
  quality = 0.86,
): Promise<PreparedPatientPhoto> {
  if (!supportedPatientPhoto(file))
    throw new Error(
      "Выберите JPEG, PNG, HEIC или HEIF размером не более 30 МБ.",
    );
  const source = await decodeWithImage(file);
  const { width, height } = containedImageSize(
    source.naturalWidth,
    source.naturalHeight,
    limit,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Браузер не поддерживает обработку изображения.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("Не удалось преобразовать изображение в JPEG.")),
      "image/jpeg",
      quality,
    ),
  );
  return { blob, width, height };
}
