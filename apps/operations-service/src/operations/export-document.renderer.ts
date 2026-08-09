import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import {
  PDFDocument,
  PageSizes,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import type {
  DocumentJsonValue,
  DocumentVersionDetail,
  ProjectDetail,
  RequirementDocumentDetail,
} from "@levantamiento-rq/shared-contracts";

export interface RenderApprovedDocumentInput {
  project: ProjectDetail;
  document: RequirementDocumentDetail;
  version: DocumentVersionDetail;
  generatedAt: Date;
}

export interface RenderedExportArtifact {
  buffer: Buffer;
  mediaType: string;
  extension: "pdf" | "docx";
}

export interface ExportContentLine {
  text: string;
  level: number;
  bullet: boolean;
}

const LABELS: Readonly<Record<string, string>> = {
  title: "Título",
  projectCode: "Código del proyecto",
  documentVersion: "Versión del documento",
  createdDate: "Fecha de creación",
  requestingArea: "Área solicitante",
  preparedBy: "Elaborado por",
  reviewedBy: "Revisado por",
  approvedBy: "Aprobado por",
  status: "Estado",
  general: "Objetivo general",
  specific: "Objetivos específicos",
  currentState: "Estado actual",
  operationalImpact: "Impacto operacional",
  included: "Incluye",
  excluded: "No incluye",
  involvedSystems: "Sistemas involucrados",
  content: "Contenido",
  actors: "Actores",
  inputs: "Entradas",
  outputs: "Salidas",
  systems: "Sistemas",
  description: "Descripción",
  details: "Detalles",
  result: "Resultado",
  keyActivities: "Actividades clave",
  userStory: "Historia de usuario",
  acceptanceCriteria: "Criterios de aceptación",
  businessRules: "Reglas de negocio",
  requiredFields: "Campos requeridos",
  validationOrObservation: "Validación u observación",
  security: "Seguridad",
  traceability: "Trazabilidad",
  performance: "Rendimiento",
  compatibility: "Compatibilidad",
  availability: "Disponibilidad",
  usability: "Usabilidad",
  objective: "Objetivo",
  minimumScenarios: "Escenarios mínimos",
  assumptions: "Supuestos",
  dependencies: "Dependencias",
  pendingItems: "Pendientes",
  changeControl: "Control de cambios",
  approvals: "Aprobaciones",
};

function label(key: string): string {
  return (
    LABELS[key] ??
    key
      .replace(/([a-záéíóúñ])([A-Z])/g, "$1 $2")
      .replaceAll("_", " ")
      .replace(/^./, (value) => value.toUpperCase())
  );
}

function scalar(value: string | number | boolean | null): string {
  if (value === null) return "Sin información";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return String(value).trim() || "Sin información";
}

export function flattenDocumentContent(
  value: DocumentJsonValue,
  level = 0,
): ExportContentLine[] {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return [{ text: scalar(value), level, bullet: false }];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [{ text: "Sin registros", level, bullet: false }];
    }
    return value.flatMap((item) => {
      if (
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
      ) {
        return [{ text: scalar(item), level, bullet: true }];
      }
      return flattenDocumentContent(item, level + 1);
    });
  }
  return Object.entries(value).flatMap(([key, item]) => {
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      return [
        {
          text: `${label(key)}: ${scalar(item)}`,
          level,
          bullet: false,
        },
      ];
    }
    return [
      { text: label(key), level, bullet: false },
      ...flattenDocumentContent(item, level + 1),
    ];
  });
}

function date(value: Date | string | null): string {
  if (!value) return "No registrada";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(new Date(value));
}

function docxText(text: string, bold = false): TextRun {
  return new TextRun({ text, bold, color: bold ? "334652" : "25313A" });
}

function docxMetadata(input: RenderApprovedDocumentInput): Table {
  const rows: readonly (readonly [string, string])[] = [
    ["Proyecto", `${input.project.code} · ${input.project.title}`],
    ["Área solicitante", input.project.requestingArea],
    ["Documento", input.document.title],
    ["Versión", `${input.version.version} (#${input.version.versionNumber})`],
    ["Estado", input.version.status],
    ["Aprobado por", input.version.approvedByUserId ?? "No registrado"],
    ["Fecha de aprobación", date(input.version.approvedAt)],
    ["Fecha de exportación", date(input.generatedAt)],
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      ([key, value]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 28, type: WidthType.PERCENTAGE },
              shading: { fill: "E9EEF0" },
              children: [new Paragraph({ children: [docxText(key, true)] })],
            }),
            new TableCell({
              width: { size: 72, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [docxText(value)] })],
            }),
          ],
        }),
    ),
  });
}

function docxSectionContent(
  input: RenderApprovedDocumentInput,
): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = [];
  for (const section of input.version.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: section.order > 1,
        children: [
          new TextRun({
            text: `${section.order}. ${section.title}`,
            bold: true,
            color: "334652",
          }),
        ],
      }),
    );
    for (const line of flattenDocumentContent(section.content)) {
      children.push(
        new Paragraph({
          indent: { left: line.level * 360 },
          bullet: line.bullet ? { level: Math.min(line.level, 2) } : undefined,
          spacing: { after: 100 },
          children: [docxText(line.text, line.level === 0 && !line.bullet)],
        }),
      );
    }
    const requirements = input.version.requirements.filter(
      (item) => item.sectionKey === section.key,
    );
    if (requirements.length > 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [docxText("Requerimientos y criterios", true)],
        }),
      );
      for (const requirement of requirements) {
        children.push(
          new Paragraph({
            keepNext: true,
            children: [
              docxText(
                `${requirement.code} · ${requirement.title} (${requirement.requirementType})`,
                true,
              ),
            ],
          }),
          new Paragraph({ children: [docxText(requirement.description)] }),
          ...requirement.acceptanceCriteria.map(
            (criterion) =>
              new Paragraph({
                bullet: { level: 0 },
                children: [docxText(criterion.description)],
              }),
          ),
        );
      }
    }
    const evidence = input.version.evidence.filter(
      (item) => item.sectionKey === section.key,
    );
    if (evidence.length > 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [docxText("Evidencia y trazabilidad", true)],
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: ["Fuente", "Extracto / nota"].map(
                (value) =>
                  new TableCell({
                    shading: { fill: "334652" },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: value,
                            bold: true,
                            color: "FFFFFF",
                          }),
                        ],
                      }),
                    ],
                  }),
              ),
            }),
            ...evidence.map(
              (item) =>
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph(item.sourceId)],
                    }),
                    new TableCell({
                      children: [
                        new Paragraph(
                          item.excerpt ?? item.note ?? "Evidencia vinculada",
                        ),
                      ],
                    }),
                  ],
                }),
            ),
          ],
        }),
      );
    }
  }
  return children;
}

export async function renderDocx(
  input: RenderApprovedDocumentInput,
): Promise<RenderedExportArtifact> {
  const document = new Document({
    creator: "Levantamiento RQ",
    title: input.document.title,
    subject: `Documento aprobado ${input.project.code}`,
    description: "Exportación trazable de una versión documental aprobada.",
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1080, right: 900, bottom: 1080, left: 900 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                border: {
                  bottom: {
                    color: "6D8050",
                    size: 8,
                    style: BorderStyle.SINGLE,
                    space: 4,
                  },
                },
                children: [
                  new TextRun({
                    text: `LEVANTAMIENTO RQ  ·  ${input.project.code}`,
                    bold: true,
                    color: "334652",
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun("Versión aprobada · Página "),
                  new TextRun({ children: [PageNumber.CURRENT] }),
                  new TextRun(" de "),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES] }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 900, after: 240 },
            children: [
              new TextRun({
                text: "DOCUMENTO DE LEVANTAMIENTO DE REQUERIMIENTOS",
                bold: true,
                color: "6D8050",
                size: 22,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            heading: HeadingLevel.TITLE,
            spacing: { after: 360 },
            children: [
              new TextRun({ text: input.document.title, color: "334652" }),
            ],
          }),
          docxMetadata(input),
          new Paragraph({
            spacing: { before: 400, after: 120 },
            children: [
              docxText(
                "Este entregable corresponde exactamente a una versión aprobada e inmutable.",
                true,
              ),
            ],
          }),
          ...docxSectionContent(input),
        ],
      },
    ],
  });
  return {
    buffer: await Packer.toBuffer(document),
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  };
}

function pdfSafe(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");
}

function wrap(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const paragraphs = pdfSafe(text).split(/\r?\n/);
  const result: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((word) => {
        if (font.widthOfTextAtSize(word, size) <= width) return [word];
        const segments: string[] = [];
        let segment = "";
        for (const character of word) {
          const candidate = `${segment}${character}`;
          if (font.widthOfTextAtSize(candidate, size) <= width || !segment) {
            segment = candidate;
          } else {
            segments.push(segment);
            segment = character;
          }
        }
        if (segment) segments.push(segment);
        return segments;
      });
    if (words.length === 0) {
      result.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width || !line) {
        line = candidate;
      } else {
        result.push(line);
        line = word;
      }
    }
    if (line) result.push(line);
  }
  return result;
}

class PdfLayout {
  readonly pages: PDFPage[] = [];
  private page!: PDFPage;
  private y = 0;
  private readonly width = PageSizes.A4[0];
  private readonly height = PageSizes.A4[1];
  private readonly left = 54;
  private readonly right = 54;

  constructor(
    private readonly pdf: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    private readonly projectCode: string,
  ) {
    this.newPage();
  }

  newPage(): void {
    this.page = this.pdf.addPage(PageSizes.A4);
    this.pages.push(this.page);
    this.page.drawRectangle({
      x: 0,
      y: this.height - 42,
      width: this.width,
      height: 42,
      color: rgb(0.2, 0.275, 0.322),
    });
    this.page.drawText(pdfSafe(`LEVANTAMIENTO RQ  ·  ${this.projectCode}`), {
      x: this.left,
      y: this.height - 27,
      size: 9,
      font: this.bold,
      color: rgb(1, 1, 1),
    });
    this.y = this.height - 66;
  }

  ensure(height: number): void {
    if (this.y - height < 52) this.newPage();
  }

  text(
    text: string,
    options: {
      size?: number;
      bold?: boolean;
      color?: readonly [number, number, number];
      indent?: number;
      before?: number;
      after?: number;
      bullet?: boolean;
    } = {},
  ): void {
    const size = options.size ?? 10;
    const font = options.bold ? this.bold : this.regular;
    const indent = options.indent ?? 0;
    const before = options.before ?? 0;
    const after = options.after ?? 5;
    const prefix = options.bullet ? "- " : "";
    const lines = wrap(
      `${prefix}${text}`,
      font,
      size,
      this.width - this.left - this.right - indent,
    );
    const lineHeight = size * 1.35;
    this.ensure(before + lineHeight);
    this.y -= before;
    const color = options.color ?? [0.15, 0.19, 0.23];
    for (const line of lines) {
      this.ensure(lineHeight);
      this.page.drawText(line, {
        x: this.left + indent,
        y: this.y,
        size,
        font,
        color: rgb(color[0], color[1], color[2]),
      });
      this.y -= lineHeight;
    }
    this.y -= after;
  }

  rule(): void {
    this.ensure(12);
    this.page.drawLine({
      start: { x: this.left, y: this.y },
      end: { x: this.width - this.right, y: this.y },
      thickness: 0.7,
      color: rgb(0.8, 0.83, 0.84),
    });
    this.y -= 12;
  }

  footer(): void {
    this.pages.forEach((page, index) => {
      page.drawLine({
        start: { x: this.left, y: 38 },
        end: { x: this.width - this.right, y: 38 },
        thickness: 0.5,
        color: rgb(0.75, 0.78, 0.79),
      });
      page.drawText(
        `Versión aprobada · Página ${index + 1} de ${this.pages.length}`,
        {
          x: this.left,
          y: 24,
          size: 8,
          font: this.regular,
          color: rgb(0.35, 0.4, 0.43),
        },
      );
    });
  }
}

export async function renderPdf(
  input: RenderApprovedDocumentInput,
): Promise<RenderedExportArtifact> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const layout = new PdfLayout(pdf, regular, bold, input.project.code);

  layout.text("DOCUMENTO DE LEVANTAMIENTO DE REQUERIMIENTOS", {
    size: 11,
    bold: true,
    color: [0.43, 0.5, 0.31],
    before: 24,
    after: 12,
  });
  layout.text(input.document.title, {
    size: 22,
    bold: true,
    color: [0.2, 0.275, 0.322],
    after: 22,
  });
  for (const [key, value] of [
    ["Proyecto", `${input.project.code} · ${input.project.title}`],
    ["Área solicitante", input.project.requestingArea],
    ["Versión", `${input.version.version} (#${input.version.versionNumber})`],
    ["Estado", input.version.status],
    ["Aprobado por", input.version.approvedByUserId ?? "No registrado"],
    ["Fecha de aprobación", date(input.version.approvedAt)],
    ["Fecha de exportación", date(input.generatedAt)],
  ] as const) {
    layout.text(`${key}: ${value}`, { size: 10, bold: true, after: 4 });
  }
  layout.rule();
  layout.text(
    "Este entregable corresponde exactamente a una versión aprobada e inmutable.",
    { size: 9, color: [0.35, 0.4, 0.43], after: 18 },
  );

  for (const section of input.version.sections) {
    layout.ensure(110);
    layout.text(`${section.order}. ${section.title}`, {
      size: 16,
      bold: true,
      color: [0.2, 0.275, 0.322],
      before: 14,
      after: 10,
    });
    for (const line of flattenDocumentContent(section.content)) {
      layout.text(line.text, {
        size: line.level === 0 && !line.bullet ? 10.5 : 10,
        bold: line.level === 0 && !line.bullet,
        indent: Math.min(line.level, 3) * 14,
        bullet: line.bullet,
      });
    }
    const requirements = input.version.requirements.filter(
      (item) => item.sectionKey === section.key,
    );
    if (requirements.length > 0) {
      layout.ensure(120);
      layout.text("Requerimientos y criterios", {
        size: 12,
        bold: true,
        color: [0.43, 0.5, 0.31],
        before: 9,
      });
      for (const requirement of requirements) {
        layout.text(
          `${requirement.code} · ${requirement.title} (${requirement.requirementType})`,
          { bold: true, before: 5, after: 3 },
        );
        layout.text(requirement.description, { after: 3 });
        for (const criterion of requirement.acceptanceCriteria) {
          layout.text(criterion.description, { bullet: true, indent: 14 });
        }
      }
    }
    const evidence = input.version.evidence.filter(
      (item) => item.sectionKey === section.key,
    );
    if (evidence.length > 0) {
      layout.ensure(75);
      layout.text("Evidencia y trazabilidad", {
        size: 12,
        bold: true,
        color: [0.43, 0.5, 0.31],
        before: 9,
      });
      for (const item of evidence) {
        layout.text(
          `${item.sourceId}: ${item.excerpt ?? item.note ?? "Evidencia vinculada"}`,
          { bullet: true, indent: 14 },
        );
      }
    }
    layout.rule();
  }
  layout.footer();
  return {
    buffer: Buffer.from(await pdf.save()),
    mediaType: "application/pdf",
    extension: "pdf",
  };
}
