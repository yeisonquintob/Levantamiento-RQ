import Ajv from "ajv";
import type { AiAnalysisDraft } from "@levantamiento-rq/shared-contracts";
import { parseAiAnalysisDraft } from "./ai-analysis-draft";
import { AiProviderError } from "./ai-text-provider";
import {
  localDraftBlockPrerequisiteStagePaths,
  resolveLocalDraftLogicalBlock,
  type LocalDraftBlockProgressReporter,
  type LocalDraftBlockStatus,
  type LocalDraftLogicalBlock,
} from "./local-draft-block-map";

type Schema = Record<string, unknown>;
type Value = Record<string, unknown>;

export interface LocalDraftStage {
  path: string;
  schema: Schema;
}

export type GenerateLocalFragment = (
  stage: LocalDraftStage,
  context: string,
  correction: string,
) => Promise<unknown>;

function record(value: unknown): Value {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Value)
    : {};
}

function properties(schema: Schema): Record<string, Schema> {
  return record(schema.properties) as Record<string, Schema>;
}

/** Keep stable identities and relations in shared context, not repeated prose. */
function identities(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(identities);
  if (!value || typeof value !== "object") return value;
  const result: Value = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      /^(code|id|title|name|key|sourceNumber|structureStatus|assignmentStatus|responsibility|kind|type|role|milestone|functionality|from|to|laneId|sourceParentPath)$/u.test(
        key,
      ) ||
      /(?:Codes?|Ids?)$/u.test(key) ||
      (child && typeof child === "object")
    )
      result[key] = identities(child);
  }
  return result;
}

export function localDraftStages(schema: Schema): LocalDraftStage[] {
  const root = properties(schema);
  const structured = properties(root.structuredAnalysis ?? {});
  const sectionSchemas = record(root.sections?.items).anyOf;
  if (
    record(root.schemaVersion).const !== "4.1.0" ||
    !Array.isArray(sectionSchemas)
  ) {
    throw new AiProviderError(
      "OLLAMA_STAGE_SCHEMA_INVALID",
      "La generación local por secciones requiere el contrato 4.1.0.",
      false,
    );
  }
  const sections = sectionSchemas.map((item) => ({
    path: `sections.${String(record(properties(record(item)).key).const)}`,
    schema: record(item),
  }));
  const initial = new Set([
    "header",
    "objectives",
    "problemDescription",
    "scope",
  ]);
  return [
    ...sections.filter((stage) => initial.has(stage.path.split(".")[1])),
    ...[
      "backlogStructure",
      "functionalUserStories",
      "processFlows",
      "entityRelationship",
      "tests",
      "scrumPlan",
    ]
      .filter((key) => structured[key])
      .map((key) => ({
        path: `structuredAnalysis.${key}`,
        schema: structured[key],
      })),
    { path: "requirements", schema: root.requirements },
    ...sections.filter((stage) => !initial.has(stage.path.split(".")[1])),
    ...["pendingQuestions", "contradictions", "warnings"].map((key) => ({
      path: key,
      schema: root[key],
    })),
  ];
}

/** Identify a repair target only when the validator names it explicitly. */
export function localDraftRepairTarget(
  message: string,
  stages: LocalDraftStage[],
): LocalDraftStage | undefined {
  const indexed = message.match(/sections\[(\d+)\]/u);
  if (indexed) {
    // Stages use dependency order; the caller supplies canonical sections below.
    return undefined;
  }

  const candidates = stages.flatMap((stage) => {
    const aliases = stage.path.startsWith("sections.")
      ? [stage.path, stage.path.slice("sections.".length)]
      : [stage.path];

    return aliases.flatMap((alias) => {
      const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const match = new RegExp(
        `(^|;\\s*)${escapedAlias}(?=[:.\\[\\s]|$)`,
        "u",
      ).exec(message);

      return match
        ? [
            {
              stage,
              index: (match.index ?? 0) + match[1].length,
              specificity: alias.length,
            },
          ]
        : [];
    });
  });

  return candidates.sort(
    (left, right) =>
      left.index - right.index || right.specificity - left.specificity,
  )[0]?.stage;
}

/** Every fragment uses the cloud schema; final assembly uses the same domain parser. */
export class LocalDraftStages {
  private readonly ajv = new Ajv({ allErrors: true, strict: false });
  private readonly values = new Map<string, unknown>();
  private readonly stages: LocalDraftStage[];
  private readonly canonicalSections: string[];
  private readonly completedTrackedStages = new Set<string>();

  constructor(
    schema: Schema,
    private readonly generateFragment: GenerateLocalFragment,
    private readonly validateDraft?: (
      draft: AiAnalysisDraft,
    ) => readonly string[],
    private readonly logicalBlocks: readonly LocalDraftLogicalBlock[] = [],
    private readonly onBlockProgress?: LocalDraftBlockProgressReporter,
    private readonly resumeStageValues: Readonly<Record<string, unknown>> = {},
  ) {
    this.stages = localDraftStages(schema);
    this.canonicalSections = (
      record(properties(schema).sections.items).anyOf as Schema[]
    ).map((section) => String(properties(section).key.const));

    // PASO_6_REANUDAR_REINTENTAR_BLOQUE_V1
    // Solo se hidratan valores cuyo path sigue existiendo y cuyo schema continúa
    // siendo válido. Un checkpoint corrupto u obsoleto se ignora y ese stage
    // vuelve a generarse normalmente.
    for (const [stagePath, value] of Object.entries(this.resumeStageValues)) {
      const stage = this.stages.find((item) => item.path === stagePath);
      if (!stage) continue;
      try {
        this.assertValid(stage.schema, value, stage.path);
        this.values.set(stage.path, value);
        this.completedTrackedStages.add(stage.path);
      } catch {
        // Fail-safe: regenerar el stage en lugar de confiar en un checkpoint inválido.
      }
    }
  }

  // PASO_2_TEMPLATE_POINT_EXECUTION_V2
  private trackedStagePaths(block: LocalDraftLogicalBlock): readonly string[] {
    return this.stages
      .filter(
        (stage) =>
          resolveLocalDraftLogicalBlock(stage.path, this.logicalBlocks)
            ?.blockKey === block.blockKey,
      )
      .map((stage) => stage.path);
  }

  private prerequisiteStagePaths(
    block: LocalDraftLogicalBlock,
  ): readonly string[] {
    const available = new Set(this.stages.map((stage) => stage.path));
    return localDraftBlockPrerequisiteStagePaths(block.blockKey).filter(
      (path) => available.has(path),
    );
  }

  private blockStagePaths(block: LocalDraftLogicalBlock): readonly string[] {
    return [
      ...new Set([
        ...this.prerequisiteStagePaths(block),
        ...this.trackedStagePaths(block),
      ]),
    ];
  }

  private blockStages(
    block: LocalDraftLogicalBlock,
  ): readonly LocalDraftStage[] {
    return this.blockStagePaths(block).map((path) => {
      const stage = this.stages.find((item) => item.path === path);
      if (!stage) {
        throw new AiProviderError(
          "OLLAMA_BLOCK_STAGE_MISSING",
          `${block.blockKey}: no existe el stage interno ${path}.`,
          false,
        );
      }
      return stage;
    });
  }

  // PASO_5_CHECKPOINTS_PERSISTENTES_V1
  private blockStageValues(
    block: LocalDraftLogicalBlock,
    currentStagePath?: string,
    currentStageValue?: unknown,
  ): Readonly<Record<string, unknown>> {
    const values: Record<string, unknown> = {};

    for (const path of this.blockStagePaths(block)) {
      if (path === currentStagePath) {
        values[path] = currentStageValue;
      } else if (this.values.has(path)) {
        values[path] = this.values.get(path);
      }
    }

    return values;
  }

  private assertBlockComplete(block: LocalDraftLogicalBlock): void {
    for (const stage of this.blockStages(block)) {
      if (!this.values.has(stage.path)) {
        throw new AiProviderError(
          "OLLAMA_BLOCK_INCOMPLETE",
          `${block.blockKey}: falta completar ${stage.path}.`,
          false,
        );
      }
      this.assertValid(stage.schema, this.values.get(stage.path), stage.path);
    }
  }

  private async reportBlock(
    block: LocalDraftLogicalBlock,
    status: LocalDraftBlockStatus,
    stageValues?: Readonly<Record<string, unknown>>,
    diagnostics?: {
      currentStagePath: string;
      operation: "GENERATING" | "REPAIRING";
      repairAttempt: number | null;
    },
  ): Promise<void> {
    await this.onBlockProgress?.({
      blockNumber: block.blockNumber,
      blockTotal: block.blockTotal,
      blockKey: block.blockKey,
      blockLabel: block.blockLabel,
      status,
      ...(stageValues ? { stageValues } : {}),
      ...(diagnostics ?? {}),
    });
  }

  private async generateTrackedStage(
    stage: LocalDraftStage,
    correction = "",
    reportProgress = true,
    repairAttempt = 0,
  ): Promise<unknown> {
    const block = resolveLocalDraftLogicalBlock(stage.path, this.logicalBlocks);
    const diagnostics = {
      currentStagePath: stage.path,
      operation:
        repairAttempt > 0 ? ("REPAIRING" as const) : ("GENERATING" as const),
      repairAttempt: repairAttempt > 0 ? repairAttempt : null,
    };

    if (block) {
      this.completedTrackedStages.delete(stage.path);
      // Aun cuando runLogicalBlock gestione el COMPLETED del bloque, cada stage
      // interno actualiza el diagnóstico efímero del punto visible.
      await this.reportBlock(block, "PROCESSING", undefined, diagnostics);
    }

    try {
      const value = await this.generate(
        stage,
        this.context(stage.path),
        correction,
      );

      if (block) {
        this.completedTrackedStages.add(stage.path);
        const expectedStagePaths = this.blockStagePaths(block);
        if (
          reportProgress &&
          expectedStagePaths.length > 0 &&
          expectedStagePaths.every((path) =>
            this.completedTrackedStages.has(path),
          )
        ) {
          await this.reportBlock(
            block,
            "COMPLETED",
            this.blockStageValues(block, stage.path, value),
          );
        }
      }

      return value;
    } catch (error) {
      if (block) {
        await this.reportBlock(
          block,
          error instanceof AiProviderError && error.code === "AI_CANCELLED"
            ? "CANCELLED"
            : "FAILED",
          undefined,
          diagnostics,
        );
      }
      throw error;
    }
  }

  private seedDeterministicUnmappedStages(
    executablePaths: ReadonlySet<string>,
  ): void {
    for (const stage of this.stages) {
      if (executablePaths.has(stage.path) || this.values.has(stage.path))
        continue;

      if (stage.schema.const !== undefined) {
        this.values.set(stage.path, stage.schema.const);
        continue;
      }

      if (stage.schema.type === "null") {
        this.values.set(stage.path, null);
        continue;
      }

      throw new AiProviderError(
        "OLLAMA_STAGE_UNMAPPED",
        `El stage ${stage.path} requiere generación, pero no pertenece a ningún punto de la plantilla.`,
        false,
      );
    }
  }

  private async runLogicalBlock(block: LocalDraftLogicalBlock): Promise<void> {
    const internalStages = this.blockStages(block);

    if (internalStages.length === 0) {
      if (block.presentationSource === "UNMAPPED") {
        throw new AiProviderError(
          "OLLAMA_BLOCK_UNMAPPED",
          `${block.blockKey}: el punto de plantilla no tiene una fuente de generación conocida.`,
          false,
        );
      }

      await this.reportBlock(block, "PROCESSING");
      await this.reportBlock(block, "COMPLETED", {});
      return;
    }

    if (internalStages.every((stage) => this.values.has(stage.path))) {
      this.assertBlockComplete(block);
      return;
    }

    await this.reportBlock(block, "PROCESSING");

    try {
      for (const stage of internalStages) {
        if (this.values.has(stage.path)) continue;
        this.values.set(
          stage.path,
          await this.generateTrackedStage(stage, "", false),
        );
      }

      this.assertBlockComplete(block);
      await this.reportBlock(block, "COMPLETED", this.blockStageValues(block));
    } catch (error) {
      await this.reportBlock(
        block,
        error instanceof AiProviderError && error.code === "AI_CANCELLED"
          ? "CANCELLED"
          : "FAILED",
      );
      throw error;
    }
  }

  private context(path: string): string {
    const context: Value = {};
    for (const [key, value] of this.values) {
      if (key === path) continue;
      context[key] = ["sections.objectives", "sections.scope"].includes(key)
        ? value
        : identities(value);
    }
    return JSON.stringify(context);
  }

  private assertValid(schema: Schema, value: unknown, path: string): void {
    const validate = this.ajv.compile(schema);
    if (!validate(value)) {
      throw new AiProviderError(
        "OLLAMA_FRAGMENT_INVALID",
        `${path}: ${this.ajv.errorsText(validate.errors, { separator: "; " })}`,
        true,
      );
    }
  }

  private async fragment(
    stage: LocalDraftStage,
    context: string,
    correction = "",
  ): Promise<unknown> {
    let failure = correction;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const value = await this.generateFragment(stage, context, failure);
        this.assertValid(stage.schema, value, stage.path);
        return value;
      } catch (error) {
        if (error instanceof AiProviderError && !error.retryable) throw error;
        if (
          error instanceof AiProviderError &&
          error.code === "OLLAMA_OUTPUT_TRUNCATED"
        )
          throw error;
        failure = error instanceof Error ? error.message : String(error);
        if (attempt === 2) throw error;
      }
    }
    throw new Error(failure);
  }

  /** Large containers can be split further after a truncated/invalid response. */
  private async generate(
    stage: LocalDraftStage,
    context: string,
    correction = "",
    depth = 0,
  ): Promise<unknown> {
    if (depth > 12)
      throw new AiProviderError(
        "OLLAMA_STAGE_DEPTH",
        `No se pudo dividir ${stage.path} de forma segura.`,
        false,
      );
    if (stage.schema.const !== undefined) return stage.schema.const;
    if (stage.schema.type === "null") return null;
    // Arrays of complex entries are always planned and expanded one at a time.
    if (
      stage.schema.type === "array" &&
      record(stage.schema.items).type === "object"
    ) {
      return this.array(stage, context, correction, depth);
    }
    try {
      return await this.fragment(stage, context, correction);
    } catch (error) {
      if (
        !(error instanceof AiProviderError) ||
        ![
          "OLLAMA_FRAGMENT_INVALID",
          "OLLAMA_OUTPUT_TRUNCATED",
          "OLLAMA_INVALID_JSON",
        ].includes(error.code)
      )
        throw error;
      if (!error.retryable) throw error;
      if (stage.schema.type !== "object" || !stage.schema.properties)
        throw error;
      const value: Value = {};
      for (const [key, schema] of Object.entries(properties(stage.schema))) {
        value[key] = await this.generate(
          { path: `${stage.path}.${key}`, schema },
          `${context}\nCAMPOS_YA_GENERADOS=${JSON.stringify(value)}`,
          correction,
          depth + 1,
        );
      }
      this.assertValid(stage.schema, value, stage.path);
      return value;
    }
  }

  private planningStories(): Value[] {
    const result: Value[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== "object") return;
      const item = record(value);
      if (
        typeof item.code === "string" &&
        Array.isArray(item.functionalRequirementCodes) &&
        Array.isArray(item.tasks)
      ) {
        result.push(item);
        return;
      }
      Object.values(item).forEach(visit);
    };
    visit(this.values.get("structuredAnalysis.backlogStructure"));
    return result;
  }

  private async array(
    stage: LocalDraftStage,
    context: string,
    correction: string,
    depth: number,
  ): Promise<unknown[]> {
    const itemSchema = record(stage.schema.items);
    const itemProperties = properties(itemSchema);
    const isFunctional =
      stage.path === "structuredAnalysis.functionalUserStories";
    let plan: unknown[];
    if (isFunctional) {
      // A complete HU-F per planning HU-P; never ask the model to select a subset.
      plan = this.planningStories();
    } else {
      const identityKeys = ["code", "id", "title", "name", "sourceIds"].filter(
        (key) => itemProperties[key],
      );
      const planItem = identityKeys.length
        ? {
            type: "object",
            additionalProperties: false,
            required: identityKeys,
            properties: Object.fromEntries(
              identityKeys.map((key) => [key, itemProperties[key]]),
            ),
          }
        : {
            type: "object",
            additionalProperties: false,
            required: ["description"],
            properties: {
              description: { type: "string", minLength: 1, maxLength: 1000 },
            },
          };
      plan = (await this.fragment(
        {
          path: `${stage.path}.__plan`,
          schema: { ...stage.schema, items: planItem },
        },
        context,
        `${correction}\nEnumera TODOS los elementos necesarios, con identidad estable. No desarrolles todavía su contenido. No omitas elementos para abreviar.`,
      )) as unknown[];
    }
    if (
      typeof stage.schema.maxItems === "number" &&
      plan.length > stage.schema.maxItems
    ) {
      throw new AiProviderError(
        "OLLAMA_STAGE_CAPACITY",
        `${stage.path} tiene ${plan.length} elementos y excede la capacidad de la plantilla.`,
        false,
      );
    }
    const values: unknown[] = [];
    for (const [index, identity] of plan.entries()) {
      const fixedProperties = { ...itemProperties };
      if (!isFunctional) {
        for (const [key, value] of Object.entries(record(identity))) {
          if (fixedProperties[key])
            fixedProperties[key] = { ...fixedProperties[key], const: value };
        }
      } else {
        // Titles are shared exactly between the planning and functional views.
        const code = `HU-F-${String(index + 1).padStart(3, "0")}`;
        record(identity).functionalRequirementCodes = [code];
        fixedProperties.code = { ...fixedProperties.code, const: code };
        fixedProperties.title = {
          ...fixedProperties.title,
          const: record(identity).title,
        };
      }
      values.push(
        await this.generate(
          {
            path: `${stage.path}[${index}]`,
            schema: { ...itemSchema, properties: fixedProperties },
          },
          `${context}\nPLAN_COMPLETO=${JSON.stringify(identities(plan))}\nELEMENTO_ACTUAL=${JSON.stringify(identity)}\nELEMENTOS_PREVIOS=${JSON.stringify(identities(values))}`,
          `${correction}\nGenera solo el elemento actual completo. Conserva códigos y referencias. ${isFunctional ? "Documenta la HU-F correspondiente a esta HU-P y utiliza su functionalRequirementCodes como código funcional cuando exista. Mantén enlace 1:1, COMO/QUIERO/PARA y criterios verificables sin inventar evidencia." : ""}`,
          depth + 1,
        ),
      );
    }
    this.assertValid(stage.schema, values, stage.path);
    return values;
  }

  private assemble(): Value {
    const result: Value = {
      schemaVersion: "4.1.0",
      sections: [],
      structuredAnalysis: {},
    };
    for (const [path, value] of this.values) {
      if (path.startsWith("sections.")) continue;
      if (path.startsWith("structuredAnalysis."))
        record(result.structuredAnalysis)[path.split(".")[1]] = value;
      else result[path] = value;
    }
    result.sections = this.canonicalSections.map((key) =>
      this.values.get(`sections.${key}`),
    );
    return result;
  }

  async run(): Promise<AiAnalysisDraft> {
    if (this.logicalBlocks.length > 0) {
      const orderedBlocks = [...this.logicalBlocks].sort(
        (left, right) => left.blockNumber - right.blockNumber,
      );
      const executablePaths = new Set(
        orderedBlocks.flatMap((block) => this.blockStagePaths(block)),
      );

      // Un stage técnico determinístico (por ejemplo scrumPlan=null cuando
      // Scrum no aplica) puede existir en el contrato sin tener punto visible.
      // Se resuelve sin IA y sin alterar el progreso 1..N.
      this.seedDeterministicUnmappedStages(executablePaths);

      for (const block of orderedBlocks) {
        await this.runLogicalBlock(block);
      }
    } else {
      // Compatibilidad para usos internos que no suministran mapa de plantilla.
      for (const stage of this.stages) {
        if (this.values.has(stage.path)) continue;
        this.values.set(stage.path, await this.generateTrackedStage(stage));
      }
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const draft = parseAiAnalysisDraft(this.assemble());
        const errors = this.validateDraft?.(draft) ?? [];
        if (errors.length) throw new Error(errors.join("; "));
        return draft;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const sectionIndex = message.match(/sections\[(\d+)\]/u);
        const target = sectionIndex
          ? this.stages.find(
              (stage) =>
                stage.path ===
                `sections.${this.canonicalSections[Number(sectionIndex[1])]}`,
            )
          : localDraftRepairTarget(message, this.stages);
        if (attempt === 3 || !target) {
          throw new AiProviderError(
            "OLLAMA_DRAFT_INVALID",
            `El borrador local no superó la validación: ${message}`,
            false,
          );
        }
        // PASO_8_REPARACION_LOCALIZADA_V2
        // Repara únicamente el stage identificado por la validación. Después
        // se valida otra vez el documento completo. Un segundo stage solo se
        // toca si la siguiente validación lo identifica explícitamente.
        this.values.set(
          target.path,
          await this.generateTrackedStage(target, message, true, attempt + 1),
        );
      }
    }
    throw new Error("La validación del borrador local no terminó.");
  }
}
