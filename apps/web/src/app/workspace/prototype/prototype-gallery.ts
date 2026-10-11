import type {
  PrototypeGeneratedImage,
  PrototypeScreenOrigin,
  PrototypeTargetDevice,
  PrototypeVisualDevice,
} from "@levantamiento-rq/shared-contracts";

export const PROTOTYPE_GENERATION_STORAGE_KEY =
  "rq-prototype-current-generation-v1";

export function galleryDevices(
  target: PrototypeTargetDevice,
): PrototypeVisualDevice[] {
  return target === "RESPONSIVE" ? ["WEB", "MOBILE"] : [target];
}

export function orderPrototypeImages(
  images: readonly PrototypeGeneratedImage[],
): PrototypeGeneratedImage[] {
  return [...images].sort(
    (left, right) =>
      left.screenOrder - right.screenOrder ||
      left.device.localeCompare(right.device),
  );
}

export function selectedImageForDevice(
  images: readonly PrototypeGeneratedImage[],
  device: PrototypeVisualDevice,
  screenId: string | null,
): PrototypeGeneratedImage | null {
  const available = orderPrototypeImages(
    images.filter((image) => image.device === device),
  );
  return (
    available.find((image) => image.screenId === screenId) ??
    available[0] ??
    null
  );
}

export function adjacentScreenIndex(
  current: number,
  total: number,
  direction: -1 | 1,
): number {
  if (total < 1) return 0;
  return Math.max(0, Math.min(total - 1, current + direction));
}

export function prototypeOriginLabel(origin: PrototypeScreenOrigin): string {
  return origin === "EXPLICIT"
    ? "Definida en el requerimiento"
    : "Derivada del flujo";
}

export function prototypeImageFileName(image: PrototypeGeneratedImage): string {
  const safe =
    image.screenCode
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "pantalla";
  return `${String(image.screenOrder).padStart(2, "0")}-${safe}-${image.device.toLowerCase()}.png`;
}

/** Nombre del ZIP con todas las imágenes del prototipo (web y móvil). */
export function prototypeImagesZipName(applicationName: string | null): string {
  const base = (applicationName ?? "prototipo")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/[^a-zA-Z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
  return `imagenes-${base || "prototipo"}.zip`;
}

/** Carpeta del ZIP según el formato de la imagen. */
export function prototypeImageZipFolder(
  image: PrototypeGeneratedImage,
): string {
  return image.device === "MOBILE" ? "movil" : "web";
}
