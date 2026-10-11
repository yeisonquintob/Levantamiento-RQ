import {
  corporateMetadata,
  exportLineHeadingDepth,
  exportTreeNodeKind,
  numberedSectionLines,
} from "./export-document.numbering";
import { buildExportDocumentSections } from "./export-document.sections";
import {
  businessText,
  date,
  documentTemplateDescription,
  exportNumber,
  exportSectionTitle,
  jsonRecord,
  versionSection,
} from "./export-document.text";
import {
  type RenderApprovedDocumentInput,
  type RenderedExportArtifact,
} from "./export-document.types";

const MARKDOWN_SAFE_LINK_SCHEMES = new Set(["https", "http", "mailto", "tel"]);

// Etiquetas HTML sin atributos que se conservan (el resto se neutraliza).
const MARKDOWN_SAFE_HTML_TAG =
  /^<\/?(?:br|b|strong|i|em|u|code|sub|sup|p|ul|ol|li|table|thead|tbody|tr|th|td)\s?\/?>/iu;

function markdownUrlScheme(target: string): string | null {
  // Se decodifican entidades numéricas y se quitan controles/espacios antes de
  // evaluar el esquema, para vencer "java&#9;script:" o "JaVa\nScript:".
  const normalized = target
    .replace(/&#x([0-9a-f]+);?/giu, (_, hex: string) =>
      String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(hex, 16))),
    )
    .replace(/&#(\d+);?/gu, (_, digits: string) =>
      String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(digits, 10))),
    )
    .replace(/&(?:tab|newline|colon);?/giu, (entity) =>
      /colon/iu.test(entity) ? ":" : "",
    )
    .replace(/[\p{Cc}\p{Zs}\u200B-\u200F\u2028\u2029\uFEFF]/gu, "")
    .toLowerCase();
  return /^([a-z][a-z0-9+.-]*):/u.exec(normalized)?.[1] ?? null;
}

function markdownSafeLinkTarget(target: string, image: boolean): boolean {
  const scheme = markdownUrlScheme(target);
  if (scheme === null) return true;
  // Una imagen remota (http/https) se bloquea: filtra datos y rastrea al lector.
  if (image) return false;
  return MARKDOWN_SAFE_LINK_SCHEMES.has(scheme);
}

function sanitizeMarkdownInline(value: string): string {
  return (
    value
      // Imágenes: solo se conservan las locales/relativas; el resto queda como texto.
      .replace(
        /!\[([^\]]*)\]\(\s*<?((?:[^()\s]|\([^()\s]*\))+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gu,
        (match, alt: string, target: string) =>
          markdownSafeLinkTarget(target, true)
            ? match
            : alt.trim()
              ? `[Imagen omitida: ${alt.trim()}]`
              : "[Imagen omitida]",
      )
      // Enlaces: un esquema peligroso (javascript:, data:, vbscript:, file:...)
      // deja solo el texto visible.
      .replace(
        /\[([^\]]*)\]\(\s*<?((?:[^()\s]|\([^()\s]*\))+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gu,
        (match, text: string, target: string) =>
          markdownSafeLinkTarget(target, false) ? match : text,
      )
      // Definiciones de referencia: [id]: javascript:...
      .replace(
        /^(\s{0,3})\[([^\]]+)\]:\s*<?(\S+?)>?(\s+(?:"[^"]*"|'[^']*'))?\s*$/gmu,
        (match, indent: string, id: string, target: string) =>
          markdownSafeLinkTarget(target, false)
            ? match
            : `${indent}[${id}]: (enlace omitido)`,
      )
      // HTML crudo: se escapa todo lo que no sea una etiqueta simple permitida
      // o un autoenlace http/https/mailto (script, iframe, on*=, style, etc.).
      .replace(/<(?=[A-Za-z/!?])/gu, (_, offset: number, source: string) => {
        const rest = source.slice(offset);
        return MARKDOWN_SAFE_HTML_TAG.test(rest) ||
          /^<(?:https?:\/\/|mailto:)[^>\s]+>/iu.test(rest)
          ? "<"
          : "&lt;";
      })
  );
}

// Neutraliza HTML peligroso y enlaces/imágenes con esquemas no permitidos,
// conservando Markdown legítimo. Los fragmentos `código` y los bloques con
// vallas ``` se dejan intactos porque Markdown no los interpreta.
function sanitizeMarkdown(value: string): string {
  let fenced = false;
  return value
    .split("\n")
    .map((line) => {
      if (/^\s{0,3}(?:`{3,}|~{3,})/u.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line
        .split(/(`[^`\n]*`)/u)
        .map((part, index) =>
          index % 2 === 1 ? part : sanitizeMarkdownInline(part),
        )
        .join("");
    })
    .join("\n");
}

function markdownText(value: string): string {
  return sanitizeMarkdown(businessText(value)).replace(
    /\bPendiente\b/giu,
    "<u>Pendiente</u>",
  );
}

function markdownCell(value: string): string {
  return markdownText(value).replaceAll("|", "\\|").replace(/\r?\n/gu, "<br>");
}

export async function renderMarkdown(
  input: RenderApprovedDocumentInput,
): Promise<RenderedExportArtifact> {
  const output: string[] = [
    `# ${markdownText(corporateMetadata(input)[0]?.[1] ?? input.document.title)}`,
    "",
    `> ${markdownText(documentTemplateDescription(input))}`,
    "",
    "## Información del documento",
    "",
    "| Campo | Valor |",
    "| --- | --- |",
    ...corporateMetadata(input).map(
      ([key, value]) => `| ${markdownCell(key)} | ${markdownCell(value)} |`,
    ),
    "",
  ];

  for (const section of buildExportDocumentSections(input)) {
    const sectionHeadingPrefix = section.headingNumber ? "###" : "##";
    const sectionHeadingTitle = exportSectionTitle(section);
    output.push(
      `${sectionHeadingPrefix} ${exportNumber(section.headingNumber ?? section.displayNumber ?? section.number)}. ${markdownText(sectionHeadingTitle)}`,
      "",
    );

    if (section.objectivesLayout) {
      output.push(
        "### 1.1. Objetivo general:",
        "",
        markdownText(section.objectivesLayout.general),
        "",
        "#### 1.1.1. Objetivos específicos:",
        "",
        "| Cualitativos | Cuantitativos |",
        "| --- | --- |",
      );

      const maximumObjectives = Math.max(
        section.objectivesLayout.qualitative.length,
        section.objectivesLayout.quantitative.length,
      );

      for (let index = 0; index < maximumObjectives; index += 1) {
        const qualitative = section.objectivesLayout.qualitative[index] ?? "";
        const quantitative = section.objectivesLayout.quantitative[index] ?? "";

        output.push(
          `| ${qualitative ? `${index + 1}. ${markdownCell(qualitative)}` : ""} | ${quantitative ? `${index + 1}. ${markdownCell(quantitative)}` : ""} |`,
        );
      }

      output.push("");
    } else {
      const lines = numberedSectionLines(section);
      for (const line of lines) {
        const treeNodeKind = exportTreeNodeKind(line);
        const plainValue = markdownText(line.text);
        const value =
          treeNodeKind && treeNodeKind !== "TAREA"
            ? `**${plainValue}**`
            : plainValue;
        if (!value) continue;
        const indent = "  ".repeat(Math.min(line.level, 3));
        const lineHeadingDepth = exportLineHeadingDepth(line);
        const headingPrefix = lineHeadingDepth
          ? "#".repeat(Math.min(6, lineHeadingDepth + 1))
          : null;
        if (headingPrefix) {
          if (output.at(-1) !== "") output.push("");
          output.push(`${headingPrefix} ${value}`, "");
        } else {
          output.push(
            line.bullet ? `${indent}- ${value}` : `${indent}${value}`,
          );
        }
      }
      if (lines.length > 0) output.push("");
    }

    if (section.kpiCards?.length) {
      output.push(
        `### ${exportNumber(section.displayNumber ?? section.number)}.4. KPIs de estado:`,
        "",
        `| ${section.kpiCards.map((card) => markdownCell(card.name)).join(" | ")} |`,
        `| ${section.kpiCards.map(() => "---").join(" | ")} |`,
        `| ${section.kpiCards
          .map(
            (card) =>
              `**Objetivo:** ${markdownCell(card.relatedObjective)}<br>**Medición:** ${markdownCell(card.measurement)}<br>**Meta:** ${markdownCell(card.target)}`,
          )
          .join(" | ")} |`,
        "",
      );
    }

    if (section.flowDiagram) {
      output.push(
        `${section.headingNumber ? "####" : "###"} ${markdownText(section.flowDiagram.title)}`,
        "",
      );
      for (const node of section.flowDiagram.nodes) {
        output.push(`- **${node.kind}:** ${markdownText(node.label)}`);
      }
      output.push("", "**Conexiones**", "");
      const labels = new Map(
        section.flowDiagram.nodes.map((node) => [node.id, node.label]),
      );
      for (const edge of section.flowDiagram.edges) {
        const from = markdownText(labels.get(edge.from) ?? edge.from);
        const to = markdownText(labels.get(edge.to) ?? edge.to);
        output.push(
          `- ${from} → ${edge.label ? `${markdownText(edge.label)} → ` : ""}${to}`,
        );
      }
      output.push("");
    }

    for (const table of section.tables) {
      output.push(
        `${section.headingNumber ? "####" : "###"} ${markdownText(table.title)}`,
        "",
      );
      output.push(
        `| ${table.headers.map(markdownCell).join(" | ")} |`,
        `| ${table.headers.map(() => "---").join(" | ")} |`,
      );
      for (const row of table.rows) {
        output.push(`| ${row.map(markdownCell).join(" | ")} |`);
      }
      output.push("");
    }
  }

  const prototypeMarkdown = jsonRecord(
    versionSection(input, "solutionProposal")?.content,
  )?.prototypeMarkdown;
  if (typeof prototypeMarkdown === "string" && prototypeMarkdown.trim()) {
    const specification = sanitizeMarkdown(
      prototypeMarkdown
        .trim()
        .replace(/^#\s+[^\n]+\n+/u, "")
        .replace(/^(#{1,5})(?=\s)/gmu, "#$1"),
    );
    output.push(
      "---",
      "",
      "## Anexo · Especificaciones del prototipo",
      "",
      specification,
      "",
    );
  }

  output.push(
    "---",
    "",
    `Documento controlado · ${markdownText(input.project.code)} · Generado el ${date(input.generatedAt)}`,
    "",
  );

  return {
    buffer: Buffer.from(output.join("\n"), "utf8"),
    mediaType: "text/markdown; charset=utf-8",
    extension: "md",
  };
}
