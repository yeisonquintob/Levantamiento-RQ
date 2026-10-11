import { buildExportEpicTimeline } from "./export-work-plan";
import { PDFDocument, type PDFImage, StandardFonts } from "pdf-lib";
import {
  corporateMetadata,
  exportLineHeadingDepth,
  exportTreeNodeKind,
  numberedSectionLines,
} from "./export-document.numbering";
import { PdfLayout } from "./export-document.pdf-layout";
import { pdfSafe } from "./export-document.pdf-text";
import { buildExportDocumentSections } from "./export-document.sections";
import { NAVI_DOCUMENT_PDF_COLORS } from "./export-document.style";
import { exportFlowLayout } from "./export-document.svg";
import {
  documentTemplateDescription,
  exportNumber,
  exportSectionTitle,
  versionSection,
} from "./export-document.text";
import {
  type RenderApprovedDocumentInput,
  type RenderedExportArtifact,
} from "./export-document.types";

export async function renderPdf(
  input: RenderApprovedDocumentInput,
): Promise<RenderedExportArtifact> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const font of [regular, bold]) {
    const widthOfTextAtSize = font.widthOfTextAtSize.bind(font);
    font.widthOfTextAtSize = (text, size) =>
      widthOfTextAtSize(pdfSafe(text), size);
  }
  let templateLogo: PDFImage | null = null;
  if (input.templateLogo?.dataBase64) {
    const imageBytes = Buffer.from(input.templateLogo.dataBase64, "base64");
    templateLogo =
      input.templateLogo.mediaType === "image/png"
        ? await pdf.embedPng(imageBytes)
        : await pdf.embedJpg(imageBytes);
  }
  const layout = new PdfLayout(
    pdf,
    regular,
    bold,
    input.project.code,
    templateLogo,
  );
  layout.text(corporateMetadata(input)[0]?.[1] ?? input.document.title, {
    size: 16,
    bold: true,
    color: NAVI_DOCUMENT_PDF_COLORS.institutional,
    before: 8,
    after: 5,
  });
  layout.text(documentTemplateDescription(input), {
    size: 9,
    color: NAVI_DOCUMENT_PDF_COLORS.muted,
    after: 9,
  });
  layout.metadata(corporateMetadata(input));

  for (const section of buildExportDocumentSections(input)) {
    const isScrumPlan = section.number === 14;
    const isBacklogTree =
      section.number === 7 &&
      section.lines.some((line) => exportTreeNodeKind(line));
    const timeline = isScrumPlan
      ? buildExportEpicTimeline(
          versionSection(input, "scrumPlan")?.content ?? {},
          versionSection(input, "backlogStructure")?.content ?? {},
        )
      : null;
    // El árbol del Esquema ya no fuerza una página nueva: seguía a los
    // Requerimientos dejando media página en blanco.
    if (timeline) layout.newPage("landscape");
    // Un título de subsección sin texto propio quedaba solo al pie de la
    // página anterior; se coloca sobre el diagrama en su página horizontal.
    const diagramOnly =
      Boolean(section.entityRelationshipDiagram) &&
      section.lines.length === 0 &&
      !section.flowDiagram;
    if (diagramOnly) layout.newPage("landscape");
    const firstBlockHeight = section.objectivesLayout
      ? 170
      : section.kpiCards?.length
        ? 150
        : section.tables.length > 0
          ? 145
          : 70;

    const headingAndIntroHeight = section.headingNumber ? 84 : 74;

    layout.ensure(Math.max(firstBlockHeight, headingAndIntroHeight));
    layout.sectionHeading(
      section.headingNumber ?? section.displayNumber ?? section.number,
      exportSectionTitle(section),
      section.headingNumber ? "subsection" : "section",
    );
    if (timeline) {
      layout.epicTimeline(timeline, section.displayNumber ?? section.number);
    }
    if (isBacklogTree) {
      layout.backlogTree(
        section.lines,
        section.displayNumber ?? section.number,
      );
    } else if (section.objectivesLayout) {
      layout.objectives(section.objectivesLayout);
    } else {
      if (timeline) {
        layout.newPage();
        layout.text(
          `${exportNumber(section.displayNumber ?? section.number)} PLAN SCRUM · Detalle de Sprints`,
          { bold: true, size: 12, after: 12 },
        );
      }
      for (const line of numberedSectionLines(section)) {
        const lineHeadingDepth = exportLineHeadingDepth(line);
        const isLineHeading = lineHeadingDepth !== null;
        const treeNodeKind = exportTreeNodeKind(line);
        if (treeNodeKind) {
          layout.treeNode(line, treeNodeKind);
          continue;
        }
        layout.text(line.text, {
          size: isLineHeading
            ? lineHeadingDepth === 2
              ? isScrumPlan
                ? 9.8
                : 10.5
              : 9.5
            : isScrumPlan
              ? 8.3
              : 9,
          bold: isLineHeading,
          color: isLineHeading
            ? NAVI_DOCUMENT_PDF_COLORS.operation
            : NAVI_DOCUMENT_PDF_COLORS.text,
          indent: Math.min(line.level, 3) * 10,
          before: isLineHeading ? (isScrumPlan ? 2.5 : 4) : 0,
          after: isLineHeading
            ? isScrumPlan
              ? 2
              : 4
            : isScrumPlan
              ? 1.25
              : 3.5,
          bullet: line.bullet,
        });
      }
    }
    if (section.kpiCards?.length) {
      layout.kpiCards(
        section.kpiCards,
        section.displayNumber ?? section.number,
      );
    }
    if (section.flowDiagram) {
      layout.flowDiagram(
        section.flowDiagram,
        (section.flowDiagram.lanes?.length ?? 0) > 0
          ? null
          : await exportFlowLayout(section.flowDiagram),
      );
    }
    if (section.entityRelationshipDiagram) {
      layout.entityRelationshipDiagram(
        section.entityRelationshipDiagram,
        diagramOnly,
      );
    }
    for (const table of section.tables) layout.table(table);
  }
  layout.footer();
  return {
    buffer: Buffer.from(await pdf.save()),
    mediaType: "application/pdf",
    extension: "pdf",
  };
}
