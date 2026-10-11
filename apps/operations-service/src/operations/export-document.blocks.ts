import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import {
  businessText,
  businessValue,
  compactLines,
  flattenDocumentContent,
  jsonRecord,
  jsonRecords,
  optionalBusinessValue,
  recordText,
  uniqueTexts,
  versionSection,
} from "./export-document.text";
import {
  type ExportContentLine,
  type ExportContentTable,
  type ExportEntityAttribute,
  type ExportEntityDefinition,
  type ExportEntityRelationship,
  type ExportEntityRelationshipDiagram,
  type ExportKpiCard,
  type ExportObjectivesLayout,
  type ExportSectionPresentation,
  type RenderApprovedDocumentInput,
} from "./export-document.types";

export function prototypeDescriptionLines(
  input: RenderApprovedDocumentInput,
): readonly ExportContentLine[] {
  const content = jsonRecord(
    versionSection(input, "solutionProposal")?.content,
  );
  const markdown = content?.prototypeMarkdown;
  if (typeof markdown !== "string" || !markdown.trim()) return [];

  const description =
    optionalBusinessValue(content?.description) ||
    optionalBusinessValue(content?.objective) ||
    "La especificación define el propósito, los módulos, la navegación, las pantallas, los datos, las reglas, las integraciones y los criterios necesarios para implementar y validar el prototipo.";

  const coveredAreas = uniqueTexts(
    markdown
      .split(/\r?\n/gu)
      .map((line) => line.match(/^#{1,4}\s+(.+)$/u)?.[1]?.trim() ?? "")
      .filter(Boolean),
  ).slice(0, 8);

  return [
    {
      text: "Descripción del prototipo",
      level: 0,
      bullet: false,
    },
    { text: description, level: 1, bullet: true },
    ...(coveredAreas.length > 0
      ? [
          {
            text: `Cobertura de la especificación: ${coveredAreas.join("; ")}.`,
            level: 1,
            bullet: true,
          } satisfies ExportContentLine,
        ]
      : []),
  ];
}

export function tableByTitle(
  presentation: ExportSectionPresentation,
  title: string,
): ExportContentTable[] {
  return presentation.tables.filter((table) => table.title === title);
}

export function requirementTables(
  input: RenderApprovedDocumentInput,
  includeCriteria: boolean,
): ExportContentTable[] {
  if (input.version.requirements.length === 0) return [];
  if (includeCriteria) {
    const rows = input.version.requirements.flatMap((requirement) =>
      requirement.acceptanceCriteria.map((criterion, index) => [
        requirement.code,
        `CA${String(index + 1).padStart(2, "0")}`,
        businessText(criterion.description),
      ]),
    );
    return rows.length
      ? [
          {
            title: "Criterios asociados a requerimientos",
            headers: ["Requerimiento", "CA", "Condición verificable"],
            columnWeights: [1.1, 0.65, 5.25],
            rows,
          },
        ]
      : [];
  }
  return [
    {
      title: "Requerimientos funcionales",
      headers: ["Código", "Título", "Descripción"],
      columnWeights: [0.9, 2.1, 4],
      rows: input.version.requirements.map((requirement) => [
        requirement.code,
        businessText(requirement.title),
        businessText(requirement.description),
      ]),
    },
  ];
}

export function approvalTables(input: RenderApprovedDocumentInput): {
  approvals: ExportContentTable[];
  changes: ExportContentTable[];
} {
  const approvalContent = jsonRecord(
    versionSection(input, "approvalsAndChangeControl")?.content,
  );
  const people = jsonRecords(approvalContent?.approvals);
  const approvals: ExportContentTable[] = [
    {
      title: "Responsables y decisión",
      headers: ["Actividad", "Responsable", "Cargo / estado", "Fecha"],
      columnWeights: [1.1, 2.2, 2.2, 1.3],
      rows: people.map((person) => [
        businessValue(person.responsibility),
        businessValue(person.name),
        `${businessValue(person.position)}\n${businessValue(person.status)}`,
        businessValue(person.approvalMoment),
      ]),
    },
  ];
  const changes = jsonRecords(approvalContent?.changeControl).slice(-1);
  const changeRows = changes.map((change) => [
    businessValue(change.version),
    businessValue(change.date),
    businessValue(change.description ?? change.change),
    businessValue(change.approvedBy),
  ]);
  return {
    approvals,
    changes: [
      {
        title: "Control de cambios",
        headers: ["Versión", "Fecha", "Modificación", "Aprobó el cambio"],
        columnWeights: [0.9, 1.2, 3.7, 1.8],
        rows: changeRows,
      },
    ],
  };
}

export function processModelLines(
  flow: Readonly<Record<string, DocumentJsonValue>> | null,
): ExportContentLine[] {
  if (!flow) return [];
  const lines: ExportContentLine[] = [];
  const objective = recordText(flow, "objective");
  if (objective) {
    lines.push({ text: `Objetivo: ${objective}`, level: 0, bullet: false });
  }
  for (const [key, heading] of [
    ["problems", "Problemas identificados"],
    ["improvements", "Mejoras del proceso"],
    ["expectedResults", "Resultados esperados"],
  ] as const) {
    const values = Array.isArray(flow[key])
      ? flow[key].map((item) => businessValue(item))
      : [];
    if (values.length === 0) continue;
    lines.push({ text: heading, level: 0, bullet: false });
    lines.push(
      ...values.map((text) => ({ text, level: 1, bullet: true as const })),
    );
  }
  return lines;
}

export function processLaneTable(
  flow: Readonly<Record<string, DocumentJsonValue>> | null,
): ExportContentTable[] {
  const lanes = jsonRecords(flow?.lanes);
  return lanes.length > 0
    ? [
        {
          title: "Actores y sistemas del flujo",
          headers: ["Carril", "Tipo"],
          columnWeights: [4.5, 1.5],
          rows: lanes.map((lane) => [
            businessValue(lane.name),
            businessValue(lane.kind) === "SYSTEM" ? "Sistema" : "Actor",
          ]),
        },
      ]
    : [];
}

export function entityRelationshipDiagram(
  model: Readonly<Record<string, DocumentJsonValue>> | null,
): ExportEntityRelationshipDiagram | null {
  if (!model) return null;
  const entities = jsonRecords(model.entities)
    .map((entity): ExportEntityDefinition | null => {
      const id = businessValue(entity.id);
      const name = businessValue(entity.name);
      if (!id || !name) return null;
      return {
        id,
        name,
        attributes: jsonRecords(entity.attributes)
          .map((attribute): ExportEntityAttribute | null => {
            const attributeName = businessValue(attribute.name);
            if (!attributeName) return null;
            return {
              name: attributeName,
              dataType: businessValue(attribute.dataType),
              primaryKey: attribute.primaryKey === true,
              foreignKey: attribute.foreignKey === true,
              required: attribute.required === true,
            };
          })
          .filter((attribute) => attribute !== null),
      };
    })
    .filter((entity) => entity !== null);
  const ids = new Set(entities.map((entity) => entity.id));
  const relationships = jsonRecords(model.relationships)
    .map((relationship): ExportEntityRelationship | null => {
      const from = businessValue(relationship.from);
      const to = businessValue(relationship.to);
      if (!ids.has(from) || !ids.has(to)) return null;
      return {
        from,
        to,
        cardinality: businessValue(relationship.cardinality),
        label: businessValue(relationship.label),
      };
    })
    .filter((relationship) => relationship !== null);
  return entities.length > 0
    ? {
        title: recordText(model, "title") ?? "Modelo entidad-relación",
        entities,
        relationships,
      }
    : null;
}

export function entityRelationshipTables(
  model: Readonly<Record<string, DocumentJsonValue>> | null,
): ExportContentTable[] {
  if (!model) return [];
  const entities = jsonRecords(model.entities);
  const entityNames = new Map(
    entities.map((entity) => [
      businessValue(entity.id),
      businessValue(entity.name),
    ]),
  );
  const tables: ExportContentTable[] = [];
  const attributeRows = entities.flatMap((entity) => {
    const attributes = jsonRecords(entity.attributes);
    if (attributes.length === 0) {
      return [
        [
          businessValue(entity.name),
          businessValue(entity.description),
          "Sin atributos sustentados",
          "",
          "",
        ],
      ];
    }
    return attributes.map((attribute) => [
      businessValue(entity.name),
      businessValue(entity.description),
      businessValue(attribute.name),
      businessValue(attribute.dataType),
      [
        attribute.primaryKey === true ? "PK" : "",
        attribute.foreignKey === true ? "FK" : "",
        attribute.required === true ? "Obligatorio" : "Opcional",
      ]
        .filter(Boolean)
        .join(" · "),
    ]);
  });
  if (attributeRows.length > 0) {
    tables.push({
      title: recordText(model, "title") ?? "Entidades y atributos",
      headers: ["Entidad", "Descripción", "Atributo", "Tipo", "Clave / regla"],
      columnWeights: [1.2, 2.2, 1.4, 1, 1.2],
      rows: attributeRows,
    });
  }
  const relationships = jsonRecords(model.relationships);
  if (relationships.length > 0) {
    tables.push({
      title: "Relaciones y cardinalidades",
      headers: [
        "Entidad origen",
        "Relación",
        "Cardinalidad",
        "Entidad destino",
      ],
      columnWeights: [1.6, 2.2, 1, 1.6],
      rows: relationships.map((relationship) => [
        entityNames.get(businessValue(relationship.from)) ??
          businessValue(relationship.from),
        businessValue(relationship.label),
        businessValue(relationship.cardinality),
        entityNames.get(businessValue(relationship.to)) ??
          businessValue(relationship.to),
      ]),
    });
  }
  return tables;
}

function exportStringItems(value: DocumentJsonValue | undefined): string[] {
  if (Array.isArray(value)) {
    return uniqueTexts(value.map((item) => optionalBusinessValue(item)));
  }

  if (typeof value === "string") {
    return uniqueTexts(
      businessText(value)
        .split(/\s*(?:\r?\n+|[;•▪◦])\s*/gu)
        .map((item) =>
          item.replace(/^\s*(?:[-–—*]|\d{1,2}[.)])\s*/u, "").trim(),
        )
        .filter(Boolean),
    );
  }

  return [];
}

function isQuantitativeExportObjective(value: string): boolean {
  return /(?:\d+(?:[.,]\d+)?\s*(?:%|por\s+ciento|d[ií]as?|semanas?|meses?|a[nñ]os?|horas?|minutos?|segundos?|solicitudes?|registros?|usuarios?|casos?|errores?|cop|usd)|(?:reducir|aumentar|alcanzar|lograr|mantener|atender|procesar)\b[^.]{0,120}\d|porcentaje|cantidad|tasa|promedio|meta\s+de)/iu.test(
    value,
  );
}

export function exportObjectivesLayout(
  input: RenderApprovedDocumentInput,
): ExportObjectivesLayout {
  const section = versionSection(input, "objectives");
  const content = jsonRecord(section?.content);

  if (!content) {
    const general = section ? optionalBusinessValue(section.content) : "";

    return {
      general,
      qualitative: [],
      quantitative: [],
    };
  }

  const explicitQualitative = exportStringItems(
    content.qualitative ?? content.qualitativeObjectives,
  );
  const explicitQuantitative = exportStringItems(
    content.quantitative ?? content.quantitativeObjectives,
  );
  const legacySpecific = exportStringItems(
    content.specific ?? content.specificObjectives,
  );

  const classifiedLegacy = legacySpecific.reduce(
    (result, objective) => {
      if (isQuantitativeExportObjective(objective)) {
        result.quantitative.push(objective);
      } else {
        result.qualitative.push(objective);
      }
      return result;
    },
    {
      qualitative: [] as string[],
      quantitative: [] as string[],
    },
  );

  const qualitative = uniqueTexts([
    ...explicitQualitative,
    ...classifiedLegacy.qualitative,
  ]);
  const quantitative = uniqueTexts([
    ...explicitQuantitative,
    ...classifiedLegacy.quantitative,
  ]);

  return {
    general:
      recordText(content, "general") ??
      recordText(content, "generalObjective") ??
      "",
    qualitative,
    quantitative,
  };
}

export function exportKpiCards(
  input: RenderApprovedDocumentInput,
): readonly ExportKpiCard[] {
  const scope = jsonRecord(versionSection(input, "scope")?.content);
  if (!scope) return [];

  return jsonRecords(scope.kpis)
    .slice(0, 3)
    .map((kpi) => ({
      name: recordText(kpi, "name") ?? "",
      relatedObjective: recordText(kpi, "relatedObjective") ?? "",
      measurement: recordText(kpi, "measurement") ?? "",
      target: recordText(kpi, "target") ?? "",
    }))
    .filter((kpi) =>
      [kpi.name, kpi.relatedObjective, kpi.measurement, kpi.target].some(
        Boolean,
      ),
    );
}

export function scopeLinesWithoutKpis(
  input: RenderApprovedDocumentInput,
  fallback: readonly ExportContentLine[],
): readonly ExportContentLine[] {
  const scope = jsonRecord(versionSection(input, "scope")?.content);

  if (!scope || !("kpis" in scope)) {
    return compactLines(fallback);
  }

  const content: Record<string, DocumentJsonValue> = {};

  for (const [key, value] of Object.entries(scope)) {
    if (key !== "kpis") {
      content[key] = value;
    }
  }

  return compactLines(flattenDocumentContent(content));
}
