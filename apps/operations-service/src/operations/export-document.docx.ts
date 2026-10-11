import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
} from "docx";
import { type DocumentTemplateLogo } from "@levantamiento-rq/shared-contracts";
import {
  corporateMetadata,
  exportLineHeadingDepth,
  exportTreeNodeBody,
  exportTreeNodeKind,
  numberedSectionLines,
} from "./export-document.numbering";
import { buildExportDocumentSections } from "./export-document.sections";
import {
  NAVI_DOCUMENT_COLORS,
  NAVI_DOCUMENT_FONT,
} from "./export-document.style";
import {
  fitDiagramDimensions,
  renderEntityRelationshipSvg,
  renderSwimlaneFlowSvg,
} from "./export-document.svg";
import {
  businessText,
  documentTemplateDescription,
  exportNumber,
  exportSectionTitle,
  presentationProfile,
} from "./export-document.text";
import {
  type ExportContentTable,
  type ExportHeadingKind,
  type ExportKpiCard,
  type ExportObjectivesLayout,
  type RenderApprovedDocumentInput,
  type RenderedExportArtifact,
} from "./export-document.types";

function docxRuns(
  text: string,
  options: {
    bold?: boolean;
    color?: string;
    size?: number;
    italics?: boolean;
  } = {},
): TextRun[] {
  const value = businessText(text);
  return value
    .split(/(\bPendiente\b)/giu)
    .filter(Boolean)
    .map(
      (part) =>
        new TextRun({
          text: part,
          bold: options.bold,
          color:
            options.color ??
            (options.bold
              ? NAVI_DOCUMENT_COLORS.institutional
              : NAVI_DOCUMENT_COLORS.text),
          font: NAVI_DOCUMENT_FONT,
          size: options.size,
          italics: options.italics,
          underline: /^Pendiente$/iu.test(part)
            ? { type: UnderlineType.SINGLE }
            : undefined,
        }),
    );
}

function docxMetadata(input: RenderApprovedDocumentInput): Table {
  const items = corporateMetadata(input);
  const pairs: Array<
    readonly [
      readonly [string, string] | undefined,
      readonly [string, string] | undefined,
    ]
  > = [
    [items[0], items[1]],
    [items[2], items[3]],
    [items[4], items[5]],
  ];
  const border = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: NAVI_DOCUMENT_COLORS.border,
  };
  const card = (item: readonly [string, string] | undefined): TableCell => {
    const [key, value] = item ?? ["", ""];
    return new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      shading: { fill: NAVI_DOCUMENT_COLORS.surfaceSoft },
      borders: {
        top: border,
        bottom: border,
        left: border,
        right: border,
      },
      margins: {
        top: 110,
        bottom: 110,
        left: 140,
        right: 140,
      },
      children: [
        new Paragraph({
          spacing: { before: 0, after: 35 },
          children: docxRuns(key.toUpperCase(), {
            bold: true,
            color: NAVI_DOCUMENT_COLORS.muted,
            size: 16,
          }),
        }),
        new Paragraph({
          spacing: { before: 0, after: 0 },
          children: docxRuns(value, {
            bold: true,
            color: NAVI_DOCUMENT_COLORS.text,
            size: 18,
          }),
        }),
      ],
    });
  };

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: pairs.map(
      ([left, right]) =>
        new TableRow({
          children: [card(left), card(right)],
        }),
    ),
  });
}

function docxObjectivesLayout(
  layout: ExportObjectivesLayout,
): Array<Paragraph | Table> {
  const border = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: NAVI_DOCUMENT_COLORS.border,
  };

  const objectiveCell = (title: string, values: readonly string[]): TableCell =>
    new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      shading: { fill: NAVI_DOCUMENT_COLORS.surfaceSoft },
      borders: {
        top: border,
        bottom: border,
        left: border,
        right: border,
      },
      margins: {
        top: 100,
        bottom: 100,
        left: 130,
        right: 130,
      },
      children: [
        new Paragraph({
          spacing: { before: 0, after: 70 },
          children: docxRuns(title, {
            bold: true,
            color: NAVI_DOCUMENT_COLORS.institutional,
            size: 18,
          }),
        }),
        ...values.map(
          (objective, index) =>
            new Paragraph({
              spacing: { before: 0, after: 55 },
              children: docxRuns(`${index + 1}. ${objective}`, {
                color: NAVI_DOCUMENT_COLORS.text,
                size: 18,
              }),
            }),
        ),
      ],
    });

  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      keepNext: true,
      spacing: { before: 20, after: 45 },
      children: docxRuns("1.1. Objetivo general:", {
        bold: true,
        color: NAVI_DOCUMENT_COLORS.operation,
        size: 24,
      }),
    }),
    new Paragraph({
      spacing: { before: 0, after: 100 },
      children: docxRuns(layout.general, {
        color: NAVI_DOCUMENT_COLORS.text,
        size: 18,
      }),
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_3,
      keepNext: true,
      spacing: { before: 20, after: 55 },
      children: docxRuns("1.1.1. Objetivos específicos:", {
        bold: true,
        color: NAVI_DOCUMENT_COLORS.operation,
        size: 22,
      }),
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            objectiveCell("Cualitativos", layout.qualitative),
            objectiveCell("Cuantitativos", layout.quantitative),
          ],
        }),
      ],
    }),
  ];
}

function docxKpiCards(
  cards: readonly ExportKpiCard[],
  sectionNumber: number,
): Array<Paragraph | Table> {
  if (cards.length === 0) return [];

  const border = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: NAVI_DOCUMENT_COLORS.border,
  };

  const card = (item: ExportKpiCard): TableCell =>
    new TableCell({
      width: {
        size: Math.round(100 / cards.length),
        type: WidthType.PERCENTAGE,
      },
      shading: { fill: NAVI_DOCUMENT_COLORS.surfaceSoft },
      borders: {
        top: border,
        bottom: border,
        left: border,
        right: border,
      },
      margins: {
        top: 95,
        bottom: 95,
        left: 110,
        right: 110,
      },
      children: [
        new Paragraph({
          spacing: { before: 0, after: 55 },
          children: docxRuns(item.name, {
            bold: true,
            color: NAVI_DOCUMENT_COLORS.institutional,
            size: 17,
          }),
        }),
        new Paragraph({
          spacing: { before: 0, after: 45 },
          children: [
            new TextRun({
              text: `Inicio 0%  ░░░░░░░░░░  Meta ${item.target}`,
              bold: true,
              color: NAVI_DOCUMENT_COLORS.operation,
              font: NAVI_DOCUMENT_FONT,
              size: 18,
            }),
          ],
        }),
        new Paragraph({
          spacing: { before: 0, after: 35 },
          children: [
            new TextRun({
              text: "Cálculo: ",
              bold: true,
              color: NAVI_DOCUMENT_COLORS.muted,
              font: NAVI_DOCUMENT_FONT,
              size: 16,
            }),
            ...docxRuns(item.measurement, {
              color: NAVI_DOCUMENT_COLORS.text,
              size: 16,
            }),
          ],
        }),
      ],
    });

  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      keepNext: true,
      spacing: { before: 120, after: 65 },
      children: docxRuns(`${exportNumber(sectionNumber)}.4. KPIs de estado:`, {
        bold: true,
        color: NAVI_DOCUMENT_COLORS.operation,
        size: 22,
      }),
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: cards.map(card),
        }),
      ],
    }),
  ];
}

function docxContentTable(
  table: ExportContentTable,
  nested = false,
): Array<Paragraph | Table> {
  const weights =
    table.columnWeights?.length === table.headers.length
      ? table.columnWeights
      : table.headers.map(() => 1);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const cell = (value: string, index: number, header: boolean): TableCell =>
    new TableCell({
      width: {
        size: Math.round(((weights[index] ?? 1) / totalWeight) * 100),
        type: WidthType.PERCENTAGE,
      },
      shading: header
        ? { fill: NAVI_DOCUMENT_COLORS.institutional }
        : undefined,
      // Un salto de línea dentro de la celda es un párrafo propio: un TextRun
      // con "\n" lo colapsaba en un espacio en Word.
      children: (value.split(/\r?\n/u).filter((part) => part.trim()).length > 0
        ? value.split(/\r?\n/u).filter((part) => part.trim())
        : [""]
      ).map(
        (part) =>
          new Paragraph({
            spacing: { after: 40 },
            children: docxRuns(part, {
              bold: header,
              color: header
                ? NAVI_DOCUMENT_COLORS.white
                : NAVI_DOCUMENT_COLORS.text,
              size: header ? 16 : 18,
            }),
          }),
      ),
    });
  return [
    new Paragraph({
      heading: nested ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2,
      keepNext: true,
      spacing: nested ? { before: 120, after: 70 } : { before: 180, after: 90 },
      children: docxRuns(table.title, {
        bold: true,
        color: NAVI_DOCUMENT_COLORS.operation,
        size: nested ? 20 : 22,
      }),
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: table.headers.map((value, index) =>
            cell(value, index, true),
          ),
        }),
        ...table.rows.map(
          (row) =>
            new TableRow({
              children: row.map((value, index) => cell(value, index, false)),
            }),
        ),
      ],
    }),
  ];
}

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

// RQ_EXPORT_BRAND_AND_ER_V2
interface RasterDimensions {
  width: number;
  height: number;
}

function templateLogoDimensions(
  data: Buffer,
  mediaType: DocumentTemplateLogo["mediaType"],
): RasterDimensions {
  if (
    mediaType === "image/png" &&
    data.length >= 24 &&
    data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
  ) {
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);

    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  if (
    mediaType === "image/jpeg" &&
    data.length >= 4 &&
    data[0] === 0xff &&
    data[1] === 0xd8
  ) {
    let offset = 2;

    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }

      const marker = data[offset + 1] ?? 0;

      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }

      const blockLength = data.readUInt16BE(offset + 2);

      if (blockLength < 2 || offset + 2 + blockLength > data.length) {
        break;
      }

      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        const height = data.readUInt16BE(offset + 5);
        const width = data.readUInt16BE(offset + 7);

        if (width > 0 && height > 0) {
          return { width, height };
        }
      }

      offset += 2 + blockLength;
    }
  }

  return {
    width: 320,
    height: 120,
  };
}

function fitTemplateLogo(
  data: Buffer,
  mediaType: DocumentTemplateLogo["mediaType"],
  maxWidth: number,
  maxHeight: number,
): RasterDimensions {
  const sourceSize = templateLogoDimensions(data, mediaType);

  const scale = Math.min(
    maxWidth / sourceSize.width,
    maxHeight / sourceSize.height,
  );

  return {
    width: Math.max(1, Math.round(sourceSize.width * scale)),
    height: Math.max(1, Math.round(sourceSize.height * scale)),
  };
}

function docxHeader(input: RenderApprovedDocumentInput): Header {
  const logoBytes = input.templateLogo?.dataBase64
    ? Buffer.from(input.templateLogo.dataBase64, "base64")
    : null;

  const logoSize =
    logoBytes && input.templateLogo
      ? fitTemplateLogo(logoBytes, input.templateLogo.mediaType, 132, 46)
      : null;

  const noBorder = {
    style: BorderStyle.NONE,
    size: 0,
    color: "FFFFFF",
  };

  const tableBorders = {
    top: noBorder,
    bottom: noBorder,
    left: noBorder,
    right: noBorder,
    insideHorizontal: noBorder,
    insideVertical: noBorder,
  };

  const cellBorders = {
    top: noBorder,
    bottom: noBorder,
    left: noBorder,
    right: noBorder,
  };

  return new Header({
    children: [
      new Table({
        width: {
          size: 10800,
          type: WidthType.DXA,
        },
        columnWidths: [2600, 8200],
        borders: tableBorders,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: {
                  size: 2600,
                  type: WidthType.DXA,
                },
                borders: cellBorders,
                children: [
                  new Paragraph({
                    spacing: {
                      before: 0,
                      after: 0,
                    },
                    children:
                      logoBytes && logoSize && input.templateLogo
                        ? [
                            new ImageRun({
                              type:
                                input.templateLogo.mediaType === "image/png"
                                  ? "png"
                                  : "jpg",
                              data: logoBytes,
                              transformation: logoSize,
                              altText: {
                                title: "Logo de plantilla",
                                description: input.templateLogo.fileName,
                                name: "Logo",
                              },
                            }),
                          ]
                        : [
                            new TextRun({
                              text: "",
                              font: NAVI_DOCUMENT_FONT,
                            }),
                          ],
                  }),
                ],
              }),

              new TableCell({
                width: {
                  size: 8200,
                  type: WidthType.DXA,
                },
                borders: cellBorders,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    spacing: {
                      before: 0,
                      after: 0,
                    },
                    children: [
                      new TextRun({
                        text: "LEVANTAMIENTO DE REQUERIMIENTOS SOLUCIONES TIC",
                        bold: true,
                        color: NAVI_DOCUMENT_COLORS.institutional,
                        font: NAVI_DOCUMENT_FONT,
                        size: 16,
                      }),
                    ],
                  }),

                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    spacing: {
                      before: 20,
                      after: 0,
                    },
                    children: [
                      new TextRun({
                        text: input.project.code,
                        color: NAVI_DOCUMENT_COLORS.muted,
                        font: NAVI_DOCUMENT_FONT,
                        size: 14,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),

      new Paragraph({
        border: {
          bottom: {
            color: NAVI_DOCUMENT_COLORS.border,
            size: 8,
            style: BorderStyle.SINGLE,
            space: 4,
          },
        },
        spacing: {
          before: 20,
          after: 0,
        },
        children: [],
      }),
    ],
  });
}

async function docxSectionContent(
  input: RenderApprovedDocumentInput,
): Promise<Array<Paragraph | Table>> {
  const children: Array<Paragraph | Table> = [];
  const profile = presentationProfile(input);
  for (const section of buildExportDocumentSections(input)) {
    const headingKind: ExportHeadingKind = section.headingNumber
      ? "subsection"
      : "section";
    const isSubsection = headingKind === "subsection";
    const headingNumber = exportNumber(
      section.headingNumber ?? section.displayNumber ?? section.number,
    );
    const headingTitle = exportSectionTitle(section);

    children.push(
      new Paragraph({
        heading: isSubsection ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1,
        pageBreakBefore:
          profile !== "COMPACT" &&
          !isSubsection &&
          [5, 12].includes(section.number),
        border: {
          bottom: {
            color: NAVI_DOCUMENT_COLORS.border,
            size: isSubsection ? 3 : 5,
            style: BorderStyle.SINGLE,
            space: 3,
          },
        },
        spacing: isSubsection
          ? { before: 140, after: 70 }
          : { before: 260, after: 110 },
        children: [
          new TextRun({
            text: isSubsection
              ? `${headingNumber}. ${headingTitle}`
              : `${headingNumber} ${headingTitle.toUpperCase()}`,
            bold: true,
            color: isSubsection
              ? NAVI_DOCUMENT_COLORS.operation
              : NAVI_DOCUMENT_COLORS.institutional,
            font: NAVI_DOCUMENT_FONT,
            size: isSubsection ? 24 : 27,
          }),
        ],
      }),
    );

    if (section.objectivesLayout) {
      children.push(...docxObjectivesLayout(section.objectivesLayout));
    } else {
      for (const line of numberedSectionLines(section)) {
        const lineHeadingDepth = exportLineHeadingDepth(line);
        const isLineHeading = lineHeadingDepth !== null;
        const treeNodeKind = exportTreeNodeKind(line);
        const isTreeParent = treeNodeKind !== null && treeNodeKind !== "TAREA";
        children.push(
          new Paragraph({
            keepNext: isTreeParent,
            keepLines: treeNodeKind !== null,
            indent: { left: line.level * 240 },
            bullet:
              line.bullet && !treeNodeKind
                ? { level: Math.min(line.level, 2) }
                : undefined,
            spacing: isLineHeading
              ? { before: 100, after: 60 }
              : treeNodeKind
                ? { before: treeNodeKind === "EPIC" ? 90 : 20, after: 45 }
                : { after: 70 },
            children: treeNodeKind
              ? [
                  new TextRun({
                    text: ` ${treeNodeKind} `,
                    bold: true,
                    color: NAVI_DOCUMENT_COLORS.white,
                    shading: {
                      fill:
                        treeNodeKind === "EPIC"
                          ? NAVI_DOCUMENT_COLORS.institutional
                          : treeNodeKind === "FEATURE"
                            ? NAVI_DOCUMENT_COLORS.operation
                            : NAVI_DOCUMENT_COLORS.muted,
                    },
                    font: NAVI_DOCUMENT_FONT,
                    size: treeNodeKind === "TAREA" ? 15 : 16,
                  }),
                  ...docxRuns(`  ${exportTreeNodeBody(line)}`, {
                    bold: isTreeParent,
                    color: NAVI_DOCUMENT_COLORS.text,
                    size:
                      treeNodeKind === "EPIC"
                        ? 20
                        : treeNodeKind === "FEATURE"
                          ? 19
                          : treeNodeKind === "TAREA"
                            ? 17
                            : 18,
                  }),
                ]
              : docxRuns(line.text, {
                  bold: isLineHeading,
                  color: isLineHeading
                    ? NAVI_DOCUMENT_COLORS.operation
                    : NAVI_DOCUMENT_COLORS.text,
                  size: isLineHeading ? (lineHeadingDepth === 2 ? 22 : 20) : 18,
                }),
          }),
        );
      }
    }

    if (section.kpiCards?.length) {
      children.push(
        ...docxKpiCards(
          section.kpiCards,
          section.displayNumber ?? section.number,
        ),
      );
    }

    if (section.flowDiagram) {
      const rendered = renderSwimlaneFlowSvg(section.flowDiagram);
      if (rendered.width > 0 && rendered.height > 0) {
        const { width, height } = fitDiagramDimensions(
          rendered.width,
          rendered.height,
          690,
          360,
        );
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 36, after: 12 },
            children: [
              new ImageRun({
                type: "svg",
                data: Buffer.from(rendered.svg, "utf8"),
                transformation: { width, height },
                fallback: {
                  type: "png",
                  data: TRANSPARENT_PNG,
                },
                altText: {
                  title: section.flowDiagram.title,
                  description: `${section.flowDiagram.nodes.length} pasos y ${section.flowDiagram.edges.length} conexiones`,
                  name: "Diagrama de flujo",
                },
              }),
            ],
          }),
        );
      } else {
        const nodeLabels = new Map(
          section.flowDiagram.nodes.map((node) => [node.id, node.label]),
        );
        children.push(
          ...docxContentTable(
            {
              title: section.flowDiagram.title,
              headers: ["Origen", "Condición", "Destino"],
              columnWeights: [2.5, 1.4, 2.5],
              rows: section.flowDiagram.edges.map((edge) => [
                nodeLabels.get(edge.from) ?? edge.from,
                edge.label ?? "Continúa",
                nodeLabels.get(edge.to) ?? edge.to,
              ]),
            },
            Boolean(section.headingNumber),
          ),
        );
      }
    }
    if (section.entityRelationshipDiagram) {
      const rendered = renderEntityRelationshipSvg(
        section.entityRelationshipDiagram,
      );
      const { width, height } = fitDiagramDimensions(
        rendered.width,
        rendered.height,
        690,
        470,
      );

      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: {
            before: 36,
            after: 12,
          },
          children: [
            new ImageRun({
              type: "svg",
              data: Buffer.from(rendered.svg, "utf8"),
              transformation: {
                width,
                height,
              },
              fallback: {
                type: "png",
                data: TRANSPARENT_PNG,
              },
              altText: {
                title: section.entityRelationshipDiagram.title,
                description: `${section.entityRelationshipDiagram.entities.length} entidades y ${section.entityRelationshipDiagram.relationships.length} relaciones`,
                name: "Modelo entidad-relación",
              },
            }),
          ],
        }),
      );
    }

    for (const table of section.tables)
      children.push(...docxContentTable(table, Boolean(section.headingNumber)));
  }
  return children;
}

export async function renderDocx(
  input: RenderApprovedDocumentInput,
): Promise<RenderedExportArtifact> {
  const sectionChildren = await docxSectionContent(input);
  const document = new Document({
    creator: "Levantamiento RQ",
    title: input.document.title,
    subject: `Documento de requerimientos ${input.project.code}`,
    description: "Documento estructurado de levantamiento de requerimientos.",
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 900, right: 720, bottom: 900, left: 720 },
          },
        },
        headers: {
          default: docxHeader(input),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: "Documento controlado | Página ",
                    color: NAVI_DOCUMENT_COLORS.muted,
                    font: NAVI_DOCUMENT_FONT,
                    size: 16,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    color: NAVI_DOCUMENT_COLORS.muted,
                    font: NAVI_DOCUMENT_FONT,
                    size: 16,
                  }),
                  new TextRun({
                    text: " de ",
                    color: NAVI_DOCUMENT_COLORS.muted,
                    font: NAVI_DOCUMENT_FONT,
                    size: 16,
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    color: NAVI_DOCUMENT_COLORS.muted,
                    font: NAVI_DOCUMENT_FONT,
                    size: 16,
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 90 },
            children: docxRuns(
              corporateMetadata(input)[0]?.[1] ?? input.document.title,
              {
                bold: true,
                color: NAVI_DOCUMENT_COLORS.institutional,
                size: 32,
              },
            ),
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: docxRuns(documentTemplateDescription(input), {
              color: NAVI_DOCUMENT_COLORS.muted,
              size: 18,
              italics: true,
            }),
          }),
          docxMetadata(input),
          ...sectionChildren,
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
