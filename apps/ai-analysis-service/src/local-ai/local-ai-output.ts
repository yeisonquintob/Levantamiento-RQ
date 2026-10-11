export const LOCAL_AI_SCHEMA_VERSION = "1.1.0" as const;
export const LOCAL_AI_PROMPT_VERSION = "1.3.0" as const;

export const LOCAL_AI_CATEGORIES = [
  "actors",
  "problems",
  "needs",
  "facts",
  "currentProcesses",
  "expectedProcesses",
  "functionalRequirements",
  "nonFunctionalRequirements",
  "businessRules",
  "entities",
  "integrations",
  "risks",
  "decisions",
  "contradictions",
  "pendingQuestions",
  "warnings",
] as const;

export type LocalAiCategory = (typeof LOCAL_AI_CATEGORIES)[number];

export interface LocalAiFinding {
  description: string;
  sourceIds: readonly string[];
}

export interface LocalSourceAnalysis {
  schemaVersion: typeof LOCAL_AI_SCHEMA_VERSION;
  sourceId: string;
  summary: string;
  actors: readonly LocalAiFinding[];
  problems: readonly LocalAiFinding[];
  needs: readonly LocalAiFinding[];
  facts: readonly LocalAiFinding[];
  currentProcesses: readonly LocalAiFinding[];
  expectedProcesses: readonly LocalAiFinding[];
  functionalRequirements: readonly LocalAiFinding[];
  nonFunctionalRequirements: readonly LocalAiFinding[];
  businessRules: readonly LocalAiFinding[];
  entities: readonly LocalAiFinding[];
  integrations: readonly LocalAiFinding[];
  risks: readonly LocalAiFinding[];
  decisions: readonly LocalAiFinding[];
  contradictions: readonly LocalAiFinding[];
  pendingQuestions: readonly LocalAiFinding[];
  warnings: readonly LocalAiFinding[];
}

export interface ProjectKnowledgeSnapshotMetrics {
  originalTokens: number;
  localAnalysisTokens: number;
  snapshotTokens: number;
  targetSnapshotTokens: number;
  reductionPercentage: number;
  findingsBefore: number;
  findingsAfterExactDedup: number;
  findingsAfterSemanticDedup: number;
  criticalFindingsPreserved: number;
  sourceCoverage: number;
}

export interface ProjectKnowledgeSnapshot {
  schemaVersion: typeof LOCAL_AI_SCHEMA_VERSION;
  projectId: string;
  sourceIds: readonly string[];
  originalCharacters: number;
  estimatedOriginalTokens: number;
  analysisCharacters: number;
  estimatedAnalysisTokens: number;
  snapshotCharacters: number;
  estimatedSnapshotTokens: number;
  reductionPercentage: number;
  metrics: ProjectKnowledgeSnapshotMetrics;
  findings: Readonly<Record<LocalAiCategory, readonly LocalAiFinding[]>>;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function findings(
  value: unknown,
  sourceId: string,
  field: string,
): LocalAiFinding[] {
  if (!Array.isArray(value)) throw new Error(`${field} debe ser un arreglo.`);
  return value.map((item, index) => {
    const entry = record(item);
    if (
      !entry ||
      typeof entry.description !== "string" ||
      !entry.description.trim()
    ) {
      throw new Error(`${field}[${index}].description no es válido.`);
    }
    if (!Array.isArray(entry.sourceIds) || entry.sourceIds.length === 0) {
      throw new Error(`${field}[${index}].sourceIds no es válido.`);
    }
    const sourceIds = entry.sourceIds.map((id) => {
      if (
        typeof id !== "string" ||
        id.toLowerCase() !== sourceId.toLowerCase()
      ) {
        throw new Error(
          `${field}[${index}] referencia una fuente desconocida.`,
        );
      }
      return sourceId;
    });
    return {
      description: entry.description.trim(),
      sourceIds: [...new Set(sourceIds)],
    };
  });
}

export function parseLocalSourceAnalysis(
  value: unknown,
  expectedSourceId: string,
): LocalSourceAnalysis {
  const input = record(value);
  if (!input || input.schemaVersion !== LOCAL_AI_SCHEMA_VERSION) {
    throw new Error("La salida local no usa el schemaVersion soportado.");
  }
  if (
    typeof input.sourceId !== "string" ||
    input.sourceId.toLowerCase() !== expectedSourceId.toLowerCase()
  ) {
    throw new Error("La salida local no corresponde a la fuente solicitada.");
  }
  if (typeof input.summary !== "string")
    throw new Error("summary debe ser texto.");
  const parsed = Object.fromEntries(
    LOCAL_AI_CATEGORIES.map((category) => [
      category,
      findings(input[category], expectedSourceId, category),
    ]),
  ) as unknown as Record<LocalAiCategory, LocalAiFinding[]>;
  return {
    schemaVersion: LOCAL_AI_SCHEMA_VERSION,
    sourceId: expectedSourceId,
    summary: input.summary.trim(),
    ...parsed,
  };
}

// PASO_14_LOCAL_EXTRACT_SALIDA_COMPACTA_V1
//
// Contrato INTERNO y exclusivo de LOCAL_EXTRACT.
// Evita que el modelo repita sourceId/sourceIds y 16 arreglos, pero el resto
// del sistema sigue recibiendo exactamente LocalSourceAnalysis.
export interface LocalExtractCompactFinding {
  category: LocalAiCategory;
  description: string;
}

export interface LocalExtractCompactOutput {
  summary: string;
  findings: readonly LocalExtractCompactFinding[];
}

export function buildLocalExtractCompactOutputSchema(): Readonly<
  Record<string, unknown>
> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "findings"],
    properties: {
      summary: {
        type: "string",
        maxLength: 800,
      },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["category", "description"],
          properties: {
            category: {
              type: "string",
              enum: [...LOCAL_AI_CATEGORIES],
            },
            description: {
              type: "string",
              maxLength: 1000,
            },
          },
        },
      },
    },
  };
}

export function parseLocalExtractAnalysis(
  value: unknown,
  expectedSourceId: string,
): LocalSourceAnalysis {
  const input = record(value);

  // Compatibilidad defensiva: una salida legacy válida sigue siendo aceptable.
  // La generación nueva no la solicita: recibe el schema compacto de arriba.
  if (input?.schemaVersion === LOCAL_AI_SCHEMA_VERSION) {
    return parseLocalSourceAnalysis(value, expectedSourceId);
  }

  if (!input || typeof input.summary !== "string") {
    throw new Error("La salida compacta LOCAL_EXTRACT requiere summary.");
  }
  if (!Array.isArray(input.findings)) {
    throw new Error("La salida compacta LOCAL_EXTRACT requiere findings.");
  }

  const byCategory = Object.fromEntries(
    LOCAL_AI_CATEGORIES.map((category) => [category, [] as LocalAiFinding[]]),
  ) as Record<LocalAiCategory, LocalAiFinding[]>;

  const allowedCategories = new Set<string>(LOCAL_AI_CATEGORIES);

  input.findings.forEach((item, index) => {
    const finding = record(item);
    if (
      !finding ||
      typeof finding.category !== "string" ||
      !allowedCategories.has(finding.category)
    ) {
      throw new Error(
        `findings[${index}].category no corresponde a una categoría local soportada.`,
      );
    }
    if (
      typeof finding.description !== "string" ||
      !finding.description.trim()
    ) {
      throw new Error(`findings[${index}].description no es válido.`);
    }

    byCategory[finding.category as LocalAiCategory].push({
      description: finding.description.trim(),
      sourceIds: [expectedSourceId],
    });
  });

  return {
    schemaVersion: LOCAL_AI_SCHEMA_VERSION,
    sourceId: expectedSourceId,
    summary: input.summary.trim(),
    ...byCategory,
  };
}

export function buildLocalAiOutputSchema(): Readonly<Record<string, unknown>> {
  const finding = {
    type: "object",
    additionalProperties: false,
    required: ["description", "sourceIds"],
    properties: {
      description: { type: "string" },
      sourceIds: { type: "array", minItems: 1, items: { type: "string" } },
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "sourceId", "summary", ...LOCAL_AI_CATEGORIES],
    properties: {
      schemaVersion: { type: "string", enum: [LOCAL_AI_SCHEMA_VERSION] },
      sourceId: { type: "string" },
      summary: { type: "string" },
      ...Object.fromEntries(
        LOCAL_AI_CATEGORIES.map((key) => [
          key,
          { type: "array", items: finding },
        ]),
      ),
    },
  };
}
