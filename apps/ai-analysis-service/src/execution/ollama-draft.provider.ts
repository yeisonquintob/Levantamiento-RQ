import { parseAiAnalysisDraft } from "./ai-analysis-draft";
import {
  AiProviderError,
  type AiGenerationRequest,
  type AiGenerationResponse,
  type AiTextProvider,
} from "./ai-text-provider";
import type { LocalAiConfig } from "../local-ai/ollama.config";
import {
  LocalAiError,
  OllamaClient,
  OLLAMA_RUNTIME_CONTEXT_CAP,
} from "../local-ai/ollama.client";
import { LocalDraftStages } from "./local-draft-stages";
import type {
  LocalDraftBlockProgressReporter,
  LocalDraftLogicalBlock,
} from "./local-draft-block-map";
import type { AiAnalysisDraft } from "@levantamiento-rq/shared-contracts";

function estimatedTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

// PASO_8_CONTEXTO_LOCAL_POR_BLOQUE_V1
const LOCAL_DRAFT_OUTPUT_CAP = 8192;
const LOCAL_DRAFT_BASE_RESERVE = 1024;

const SNAPSHOT_CATEGORIES = [
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

type SnapshotCategory = (typeof SNAPSHOT_CATEGORIES)[number];

function object(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function markerBlock(
  text: string,
  marker: string,
  nextMarkers: readonly string[],
): string | null {
  const token = `${marker}\n`;
  let start = text.indexOf(token);
  if (start < 0) {
    if (!text.startsWith(marker)) return null;
    start = 0;
  }
  start += token.length;

  let end = text.length;
  for (const next of nextMarkers) {
    const index = text.indexOf(`\n${next}\n`, start);
    if (index >= 0 && index < end) end = index;
  }
  const value = text.slice(start, end).trim();
  return value || null;
}

function parseMarkerJson(
  text: string,
  marker: string,
  nextMarkers: readonly string[],
): Readonly<Record<string, unknown>> | null {
  const raw = markerBlock(text, marker, nextMarkers);
  if (!raw) return null;

  // PASO_8B_SNAPSHOT_MARKER_PREAMBLE_V1
  // Algunos bloques estructurados incluyen una línea descriptiva segura antes
  // del JSON, por ejemplo PROJECT_KNOWLEDGE_SNAPSHOT_LOCAL. Primero probamos el
  // bloque puro y después únicamente el objeto JSON delimitado por { ... }.
  // No se recorta contenido del objeto ni se aceptan JSON parciales.
  const candidates = [raw];
  const objectStart = raw.indexOf("{");
  const objectEnd = raw.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(raw.slice(objectStart, objectEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = object(JSON.parse(candidate));
      if (parsed) return parsed;
    } catch {
      // Probar la siguiente representación completa del bloque.
    }
  }

  return null;
}

function sectionKeyForStage(stagePath: string): string | null {
  const match = /^sections\.([^.[]+)/u.exec(stagePath);
  if (match) return match[1];

  if (stagePath.startsWith("structuredAnalysis.processFlows"))
    return "processFlow";
  if (stagePath.startsWith("structuredAnalysis.entityRelationship"))
    return "processFlow";
  if (stagePath.startsWith("structuredAnalysis.functionalUserStories"))
    return "milestones";
  if (stagePath.startsWith("structuredAnalysis.backlogStructure"))
    return "backlogStructure";
  if (stagePath.startsWith("structuredAnalysis.tests")) return "tests";
  if (stagePath.startsWith("structuredAnalysis.scrumPlan")) return "scrumPlan";
  if (stagePath.startsWith("requirements")) return "nonFunctionalRequirements";
  return null;
}

function currentSectionKeys(stagePath: string): readonly string[] {
  const section = sectionKeyForStage(stagePath);
  const dependencies: Readonly<Record<string, readonly string[]>> = {
    header: ["header"],
    objectives: ["header", "objectives", "problemDescription"],
    problemDescription: ["header", "problemDescription"],
    scope: ["objectives", "problemDescription", "scope"],
    solutionProposal: ["problemDescription", "scope", "solutionProposal"],
    processFlow: [
      "problemDescription",
      "scope",
      "solutionProposal",
      "processFlow",
    ],
    milestones: ["objectives", "scope", "processFlow", "milestones"],
    backlogStructure: ["milestones", "backlogStructure"],
    tests: ["milestones", "backlogStructure", "tests"],
    assumptionsDependenciesPending: ["scope", "assumptionsDependenciesPending"],
    approvalsAndChangeControl: [
      "assumptionsDependenciesPending",
      "approvalsAndChangeControl",
    ],
    writingRules: ["writingRules"],
    visualFormat: ["visualFormat"],
    automationInstruction: ["automationInstruction"],
    scrumPlan: ["milestones", "backlogStructure", "tests", "scrumPlan"],
    nonFunctionalRequirements: ["scope", "nonFunctionalRequirements"],
  };
  return section ? (dependencies[section] ?? [section]) : [];
}

/*
 * PASO_7_CONTEXTO_ESPECIALIZADO_POR_PUNTO_V2
 *
 * No existe selección semántica de hallazgos. El stage elige categorías
 * completas mediante una tabla determinística. Un path desconocido falla hacia
 * el contexto completo para no perder evidencia por una ruta nueva del schema.
 */
const LOCAL_DRAFT_GUARD_CATEGORIES: readonly SnapshotCategory[] = [
  "contradictions",
  "pendingQuestions",
  "warnings",
];

function structuredCategoriesForStage(
  stagePath: string,
): readonly SnapshotCategory[] | null {
  if (stagePath.startsWith("structuredAnalysis.processFlows")) {
    return [
      "actors",
      "problems",
      "facts",
      "currentProcesses",
      "expectedProcesses",
      "businessRules",
      "integrations",
    ];
  }

  if (stagePath.startsWith("structuredAnalysis.entityRelationship")) {
    return ["facts", "businessRules", "entities", "integrations"];
  }

  if (stagePath.startsWith("structuredAnalysis.functionalUserStories")) {
    return [
      "actors",
      "needs",
      "facts",
      "functionalRequirements",
      "businessRules",
      "integrations",
      "risks",
      "decisions",
    ];
  }

  if (stagePath.startsWith("structuredAnalysis.backlogStructure")) {
    return [
      "facts",
      "functionalRequirements",
      "businessRules",
      "integrations",
      "risks",
      "decisions",
    ];
  }

  if (stagePath.startsWith("structuredAnalysis.tests")) {
    return [
      "facts",
      "functionalRequirements",
      "nonFunctionalRequirements",
      "businessRules",
      "integrations",
      "risks",
    ];
  }

  if (stagePath.startsWith("structuredAnalysis.scrumPlan")) {
    return [
      "facts",
      "functionalRequirements",
      "businessRules",
      "integrations",
      "risks",
      "decisions",
    ];
  }

  if (stagePath.startsWith("requirements")) {
    return [
      "facts",
      "nonFunctionalRequirements",
      "businessRules",
      "integrations",
      "risks",
    ];
  }

  if (stagePath.startsWith("pendingQuestions")) {
    return ["facts", "risks", "decisions", "pendingQuestions"];
  }

  if (stagePath.startsWith("contradictions")) {
    return ["facts", "decisions", "contradictions", "pendingQuestions"];
  }

  if (stagePath.startsWith("warnings")) {
    return ["facts", "risks", "warnings", "pendingQuestions"];
  }

  return null;
}

export function localDraftEvidenceCategories(
  stagePath: string,
): readonly SnapshotCategory[] {
  const structured = structuredCategoriesForStage(stagePath);
  if (structured) {
    return [...new Set([...structured, ...LOCAL_DRAFT_GUARD_CATEGORIES])];
  }

  const section = sectionKeyForStage(stagePath);
  const bySection: Readonly<Record<string, readonly SnapshotCategory[]>> = {
    header: ["actors", "facts", "decisions", "problems", "pendingQuestions"],
    objectives: ["problems", "needs", "facts", "risks", "decisions"],
    problemDescription: [
      "actors",
      "problems",
      "needs",
      "facts",
      "currentProcesses",
      "risks",
    ],
    scope: [
      "needs",
      "facts",
      "functionalRequirements",
      "nonFunctionalRequirements",
      "businessRules",
      "integrations",
      "risks",
      "decisions",
    ],
    solutionProposal: [
      "needs",
      "expectedProcesses",
      "functionalRequirements",
      "businessRules",
      "entities",
      "integrations",
      "decisions",
    ],
    processFlow: [
      "actors",
      "problems",
      "currentProcesses",
      "expectedProcesses",
      "businessRules",
      "integrations",
      "facts",
    ],
    milestones: [
      "actors",
      "needs",
      "functionalRequirements",
      "businessRules",
      "integrations",
      "facts",
      "risks",
      "decisions",
    ],
    backlogStructure: [
      "needs",
      "functionalRequirements",
      "businessRules",
      "integrations",
      "decisions",
      "risks",
    ],
    tests: [
      "functionalRequirements",
      "nonFunctionalRequirements",
      "businessRules",
      "integrations",
      "risks",
      "facts",
    ],
    nonFunctionalRequirements: [
      "nonFunctionalRequirements",
      "businessRules",
      "integrations",
      "risks",
      "facts",
    ],
    assumptionsDependenciesPending: [
      "risks",
      "decisions",
      "contradictions",
      "pendingQuestions",
      "warnings",
      "integrations",
    ],
    approvalsAndChangeControl: [
      "decisions",
      "risks",
      "pendingQuestions",
      "facts",
    ],
    writingRules: ["facts", "decisions", "warnings"],
    visualFormat: ["facts", "decisions", "warnings"],
    automationInstruction: [
      "functionalRequirements",
      "integrations",
      "businessRules",
      "decisions",
    ],
    scrumPlan: [
      "functionalRequirements",
      "businessRules",
      "integrations",
      "risks",
      "decisions",
      "facts",
    ],
  };

  if (!section) {
    // Fail-safe para cualquier stage futuro no clasificado.
    return SNAPSHOT_CATEGORIES;
  }

  return [
    ...new Set([
      ...(bySection[section] ?? SNAPSHOT_CATEGORIES),
      ...LOCAL_DRAFT_GUARD_CATEGORIES,
    ]),
  ];
}

function compactCurrentVersion(
  value: Readonly<Record<string, unknown>>,
  stagePath: string,
): Readonly<Record<string, unknown>> {
  const selected = new Set(currentSectionKeys(stagePath));
  const rawSections = Array.isArray(value.sections) ? value.sections : [];
  const sections = rawSections.filter((candidate) => {
    const section = object(candidate);
    return typeof section?.key === "string" && selected.has(section.key);
  });

  const sectionKey = sectionKeyForStage(stagePath);
  const includeDomainCollections =
    sectionKey === "milestones" ||
    sectionKey === "backlogStructure" ||
    sectionKey === "tests" ||
    sectionKey === "scrumPlan" ||
    sectionKey === "nonFunctionalRequirements";

  return {
    ...(typeof value.regenerationMode === "string"
      ? { regenerationMode: value.regenerationMode }
      : {}),
    ...(typeof value.priority === "string" ? { priority: value.priority } : {}),
    sections,
    ...(includeDomainCollections
      ? {
          fields: value.fields ?? [],
          requirements: value.requirements ?? [],
          evidence: value.evidence ?? [],
        }
      : {}),
  };
}

function findingSourceIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate) => {
    const finding = object(candidate);
    if (!finding || !Array.isArray(finding.sourceIds)) return [];
    return finding.sourceIds.filter(
      (sourceId): sourceId is string =>
        typeof sourceId === "string" && sourceId.trim().length > 0,
    );
  });
}

function compactSnapshot(
  snapshot: Readonly<Record<string, unknown>>,
  stagePath: string,
): Readonly<Record<string, unknown>> {
  const findings = object(snapshot.findings);
  if (!findings) return snapshot;

  const selected = new Set(localDraftEvidenceCategories(stagePath));
  const compactFindings = Object.fromEntries(
    SNAPSHOT_CATEGORIES.filter((category) => selected.has(category))
      .map((category) => [category, findings[category] ?? []] as const)
      .filter(([, value]) => Array.isArray(value) && value.length > 0),
  );

  const referenced = new Set(
    Object.values(compactFindings)
      .flatMap((value) => findingSourceIds(value))
      .map((sourceId) => sourceId.toLowerCase()),
  );
  const declaredSourceIds = Array.isArray(snapshot.sourceIds)
    ? snapshot.sourceIds.filter(
        (sourceId): sourceId is string => typeof sourceId === "string",
      )
    : [];
  const relevantSourceIds = declaredSourceIds.filter((sourceId) =>
    referenced.has(sourceId.toLowerCase()),
  );

  return {
    schemaVersion: snapshot.schemaVersion,
    projectId: snapshot.projectId,
    sourceIds: relevantSourceIds,
    findings: compactFindings,
  };
}

function structureSensitiveStage(stagePath: string): boolean {
  return (
    stagePath.startsWith("structuredAnalysis.functionalUserStories") ||
    stagePath.startsWith("structuredAnalysis.backlogStructure") ||
    stagePath.startsWith("structuredAnalysis.tests") ||
    stagePath.startsWith("structuredAnalysis.scrumPlan") ||
    stagePath.startsWith("sections.milestones") ||
    stagePath.startsWith("sections.backlogStructure") ||
    stagePath.startsWith("sections.tests") ||
    stagePath.startsWith("sections.scrumPlan")
  );
}

export function compactLocalDraftUserPrompt(
  userPrompt: string,
  stagePath: string,
): string {
  const snapshot = parseMarkerJson(
    userPrompt,
    "PROJECT_KNOWLEDGE_SNAPSHOT_LOCAL",
    ["FUNCTIONAL_COVERAGE_MANIFEST_V1", "MANIFIESTO_ESTRUCTURA_EXPLICITA"],
  );
  if (!snapshot) return userPrompt;

  const instruction = markerBlock(
    userPrompt,
    "SOLICITUD DE CAMBIO CONFIABLE DEL USUARIO",
    ["DOCUMENTO_Y_PLANTILLA"],
  );
  const document = markerBlock(userPrompt, "DOCUMENTO_Y_PLANTILLA", [
    "VERSION_ACTUAL",
  ]);
  const currentVersion = parseMarkerJson(userPrompt, "VERSION_ACTUAL", [
    "PROJECT_KNOWLEDGE_SNAPSHOT_LOCAL",
    "FUENTES_NO_CONFIABLES",
  ]);
  const functionalCoverage = markerBlock(
    userPrompt,
    "FUNCTIONAL_COVERAGE_MANIFEST_V1",
    ["MANIFIESTO_ESTRUCTURA_EXPLICITA"],
  );
  const explicitStructure = markerBlock(
    userPrompt,
    "MANIFIESTO_ESTRUCTURA_EXPLICITA",
    ["MANIFIESTO_ALINEACION_HUP_HUF"],
  );
  const alignment = markerBlock(userPrompt, "MANIFIESTO_ALINEACION_HUP_HUF", [
    "Devuelve ahora únicamente el JSON solicitado, sin Markdown ni explicación externa.",
  ]);

  const structureSensitive = structureSensitiveStage(stagePath);

  return [
    "LOCAL_DRAFT_STAGE_EVIDENCE_V1",
    "Usa únicamente la evidencia incluida aquí, la versión actual relevante y el contexto compartido del stage. No inventes información ni elimines sourceIds.",
    "Los datos omitidos pertenecen a otros bloques del mismo documento y no deben rellenarse en este fragmento.",
    instruction
      ? `SOLICITUD DE CAMBIO CONFIABLE DEL USUARIO\n${instruction}`
      : "",
    document ? `DOCUMENTO_Y_PLANTILLA\n${document}` : "",
    currentVersion
      ? `VERSION_ACTUAL_RELEVANTE\n${JSON.stringify(
          compactCurrentVersion(currentVersion, stagePath),
        )}`
      : "",
    `PROJECT_KNOWLEDGE_SNAPSHOT_LOCAL_RELEVANTE\n${JSON.stringify(
      compactSnapshot(snapshot, stagePath),
    )}`,
    structureSensitive && functionalCoverage
      ? `FUNCTIONAL_COVERAGE_MANIFEST_V1\n${functionalCoverage}`
      : "",
    structureSensitive && explicitStructure
      ? `MANIFIESTO_ESTRUCTURA_EXPLICITA\n${explicitStructure}`
      : "",
    structureSensitive && alignment
      ? `MANIFIESTO_ALINEACION_HUP_HUF\n${alignment}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export class OllamaDraftProvider implements AiTextProvider {
  constructor(
    private readonly config: LocalAiConfig,
    private readonly client: Pick<OllamaClient, "generate"> = new OllamaClient(
      config,
    ),
    private readonly beforeStage?: () => Promise<void>,
    private readonly validateDraft?: (
      draft: AiAnalysisDraft,
    ) => readonly string[],
    private readonly logicalBlocks: readonly LocalDraftLogicalBlock[] = [],
    private readonly onBlockProgress?: LocalDraftBlockProgressReporter,
    private readonly resumeStageValues: Readonly<Record<string, unknown>> = {},
  ) {}

  /*
   * LOCAL_DRAFT_ACTIVE_ABORT_V1
   *
   * El botón Cancelar marca la solicitud como CANCELLED en BD. Mientras una
   * inferencia Ollama del borrador local está activa, consultamos ese estado
   * periódicamente. Si cambia, abortamos la petición HTTP /api/generate que ya
   * está en curso; no esperamos a que termine el fragmento actual.
   *
   * No modifica la BD, no crea migraciones y no cambia la lógica documental.
   */
  private async generateWithCancellation(
    prompt: string,
    schema: Readonly<Record<string, unknown>>,
    images: readonly string[] | undefined,
    traceContext: Parameters<OllamaClient["generate"]>[3],
  ): Promise<string> {
    const beforeStage = this.beforeStage;

    // Conserva la comprobación existente antes de comenzar.
    await beforeStage?.();

    // En usos sin callback de cancelación se conserva el comportamiento actual.
    if (!beforeStage) {
      return this.client.generate(
        prompt,
        schema,
        images,
        traceContext,
        undefined,
        {
          // PASO_5_PERFILES_LOCAL_EXTRACT_DOCUMENT_V1
          profile: "LOCAL_DOCUMENT",
        },
      );
    }

    const cancellation = new AbortController();
    let cancellationFailure: unknown = null;
    let checking = false;
    let finished = false;

    // La solicitud CANCELLED se detecta mientras Ollama sigue generando.
    const timer = setInterval(() => {
      if (finished || checking || cancellation.signal.aborted) return;
      checking = true;

      void beforeStage()
        .catch((error: unknown) => {
          if (finished) return;
          cancellationFailure = error;
          cancellation.abort();
        })
        .finally(() => {
          checking = false;
        });
    }, 500);

    try {
      const raw = await this.client.generate(
        prompt,
        schema,
        images,
        traceContext,
        cancellation.signal,
        {
          // PASO_5_PERFILES_LOCAL_EXTRACT_DOCUMENT_V1
          profile: "LOCAL_DOCUMENT",
        },
      );

      // Evita devolver un fragmento si CANCELLED ocurrió justo al responder.
      await beforeStage();
      return raw;
    } catch (error) {
      // Conserva AI_CANCELLED como causa funcional de la cancelación.
      if (cancellationFailure) throw cancellationFailure;
      throw error;
    } finally {
      finished = true;
      clearInterval(timer);
    }
  }

  private async generateBySections(
    request: AiGenerationRequest,
  ): Promise<AiGenerationResponse> {
    let traceId: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    const stages = new LocalDraftStages(
      request.schema,
      async (stage, context, correction) => {
        await this.beforeStage?.();
        const schema = {
          type: "object",
          additionalProperties: false,
          required: ["value"],
          properties: { value: stage.schema },
        };
        const stageEvidence = compactLocalDraftUserPrompt(
          request.userPrompt,
          stage.path,
        );
        const prompt = [
          request.systemInstruction,
          stageEvidence,
          "GENERACION_LOCAL_POR_SECCIONES_V2",
          "Esta llamada produce únicamente el fragmento indicado, dentro de {value: ...}. No repitas el documento completo.",
          "El contexto compartido contiene dependencias ya generadas; no es evidencia nueva. Conserva identidades, relaciones y sourceIds; declara faltantes sin inventar datos.",
          `FRAGMENTO=${stage.path}`,
          `CONTEXTO_COMPARTIDO=${context}`,
          correction ? `CORRECCION_REQUERIDA=${correction}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        const requiredTokens =
          estimatedTokens(prompt) + estimatedTokens(JSON.stringify(schema));
        const availableContext = Math.min(
          this.config.contextTokens,
          OLLAMA_RUNTIME_CONTEXT_CAP,
        );
        const outputReserve =
          Math.min(
            this.config.maxOutputTokens ?? 8192,
            LOCAL_DRAFT_OUTPUT_CAP,
          ) + LOCAL_DRAFT_BASE_RESERVE;
        if (requiredTokens + outputReserve > availableContext) {
          throw new AiProviderError(
            "OLLAMA_STAGE_CONTEXT_EXCEEDED",
            `${stage.path}: el contexto relevante requiere aproximadamente ${requiredTokens + outputReserve} tokens y el máximo efectivo por llamada es ${availableContext}. El presupuesto documental configurado es ${this.config.contextTokens}. No se truncó evidencia.`,
            false,
          );
        }
        inputTokens += requiredTokens;
        let raw: string;
        try {
          raw = await this.generateWithCancellation(prompt, schema, [], {
            sourceTitle: `Borrador local · ${stage.path}`,
            sourceClassification: "REQUIREMENT_DOCUMENT_SECTION",
            onTraceId: (value) => {
              traceId = value;
            },
          });
        } catch (error) {
          if (error instanceof LocalAiError)
            throw new AiProviderError(
              error.code,
              error.message,
              error.retryable || error.code === "OLLAMA_OUTPUT_TRUNCATED",
            );
          throw error;
        }
        outputTokens += estimatedTokens(raw);
        try {
          const parsed = JSON.parse(raw) as { value?: unknown };
          if (!parsed || !Object.hasOwn(parsed, "value"))
            throw new Error("Falta value");
          return parsed.value;
        } catch {
          throw new AiProviderError(
            "OLLAMA_INVALID_JSON",
            `${stage.path}: Ollama no devolvió el fragmento JSON solicitado.`,
            true,
          );
        }
      },
      this.validateDraft,
      this.logicalBlocks,
      this.onBlockProgress,
      this.resumeStageValues,
    );
    const draft = await stages.run();
    await this.beforeStage?.();
    return {
      draft,
      providerRequestId: traceId,
      inputTokens,
      outputTokens,
    };
  }

  async generate(request: AiGenerationRequest): Promise<AiGenerationResponse> {
    const properties = request.schema.properties as
      Record<string, { const?: string }> | undefined;
    if (properties?.schemaVersion?.const === "4.1.0")
      return this.generateBySections(request);
    const prompt = [request.systemInstruction, request.userPrompt].join("\n\n");
    let traceId: string | null = null;
    try {
      const raw = await this.generateWithCancellation(
        prompt,
        request.schema,
        [],
        {
          sourceTitle: "Borrador de requerimientos",
          sourceClassification: "REQUIREMENT_DOCUMENT",
          onTraceId: (value) => {
            traceId = value;
          },
        },
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new AiProviderError(
          "OLLAMA_INVALID_JSON",
          "Ollama no devolvió un JSON válido para el borrador.",
          true,
        );
      }
      let draft;
      try {
        draft = parseAiAnalysisDraft(parsed);
      } catch (error) {
        throw new AiProviderError(
          "OLLAMA_DRAFT_INVALID",
          error instanceof Error
            ? error.message
            : "El borrador local no cumple el contrato requerido.",
          true,
        );
      }
      return {
        draft,
        providerRequestId: traceId,
        inputTokens: estimatedTokens(prompt),
        outputTokens: estimatedTokens(raw),
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof LocalAiError) {
        throw new AiProviderError(error.code, error.message, error.retryable);
      }
      throw error;
    }
  }
}
