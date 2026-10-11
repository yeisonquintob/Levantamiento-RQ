import {
  approvalTables,
  entityRelationshipDiagram,
  entityRelationshipTables,
  exportKpiCards,
  exportObjectivesLayout,
  processLaneTable,
  processModelLines,
  prototypeDescriptionLines,
  requirementTables,
  scopeLinesWithoutKpis,
  tableByTitle,
} from "./export-document.blocks";
import { presentationFor } from "./export-document.presentation";
import {
  fallbackBacklogTreeLines,
  flowDiagramFromSteps,
  nonFunctionalTable,
  requirementsGroupTables,
  structuredActorsTable,
  structuredFlowDiagram,
  structuredIntegrationTable,
} from "./export-document.structures";
import {
  compactLines,
  jsonRecord,
  jsonRecords,
  versionSection,
} from "./export-document.text";
import {
  type ExportDocumentSection,
  type RenderApprovedDocumentInput,
} from "./export-document.types";

export function buildExportDocumentSections(
  input: RenderApprovedDocumentInput,
): readonly ExportDocumentSection[] {
  const scope = presentationFor(input, "scope");
  const solution = presentationFor(input, "solutionProposal");
  const objectivesLayout = exportObjectivesLayout(input);
  const kpiCards = exportKpiCards(input);
  const scopeLines = scopeLinesWithoutKpis(input, scope.lines);
  const problem = presentationFor(input, "problemDescription");
  const flow = presentationFor(input, "processFlow");
  const flowSectionContent = versionSection(input, "processFlow")?.content;
  const flowRoot = jsonRecord(flowSectionContent);
  const processFlows = jsonRecord(flowRoot?.processFlows);
  const historicalFlow = !processFlows;
  const asIsFlow = processFlows ? jsonRecord(processFlows.asIs) : flowRoot;
  const toBeFlow = processFlows ? jsonRecord(processFlows.toBe) : null;
  const entityRelationship = processFlows
    ? jsonRecord(flowRoot?.entityRelationship)
    : null;
  const milestones = presentationFor(input, "milestones");
  const backlog = presentationFor(input, "backlogStructure");
  const backlogContent = jsonRecord(
    versionSection(input, "backlogStructure")?.content,
  );
  const hasBacklogTree = jsonRecords(backlogContent?.epics).length > 0;
  const tests = presentationFor(input, "tests");
  const assumptions = presentationFor(input, "assumptionsDependenciesPending");
  const scrum = presentationFor(input, "scrumPlan");
  const milestoneContent = jsonRecord(
    versionSection(input, "milestones")?.content,
  );
  const schemeLines = hasBacklogTree
    ? compactLines(backlog.lines)
    : fallbackBacklogTreeLines(milestoneContent);
  const milestoneTables =
    milestoneContent &&
    (milestoneContent.functionalRequirements ||
      milestoneContent.nonFunctionalRequirements)
      ? requirementsGroupTables(
          milestoneContent,
          jsonRecords(backlogContent?.epics),
        )
      : milestones.tables;
  const actors = milestoneContent
    ? structuredActorsTable(milestoneContent)
    : null;
  const integrations = milestoneContent
    ? structuredIntegrationTable(milestoneContent)
    : null;
  const nonFunctional = nonFunctionalTable(input);
  const groupedFunctionalTables = milestoneTables.filter((table) =>
    /^6\.1(?:\.|\s)/u.test(table.title),
  );
  const groupedNonFunctionalTables = milestoneTables.filter((table) =>
    /^6\.2(?:\.|\s)/u.test(table.title),
  );
  const functionalRequirementTables =
    groupedFunctionalTables.length > 0
      ? groupedFunctionalTables
      : requirementTables(input, false).map((table) => ({
          ...table,
          title: "Resumen de requerimientos funcionales",
        }));
  const nonFunctionalRequirementTables =
    groupedNonFunctionalTables.length > 0
      ? groupedNonFunctionalTables.map((table) => ({
          ...table,
          title: "Matriz de requerimientos no funcionales",
        }))
      : nonFunctional
        ? [
            {
              ...nonFunctional,
              title: "Matriz de requerimientos no funcionales",
            },
          ]
        : [];
  const structuredFields = tableByTitle(milestones, "Datos y campos");
  // La sección incluye "pendientes": no se filtra por palabra.
  const assumptionLines = compactLines(assumptions.lines);
  const approval = approvalTables(input);
  const sections: ExportDocumentSection[] = [
    {
      number: 1,
      title: "Objetivo",
      lines: [],
      tables: [],
      objectivesLayout,
    },
    {
      number: 2,
      title: "Contexto y problema",
      lines: compactLines(problem.lines),
      tables: actors ? [actors] : [],
    },
    {
      number: 3,
      title: "Alcance",
      lines: scopeLines,
      tables: [],
      kpiCards,
    },
    {
      number: 4,
      title: "Solución propuesta del profesional de soluciones",
      lines: [
        ...compactLines(solution.lines),
        ...prototypeDescriptionLines(input),
      ],
      tables: [],
    },
    {
      number: 5,
      title: "Diagramas",
      lines: [
        {
          text: "Modelos del proceso y de la información incluidos en esta versión.",
          level: 0,
          bullet: false,
        },
      ],
      tables: [],
    },
    {
      number: 5,
      headingNumber: "5.1",
      title: "Flujo AS-IS",
      lines: historicalFlow
        ? compactLines(flow.lines)
        : processModelLines(asIsFlow),
      tables: processLaneTable(asIsFlow),
      flowDiagram: historicalFlow
        ? (flow.flowDiagram ??
          flowDiagramFromSteps("Flujo AS-IS", flow.flowSteps))
        : asIsFlow
          ? structuredFlowDiagram(asIsFlow)
          : null,
    },
    {
      number: 5,
      headingNumber: "5.2",
      title: "Flujo TO-BE",
      lines: toBeFlow
        ? processModelLines(toBeFlow)
        : [
            {
              text: "No existe flujo TO-BE en esta versión histórica.",
              level: 0,
              bullet: false,
            },
          ],
      tables: processLaneTable(toBeFlow),
      flowDiagram: toBeFlow ? structuredFlowDiagram(toBeFlow) : null,
    },
    {
      number: 5,
      headingNumber: "5.3",
      title: "Modelo entidad-relación",
      lines: entityRelationship
        ? []
        : [
            {
              text: "No existe modelo entidad-relación en esta versión histórica.",
              level: 0,
              bullet: false,
            },
          ],
      tables: entityRelationshipTables(entityRelationship),
      entityRelationshipDiagram: entityRelationshipDiagram(entityRelationship),
    },
    {
      number: 6,
      title: "Requerimientos",
      lines: [
        {
          text: "Los requerimientos se presentan por bloques para conservar la relación entre cada Hito y sus Historias de Usuario.",
          level: 0,
          bullet: false,
        },
      ],
      tables: [],
    },
    {
      number: 6,
      headingNumber: "6.1",
      title: "Requerimientos funcionales",
      lines:
        milestones.lines.length > 0
          ? compactLines(milestones.lines)
          : [
              {
                text: "Cada bloque contiene el código, título y descripción del Hito, seguido por el contenido completo de sus Historias de Usuario.",
                level: 0,
                bullet: false,
              },
            ],
      tables: functionalRequirementTables,
    },
    {
      number: 6,
      headingNumber: "6.2",
      title: "Requerimientos no funcionales",
      lines: [],
      tables: nonFunctionalRequirementTables,
    },
    {
      number: 7,
      title: "Esquema",
      lines: schemeLines,
      tables: [],
    },
    {
      number: 8,
      title: "Pruebas",
      lines: compactLines(tests.lines),
      tables: tests.tables,
    },
    {
      number: 9,
      title: "Datos, campos e integraciones",
      lines: [],
      tables: [...structuredFields, ...(integrations ? [integrations] : [])],
    },
    {
      number: 11,
      title: "Supuestos y dependencias",
      lines: assumptionLines,
      tables: [],
    },
    {
      number: 12,
      title: "Aprobación",
      lines:
        input.version.status === "APPROVED"
          ? []
          : [
              {
                text: "La versión aún no ha sido aprobada.",
                level: 0,
                bullet: false,
              },
            ],
      tables: input.version.status === "APPROVED" ? approval.approvals : [],
    },
    {
      number: 13,
      title: "Control de cambios",
      lines: approval.changes.some((table) => table.rows.length > 0)
        ? []
        : [
            {
              text: "No hay cambios registrados en esta versión.",
              level: 0,
              bullet: false,
            },
          ],
      // Una tabla sin filas solo dejaba el encabezado y una página vacía.
      tables: approval.changes.filter((table) => table.rows.length > 0),
    },
  ];
  if (versionSection(input, "scrumPlan")) {
    sections.push({
      number: 14,
      title: "Plan Scrum",
      lines: compactLines(scrum.lines),
      tables: [],
    });
  }
  const visible = sections.filter(
    (section) =>
      section.number <= 5 ||
      (section.number >= 6 && section.number <= 8) ||
      section.number >= 10 ||
      section.lines.length > 0 ||
      section.tables.length > 0 ||
      Boolean(section.flowDiagram) ||
      Boolean(section.entityRelationshipDiagram),
  );
  // AI_EXPORT_CONSECUTIVE_SECTION_NUMBERS_V1
  // Las secciones opcionales sin contenido (p. ej. "Datos, campos e
  // integraciones") no se exportan; la numeración visible de las siguientes
  // debe seguir siendo consecutiva (8 → 9, no 8 → 11).
  let nextDisplayNumber = 9;
  const displayByNumber = new Map<number, number>();
  return visible.map((section) => {
    if (section.number < 9) return section;
    let display = displayByNumber.get(section.number);
    if (display === undefined) {
      display = nextDisplayNumber;
      nextDisplayNumber += 1;
      displayByNumber.set(section.number, display);
    }
    return display === section.number
      ? section
      : { ...section, displayNumber: display };
  });
}
