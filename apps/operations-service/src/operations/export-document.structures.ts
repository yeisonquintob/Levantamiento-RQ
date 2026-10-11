import {
  conciseFunctionalStoryDescription,
  type DocumentJsonValue,
} from "@levantamiento-rq/shared-contracts";
import {
  businessText,
  businessValue,
  jsonRecord,
  jsonRecords,
  label,
  optionalBusinessValue,
  recordText,
  uniqueTexts,
  versionSection,
  visibleText,
} from "./export-document.text";
import {
  type ExportContentLine,
  type ExportContentTable,
  type ExportFlowDiagram,
  type ExportFlowEdge,
  type ExportFlowLane,
  type ExportFlowNode,
  type RenderApprovedDocumentInput,
} from "./export-document.types";

export function structuredFlowDiagram(
  content: Readonly<Record<string, DocumentJsonValue>>,
): ExportFlowDiagram | null {
  const lanes = jsonRecords(content.lanes)
    .map((lane): ExportFlowLane | null => {
      const id = businessValue(lane.id);
      const name = businessValue(lane.name);
      const kind = businessValue(lane.kind).toUpperCase();
      return id && name
        ? { id, name, kind: kind === "SYSTEM" ? "SYSTEM" : "ACTOR" }
        : null;
    })
    .filter((lane) => lane !== null);
  const nodes = jsonRecords(content.nodes)
    .map((node): ExportFlowNode | null => {
      const id = businessValue(node.id);
      const nodeLabel = businessValue(node.label);
      const rawKind = businessValue(node.kind).toUpperCase();
      const kind = [
        "START",
        "ACTOR",
        "PROCESS",
        "DECISION",
        "SYSTEM",
        "END",
      ].includes(rawKind)
        ? (rawKind as ExportFlowNode["kind"])
        : "PROCESS";
      const laneId = recordText(node, "laneId");
      return id && nodeLabel ? { id, label: nodeLabel, kind, laneId } : null;
    })
    .filter((node) => node !== null);
  const ids = new Set(nodes.map((node) => node.id));
  const edges = jsonRecords(content.edges)
    .map((edge): ExportFlowEdge | null => {
      const from = businessValue(edge.from);
      const to = businessValue(edge.to);
      if (!ids.has(from) || !ids.has(to)) return null;
      const edgeLabel = edge.label === null ? null : businessValue(edge.label);
      return {
        from,
        to,
        label: edgeLabel && edgeLabel !== "Sin información" ? edgeLabel : null,
      };
    })
    .filter((edge) => edge !== null);
  if (nodes.length === 0 || edges.length === 0) return null;
  return {
    title: recordText(content, "title") ?? "Flujo funcional",
    nodes,
    edges,
    objective: recordText(content, "objective"),
    lanes,
  };
}

export function structuredFlowSteps(
  content: Readonly<Record<string, DocumentJsonValue>>,
): readonly string[] {
  const nodes = jsonRecords(content.nodes);
  const edges = jsonRecords(content.edges);
  if (nodes.length === 0 || edges.length === 0) return [];
  const labels = new Map(
    nodes.map((node) => [visibleText(node.id), visibleText(node.label)]),
  );
  return edges.map((edge) => {
    const from = labels.get(visibleText(edge.from)) ?? visibleText(edge.from);
    const to = labels.get(visibleText(edge.to)) ?? visibleText(edge.to);
    const condition = edge.label === null ? "" : visibleText(edge.label);
    return condition && condition !== "Sin información"
      ? `${from} -> ${condition} -> ${to}`
      : `${from} -> ${to}`;
  });
}

export function flowDiagramFromSteps(
  title: string,
  steps: readonly string[],
): ExportFlowDiagram | null {
  if (steps.length === 0) return null;
  const idByLabel = new Map<string, string>();
  const nodes: ExportFlowNode[] = [];
  const nodeId = (nodeLabel: string): string => {
    const normalized = businessText(nodeLabel);
    const existing = idByLabel.get(normalized);
    if (existing) return existing;
    const id = `node-${nodes.length + 1}`;
    idByLabel.set(normalized, id);
    nodes.push({
      id,
      label: normalized,
      kind: /^(?:inicio|start)$/iu.test(normalized)
        ? "START"
        : /^(?:fin|end)$/iu.test(normalized)
          ? "END"
          : /\?|validar|confirmar|existe|autorizad/iu.test(normalized)
            ? "DECISION"
            : "PROCESS",
    });
    return id;
  };
  const edges: ExportFlowEdge[] = [];
  for (const step of steps) {
    const parts = step
      .split(/\s*->\s*/u)
      .map(businessText)
      .filter(Boolean);
    if (parts.length < 2) continue;
    const from = nodeId(parts[0] ?? "");
    const to = nodeId(parts.at(-1) ?? "");
    edges.push({
      from,
      to,
      label: parts.length > 2 ? parts.slice(1, -1).join(" / ") : null,
    });
  }
  return edges.length ? { title, nodes, edges } : null;
}

export function structuredMilestoneTables(
  content: Readonly<Record<string, DocumentJsonValue>>,
): readonly ExportContentTable[] {
  const features = jsonRecords(content.features);
  const stories = jsonRecords(content.userStories);
  if (features.length === 0 && stories.length === 0) return [];
  const tables: ExportContentTable[] = [];
  if (features.length > 0) {
    tables.push({
      title: "Mapa de Features",
      headers: [
        "Feature",
        "Descripción funcional",
        "Objetivo",
        "Alcance",
        "HU",
      ],
      columnWeights: [1.1, 2.1, 1.8, 2.1, 0.9],
      rows: features.map((feature) => [
        `${businessValue(feature.code)}\n${businessValue(feature.title)}`,
        businessValue(feature.description),
        businessValue(feature.objective),
        [
          optionalBusinessValue(feature.inScope)
            ? `Incluye: ${optionalBusinessValue(feature.inScope)}`
            : "",
          optionalBusinessValue(feature.outOfScope)
            ? `No incluye: ${optionalBusinessValue(feature.outOfScope)}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        businessValue(feature.userStoryCodes),
      ]),
    });
  }
  if (stories.length > 0) {
    tables.push({
      title: "Historias de Usuario",
      headers: [
        "HU / Feature",
        "Título",
        "COMO / QUIERO / PARA",
        "Contexto y premisas",
      ],
      columnWeights: [0.9, 1.5, 2.8, 2.3],
      rows: stories.map((story) => [
        `${businessValue(story.code)}\n${businessValue(story.featureCode)}`,
        businessValue(story.title),
        `COMO: ${businessValue(story.role)}\nQUIERO: ${businessValue(story.want)}\nPARA: ${businessValue(story.benefit)}`,
        `${businessValue(story.context)}\nPremisas: ${businessValue(story.premises)}\nAplicaciones: ${businessValue(story.impactedSystems)}`,
      ]),
    });
    const criterionRows = stories.flatMap((story) =>
      jsonRecords(story.acceptanceCriteria).map((criterion) => [
        businessValue(story.code),
        businessValue(criterion.code),
        businessValue(criterion.given),
        businessValue(criterion.when),
        businessValue(criterion.then),
      ]),
    );
    if (criterionRows.length > 0) {
      tables.push({
        title: "Criterios de aceptación",
        headers: ["HU", "CA", "DADO", "CUANDO", "ENTONCES"],
        columnWeights: [0.65, 0.65, 2.1, 2.1, 2.5],
        rows: criterionRows,
      });
    }
    const fieldsByDefinition = new Map<
      string,
      {
        storyCodes: Set<string>;
        name: string;
        dataType: string;
        required: string;
        validation: string;
      }
    >();
    for (const story of stories) {
      const storyCode = businessValue(story.code);
      for (const field of jsonRecords(story.fields)) {
        const name = businessValue(field.name);
        const dataType = businessValue(field.dataType);
        const required = businessValue(field.required);
        const validation = businessValue(field.validation);
        const key = [name, dataType, required, validation]
          .join("|")
          .toLocaleLowerCase("es");
        const current = fieldsByDefinition.get(key) ?? {
          storyCodes: new Set<string>(),
          name,
          dataType,
          required,
          validation,
        };
        current.storyCodes.add(storyCode);
        fieldsByDefinition.set(key, current);
      }
    }
    const fieldRows = [...fieldsByDefinition.values()].map((field) => [
      [...field.storyCodes].join("; "),
      field.name,
      field.dataType,
      field.required,
      field.validation,
    ]);
    if (fieldRows.length > 0) {
      tables.push({
        title: "Datos y campos",
        headers: [
          "HU",
          "Campo",
          "Tipo",
          "Obligatorio",
          "Validación / observación",
        ],
        columnWeights: [0.65, 1.3, 0.9, 0.9, 3.1],
        rows: fieldRows,
      });
    }
  }
  return tables;
}

export function requirementsGroupTables(
  content: Readonly<Record<string, DocumentJsonValue>>,
  milestoneRoots: readonly Readonly<Record<string, DocumentJsonValue>>[] = [],
): readonly ExportContentTable[] {
  const functionalRequirements = jsonRecords(content.functionalRequirements);
  const milestoneGroups = new Map<
    string,
    {
      code: string;
      title: string;
      description: string;
      pending: boolean;
      stories: Readonly<Record<string, DocumentJsonValue>>[];
    }
  >();

  for (const story of functionalRequirements) {
    const milestoneCode = optionalBusinessValue(story.milestone);
    const assignmentStatus = optionalBusinessValue(
      story.assignmentStatus,
    ).toUpperCase();
    const pending = assignmentStatus === "PENDING_ASSIGNMENT" || !milestoneCode;
    const key = pending ? "__PENDING__" : milestoneCode.toUpperCase();
    const current = milestoneGroups.get(key) ?? {
      code: pending ? "" : milestoneCode,
      title: pending
        ? "Historias pendientes por asignar"
        : optionalBusinessValue(story.functionality) || "Hito sin título",
      description: pending
        ? "Historias funcionales que todavía no tienen un hito confirmado."
        : optionalBusinessValue(story.milestoneDescription),
      pending,
      stories: [],
    };
    if (!current.description) {
      current.description = optionalBusinessValue(story.milestoneDescription);
    }
    current.stories.push(story);
    milestoneGroups.set(key, current);
  }

  milestoneRoots.forEach((root, index) => {
    const code = `H-${String(index + 1).padStart(3, "0")}`;
    const key = code.toUpperCase();
    if (milestoneGroups.has(key)) return;
    milestoneGroups.set(key, {
      code,
      title: optionalBusinessValue(root.title) || "Hito sin título",
      description: optionalBusinessValue(root.description),
      pending: false,
      stories: [],
    });
  });

  const milestoneNumber = (code: string): number => {
    const match = code.match(/(\d+)/u);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  };
  const groups = [...milestoneGroups.values()].sort((left, right) => {
    if (left.pending !== right.pending) return left.pending ? 1 : -1;
    return (
      milestoneNumber(left.code) - milestoneNumber(right.code) ||
      left.code.localeCompare(right.code, "es")
    );
  });

  const criteriaText = (value: DocumentJsonValue | undefined): string => {
    if (!Array.isArray(value) || value.length === 0) {
      return "Sin criterios de aceptación definidos.";
    }
    return value
      .map((criterion, index) => {
        const record = jsonRecord(criterion);
        if (!record) return businessValue(criterion);
        const code = optionalBusinessValue(record.code) || `CA-${index + 1}`;
        const given = optionalBusinessValue(record.given);
        const when = optionalBusinessValue(record.when);
        const then = optionalBusinessValue(record.then);
        const statement = [
          given && `DADO: ${given}`,
          when && `CUANDO: ${when}`,
          then && `ENTONCES: ${then}`,
        ]
          .filter(Boolean)
          .join(" · ");
        return `${code}: ${statement || businessValue(record.description)}`;
      })
      .filter(Boolean)
      .join("\n");
  };

  const fieldsText = (value: DocumentJsonValue | undefined): string => {
    const fields = jsonRecords(value);
    if (fields.length === 0) return "Sin campos definidos.";
    return fields
      .map((field) => {
        const name = businessValue(field.name);
        const details = [
          optionalBusinessValue(field.dataType),
          optionalBusinessValue(field.required),
          optionalBusinessValue(field.validation),
        ].filter(Boolean);
        return details.length > 0 ? `${name}: ${details.join(" · ")}` : name;
      })
      .join("\n");
  };

  const functionalTables: ExportContentTable[] = groups.flatMap(
    (group, groupIndex) => {
      const groupNumber = `6.1.${groupIndex + 1}`;
      const groupLabel = group.pending
        ? `${groupNumber} ${group.title}`
        : `${groupNumber} Hito ${group.code} · ${group.title}`;
      const overview: ExportContentTable = {
        title: groupLabel,
        headers: ["Descripción del hito", "Historias relacionadas"],
        columnWeights: [5.5, 1.5],
        rows: [
          [
            group.description || "Sin descripción del hito definida.",
            `${group.stories.length} HU`,
          ],
        ],
      };
      const storyTables = group.stories.map<ExportContentTable>(
        (story, storyIndex) => {
          const code = businessValue(story.code);
          const title = businessValue(story.title);
          const role = optionalBusinessValue(story.role);
          const want = optionalBusinessValue(story.want);
          const benefit = optionalBusinessValue(story.benefit);
          const narrative = [
            role && `COMO: ${role}`,
            want && `QUIERO: ${want}`,
            benefit && `PARA: ${benefit}`,
          ]
            .filter(Boolean)
            .join("\n");
          return {
            title: `${groupNumber}.${storyIndex + 1} ${code} · ${title}`,
            headers: ["Información de la historia", "Detalle"],
            columnWeights: [1.55, 5.45],
            rows: [
              [
                "Descripción funcional breve",
                conciseFunctionalStoryDescription({
                  description: optionalBusinessValue(story.description),
                  title,
                  want,
                }),
              ],
              ["Historia de usuario", narrative || "Sin narrativa definida."],
              ["Contexto", businessValue(story.context)],
              ["Premisas", businessValue(story.premises)],
              ["Sistemas impactados", businessValue(story.impactedSystems)],
              ["Campos", fieldsText(story.fields)],
              [
                "Criterios de aceptación",
                criteriaText(story.acceptanceCriteria),
              ],
            ],
          };
        },
      );
      return [overview, ...storyTables];
    },
  );

  const nonFunctionalRequirements = jsonRecords(
    content.nonFunctionalRequirements,
  );
  const nonFunctionalTable: ExportContentTable = {
    title: "6.2 Requerimientos no funcionales",
    headers: [
      "Código",
      "Título",
      "Categoría",
      "Descripción",
      "Medida / objetivo",
    ],
    columnWeights: [0.8, 1.4, 1.2, 2.8, 1.8],
    rows: nonFunctionalRequirements.map((item) => [
      businessValue(item.code),
      businessValue(item.title),
      businessValue(item.category ?? item.requirementType),
      businessValue(item.description),
      [optionalBusinessValue(item.measure), optionalBusinessValue(item.target)]
        .filter(Boolean)
        .join(" / "),
    ]),
  };

  return [...functionalTables, nonFunctionalTable];
}

export function backlogStructureTreeLines(
  content: Readonly<Record<string, DocumentJsonValue>>,
): readonly ExportContentLine[] {
  const epics = jsonRecords(content.epics);
  if (epics.length === 0) return [];

  const lines: ExportContentLine[] = [
    {
      text: "Esquema visual: Epics → Features → Historias de Usuario → Tareas.",
      level: 0,
      bullet: false,
    },
  ];

  const nodeText = (
    kind: "EPIC" | "FEATURE" | "HU" | "TAREA",
    node: Readonly<Record<string, DocumentJsonValue>>,
  ): string => {
    const code = optionalBusinessValue(node.code);
    const title =
      optionalBusinessValue(node.title) ||
      (kind === "TAREA" ? optionalBusinessValue(node.description) : "");
    return [kind, code, title].filter(Boolean).join(" · ");
  };

  const nodeDescription = (
    kind: "EPIC" | "FEATURE" | "HU",
    node: Readonly<Record<string, DocumentJsonValue>>,
  ): string => {
    const explicit =
      optionalBusinessValue(node.description) ||
      optionalBusinessValue(node.objective);
    if (explicit) return explicit;
    if (kind !== "HU") return "";
    const role = optionalBusinessValue(node.role);
    const want = optionalBusinessValue(node.want);
    const benefit = optionalBusinessValue(node.benefit);
    return [
      role ? `Como ${role}` : "",
      want ? `quiero ${want}` : "",
      benefit ? `para ${benefit}` : "",
    ]
      .filter(Boolean)
      .join(", ");
  };

  const appendDescription = (
    kind: "EPIC" | "FEATURE" | "HU",
    node: Readonly<Record<string, DocumentJsonValue>>,
    level: number,
  ): void => {
    const description = nodeDescription(kind, node);
    if (description) {
      lines.push({
        text: `Descripción: ${description}`,
        level,
        bullet: false,
      });
    }
  };

  const taskTypeLabel = (value: DocumentJsonValue | undefined): string => {
    const type = optionalBusinessValue(value).toUpperCase();
    return (
      {
        ANALYSIS: "Análisis",
        DESIGN: "Diseño",
        DEVELOPMENT: "Desarrollo",
        TESTING: "Pruebas",
        INTEGRATION: "Integración",
        CONFIGURATION: "Configuración",
      }[type] ?? optionalBusinessValue(value)
    );
  };

  for (const epic of epics) {
    lines.push({ text: nodeText("EPIC", epic), level: 0, bullet: true });
    appendDescription("EPIC", epic, 1);
    const features = jsonRecords(epic.features);
    for (const feature of features) {
      lines.push({
        text: nodeText("FEATURE", feature),
        level: 1,
        bullet: true,
      });
      appendDescription("FEATURE", feature, 2);
      const stories = jsonRecords(feature.userStories);
      for (const story of stories) {
        lines.push({ text: nodeText("HU", story), level: 2, bullet: true });
        appendDescription("HU", story, 3);
        const tasks = jsonRecords(story.tasks);
        for (const task of tasks) {
          const type = taskTypeLabel(task.type);
          const dependencies = optionalBusinessValue(task.dependencyCodes);
          const detail = [
            type ? `Tipo: ${type}` : "",
            dependencies ? `Depende de: ${dependencies}` : "Sin dependencias",
          ]
            .filter(Boolean)
            .join(" · ");
          lines.push({
            text: `${nodeText("TAREA", task)} (${detail})`,
            level: 3,
            bullet: true,
          });
        }
      }
    }
  }
  return lines;
}

export function fallbackBacklogTreeLines(
  content: Readonly<Record<string, DocumentJsonValue>> | null,
): readonly ExportContentLine[] {
  if (!content) return [];
  const features = jsonRecords(content.features);
  const stories = jsonRecords(content.userStories);
  if (features.length === 0 && stories.length === 0) return [];

  const lines: ExportContentLine[] = [
    {
      text: "Esquema visual: Epics → Features → Historias de Usuario.",
      level: 0,
      bullet: false,
    },
    {
      text: "EPIC · EP-001 · Estructura funcional del proyecto",
      level: 0,
      bullet: true,
    },
    {
      text: "Descripción: Agrupa las capacidades funcionales documentadas para esta versión.",
      level: 1,
      bullet: false,
    },
  ];

  for (const [featureIndex, feature] of features.entries()) {
    const featureCode =
      optionalBusinessValue(feature.code) ||
      `FE-${String(featureIndex + 1).padStart(3, "0")}`;
    const featureTitle =
      optionalBusinessValue(feature.title) || "Funcionalidad documentada";
    lines.push({
      text: `FEATURE · ${featureCode} · ${featureTitle}`,
      level: 1,
      bullet: true,
    });
    const featureDescription =
      optionalBusinessValue(feature.description) ||
      optionalBusinessValue(feature.objective);
    if (featureDescription) {
      lines.push({
        text: `Descripción: ${featureDescription}`,
        level: 2,
        bullet: false,
      });
    }
    for (const story of stories.filter(
      (item) => optionalBusinessValue(item.featureCode) === featureCode,
    )) {
      lines.push({
        text: `HU · ${optionalBusinessValue(story.code)} · ${optionalBusinessValue(story.title)}`,
        level: 2,
        bullet: true,
      });
      const storyDescription =
        optionalBusinessValue(story.description) ||
        conciseFunctionalStoryDescription({
          description: optionalBusinessValue(story.description),
          title: optionalBusinessValue(story.title),
          want: optionalBusinessValue(story.want),
        });
      if (storyDescription) {
        lines.push({
          text: `Descripción: ${storyDescription}`,
          level: 3,
          bullet: false,
        });
      }
      const role = optionalBusinessValue(story.role);
      const want = optionalBusinessValue(story.want);
      const benefit = optionalBusinessValue(story.benefit);
      if (role || want || benefit) {
        lines.push({
          text: [
            role ? `COMO: ${role}` : "",
            want ? `QUIERO: ${want}` : "",
            benefit ? `PARA: ${benefit}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
          level: 3,
          bullet: false,
        });
      }
      const acceptanceCriteria = jsonRecords(story.acceptanceCriteria);
      if (acceptanceCriteria.length > 0) {
        lines.push({
          text: "Criterios de aceptación:",
          level: 3,
          bullet: false,
        });
      }
      for (const criterion of acceptanceCriteria) {
        const code = optionalBusinessValue(criterion.code);
        const given = optionalBusinessValue(criterion.given);
        const when = optionalBusinessValue(criterion.when);
        const then = optionalBusinessValue(criterion.then);
        lines.push({
          text: `${code ? `${code}: ` : ""}DADO ${given} · CUANDO ${when} · ENTONCES ${then}`,
          level: 3,
          bullet: false,
        });
      }
    }
  }
  return lines;
}

export function structuredActorsTable(
  content: Readonly<Record<string, DocumentJsonValue>>,
): ExportContentTable | null {
  const stories = jsonRecords(content.userStories);
  const rows = uniqueTexts(
    stories.map((story) => businessValue(story.role)),
  ).map((role) => {
    const responsibilities = uniqueTexts(
      stories
        .filter((story) => businessValue(story.role) === role)
        .map((story) => businessValue(story.want)),
    );
    return [role, responsibilities.join("; ")];
  });
  return rows.length
    ? {
        title: "Actores principales",
        headers: ["Rol", "Responsabilidad funcional"],
        columnWeights: [1.6, 4.4],
        rows,
      }
    : null;
}

export function structuredIntegrationTable(
  content: Readonly<Record<string, DocumentJsonValue>>,
): ExportContentTable | null {
  const stories = jsonRecords(content.userStories);
  const systems = uniqueTexts(
    stories.flatMap((story) =>
      Array.isArray(story.impactedSystems)
        ? story.impactedSystems.map((item) => businessValue(item))
        : [businessValue(story.impactedSystems)],
    ),
  );
  return systems.length
    ? {
        title: "Aplicaciones e integraciones",
        headers: ["Sistema / aplicación", "Uso dentro del requerimiento"],
        columnWeights: [1.7, 4.3],
        rows: systems.map((system) => [
          system,
          uniqueTexts(
            stories
              .filter((story) =>
                businessValue(story.impactedSystems).includes(system),
              )
              .map((story) => businessValue(story.want)),
          ).join("; "),
        ]),
      }
    : null;
}

export function structuredTestTables(
  content: Readonly<Record<string, DocumentJsonValue>>,
): readonly ExportContentTable[] {
  const scenarios = jsonRecords(content.scenarios);
  return scenarios.length
    ? [
        {
          title: "Matriz de pruebas",
          headers: [
            "Prueba",
            "Trazabilidad",
            "Precondición",
            "Acción",
            "Resultado esperado",
          ],
          columnWeights: [1.2, 1.1, 1.8, 1.8, 2.1],
          rows: scenarios.map((scenario) => [
            `${businessValue(scenario.code)}\n${businessValue(scenario.title)}`,
            `HU: ${businessValue(scenario.userStoryCodes)}\nCA: ${businessValue(scenario.acceptanceCriterionCodes)}\nTareas: ${businessValue(scenario.taskCodes)}`,
            businessValue(scenario.precondition),
            businessValue(scenario.action),
            businessValue(scenario.expectedResult),
          ]),
        },
      ]
    : [];
}

export function structuredScrumLines(
  content: Readonly<Record<string, DocumentJsonValue>>,
): readonly ExportContentLine[] {
  const sprints = jsonRecords(content.sprints);
  if (sprints.length === 0) return [];
  const usesColombianBusinessCalendar =
    content.calendarMode === "COLOMBIA_BUSINESS_DAYS";
  const lines: ExportContentLine[] = [
    {
      text: usesColombianBusinessCalendar
        ? `Cadencia: ${visibleText(content.cadenceDays)} días hábiles · calendario Colombia · Inicio: ${visibleText(content.confirmedStartDate)}`
        : `Cadencia: ${visibleText(content.cadenceDays)} días calendario`,
      level: 0,
      bullet: false,
    },
  ];

  for (const [index, sprint] of sprints.entries()) {
    const number = optionalBusinessValue(sprint.number) || String(index + 1);
    const period = optionalBusinessValue(sprint.period);
    const tasks = jsonRecords(sprint.tasks);
    const featureCodes = businessValue(sprint.featureCodes);
    const storyCodes = businessValue(sprint.userStoryCodes);
    const deliverables = businessValue(sprint.deliverables);
    const testCodes = businessValue(sprint.testCodes);
    lines.push({
      text: `Sprint ${number}${period ? ` · ${period}` : ""}`,
      level: 0,
      bullet: false,
    });
    lines.push({
      text: `Objetivo: ${businessValue(sprint.objective)}`,
      level: 1,
      bullet: true,
    });
    lines.push({
      text: `Alcance: ${featureCodes || "Sin Feature asignada"}${storyCodes ? ` · HU: ${storyCodes}` : ""}`,
      level: 1,
      bullet: true,
    });
    lines.push({
      text: `Trabajo previsto: ${tasks.length} tarea(s)${testCodes ? ` · Pruebas: ${testCodes}` : ""}`,
      level: 1,
      bullet: true,
    });
    lines.push({
      text: `Entregable: ${deliverables || "Por definir"}`,
      level: 1,
      bullet: true,
    });
    lines.push({
      text: `Criterio de cierre: ${businessValue(sprint.closingCriterion)}`,
      level: 1,
      bullet: true,
    });
  }
  return lines;
}

export function nonFunctionalTable(
  input: RenderApprovedDocumentInput,
): ExportContentTable | null {
  const content = jsonRecord(
    versionSection(input, "nonFunctionalRequirements")?.content,
  );
  if (!content) return null;
  const rows = Object.entries(content)
    .map(([key, value]) => [label(key), businessValue(value)])
    .filter(([, value]) => Boolean(value));
  return rows.length
    ? {
        title: "6.2 Requerimientos no funcionales",
        headers: ["Atributo", "Condición"],
        columnWeights: [1.5, 5.5],
        rows,
      }
    : null;
}
