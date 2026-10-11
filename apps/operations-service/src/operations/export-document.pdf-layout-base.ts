import {
  PageSizes,
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  rgb,
} from "pdf-lib";
import { exportTreeNodeBody } from "./export-document.numbering";
import { pdfSafe, wrap } from "./export-document.pdf-text";
import { NAVI_DOCUMENT_PDF_COLORS } from "./export-document.style";
import { businessText, exportNumber } from "./export-document.text";
import {
  type ExportContentLine,
  type ExportContentTable,
  type ExportHeadingKind,
  type ExportTreeNodeKind,
} from "./export-document.types";

export class PdfLayoutBase {
  readonly pages: PDFPage[] = [];

  protected page!: PDFPage;

  protected y = 0;

  protected width = PageSizes.Letter[0];

  protected height = PageSizes.Letter[1];

  protected readonly left = 38;

  protected readonly right = 38;

  constructor(
    protected readonly pdf: PDFDocument,
    protected readonly regular: PDFFont,
    protected readonly bold: PDFFont,
    protected readonly projectCode: string,
    protected readonly templateLogo: PDFImage | null,
  ) {
    this.newPage();
  }

  newPage(orientation: "portrait" | "landscape" = "portrait"): void {
    const size: [number, number] =
      orientation === "landscape"
        ? [PageSizes.Letter[1], PageSizes.Letter[0]]
        : [PageSizes.Letter[0], PageSizes.Letter[1]];
    this.width = size[0];
    this.height = size[1];
    this.page = this.pdf.addPage(size);
    // Todo texto dibujado pasa por pdfSafe: un carácter fuera de WinAnsi no debe
    // abortar la exportación completa.
    const drawText = this.page.drawText.bind(this.page);
    this.page.drawText = (text, options) => drawText(pdfSafe(text), options);
    this.pages.push(this.page);
    if (this.templateLogo) {
      const scale = Math.min(
        118 / this.templateLogo.width,
        42 / this.templateLogo.height,
      );

      const logoWidth = this.templateLogo.width * scale;

      const logoHeight = this.templateLogo.height * scale;

      this.page.drawImage(this.templateLogo, {
        x: this.left,
        y: this.height - 14 - logoHeight,
        width: logoWidth,
        height: logoHeight,
      });
    }

    const headerTitle = "LEVANTAMIENTO DE REQUERIMIENTOS SOLUCIONES TIC";

    this.page.drawText(headerTitle, {
      x:
        this.width - this.right - this.bold.widthOfTextAtSize(headerTitle, 8.2),
      y: this.height - 28,
      size: 8.2,
      font: this.bold,
      color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
    });

    const headerProjectCode = pdfSafe(this.projectCode);

    this.page.drawText(headerProjectCode, {
      x:
        this.width -
        this.right -
        this.regular.widthOfTextAtSize(headerProjectCode, 7),
      y: this.height - 42,
      size: 7,
      font: this.regular,
      color: rgb(...NAVI_DOCUMENT_PDF_COLORS.muted),
    });

    this.page.drawLine({
      start: {
        x: this.left,
        y: this.height - 60,
      },
      end: {
        x: this.width - this.right,
        y: this.height - 60,
      },
      thickness: 0.8,
      color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
    });

    this.y = this.height - 82;
  }

  ensure(height: number): void {
    if (this.y - height < 46) this.newPage();
  }

  protected drawTextWithPendingUnderline(
    value: string,
    x: number,
    y: number,
    size: number,
    font: PDFFont,
    color: ReturnType<typeof rgb>,
  ): void {
    const parts = pdfSafe(value)
      .split(/(\bPendiente\b)/giu)
      .filter(Boolean);
    let cursor = x;

    for (const part of parts) {
      this.page.drawText(part, {
        x: cursor,
        y,
        size,
        font,
        color,
      });
      const width = font.widthOfTextAtSize(part, size);
      if (/^Pendiente$/iu.test(part)) {
        this.page.drawLine({
          start: { x: cursor, y: y - 1.1 },
          end: { x: cursor + width, y: y - 1.1 },
          thickness: 0.55,
          color,
        });
      }
      cursor += width;
    }
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
    const size = options.size ?? 8.6;
    const font = options.bold ? this.bold : this.regular;
    const indent = options.indent ?? 0;
    const before = options.before ?? 0;
    const after = options.after ?? 3.5;
    const prefix = options.bullet ? "- " : "";
    const lines = wrap(
      `${prefix}${text}`,
      font,
      size,
      this.width - this.left - this.right - indent,
    );
    const lineHeight = size * 1.24;
    this.ensure(before + lineHeight);
    this.y -= before;
    const color = options.color ?? NAVI_DOCUMENT_PDF_COLORS.text;
    for (const line of lines) {
      this.ensure(lineHeight);
      this.drawTextWithPendingUnderline(
        line,
        this.left + indent,
        this.y,
        size,
        font,
        rgb(color[0], color[1], color[2]),
      );
      this.y -= lineHeight;
    }
    this.y -= after;
  }

  treeNode(line: ExportContentLine, kind: ExportTreeNodeKind): void {
    const indent = Math.min(line.level, 3) * 14;
    const x = this.left + indent;
    const badgeWidth = kind === "FEATURE" ? 46 : kind === "TAREA" ? 40 : 34;
    const badgeHeight = 12;
    const bodySize = kind === "EPIC" ? 9.5 : kind === "FEATURE" ? 9.1 : 8.7;
    const bodyX = x + badgeWidth + 7;
    const bodyLines = wrap(
      exportTreeNodeBody(line),
      kind === "TAREA" ? this.regular : this.bold,
      bodySize,
      this.width - this.right - bodyX,
    );
    const lineHeight = bodySize * 1.24;
    const height = Math.max(badgeHeight, bodyLines.length * lineHeight);
    const before = kind === "EPIC" ? 7 : 2;
    this.ensure(before + height + 4);
    this.y -= before;

    if (line.level > 0) {
      this.page.drawLine({
        start: { x: x - 8, y: this.y - badgeHeight / 2 },
        end: { x: x - 2, y: this.y - badgeHeight / 2 },
        thickness: 0.7,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
      });
    }

    const badgeColor: readonly [number, number, number] =
      kind === "EPIC"
        ? NAVI_DOCUMENT_PDF_COLORS.institutional
        : kind === "FEATURE"
          ? NAVI_DOCUMENT_PDF_COLORS.operation
          : NAVI_DOCUMENT_PDF_COLORS.muted;
    this.page.drawRectangle({
      x,
      y: this.y - badgeHeight,
      width: badgeWidth,
      height: badgeHeight,
      color: rgb(...badgeColor),
    });
    const labelSize = kind === "FEATURE" ? 5.7 : 6;
    const labelWidth = this.bold.widthOfTextAtSize(kind, labelSize);
    this.page.drawText(kind, {
      x: x + (badgeWidth - labelWidth) / 2,
      y: this.y - 8.4,
      size: labelSize,
      font: this.bold,
      color: rgb(...NAVI_DOCUMENT_PDF_COLORS.white),
    });
    bodyLines.forEach((bodyLine, index) => {
      this.drawTextWithPendingUnderline(
        bodyLine,
        bodyX,
        this.y - 9 - index * lineHeight,
        bodySize,
        kind === "TAREA" ? this.regular : this.bold,
        rgb(...NAVI_DOCUMENT_PDF_COLORS.text),
      );
    });
    this.y -= height + 4;
  }

  sectionHeading(
    number: number | string,
    title: string,
    kind: ExportHeadingKind,
  ): void {
    const isSubsection = kind === "subsection";
    const numberText = exportNumber(number);
    const titleText = isSubsection ? title : title.toUpperCase();
    const size = isSubsection ? 12 : 13.5;
    const before = isSubsection ? 5 : 14;
    const after = isSubsection ? 5 : 9;
    const color: readonly [number, number, number] = isSubsection
      ? NAVI_DOCUMENT_PDF_COLORS.operation
      : NAVI_DOCUMENT_PDF_COLORS.institutional;
    const heading = isSubsection
      ? `${numberText}. ${titleText}`
      : `${numberText} ${titleText}`;

    this.ensure(before + size * 1.3 + after);
    this.y -= before;
    this.page.drawText(pdfSafe(heading), {
      x: this.left,
      y: this.y - size,
      size,
      font: this.bold,
      color: rgb(...color),
    });
    this.page.drawLine({
      start: { x: this.left, y: this.y - size - 5 },
      end: { x: this.width - this.right, y: this.y - size - 5 },
      thickness: isSubsection ? 0.45 : 0.8,
      color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
    });
    this.y -= size + after + 5;
  }

  metadata(rows: readonly (readonly [string, string])[]): void {
    const width = this.width - this.left - this.right;
    const columns = 2;
    const gap = 9;
    const cellWidth = (width - gap) / columns;
    const rowHeight = 34;
    const rowCount = Math.ceil(rows.length / columns);
    this.ensure(rowCount * rowHeight + 10);

    rows.forEach(([key, value], index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = this.left + column * (cellWidth + gap);
      const top = this.y - row * rowHeight;
      const bottom = top - rowHeight + 3;

      this.page.drawRectangle({
        x,
        y: bottom,
        width: cellWidth,
        height: rowHeight - 3,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.surfaceSoft),
        borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
        borderWidth: 0.45,
      });
      this.page.drawRectangle({
        x,
        y: top - 3,
        width: cellWidth,
        height: 2,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
      });

      this.page.drawText(pdfSafe(key.toUpperCase()), {
        x: x + 7,
        y: top - 11,
        size: 6,
        font: this.bold,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.muted),
      });

      const valueLines = wrap(
        businessText(value),
        this.bold,
        7.5,
        cellWidth - 14,
      ).slice(0, 2);

      valueLines.forEach((line, lineIndex) => {
        this.drawTextWithPendingUnderline(
          line,
          x + 7,
          top - 22 - lineIndex * 8.3,
          7.5,
          this.bold,
          rgb(...NAVI_DOCUMENT_PDF_COLORS.text),
        );
      });
    });

    this.y -= rowCount * rowHeight + 5;
  }

  table(table: ExportContentTable): void {
    if (table.headers.length === 0 || table.rows.length === 0) return;
    const width = this.width - this.left - this.right;
    const weights =
      table.columnWeights?.length === table.headers.length
        ? table.columnWeights
        : table.headers.map(() => 1);
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const columnWidths = weights.map((value) => (value / totalWeight) * width);
    const fontSize = table.headers.length >= 5 ? 6.25 : 6.8;
    const lineHeight = fontSize * 1.25;
    const padding = 3.5;

    const wrapped = (row: readonly string[], bold: boolean): string[][] =>
      table.headers.map((_, index) =>
        wrap(
          row[index] ?? "Sin información",
          bold ? this.bold : this.regular,
          fontSize,
          (columnWidths[index] ?? width / table.headers.length) - padding * 2,
        ),
      );

    const headerLineCount = Math.max(
      1,
      ...wrapped(table.headers, true).map((cell) => cell.length),
    );
    const firstRowLineCount = Math.max(
      1,
      ...wrapped(table.rows[0] ?? [], false).map((cell) => cell.length),
    );
    this.ensure(
      30 +
        headerLineCount * lineHeight +
        Math.min(firstRowLineCount, 4) * lineHeight +
        padding * 4,
    );
    this.text(table.title, {
      size: 10.5,
      bold: true,
      color: NAVI_DOCUMENT_PDF_COLORS.operation,
      before: 5,
      after: 5,
    });

    const drawChunk = (
      cells: readonly (readonly string[])[],
      start: number,
      count: number,
      header: boolean,
    ): void => {
      const height = count * lineHeight + padding * 2;
      let x = this.left;
      for (let column = 0; column < cells.length; column += 1) {
        const columnWidth = columnWidths[column] ?? width / cells.length;
        this.page.drawRectangle({
          x,
          y: this.y - height,
          width: columnWidth,
          height,
          color: header
            ? rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional)
            : rgb(...NAVI_DOCUMENT_PDF_COLORS.surfaceSoft),
          borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
          borderWidth: 0.5,
        });
        let lineY = this.y - padding - fontSize;
        for (const line of cells[column]?.slice(start, start + count) ?? []) {
          this.drawTextWithPendingUnderline(
            line,
            x + padding,
            lineY,
            fontSize,
            header ? this.bold : this.regular,
            header
              ? rgb(...NAVI_DOCUMENT_PDF_COLORS.white)
              : rgb(...NAVI_DOCUMENT_PDF_COLORS.text),
          );
          lineY -= lineHeight;
        }
        x += columnWidth;
      }
      this.y -= height;
    };

    const drawHeader = (): void => {
      const cells = wrapped(table.headers, true);
      const count = Math.max(1, ...cells.map((cell) => cell.length));
      this.ensure(count * lineHeight + padding * 2);
      drawChunk(cells, 0, count, true);
    };

    drawHeader();
    for (const row of table.rows) {
      const cells = wrapped(row, false);
      const totalLines = Math.max(1, ...cells.map((cell) => cell.length));
      let start = 0;
      let freshPageAttempted = false;
      while (start < totalLines) {
        const availableLines = Math.max(
          1,
          Math.floor((this.y - 48 - padding * 2) / lineHeight),
        );
        if (
          start === 0 &&
          !freshPageAttempted &&
          totalLines > availableLines &&
          totalLines <= 70
        ) {
          this.newPage();
          drawHeader();
          freshPageAttempted = true;
          continue;
        }
        if (availableLines < 2) {
          this.newPage();
          drawHeader();
          continue;
        }
        const count = Math.min(totalLines - start, availableLines);
        drawChunk(cells, start, count, false);
        start += count;
        if (start < totalLines) {
          this.newPage();
          drawHeader();
        }
      }
    }
    this.y -= 8;
  }

  footer(): void {
    this.pages.forEach((page, index) => {
      const pageWidth = page.getWidth();
      page.drawLine({
        start: { x: this.left, y: 38 },
        end: { x: pageWidth - this.right, y: 38 },
        thickness: 0.5,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
      });
      page.drawText(
        `Documento controlado | ${this.projectCode} | Página ${index + 1} de ${this.pages.length}`,
        {
          x: this.left,
          y: 24,
          size: 8,
          font: this.regular,
          color: rgb(...NAVI_DOCUMENT_PDF_COLORS.muted),
        },
      );
    });
  }
}
