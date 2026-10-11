import {
  AI_BACKLOG_TASK_ORIGINS,
  AI_SCRUM_TASK_TYPES,
  conciseFunctionalStoryDescription,
  type AiFunctionalUserStoryV41,
  type AiPlanningBacklogFeatureV41,
  type AiPlanningBacklogStructureV41,
  type AiPlanningBacklogTaskV41,
  type AiPlanningBacklogUserStoryV41,
  type AiPlanningPendingAssignmentsV41,
} from "@levantamiento-rq/shared-contracts";
import {
  object,
  string,
  pushReconciliationWarning,
  nullableString,
  strings,
  array,
  sourceIds,
} from "./ai-draft-parse-primitives";
import {
  canonicalBacklogCode,
  canonicalReferenceCode,
  canonicalFunctionalStoryCode,
  canonicalFunctionalCriterionCode,
  canonicalFunctionalNeedCode,
  canonicalPlanningStoryCode,
  canonicalFunctionalStoryReference,
} from "./ai-draft-code-aliases";
import { parseField } from "./ai-draft-backlog-parsers";

export function parseFunctionalUserStoriesV41(
  value: unknown,
  warnings: string[] = [],
): AiFunctionalUserStoryV41[] {
  const functionalUserStories = array(
    value,
    "structuredAnalysis.functionalUserStories",
    300,
  );
  return functionalUserStories.map((storyValue, storyIndex) => {
    const name = `structuredAnalysis.functionalUserStories[${storyIndex}]`;
    const story = object(storyValue, name);
    const criteria = array(
      story.acceptanceCriteria,
      `${name}.acceptanceCriteria`,
      50,
    );
    const parsedCriteria = criteria.map((criterionValue, criterionIndex) => {
      const criterionName = `${name}.acceptanceCriteria[${criterionIndex}]`;
      const criterion = object(criterionValue, criterionName);
      return {
        code: canonicalFunctionalCriterionCode(
          criterion.code,
          `${criterionName}.code`,
        ),
        given: string(criterion.given, `${criterionName}.given`, 2_000),
        when: string(criterion.when, `${criterionName}.when`, 2_000),
        then: string(criterion.then, `${criterionName}.then`, 2_000),
        sourceIds: sourceIds(criterion.sourceIds, `${criterionName}.sourceIds`),
      };
    });

    const functionalNeedCodes = Object.hasOwn(story, "functionalNeedCodes")
      ? strings(
          story.functionalNeedCodes,
          `${name}.functionalNeedCodes`,
          100,
        ).map((code, index) =>
          canonicalFunctionalNeedCode(
            code,
            `${name}.functionalNeedCodes[${index}]`,
          ),
        )
      : [];

    if (new Set(functionalNeedCodes).size !== functionalNeedCodes.length) {
      throw new Error(
        `${name}.functionalNeedCodes contiene códigos repetidos.`,
      );
    }

    /*
     * COMPATIBILIDAD_V41_PRE_V4_7_9
     * Los resultados históricos no incluyen estado documental. Se interpretan
     * como COMPLETE salvo que un marcador esencial o la ausencia de CA-F haga
     * inequívoca la documentación pendiente. El JSON persistido no se modifica.
     */
    const pendingMarker = "[PENDIENTE POR DEFINIR]";
    const historicalDocumentationPending =
      criteria.length === 0 ||
      [story.role, story.want, story.benefit, story.context].some(
        (value) =>
          typeof value !== "string" ||
          !value.trim() ||
          value.trim() === pendingMarker,
      );
    let documentationStatus = Object.hasOwn(story, "documentationStatus")
      ? string(story.documentationStatus, `${name}.documentationStatus`, 40)
          .trim()
          .toUpperCase()
      : historicalDocumentationPending
        ? "PENDING_DOCUMENTATION"
        : "COMPLETE";
    let documentationObservation = Object.hasOwn(
      story,
      "documentationObservation",
    )
      ? nullableString(
          story.documentationObservation,
          `${name}.documentationObservation`,
          2_000,
        )
      : historicalDocumentationPending
        ? "El resultado histórico contiene información funcional esencial pendiente de documentar."
        : null;

    if (
      documentationStatus !== "COMPLETE" &&
      documentationStatus !== "PENDING_DOCUMENTATION"
    ) {
      throw new Error(
        `${name}.documentationStatus debe ser COMPLETE o PENDING_DOCUMENTATION.`,
      );
    }

    const missingDocumentation = [
      ["role", story.role],
      ["want", story.want],
      ["benefit", story.benefit],
      ["context", story.context],
    ]
      .filter(
        ([, fieldValue]) =>
          typeof fieldValue !== "string" ||
          !fieldValue.trim() ||
          fieldValue.trim() === pendingMarker,
      )
      .flatMap(([field]) => (typeof field === "string" ? [field] : []));
    if (criteria.length === 0) missingDocumentation.push("acceptanceCriteria");

    /*
     * AI_DERIVED_STATUS_RECONCILIATION_V1
     *
     * Structured Outputs garantiza forma y tipos, no invariantes entre campos.
     * Los estados COMPLETE/PENDING y sus observaciones son metadatos derivados:
     * una contradicción reparable no debe descartar un documento completo ni
     * obligar a pagar otra generación. Se conserva fail-closed degradando a
     * pendiente cuando falta contenido; nunca se inventa información funcional.
     */
    if (documentationStatus === "COMPLETE" && missingDocumentation.length > 0) {
      documentationStatus = "PENDING_DOCUMENTATION";
      documentationObservation =
        documentationObservation?.trim() ||
        `Falta documentar información funcional obligatoria: ${missingDocumentation.join(", ")}.`;
      pushReconciliationWarning(
        warnings,
        `${name}: documentationStatus se corrigió de COMPLETE a PENDING_DOCUMENTATION porque faltan ${missingDocumentation.join(", ")}.`,
      );
    } else if (
      documentationStatus === "COMPLETE" &&
      documentationObservation?.trim()
    ) {
      documentationObservation = null;
      pushReconciliationWarning(
        warnings,
        `${name}: documentationObservation se normalizó a null porque la historia está COMPLETE.`,
      );
    } else if (
      documentationStatus === "PENDING_DOCUMENTATION" &&
      !documentationObservation?.trim()
    ) {
      documentationObservation =
        missingDocumentation.length > 0
          ? `Falta documentar información funcional obligatoria: ${missingDocumentation.join(", ")}.`
          : "La historia requiere validación documental antes de considerarse completa.";
      pushReconciliationWarning(
        warnings,
        `${name}: se agregó una documentationObservation segura para conservar el estado PENDING_DOCUMENTATION.`,
      );
    }

    /*
     * COMPATIBILIDAD_V41_PRE_V7_1_1
     *
     * Resultados V4.1 históricos no tienen assignmentStatus ni
     * assignmentObservation. Al leerlos se consideran ASSIGNED si ya poseen
     * Hito. El schema nuevo sí exige los campos en nuevas generaciones.
     */
    let milestone = Object.hasOwn(story, "milestone")
      ? nullableString(story.milestone, `${name}.milestone`, 50)
      : null;
    let functionality = Object.hasOwn(story, "functionality")
      ? nullableString(story.functionality, `${name}.functionality`, 500)
      : null;
    let milestoneDescription = Object.hasOwn(story, "milestoneDescription")
      ? nullableString(
          story.milestoneDescription,
          `${name}.milestoneDescription`,
          5_000,
        )
      : null;
    let assignmentObservation = Object.hasOwn(story, "assignmentObservation")
      ? nullableString(
          story.assignmentObservation,
          `${name}.assignmentObservation`,
          2_000,
        )
      : null;

    let assignmentStatus = Object.hasOwn(story, "assignmentStatus")
      ? string(story.assignmentStatus, `${name}.assignmentStatus`, 40)
          .trim()
          .toUpperCase()
      : milestone
        ? "ASSIGNED"
        : "PENDING_ASSIGNMENT";

    if (
      assignmentStatus !== "ASSIGNED" &&
      assignmentStatus !== "PENDING_ASSIGNMENT"
    ) {
      throw new Error(
        `${name}.assignmentStatus debe ser ASSIGNED o PENDING_ASSIGNMENT.`,
      );
    }

    const missingAssignment = [
      ["milestone", milestone],
      ["functionality", functionality],
      ["milestoneDescription", milestoneDescription],
    ]
      .filter(([, fieldValue]) => !fieldValue?.trim())
      .flatMap(([field]) => (typeof field === "string" ? [field] : []));

    if (assignmentStatus === "ASSIGNED" && missingAssignment.length > 0) {
      assignmentStatus = "PENDING_ASSIGNMENT";
      milestone = null;
      functionality = null;
      milestoneDescription = null;
      assignmentObservation =
        assignmentObservation?.trim() ||
        `No se pudo confirmar la asignación porque faltan: ${missingAssignment.join(", ")}.`;
      pushReconciliationWarning(
        warnings,
        `${name}: assignmentStatus se corrigió de ASSIGNED a PENDING_ASSIGNMENT porque faltan ${missingAssignment.join(", ")}.`,
      );
    } else if (assignmentStatus === "ASSIGNED") {
      if (assignmentObservation?.trim()) {
        assignmentObservation = null;
        pushReconciliationWarning(
          warnings,
          `${name}: assignmentObservation se normalizó a null porque la historia está ASSIGNED.`,
        );
      }
    } else {
      if (
        milestone !== null ||
        functionality !== null ||
        milestoneDescription !== null
      ) {
        milestone = null;
        functionality = null;
        milestoneDescription = null;
        pushReconciliationWarning(
          warnings,
          `${name}: los datos de Hito se descartaron porque assignmentStatus es PENDING_ASSIGNMENT.`,
        );
      }
      if (!assignmentObservation?.trim()) {
        assignmentObservation =
          "La ubicación estructural de la historia requiere validación antes de asignarla a un Hito.";
        pushReconciliationWarning(
          warnings,
          `${name}: se agregó una assignmentObservation segura para conservar el estado PENDING_ASSIGNMENT.`,
        );
      }
    }

    const title = string(story.title, `${name}.title`, 300);
    const role = string(story.role, `${name}.role`, 500);
    const want = string(story.want, `${name}.want`, 2_000);
    const benefit = string(story.benefit, `${name}.benefit`, 2_000);
    const context = string(story.context, `${name}.context`, 5_000);
    const description = conciseFunctionalStoryDescription({
      description: string(story.description, `${name}.description`, 5_000),
      title,
      want,
    });

    return {
      code: canonicalFunctionalStoryCode(story.code, `${name}.code`),
      title,
      description,
      assignmentStatus:
        assignmentStatus as AiFunctionalUserStoryV41["assignmentStatus"],
      documentationStatus:
        documentationStatus as AiFunctionalUserStoryV41["documentationStatus"],
      documentationObservation,
      milestone: milestone?.trim().toUpperCase() ?? null,
      functionality,
      milestoneDescription,
      assignmentObservation,
      role,
      want,
      benefit,
      context,
      premises: strings(story.premises, `${name}.premises`, 50),
      impactedSystems: strings(
        story.impactedSystems,
        `${name}.impactedSystems`,
        50,
      ),
      fields: array(story.fields, `${name}.fields`, 100).map((field, index) =>
        parseField(field, `${name}.fields[${index}]`),
      ),
      acceptanceCriteria: parsedCriteria,
      functionalNeedCodes,
      sourceIds: sourceIds(story.sourceIds, `${name}.sourceIds`),
    };
  });
}

function parsePlanningBacklogTaskV41(
  value: unknown,
  name: string,
): AiPlanningBacklogTaskV41 {
  const task = object(value, name);
  const type = string(task.type, `${name}.type`, 30);
  const rawOrigin = string(task.origin, `${name}.origin`, 40);
  if (!AI_SCRUM_TASK_TYPES.includes(type as never)) {
    throw new Error(`${name}.type no está permitido.`);
  }
  if (!AI_BACKLOG_TASK_ORIGINS.includes(rawOrigin as never)) {
    throw new Error(`${name}.origin no está permitido.`);
  }
  const sourceNumber = Object.hasOwn(task, "sourceNumber")
    ? nullableString(task.sourceNumber, `${name}.sourceNumber`, 120)
    : null;
  return {
    code: canonicalBacklogCode(task.code, `${name}.code`, "TASK"),
    title: string(task.title, `${name}.title`, 300),
    description: string(task.description, `${name}.description`, 2_000),
    sourceNumber,
    type: type as AiPlanningBacklogTaskV41["type"],
    origin: (sourceNumber
      ? "EVIDENCE"
      : rawOrigin) as AiPlanningBacklogTaskV41["origin"],
    dependencyCodes: strings(
      task.dependencyCodes,
      `${name}.dependencyCodes`,
      30,
    ).map((code) => canonicalReferenceCode(code, "TASK")),
    sourceIds: sourceIds(task.sourceIds, `${name}.sourceIds`),
  };
}

function parsePlanningBacklogUserStoryValueV41(
  value: unknown,
  name: string,
): AiPlanningBacklogUserStoryV41 {
  const story = object(value, name);
  return {
    code: canonicalPlanningStoryCode(story.code, `${name}.code`),
    title: string(story.title, `${name}.title`, 300),
    description: string(story.description, `${name}.description`, 5_000),
    sourceNumber: Object.hasOwn(story, "sourceNumber")
      ? nullableString(story.sourceNumber, `${name}.sourceNumber`, 120)
      : null,
    functionalRequirementCodes: strings(
      story.functionalRequirementCodes,
      `${name}.functionalRequirementCodes`,
      100,
    ).map(canonicalFunctionalStoryReference),
    sourceIds: sourceIds(story.sourceIds, `${name}.sourceIds`),
    tasks: array(story.tasks, `${name}.tasks`, 200).map((task, taskIndex) =>
      parsePlanningBacklogTaskV41(task, `${name}.tasks[${taskIndex}]`),
    ),
  };
}

function parsePlanningBacklogFeatureValueV41(
  value: unknown,
  name: string,
): AiPlanningBacklogFeatureV41 {
  const feature = object(value, name);
  return {
    code: canonicalBacklogCode(feature.code, `${name}.code`, "FEATURE"),
    title: string(feature.title, `${name}.title`, 300),
    description: string(feature.description, `${name}.description`, 5_000),
    sourceNumber: Object.hasOwn(feature, "sourceNumber")
      ? nullableString(feature.sourceNumber, `${name}.sourceNumber`, 120)
      : null,
    sourceIds: sourceIds(feature.sourceIds, `${name}.sourceIds`),
    userStories: array(feature.userStories, `${name}.userStories`, 150).map(
      (story, storyIndex) =>
        parsePlanningBacklogUserStoryValueV41(
          story,
          `${name}.userStories[${storyIndex}]`,
        ),
    ),
  };
}

function parsePlanningPendingAssignmentsV41(
  backlog: Readonly<Record<string, unknown>>,
): AiPlanningPendingAssignmentsV41 {
  if (!Object.hasOwn(backlog, "pendingAssignments")) {
    return { features: [], userStories: [], tasks: [] };
  }

  const pending = object(
    backlog.pendingAssignments,
    "structuredAnalysis.backlogStructure.pendingAssignments",
  );

  const parseEnvelope = <T>(
    value: unknown,
    name: string,
    parseItem: (item: unknown, itemName: string) => T,
  ): {
    assignmentStatus: "PENDING_ASSIGNMENT";
    assignmentObservation: string;
    sourceParentPath: string | null;
    item: T;
  } => {
    const envelope = object(value, name);
    const assignmentStatus = string(
      envelope.assignmentStatus,
      `${name}.assignmentStatus`,
      40,
    )
      .trim()
      .toUpperCase();

    if (assignmentStatus !== "PENDING_ASSIGNMENT") {
      throw new Error(`${name}.assignmentStatus debe ser PENDING_ASSIGNMENT.`);
    }

    return {
      assignmentStatus: "PENDING_ASSIGNMENT",
      assignmentObservation: string(
        envelope.assignmentObservation,
        `${name}.assignmentObservation`,
        2_000,
      ),
      sourceParentPath: Object.hasOwn(envelope, "sourceParentPath")
        ? nullableString(
            envelope.sourceParentPath,
            `${name}.sourceParentPath`,
            500,
          )
        : null,
      item: parseItem(envelope.item, `${name}.item`),
    };
  };

  return {
    features: array(
      pending.features,
      "structuredAnalysis.backlogStructure.pendingAssignments.features",
      40,
    ).map((value, index) =>
      parseEnvelope(
        value,
        `structuredAnalysis.backlogStructure.pendingAssignments.features[${index}]`,
        parsePlanningBacklogFeatureValueV41,
      ),
    ),
    userStories: array(
      pending.userStories,
      "structuredAnalysis.backlogStructure.pendingAssignments.userStories",
      150,
    ).map((value, index) =>
      parseEnvelope(
        value,
        `structuredAnalysis.backlogStructure.pendingAssignments.userStories[${index}]`,
        parsePlanningBacklogUserStoryValueV41,
      ),
    ),
    tasks: array(
      pending.tasks,
      "structuredAnalysis.backlogStructure.pendingAssignments.tasks",
      200,
    ).map((value, index) =>
      parseEnvelope(
        value,
        `structuredAnalysis.backlogStructure.pendingAssignments.tasks[${index}]`,
        parsePlanningBacklogTaskV41,
      ),
    ),
  };
}

export function parsePlanningBacklogStructureV41(
  value: unknown,
): AiPlanningBacklogStructureV41 {
  const backlog = object(value, "structuredAnalysis.backlogStructure");
  const rawStructureStatus = Object.hasOwn(backlog, "structureStatus")
    ? string(
        backlog.structureStatus,
        "structuredAnalysis.backlogStructure.structureStatus",
        40,
      )
    : "CONFIRMED";
  if (!["CONFIRMED", "AI_SUGGESTED"].includes(rawStructureStatus)) {
    throw new Error(
      "structuredAnalysis.backlogStructure.structureStatus no está permitido.",
    );
  }
  return {
    structureStatus: rawStructureStatus as "CONFIRMED" | "AI_SUGGESTED",
    pendingAssignments: parsePlanningPendingAssignmentsV41(backlog),
    epics: array(
      backlog.epics,
      "structuredAnalysis.backlogStructure.epics",
      40,
    ).map((epicValue, epicIndex) => {
      const epicName = `structuredAnalysis.backlogStructure.epics[${epicIndex}]`;
      const epic = object(epicValue, epicName);
      return {
        code: canonicalBacklogCode(epic.code, `${epicName}.code`, "EPIC"),
        title: string(epic.title, `${epicName}.title`, 300),
        description: string(epic.description, `${epicName}.description`, 5_000),
        sourceNumber: Object.hasOwn(epic, "sourceNumber")
          ? nullableString(epic.sourceNumber, `${epicName}.sourceNumber`, 120)
          : null,
        sourceIds: sourceIds(epic.sourceIds, `${epicName}.sourceIds`),
        features: array(epic.features, `${epicName}.features`, 40).map(
          (featureValue, featureIndex) => {
            const featureName = `${epicName}.features[${featureIndex}]`;
            const feature = object(featureValue, featureName);
            return {
              code: canonicalBacklogCode(
                feature.code,
                `${featureName}.code`,
                "FEATURE",
              ),
              title: string(feature.title, `${featureName}.title`, 300),
              description: string(
                feature.description,
                `${featureName}.description`,
                5_000,
              ),
              sourceNumber: Object.hasOwn(feature, "sourceNumber")
                ? nullableString(
                    feature.sourceNumber,
                    `${featureName}.sourceNumber`,
                    120,
                  )
                : null,
              sourceIds: sourceIds(
                feature.sourceIds,
                `${featureName}.sourceIds`,
              ),
              userStories: array(
                feature.userStories,
                `${featureName}.userStories`,
                150,
              ).map((storyValue, storyIndex): AiPlanningBacklogUserStoryV41 => {
                const storyName = `${featureName}.userStories[${storyIndex}]`;
                const story = object(storyValue, storyName);
                return {
                  code: canonicalPlanningStoryCode(
                    story.code,
                    `${storyName}.code`,
                  ),
                  title: string(story.title, `${storyName}.title`, 300),
                  description: string(
                    story.description,
                    `${storyName}.description`,
                    5_000,
                  ),
                  sourceNumber: Object.hasOwn(story, "sourceNumber")
                    ? nullableString(
                        story.sourceNumber,
                        `${storyName}.sourceNumber`,
                        120,
                      )
                    : null,
                  functionalRequirementCodes: strings(
                    story.functionalRequirementCodes,
                    `${storyName}.functionalRequirementCodes`,
                    100,
                  ).map(canonicalFunctionalStoryReference),
                  sourceIds: sourceIds(
                    story.sourceIds,
                    `${storyName}.sourceIds`,
                  ),
                  tasks: array(story.tasks, `${storyName}.tasks`, 200).map(
                    (task, taskIndex) =>
                      parsePlanningBacklogTaskV41(
                        task,
                        `${storyName}.tasks[${taskIndex}]`,
                      ),
                  ),
                };
              }),
            };
          },
        ),
      };
    }),
  };
}
