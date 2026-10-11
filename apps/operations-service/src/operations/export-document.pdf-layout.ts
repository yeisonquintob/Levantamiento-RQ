import { type ExportEpicTimeline } from "./export-work-plan";
import { rgb } from "pdf-lib";
import {
  exportTreeNodeBody,
  exportTreeNodeKind,
} from "./export-document.numbering";
import { PdfDiagramLayout } from "./export-document.pdf-layout-diagrams";
import { pdfSafe, wrap } from "./export-document.pdf-text";
import { NAVI_DOCUMENT_PDF_COLORS } from "./export-document.style";
import { exportNumber } from "./export-document.text";
import {
  type ExportContentLine,
  type ExportKpiCard,
  type ExportObjectivesLayout,
} from "./export-document.types";

export class PdfLayout extends PdfDiagramLayout {
  backlogTree(
    lines: readonly ExportContentLine[],
    sectionNumber: number | string,
  ): void {
    const ancestors: string[] = [];
    let anchors: { x: number; y: number }[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const kind = exportTreeNodeKind(line);
      if (!kind) {
        this.text(line.text, { size: 8.1, after: 5 });
        continue;
      }
      const level = Math.min(line.level, 3);
      const title = exportTreeNodeBody(line);
      const detail: string[] = [];
      while (index + 1 < lines.length && !exportTreeNodeKind(lines[index + 1]))
        detail.push(lines[++index].text);
      ancestors.length = level;
      anchors.length = level;
      const x = this.left + 12 + level * 16;
      const width = this.width - this.right - x;
      const label = kind === "EPIC" ? "ÉPICA" : kind;
      const textLines = [
        ...wrap(`${label} · ${title}`, this.bold, 8.6, width - 14).map(
          (text) => ({ text, bold: true }),
        ),
        ...detail.flatMap((value) =>
          wrap(value, this.regular, 8.1, width - 14).map((text) => ({
            text,
            bold: false,
          })),
        ),
      ];
      const lineHeight = 9.5;
      const capacity = Math.max(
        1,
        Math.floor((this.height - 190) / lineHeight),
      );
      for (let offset = 0; offset < textLines.length; offset += capacity) {
        const chunk = textLines.slice(offset, offset + capacity);
        const height = chunk.length * lineHeight + 4;
        if (
          this.y -
            height -
            (index + 1 < lines.length && lines[index + 1].level > level
              ? 24
              : 3) <
          46
        ) {
          this.newPage();
          this.text(`${exportNumber(sectionNumber)} ESQUEMA · Continuación`, {
            bold: true,
            size: 9,
            after: 5,
          });
          if (ancestors.length)
            this.text(`Rama: ${ancestors.join(" > ")}`, {
              size: 7.8,
              after: 5,
            });
          anchors = ancestors.map((_, depth) => ({
            x: this.left + 4 + depth * 16,
            y: this.y,
          }));
        }
        if (offset > 0)
          this.text(`${label} · ${title.split(" · ")[0]} (continuación)`, {
            size: 8,
            indent: level * 16,
            after: 4,
          });
        const middle = this.y - 10;
        const parent = anchors[level - 1];
        // Tipo explícito: una unión de tuplas literales no admite spread en rgb().
        const color: readonly [number, number, number] =
          kind === "EPIC"
            ? NAVI_DOCUMENT_PDF_COLORS.institutional
            : kind === "FEATURE"
              ? NAVI_DOCUMENT_PDF_COLORS.operation
              : NAVI_DOCUMENT_PDF_COLORS.muted;
        if (parent) {
          this.page.drawLine({
            start: { x: parent.x, y: parent.y },
            end: { x: parent.x, y: middle },
            thickness: 1,
            color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
          });
          this.page.drawLine({
            start: { x: parent.x, y: middle },
            end: { x, y: middle },
            thickness: 1,
            color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
          });
          parent.y = middle;
        }
        this.page.drawRectangle({
          x,
          y: this.y - height,
          width,
          height,
          color: rgb(0.975, 0.978, 0.982),
          borderWidth: 0.5,
          borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
        });
        this.page.drawRectangle({
          x,
          y: this.y - height,
          width: 3,
          height,
          color: rgb(...color),
        });
        const regularTextColor: readonly [number, number, number] =
          NAVI_DOCUMENT_PDF_COLORS.text;
        chunk.forEach((value, row) =>
          this.drawTextWithPendingUnderline(
            value.text,
            x + 7,
            this.y - 10 - row * lineHeight,
            value.bold ? 8.6 : 8.1,
            value.bold ? this.bold : this.regular,
            rgb(...(value.bold ? color : regularTextColor)),
          ),
        );
        // The branch junction sits outside the card so connectors never cross its text.
        this.page.drawLine({
          start: { x: x - 8, y: middle },
          end: { x, y: middle },
          thickness: 1,
          color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
        });
        anchors[level] = { x: x - 8, y: middle };
        this.y -= height + 2;
      }
      ancestors[level] = title.split(" · ")[0];
    }
    this.y -= 4;
  }

  epicTimeline(
    timeline: ExportEpicTimeline,
    sectionNumber: number | string,
  ): void {
    const width = this.width - this.left - this.right;
    const labelWidth = Math.min(240, width * 0.34);
    const graphX = this.left + labelWidth;
    const graphWidth = width - labelWidth;
    const span = Math.max(1, timeline.end - timeline.start + 1);
    const label = (value: number): string =>
      timeline.calendar
        ? new Intl.DateTimeFormat("es-CO", {
            day: "2-digit",
            month: "short",
            timeZone: "UTC",
          }).format(new Date(value * 86400000))
        : `Día ${value}`;
    const colors: readonly (readonly [number, number, number])[] = [
      [0.18, 0.43, 0.64],
      NAVI_DOCUMENT_PDF_COLORS.operation,
      [0.39, 0.46, 0.28],
    ];
    const header = () => {
      this.text("Programación según las tareas · Épicas", {
        before: 8,
        size: 11,
        bold: true,
        after: 7,
      });
      this.text(
        "El inicio y el cierre se calculan con las tareas asignadas; si no tienen fechas, se usa el rango del Sprint.",
        { size: 8, after: 12 },
      );
      this.page.drawRectangle({
        x: this.left,
        y: this.y - 28,
        width,
        height: 28,
        color: rgb(0.96, 0.97, 0.98),
        borderWidth: 0.5,
        borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
      });
      this.page.drawText("Elemento", {
        x: this.left + 8,
        y: this.y - 17,
        size: 8.5,
        font: this.bold,
      });
      const ticks = [
        ...new Set([
          timeline.start,
          ...[0.25, 0.5, 0.75].map((f) =>
            Math.round(timeline.start + (span - 1) * f),
          ),
          timeline.end,
        ]),
      ];
      for (const [index, tick] of ticks.entries()) {
        const text = label(tick),
          textWidth = this.bold.widthOfTextAtSize(pdfSafe(text), 7);
        const fraction = span <= 1 ? 0 : (tick - timeline.start) / (span - 1);
        const x = graphX + fraction * graphWidth;
        this.page.drawText(pdfSafe(text), {
          x:
            index === 0
              ? x + 6
              : index === ticks.length - 1
                ? x - textWidth - 6
                : x - textWidth / 2,
          y: this.y - 17,
          size: 7,
          font: this.bold,
          color: rgb(...NAVI_DOCUMENT_PDF_COLORS.muted),
        });
      }
      this.y -= 28;
    };
    header();
    for (const [index, row] of timeline.rows.entries()) {
      const titleLines = wrap(row.title, this.regular, 8.5, labelWidth - 16);
      const height = Math.max(64, 28 + titleLines.length * 11);
      if (this.y - height < 46) {
        this.newPage("landscape");
        this.text(`${exportNumber(sectionNumber)} PLAN SCRUM · Continuación`, {
          bold: true,
          size: 10,
          after: 10,
        });
        header();
      }
      this.page.drawRectangle({
        x: this.left,
        y: this.y - height,
        width,
        height,
        borderWidth: 0.5,
        borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
      });
      for (let tick = 0; tick <= 4; tick++) {
        const x = graphX + (graphWidth * tick) / 4;
        this.page.drawLine({
          start: { x, y: this.y },
          end: { x, y: this.y - height },
          thickness: 0.4,
          color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
        });
      }
      this.page.drawText(pdfSafe(row.code), {
        x: this.left + 8,
        y: this.y - 16,
        size: 8,
        font: this.bold,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.operation),
      });
      titleLines.forEach((text, n) =>
        this.page.drawText(pdfSafe(text), {
          x: this.left + 8,
          y: this.y - 30 - n * 11,
          size: 8.5,
          font: this.regular,
        }),
      );
      if (row.start !== null && row.end !== null) {
        const x = graphX + ((row.start - timeline.start) / span) * graphWidth;
        const barWidth = ((row.end - row.start + 1) / span) * graphWidth;
        const y = this.y - height / 2 - 10;
        const color = colors[index % colors.length];
        this.page.drawRectangle({
          x,
          y,
          width: barWidth,
          height: 22,
          color: rgb(...color),
        });
        const startText = pdfSafe(label(row.start)),
          endText = pdfSafe(label(row.end));
        const requiredWidth =
          this.bold.widthOfTextAtSize(startText + endText, 7) + 20;
        if (barWidth >= requiredWidth) {
          this.page.drawText(startText, {
            x: x + 5,
            y: y + 8,
            size: 7,
            font: this.bold,
            color: rgb(1, 1, 1),
          });
          this.page.drawText(endText, {
            x: x + barWidth - this.bold.widthOfTextAtSize(endText, 7) - 5,
            y: y + 8,
            size: 7,
            font: this.bold,
            color: rgb(1, 1, 1),
          });
        } else {
          const text =
            row.start === row.end ? startText : `${startText} - ${endText}`;
          const xLabel = Math.min(
            Math.max(graphX + 4, x),
            this.width - this.right - this.bold.widthOfTextAtSize(text, 7) - 4,
          );
          this.page.drawText(text, {
            x: xLabel,
            y: y + 27,
            size: 7,
            font: this.bold,
            color: rgb(...color),
          });
        }
      } else
        this.page.drawText("Sin tareas programadas", {
          x: graphX + 10,
          y: this.y - height / 2,
          size: 8,
          font: this.regular,
          color: rgb(...NAVI_DOCUMENT_PDF_COLORS.muted),
        });
      this.y -= height;
    }
    this.y -= 18;
  }

  objectives(layout: ExportObjectivesLayout): void {
    this.text("1.1. Objetivo general:", {
      size: 11,
      bold: true,
      color: NAVI_DOCUMENT_PDF_COLORS.operation,
      after: 3,
    });
    this.text(layout.general, {
      size: 9,
      color: NAVI_DOCUMENT_PDF_COLORS.text,
      after: 7,
    });
    this.text("1.1.1. Objetivos específicos:", {
      size: 10.5,
      bold: true,
      color: NAVI_DOCUMENT_PDF_COLORS.operation,
      after: 5,
    });

    const gap = 10;
    const totalWidth = this.width - this.left - this.right;
    const columnWidth = (totalWidth - gap) / 2;
    const padding = 8;
    const headerSize = 8.25;
    const bodySize = 7.5;
    const bodyLineHeight = 8.6;

    const prepared = (
      title: string,
      values: readonly string[],
    ): {
      title: string;
      items: readonly (readonly string[])[];
      height: number;
    } => {
      const items = values.map((value, index) =>
        wrap(
          `${index + 1}. ${value}`,
          this.regular,
          bodySize,
          columnWidth - padding * 2,
        ),
      );

      const bodyHeight = items.reduce(
        (sum, lines) => sum + Math.max(1, lines.length) * bodyLineHeight + 3,
        0,
      );

      return {
        title,
        items,
        height: 24 + bodyHeight + padding,
      };
    };

    const columns = [
      prepared("Cualitativos", layout.qualitative),
      prepared("Cuantitativos", layout.quantitative),
    ] as const;
    const cardHeight = Math.max(...columns.map((column) => column.height));

    this.ensure(cardHeight + 8);

    columns.forEach((column, columnIndex) => {
      const x = this.left + columnIndex * (columnWidth + gap);
      const bottom = this.y - cardHeight;

      this.page.drawRectangle({
        x,
        y: bottom,
        width: columnWidth,
        height: cardHeight,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.surfaceSoft),
        borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
        borderWidth: 0.55,
      });

      this.page.drawRectangle({
        x,
        y: this.y - 3,
        width: columnWidth,
        height: 3,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
      });

      this.page.drawText(column.title, {
        x: x + padding,
        y: this.y - 16,
        size: headerSize,
        font: this.bold,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
      });

      let cursorY = this.y - 30;

      for (const lines of column.items) {
        for (const line of lines) {
          this.drawTextWithPendingUnderline(
            line,
            x + padding,
            cursorY,
            bodySize,
            this.regular,
            rgb(...NAVI_DOCUMENT_PDF_COLORS.text),
          );
          cursorY -= bodyLineHeight;
        }
        cursorY -= 3;
      }
    });

    this.y -= cardHeight + 7;
  }

  kpiCards(cards: readonly ExportKpiCard[], sectionNumber: number): void {
    if (cards.length === 0) return;

    this.text(`${exportNumber(sectionNumber)}.4. KPIs de estado:`, {
      size: 10.5,
      bold: true,
      color: NAVI_DOCUMENT_PDF_COLORS.operation,
      after: 5,
    });

    const gap = 8;
    const totalWidth = this.width - this.left - this.right;
    const cardWidth =
      (totalWidth - gap * Math.max(0, cards.length - 1)) / cards.length;
    const padding = 7;
    const nameSize = 7.5;
    const bodySize = 6.8;
    const lineHeight = 7.8;

    const prepared = cards.map((card) => {
      const nameLines = wrap(
        card.name,
        this.bold,
        nameSize,
        cardWidth - padding * 2,
      ).slice(0, 3);
      const rows = [
        ["Cálculo", card.measurement],
        ["Meta", card.target],
      ] as const;

      const rowLines = rows.map(([labelText, value]) => ({
        label: labelText,
        lines: wrap(
          value,
          this.regular,
          bodySize,
          cardWidth - padding * 2,
        ).slice(0, 5),
      }));

      const height =
        padding +
        Math.max(1, nameLines.length) * 8.4 +
        25 +
        rowLines.reduce(
          (sum, row) =>
            sum + 8 + Math.max(1, row.lines.length) * lineHeight + 2,
          0,
        ) +
        padding;

      return {
        card,
        nameLines,
        rowLines,
        height,
      };
    });

    const cardHeight = Math.max(...prepared.map((item) => item.height));
    this.ensure(cardHeight + 8);

    prepared.forEach((item, index) => {
      const x = this.left + index * (cardWidth + gap);
      const bottom = this.y - cardHeight;

      this.page.drawRectangle({
        x,
        y: bottom,
        width: cardWidth,
        height: cardHeight,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.surfaceSoft),
        borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
        borderWidth: 0.55,
      });

      this.page.drawRectangle({
        x,
        y: this.y - 3,
        width: cardWidth,
        height: 3,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
      });

      let cursorY = this.y - 15;

      for (const line of item.nameLines) {
        this.page.drawText(pdfSafe(line), {
          x: x + padding,
          y: cursorY,
          size: nameSize,
          font: this.bold,
          color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
        });
        cursorY -= 8.4;
      }

      cursorY -= 4;

      const chartX = x + padding;
      const chartWidth = cardWidth - padding * 2;
      this.page.drawRectangle({
        x: chartX,
        y: cursorY - 4,
        width: chartWidth,
        height: 5,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.surfaceSoft),
        borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
        borderWidth: 0.45,
      });
      this.page.drawCircle({
        x: chartX + 2.5,
        y: cursorY - 1.5,
        size: 3.2,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
      });
      this.page.drawText("0%", {
        x: chartX,
        y: cursorY - 13,
        size: 6.3,
        font: this.bold,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.muted),
      });
      this.page.drawText(`Meta ${pdfSafe(item.card.target)}`, {
        x: chartX + chartWidth - 34,
        y: cursorY - 13,
        size: 6.3,
        font: this.bold,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
      });
      cursorY -= 20;

      for (const row of item.rowLines) {
        this.page.drawText(`${row.label}:`, {
          x: x + padding,
          y: cursorY,
          size: bodySize,
          font: this.bold,
          color: rgb(...NAVI_DOCUMENT_PDF_COLORS.muted),
        });
        cursorY -= 8;

        for (const line of row.lines) {
          this.drawTextWithPendingUnderline(
            line,
            x + padding,
            cursorY,
            bodySize,
            this.regular,
            rgb(...NAVI_DOCUMENT_PDF_COLORS.text),
          );
          cursorY -= lineHeight;
        }

        cursorY -= 2;
      }
    });

    this.y -= cardHeight + 7;
  }
}
