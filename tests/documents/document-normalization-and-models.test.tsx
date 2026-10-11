import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  assignPendingFunctionalStoryToMilestone,
  assignPendingPlanningItem,
  commonEpicMilestoneRoots,
  composeRequirementsContent,
  confirmedManualMilestoneOptions,
  createParentForPendingPlanningItem,
  integratedPoint6Point7Issues,
  IntegratedPoint6Point7Panel,
  DocumentSectionBusinessEditor,
  DocumentSectionView,
  RequirementStoryDetail,
  WorkPlanStages,
  hasEntityRelationshipModelContent,
  hasProcessFlowModelContent,
  normalizeApprovalsSection,
  normalizeHeaderRecord,
  normalizeNonFunctionalRequirements,
  normalizeObjectives,
  normalizePendingSection,
  normalizeProblemDescription,
  normalizeScope,
  parseProblemNarrative,
  resolveDiagramModels,
} from "../../apps/web/src/app/workspace/documents/[documentId]/document-section-presenter.js";

test("punto 6 moderno nunca se reemplaza con las HU-P del punto 7", () => {
  const requirements = {
    functionalRequirements: [
      {
        code: "HU-F-001",
        title: "Registrar activo",
        description: "Registrar el activo con sus datos funcionales.",
        milestone: "H-001",
        functionality: "Estandarización del proceso",
        milestoneDescription: "Hito funcional evidenciado.",
        role: "Gestor de activos",
        want: "registrar un activo",
        benefit: "mantener trazabilidad",
        context: "Operación de activos fijos",
        premises: [],
        impactedSystems: ["ERP"],
        fields: [],
        acceptanceCriteria: [
          {
            code: "CA-F-001-01",
            given: "existe el catálogo",
            when: "se registra el activo",
            then: "se conserva su clasificación",
            sourceIds: [],
          },
        ],
        sourceIds: [],
      },
    ],
    nonFunctionalRequirements: [],
  };
  const backlog = {
    epics: [
      {
        code: "EP-001",
        title: "Planificación",
        features: [
          {
            code: "FE-001",
            title: "Implementación",
            userStories: [
              {
                code: "HU-P-001",
                title: "Preparar implementación",
                description: "Historia exclusiva de planificación.",
                functionalRequirementCodes: ["HU-F-001"],
                tasks: [],
              },
            ],
          },
        ],
      },
    ],
  };

  const composed = composeRequirementsContent(requirements, backlog) as Record<
    string,
    any
  >;

  assert.deepEqual(composed, requirements);
  assert.equal(composed.functionalRequirements[0].code, "HU-F-001");
  assert.equal(composed.functionalRequirements[0].milestone, "H-001");
  assert.equal(composed.functionalRequirements[0].role, "Gestor de activos");
});

test("punto 6 conserva criterios históricos y los convierte a DADO CUANDO ENTONCES", () => {
  const requirements = {
    functionalRequirements: [
      {
        code: "HU-001",
        title: "Registrar activo",
        requirementType: "USER_STORY",
        acceptanceCriteria: [
          "DADO que existe un activo, CUANDO el usuario registra la clasificación, ENTONCES el sistema conserva la información.",
        ],
      },
    ],
    nonFunctionalRequirements: [],
  };

  const backlog = {
    epics: [
      {
        code: "EP-001",
        title: "Gestión de activos",
        features: [
          {
            code: "FE-001",
            title: "Catálogo",
            userStories: [
              {
                code: "HU-001",
                featureCode: "FE-001",
                title: "Registrar activo",
                description: "Registro de activo.",
                role: "Gestor",
                want: "registrar un activo",
                benefit: "mantener trazabilidad",
                context: "Proceso operativo",
                premises: [],
                impactedSystems: [],
                fields: [],
                acceptanceCriteria: [],
                sourceIds: [],
                tasks: [],
              },
            ],
          },
        ],
      },
    ],
  };

  const composed = composeRequirementsContent(requirements, backlog) as Record<
    string,
    any
  >;

  const criterion = composed.functionalRequirements[0].acceptanceCriteria[0];

  assert.match(criterion.given, /existe un activo/i);

  assert.match(criterion.when, /registra la clasificación/i);

  assert.match(criterion.then, /conserva la información/i);

  const view = renderToStaticMarkup(
    <DocumentSectionView sectionKey="milestones" value={composed} />,
  );

  const edit = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly
      sectionKey="milestones"
      value={composed}
    />,
  );

  for (const markup of [view, edit]) {
    assert.match(markup, /Criterios de aceptación/);
    assert.match(markup, /existe un activo/i);
    assert.match(markup, /registra la clasificación/i);
    assert.match(markup, /conserva la información/i);
  }
});

test("punto 6 no presenta Tasks aunque existan en la HU estructural", () => {
  const markup = renderToStaticMarkup(
    <RequirementStoryDetail
      story={{
        code: "HU-001",
        title: "Registrar activo",
        description: "Definición funcional.",
        role: "Gestor",
        want: "registrar un activo",
        benefit: "mantener trazabilidad",
        context: "Proceso de activos",
        premises: [],
        impactedSystems: [],
        fields: [],
        acceptanceCriteria: [
          {
            code: "CA-HU-001-001",
            given: "existe catálogo",
            when: "se registra",
            then: "se conserva",
            sourceIds: [],
          },
        ],
        tasks: [
          {
            code: "T-999",
            title: "Task exclusiva Punto 7",
            description: "No debe aparecer en Punto 6.",
            type: "DEVELOPMENT",
            origin: "IMPLEMENTATION_PROPOSAL",
            dependencyCodes: [],
            sourceIds: [],
          },
        ],
      }}
    />,
  );

  assert.match(markup, /Como/);
  assert.match(markup, /Descripción.*Como/s);
  assert.match(markup, /Definición funcional\./u);
  assert.match(markup, /Criterios de aceptación/);

  assert.doesNotMatch(markup, /T-999/);

  assert.doesNotMatch(markup, /Task exclusiva Punto 7/);
});

test("punto 7 presenta y edita Epic Feature HU y Task", () => {
  const backlog = {
    epics: [
      {
        code: "EP-001",
        title: "Gestión de activos",
        description: "Gestionar el ciclo de vida.",

        sourceIds: [],

        features: [
          {
            code: "FE-001",
            title: "Catálogo",
            description: "Administrar catálogo.",

            sourceIds: [],

            userStories: [
              {
                code: "HU-001",
                featureCode: "FE-001",
                title: "Registrar activo",
                description: "Registrar activo y clasificación.",

                role: "Gestor de activos",
                want: "registrar un activo",
                benefit: "mantener trazabilidad",
                context: "Proceso de activos",

                premises: [],
                impactedSystems: [],
                fields: [],

                acceptanceCriteria: [
                  {
                    code: "CA-HU-001-001",
                    given: "existe un catálogo",
                    when: "se registra un activo",
                    then: "se conserva su clasificación",
                    sourceIds: [],
                  },
                ],

                sourceIds: [],

                tasks: [
                  {
                    code: "T-001",
                    title: "Configurar catálogo",
                    description: "Configurar catálogo base.",
                    type: "CONFIGURATION",
                    origin: "IMPLEMENTATION_PROPOSAL",
                    dependencyCodes: [],
                    sourceIds: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const view = renderToStaticMarkup(
    <DocumentSectionView sectionKey="backlogStructure" value={backlog} />,
  );

  const editor = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly={false}
      sectionKey="backlogStructure"
      value={backlog}
    />,
  );

  for (const markup of [view, editor]) {
    assert.match(markup, /EP-001/);

    assert.match(markup, /FE-001/);

    assert.match(markup, /HU-001/);

    assert.match(markup, /T-001/);

    assert.match(markup, /Gestión de activos/);
  }

  assert.match(view, /Estructura detallada/);

  assert.match(view, /Expandir todo/);

  assert.match(view, /Comprimir todo/);

  assert.doesNotMatch(view, /Sprints/);

  assert.doesNotMatch(view, /Raíz común Epic ↔ Hito/u);

  assert.match(view, /Estructura detallada/);

  /*
   * Punto 7 no duplica el detalle funcional
   * que pertenece al Punto 6.
   */
  assert.doesNotMatch(view, />COMO</);

  assert.doesNotMatch(view, />QUIERO</);

  assert.doesNotMatch(view, />PARA</);

  /*
   * La estructura sí conserva las descripciones
   * de Epic, Feature, HU y Task.
   */
  assert.match(view, /Gestionar el ciclo de vida/);

  assert.match(view, /Administrar catálogo/);

  assert.match(view, /Registrar activo y clasificación/);

  assert.match(view, /Configurar catálogo base/);

  assert.match(editor, /Administración estructural/);

  assert.match(editor, /Epic padre/);

  assert.match(editor, /Feature padre/);

  assert.match(editor, /Agregar Epic/);

  assert.match(editor, /Agregar Feature/);

  assert.match(editor, /Agregar Historia de Usuario/);

  assert.match(editor, /Agregar Task/);

  assert.match(editor, /Propuesta de implementación/);

  assert.doesNotMatch(editor, /label="Epic"/);
});

test("V7.4.4 Punto 7 identifica visualmente una estructura sugerida por IA", () => {
  const backlog = {
    structureStatus: "AI_SUGGESTED",
    epics: [
      {
        code: "EP-001",
        title: "Gestión de solicitudes",
        description: "Propuesta de agrupación basada en la evidencia.",
        sourceNumber: null,
        sourceIds: [],
        features: [],
      },
    ],
  };

  const view = renderToStaticMarkup(
    <DocumentSectionView sectionKey="backlogStructure" value={backlog} />,
  );

  assert.match(view, /Estructura sugerida por IA/u);
  assert.match(view, /Propuesta no confirmada/u);
  assert.match(view, /H-001/u);
  assert.match(view, /Gestión de solicitudes/u);
  assert.match(view, /trazabilidad 1:1/u);
});

test("la vista normal conserva los Hitos persistidos aunque coincidan con códigos históricos de Feature", () => {
  const requirements = {
    functionalRequirements: [
      {
        code: "HU-001",
        title: "Registrar activo",
        description: "Definición funcional.",
        requirementType: "USER_STORY",
        milestone: "F-001",
        functionality: "Catálogo y hoja de vida de activos",
        milestoneDescription: null,
        acceptanceCriteria: [
          "DADO existe un activo, CUANDO se registra, ENTONCES se conserva.",
        ],
        sourceIds: [],
      },
    ],
    nonFunctionalRequirements: [],
  };

  const backlog = {
    epics: [
      {
        code: "EP-001",
        title: "Gestión de activos",
        description: "Gestión integral.",
        sourceIds: [],
        features: [
          {
            code: "F-001",
            title: "Catálogo y hoja de vida de activos",
            description: "Estructura del proyecto.",
            sourceIds: [],
            userStories: [
              {
                code: "HU-001",
                featureCode: "F-001",
                title: "Registrar activo",
                description: "Registrar activo.",
                role: "Gestor de activos",
                want: "registrar un activo",
                benefit: "mantener trazabilidad",
                context: "Contexto operativo",
                premises: [],
                impactedSystems: [],
                fields: [],
                acceptanceCriteria: [],
                sourceIds: [],
                tasks: [],
              },
            ],
          },
        ],
      },
    ],
  };

  const composed = composeRequirementsContent(requirements, backlog) as Record<
    string,
    any
  >;

  const functional = composed.functionalRequirements[0];

  assert.equal(functional.milestone, "F-001");
  assert.equal(functional.functionality, "Catálogo y hoja de vida de activos");

  const markup = renderToStaticMarkup(
    <DocumentSectionView sectionKey="milestones" value={composed} />,
  );

  assert.match(markup, /F-001/);
  assert.match(markup, /Catálogo y hoja de vida de activos/);
  assert.doesNotMatch(markup, /Sin código/);
});

test("punto 6 compone historias completas y conserva RNF en su pestaña", () => {
  const sourceId = "11111111-1111-4111-8111-111111111111";

  const requirements = {
    functionalRequirements: [
      {
        code: "HU-001",
        title: "Versión resumida",
        requirementType: "USER_STORY",

        milestone: "H-001",
        functionality: "Catálogo y registro de activos",
        milestoneDescription:
          "Centralizar la creación y clasificación inicial de activos.",

        category: null,
        measure: null,
        target: null,
      },
    ],

    nonFunctionalRequirements: [
      {
        code: "RNF-001",
        title: "Seguridad",
        description: "La operación debe quedar auditada.",
        requirementType: "SECURITY",
        category: "Seguridad",
        measure: "Eventos auditados",
        target: "100%",
        acceptanceCriteria: ["Toda operación sensible genera auditoría."],
        sourceIds: [sourceId],
      },
    ],
  };

  const backlog = {
    epics: [
      {
        code: "EP-001",
        title: "Gestión de activos",

        features: [
          {
            code: "FE-001",
            title: "Catálogo",

            userStories: [
              {
                code: "HU-001",
                featureCode: "FE-001",
                title: "Registrar activo",
                description: "Registro funcional del activo.",

                role: "Gestor de activos",
                want: "registrar un activo",
                benefit: "mantener trazabilidad",

                context: "La información está dispersa.",

                premises: ["Catálogo disponible"],

                impactedSystems: ["ERP"],

                fields: [
                  {
                    name: "Clasificación",
                    dataType: "Texto",
                    required: true,
                    validation: "Debe existir en catálogo",
                    sourceIds: [sourceId],
                  },
                ],

                acceptanceCriteria: [
                  {
                    code: "CA-001",
                    given: "existe una clasificación",
                    when: "se registra el activo",
                    then: "se conserva la clasificación",
                    sourceIds: [sourceId],
                  },
                ],

                sourceIds: [sourceId],
                tasks: [],
              },
            ],
          },
        ],
      },
    ],
  };

  const composed = composeRequirementsContent(requirements, backlog);

  const record = composed as Record<string, any>;

  const functional = record.functionalRequirements[0];

  assert.equal(functional.code, "HU-001");

  assert.equal(functional.role, "Gestor de activos");

  assert.equal(functional.featureCode, "FE-001");

  assert.equal(functional.epicCode, "EP-001");

  assert.equal(functional.milestone, "H-001");

  assert.equal(functional.functionality, "Catálogo y registro de activos");

  assert.equal(
    functional.milestoneDescription,
    "Centralizar la creación y clasificación inicial de activos.",
  );

  /*
   * category / measure / target NO deben
   * contaminar la HU funcional.
   */
  assert.equal("category" in functional, false);

  /*
   * El RNF permanece intacto.
   */
  assert.equal(record.nonFunctionalRequirements[0].code, "RNF-001");

  for (const markup of [
    renderToStaticMarkup(
      <DocumentSectionView sectionKey="milestones" value={composed} />,
    ),

    renderToStaticMarkup(
      <DocumentSectionBusinessEditor
        onChange={() => undefined}
        readOnly
        sectionKey="milestones"
        value={composed}
      />,
    ),
  ]) {
    assert.match(markup, /Gestor de activos/);

    assert.match(markup, /registrar un activo/);

    assert.match(markup, /mantener trazabilidad/);

    assert.match(markup, /Catálogo disponible/);

    assert.match(markup, /Clasificación/);

    assert.match(markup, /Criterios de aceptación/);

    /*
     * En la vista HITO y H-001 se renderizan en elementos
     * HTML separados. Validamos ambos valores sin exigir
     * que sean texto contiguo.
     */
    assert.match(markup, /HITO/i);

    assert.match(markup, /H-001/i);

    assert.match(markup, /Catálogo y registro de activos/);

    assert.match(markup, /Descripción del hito/);

    /*
     * Epic y Feature no forman parte de la
     * presentación funcional del Punto 6.
     */
    assert.doesNotMatch(markup, /<strong>Epic:<\/strong>/);

    assert.doesNotMatch(markup, /<strong>Feature:<\/strong>/);

    assert.match(markup, /Requerimientos no funcionales/);
  }

  const structuredView = renderToStaticMarkup(
    <DocumentSectionView sectionKey="milestones" value={composed} />,
  );
  assert.match(structuredView, /6\.1 · Requerimientos funcionales por Hito/u);
  assert.match(structuredView, /6\.2 Requerimientos no funcionales/u);
  assert.match(structuredView, /aria-label="Hito"/u);
  assert.match(structuredView, /rq-requirement-story-block/u);
  assert.ok(
    structuredView.indexOf("H-001") < structuredView.indexOf("HU-001") &&
      structuredView.indexOf("HU-001") <
        structuredView.indexOf("Criterios de aceptación"),
  );
});

test("el encabezado histórico conserva metadatos y excluye responsables", () => {
  const legacy = `Título: Ventas perdidas
Código: AF-TI-IN-003
Versión: 1.0.22
Fecha: 21/01/2025
Área solicitante: Planeación
Estado: Borrador
Elaborado por: Yeison Quinto
Revisado por: Mónica Álvarez
Aprobado por: Carlos Rivas`;
  const normalized = normalizeHeaderRecord(legacy);

  assert.equal(normalized?.title, "Ventas perdidas");
  assert.equal(normalized?.projectCode, "AF-TI-IN-003");
  assert.equal(normalized?.preparedBy, undefined);

  for (const markup of [
    renderToStaticMarkup(
      <DocumentSectionView sectionKey="header" value={legacy} />,
    ),
    renderToStaticMarkup(
      <DocumentSectionBusinessEditor
        onChange={() => undefined}
        readOnly
        sectionKey="header"
        value={legacy}
      />,
    ),
  ]) {
    assert.match(markup, /Ventas perdidas/);
    assert.match(markup, /AF-TI-IN-003/);
    assert.doesNotMatch(markup, /Yeison Quinto|Mónica Álvarez|Carlos Rivas/);
  }
});

test("la solución propuesta resume objetivo, elementos y alineación AS-IS a TO-BE", () => {
  const value = {
    objective: "Reducir la captura manual de ventas perdidas.",
    description: "Incorporar un registro guiado y trazable en CRM.",
    involvedElements: ["CRM", "Catálogo de motivos"],
    flowAlignment: {
      currentState: "El asesor registra el motivo fuera del sistema.",
      evaluation: "Se valida obligatoriedad, vigencia y trazabilidad.",
      expectedResult: "El motivo queda registrado y disponible para análisis.",
    },
  };
  const view = renderToStaticMarkup(
    <DocumentSectionView sectionKey="solutionProposal" value={value} />,
  );
  const editor = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly
      sectionKey="solutionProposal"
      value={value}
    />,
  );

  for (const markup of [view, editor]) {
    assert.match(markup, /Reducir la captura manual/u);
    assert.match(markup, /CRM/u);
    assert.match(markup, /AS-IS/u);
    assert.match(markup, /Evaluación/u);
    assert.match(markup, /TO-BE/u);
  }
});

test("objetivos separa cualitativos y cuantitativos en lectura y edición", () => {
  const value = {
    general: "Mejorar la gestión de solicitudes.",
    qualitative: ["Fortalecer la trazabilidad del proceso."],
    quantitative: ["Reducir el tiempo de atención en 30% durante 2026."],
  };

  assert.deepEqual(normalizeObjectives(value), value);

  for (const markup of [
    renderToStaticMarkup(
      <DocumentSectionView sectionKey="objectives" value={value} />,
    ),
    renderToStaticMarkup(
      <DocumentSectionBusinessEditor
        onChange={() => undefined}
        readOnly
        sectionKey="objectives"
        value={value}
      />,
    ),
  ]) {
    assert.match(markup, /Objetivos específicos cualitativos/);
    assert.match(markup, /Objetivos específicos cuantitativos/);
    assert.match(markup, /Fortalecer la trazabilidad/);
    assert.match(markup, /Reducir el tiempo de atención en 30%/);
  }

  assert.deepEqual(
    normalizeObjectives({
      general: "Objetivo histórico",
      specific: ["Mejorar la experiencia", "Atender 95% en menos de 2 días"],
    }),
    {
      general: "Objetivo histórico",
      qualitative: ["Mejorar la experiencia"],
      quantitative: ["Atender 95% en menos de 2 días"],
    },
  );

  assert.deepEqual(
    normalizeObjectives({
      general: "Objetivo general",
      qualitative: ["Mejorar la trazabilidad"],
      quantitative: [],
    }).quantitative,
    ["[PENDIENTE POR DEFINIR]"],
  );
});

test("Alcance conserva los tres KPI en datos y los presenta dentro del plan de trabajo", () => {
  const value = {
    included: ["Registro de solicitudes"],
    excluded: ["Aprobación automática"],
    involvedSystems: ["D365"],
    kpis: [1, 2, 3].map((index) => ({
      name: `KPI ${index}`,
      relatedObjective: `Objetivo ${index}`,
      measurement: `Fórmula ${index}`,
      target: `Meta ${index}`,
    })),
  };

  assert.equal(normalizeScope(value).kpis.length, 3);

  for (const markup of [
    renderToStaticMarkup(
      <DocumentSectionView sectionKey="scope" value={value} />,
    ),
    renderToStaticMarkup(
      <DocumentSectionBusinessEditor
        onChange={() => undefined}
        readOnly
        sectionKey="scope"
        value={value}
      />,
    ),
  ]) {
    assert.doesNotMatch(markup, /KPIs de estado|KPI 1|Meta 3/);
  }

  const workPlan = renderToStaticMarkup(
    <WorkPlanStages
      backlogValue={{
        epics: [
          {
            code: "EP-001",
            title: "Automatización",
            features: [
              {
                code: "FE-001",
                title: "Registro",
                userStories: [
                  {
                    code: "HU-P-001",
                    title: "Registrar solicitud",
                    tasks: [{ code: "T-001" }],
                  },
                ],
              },
            ],
          },
        ],
      }}
      scopeValue={value}
      value={{
        sprints: [
          {
            startDate: "2026-09-07",
            endDate: "2026-09-25",
            featureCodes: ["FE-001"],
            userStoryCodes: ["HU-P-001"],
            tasks: [{ code: "T-001", userStoryCode: "HU-P-001" }],
          },
        ],
      }}
    />,
  );
  // Los KPI ya no se dibujan dentro del plan de trabajo: tienen su propio punto
  // ("KPIs") y se alimentan de los datos de Alcance.
  assert.doesNotMatch(workPlan, /Diagramas de KPI|KPI 1/);
  const kpiSection = renderToStaticMarkup(
    <DocumentSectionView
      context={{ scope: value }}
      sectionKey="automationInstruction"
      value={{}}
    />,
  );
  for (const index of [1, 2, 3]) {
    assert.match(kpiSection, new RegExp(`KPI ${index}`));
  }
  assert.match(workPlan, /Programación según las tareas/);
  assert.match(workPlan, /Épicas/);
  assert.match(workPlan, /Features/);
  assert.match(workPlan, /Historias de usuario/);
  assert.match(workPlan, /EP-001/);
});

test("Descripción del problema normaliza situación e impactos sin pérdida", () => {
  const narrative = `Situación actual:
Proceso manual.

Impactos:
- Demoras
- Errores
- Reprocesos`;

  assert.deepEqual(parseProblemNarrative(narrative), {
    currentState: "Proceso manual.",
    operationalImpact: ["Demoras", "Errores", "Reprocesos"],
  });

  assert.deepEqual(
    normalizeProblemDescription({ narrative }),
    parseProblemNarrative(narrative),
  );

  for (const heading of [
    "Impacto",
    "Impactos",
    "Impacto operacional",
    "Impactos operacionales",
    "Impacto operativo",
    "Impactos operativos",
  ]) {
    assert.deepEqual(
      parseProblemNarrative(`Estado actual: Manual.\n${heading}: Demoras`),
      {
        currentState: "Manual.",
        operationalImpact: ["Demoras"],
      },
    );
  }

  assert.deepEqual(
    normalizeProblemDescription({
      currentState: "Proceso manual.",
      operationalImpact: ["Demoras"],
      narrative:
        "Situación actual: Proceso manual.\nImpactos: Errores\nActores afectados: Ventas.",
    }),
    {
      currentState: "Proceso manual.\n\nActores afectados: Ventas.",
      operationalImpact: ["Demoras", "Errores"],
    },
  );

  assert.deepEqual(
    normalizeProblemDescription({
      currentState: `Situación actual:
Proceso manual.

Problemas identificados:
- Demoras
- Errores

Actores involucrados: Ventas.`,
      operationalImpact: [],
    }),
    {
      currentState: "Proceso manual.\n\nActores involucrados: Ventas.",
      operationalImpact: ["Demoras", "Errores"],
    },
  );
});

test("alcance completa los tres KPI canónicos sin inventar cifras", () => {
  const normalized = normalizeScope({
    included: ["Registro"],
    excluded: [],
    involvedSystems: ["D365"],
    kpis: [],
  });

  // Sin KPI en los datos se completan los tres indicadores estándar de
  // ejecución: nombre, objetivo y fórmula definidos y la meta estándar 100 %.
  assert.deepEqual(
    normalized.kpis.map((kpi) => kpi.name),
    [
      "Avance general del proyecto",
      "Cumplimiento de objetivos",
      "Cumplimiento de entregables",
    ],
  );
  assert.ok(normalized.kpis.every((kpi) => kpi.target === "100%"));
  assert.ok(normalized.kpis.every((kpi) => /× 100/.test(kpi.measurement)));
  assert.ok(
    normalized.kpis.every((kpi) => !/PENDIENTE/.test(JSON.stringify(kpi))),
  );

  // Los valores presentes en los datos prevalecen sobre los estándar.
  const custom = normalizeScope({
    included: ["Registro"],
    excluded: [],
    involvedSystems: ["D365"],
    kpis: [
      {
        name: "Tiempo de ciclo",
        relatedObjective: "Reducir el tiempo de ciclo",
        measurement: "Días promedio",
        target: "5 días",
      },
    ],
  });
  assert.equal(custom.kpis.length, 3);
  assert.equal(custom.kpis[0]!.name, "Tiempo de ciclo");
  assert.equal(custom.kpis[0]!.target, "5 días");
  assert.equal(custom.kpis[1]!.name, "Cumplimiento de objetivos");

  // Alcance ya no presenta los KPI: solo incluye, exclusiones y sistemas.
  const markup = renderToStaticMarkup(
    <DocumentSectionView sectionKey="scope" value={normalized} />,
  );
  assert.doesNotMatch(markup, /KPIs de estado/);
  assert.ok(markup.indexOf("Incluye") >= 0);
  // Los tres KPI se presentan en su punto propio, sin cifras inventadas: la
  // única meta es la estándar de 100 %.
  const kpiSection = renderToStaticMarkup(
    <DocumentSectionView
      context={{ scope: normalized }}
      sectionKey="automationInstruction"
      value={{}}
    />,
  );
  assert.match(kpiSection, /Avance general del proyecto/);
  assert.match(kpiSection, /Cumplimiento de entregables/);
  assert.doesNotMatch(kpiSection, /\b(?!100\b)\d{2,}\s*%/);
});

test("supuestos, dependencias y pendientes separan la narrativa en lectura y edición", () => {
  const value = `Supuestos explícitos:
- D365 estará disponible.

Dependencias confirmadas:
- Integración con Cero Papel.

Pendientes abiertos:
- Confirmar formato del archivo.

Riesgos:
- Retraso del proveedor.`;
  const normalized = normalizePendingSection(value);

  assert.deepEqual(normalized.assumptions, ["D365 estará disponible."]);
  assert.deepEqual(normalized.dependencies, ["Integración con Cero Papel."]);
  assert.deepEqual(normalized.pendingItems, ["Confirmar formato del archivo."]);
  assert.deepEqual(normalized.warnings, ["Retraso del proveedor."]);

  for (const markup of [
    renderToStaticMarkup(
      <DocumentSectionView
        sectionKey="assumptionsDependenciesPending"
        value={value}
      />,
    ),
    renderToStaticMarkup(
      <DocumentSectionBusinessEditor
        onChange={() => undefined}
        readOnly
        sectionKey="assumptionsDependenciesPending"
        value={value}
      />,
    ),
  ]) {
    assert.match(markup, /Supuestos/);
    assert.match(markup, /Dependencias/);
    assert.match(markup, /Pendientes funcionales/);
    assert.match(markup, /D365 estará disponible/);
    assert.match(markup, /Confirmar formato del archivo/);
  }
});

test("supuestos y pendientes se resumen a tres elementos y dos contradicciones", () => {
  const fourItems = ["Uno", "Dos", "Tres", "Cuatro"];
  const normalized = normalizePendingSection({
    assumptions: fourItems,
    dependencies: fourItems,
    pendingItems: fourItems,
    pendingQuestions: fourItems,
    warnings: fourItems,
    contradictions: [
      { statementA: "A1", statementB: "B1" },
      { statementA: "A2", statementB: "B2" },
      { statementA: "A3", statementB: "B3" },
    ],
  });

  assert.equal(normalized.assumptions.length, 3);
  assert.equal(normalized.dependencies.length, 3);
  assert.equal(normalized.pendingItems.length, 3);
  assert.equal(normalized.pendingQuestions.length, 3);
  assert.equal(normalized.warnings.length, 3);
  assert.equal(normalized.contradictions.length, 2);
});

test("lectura y edición consumen la misma normalización", () => {
  const value = `Contexto actual: El registro se realiza manualmente.

Impacto operativo: Demoras; Errores; Reprocesos

Actores afectados: Ventas y servicio al cliente.`;
  const view = renderToStaticMarkup(
    <DocumentSectionView sectionKey="problemDescription" value={value} />,
  );
  const editor = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly
      sectionKey="problemDescription"
      value={value}
    />,
  );

  for (const expected of [
    "El registro se realiza manualmente.",
    "Actores afectados: Ventas y servicio al cliente.",
    "Demoras",
    "Errores",
    "Reprocesos",
  ]) {
    assert.match(view, new RegExp(expected.replaceAll(".", "\\.")));
    assert.match(editor, new RegExp(expected.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(view, /0 impactos/);
});

test("lectura conserva la narrativa útil cuando contiene un dato pendiente", () => {
  const value = `Atributos no funcionales identificados:
- Seguridad y trazabilidad: autenticación contra maestro de usuarios.
- Compatibilidad multiplataforma: funcionalidad equivalente en Android, iOS y Web.
- Rendimiento percibido real-time: [PENDIENTE POR DEFINIR]`;
  const view = renderToStaticMarkup(
    <DocumentSectionView
      sectionKey="nonFunctionalRequirements"
      value={value}
    />,
  );
  const editor = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly
      sectionKey="nonFunctionalRequirements"
      value={value}
    />,
  );

  for (const markup of [view, editor]) {
    assert.match(markup, /autenticación contra maestro de usuarios/);
    assert.match(markup, /funcionalidad equivalente en Android, iOS y Web/);
  }
  assert.match(view, /Pendiente de definición/);
  assert.match(editor, /\[PENDIENTE POR DEFINIR\]/);
});

test("requerimientos no funcionales de IA se editan en los seis campos existentes", () => {
  const firstProject = `Atributos no funcionales identificados:
- Seguridad y trazabilidad: autenticación contra maestro de usuarios; registrar ID de usuario y timestamp en cada operación; reflejar cambios de estado de usuario.
- Compatibilidad multiplataforma: funcionalidad equivalente en Android, iOS y Web para texto y carga masiva; voz en fase posterior.
- Integración en tiempo real: consultas síncronas a maestros D365 para validaciones.
- Usabilidad conversacional: opciones numeradas y resumen editable.
- Rendimiento percibido real-time: umbrales cuantitativos pendientes: [PENDIENTE POR DEFINIR].`;
  const secondProject =
    "Atributos no funcionales identificados: - Usabilidad: interfaz en español con terminología coherente y navegación simple. - Seguridad y auditoría: autenticación por credenciales; cifrado en tránsito y en reposo; logging de eventos para creación y modificaciones. - Disponibilidad y respaldo: respaldos automáticos y recuperación. - Rendimiento: procesamiento por operación sin degradación observable. - Compatibilidad/Integración: compatibilidad con navegadores corporativos; integración con D365 y Cero Papel.";

  const normalized = normalizeNonFunctionalRequirements(firstProject);
  assert.ok(normalized);
  assert.deepEqual(normalized.security, [
    "autenticación contra maestro de usuarios",
  ]);
  assert.deepEqual(normalized.traceability, [
    "registrar ID de usuario y timestamp en cada operación",
    "reflejar cambios de estado de usuario.",
  ]);
  assert.deepEqual(normalized.compatibility, [
    "funcionalidad equivalente en Android, iOS y Web para texto y carga masiva",
    "voz en fase posterior.",
    "consultas síncronas a maestros D365 para validaciones.",
  ]);

  for (const value of [firstProject, secondProject]) {
    const view = renderToStaticMarkup(
      <DocumentSectionView
        sectionKey="nonFunctionalRequirements"
        value={value}
      />,
    );
    const editor = renderToStaticMarkup(
      <DocumentSectionBusinessEditor
        onChange={() => undefined}
        readOnly
        sectionKey="nonFunctionalRequirements"
        value={value}
      />,
    );

    for (const label of [
      "Seguridad",
      "Trazabilidad",
      "Rendimiento",
      "Compatibilidad",
      "Usabilidad",
    ]) {
      assert.match(view, new RegExp(label));
      assert.match(editor, new RegExp(label));
    }
    assert.match(editor, /Disponibilidad/);
    assert.doesNotMatch(editor, /Atributos no funcionales identificados/);
  }
});

test("aprobaciones conserva responsables aunque exista una decisión pendiente", () => {
  const value = `Responsables documentados:
- Elaborado por: Yeison Quinto
- Revisado por: Mónica Álvarez
- Aprobado por: Carlos Rivas

[PENDIENTE POR DEFINIR]`;
  const view = renderToStaticMarkup(
    <DocumentSectionView
      sectionKey="approvalsAndChangeControl"
      value={value}
    />,
  );
  const editor = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly
      sectionKey="approvalsAndChangeControl"
      value={value}
    />,
  );

  const normalized = normalizeApprovalsSection(value);
  assert.deepEqual(
    normalized.approvals.map((approval) => approval.responsibility),
    ["Elaboración", "Revisión", "Aprobación"],
  );
  assert.ok(
    normalized.approvals.every(
      (approval) => approval.approvalMoment === "[PENDIENTE POR DEFINIR]",
    ),
  );

  for (const markup of [view, editor]) {
    assert.match(markup, /Yeison Quinto/);
    assert.match(markup, /Mónica Álvarez/);
    assert.match(markup, /Carlos Rivas/);
    assert.match(markup, /momento de aprobación/i);
    assert.match(markup, /Pendiente de definición/);
  }
});

test("V3 conserva AS-IS, TO-BE y entidad-relación; V2 sigue histórico", () => {
  const asIs = {
    title: "AS-IS guardado",
    nodes: [{ id: "as-is-start", kind: "START", label: "Inicio" }],
    edges: [],
  };
  const toBe = {
    title: "TO-BE guardado",
    nodes: [{ id: "to-be-start", kind: "START", label: "Inicio futuro" }],
    edges: [],
  };
  const entityRelationship = {
    title: "ER guardado",
    entities: [{ id: "request", name: "Solicitud", attributes: [] }],
    relationships: [],
  };
  const v3 = resolveDiagramModels({
    processFlows: { asIs, toBe },
    entityRelationship,
  });

  assert.equal(v3.historical, false);
  assert.deepEqual(v3.asIs, asIs);
  assert.deepEqual(v3.toBe, toBe);
  assert.deepEqual(v3.entityRelationship, entityRelationship);
  assert.equal(hasProcessFlowModelContent(v3.asIs), true);
  assert.equal(hasProcessFlowModelContent(v3.toBe), true);
  assert.equal(hasEntityRelationshipModelContent(v3.entityRelationship), true);

  const v3WithoutEvidence = resolveDiagramModels({
    processFlows: {
      asIs: { title: "AS-IS", nodes: [], edges: [], lanes: [] },
      toBe: { title: "TO-BE", nodes: [], edges: [], lanes: [] },
    },
    entityRelationship: {
      title: "ER",
      entities: [],
      relationships: [],
    },
  });
  assert.equal(v3WithoutEvidence.historical, false);
  assert.equal(hasProcessFlowModelContent(v3WithoutEvidence.asIs), false);
  assert.equal(hasProcessFlowModelContent(v3WithoutEvidence.toBe), false);
  assert.equal(
    hasEntityRelationshipModelContent(v3WithoutEvidence.entityRelationship),
    false,
  );

  const v2 = resolveDiagramModels(asIs);
  assert.equal(v2.historical, true);
  assert.deepEqual(v2.asIs, asIs);
  assert.equal(v2.toBe, null);
  assert.equal(v2.entityRelationship, null);
});

test("las tres pestañas conservan dimensiones en hover, foco y activo", async () => {
  const css = await readFile("libs/shared/ui/src/styles.css", "utf8");
  const base = css.match(
    /\.rq-diagram-model-tabs button \{([\s\S]*?)\n\}/u,
  )?.[1];
  const interactive = css.match(
    /\.rq-diagram-model-tabs button:hover,[\s\S]*?\{([\s\S]*?)\n\}/u,
  )?.[1];
  const active = css.match(
    /\.rq-diagram-model-tabs button\.is-active \{([\s\S]*?)\n\}/u,
  )?.[1];

  for (const block of [base, interactive, active]) {
    assert.ok(block);
    assert.match(block, /height: 42px;/);
    assert.match(block, /min-height: 42px;/);
    assert.match(block, /max-height: 42px;/);
    assert.match(block, /padding: 8px var\(--rq-space-3\);/);
  }
  assert.match(base ?? "", /box-sizing: border-box;/);
  assert.match(base ?? "", /width: 100%;/);
});

test("la sección de diagramas exporta únicamente el modelo seleccionado como PNG", async () => {
  const source = await readFile(
    new URL(
      "../../apps/web/src/app/workspace/documents/[documentId]/requirement-document-editor.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /Exportar imagen/);
  assert.match(source, /activeSection\.key === "processFlow"/);
  assert.match(source, /\[role="tab"\]\[aria-selected="true"\]/);
  assert.match(source, /\[role="tabpanel"\]/);
  assert.match(source, /activePanel\?\.querySelector<SVGSVGElement>\("svg"\)/);
  assert.match(source, /XMLSerializer/);
  assert.match(source, /"image\/png"/);
});

test("Punto 6 muestra las HU pendientes por asignar al final y completamente documentadas", () => {
  const sourceId = "11111111-1111-4111-8111-111111111111";

  const value = {
    functionalRequirements: [
      {
        code: "HU-F-001",
        title: "Registrar herramienta",
        description: "Registro funcional de una herramienta.",
        functionalNeedCodes: ["FN-001"],
        assignmentStatus: "ASSIGNED",
        milestone: "H-001",
        functionality: "Gestión de herramientas",
        milestoneDescription: "Gestionar el ciclo funcional de herramientas.",
        assignmentObservation: null,
        role: "Gestor",
        want: "registrar una herramienta",
        benefit: "mantener trazabilidad",
        context: "Gestión operativa",
        premises: [],
        impactedSystems: ["NAVI"],
        fields: [],
        acceptanceCriteria: [
          {
            code: "CA-F-001-01",
            given: "existe información de la herramienta",
            when: "el gestor registra la herramienta",
            then: "el sistema conserva el registro",
            sourceIds: [sourceId],
          },
        ],
        sourceIds: [sourceId],
      },
      {
        code: "HU-F-002",
        title: "Gestionar garantía del activo",
        description: "Registrar y consultar la garantía del activo.",
        functionalNeedCodes: ["FN-002"],
        assignmentStatus: "PENDING_ASSIGNMENT",
        milestone: null,
        functionality: null,
        milestoneDescription: null,
        assignmentObservation:
          "La evidencia completa la HU, pero no determina el Hito.",
        role: "Responsable de activos",
        want: "registrar y consultar la garantía de un activo",
        benefit: "controlar la vigencia de la garantía",
        context: "Gestión de garantías",
        premises: ["El activo debe existir."],
        impactedSystems: ["NAVI"],
        fields: [],
        acceptanceCriteria: [
          {
            code: "CA-F-002-01",
            given: "existe un activo con información de garantía",
            when: "el responsable consulta la garantía",
            then: "el sistema muestra su vigencia",
            sourceIds: [sourceId],
          },
        ],
        sourceIds: [sourceId],
      },
    ],
    nonFunctionalRequirements: [],
  };

  const view = renderToStaticMarkup(
    <DocumentSectionView sectionKey="milestones" value={value} />,
  );

  const editor = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly
      sectionKey="milestones"
      value={value}
    />,
  );

  for (const markup of [view, editor]) {
    assert.match(markup, /Historias de usuario pendientes por asignar/u);
    assert.match(markup, /HU-F-002/u);
    assert.match(markup, /Gestionar garantía del activo/u);
    assert.match(markup, /Responsable de activos/u);
    assert.match(markup, /registrar y consultar la garantía/u);
    assert.match(markup, /no determina el Hito/u);
    assert.match(markup, /FN-002/u);
  }

  assert.ok(
    view.indexOf("H-001") <
      view.indexOf("Historias de usuario pendientes por asignar"),
  );
});

test("Punto 6 muestra FN preservadas como pendientes de documentar sin fabricar una HU-F", () => {
  const sourceId = "11111111-1111-4111-8111-111111111111";

  const value = {
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    pendingFunctionalNeeds: [
      {
        code: "FN-004",
        description:
          "Definir una regla funcional todavía no documentada como HU.",
        status: "PENDING_DOCUMENTATION",
        reason:
          "La necesidad existe en la evidencia, pero todavía no hay una HU-F completa.",
        sourceIds: [sourceId],
      },
    ],
  };

  const view = renderToStaticMarkup(
    <DocumentSectionView sectionKey="milestones" value={value} />,
  );

  const editor = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly
      sectionKey="milestones"
      value={value}
    />,
  );

  for (const markup of [view, editor]) {
    assert.match(markup, /Necesidades funcionales pendientes de documentar/u);
    assert.match(markup, /FN-004/u);
    assert.match(markup, /Pendiente de documentar como HU-F/u);
    assert.match(markup, /todavía no hay una HU-F completa/u);
    assert.match(markup, /Evidencia conservada:.*1 fuente/u);
  }
});

test("V4.7.9 Punto 6 muestra una HU-F pendiente de documentación sin confundirla con asignación", () => {
  const value = {
    functionalRequirements: [
      {
        code: "HU-F-012",
        title: "Configuración del módulo",
        description: "Configuración del módulo",
        assignmentStatus: "ASSIGNED",
        documentationStatus: "PENDING_DOCUMENTATION",
        documentationObservation:
          "Faltan rol, beneficio, contexto y criterios de aceptación.",
        milestone: "H-001",
        functionality: "Operación",
        milestoneDescription: "Operación confirmada",
        assignmentObservation: null,
        role: "[PENDIENTE POR DEFINIR]",
        want: "Configurar el módulo",
        benefit: "[PENDIENTE POR DEFINIR]",
        context: "[PENDIENTE POR DEFINIR]",
        premises: [],
        impactedSystems: [],
        fields: [],
        acceptanceCriteria: [],
        functionalNeedCodes: [],
        sourceIds: ["11111111-1111-4111-8111-111111111111"],
      },
    ],
    nonFunctionalRequirements: [],
    pendingFunctionalNeeds: [],
  };

  const view = renderToStaticMarkup(
    <DocumentSectionView sectionKey="milestones" value={value} />,
  );
  const editor = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly
      sectionKey="milestones"
      value={value}
    />,
  );

  for (const markup of [view, editor]) {
    assert.match(markup, /HU-F-012/u);
    assert.match(markup, /Configuración del módulo/u);
    assert.match(markup, /Estado documental: Pendiente de documentación/u);
    assert.match(markup, /Faltan rol, beneficio, contexto/u);
    assert.match(markup, /Criterios de aceptación/u);
    assert.match(markup, /Pendientes de documentación/u);
    assert.doesNotMatch(markup, /Pendiente de asignación estructural/u);
  }
});

test("Punto 5 muestra Feature, HU-P y Task pendientes debajo del árbol sin inventar padres", () => {
  const sourceId = "11111111-1111-4111-8111-111111111111";

  const backlog = {
    structureStatus: "CONFIRMED",
    epics: [],
    pendingAssignments: {
      features: [
        {
          assignmentStatus: "PENDING_ASSIGNMENT",
          assignmentObservation: "No existe una Epic padre inequívoca.",
          sourceParentPath: null,
          item: {
            code: "FE-900",
            title: "Feature sin Epic",
            description: "Feature preservada.",
            sourceNumber: "9.1",
            sourceIds: [sourceId],
            userStories: [],
          },
        },
      ],
      userStories: [
        {
          assignmentStatus: "PENDING_ASSIGNMENT",
          assignmentObservation: "No existe una Feature padre inequívoca.",
          sourceParentPath: "1/",
          item: {
            code: "HU-P-900",
            title: "HU-P sin Feature",
            description: "HU-P preservada.",
            sourceNumber: "1.9.1",
            functionalRequirementCodes: [],
            sourceIds: [sourceId],
            tasks: [],
          },
        },
      ],
      tasks: [
        {
          assignmentStatus: "PENDING_ASSIGNMENT",
          assignmentObservation: "No existe una HU-P padre inequívoca.",
          sourceParentPath: "1/1.2/",
          item: {
            code: "T-900",
            title: "Task sin HU-P",
            description: "Task preservada.",
            sourceNumber: "1.2.9.1",
            type: "ANALYSIS",
            origin: "EVIDENCE",
            dependencyCodes: [],
            sourceIds: [sourceId],
          },
        },
      ],
    },
  };

  const view = renderToStaticMarkup(
    <DocumentSectionView sectionKey="backlogStructure" value={backlog} />,
  );

  const editor = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly
      sectionKey="backlogStructure"
      value={backlog}
    />,
  );

  for (const markup of [view, editor]) {
    assert.match(markup, /Elementos de planificación pendientes por asignar/u);
    assert.match(markup, /Features sin Epic \(1\)/u);
    assert.match(markup, /HU-P sin Feature \(1\)/u);
    assert.match(markup, /Tasks sin HU-P \(1\)/u);
    assert.match(markup, /Feature sin Epic/u);
    assert.match(markup, /HU-P sin Feature/u);
    assert.match(markup, /Task sin HU-P/u);
    assert.match(markup, /Pendiente por asignar/u);
  }
});

test("Punto 6 V4.7.6 permite organizar HU-F con Hitos confirmados o sugeridos", () => {
  const backlog = {
    structureStatus: "CONFIRMED",
    epics: [
      {
        code: "EP-001",
        title: "Compra AF",
        description: "Hito de compra de activos fijos.",
        sourceIds: [],
        features: [],
      },
    ],
    pendingAssignments: {
      features: [],
      userStories: [],
      tasks: [],
    },
  };

  assert.deepEqual(confirmedManualMilestoneOptions(backlog), [
    {
      code: "H-001",
      title: "Compra AF",
      description: "Hito de compra de activos fijos.",
    },
  ]);

  assert.deepEqual(
    confirmedManualMilestoneOptions({
      ...backlog,
      structureStatus: "AI_SUGGESTED",
    }),
    [
      {
        code: "H-001",
        title: "Compra AF",
        description: "Hito de compra de activos fijos.",
      },
    ],
  );

  const requirements = [
    {
      code: "HU-F-001",
      title: "Registrar compra",
      assignmentStatus: "PENDING_ASSIGNMENT",
      assignmentObservation: "Pendiente de ubicación.",
      milestone: null,
      functionality: null,
      milestoneDescription: null,
      role: "Solicitante",
      want: "registrar la compra",
      benefit: "iniciar el proceso",
      acceptanceCriteria: [
        {
          code: "CA-F-001-01",
          given: "existe una solicitud",
          when: "se registra",
          then: "queda trazable",
          sourceIds: [],
        },
      ],
      functionalNeedCodes: ["FN-001"],
      sourceIds: [],
    },
  ];

  const assigned = assignPendingFunctionalStoryToMilestone(
    requirements,
    backlog,
    "HU-F-001",
    "H-001",
  ) as Array<Record<string, unknown>>;

  assert.equal(assigned[0]?.assignmentStatus, "ASSIGNED");
  assert.equal(assigned[0]?.milestone, "H-001");
  assert.equal(assigned[0]?.functionality, "Compra AF");
  assert.equal(
    assigned[0]?.milestoneDescription,
    "Hito de compra de activos fijos.",
  );
  assert.equal(assigned[0]?.assignmentObservation, null);
});

test("Punto 6 V4.7.6 asigna pendientes de Punto 7 sin inventar relaciones", () => {
  const backlog = {
    structureStatus: "CONFIRMED",
    epics: [
      {
        code: "EP-001",
        title: "Compra AF",
        description: "Compra.",
        sourceNumber: "1",
        sourceIds: [],
        features: [
          {
            code: "FE-001",
            title: "Solicitudes",
            description: "Solicitudes.",
            sourceNumber: "1.1",
            sourceIds: [],
            userStories: [
              {
                code: "HU-P-001",
                title: "Radicar solicitud",
                description: "Planificar radicación.",
                sourceNumber: "1.1.1",
                functionalRequirementCodes: [],
                sourceIds: [],
                tasks: [],
              },
            ],
          },
        ],
      },
    ],
    pendingAssignments: {
      features: [
        {
          assignmentStatus: "PENDING_ASSIGNMENT",
          assignmentObservation: "Sin Epic.",
          sourceParentPath: null,
          item: {
            code: "FE-002",
            title: "Aprobaciones",
            description: "Aprobaciones.",
            sourceNumber: "9.1",
            sourceIds: [],
            userStories: [],
          },
        },
      ],
      userStories: [
        {
          assignmentStatus: "PENDING_ASSIGNMENT",
          assignmentObservation: "Sin Feature.",
          sourceParentPath: null,
          item: {
            code: "HU-P-002",
            title: "Revisar solicitud",
            description: "Planificar revisión.",
            sourceNumber: "9.1.1",
            functionalRequirementCodes: [],
            sourceIds: [],
            tasks: [],
          },
        },
      ],
      tasks: [
        {
          assignmentStatus: "PENDING_ASSIGNMENT",
          assignmentObservation: "Sin HU-P.",
          sourceParentPath: null,
          item: {
            code: "T-001",
            title: "Validar campos",
            description: "Validar campos.",
            sourceNumber: "9.1.1.1",
            type: "TESTING",
            origin: "EVIDENCE",
            dependencyCodes: [],
            sourceIds: [],
          },
        },
      ],
    },
  };

  const withFeature = assignPendingPlanningItem(
    backlog,
    "features",
    0,
    "EP-001",
  ) as Record<string, any>;

  assert.equal(
    withFeature.epics[0].features.some(
      (feature: Record<string, unknown>) => feature.code === "FE-002",
    ),
    true,
  );
  assert.equal(withFeature.pendingAssignments.features.length, 0);

  const withCreatedFeature = createParentForPendingPlanningItem(
    withFeature,
    "userStories",
    0,
    "EP-001",
    "Revisión manual",
  ) as Record<string, any>;

  const createdFeature = withCreatedFeature.epics[0].features.find(
    (feature: Record<string, unknown>) => feature.title === "Revisión manual",
  );
  assert.ok(createdFeature);
  assert.equal(createdFeature.userStories[0].code, "HU-P-002");
  assert.equal(withCreatedFeature.pendingAssignments.userStories.length, 0);

  const withCreatedStory = createParentForPendingPlanningItem(
    withCreatedFeature,
    "tasks",
    0,
    "FE-001",
    "Preparar validación",
  ) as Record<string, any>;

  const createdStory = withCreatedStory.epics[0].features[0].userStories.find(
    (story: Record<string, unknown>) => story.title === "Preparar validación",
  );
  assert.ok(createdStory);
  assert.match(String(createdStory.code), /^HU-P-\d+$/u);
  assert.equal(createdStory.tasks[0].code, "T-001");
  assert.equal(withCreatedStory.pendingAssignments.tasks.length, 0);
});

test("Punto 6 V4.7.6 muestra controles manuales de asignación sin automatizar el padre", () => {
  const milestones = {
    functionalRequirements: [
      {
        code: "HU-F-001",
        title: "Registrar compra",
        assignmentStatus: "PENDING_ASSIGNMENT",
        assignmentObservation: "Pendiente de ubicación.",
        milestone: null,
        functionality: null,
        milestoneDescription: null,
        role: "Solicitante",
        want: "registrar compra",
        benefit: "iniciar proceso",
        context: "Compra",
        premises: [],
        impactedSystems: [],
        fields: [],
        acceptanceCriteria: [
          {
            code: "CA-F-001-01",
            given: "existe solicitud",
            when: "se registra",
            then: "queda trazable",
            sourceIds: [],
          },
        ],
        functionalNeedCodes: ["FN-001"],
        sourceIds: [],
      },
    ],
    nonFunctionalRequirements: [],
  };

  const backlog = {
    structureStatus: "CONFIRMED",
    epics: [
      {
        code: "EP-001",
        title: "Compra AF",
        description: "Compra.",
        sourceIds: [],
        features: [],
      },
    ],
    pendingAssignments: {
      features: [
        {
          assignmentStatus: "PENDING_ASSIGNMENT",
          assignmentObservation: "Sin Epic.",
          sourceParentPath: null,
          item: {
            code: "FE-002",
            title: "Aprobaciones",
            description: "Aprobaciones.",
            sourceIds: [],
            userStories: [],
          },
        },
      ],
      userStories: [],
      tasks: [],
    },
  };

  const point6 = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      context={{ backlogStructure: backlog }}
      onChange={() => undefined}
      readOnly={false}
      sectionKey="milestones"
      value={milestones}
    />,
  );
  assert.match(point6, /Asignar a Hito confirmado/u);
  assert.match(point6, /Asignar HU-F/u);
  assert.match(point6, /H-001/u);
  assert.doesNotMatch(point6, /Raíz común Epic ↔ Hito/u);

  const point7 = renderToStaticMarkup(
    <DocumentSectionBusinessEditor
      onChange={() => undefined}
      readOnly={false}
      sectionKey="backlogStructure"
      value={backlog}
    />,
  );
  assert.match(point7, /Asignar a padre existente/u);
  assert.match(point7, /Crear padre y asignar/u);
});

test("Punto 7 V4.7.7 integra Epic/Hito y conserva Hitos confirmados aun con cero HU-F", () => {
  const milestones = {
    functionalRequirements: [
      {
        code: "HU-F-001",
        title: "Registrar compra",
        assignmentStatus: "ASSIGNED",
        assignmentObservation: null,
        milestone: "H-001",
        functionality: "Compra AF",
        milestoneDescription: "Compra de activos fijos.",
        role: "Solicitante",
        want: "registrar la compra",
        benefit: "iniciar el proceso",
        context: "Compra",
        premises: [],
        impactedSystems: [],
        fields: [],
        acceptanceCriteria: [],
        functionalNeedCodes: ["FN-001"],
        sourceIds: [],
      },
      {
        code: "HU-F-002",
        title: "Consultar inventario",
        assignmentStatus: "PENDING_ASSIGNMENT",
        assignmentObservation: "Pendiente de ubicación.",
        milestone: null,
        functionality: null,
        milestoneDescription: null,
        role: "Usuario",
        want: "consultar el inventario",
        benefit: "conocer disponibilidad",
        context: "Inventario",
        premises: [],
        impactedSystems: [],
        fields: [],
        acceptanceCriteria: [],
        functionalNeedCodes: ["FN-002"],
        sourceIds: [],
      },
    ],
    nonFunctionalRequirements: [],
  };

  const backlog = {
    structureStatus: "CONFIRMED",
    epics: [
      {
        code: "EP-001",
        title: "Compra AF",
        description: "Compra de activos fijos.",
        sourceIds: [],
        features: [
          {
            code: "FE-001",
            title: "Solicitudes",
            description: "Solicitudes de compra.",
            sourceIds: [],
            userStories: [
              {
                code: "HU-P-001",
                title: "Planificar radicación",
                description: "Planificación de la radicación.",
                functionalRequirementCodes: ["HU-F-001"],
                sourceIds: [],
                tasks: [
                  {
                    code: "T-001",
                    title: "Configurar formulario",
                    description: "Configurar formulario.",
                    type: "CONFIGURATION",
                    origin: "IMPLEMENTATION_PROPOSAL",
                    dependencyCodes: [],
                    sourceIds: [],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        code: "EP-002",
        title: "Administración AF",
        description: "Administración de activos fijos.",
        sourceIds: [],
        features: [],
      },
    ],
    pendingAssignments: {
      features: [],
      userStories: [],
      tasks: [],
    },
  };

  assert.deepEqual(
    commonEpicMilestoneRoots(milestones, backlog).map((root) => ({
      milestoneCode: root.milestoneCode,
      epicCode: root.epicCode,
      title: root.title,
      functionalStoryCount: root.functionalStoryCount,
    })),
    [
      {
        milestoneCode: "H-001",
        epicCode: "EP-001",
        title: "Compra AF",
        functionalStoryCount: 1,
      },
      {
        milestoneCode: "H-002",
        epicCode: "EP-002",
        title: "Administración AF",
        functionalStoryCount: 0,
      },
    ],
  );

  assert.deepEqual(integratedPoint6Point7Issues(milestones, backlog), []);

  const point6 = renderToStaticMarkup(
    <DocumentSectionView
      context={{ backlogStructure: backlog }}
      sectionKey="milestones"
      value={milestones}
    />,
  );
  assert.doesNotMatch(point6, /Raíz común Epic ↔ Hito/u);
  assert.match(point6, /aria-label="Hito"/u);
  assert.match(point6, /Product Backlog Item/u);
  assert.match(point6, /<details[^>]* open=""/u);
  assert.match(point6, /H-002/u);
  assert.match(
    point6,
    /Hito confirmado sin Historias de Usuario documentadas/u,
  );

  const selectedStructure = renderToStaticMarkup(
    <IntegratedPoint6Point7Panel
      backlogValue={backlog}
      collapsed
      requirementsValue={milestones}
    />,
  );
  assert.match(selectedStructure, /Estructura seleccionada/u);
  assert.doesNotMatch(selectedStructure, /rq-work-item-icon--epic/u);
  assert.match(selectedStructure, /Raíz común Epic ↔ Hito/u);
  assert.match(selectedStructure, /H-001 ↔ EP-001/u);
  assert.match(selectedStructure, /H-002 ↔ EP-002/u);
  assert.match(selectedStructure, /0 HU-F/u);

  const point7 = renderToStaticMarkup(
    <DocumentSectionView
      context={{ milestones }}
      sectionKey="backlogStructure"
      value={backlog}
    />,
  );
  assert.doesNotMatch(point7, /Raíz común Epic ↔ Hito/u);
  assert.doesNotMatch(point7, /H-001 ↔ EP-001/u);
  assert.match(point7, /Estructura detallada/u);
});

test("Punto 7 V4.7.7 detecta inconsistencias cruzadas sin reasignarlas automáticamente", () => {
  const backlog = {
    structureStatus: "CONFIRMED",
    epics: [
      {
        code: "EP-001",
        title: "Compra AF",
        description: "Compra.",
        sourceIds: [],
        features: [
          {
            code: "FE-001",
            title: "Solicitudes",
            description: "Solicitudes.",
            sourceIds: [],
            userStories: [],
          },
        ],
      },
    ],
    pendingAssignments: {
      features: [
        {
          assignmentStatus: "PENDING_ASSIGNMENT",
          assignmentObservation: "Sin Epic.",
          sourceParentPath: null,
          item: {
            code: "FE-001",
            title: "Duplicada",
            description: "Duplicada.",
            sourceIds: [],
            userStories: [],
          },
        },
      ],
      userStories: [],
      tasks: [],
    },
  };

  const milestones = {
    functionalRequirements: [
      {
        code: "HU-F-001",
        assignmentStatus: "ASSIGNED",
        milestone: "H-001",
        functionality: "Nombre distinto",
        milestoneDescription: "Compra.",
      },
      {
        code: "HU-F-002",
        assignmentStatus: "PENDING_ASSIGNMENT",
        assignmentObservation: "Pendiente.",
        milestone: "H-999",
        functionality: null,
        milestoneDescription: null,
      },
    ],
  };

  const issues = integratedPoint6Point7Issues(
    milestones as any,
    backlog as any,
  ).join("\n");

  assert.match(issues, /HU-F-001.*nombre del Hito/u);
  assert.match(issues, /HU-F-002.*PENDING_ASSIGNMENT/u);
  assert.match(issues, /Feature FE-001.*árbol.*PENDING_ASSIGNMENT/u);

  const suggestedIssues = integratedPoint6Point7Issues(
    {
      functionalRequirements: [
        {
          code: "HU-F-003",
          assignmentStatus: "ASSIGNED",
          milestone: "H-001",
          functionality: "Compra AF",
        },
      ],
    } as any,
    {
      ...backlog,
      structureStatus: "AI_SUGGESTED",
      pendingAssignments: {
        features: [],
        userStories: [],
        tasks: [],
      },
    } as any,
  ).join("\n");

  assert.equal(suggestedIssues, "");
});
