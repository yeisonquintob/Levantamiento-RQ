import type { PrototypeTargetDevice } from "@levantamiento-rq/shared-contracts";
export const MAX_PROTOTYPE_MARKDOWN_BYTES = 5 * 1024 * 1024;
export const PROTOTYPE_FILE_ACCEPT = ".md,.markdown,text/markdown,text/plain";
export function isAllowedMarkdownFile(
  file: Pick<File, "name" | "type">,
): boolean {
  return (
    /\.(md|markdown)$/i.test(file.name) &&
    (!file.type || file.type === "text/markdown" || file.type === "text/plain")
  );
}
export async function readPrototypeMarkdown(file: File): Promise<{
  fileName: string;
  markdownContent: string;
  markdownSizeBytes: number;
}> {
  if (!isAllowedMarkdownFile(file))
    throw new Error("Selecciona un archivo .md o .markdown válido.");
  if (file.size > MAX_PROTOTYPE_MARKDOWN_BYTES)
    throw new Error("El archivo Markdown supera el tamaño permitido de 5 MB.");
  let markdownContent: string;
  try {
    markdownContent = (await file.text()).replace(/\r\n?/g, "\n");
  } catch {
    throw new Error("No fue posible leer el archivo Markdown.");
  }
  if (!markdownContent.trim())
    throw new Error("El archivo Markdown está vacío.");
  if (markdownContent.includes("\u0000"))
    throw new Error("El contenido Markdown no se puede leer.");
  return {
    fileName: file.name,
    markdownContent,
    markdownSizeBytes: new TextEncoder().encode(markdownContent).byteLength,
  };
}
export function targetDeviceLabel(device: PrototypeTargetDevice): string {
  return device === "RESPONSIVE"
    ? "Web + móvil"
    : device === "WEB"
      ? "Solo web"
      : "Solo móvil";
}
