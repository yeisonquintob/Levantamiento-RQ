import {
  DOCUMENT_SECTION_DEFINITIONS,
  type AiAnalysisDraft,
  type DocumentSectionKey,
} from "@levantamiento-rq/shared-contracts";

export const AI_ANALYSIS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "sections",
    "requirements",
    "pendingQuestions",
    "contradictions",
    "warnings",
  ],
  properties: {
    schemaVersion: { type: "string", const: "1.0.0" },
    sections: {
      type: "array",
      minItems: 13,
      maxItems: 13,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title", "content"],
        properties: {
          key: {
            type: "string",
            enum: DOCUMENT_SECTION_DEFINITIONS.map((item) => item.key),
          },
          title: { type: "string", minLength: 1, maxLength: 200 },
          content: { type: "string", minLength: 1, maxLength: 30000 },
        },
      },
    },
    requirements: {
      type: "array",
      maxItems: 300,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "clientId",
          "sectionKey",
          "code",
          "title",
          "description",
          "requirementType",
          "acceptanceCriteria",
          "sourceIds",
        ],
        properties: {
          clientId: { type: "string", minLength: 1, maxLength: 80 },
          sectionKey: {
            type: "string",
            enum: ["milestones", "nonFunctionalRequirements"],
          },
          code: { type: "string", minLength: 1, maxLength: 50 },
          title: { type: "string", minLength: 1, maxLength: 300 },
          description: { type: "string", minLength: 1, maxLength: 10000 },
          requirementType: { type: "string", minLength: 1, maxLength: 80 },
          acceptanceCriteria: {
            type: "array",
            maxItems: 30,
            items: { type: "string", minLength: 1, maxLength: 2000 },
          },
          sourceIds: {
            type: "array",
            maxItems: 100,
            items: { type: "string", format: "uuid" },
          },
        },
      },
    },
    pendingQuestions: {
      type: "array",
      maxItems: 100,
      items: { type: "string", minLength: 1, maxLength: 2000 },
    },
    contradictions: {
      type: "array",
      maxItems: 100,
      items: { type: "string", minLength: 1, maxLength: 2000 },
    },
    warnings: {
      type: "array",
      maxItems: 100,
      items: { type: "string", minLength: 1, maxLength: 2000 },
    },
  },
} as const;

function object(
  value: unknown,
  name: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} no es un objeto válido.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function string(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`${name} no es texto válido.`);
  }
  return value.trim();
}

function strings(value: unknown, name: string, maximumItems: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`${name} no es una lista válida.`);
  }
  return value.map((item, index) => string(item, `${name}[${index}]`, 2000));
}

export function parseAiAnalysisDraft(value: unknown): AiAnalysisDraft {
  const root = object(value, "resultado");
  if (root.schemaVersion !== "1.0.0") {
    throw new Error("schemaVersion debe ser 1.0.0.");
  }
  if (!Array.isArray(root.sections) || root.sections.length !== 13) {
    throw new Error("El resultado debe contener exactamente 13 secciones.");
  }

  const sections = root.sections.map((value, index) => {
    const section = object(value, `sections[${index}]`);
    const expected = DOCUMENT_SECTION_DEFINITIONS[index];
    if (!expected || section.key !== expected.key) {
      throw new Error("Las secciones no respetan el orden canónico.");
    }
    if (section.title !== expected.title) {
      throw new Error("Los títulos no respetan la plantilla canónica.");
    }
    return {
      key: expected.key,
      title: expected.title,
      content: string(section.content, `sections[${index}].content`, 30000),
    };
  });

  if (!Array.isArray(root.requirements) || root.requirements.length > 300) {
    throw new Error("requirements no es una lista válida.");
  }
  const clientIds = new Set<string>();
  const requirements = root.requirements.map((value, index) => {
    const requirement = object(value, `requirements[${index}]`);
    const clientId = string(
      requirement.clientId,
      `requirements[${index}].clientId`,
      80,
    );
    if (clientIds.has(clientId)) throw new Error("clientId debe ser único.");
    clientIds.add(clientId);
    if (
      !Array.isArray(requirement.sourceIds) ||
      requirement.sourceIds.length > 100
    ) {
      throw new Error(`requirements[${index}].sourceIds no es válido.`);
    }
    const sectionKey = requirement.sectionKey;
    if (
      sectionKey !== "milestones" &&
      sectionKey !== "nonFunctionalRequirements"
    ) {
      throw new Error(`requirements[${index}].sectionKey no es válido.`);
    }
    return {
      clientId,
      sectionKey: sectionKey as DocumentSectionKey,
      code: string(requirement.code, `requirements[${index}].code`, 50),
      title: string(requirement.title, `requirements[${index}].title`, 300),
      description: string(
        requirement.description,
        `requirements[${index}].description`,
        10000,
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
      sourceIds: requirement.sourceIds.map((item, sourceIndex) => {
        const id = string(
          item,
          `requirements[${index}].sourceIds[${sourceIndex}]`,
          36,
        ).toLowerCase();
        if (!/^[0-9a-f-]{36}$/.test(id))
          throw new Error("sourceId no es válido.");
        return id;
      }),
    };
  });

  return {
    schemaVersion: "1.0.0",
    sections,
    requirements,
    pendingQuestions: strings(root.pendingQuestions, "pendingQuestions", 100),
    contradictions: strings(root.contradictions, "contradictions", 100),
    warnings: strings(root.warnings, "warnings", 100),
  };
}
