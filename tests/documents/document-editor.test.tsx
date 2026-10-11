import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DOCUMENT_SECTION_DEFINITIONS,
  type RequirementDocumentDetail,
  type RequirementDocumentSummary,
} from "../../libs/shared/contracts/src/lib/documents.js";
import type {
  ProjectDetail,
  ProjectListResponse,
} from "../../libs/shared/contracts/src/lib/projects.js";
import {
  classifyProcessFlowEdgeVisualKind,
  layoutProcessFlow,
  ProcessFlowLayoutError,
  renderProcessFlowSvg,
  validateProcessFlowInput,
  type ProcessFlowInput,
} from "../../libs/shared/contracts/src/lib/process-flow-elk.js";
import {
  type DocumentListItem,
  type DocumentVersionListItem,
  DocumentsWorkspace,
} from "../../apps/web/src/app/workspace/documents/documents-workspace.js";
import { readDocumentSectionPresenterSource } from "../support/document-section-presenter-source.js";
import { SIDEBAR_MENU_DEFINITIONS } from "../../apps/web/src/app/sidebar-navigation.js";
import { ValidationWorkspace } from "../../apps/web/src/app/workspace/validation/validation-workspace.js";
import {
  analyzeContent,
  documentSemanticWarnings,
  RequirementDocumentEditor,
} from "../../apps/web/src/app/workspace/documents/[documentId]/requirement-document-editor.js";
import {
  cleanDocumentText,
  DocumentSectionBusinessEditor,
  DocumentSectionView,
  ProcessFlowDiagram,
  RequirementStoryDetail,
  ScrumEditor,
  ScrumView,
} from "../../apps/web/src/app/workspace/documents/[documentId]/document-section-presenter.js";
import { readStyles } from "../support/read-styles.js";

const project: ProjectDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "RQ-2026-000001",
  title: "Proyecto de prueba",
  requestingArea: "Operaciones",
  description: null,
  status: "DRAFT",
  template: {
    id: "22222222-2222-4222-8222-222222222222",
    code: "RQ-SMALL",
    name: "Requerimiento pequeño",
    version: "1.0.0",
    templateType: "SMALL_REQUIREMENT",
  },
  ownerUserId: "33333333-3333-4333-8333-333333333333",
  participantCount: 1,
  participants: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      userId: "33333333-3333-4333-8333-333333333333",
      role: "OWNER",
      createdAt: "2026-08-05T00:00:00.000Z",
    },
  ],
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
};

const document: RequirementDocumentDetail = {
  id: "55555555-5555-4555-8555-555555555555",
  projectId: project.id,
  title: "Levantamiento de prueba",
  status: "DRAFT",
  revision: 1,
  currentVersionNumber: 1,
  currentVersion: "1.0.0",
  template: {
    id: "66666666-6666-4666-8666-666666666666",
    sourceTemplateId: project.template?.id ?? "",
    code: project.template?.code ?? "",
    name: project.template?.name ?? "",
    version: project.template?.version ?? "",
    templateType: "SMALL_REQUIREMENT",
    appliedAt: "2026-08-05T00:00:00.000Z",
  },
  createdByUserId: project.ownerUserId,
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
  archivedAt: null,
  currentVersionDetail: {
    id: "77777777-7777-4777-8777-777777777777",
    versionNumber: 1,
    version: "1.0.0",
    status: "DRAFT",
    revision: 1,
    changeSummary: "Versión inicial",
    createdByUserId: project.ownerUserId,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    approvedByUserId: null,
    approvedAt: null,
    sections: DOCUMENT_SECTION_DEFINITIONS.map((section, index) => ({
      id: `${String(index + 10).padStart(8, "0")}-0000-4000-8000-000000000000`,
      key: section.key,
      title: section.title,
      order: index + 1,
      content: { value: index === 0 ? "Definido" : "[PENDIENTE POR DEFINIR]" },
      templateControlled: index >= 10,
    })),
    fields: [],
    requirements: [],
    evidence: [],
  },
};

test("el listado inicia en todos los proyectos y deshabilita la creación manual", () => {
  const projects: ProjectListResponse = {
    items: [project],
    page: 1,
    pageSize: 50,
    totalItems: 1,
    totalPages: 1,
  };
  const html = renderToStaticMarkup(
    <DocumentsWorkspace initialDocuments={[]} initialProjects={projects} />,
  );

  assert.match(html, /Nuevo documento/);
  assert.match(html, /Buscar proyecto/);
  assert.match(html, /Proyecto de prueba/);
  assert.match(html, /<button[^>]+disabled[^>]*>Nuevo documento<\/button>/);
  assert.match(html, /No hay documentos/);
  assert.match(html, /No hay documentos generados/);
  assert.doesNotMatch(html, /Selecciona un proyecto para consultar/);
});

test("todos los proyectos muestra documentos y un proyecto muestra versiones reales", () => {
  const projects: ProjectListResponse = {
    items: [project],
    page: 1,
    pageSize: 50,
    totalItems: 1,
    totalPages: 1,
  };
  const listedDocument: DocumentListItem = {
    ...document,
    currentVersionNumber: 2,
    currentVersion: "1.0.1",
    projectCode: project.code,
    projectTitle: project.title,
  };
  const versionBase = {
    aiEngines: [],
    aiModels: {},
    ...document.currentVersionDetail,
    documentId: document.id,
    documentTitle: document.title,
    documentArchived: false,
    currentVersionNumber: 2,
    projectId: project.id,
    projectCode: project.code,
    projectTitle: project.title,
  };
  const versions: readonly DocumentVersionListItem[] = [
    {
      ...versionBase,
      id: "99999999-9999-4999-8999-999999999992",
      versionNumber: 2,
      version: "1.0.1",
      status: "APPROVED",
      changeSummary: "Aprobación del alcance",
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    },
    {
      ...versionBase,
      id: "99999999-9999-4999-8999-999999999991",
      versionNumber: 1,
      version: "1.0.0",
      status: "DRAFT",
      changeSummary: "Versión inicial",
    },
  ];
  const allHtml = renderToStaticMarkup(
    <DocumentsWorkspace
      initialDocuments={[listedDocument]}
      initialVersions={versions}
      initialProjects={projects}
    />,
  );
  const versionsHtml = renderToStaticMarkup(
    <DocumentsWorkspace
      initialDocuments={[listedDocument]}
      initialProjectId={project.id}
      initialProjects={projects}
      initialVersions={versions}
    />,
  );

  const countedHtml = renderToStaticMarkup(
    <DocumentsWorkspace
      initialProjects={projects}
      initialDocuments={[
        { ...listedDocument, versionCount: 3 },
        { ...listedDocument, id: "another-document", versionCount: 2 },
      ]}
    />,
  );
  assert.equal(
    (countedHtml.match(/excluye los eliminados">5<\/td>/g) ?? []).length,
    2,
  );
  assert.match(allHtml, /RQ-2026-000001/);
  assert.match(allHtml, /Versión 2 · v\s*1\.0\.1/);
  assert.match(allHtml, /from=all/);
  assert.doesNotMatch(allHtml, /Versión 1 · v1\.0\.0/);
  assert.doesNotMatch(allHtml, /Eliminar borrador/);
  assert.equal((versionsHtml.match(/Eliminar borrador/g) ?? []).length, 1);
  assert.match(versionsHtml, /Seleccionar todos los borradores visibles/);
  assert.match(versionsHtml, /Seleccionar borrador versión 1/);
  assert.doesNotMatch(versionsHtml, /Seleccionar borrador versión 2/);
  assert.match(versionsHtml, /Eliminar seleccionados \(0\)/);
  assert.doesNotMatch(allHtml, /Seleccionar todos los borradores visibles/);
  const archivedHtml = renderToStaticMarkup(
    <DocumentsWorkspace
      initialProjectId={project.id}
      initialProjects={projects}
      initialVersions={versions.map((version) => ({
        ...version,
        documentArchived: true,
      }))}
    />,
  );
  assert.doesNotMatch(archivedHtml, /Seleccionar borrador versión/);

  assert.ok(
    versionsHtml.indexOf("Versión 2 ·") < versionsHtml.indexOf("Versión 1 ·"),
  );
  assert.match(versionsHtml, /Versión 2 · v1\.0\.1/);
  assert.match(versionsHtml, /Versión 1 · v1\.0\.0/);
  assert.match(versionsHtml, /Aprobación del alcance/);
  assert.match(versionsHtml, /Versión inicial/);
  assert.match(versionsHtml, /Versión cerrada/);
  assert.match(versionsHtml, /Consultar versión/);
  assert.match(versionsHtml, /version=1/);
});

test("el editor renderiza las catorce secciones y limita la IA a generaciones explícitas", () => {
  const html = renderToStaticMarkup(
    <RequirementDocumentEditor initialDocument={document} project={project} />,
  );

  for (const section of DOCUMENT_SECTION_DEFINITIONS) {
    assert.match(html, new RegExp(section.title));
  }
  assert.match(html, /14 secciones/);
  assert.match(html, /Sección 1 de 14/);
  assert.match(html, /Cambios sin guardar|Guardado/);
  assert.match(html, /Asistencia con revisión humana/);
  assert.match(html, /Nueva versión con IA/);
  assert.match(html, /Descargar borrador Word/);
  assert.match(html, /Importar Word corregido/);
  assert.match(html, /Más acciones/);
  assert.match(html, /Datos del documento/);
  assert.match(html, /rq-document-section-strip/);
  assert.doesNotMatch(html, /Configuración de plantilla/);
  assert.doesNotMatch(html, />Exportar</);
});

test("una versión histórica se abre en el editor existente en modo de consulta", () => {
  const currentVersion = {
    ...document.currentVersionDetail,
    id: "88888888-8888-4888-8888-888888888888",
    versionNumber: 2,
    version: "1.0.1",
    changeSummary: "Versión vigente",
  };
  const currentDocument: RequirementDocumentDetail = {
    ...document,
    currentVersionNumber: 2,
    currentVersion: "1.0.1",
    currentVersionDetail: currentVersion,
  };
  const historicalVersion = {
    ...document.currentVersionDetail,
    status: "DRAFT" as const,
  };
  const html = renderToStaticMarkup(
    <RequirementDocumentEditor
      initialDocument={currentDocument}
      initialVersion={historicalVersion}
      project={project}
      returnToAllProjects
    />,
  );

  assert.match(html, /Versión 1/);
  assert.match(html, /SemVer 1\.0\.0/);
  assert.match(html, /href="\/workspace\/documents"/);
  assert.doesNotMatch(html, />Editar sección</);
});

test("una versión con correcciones solicitadas permanece editable y puede reenviarse", () => {
  const version = {
    ...document.currentVersionDetail,
    status: "CHANGES_REQUESTED" as const,
  };
  const correctionsDocument: RequirementDocumentDetail = {
    ...document,
    status: "CHANGES_REQUESTED",
    currentVersionDetail: version,
  };
  const html = renderToStaticMarkup(
    <RequirementDocumentEditor
      initialDocument={correctionsDocument}
      project={project}
    />,
  );

  assert.match(html, /Correcciones solicitadas/);
  assert.match(html, /Editar sección/);
  assert.match(html, /Reenviar a validación/);
  assert.doesNotMatch(html, />Rechazado</);
});

test("la bandeja de validación está habilitada y abre el flujo documental", async () => {
  const summary: RequirementDocumentSummary = document;
  const projects: ProjectListResponse = {
    items: [project],
    page: 1,
    pageSize: 50,
    totalItems: 1,
    totalPages: 1,
  };
  const html = renderToStaticMarkup(
    <ValidationWorkspace
      initialDocuments={[
        {
          ...summary,
          projectCode: project.code,
          projectTitle: project.title,
        },
      ]}
      initialProjects={projects}
    />,
  );
  const shell = await readFile("apps/web/src/app/app-shell.tsx", "utf8");

  // El título "Validación" vive en el encabezado del shell; la bandeja muestra
  // sus indicadores por estado, la tabla de documentos y las acciones.
  assert.match(html, /Por validar/);
  assert.match(html, /Aprobados/);
  assert.match(html, /Preparar/);
  assert.match(html, /Proyecto de prueba/);
  // La navegación ya no está escrita en app-shell.tsx: se define en el menú
  // lateral configurable y el shell la consume.
  assert.equal(
    SIDEBAR_MENU_DEFINITIONS.find((menu) => menu.id === "validation")?.href,
    "/workspace/validation",
  );
  assert.match(shell, /SIDEBAR_MENU_DEFINITIONS/);
  assert.doesNotMatch(shell, /futureNavigation/);
});

test("RNF no exige hito ni funcionalidad pero sí categoría medida y meta", () => {
  const valid = analyzeContent({
    nonFunctionalRequirements: [
      {
        code: "RNF-001",
        title: "Auditoría",
        description: "Las operaciones sensibles deben ser trazables.",
        requirementType: "SECURITY",

        acceptanceCriteria: [
          "Toda operación sensible genera un evento de auditoría.",
        ],

        milestone: null,
        functionality: null,

        category: "Seguridad",
        measure: "Eventos auditados",
        target: "100% de operaciones sensibles",
      },
    ],
  });

  assert.equal(valid.errors.length, 0);

  const incomplete = analyzeContent({
    nonFunctionalRequirements: [
      {
        code: "RNF-001",
        title: "Auditoría",
        description: "Las operaciones sensibles deben ser trazables.",
        requirementType: "SECURITY",

        acceptanceCriteria: ["Criterio definido"],

        milestone: null,
        functionality: null,

        category: null,
        measure: null,
        target: null,
      },
    ],
  });

  assert.doesNotMatch(
    incomplete.errors.join("\n"),
    /milestone.*requiere definición/i,
  );

  assert.doesNotMatch(
    incomplete.errors.join("\n"),
    /functionality.*requiere definición/i,
  );

  assert.match(incomplete.errors.join("\n"), /category.*requiere definición/i);

  assert.match(incomplete.errors.join("\n"), /measure.*requiere definición/i);

  assert.match(incomplete.errors.join("\n"), /target.*requiere definición/i);
});

test("los funcionales no exigen category, measure ni target y los RNF sí", () => {
  const functional = analyzeContent({
    functionalRequirements: [
      {
        code: "HU-001",
        title: "Registrar activo",

        role: "Gestor",
        want: "registrar un activo",
        benefit: "mantener trazabilidad",
        context: "Contexto definido",

        acceptanceCriteria: ["Criterio definido"],

        category: null,
        measure: null,
        target: null,
      },
    ],
  });

  assert.equal(functional.errors.length, 0);

  const nonFunctional = analyzeContent({
    nonFunctionalRequirements: [
      {
        code: "RNF-001",
        title: "Rendimiento",

        description: "Respuesta controlada",

        requirementType: "PERFORMANCE",

        acceptanceCriteria: ["Criterio definido"],

        category: null,
        measure: null,
        target: null,
      },
    ],
  });

  assert.ok(
    nonFunctional.errors.some((item) =>
      /category.*requiere definición/i.test(item),
    ),
  );

  assert.ok(
    nonFunctional.errors.some((item) =>
      /measure.*requiere definición/i.test(item),
    ),
  );

  assert.ok(
    nonFunctional.errors.some((item) =>
      /target.*requiere definición/i.test(item),
    ),
  );
});

test("la vista normal del punto 6 usa el contenido canónico y conserva legacy solo como fallback", async () => {
  const source = await readFile(
    "apps/web/src/app/workspace/documents/[documentId]/requirement-document-editor.tsx",
    "utf8",
  );

  assert.match(source, /PUNTO_6_CANONICAL_VIEW_CONTENT/);

  assert.match(source, /hasCanonicalRequirementTabs/);

  assert.match(source, /value=\{requirementsViewContent\}/);

  assert.match(
    source,
    /legacyRequirementTabs\s*\?\?\s*requirementsPresentationContent/,
  );

  assert.doesNotMatch(
    source,
    /value=\{legacyRequirementTabs\s*\?\?\s*requirementsPresentationContent\}/,
  );
});

test("la validación distingue obligatorios, pendientes y avance", () => {
  const result = analyzeContent({
    title: "",
    objective: "[PENDIENTE POR DEFINIR]",
    scope: ["Elemento definido"],
  });

  assert.equal(result.total, 3);
  assert.equal(result.completed, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0] ?? "", /Título.*requiere definición/i);
  assert.match(result.errors[1] ?? "", /Objetivo.*pendiente por definir/i);
});

test("los pendientes conservan su ubicación en el detalle de mejora", () => {
  const result = analyzeContent("Resumen [PENDIENTE POR DEFINIR]", [
    "Supuestos, dependencias y pendientes",
  ]);

  assert.equal(result.pending, 1);
  assert.deepEqual(result.errors, [
    "Supuestos, dependencias y pendientes está pendiente por definir.",
  ]);
});

test("la validación acepta vacíos opcionales, etiquetas nulas y cronograma relativo", () => {
  const result = analyzeContent({
    outOfScope: [],
    dependencies: [],
    dependencyCodes: [],
    label: null,
    laneId: null,
    scheduleBasis: "RELATIVE_DAY",
    confirmedStartDate: null,
    startDate: null,
    endDate: null,
    startDay: 1,
    endDay: 15,
    sourceIds: ["11111111-1111-4111-8111-111111111111"],
  });

  assert.equal(result.pending, 0);
  assert.equal(result.errors.length, 0);
});

test("la validación semántica informa ubicación sin endurecer la aprobación", () => {
  const version = {
    ...document.currentVersionDetail,
    sections: document.currentVersionDetail.sections.map((section) =>
      section.key === "milestones"
        ? {
            ...section,
            content: {
              features: [
                {
                  code: "FE-001",
                  userStoryCodes: ["HU-INEXISTENTE"],
                },
              ],
              userStories: [
                {
                  code: "HU-001",
                  featureCode: "FE-INEXISTENTE",
                  acceptanceCriteria: [],
                },
              ],
            },
          }
        : section.key === "tests"
          ? {
              ...section,
              content: {
                scenarios: [
                  {
                    code: "CP-001",
                    userStoryCodes: ["HU-INEXISTENTE"],
                    acceptanceCriterionCodes: ["CA-INEXISTENTE"],
                  },
                ],
              },
            }
          : section,
    ),
  };
  const warnings = documentSemanticWarnings(version);
  assert.ok(
    warnings.some((item) =>
      /Requerimientos.*funcionalidad inexistente/i.test(item),
    ),
  );
  assert.ok(
    warnings.some((item) => /HU-001 no contiene criterios/i.test(item)),
  );
  assert.ok(warnings.some((item) => /Pruebas.*HU-INEXISTENTE/i.test(item)));
  assert.ok(warnings.some((item) => /CA-INEXISTENTE/i.test(item)));
});

test("la vista humana oculta metadatos técnicos y dibuja el flujo", () => {
  const sourceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const flow = {
    title: "Solicitud de servicio",
    nodes: [
      {
        id: "n-1",
        kind: "START",
        label: "Recibir solicitud",
        sourceIds: [sourceId],
      },
      {
        id: "n-2",
        kind: "END",
        label: "Cerrar solicitud",
        sourceIds: [sourceId],
      },
    ],
    edges: [{ from: "n-1", to: "n-2", label: null }],
    sourceIds: [sourceId],
  };
  const html = renderToStaticMarkup(<ProcessFlowDiagram value={flow} />);

  assert.match(html, /<svg/);
  assert.match(html, /Alejar|Acercar|Ajustar/);
  assert.match(html, /Recibir solicitud/);
  assert.match(html, /Cerrar solicitud/);
  assert.doesNotMatch(html, /sourceIds|scheduleBasis|startDay|endDay/);
  assert.doesNotMatch(html, new RegExp(sourceId, "i"));
  assert.doesNotMatch(html, />n-1<|>n-2</);
  assert.equal(
    cleanDocumentText(
      'Plan relativo (scheduleBasis: RELATIVE_DAY). El plan en detalle está en structuredAnalysis.scrumPlan. (sourceIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"])',
    ),
    "Plan relativo.",
  );
});

test("la sección 5 presenta tres pestañas y mantiene compatibilidad histórica", async () => {
  const value = {
    processFlows: {
      asIs: {
        title: "Proceso actual por carriles",
        objective: "Describir la operación actual.",
        lanes: [{ id: "actor", name: "Solicitante", kind: "ACTOR" }],
        nodes: [
          {
            id: "start",
            kind: "START",
            label: "Inicio actual",
            laneId: "actor",
          },
          {
            id: "end",
            kind: "END",
            label: "Fin actual",
            laneId: "actor",
          },
        ],
        edges: [{ from: "start", to: "end", label: null }],
        problems: ["Validación manual."],
        improvements: [],
        expectedResults: [],
        sourceIds: [],
      },
      toBe: {
        title: "Proceso futuro por carriles",
        objective: "Describir la operación futura.",
        lanes: [{ id: "system", name: "Plataforma", kind: "SYSTEM" }],
        nodes: [],
        edges: [],
        problems: [],
        improvements: [],
        expectedResults: [],
        sourceIds: [],
      },
    },
    entityRelationship: {
      title: "Modelo de solicitud",
      entities: [],
      relationships: [],
      sourceIds: [],
    },
  };
  const html = renderToStaticMarkup(
    <DocumentSectionView sectionKey="processFlow" value={value} />,
  );
  assert.match(html, /Flujo AS-IS/);
  assert.match(html, /Flujo TO-BE/);
  assert.match(html, /Modelo entidad-relación/);
  assert.match(html, /Proceso actual por carriles/);
  assert.match(html, /Solicitante/);
  assert.doesNotMatch(html, /Proceso futuro por carriles/);
  assert.equal((html.match(/role="tabpanel"/gu) ?? []).length, 1);

  const source = readDocumentSectionPresenterSource();
  assert.match(source, /No existe flujo TO-BE en esta versión histórica\./);
  assert.match(
    source,
    /No existe modelo entidad-relación en esta versión histórica\./,
  );
});

test("LOCAL_ONLY_V2 convierte el flujo narrativo AS-IS y TO-BE en diagramas visibles", () => {
  const value = [
    "Diagrama de flujo AS-IS:",
    "Inicio -> Usuario crea solicitud -> Revisión manual -> Registro en proveedor -> Fin.",
    "",
    "Diagrama de flujo TO-BE:",
    "Inicio -> Formulario digital -> ¿Usuario habilitado? -> Aprobación -> Envío automático -> Fin.",
  ].join("\n");
  const html = renderToStaticMarkup(
    <DocumentSectionView sectionKey="processFlow" value={value} />,
  );

  assert.match(html, /Flujo AS-IS/u);
  assert.match(html, /Usuario crea solicitud/u);
  assert.match(html, /Revisión manual/u);
  assert.doesNotMatch(
    html,
    /No hay información o evidencia suficiente para representar el flujo AS-IS/u,
  );
});

test("ELK distribuye flujos genéricos sin alterar el contrato de IA", async () => {
  const graphs: readonly ProcessFlowInput[] = [
    {
      title: "Flujo lineal",
      nodes: [
        { id: "start", kind: "START", label: "Inicio" },
        { id: "capture", kind: "PROCESS", label: "Registrar solicitud" },
        { id: "end", kind: "END", label: "Fin" },
      ],
      edges: [
        { from: "start", to: "capture", label: null },
        { from: "capture", to: "end", label: null },
      ],
    },
    {
      title: "Ramas y convergencia",
      nodes: [
        { id: "start", kind: "START", label: "Inicio" },
        { id: "decision", kind: "DECISION", label: "¿Solicitud completa?" },
        { id: "approve", kind: "SYSTEM", label: "Aprobar solicitud" },
        { id: "adjust", kind: "ACTOR", label: "Completar información" },
        { id: "end", kind: "END", label: "Fin" },
      ],
      edges: [
        { from: "start", to: "decision", label: null },
        { from: "decision", to: "approve", label: "Sí & validado" },
        { from: "decision", to: "adjust", label: "No" },
        { from: "approve", to: "end", label: null },
        { from: "adjust", to: "end", label: null },
      ],
    },
    {
      title: "Ciclo y salto",
      nodes: [
        { id: "start", kind: "START", label: "Inicio" },
        { id: "review", kind: "PROCESS", label: "Revisar solicitud" },
        { id: "decision", kind: "DECISION", label: "¿Requiere ajustes?" },
        { id: "end", kind: "END", label: "Fin" },
      ],
      edges: [
        { from: "start", to: "review", label: null },
        { from: "review", to: "decision", label: null },
        { from: "decision", to: "review", label: "Sí" },
        { from: "decision", to: "end", label: "No" },
        { from: "start", to: "end", label: "Cancelar" },
      ],
    },
    {
      title: "Componentes desconectados",
      nodes: [
        { id: "a", kind: "START", label: "Inicio A" },
        { id: "b", kind: "END", label: "Fin A" },
        {
          id: "c",
          kind: "PROCESS",
          label:
            "Actividad independiente con una descripción deliberadamente extensa para validar truncamiento visual",
        },
        { id: "d", kind: "END", label: "Fin B" },
      ],
      edges: [
        { from: "a", to: "b", label: null },
        { from: "c", to: "d", label: null },
      ],
    },
  ];

  for (const graph of graphs) {
    const original = structuredClone(graph);
    const layout = await layoutProcessFlow(graph);
    assert.equal(layout.engine, "elk");
    assert.equal(layout.nodes.length, graph.nodes.length);
    assert.equal(layout.edges.length, graph.edges.length);
    assert.ok(layout.width > 0);
    assert.ok(layout.height > 0);
    assert.deepEqual(
      layout.edges.map((edge) => edge.label),
      graph.edges.map((edge) => edge.label),
    );
    for (const node of layout.nodes) {
      assert.ok(Number.isFinite(node.x));
      assert.ok(Number.isFinite(node.y));
      assert.ok(node.width <= 264);
      assert.ok(node.lines.length <= 3);
    }
    for (let leftIndex = 0; leftIndex < layout.nodes.length; leftIndex += 1) {
      const left = layout.nodes[leftIndex]!;
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < layout.nodes.length;
        rightIndex += 1
      ) {
        const right = layout.nodes[rightIndex]!;
        const overlaps =
          left.x < right.x + right.width &&
          left.x + left.width > right.x &&
          left.y < right.y + right.height &&
          left.y + left.height > right.y;
        assert.equal(
          overlaps,
          false,
          `${left.id} se superpone con ${right.id}`,
        );
      }
    }
    for (const edge of layout.edges) {
      assert.match(edge.path, /^M [\d.-]+ [\d.-]+(?: L [\d.-]+ [\d.-]+)+/);
      assert.ok(edge.sections.length > 0);
      assert.deepEqual(edge.sourcePoint, edge.sections[0]?.startPoint);
      assert.deepEqual(edge.targetPoint, edge.sections.at(-1)?.endPoint);
      const sourceNode = layout.nodes.find((node) => node.id === edge.from)!;
      const targetNode = layout.nodes.find((node) => node.id === edge.to)!;
      const touchesBorder = (
        point: { x: number; y: number },
        node: typeof sourceNode,
      ) => {
        const epsilon = 0.01;
        const withinX =
          point.x >= node.x - epsilon &&
          point.x <= node.x + node.width + epsilon;
        const withinY =
          point.y >= node.y - epsilon &&
          point.y <= node.y + node.height + epsilon;
        const touchesVertical =
          Math.abs(point.x - node.x) <= epsilon ||
          Math.abs(point.x - (node.x + node.width)) <= epsilon;
        const touchesHorizontal =
          Math.abs(point.y - node.y) <= epsilon ||
          Math.abs(point.y - (node.y + node.height)) <= epsilon;
        return (withinY && touchesVertical) || (withinX && touchesHorizontal);
      };
      assert.ok(touchesBorder(edge.sourcePoint, sourceNode));
      assert.ok(touchesBorder(edge.targetPoint, targetNode));
    }
    assert.deepEqual(graph, original);
  }

  const deterministicInput = graphs[1]!;
  assert.deepEqual(
    await layoutProcessFlow(deterministicInput),
    await layoutProcessFlow(deterministicInput),
  );
  const deterministicLayout = await layoutProcessFlow(deterministicInput);
  const svg = renderProcessFlowSvg(deterministicLayout, {
    title: deterministicInput.title,
  });
  assert.match(svg, /<svg[^>]+role="img"/);
  assert.match(svg, /<path d="M [^"]+ L [^"]+"/);
  assert.match(svg, /Sí &amp; validado/);
  assert.match(svg, /rq-process-flow__edge-origin/);
  assert.match(svg, /marker-end="url\(#rq-process-flow-arrow-affirmative\)"/);
  assert.doesNotMatch(svg, /sourceIds|scheduleBasis/);
});

test("las conexiones distinguen su intención visual sin modificar los datos", async () => {
  assert.equal(classifyProcessFlowEdgeVisualKind(null), "main");
  assert.equal(classifyProcessFlowEdgeVisualKind("Sí"), "affirmative");
  assert.equal(classifyProcessFlowEdgeVisualKind("Aprobado"), "affirmative");
  assert.equal(classifyProcessFlowEdgeVisualKind("No autorizado"), "negative");
  assert.equal(
    classifyProcessFlowEdgeVisualKind("Error de validación"),
    "negative",
  );
  assert.equal(
    classifyProcessFlowEdgeVisualKind("Consultar D365"),
    "information",
  );
  assert.equal(
    classifyProcessFlowEdgeVisualKind("Motivo especial"),
    "condition",
  );
  assert.equal(
    classifyProcessFlowEdgeVisualKind("Reintentar", "return"),
    "return",
  );

  const original: ProcessFlowInput = {
    nodes: [
      { id: "start", kind: "START", label: "Inicio" },
      { id: "decision", kind: "DECISION", label: "¿Continuar?" },
      { id: "end", kind: "END", label: "Fin" },
    ],
    edges: [
      { from: "start", to: "decision", label: null },
      { from: "decision", to: "end", label: "Sí" },
    ],
  };
  const extended: ProcessFlowInput = {
    ...original,
    nodes: [
      ...original.nodes,
      { id: "adjust", kind: "PROCESS", label: "Solicitar ajuste" },
    ],
    edges: [...original.edges, { from: "decision", to: "adjust", label: "No" }],
  };
  const layout = await layoutProcessFlow(extended);
  assert.equal(layout.nodes.length, 4);
  assert.equal(layout.edges.length, 3);
  assert.equal(layout.edges[0]?.visualKind, "main");
  assert.equal(layout.edges[1]?.visualKind, "affirmative");
  assert.equal(layout.edges[2]?.visualKind, "negative");
  assert.deepEqual(
    original.nodes.map((node) => node.id),
    ["start", "decision", "end"],
  );
});

test("ELK rechaza identificadores y conexiones inválidas para activar el fallback controlado", async () => {
  const invalid: ProcessFlowInput = {
    nodes: [
      { id: "duplicado", kind: "START", label: "Inicio" },
      { id: "duplicado", kind: "END", label: "Fin" },
    ],
    edges: [{ from: "duplicado", to: "inexistente", label: null }],
  };
  const issues = validateProcessFlowInput(invalid);
  assert.ok(issues.some((issue) => /duplicado/i.test(issue)));
  assert.ok(issues.some((issue) => /destino inexistente/i.test(issue)));
  await assert.rejects(
    layoutProcessFlow(invalid),
    (error: unknown) => error instanceof ProcessFlowLayoutError,
  );
});

test("el editor de flujo limita los tipos y recomienda nombrar ramas de decisión", () => {
  const flow = {
    nodes: [
      { id: "inicio", kind: "START", label: "Inicio" },
      { id: "decision", kind: "DECISION", label: "¿Solicitud completa?" },
      { id: "aprobada", kind: "PROCESS", label: "Continuar trámite" },
      { id: "ajuste", kind: "PROCESS", label: "Solicitar ajuste" },
      { id: "fin", kind: "END", label: "Fin" },
    ],
    edges: [
      { from: "inicio", to: "decision", label: null },
      { from: "decision", to: "aprobada", label: "Sí" },
      { from: "decision", to: "ajuste", label: null },
      { from: "aprobada", to: "fin", label: null },
      { from: "ajuste", to: "fin", label: null },
    ],
  };
  const html = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly={false}
      sectionKey="processFlow"
      value={flow}
    />,
  );
  const version = {
    ...document.currentVersionDetail,
    sections: document.currentVersionDetail.sections.map((section) =>
      section.key === "processFlow" ? { ...section, content: flow } : section,
    ),
  };

  for (const label of [
    "Inicio",
    "Fin",
    "Actor",
    "Proceso",
    "Decisión",
    "Sistema",
  ]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.doesNotMatch(html, />Análisis<|>Borrador<|>Aprobado</);
  assert.ok(
    documentSemanticWarnings(version).some((item) =>
      /decisión.*ramas sin condición funcional/i.test(item),
    ),
  );
});

test("funcionalidades, historias, pruebas y Scrum se presentan como contenido de negocio", () => {
  const requirements = renderToStaticMarkup(
    <DocumentSectionView
      sectionKey="milestones"
      value={{
        features: [
          {
            code: "F-001",
            title: "Radicar solicitud",
            objective: "Permitir la radicación",
            description: "Captura la necesidad del usuario.",
            inScope: ["Registro"],
            outOfScope: [],
            userStoryCodes: ["HU-001"],
            sourceIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
          },
        ],
        userStories: [
          {
            code: "HU-001",
            featureCode: "F-001",
            title: "Registrar solicitud",
            role: "Analista",
            want: "registrar una solicitud",
            benefit: "iniciar su gestión",
            context: "Proceso operativo",
            premises: [],
            impactedSystems: ["Portal"],
            fields: [],
            acceptanceCriteria: [
              {
                code: "CA-001",
                given: "una solicitud",
                when: "se guarda",
                then: "queda registrada",
                sourceIds: [],
              },
            ],
            sourceIds: [],
          },
        ],
      }}
    />,
  );
  const story = renderToStaticMarkup(
    <RequirementStoryDetail
      story={{
        code: "HU-001",
        featureCode: "F-001",
        title: "Registrar solicitud",
        description: "Permite registrar la solicitud desde el portal.",
        role: "Analista",
        want: "registrar una solicitud",
        benefit: "iniciar su gestión",
        context: "Proceso operativo",
        impactedSystems: ["Portal"],
        fields: [],
        acceptanceCriteria: [
          {
            code: "CA-001",
            given: "una solicitud",
            when: "se guarda",
            then: "queda registrada",
          },
        ],
      }}
    />,
  );
  const tests = renderToStaticMarkup(
    <DocumentSectionView
      sectionKey="tests"
      value={{
        scenarios: [
          {
            code: "CP-001",
            title: "Radicación correcta",
            userStoryCodes: ["HU-001"],
            acceptanceCriterionCodes: ["CA-001"],
            precondition: "Datos completos",
            action: "Guardar",
            expectedResult: "Solicitud registrada",
            sourceIds: [],
          },
        ],
      }}
    />,
  );
  // El plan de trabajo tiene las vistas Sprint y Etapas; el renderizado
  // estático abre Etapas, así que el detalle de Sprint se ejercita directamente.
  const scrum = renderToStaticMarkup(
    <ScrumView
      value={{
        cadenceDays: 15,
        scheduleBasis: "RELATIVE_DAY",
        confirmedStartDate: null,
        sprints: [
          {
            number: 1,
            code: "SPR-001",
            period: "Día 1 al Día 15",
            startDay: 1,
            endDay: 15,
            startDate: null,
            endDate: null,
            objective: "Entregar radicación",
            featureCodes: ["F-001"],
            userStoryCodes: ["HU-001"],
            tasks: [],
            dependencies: [],
            testCodes: ["CP-001"],
            deliverables: ["Incremento funcional"],
            closingCriterion: "Pruebas aprobadas",
            risks: [],
            sourceIds: [],
          },
        ],
      }}
    />,
  );

  assert.match(requirements, /Funcionalidades/);
  assert.match(requirements, /Historias de usuario/);
  assert.match(requirements, /Como.*Analista.*Quiero/s);
  assert.match(story, /Como.*Analista.*Quiero.*registrar una solicitud/s);
  assert.match(story, /rq-requirement-story-detail__narrative/);
  assert.match(story, /Descripción funcional/);
  assert.match(story, /Permite registrar la solicitud desde el portal/);
  assert.match(story, /rq-requirement-story-detail__context/);
  assert.match(story, /Contexto.*Premisas.*Sistemas impactados/s);
  assert.match(story, /Criterios de aceptación/);
  assert.match(requirements, /Sin exclusiones explícitamente definidas/);
  assert.match(tests, /Historias verificadas/);
  assert.match(tests, /Resultado esperado/);
  assert.match(scrum, /15 días calendario/);
  assert.match(scrum, /Día 1 al Día 15/);
  assert.doesNotMatch(scrum, /scheduleBasis|startDay|endDay|RELATIVE_DAY/);

  // La sección completa ofrece ambas vistas y abre en Etapas.
  const workPlan = renderToStaticMarkup(
    <DocumentSectionView
      sectionKey="scrumPlan"
      value={{
        cadenceDays: 15,
        scheduleBasis: "RELATIVE_DAY",
        confirmedStartDate: null,
        sprints: [],
      }}
    />,
  );
  assert.match(workPlan, /role="tablist"/);
  assert.match(workPlan, /aria-selected="false"[^>]*>Sprint</);
  assert.match(workPlan, /aria-selected="true"[^>]*>Etapas</);
  assert.match(workPlan, /Programación según las tareas/);
});

test("requerimientos y Scrum usan relaciones controladas y códigos automáticos", () => {
  const requirements = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly={false}
      sectionKey="milestones"
      value={{
        features: [
          {
            code: "F-001",
            title: "Radicar",
            userStoryCodes: ["HU-001"],
          },
        ],
        userStories: [
          {
            code: "HU-001",
            featureCode: "F-001",
            title: "Registrar solicitud",
          },
        ],
      }}
    />,
  );
  const scrum = renderToStaticMarkup(
    <ScrumEditor
      onChange={() => undefined}
      readOnly={false}
      value={{
        cadenceDays: 15,
        scheduleBasis: "RELATIVE_DAY",
        sprints: [
          {
            number: 1,
            code: "SPR-001",
            userStoryCodes: ["HU-001"],
            tasks: [
              {
                code: "T-001",
                userStoryCode: "HU-001",
                description: "Analizar solicitud",
                type: "ANALYSIS",
                dependencyCodes: [],
              },
            ],
          },
        ],
      }}
    />,
  );

  assert.match(requirements, /rq-requirements-dual-column/);
  assert.match(requirements, /Funcionalidades \(1\)/);
  assert.match(requirements, /Historias de usuario \(1\)/);
  assert.match(requirements, /Historias relacionadas/);
  assert.match(requirements, /HU-001 · Registrar solicitud/);
  assert.match(requirements, /Falta definir objetivo/);
  assert.match(scrum, /Historia relacionada/);
  assert.match(scrum, /Agregar tarea/);
  assert.match(scrum, /Dependencias/);
  assert.match(scrum, />Eliminar registro</);
  // El editor de la sección completa abre con las vistas Sprint y Etapas.
  const sectionEditor = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly={false}
      sectionKey="scrumPlan"
      value={{ cadenceDays: 15, scheduleBasis: "RELATIVE_DAY", sprints: [] }}
    />,
  );
  assert.match(sectionEditor, /role="tablist"/);
  assert.match(sectionEditor, /aria-selected="true"[^>]*>Etapas</);
});

test("Scrum presenta fechas y exclusiones del calendario laboral colombiano", () => {
  const html = renderToStaticMarkup(
    <ScrumView
      value={{
        cadenceDays: 15,
        scheduleBasis: "CONFIRMED_DATE",
        confirmedStartDate: "2026-09-01",
        calendarMode: "COLOMBIA_BUSINESS_DAYS",
        sprints: [
          {
            number: 1,
            code: "SPR-001",
            period: "2026-09-01 al 2026-09-21",
            startDate: "2026-09-01",
            endDate: "2026-09-21",
            objective: "Entregar el primer incremento",
            tasks: [],
            featureCodes: [],
            userStoryCodes: [],
            testCodes: [],
            dependencies: [],
            deliverables: [],
            closingCriterion: "Incremento validado",
            calendarExcludedDates: [{ date: "2026-09-05", reason: "Sábado" }],
          },
        ],
      }}
    />,
  );

  assert.match(html, /15 días hábiles · calendario Colombia/);
  assert.match(html, /1 de sept de 2026 al 21 de sept de 2026/);
  assert.match(html, /sábados, domingos y festivos nacionales/);
  assert.match(html, /5 de sept de 2026.*Sábado/s);
});

test("los formularios extensos usan divulgación progresiva y comienzan compactos", () => {
  const html = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly={false}
      sectionKey="tests"
      value={{
        scenarios: [
          {
            code: "CP-001",
            title: "Escenario principal",
            userStoryCodes: ["HU-001"],
            acceptanceCriterionCodes: ["CA-001"],
            precondition: "Datos listos",
            action: "Ejecutar",
            expectedResult: "Resultado correcto",
          },
          {
            code: "CP-002",
            title: "Escenario alterno",
            userStoryCodes: [],
            acceptanceCriterionCodes: [],
            precondition: "Datos incompletos",
            action: "Ejecutar",
            expectedResult: "Advertencia visible",
          },
        ],
      }}
    />,
  );

  assert.match(html, /Los registros están resumidos/);
  assert.equal((html.match(/<details/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<details[^>]+open/);
  assert.match(html, /2 registro\(s\)/);
});

test("objetivos, problema, alcance, RNF, pendientes y aprobaciones usan adaptadores explícitos", () => {
  const views = [
    renderToStaticMarkup(
      <DocumentSectionView
        sectionKey="objectives"
        value={{ general: "Automatizar", specific: ["Reducir reprocesos"] }}
      />,
    ),
    renderToStaticMarkup(
      <DocumentSectionView
        sectionKey="problemDescription"
        value={{
          currentState: "Proceso manual",
          operationalImpact: ["Demoras"],
        }}
      />,
    ),
    renderToStaticMarkup(
      <DocumentSectionView
        sectionKey="scope"
        value={{
          included: ["Radicación"],
          excluded: [],
          involvedSystems: ["D365"],
        }}
      />,
    ),
    renderToStaticMarkup(
      <DocumentSectionView
        sectionKey="nonFunctionalRequirements"
        value={{ security: ["Acceso por rol"], traceability: ["Auditoría"] }}
      />,
    ),
    renderToStaticMarkup(
      <DocumentSectionView
        sectionKey="assumptionsDependenciesPending"
        value={{
          pendingQuestions: ["¿Quién aprueba?"],
          contradictions: [],
          warnings: [],
        }}
      />,
    ),
    renderToStaticMarkup(
      <DocumentSectionBusinessEditor
        onChange={() => undefined}
        readOnly={false}
        sectionKey="approvalsAndChangeControl"
        value={{ approvals: [], changeControl: [] }}
      />,
    ),
  ].join("\n");

  assert.match(views, /Objetivo general/);
  assert.match(views, /Situación actual/);
  assert.match(views, /Sin exclusiones explícitamente definidas/);
  assert.match(views, /Seguridad/);
  assert.match(views, /Preguntas pendientes/);
  assert.match(views, /Aprobaciones/);
  assert.match(views, /Control de cambios/);
  assert.doesNotMatch(views, /sourceIds|\{&quot;|<pre/);
});

test("las 15 secciones se presentan y editan sin JSON ni claves técnicas", () => {
  const sourceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const values = {
    header: {
      title: "Solicitud SOAT",
      projectCode: "RQ-2026-000058",
      documentVersion: "1.0.4",
      requestingArea: "Operaciones",
      sourceIds: [sourceId],
    },
    objectives: {
      general: "Automatizar la solicitud",
      specific: ["Reducir tiempos"],
      sourceIds: [sourceId],
    },
    problemDescription: {
      currentState: "Gestión manual",
      operationalImpact: ["Demoras"],
      sourceIds: [sourceId],
    },
    scope: {
      included: ["Radicación"],
      excluded: ["Pago"],
      involvedSystems: ["Portal"],
      sourceIds: [sourceId],
    },
    solutionProposal: {
      objective: "Reducir la gestión manual",
      description: "Centralizar la radicación y su validación.",
      involvedElements: ["Portal"],
      flowAlignment: {
        currentState: "Radicación manual",
        evaluation: "Validar y centralizar la información",
        expectedResult: "Radicación trazable",
      },
    },
    processFlow: {
      nodes: [
        { id: "inicio", kind: "START", label: "Inicio", sourceIds: [sourceId] },
        { id: "fin", kind: "END", label: "Fin", sourceIds: [sourceId] },
      ],
      edges: [{ from: "inicio", to: "fin", label: null }],
      sourceIds: [sourceId],
    },
    milestones: {
      features: [
        {
          code: "F-001",
          title: "Radicar solicitud",
          userStoryCodes: ["HU-001"],
          sourceIds: [sourceId],
        },
      ],
      userStories: [
        {
          code: "HU-001",
          featureCode: "F-001",
          title: "Registrar",
          role: "Analista",
          want: "registrar",
          benefit: "gestionar",
          fields: [],
          acceptanceCriteria: [],
          sourceIds: [sourceId],
        },
      ],
    },
    nonFunctionalRequirements: {
      security: ["Acceso por rol"],
      sourceIds: [sourceId],
    },
    tests: {
      scenarios: [
        {
          code: "CP-001",
          title: "Radicación",
          expectedResult: "Registro creado",
          userStoryCodes: ["HU-001"],
          sourceIds: [sourceId],
        },
      ],
    },
    assumptionsDependenciesPending: {
      assumptions: ["Usuarios disponibles"],
      pendingQuestions: ["¿Quién aprueba?"],
      sourceIds: [sourceId],
    },
    approvalsAndChangeControl: {
      approvals: [
        { name: "Líder", status: "Pendiente", sourceIds: [sourceId] },
      ],
      changeControl: [],
      sourceIds: [sourceId],
    },
    writingRules: "Redacción clara, verificable y orientada al negocio.",
    visualFormat: "Usar títulos, tablas breves y jerarquía visual.",
    automationInstruction: "Conservar trazabilidad y revisión humana.",
    scrumPlan: {
      cadenceDays: 15,
      scheduleBasis: "RELATIVE_DAY",
      sprints: [],
      structuredAnalysis: { internal: true },
      sourceIds: [sourceId],
    },
  } as const;
  const sectionKeys = [
    ...DOCUMENT_SECTION_DEFINITIONS.map((section) => section.key),
    "scrumPlan" as const,
  ];

  const html = sectionKeys
    .flatMap((sectionKey) => {
      const value = values[sectionKey];
      return [
        renderToStaticMarkup(
          <DocumentSectionView sectionKey={sectionKey} value={value} />,
        ),
        renderToStaticMarkup(
          <DocumentSectionBusinessEditor
            onChange={() => undefined}
            readOnly={false}
            sectionKey={sectionKey}
            value={value}
          />,
        ),
      ];
    })
    .join("\n");

  assert.equal(sectionKeys.length, 15);
  assert.doesNotMatch(
    html,
    /sourceIds|structuredAnalysis|scheduleBasis|clientId|\{&quot;|<pre/i,
  );
  assert.doesNotMatch(html, new RegExp(sourceId, "i"));
});

test("los puntos de plantilla, prototipo y KPI permiten edición manual", () => {
  const editableSections = [
    ["writingRules", "Redacción clara y verificable."],
    ["visualFormat", "Prototipo organizado por pantallas."],
  ] as const;

  for (const [sectionKey, value] of editableSections) {
    const html = renderToStaticMarkup(
      <DocumentSectionBusinessEditor
        onChange={() => undefined}
        readOnly={false}
        sectionKey={sectionKey}
        value={value}
      />,
    );

    assert.match(html, /<textarea/);
    assert.doesNotMatch(html, /disabled=""/);
    assert.match(
      html,
      new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
});

test("los KPI se editan como tres indicadores estructurados, no como texto libre", () => {
  const html = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly={false}
      sectionKey="automationInstruction"
      value={{
        kpis: [1, 2, 3].map((index) => ({
          name: `Indicador ${index}`,
          relatedObjective: `Objetivo ${index}`,
          measurement: `Fórmula ${index}`,
          target: `Meta ${index}`,
        })),
        dataSource: "AZURE_DEVOPS_EXECUTION",
        currentValues: [0, 0, 0],
      }}
    />,
  );
  assert.match(html, /<textarea/);
  assert.doesNotMatch(html, /disabled=""/);
  for (const index of [1, 2, 3]) {
    assert.match(html, new RegExp(`KPI ${index}`));
    assert.match(html, new RegExp(`Objetivo ${index}`));
    assert.match(html, new RegExp(`Fórmula ${index}`));
  }
  assert.match(html, /Objetivo relacionado/);
  assert.match(html, /Medición/);
  // Un valor heredado en texto libre se presenta como los tres indicadores
  // canónicos (no queda un cuadro de texto con el contenido anterior).
  const legacy = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly={false}
      sectionKey="automationInstruction"
      value="Medir tiempos y calidad."
    />,
  );
  assert.match(legacy, /KPI 3/);
  assert.doesNotMatch(legacy, /Medir tiempos y calidad\./);
});

test("un punto histórico controlado se abre como contenido editable limpio", () => {
  const html = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly={false}
      sectionKey="writingRules"
      value={{ templateControlled: true }}
    />,
  );

  assert.match(html, /<textarea/);
  assert.match(html, /PENDIENTE POR DEFINIR/);
  assert.doesNotMatch(html, /templateControlled|template Controlled/);
});

test("el contador usa las 15 secciones reales cuando la plantilla incluye Scrum", () => {
  const withScrum: RequirementDocumentDetail = {
    ...document,
    template: { ...document.template, includesScrum: true },
    currentVersionDetail: {
      ...document.currentVersionDetail,
      sections: [
        ...document.currentVersionDetail.sections,
        {
          id: "99999999-9999-4999-8999-999999999999",
          key: "scrumPlan",
          title: "Plan Scrum sugerido de implementación",
          order: 15,
          content: {
            cadenceDays: 15,
            scheduleBasis: "RELATIVE_DAY",
            confirmedStartDate: null,
            sprints: [],
          },
          templateControlled: false,
        },
      ],
    },
  };
  const html = renderToStaticMarkup(
    <RequirementDocumentEditor initialDocument={withScrum} project={project} />,
  );
  assert.match(html, /15 secciones/);
  assert.match(html, /Sección 1 de 15/);
  assert.match(html, /Plan de trabajo/);
});

test("una versión aprobada es de consulta y el presentador no invoca IA ni red", async () => {
  const approved: RequirementDocumentDetail = {
    ...document,
    status: "APPROVED",
    currentVersionDetail: {
      ...document.currentVersionDetail,
      status: "APPROVED",
      approvedByUserId: project.ownerUserId,
      approvedAt: "2026-08-06T00:00:00.000Z",
    },
  };
  const html = renderToStaticMarkup(
    <RequirementDocumentEditor initialDocument={approved} project={project} />,
  );
  const presenter = readDocumentSectionPresenterSource();

  // La versión aprobada se indica con su estado y queda de solo lectura: no hay
  // botón de edición ni controles de guardado.
  assert.match(html, /Estado de la versión actual/);
  assert.match(html, /Aprobado/);
  assert.doesNotMatch(html, />Editar sección</);
  assert.doesNotMatch(html, />Guardar cambios</);
  assert.doesNotMatch(
    presenter,
    /fetch\(|GATEWAY_URL|openai|analysis-requests/i,
  );
});

test("navegación, guardado, concurrencia, bloqueo y confirmaciones están implementados", async () => {
  const editor = await readFile(
    "apps/web/src/app/workspace/documents/[documentId]/requirement-document-editor.tsx",
    "utf8",
  );

  assert.match(editor, /beforeunload/);
  assert.match(editor, /Cambios sin guardar/);
  assert.match(editor, /expectedRevision: version\.revision/);
  assert.match(editor, /response\.status === 409/);
  assert.match(editor, /Recargar versión/);
  assert.match(editor, /version\.status !== "DRAFT"/);
  // El bloqueo de una versión aprobada es el estado de solo lectura del editor:
  // solo DRAFT y CHANGES_REQUESTED se pueden editar.
  assert.match(
    editor,
    /const readOnly =[\s\S]*?\(version\.status !== "DRAFT" && version\.status !== "CHANGES_REQUESTED"\)/,
  );
  assert.match(editor, /La versión fue aprobada y quedó bloqueada\./);
  // Las confirmaciones usan el diálogo propio de la app, no el cuadro nativo del navegador.
  assert.match(editor, /await confirm\(\{/);
  assert.doesNotMatch(editor, /window\.confirm/);
  assert.match(editor, /Motivo de la nueva versión/);
  assert.match(editor, /Confirmar nueva versión/);
  assert.match(editor, /Comparar versiones/);
  assert.match(editor, /Historial/);
  assert.match(editor, /Historial IA/);
  assert.match(editor, /Reintentar esta generación/);
  assert.match(
    editor,
    /analysis-requests\/\$\{encodeURIComponent\(analysisRequestId\)\}\/retry/,
  );
  assert.match(editor, /No se creó otro borrador vacío/);
  assert.match(editor, /Nueva versión con IA/);
  assert.match(editor, /Importar Word corregido/);
  assert.match(editor, /RETURNED_WORD_INSTRUCTION/);
  assert.match(editor, /returned-word/);
  assert.match(editor, /Nueva versión creada desde un borrador Word corregido/);
  assert.match(editor, /purpose: "AI_VERSION"/);
  assert.match(editor, /\/workspace\/sources\?projectId=.*analysisRequestId=/);
  assert.match(editor, /window\.location\.assign/);
  assert.doesNotMatch(editor, />\s*Exportar\s*</);
});

test("Fuentes concentra selección, procesamiento y generación inicial", async () => {
  const sources = await readFile(
    "apps/web/src/app/workspace/sources/sources-workspace.tsx",
    "utf8",
  );
  assert.match(sources, /Procesar con IA/);
  assert.match(
    sources,
    /Borrador inicial generado a partir de fuentes procesadas/,
  );
  assert.doesNotMatch(sources, /Reprocesar fuente/);
  assert.match(sources, /idempotencyKey: operationKey/);
});

test("Validación concentra las exportaciones de versiones aprobadas", async () => {
  const validation = await readFile(
    "apps/web/src/app/workspace/validation/validation-workspace.tsx",
    "utf8",
  );
  assert.match(validation, /Descargas PDF/);
  assert.match(validation, /Descargas Word/);
  assert.match(validation, /Descargas Markdown/);
  assert.match(validation, /status === "APPROVED"/);
  assert.match(validation, /Esta acción\s+no ejecuta IA/);
});

test("Análisis desaparece del menú operativo y la URL anterior redirige a Documentos", async () => {
  const [shell, analysisPage] = await Promise.all([
    readFile("apps/web/src/app/app-shell.tsx", "utf8"),
    readFile("apps/web/src/app/workspace/analysis/page.tsx", "utf8"),
  ]);
  assert.doesNotMatch(shell, /href="\/workspace\/analysis"/);
  assert.match(analysisPage, /redirect\("\/workspace\/documents"\)/);
});

test("el editor es responsive y Web solo consume Gateway", async () => {
  const styles = await readStyles();
  const editor = await readFile(
    "apps/web/src/app/workspace/documents/[documentId]/requirement-document-editor.tsx",
    "utf8",
  );
  const list = await readFile(
    "apps/web/src/app/workspace/documents/documents-workspace.tsx",
    "utf8",
  );

  assert.match(styles, /@media \(max-width: 980px\)/);
  assert.match(styles, /@media \(max-width: 700px\)/);
  assert.match(styles, /\.rq-document-editor__layout/);
  assert.match(styles, /overflow-x:\s*hidden/);
  assert.match(styles, /\.rq-document-responsive-table/);
  assert.match(styles, /\.rq-process-flow__viewport/);
  assert.match(editor, /NEXT_PUBLIC_GATEWAY_URL/);
  assert.match(list, /NEXT_PUBLIC_GATEWAY_URL/);
  assert.doesNotMatch(editor, /127\.0\.0\.1:3004|documentsServiceUrl/);
  assert.doesNotMatch(list, /127\.0\.0\.1:3004|documentsServiceUrl/);
});

test("los puntos 6, 7 y 8 ofrecen pestañas, jerarquía y trazabilidad responsive", async () => {
  const presenter = readDocumentSectionPresenterSource();
  const styles = await readStyles();
  assert.match(presenter, /role="tablist"/);
  assert.match(presenter, /role="tabpanel"/);
  assert.match(presenter, /ArrowLeft/);
  assert.match(presenter, /ArrowRight/);
  assert.match(presenter, /<details/);
  assert.match(presenter, /<summary/);
  assert.match(presenter, /taskCodes/);
  assert.match(styles, /\.rq-requirements-tabs/);
  assert.match(styles, /\.rq-backlog-tree/);
  assert.match(styles, /@media \(max-width: 48rem\)/);
});

test("el estado del proyecto se resuelve con UUID de distinta capitalización", () => {
  const id = "abcdef12-abcd-4abc-8abc-abcdef123456";
  const html = renderToStaticMarkup(
    <DocumentsWorkspace
      initialProjects={{
        items: [{ ...project, id, status: "DOCUMENT_GENERATED" }],
        page: 1,
        pageSize: 50,
        totalItems: 1,
        totalPages: 1,
      }}
      initialDocuments={[
        {
          ...document,
          projectId: id.toUpperCase(),
          projectCode: project.code,
          projectTitle: project.title,
        },
      ]}
    />,
  );
  assert.match(html, /Documento generado/);
  assert.doesNotMatch(html.slice(html.indexOf("<tbody>")), />Borrador<\//);
});
