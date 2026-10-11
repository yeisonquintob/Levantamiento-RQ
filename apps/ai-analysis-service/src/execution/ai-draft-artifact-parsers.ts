import {
  AI_ENTITY_CARDINALITIES,
  AI_PROCESS_LANE_KINDS,
  AI_PROCESS_NODE_KINDS,
  type AiAnalysisDraftRequirement,
  type AiEntityRelationshipModel,
  type AiProcessFlow,
  type AiSwimlaneProcessFlow,
  type AiStructuredContradiction,
  type AiTestScenario,
  type DocumentSectionKey,
} from "@levantamiento-rq/shared-contracts";
import {
  object,
  string,
  pushReconciliationWarning,
  nullableString,
  strings,
  array,
  sourceIds,
  unique,
} from "./ai-draft-parse-primitives";
import { CONTRADICTION_SUMMARY_LIMIT } from "./ai-draft-constants";

export function parseRequirements(
  value: unknown,
): AiAnalysisDraftRequirement[] {
  return array(value, "requirements", 300).map((item, index) => {
    const requirement = object(item, `requirements[${index}]`);
    const sectionKey = requirement.sectionKey;
    if (
      sectionKey !== "milestones" &&
      sectionKey !== "nonFunctionalRequirements"
    ) {
      throw new Error(`requirements[${index}].sectionKey no es válido.`);
    }
    return {
      clientId: `REQ-${String(index + 1).padStart(3, "0")}`,
      sectionKey: sectionKey as DocumentSectionKey,
      code: string(requirement.code, `requirements[${index}].code`, 50),
      title: string(requirement.title, `requirements[${index}].title`, 300),
      description: string(
        requirement.description,
        `requirements[${index}].description`,
        10_000,
      ),
      requirementType: string(
        requirement.requirementType,
        `requirements[${index}].requirementType`,
        80,
      ),
      acceptanceCriteria: strings(
        requirement.acceptanceCriteria,
        `requirements[${index}].acceptanceCriteria`,
        30,
      ),
      sourceIds: sourceIds(
        requirement.sourceIds,
        `requirements[${index}].sourceIds`,
      ),
      milestone: Object.hasOwn(requirement, "milestone")
        ? nullableString(
            requirement.milestone,
            `requirements[${index}].milestone`,
            500,
          )
        : null,
      functionality: Object.hasOwn(requirement, "functionality")
        ? nullableString(
            requirement.functionality,
            `requirements[${index}].functionality`,
            500,
          )
        : null,
      category: Object.hasOwn(requirement, "category")
        ? nullableString(
            requirement.category,
            `requirements[${index}].category`,
            300,
          )
        : null,
      measure: Object.hasOwn(requirement, "measure")
        ? nullableString(
            requirement.measure,
            `requirements[${index}].measure`,
            2_000,
          )
        : null,
      target: Object.hasOwn(requirement, "target")
        ? nullableString(
            requirement.target,
            `requirements[${index}].target`,
            2_000,
          )
        : null,
    };
  });
}

export function parseProcessFlow(
  value: unknown,
  name = "structuredAnalysis.processFlow",
  warnings?: string[],
): AiProcessFlow {
  const record = object(value, name);
  const nodes = array(record.nodes, `${name}.nodes`, 100).map((item, index) => {
    const nodeName = `${name}.nodes[${index}]`;
    const node = object(item, nodeName);
    const kind = string(node.kind, `${nodeName}.kind`, 20);
    if (!AI_PROCESS_NODE_KINDS.includes(kind as never)) {
      throw new Error("El flujo contiene un tipo de nodo no permitido.");
    }
    return {
      id: string(node.id, `${nodeName}.id`, 80),
      kind: kind as AiProcessFlow["nodes"][number]["kind"],
      label: string(node.label, `${nodeName}.label`, 500),
      ...(Object.hasOwn(node, "laneId")
        ? { laneId: nullableString(node.laneId, `${nodeName}.laneId`, 80) }
        : {}),
    };
  });
  unique(
    nodes.map((node) => node.id),
    "processFlow.nodes",
  );
  const nodeByKey = new Map(
    nodes.map((node) => [node.id.trim().toLowerCase(), node.id] as const),
  );
  const edges = array(record.edges, `${name}.edges`, 200).flatMap(
    (item, index): { from: string; to: string; label: string | null }[] => {
      const edgeName = `${name}.edges[${index}]`;
      const edge = object(item, edgeName);
      const rawFrom = string(edge.from, `${edgeName}.from`, 80);
      const rawTo = string(edge.to, `${edgeName}.to`, 80);
      const from = nodeByKey.get(rawFrom.trim().toLowerCase());
      const to = nodeByKey.get(rawTo.trim().toLowerCase());

      if (!from || !to) {
        if (warnings) {
          pushReconciliationWarning(
            warnings,
            `${edgeName} se omitió porque referencia un nodo inexistente.`,
          );
          return [];
        }
        throw new Error("El flujo referencia un nodo inexistente.");
      }

      return [
        {
          from,
          to,
          label: nullableString(edge.label, `${edgeName}.label`, 300),
        },
      ];
    },
  );
  return {
    title: string(record.title, `${name}.title`, 300),
    nodes,
    edges,
    sourceIds: sourceIds(record.sourceIds, `${name}.sourceIds`),
  };
}

export function parseSwimlaneProcessFlow(
  value: unknown,
  name: string,
  warnings?: string[],
): AiSwimlaneProcessFlow {
  const record = object(value, name);
  const flow = parseProcessFlow(record, name, warnings);
  const lanes = array(record.lanes, `${name}.lanes`, 50).map((item, index) => {
    const laneName = `${name}.lanes[${index}]`;
    const lane = object(item, laneName);
    const kind = string(lane.kind, `${laneName}.kind`, 20);
    if (!AI_PROCESS_LANE_KINDS.includes(kind as never)) {
      throw new Error(`${laneName}.kind no está permitido.`);
    }
    return {
      id: string(lane.id, `${laneName}.id`, 80),
      name: string(lane.name, `${laneName}.name`, 300),
      kind: kind as AiSwimlaneProcessFlow["lanes"][number]["kind"],
    };
  });
  unique(
    lanes.map((lane) => lane.id),
    `${name}.lanes`,
  );
  const laneByKey = new Map(
    lanes.map((lane) => [lane.id.trim().toLowerCase(), lane.id] as const),
  );
  const nodes = flow.nodes.map((node) => {
    if (!node.laneId) return node;
    const laneId = laneByKey.get(node.laneId.trim().toLowerCase());
    if (laneId) return { ...node, laneId };

    if (warnings) {
      pushReconciliationWarning(
        warnings,
        `${name}: el nodo ${node.id} perdió un laneId inexistente y requiere revisión.`,
      );
      return { ...node, laneId: null };
    }

    throw new Error(`${name} referencia un carril inexistente.`);
  });
  return {
    ...flow,
    nodes,
    objective: nullableString(record.objective, `${name}.objective`, 2_000),
    lanes,
    problems: strings(record.problems, `${name}.problems`, 100),
    improvements: strings(record.improvements, `${name}.improvements`, 100),
    expectedResults: strings(
      record.expectedResults,
      `${name}.expectedResults`,
      100,
    ),
  };
}

export function parseEntityRelationship(
  value: unknown,
  name = "structuredAnalysis.entityRelationship",
  warnings?: string[],
): AiEntityRelationshipModel {
  const record = object(value, name);
  const entities = array(record.entities, `${name}.entities`, 100).map(
    (item, index) => {
      const entityName = `${name}.entities[${index}]`;
      const entity = object(item, entityName);
      const attributes = array(
        entity.attributes,
        `${entityName}.attributes`,
        100,
      ).map((attributeItem, attributeIndex) => {
        const attributeName = `${entityName}.attributes[${attributeIndex}]`;
        const attribute = object(attributeItem, attributeName);
        for (const flag of ["primaryKey", "foreignKey", "required"] as const) {
          if (typeof attribute[flag] !== "boolean") {
            throw new Error(`${attributeName}.${flag} no es booleano.`);
          }
        }
        return {
          name: string(attribute.name, `${attributeName}.name`, 200),
          dataType: string(
            attribute.dataType,
            `${attributeName}.dataType`,
            120,
          ),
          primaryKey: attribute.primaryKey as boolean,
          foreignKey: attribute.foreignKey as boolean,
          required: attribute.required as boolean,
        };
      });
      unique(
        attributes.map((attribute) => attribute.name),
        `${entityName}.attributes`,
      );
      return {
        id: string(entity.id, `${entityName}.id`, 80),
        name: string(entity.name, `${entityName}.name`, 300),
        description: string(
          entity.description,
          `${entityName}.description`,
          2_000,
        ),
        attributes,
      };
    },
  );
  unique(
    entities.map((entity) => entity.id),
    `${name}.entities`,
  );
  const entityByKey = new Map(
    entities.map(
      (entity) => [entity.id.trim().toLowerCase(), entity.id] as const,
    ),
  );
  const relationships = array(
    record.relationships,
    `${name}.relationships`,
    200,
  ).flatMap(
    (item, index): AiEntityRelationshipModel["relationships"][number][] => {
      const relationshipName = `${name}.relationships[${index}]`;
      const relationship = object(item, relationshipName);
      const rawFrom = string(relationship.from, `${relationshipName}.from`, 80);
      const rawTo = string(relationship.to, `${relationshipName}.to`, 80);
      const from = entityByKey.get(rawFrom.trim().toLowerCase());
      const to = entityByKey.get(rawTo.trim().toLowerCase());

      if (!from || !to) {
        if (warnings) {
          pushReconciliationWarning(
            warnings,
            `${relationshipName} se omitió porque referencia una entidad inexistente.`,
          );
          return [];
        }
        throw new Error(
          `${relationshipName} referencia una entidad inexistente.`,
        );
      }

      const cardinality = string(
        relationship.cardinality,
        `${relationshipName}.cardinality`,
        10,
      );
      if (!AI_ENTITY_CARDINALITIES.includes(cardinality as never)) {
        throw new Error(`${relationshipName}.cardinality no está permitida.`);
      }
      return [
        {
          from,
          to,
          cardinality:
            cardinality as AiEntityRelationshipModel["relationships"][number]["cardinality"],
          label: string(relationship.label, `${relationshipName}.label`, 300),
        },
      ];
    },
  );
  return {
    title: string(record.title, `${name}.title`, 300),
    entities,
    relationships,
    sourceIds: sourceIds(record.sourceIds, `${name}.sourceIds`),
  };
}

export function parseTests(value: unknown): AiTestScenario[] {
  return array(value, "structuredAnalysis.tests", 250).map((item, index) => {
    const name = `structuredAnalysis.tests[${index}]`;
    const scenario = object(item, name);
    return {
      code: string(scenario.code, `${name}.code`, 50),
      title: string(scenario.title, `${name}.title`, 300),
      userStoryCodes: strings(
        scenario.userStoryCodes,
        `${name}.userStoryCodes`,
        30,
      ),
      acceptanceCriterionCodes: strings(
        scenario.acceptanceCriterionCodes,
        `${name}.acceptanceCriterionCodes`,
        50,
      ),
      precondition: string(
        scenario.precondition,
        `${name}.precondition`,
        2_000,
      ),
      action: string(scenario.action, `${name}.action`, 2_000),
      expectedResult: string(
        scenario.expectedResult,
        `${name}.expectedResult`,
        2_000,
      ),
      sourceIds: sourceIds(scenario.sourceIds, `${name}.sourceIds`),
      taskCodes:
        scenario.taskCodes === undefined
          ? []
          : strings(scenario.taskCodes, `${name}.taskCodes`, 50),
    };
  });
}

export function parseContradictions(
  value: unknown,
): AiStructuredContradiction[] {
  return array(value, "contradictions", 100)
    .slice(0, CONTRADICTION_SUMMARY_LIMIT)
    .map((item, index) => {
      const name = `contradictions[${index}]`;
      const contradiction = object(item, name);
      if (contradiction.decision !== "[PENDIENTE POR DEFINIR]") {
        throw new Error(`${name}.decision debe quedar pendiente.`);
      }
      return {
        statementA: string(
          contradiction.statementA,
          `${name}.statementA`,
          2_000,
        ),
        sourceIdsA: sourceIds(contradiction.sourceIdsA, `${name}.sourceIdsA`),
        statementB: string(
          contradiction.statementB,
          `${name}.statementB`,
          2_000,
        ),
        sourceIdsB: sourceIds(contradiction.sourceIdsB, `${name}.sourceIdsB`),
        decision: "[PENDIENTE POR DEFINIR]",
      };
    });
}
