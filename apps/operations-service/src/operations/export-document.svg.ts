import {
  layoutProcessFlow,
  type ProcessFlowLayoutResult,
} from "@levantamiento-rq/shared-contracts";
import {
  type ExportEntityRelationshipDiagram,
  type ExportFlowDiagram,
  type ExportFlowNode,
} from "./export-document.types";

function exportXmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function erSvgText(value: string, maximumCharacters: number): string {
  const normalized = value.trim();

  if (normalized.length <= maximumCharacters) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maximumCharacters - 1))}…`;
}

function svgTextLines(
  value: string,
  maximumCharacters: number,
  maximumLines: number,
): readonly string[] {
  const words = value.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > maximumCharacters) {
      if (lines.length >= maximumLines) {
        const last = lines.at(-1) ?? "";
        lines[lines.length - 1] =
          `${last.slice(0, Math.max(1, maximumCharacters - 1))}…`;
        break;
      }
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }
  return lines.length > 0 ? lines : [value.trim()];
}

function flowDiagramDepths(diagram: ExportFlowDiagram): Map<string, number> {
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
      depths.set(to, Math.max(depths.get(to) ?? 0, (depths.get(id) ?? 0) + 1));
      indegree.set(to, (indegree.get(to) ?? 1) - 1);
      if (indegree.get(to) === 0) queue.push(to);
    }
  }
  ids.forEach((id, index) => {
    if (!visited.has(id)) depths.set(id, Math.max(depths.get(id) ?? 0, index));
  });
  return depths;
}

export function renderSwimlaneFlowSvg(diagram: ExportFlowDiagram): {
  svg: string;
  width: number;
  height: number;
} {
  const lanes =
    diagram.lanes && diagram.lanes.length > 0
      ? diagram.lanes
      : [{ id: "flow", name: "Flujo del proceso", kind: "ACTOR" as const }];
  const laneHeight = 112;
  const laneLabelWidth = 190;
  const nodeWidth = 184;
  const nodeHeight = 82;
  const stageWidth = 224;
  const padding = 30;
  const depths = flowDiagramDepths(diagram);
  const laneIndexById = new Map(lanes.map((lane, index) => [lane.id, index]));
  const positions = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  let maximumDepth = 0;
  for (const node of diagram.nodes) {
    const depth = depths.get(node.id) ?? 0;
    maximumDepth = Math.max(maximumDepth, depth);
    const laneIndex = laneIndexById.get(node.laneId ?? "") ?? 0;
    positions.set(node.id, {
      x: laneLabelWidth + padding + nodeWidth / 2 + depth * stageWidth,
      y: laneIndex * laneHeight + laneHeight / 2,
      width: nodeWidth,
      height: node.kind === "DECISION" ? 90 : nodeHeight,
    });
  }
  const width = Math.max(
    760,
    laneLabelWidth + padding * 2 + nodeWidth + maximumDepth * stageWidth,
  );
  const height = Math.max(260, lanes.length * laneHeight);
  const markerId = "rq-docx-swimlane-arrow";
  const laneColors = ["#356f98", "#566c7e", "#927649", "#527779", "#3e5d72"];
  const kindLabels: Readonly<Record<ExportFlowNode["kind"], string>> = {
    START: "Inicio",
    ACTOR: "Actor",
    PROCESS: "Proceso",
    DECISION: "Decisión",
    SYSTEM: "Sistema",
    END: "Fin",
  };
  const nodeColors: Readonly<
    Record<ExportFlowNode["kind"], { fill: string; stroke: string }>
  > = {
    START: { fill: "#eef4eb", stroke: "#66784c" },
    ACTOR: { fill: "#f1f6fa", stroke: "#2f6fa3" },
    PROCESS: { fill: "#ffffff", stroke: "#4f6675" },
    DECISION: { fill: "#fff7e8", stroke: "#c97828" },
    SYSTEM: { fill: "#f4f1f7", stroke: "#675579" },
    END: { fill: "#eef4eb", stroke: "#66784c" },
  };
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${exportXmlEscape(diagram.title)}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${exportXmlEscape(diagram.title)}</title>`,
    `<defs><marker id="${markerId}" markerWidth="12" markerHeight="12" refX="10.5" refY="6" orient="auto" markerUnits="userSpaceOnUse" viewBox="0 0 12 12"><path d="M 0 0 L 12 6 L 0 12 L 3 6 z" fill="#415d6b"/></marker></defs>`,
  ];
  lanes.forEach((lane, index) => {
    const y = index * laneHeight;
    const center = y + laneHeight / 2;
    const lines = svgTextLines(lane.name, 23, 3);
    const startY = center - (lines.length - 1) * 7 - 8;
    const laneColor = laneColors[index % laneColors.length] ?? laneColors[0];
    parts.push(
      `<rect x="0" y="${y}" width="${width}" height="${laneHeight}" fill="${lane.kind === "SYSTEM" ? "#f5f3ef" : "#edf3f6"}" stroke="#c3cac8" stroke-width="1"/>`,
      `<rect x="0" y="${y}" width="${laneLabelWidth}" height="${laneHeight}" fill="${laneColor}"/>`,
      `<text x="${laneLabelWidth / 2}" y="${startY}" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#ffffff">${lines.map((line, lineIndex) => `<tspan x="${laneLabelWidth / 2}" y="${startY + lineIndex * 14}">${exportXmlEscape(line)}</tspan>`).join("")}</text>`,
      `<text x="${laneLabelWidth / 2}" y="${center + 27}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" font-weight="600" fill="#eaf0f3">${lane.kind === "SYSTEM" ? "Sistema" : "Actor"}</text>`,
    );
  });
  for (const edge of diagram.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.x + from.width / 2;
    const y1 = from.y;
    const x2 = to.x - to.width / 2;
    const y2 = to.y;
    const middle = x2 > x1 ? (x1 + x2) / 2 : Math.max(x1, x2) + 45;
    parts.push(
      `<path d="M ${x1} ${y1} L ${middle} ${y1} L ${middle} ${y2} L ${x2} ${y2}" fill="none" stroke="#415d6b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${markerId})"/>`,
    );
    if (edge.label) {
      const label =
        edge.label.length > 26 ? `${edge.label.slice(0, 25)}…` : edge.label;
      const labelWidth = Math.min(170, Math.max(48, label.length * 6 + 18));
      parts.push(
        `<g transform="translate(${middle} ${(y1 + y2) / 2})"><rect x="${-labelWidth / 2}" y="-11" width="${labelWidth}" height="22" rx="11" fill="#ffffff" stroke="#d6dcda"/><text y="1" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="9" font-weight="700" fill="#415d6b">${exportXmlEscape(label)}</text></g>`,
      );
    }
  }
  for (const node of diagram.nodes) {
    const position = positions.get(node.id);
    if (!position) continue;
    const colors = nodeColors[node.kind];
    const lines = svgTextLines(node.label, 28, 4);
    const labelStartY = 9 - (lines.length - 1) * 7;
    const transform = `translate(${position.x} ${position.y})`;
    parts.push(`<g transform="${transform}">`);
    if (node.kind === "DECISION") {
      parts.push(
        `<polygon points="0,${-position.height / 2} ${position.width / 2},0 0,${position.height / 2} ${-position.width / 2},0" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.4"/>`,
      );
    } else {
      parts.push(
        `<rect x="${-position.width / 2}" y="${-position.height / 2}" width="${position.width}" height="${position.height}" rx="${node.kind === "START" || node.kind === "END" ? position.height / 2 : 10}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.4"/>`,
      );
    }
    parts.push(
      `<text x="0" y="${-position.height / 2 + 17}" text-anchor="middle" font-family="Arial, sans-serif" font-size="8" font-weight="700" fill="#637077">${kindLabels[node.kind]}</text>`,
      `<text x="0" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#363534">${lines.map((line, lineIndex) => `<tspan x="0" y="${labelStartY + lineIndex * 14}">${exportXmlEscape(line)}</tspan>`).join("")}</text>`,
      `</g>`,
    );
  }
  parts.push("</svg>");
  return { svg: parts.join(""), width, height };
}

export function fitDiagramDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maximumWidth: number,
  maximumHeight: number,
): { width: number; height: number } {
  const scale = Math.min(
    maximumWidth / Math.max(sourceWidth, 1),
    maximumHeight / Math.max(sourceHeight, 1),
  );
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export function renderEntityRelationshipSvg(
  diagram: ExportEntityRelationshipDiagram,
): {
  svg: string;
  width: number;
  height: number;
} {
  const columns = Math.min(
    3,
    Math.max(1, Math.ceil(Math.sqrt(diagram.entities.length))),
  );

  const rows = Math.ceil(diagram.entities.length / columns);

  const boxWidth = 260;
  const gapX = 90;
  const gapY = 85;
  const padding = 34;
  const titleHeight = 58;

  const visibleAttributeCount = Math.max(
    1,
    ...diagram.entities.map((entity) => Math.min(entity.attributes.length, 8)),
  );

  const boxHeight = 78 + visibleAttributeCount * 24;

  const width =
    padding * 2 + columns * boxWidth + Math.max(0, columns - 1) * gapX;

  const height =
    titleHeight +
    padding +
    rows * boxHeight +
    Math.max(0, rows - 1) * gapY +
    padding;

  const positions = new Map<
    string,
    {
      x: number;
      y: number;
      width: number;
      height: number;
    }
  >();

  diagram.entities.forEach((entity, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    positions.set(entity.id, {
      x: padding + column * (boxWidth + gapX),
      y: titleHeight + padding + row * (boxHeight + gapY),
      width: boxWidth,
      height: boxHeight,
    });
  });

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#FFFFFF"/>`,
    `<text x="${padding}" y="34" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="20" font-weight="700" fill="#354550">${exportXmlEscape(diagram.title)}</text>`,
  ];

  for (const relationship of diagram.relationships) {
    const from = positions.get(relationship.from);

    const to = positions.get(relationship.to);

    if (!from || !to) {
      continue;
    }

    const fromCenterX = from.x + from.width / 2;

    const fromCenterY = from.y + from.height / 2;

    const toCenterX = to.x + to.width / 2;

    const toCenterY = to.y + to.height / 2;

    const horizontal =
      Math.abs(toCenterX - fromCenterX) >= Math.abs(toCenterY - fromCenterY);

    const startX = horizontal
      ? toCenterX >= fromCenterX
        ? from.x + from.width
        : from.x
      : fromCenterX;

    const startY = horizontal
      ? fromCenterY
      : toCenterY >= fromCenterY
        ? from.y + from.height
        : from.y;

    const endX = horizontal
      ? toCenterX >= fromCenterX
        ? to.x
        : to.x + to.width
      : toCenterX;

    const endY = horizontal
      ? toCenterY
      : toCenterY >= fromCenterY
        ? to.y
        : to.y + to.height;

    parts.push(
      `<line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" stroke="#4F6675" stroke-width="1.8"/>`,
    );

    const relationshipText =
      `${relationship.cardinality} · ${relationship.label}`.slice(0, 52);

    const relationshipWidth = Math.max(58, relationshipText.length * 6.2 + 14);

    const middleX = (startX + endX) / 2;

    const middleY = (startY + endY) / 2;

    parts.push(
      `<rect x="${middleX - relationshipWidth / 2}" y="${middleY - 10}" rx="8" width="${relationshipWidth}" height="20" fill="#FFFFFF" stroke="#C3CAC8"/>`,
      `<text x="${middleX}" y="${middleY + 4}" text-anchor="middle" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="10" font-weight="700" fill="#675579">${exportXmlEscape(relationshipText)}</text>`,
    );
  }

  for (const entity of diagram.entities) {
    const position = positions.get(entity.id);

    if (!position) {
      continue;
    }

    parts.push(
      `<rect x="${position.x}" y="${position.y}" width="${position.width}" height="${position.height}" rx="12" fill="#FFFFFF" stroke="#675579" stroke-width="1.8"/>`,
      `<rect x="${position.x}" y="${position.y}" width="${position.width}" height="48" rx="12" fill="#F7F8F8"/>`,
      `<line x1="${position.x}" y1="${position.y + 48}" x2="${position.x + position.width}" y2="${position.y + 48}" stroke="#675579" stroke-width="1.2"/>`,
      `<text x="${position.x + 16}" y="${position.y + 31}" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="16" font-weight="700" fill="#354550">${exportXmlEscape(entity.name)}</text>`,
    );

    const attributes = entity.attributes.slice(0, 8);

    attributes.forEach((attribute, index) => {
      const y = position.y + 74 + index * 24;

      const key = [
        attribute.primaryKey ? "PK" : "",
        attribute.foreignKey ? "FK" : "",
      ]
        .filter(Boolean)
        .join("/");

      const prefix = key ? `${key} · ` : attribute.required ? "* " : "";

      const attributeName = erSvgText(`${prefix}${attribute.name}`, 25);

      const dataType = erSvgText(attribute.dataType || "string", 16);

      parts.push(
        `<text x="${position.x + 16}" y="${y}" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="11" font-weight="${key ? "700" : "400"}" fill="#363534">${exportXmlEscape(attributeName)}</text>`,
        `<text x="${position.x + position.width - 16}" y="${y}" text-anchor="end" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="10" fill="#637077">${exportXmlEscape(dataType)}</text>`,
      );
    });

    if (entity.attributes.length > attributes.length) {
      const additional = entity.attributes.length - attributes.length;

      parts.push(
        `<text x="${position.x + 16}" y="${position.y + position.height - 12}" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="9" fill="#637077">+ ${additional} atributos en la tabla detallada</text>`,
      );
    }
  }

  parts.push("</svg>");

  return {
    svg: parts.join(""),
    width,
    height,
  };
}

export async function exportFlowLayout(
  diagram: ExportFlowDiagram,
): Promise<ProcessFlowLayoutResult | null> {
  try {
    return await layoutProcessFlow(diagram);
  } catch (error: unknown) {
    globalThis.console.warn(
      "[process-flow] ELK no pudo organizar la exportación; se conserva el formato anterior.",
      error instanceof Error ? error.message : "Error desconocido",
    );
    return null;
  }
}
