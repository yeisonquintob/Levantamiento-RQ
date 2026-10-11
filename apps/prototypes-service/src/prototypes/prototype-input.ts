import { BadRequestException } from "@nestjs/common";
import type {
  PrototypeGenerationCreateRequest,
  PrototypeTargetDevice,
} from "@levantamiento-rq/shared-contracts";

export const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;
const DEVICES: readonly PrototypeTargetDevice[] = [
  "RESPONSIVE",
  "WEB",
  "MOBILE",
];
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePrototypeGenerationCreate(
  value: unknown,
): PrototypeGenerationCreateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BadRequestException("La solicitud de prototipo no es válida.");
  const input = value as Record<string, unknown>;
  const sourceFileName =
    typeof input.sourceFileName === "string" ? input.sourceFileName.trim() : "";
  const markdown =
    typeof input.markdown === "string"
      ? input.markdown.replace(/\r\n?/g, "\n")
      : "";
  const projectId =
    input.projectId === undefined ||
    input.projectId === null ||
    input.projectId === ""
      ? undefined
      : input.projectId;
  if (
    !sourceFileName ||
    sourceFileName.length > 260 ||
    !/\.(md|markdown)$/i.test(sourceFileName)
  )
    throw new BadRequestException("Selecciona un archivo Markdown válido.");
  if (!markdown.trim())
    throw new BadRequestException("El archivo Markdown está vacío.");
  if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES)
    throw new BadRequestException(
      "El archivo Markdown supera el tamaño permitido.",
    );
  if (markdown.includes("\u0000"))
    throw new BadRequestException("El contenido Markdown no se puede leer.");
  if (!DEVICES.includes(input.targetDevice as PrototypeTargetDevice))
    throw new BadRequestException("El formato de prototipo no es válido.");
  if (
    projectId !== undefined &&
    (typeof projectId !== "string" || !UUID.test(projectId))
  )
    throw new BadRequestException("El proyecto no es válido.");
  return {
    sourceFileName,
    ...(input.plannerConfigurationId !== undefined
      ? {
          plannerConfigurationId: parseGenerationId(
            String(input.plannerConfigurationId),
          ),
        }
      : {}),
    ...(input.imageConfigurationId !== undefined
      ? {
          imageConfigurationId: parseGenerationId(
            String(input.imageConfigurationId),
          ),
        }
      : {}),
    markdown,
    targetDevice: input.targetDevice as PrototypeTargetDevice,
    ...(projectId ? { projectId } : {}),
  };
}

export function parseGenerationId(value: string): string {
  if (!UUID.test(value))
    throw new BadRequestException("La generación no es válida.");
  return value;
}

export function parsePrototypeScreenSelection(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BadRequestException(
      "Selecciona las pantallas que deseas generar.",
    );
  const screenCodes = (value as Record<string, unknown>).screenCodes;
  if (!Array.isArray(screenCodes) || screenCodes.length === 0)
    throw new BadRequestException("Selecciona al menos una pantalla.");
  const normalized = screenCodes.map((code) =>
    typeof code === "string" ? code.trim() : "",
  );
  if (normalized.some((code) => !code || code.length > 120))
    throw new BadRequestException("La selección de pantallas no es válida.");
  return [...new Set(normalized)];
}
