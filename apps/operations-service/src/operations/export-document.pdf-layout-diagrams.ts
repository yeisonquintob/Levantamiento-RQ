import { rgb } from "pdf-lib";
import { type ProcessFlowLayoutResult } from "@levantamiento-rq/shared-contracts";
import { PdfLayoutBase } from "./export-document.pdf-layout-base";
import { pdfSafe, wrap } from "./export-document.pdf-text";
import {
  type ExportEntityRelationshipDiagram,
  type ExportFlowDiagram,
} from "./export-document.types";

export class PdfDiagramLayout extends PdfLayoutBase {
  protected flowDepths(diagram: ExportFlowDiagram): Map<string, number> {
    const ids = diagram.nodes.map((node) => node.id);
    const indegree = new Map(ids.map((id) => [id, 0]));
    const outgoing = new Map<string, string[]>();
    for (const edge of diagram.edges) {
      if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    }
    const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
    const depths = new Map(ids.map((id) => [id, 0]));
    const visited = new Set<string>();
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) break;
      visited.add(id);
      for (const to of outgoing.get(id) ?? []) {
        depths.set(
          to,
          Math.max(depths.get(to) ?? 0, (depths.get(id) ?? 0) + 1),
        );
        indegree.set(to, (indegree.get(to) ?? 1) - 1);
        if (indegree.get(to) === 0) queue.push(to);
      }
    }
    ids.forEach((id, index) => {
      if (!visited.has(id))
        depths.set(id, Math.max(depths.get(id) ?? 0, index));
    });
    return depths;
  }

  protected swimlaneFlowDiagram(diagram: ExportFlowDiagram): void {
    const lanes = diagram.lanes ?? [];
    if (lanes.length === 0) return;
    this.newPage("landscape");
    this.text(diagram.title, {
      size: 12,
      bold: true,
      color: [0.19, 0.25, 0.29],
      after: 4,
    });
    if (diagram.objective) {
      this.text(`Objetivo: ${diagram.objective}`, {
        size: 7.6,
        color: [0.33, 0.39, 0.42],
        after: 7,
      });
    }
    const contentWidth = this.width - this.left - this.right;
    const labelWidth = 104;
    const availableHeight = Math.max(250, this.y - 48);
    const laneHeight = Math.max(
      34,
      Math.min(58, availableHeight / Math.max(1, lanes.length)),
    );
    const totalHeight = laneHeight * lanes.length;
    const top = this.y;
    const depths = this.flowDepths(diagram);
    const maximumDepth = Math.max(0, ...depths.values());
    const stageCount = maximumDepth + 1;
    const diagramWidth = contentWidth - labelWidth;
    const stageWidth = diagramWidth / Math.max(1, stageCount);
    const nodeWidth = Math.max(52, Math.min(92, stageWidth - 14));
    const nodeHeight = Math.max(24, Math.min(36, laneHeight - 12));
    const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
    const positions = new Map<
      string,
      { x: number; y: number; width: number; height: number }
    >();
    diagram.nodes.forEach((node) => {
      const lane = laneIndex.get(node.laneId ?? "") ?? 0;
      const depth = depths.get(node.id) ?? 0;
      positions.set(node.id, {
        x:
          this.left +
          labelWidth +
          depth * stageWidth +
          (stageWidth - nodeWidth) / 2,
        y: top - (lane + 0.5) * laneHeight - nodeHeight / 2,
        width: nodeWidth,
        height: nodeHeight,
      });
    });
    const laneColors = [
      [0.18, 0.39, 0.55],
      [0.34, 0.29, 0.43],
      [0.63, 0.39, 0.16],
      [0.31, 0.42, 0.27],
      [0.27, 0.36, 0.41],
      [0.71, 0.15, 0.18],
    ] as const;
    lanes.forEach((lane, index) => {
      const y = top - (index + 1) * laneHeight;
      const laneColor = laneColors[index % laneColors.length] ?? laneColors[0];
      this.page.drawRectangle({
        x: this.left,
        y,
        width: contentWidth,
        height: laneHeight,
        color:
          lane.kind === "SYSTEM"
            ? rgb(0.96, 0.965, 0.97)
            : rgb(0.965, 0.975, 0.98),
        borderColor: rgb(0.76, 0.79, 0.8),
        borderWidth: 0.45,
      });
      this.page.drawRectangle({
        x: this.left,
        y,
        width: labelWidth,
        height: laneHeight,
        color: rgb(laneColor[0], laneColor[1], laneColor[2]),
      });
      const nameLines = wrap(lane.name, this.bold, 6.2, labelWidth - 12).slice(
        0,
        3,
      );
      const lineHeight = 7.2;
      const nameTop = y + laneHeight / 2 + (nameLines.length * lineHeight) / 2;
      nameLines.forEach((line, lineIndex) => {
        this.page.drawText(line, {
          x:
            this.left +
            (labelWidth - this.bold.widthOfTextAtSize(line, 6.2)) / 2,
          y: nameTop - (lineIndex + 1) * lineHeight + 4,
          size: 6.2,
          font: this.bold,
          color: rgb(1, 1, 1),
        });
      });
      this.page.drawText(lane.kind === "SYSTEM" ? "Sistema" : "Actor", {
        x: this.left + 6,
        y: y + 5,
        size: 4.8,
        font: this.regular,
        color: rgb(1, 1, 1),
      });
    });
    const edgeColor = rgb(0.22, 0.32, 0.38);
    for (const edge of diagram.edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const start = { x: from.x + from.width, y: from.y + from.height / 2 };
      const end = { x: to.x, y: to.y + to.height / 2 };
      const middle =
        end.x > start.x ? (start.x + end.x) / 2 : Math.max(start.x, end.x) + 10;
      const points = [
        start,
        { x: middle, y: start.y },
        { x: middle, y: end.y },
        end,
      ];
      for (let index = 0; index < points.length - 1; index += 1) {
        const segmentStart = points[index];
        const segmentEnd = points[index + 1];
        if (!segmentStart || !segmentEnd) {
          continue;
        }
        this.page.drawLine({
          start: segmentStart,
          end: segmentEnd,
          thickness: 0.7,
          color: edgeColor,
        });
      }
      this.page.drawLine({
        start: end,
        end: { x: end.x - 4, y: end.y + 2.5 },
        thickness: 0.7,
        color: edgeColor,
      });
      this.page.drawLine({
        start: end,
        end: { x: end.x - 4, y: end.y - 2.5 },
        thickness: 0.7,
        color: edgeColor,
      });
      if (edge.label) {
        const value = pdfSafe(edge.label).slice(0, 30);
        const width = Math.min(
          96,
          this.regular.widthOfTextAtSize(value, 4.7) + 7,
        );
        const x = middle - width / 2;
        const y = (start.y + end.y) / 2 - 4;
        this.page.drawRectangle({
          x,
          y,
          width,
          height: 9,
          color: rgb(1, 1, 1),
        });
        this.page.drawText(value, {
          x: x + 3.5,
          y: y + 2.5,
          size: 4.7,
          font: this.regular,
          color: edgeColor,
        });
      }
    }
    for (const node of diagram.nodes) {
      const position = positions.get(node.id);
      if (!position) continue;
      const fill =
        node.kind === "START" || node.kind === "END"
          ? rgb(0.91, 0.95, 0.9)
          : node.kind === "DECISION"
            ? rgb(0.99, 0.95, 0.84)
            : node.kind === "SYSTEM"
              ? rgb(0.94, 0.92, 0.96)
              : rgb(0.985, 0.988, 0.99);
      const border =
        node.kind === "DECISION"
          ? rgb(0.78, 0.43, 0.08)
          : node.kind === "START" || node.kind === "END"
            ? rgb(0.35, 0.49, 0.27)
            : rgb(0.27, 0.39, 0.47);
      this.page.drawRectangle({
        ...position,
        color: fill,
        borderColor: border,
        borderWidth: 0.85,
      });
      const lines = wrap(node.label, this.bold, 5.5, position.width - 8).slice(
        0,
        3,
      );
      const lineHeight = 6.3;
      lines.forEach((line, index) => {
        this.page.drawText(line, {
          x:
            position.x +
            (position.width - this.bold.widthOfTextAtSize(line, 5.5)) / 2,
          y:
            position.y +
            position.height / 2 +
            ((lines.length - 1) * lineHeight) / 2 -
            index * lineHeight -
            2,
          size: 5.5,
          font: this.bold,
          color: rgb(0.15, 0.19, 0.22),
        });
      });
    }
    this.y = top - totalHeight;
    this.newPage();
  }

  entityRelationshipDiagram(
    diagram: ExportEntityRelationshipDiagram,
    alreadyOnLandscapePage = false,
  ): void {
    if (diagram.entities.length === 0) return;
    if (!alreadyOnLandscapePage) this.newPage("landscape");
    this.text(diagram.title, {
      size: 12,
      bold: true,
      color: [0.19, 0.25, 0.29],
      before: alreadyOnLandscapePage ? 14 : 0,
      after: 8,
    });
    const columns = Math.min(
      3,
      Math.max(1, Math.ceil(Math.sqrt(diagram.entities.length))),
    );
    const rows = Math.ceil(diagram.entities.length / columns);
    const gapX = 34;
    const gapY = 44;
    const contentWidth = this.width - this.left - this.right;
    const availableHeight = this.y - 50;
    const boxWidth = (contentWidth - gapX * (columns - 1)) / columns;
    // AI_EXPORT_ER_FIT_BOX_HEIGHT_V1
    // Cada fila de entidades mide lo que necesitan sus atributos (encabezado 27
    // + 15 por atributo) en lugar de una altura fija de 180 con espacio vacío.
    const maximumBoxHeight = Math.min(
      180,
      (availableHeight - gapY * (rows - 1)) / rows,
    );
    const rowHeights = Array.from({ length: rows }, (_, row) => {
      const attributeCount = Math.max(
        1,
        ...diagram.entities
          .slice(row * columns, (row + 1) * columns)
          .map((entity) => entity.attributes.length),
      );
      return Math.min(maximumBoxHeight, 38 + attributeCount * 15 + 6);
    });
    const top = this.y;
    const positions = new Map<
      string,
      { x: number; y: number; width: number; height: number }
    >();
    diagram.entities.forEach((entity, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const rowHeight = rowHeights[row];
      if (rowHeight === undefined) {
        throw new Error(
          "Invariante: cada fila del diagrama tiene altura calculada.",
        );
      }
      const offset = rowHeights
        .slice(0, row)
        .reduce((sum, height) => sum + height + gapY, 0);
      positions.set(entity.id, {
        x: this.left + column * (boxWidth + gapX),
        y: top - offset - rowHeight,
        width: boxWidth,
        height: rowHeight,
      });
    });
    for (const relationship of diagram.relationships) {
      const from = positions.get(relationship.from);
      const to = positions.get(relationship.to);
      if (!from || !to) continue;
      const fromCenter = {
        x: from.x + from.width / 2,
        y: from.y + from.height / 2,
      };
      const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
      const horizontal =
        Math.abs(toCenter.x - fromCenter.x) >=
        Math.abs(toCenter.y - fromCenter.y);
      const start = horizontal
        ? {
            x: toCenter.x >= fromCenter.x ? from.x + from.width : from.x,
            y: fromCenter.y,
          }
        : {
            x: fromCenter.x,
            y: toCenter.y >= fromCenter.y ? from.y + from.height : from.y,
          };
      const end = horizontal
        ? {
            x: toCenter.x >= fromCenter.x ? to.x : to.x + to.width,
            y: toCenter.y,
          }
        : {
            x: toCenter.x,
            y: toCenter.y >= fromCenter.y ? to.y : to.y + to.height,
          };
      this.page.drawLine({
        start,
        end,
        thickness: 0.8,
        color: rgb(0.33, 0.42, 0.47),
      });
      // El texto largo se recorta en una palabra completa, no a mitad de palabra.
      const labelText = pdfSafe(relationship.label);
      const relationLabel =
        labelText.length > 26
          ? `${labelText.slice(0, 26).replace(/\s+\S*$/u, "")}...`
          : labelText;
      const relation = pdfSafe(
        `${relationship.cardinality} · ${relationLabel}`,
      );
      const width = this.bold.widthOfTextAtSize(relation, 5.8) + 8;
      const x = (start.x + end.x - width) / 2;
      const y = (start.y + end.y) / 2 - 4;
      this.page.drawRectangle({ x, y, width, height: 10, color: rgb(1, 1, 1) });
      this.page.drawText(relation, {
        x: x + 4,
        y: y + 2.7,
        size: 5.8,
        font: this.bold,
        color: rgb(0.31, 0.26, 0.38),
      });
    }
    for (const entity of diagram.entities) {
      const position = positions.get(entity.id);
      if (!position) continue;
      this.page.drawRectangle({
        ...position,
        color: rgb(1, 1, 1),
        borderColor: rgb(0.42, 0.35, 0.49),
        borderWidth: 0.9,
      });
      this.page.drawRectangle({
        x: position.x,
        y: position.y + position.height - 27,
        width: position.width,
        height: 27,
        color: rgb(0.94, 0.92, 0.96),
        borderColor: rgb(0.42, 0.35, 0.49),
        borderWidth: 0.9,
      });
      const title =
        wrap(entity.name, this.bold, 9, position.width - 14)[0] ?? entity.name;
      this.page.drawText(title, {
        x: position.x + 7,
        y: position.y + position.height - 18,
        size: 9,
        font: this.bold,
        color: rgb(0.19, 0.18, 0.22),
      });
      const maxAttributes = Math.max(
        1,
        Math.floor((position.height - 35) / 15),
      );
      entity.attributes.slice(0, maxAttributes).forEach((attribute, index) => {
        const key = [
          attribute.primaryKey ? "PK" : "",
          attribute.foreignKey ? "FK" : "",
        ]
          .filter(Boolean)
          .join("/");
        const prefix = key ? `${key} · ` : attribute.required ? "* " : "";
        const name = `${prefix}${attribute.name}`;
        const type = attribute.dataType;
        const y = position.y + position.height - 43 - index * 15;
        this.page.drawText(pdfSafe(name).slice(0, 31), {
          x: position.x + 8,
          y,
          size: 6.7,
          font:
            attribute.primaryKey || attribute.foreignKey
              ? this.bold
              : this.regular,
          color: rgb(0.24, 0.2, 0.29),
        });
        this.page.drawText(pdfSafe(type).slice(0, 17), {
          x:
            position.x +
            position.width -
            8 -
            this.regular.widthOfTextAtSize(pdfSafe(type).slice(0, 17), 6.2),
          y,
          size: 6.2,
          font: this.regular,
          color: rgb(0.38, 0.44, 0.47),
        });
      });
    }
    this.newPage();
  }

  protected elkFlowDiagram(
    diagram: ExportFlowDiagram,
    flowLayout: ProcessFlowLayoutResult,
  ): void {
    this.newPage("landscape");
    this.text(diagram.title, {
      size: 12,
      bold: true,
      color: [0.19, 0.25, 0.29],
      after: 4,
    });
    if (diagram.objective) {
      this.text(`Objetivo: ${diagram.objective}`, {
        size: 7.6,
        color: [0.33, 0.39, 0.42],
        after: 7,
      });
    }

    const contentWidth = this.width - this.left - this.right;
    const availableHeight = Math.max(260, this.y - 52);
    const scale = Math.min(
      1,
      contentWidth / Math.max(flowLayout.width, 1),
      availableHeight / Math.max(flowLayout.height, 1),
    );
    const renderedWidth = flowLayout.width * scale;
    const originX = this.left + (contentWidth - renderedWidth) / 2;
    const originY = this.y;

    const point = (x: number, y: number) => ({
      x: originX + x * scale,
      y: originY - y * scale,
    });

    for (const edge of flowLayout.edges) {
      const color =
        edge.kind === "return" ? rgb(0.76, 0.48, 0.08) : rgb(0.31, 0.4, 0.46);
      const commands = [
        ...edge.path.matchAll(
          /([ML])\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/gu,
        ),
      ];
      let previous: { x: number; y: number } | null = null;
      let finalSegment: {
        start: { x: number; y: number };
        end: { x: number; y: number };
      } | null = null;
      for (const command of commands) {
        const current = point(Number(command[2]), Number(command[3]));
        if (command[1] === "L" && previous) {
          this.page.drawLine({
            start: previous,
            end: current,
            thickness: 0.85,
            color,
            dashArray: edge.kind === "return" ? [4, 3] : undefined,
          });
          finalSegment = { start: previous, end: current };
        }
        previous = current;
      }
      if (finalSegment) {
        const angle = Math.atan2(
          finalSegment.end.y - finalSegment.start.y,
          finalSegment.end.x - finalSegment.start.x,
        );
        for (const delta of [Math.PI * 0.78, -Math.PI * 0.78]) {
          this.page.drawLine({
            start: finalSegment.end,
            end: {
              x: finalSegment.end.x + Math.cos(angle + delta) * 4,
              y: finalSegment.end.y + Math.sin(angle + delta) * 4,
            },
            thickness: 0.85,
            color,
          });
        }
      }
      if (edge.label) {
        const label = pdfSafe(edge.label).slice(0, 34);
        const size = Math.max(5.4, Math.min(7, 6.2 * Math.sqrt(scale)));
        const labelWidth = this.regular.widthOfTextAtSize(label, size) + 7;
        const labelPoint = point(edge.labelX, edge.labelY);
        this.page.drawRectangle({
          x: labelPoint.x - labelWidth / 2,
          y: labelPoint.y - 4,
          width: labelWidth,
          height: 10,
          color: rgb(1, 1, 1),
          borderColor: color,
          borderWidth: 0.35,
        });
        this.page.drawText(label, {
          x: labelPoint.x - labelWidth / 2 + 3.5,
          y: labelPoint.y - 1,
          size,
          font: this.bold,
          color,
        });
      }
    }

    for (const node of flowLayout.nodes) {
      const position = {
        x: originX + node.x * scale,
        y: originY - (node.y + node.height) * scale,
        width: node.width * scale,
        height: node.height * scale,
      };
      const fill =
        node.kind === "START" || node.kind === "END"
          ? rgb(0.91, 0.95, 0.9)
          : node.kind === "DECISION"
            ? rgb(0.99, 0.95, 0.84)
            : node.kind === "SYSTEM"
              ? rgb(0.94, 0.92, 0.96)
              : node.kind === "ACTOR"
                ? rgb(0.91, 0.95, 0.98)
                : rgb(0.975, 0.978, 0.98);
      const border =
        node.kind === "DECISION"
          ? rgb(0.76, 0.48, 0.08)
          : node.kind === "START" || node.kind === "END"
            ? rgb(0.35, 0.49, 0.27)
            : node.kind === "SYSTEM"
              ? rgb(0.4, 0.33, 0.47)
              : rgb(0.31, 0.4, 0.46);
      this.page.drawRectangle({
        ...position,
        color: fill,
        borderColor: border,
        borderWidth: 0.8,
      });
      const fontSize = Math.max(5.2, Math.min(7.2, 7 * Math.sqrt(scale)));
      const lines = wrap(
        node.label,
        this.bold,
        fontSize,
        Math.max(24, position.width - 10),
      ).slice(0, 3);
      const lineHeight = fontSize * 1.18;
      const textHeight = lines.length * lineHeight;
      lines.forEach((line, lineIndex) => {
        this.page.drawText(line, {
          x:
            position.x +
            (position.width - this.bold.widthOfTextAtSize(line, fontSize)) / 2,
          y:
            position.y +
            (position.height + textHeight) / 2 -
            (lineIndex + 1) * lineHeight +
            1,
          size: fontSize,
          font: this.bold,
          color: rgb(0.15, 0.19, 0.22),
        });
      });
    }

    this.y = 44;
    this.newPage();
  }

  flowDiagram(
    diagram: ExportFlowDiagram,
    flowLayout: ProcessFlowLayoutResult | null = null,
  ): void {
    if (diagram.nodes.length === 0 || diagram.edges.length === 0) return;
    if ((diagram.lanes?.length ?? 0) > 0) {
      this.swimlaneFlowDiagram(diagram);
      return;
    }
    if (flowLayout) {
      this.elkFlowDiagram(diagram, flowLayout);
      return;
    }
    this.text(diagram.title, {
      size: 9.5,
      bold: true,
      color: [0.19, 0.25, 0.29],
      before: 2,
      after: 6,
    });
    const columns = Math.min(3, Math.max(1, diagram.nodes.length));
    const gapX = 20;
    const gapY = 26;
    const contentWidth = this.width - this.left - this.right;
    const boxWidth = (contentWidth - gapX * (columns - 1)) / columns;
    const boxHeight = 39;
    const rows = Math.ceil(diagram.nodes.length / columns);
    const totalHeight = rows * boxHeight + (rows - 1) * gapY + 8;
    if (this.y - totalHeight < 48) this.newPage();
    const top = this.y;
    const positions = new Map<
      string,
      { x: number; y: number; width: number; height: number }
    >();
    diagram.nodes.forEach((node, index) => {
      const row = Math.floor(index / columns);
      const offset = index % columns;
      const column = row % 2 === 0 ? offset : columns - 1 - offset;
      positions.set(node.id, {
        x: this.left + column * (boxWidth + gapX),
        y: top - row * (boxHeight + gapY) - boxHeight,
        width: boxWidth,
        height: boxHeight,
      });
    });
    const lineColor = rgb(0.38, 0.43, 0.46);
    for (const edge of diagram.edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const start = { x: from.x + from.width / 2, y: from.y };
      const end = { x: to.x + to.width / 2, y: to.y + to.height };
      if (Math.abs(start.y - end.y) < 4) {
        start.x = from.x < to.x ? from.x + from.width : from.x;
        start.y = from.y + from.height / 2;
        end.x = from.x < to.x ? to.x : to.x + to.width;
        end.y = to.y + to.height / 2;
      }
      this.page.drawLine({ start, end, thickness: 0.8, color: lineColor });
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const arrow = 4;
      for (const delta of [Math.PI * 0.78, -Math.PI * 0.78]) {
        this.page.drawLine({
          start: end,
          end: {
            x: end.x + Math.cos(angle + delta) * arrow,
            y: end.y + Math.sin(angle + delta) * arrow,
          },
          thickness: 0.8,
          color: lineColor,
        });
      }
      if (edge.label) {
        const edgeText = pdfSafe(edge.label).slice(0, 34);
        const edgeWidth = this.regular.widthOfTextAtSize(edgeText, 5.8) + 5;
        const x = (start.x + end.x) / 2 - edgeWidth / 2;
        const y = (start.y + end.y) / 2 - 2;
        this.page.drawRectangle({
          x,
          y: y - 2,
          width: edgeWidth,
          height: 9,
          color: rgb(1, 1, 1),
        });
        this.page.drawText(edgeText, {
          x: x + 2.5,
          y,
          size: 5.8,
          font: this.regular,
          color: lineColor,
        });
      }
    }
    for (const node of diagram.nodes) {
      const position = positions.get(node.id);
      if (!position) continue;
      const fill =
        node.kind === "START" || node.kind === "END"
          ? rgb(0.91, 0.95, 0.9)
          : node.kind === "DECISION"
            ? rgb(0.99, 0.95, 0.84)
            : node.kind === "SYSTEM"
              ? rgb(0.91, 0.94, 0.96)
              : rgb(0.975, 0.978, 0.98);
      const border =
        node.kind === "DECISION"
          ? rgb(0.76, 0.48, 0.08)
          : node.kind === "START" || node.kind === "END"
            ? rgb(0.35, 0.49, 0.27)
            : rgb(0.39, 0.46, 0.49);
      this.page.drawRectangle({
        ...position,
        color: fill,
        borderColor: border,
        borderWidth: 0.8,
      });
      const lines = wrap(node.label, this.bold, 7, position.width - 12).slice(
        0,
        3,
      );
      const lineHeight = 8.2;
      const textHeight = lines.length * lineHeight;
      lines.forEach((line, lineIndex) => {
        this.page.drawText(line, {
          x:
            position.x +
            (position.width - this.bold.widthOfTextAtSize(line, 7)) / 2,
          y:
            position.y +
            (position.height + textHeight) / 2 -
            (lineIndex + 1) * lineHeight +
            2,
          size: 7,
          font: this.bold,
          color: rgb(0.15, 0.19, 0.22),
        });
      });
    }
    this.y -= totalHeight;
  }
}
