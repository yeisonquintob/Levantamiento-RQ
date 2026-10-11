import {
  businessText,
  exportNumber,
  jsonRecord,
  recordText,
  shortDate,
  versionSection,
} from "./export-document.text";
import {
  type ExportContentLine,
  type ExportDocumentSection,
  type ExportTreeNodeKind,
  type RenderApprovedDocumentInput,
} from "./export-document.types";

function ensureSubtitleColon(value: string): string {
  const text = businessText(value).replace(/[.:]\s*$/u, "");
  return `${text}:`;
}

export function numberedSectionLines(
  section: ExportDocumentSection,
): readonly ExportContentLine[] {
  const base = exportNumber(
    section.headingNumber ?? section.displayNumber ?? section.number,
  );
  let subsection = 0;
  let item = 0;

  return section.lines.map((line, index) => {
    const text = businessText(line.text);
    const next = section.lines[index + 1];
    const hasChildren =
      Boolean(next) &&
      ((next?.level ?? 0) > line.level || Boolean(next?.bullet));

    const isSubtitle =
      !line.bullet && line.level === 0 && hasChildren && !/:\s+\S/u.test(text);

    if (isSubtitle) {
      subsection += 1;
      item = 0;
      return {
        ...line,
        text: `${base}.${subsection}. ${ensureSubtitleColon(text)}`,
        bullet: false,
      };
    }

    if (line.bullet && subsection > 0) {
      item += 1;
      return {
        ...line,
        text: `${base}.${subsection}.${item}. ${text}`,
        level: Math.max(1, line.level),
        bullet: false,
      };
    }

    return { ...line, text };
  });
}

export function exportLineHeadingDepth(line: ExportContentLine): number | null {
  if (line.level !== 0 || line.bullet) return null;
  const match = businessText(line.text).match(/^(\d+(?:\.\d+)+)\.\s+\S/u);
  return match?.[1] ? match[1].split(".").length : null;
}

export function exportTreeNodeKind(
  line: ExportContentLine,
): ExportTreeNodeKind | null {
  if (!line.bullet) return null;
  return (
    (line.text.match(/^(EPIC|FEATURE|HU|TAREA)\s+·\s+/u)?.[1] as
      ExportTreeNodeKind | undefined) ?? null
  );
}

export function exportTreeNodeBody(line: ExportContentLine): string {
  return businessText(line.text).replace(
    /^(?:EPIC|FEATURE|HU|TAREA)\s+·\s+/u,
    "",
  );
}

export function corporateMetadata(
  input: RenderApprovedDocumentInput,
): readonly (readonly [string, string])[] {
  const header = jsonRecord(versionSection(input, "header")?.content);
  const headerValue = (key: string, fallback: string): string =>
    recordText(header, key) ?? fallback;
  return [
    ["Título", headerValue("title", input.document.title)],
    ["Código", headerValue("projectCode", input.project.code)],
    ["Versión", headerValue("documentVersion", input.version.version)],
    ["Fecha", headerValue("createdDate", shortDate(input.version.createdAt))],
    [
      "Área solicitante",
      headerValue("requestingArea", input.project.requestingArea),
    ],
    ["Estado", headerValue("status", input.version.status)],
  ];
}
