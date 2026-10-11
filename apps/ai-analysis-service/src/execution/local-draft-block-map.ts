import type { LocalDraftStage } from "./local-draft-stages";

export type LocalDraftBlockPresentationSource =
  "AI_STAGE" | "TEMPLATE_METADATA" | "DERIVED" | "UNMAPPED";

export interface LocalDraftTemplateSection {
  key: string;
  order: number;
  title: string;
  required?: boolean;
  guidance?: string;
}

/**
 * Bloque lógico visible para el usuario.
 *
 * IMPORTANTE:
 * - El número y total salen de la versión exacta de la plantilla/documento.
 * - No se asume que siempre existan 15 bloques.
 * - stageRoots agrupa llamadas, arrays, reintentos y subdivisiones internas
 *   dentro del mismo bloque visible.
 * - En LOCAL_ONLY, el orden de estos bloques define el orden principal
 *   de ejecución. Sus stageRoots continúan siendo subdivisiones internas.
 */
export interface LocalDraftLogicalBlock {
  blockNumber: number;
  blockTotal: number;
  blockKey: string;
  blockLabel: string;
  required: boolean;
  guidance: string;
  stageRoots: readonly string[];
  presentationSource: LocalDraftBlockPresentationSource;
}

// PASO_2_BACKEND_BLOQUE_ACTUAL_V1
export type LocalDraftBlockStatus =
  "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";

// PASO_10_DIAGNOSTICO_PROGRESO_STAGE_LOCAL_V1
export type LocalDraftBlockOperation = "GENERATING" | "REPAIRING";

export interface LocalDraftBlockProgress {
  updatedAt?: string;
  completedUnits?: number;
  totalUnits?: number;
  blockNumber: number;
  blockTotal: number;
  blockKey: string;
  blockLabel: string;
  status: LocalDraftBlockStatus;
  // Diagnóstico efímero: nunca contiene prompt, respuesta ni evidencia.
  currentStagePath?: string | null;
  operation?: LocalDraftBlockOperation | null;
  repairAttempt?: number | null;
}

export interface LocalDraftBlockCheckpointEvent extends LocalDraftBlockProgress {
  stageValues?: Readonly<Record<string, unknown>>;
}

export type LocalDraftBlockProgressReporter = (
  progress: LocalDraftBlockCheckpointEvent,
) => void | Promise<void>;

/**
 * Estado efímero en memoria.
 *
 * Paso 2 no persiste progreso. El objetivo es que el backend ya pueda conocer
 * los estados; la persistencia queda reservada para el Paso 5.
 */
export class LocalDraftBlockProgressStore {
  private readonly requests = new Map<string, LocalDraftBlockProgress[]>();

  initialize(
    analysisRequestId: string,
    blocks: readonly LocalDraftLogicalBlock[],
  ): void {
    this.requests.set(
      analysisRequestId,
      blocks.map((block) => ({
        blockNumber: block.blockNumber,
        blockTotal: block.blockTotal,
        blockKey: block.blockKey,
        blockLabel: block.blockLabel,
        status: "PENDING",
      })),
    );
  }

  update(analysisRequestId: string, progress: LocalDraftBlockProgress): void {
    const current = this.requests.get(analysisRequestId);
    if (!current) return;

    if (progress.status === "PROCESSING") {
      for (const item of current) {
        if (
          item.status === "PROCESSING" &&
          item.blockNumber !== progress.blockNumber
        ) {
          item.status = "PENDING";
          item.currentStagePath = null;
          item.operation = null;
          item.repairAttempt = null;
        }
      }
    }

    const target = current.find(
      (item) =>
        item.blockNumber === progress.blockNumber &&
        item.blockKey === progress.blockKey,
    );
    if (!target) return;

    target.blockTotal = progress.blockTotal;
    target.blockLabel = progress.blockLabel;
    target.status = progress.status;

    if (progress.status === "PROCESSING") {
      target.currentStagePath = progress.currentStagePath ?? null;
      target.operation = progress.operation ?? null;
      target.repairAttempt = progress.repairAttempt ?? null;
    } else if (
      progress.status === "FAILED" ||
      progress.status === "CANCELLED"
    ) {
      // Conserva el último stage conocido para diagnóstico del fallo/cancelación.
      target.currentStagePath =
        progress.currentStagePath ?? target.currentStagePath ?? null;
      target.operation = progress.operation ?? target.operation ?? null;
      target.repairAttempt =
        progress.repairAttempt ?? target.repairAttempt ?? null;
    } else {
      target.currentStagePath = null;
      target.operation = null;
      target.repairAttempt = null;
    }
  }

  get(analysisRequestId: string): readonly LocalDraftBlockProgress[] {
    return (this.requests.get(analysisRequestId) ?? []).map((item) => ({
      ...item,
    }));
  }
}

const EXTRA_STAGE_ROOTS_BY_SECTION_KEY: Readonly<
  Record<string, readonly string[]>
> = {
  processFlow: [
    "structuredAnalysis.processFlows",
    "structuredAnalysis.entityRelationship",
  ],
  milestones: ["structuredAnalysis.functionalUserStories", "requirements"],
  backlogStructure: ["structuredAnalysis.backlogStructure"],
  tests: ["structuredAnalysis.tests"],
  assumptionsDependenciesPending: [
    "pendingQuestions",
    "contradictions",
    "warnings",
  ],
  scrumPlan: ["structuredAnalysis.scrumPlan"],
};

// PASO_2_TEMPLATE_POINT_EXECUTION_V2
//
// Prerrequisitos internos de un punto visible. No crean otro punto ni alteran N.
// "Requerimientos" necesita primero el backlog de planificación para poder
// documentar una HU-F por cada HU-P sin inventar relaciones.
const PREREQUISITE_STAGE_PATHS_BY_BLOCK_KEY: Readonly<
  Record<string, readonly string[]>
> = {
  milestones: ["structuredAnalysis.backlogStructure"],
};

export function localDraftBlockPrerequisiteStagePaths(
  blockKey: string,
): readonly string[] {
  return PREREQUISITE_STAGE_PATHS_BY_BLOCK_KEY[blockKey] ?? [];
}

const PRESENTATION_SOURCE_BY_SECTION_KEY: Readonly<
  Record<string, LocalDraftBlockPresentationSource>
> = {
  writingRules: "TEMPLATE_METADATA",
  visualFormat: "DERIVED",
  automationInstruction: "DERIVED",
};

export function localDraftStagePathBelongsToRoot(
  stagePath: string,
  stageRoot: string,
): boolean {
  return (
    stagePath === stageRoot ||
    stagePath.startsWith(`${stageRoot}.`) ||
    stagePath.startsWith(`${stageRoot}[`)
  );
}

function rootExistsInCurrentStages(
  stageRoot: string,
  stages: readonly LocalDraftStage[],
): boolean {
  return stages.some(
    (stage) =>
      localDraftStagePathBelongsToRoot(stage.path, stageRoot) ||
      localDraftStagePathBelongsToRoot(stageRoot, stage.path),
  );
}

function stageRootsForTemplateSection(
  sectionKey: string,
  stages: readonly LocalDraftStage[],
): readonly string[] {
  const candidates = [
    ...(EXTRA_STAGE_ROOTS_BY_SECTION_KEY[sectionKey] ?? []),
    `sections.${sectionKey}`,
  ];

  return candidates.filter(
    (root, index) =>
      candidates.indexOf(root) === index &&
      rootExistsInCurrentStages(root, stages),
  );
}

export function buildLocalDraftLogicalBlocks(
  templateSections: readonly LocalDraftTemplateSection[],
  stages: readonly LocalDraftStage[],
): readonly LocalDraftLogicalBlock[] {
  const orderedSections = templateSections
    .map((section, originalIndex) => ({ section, originalIndex }))
    .sort(
      (left, right) =>
        left.section.order - right.section.order ||
        left.originalIndex - right.originalIndex,
    )
    .map(({ section }) => section);

  const seenKeys = new Set<string>();
  for (const section of orderedSections) {
    const key = section.key.trim();
    if (!key) {
      throw new Error("La plantilla contiene una sección sin key.");
    }
    if (seenKeys.has(key)) {
      throw new Error(`La plantilla contiene la sección repetida: ${key}.`);
    }
    seenKeys.add(key);
  }

  const total = orderedSections.length;

  return orderedSections.map((section, index) => {
    const key = section.key.trim();
    const stageRoots = stageRootsForTemplateSection(key, stages);
    const configuredSource = PRESENTATION_SOURCE_BY_SECTION_KEY[key];

    return {
      blockNumber: index + 1,
      blockTotal: total,
      blockKey: key,
      blockLabel: section.title.trim(),
      required: section.required ?? true,
      guidance: section.guidance?.trim() ?? "",
      stageRoots,
      presentationSource:
        configuredSource ?? (stageRoots.length > 0 ? "AI_STAGE" : "UNMAPPED"),
    };
  });
}

export function resolveLocalDraftLogicalBlock(
  stagePath: string,
  blocks: readonly LocalDraftLogicalBlock[],
): LocalDraftLogicalBlock | undefined {
  return blocks
    .flatMap((block) =>
      block.stageRoots.map((stageRoot) => ({ block, stageRoot })),
    )
    .sort((left, right) => right.stageRoot.length - left.stageRoot.length)
    .find(({ stageRoot }) =>
      localDraftStagePathBelongsToRoot(stagePath, stageRoot),
    )?.block;
}

export function unmappedLocalDraftStagePaths(
  stages: readonly LocalDraftStage[],
  blocks: readonly LocalDraftLogicalBlock[],
): readonly string[] {
  return stages
    .map((stage) => stage.path)
    .filter((path) => !resolveLocalDraftLogicalBlock(path, blocks));
}
