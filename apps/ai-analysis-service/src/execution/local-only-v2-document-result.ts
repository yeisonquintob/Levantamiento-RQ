import type { DocumentJsonValue, DocumentTemplateDetail, RequirementDocumentDetail } from "@levantamiento-rq/shared-contracts";
import { buildLocalOnlyV2TemplateGenerationPlan, type LocalOnlyV2TemplateGenerationPlan } from "./local-only-v2-template-planner";
import type { LocalOnlyV2KnowledgeIndex } from "./local-only-v2-knowledge-index";

export interface LocalOnlyV2DocumentResult {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: "1.0.0";
  readonly templatePlanFingerprint: string;
  readonly knowledge: LocalOnlyV2KnowledgeIndex;
  readonly sections: readonly {
    readonly blockId: string; readonly blockNumber: number; readonly blockTotal: number;
    readonly sectionOrder: number; readonly key: string; readonly title: string;
    readonly content: DocumentJsonValue; readonly sourceIds: readonly string[];
  }[];
  readonly coverage: {
    readonly requestedPointCount: number; readonly completedPointCount: number;
    readonly assembledPointCount: number; readonly missingPointCount: number; readonly coverageRatio: number;
  };
}

export function isLocalOnlyV2DocumentResult(value: unknown): value is LocalOnlyV2DocumentResult {
  return value !== null && typeof value === "object" && "pipelineId" in value && value.pipelineId === "LOCAL_ONLY_V2";
}

export function localOnlyV2TemplateFromDocument(document: RequirementDocumentDetail): DocumentTemplateDetail {
  const applied = document.appliedTemplate;
  if (!applied || applied.id !== document.template.id || applied.version !== document.template.version) {
    throw new Error("LOCAL_ONLY_V2 requiere la definición exacta de plantilla aplicada.");
  }
  const template: DocumentTemplateDetail = {
    id: applied.sourceTemplateId, code: applied.code, name: applied.name, version: applied.version,
    templateType: applied.templateType, includesScrum: applied.includesScrum ?? false,
    status: "PUBLISHED", description: null, sourceTemplateId: null,
    createdAt: applied.appliedAt, updatedAt: applied.appliedAt, publishedAt: applied.appliedAt,
    retiredAt: null, logo: null, canManage: false,
    definition: applied.definition as unknown as DocumentTemplateDetail["definition"],
  };
  const sections = [...document.currentVersionDetail.sections].sort((a, b) => a.order - b.order);
  if (!template.definition || !Array.isArray(template.definition.sections) || sections.length !== template.definition.sections.length ||
      sections.some((section, index) => {
        const expected = template.definition.sections.find((item) => item.order === index + 1);
        return !expected || section.key !== expected.key || section.order !== expected.order || section.title !== expected.title.trim();
      })) {
    throw new Error("LOCAL_ONLY_V2: documento y versión exacta de plantilla no coinciden.");
  }
  return template;
}

export function parseLocalOnlyV2DocumentResult(value: unknown, plan: LocalOnlyV2TemplateGenerationPlan): LocalOnlyV2DocumentResult {
  if (!isLocalOnlyV2DocumentResult(value) || value.schemaVersion !== "1.0.0" || value.templatePlanFingerprint !== plan.planFingerprint ||
      !value.knowledge || value.knowledge.pipelineId !== "LOCAL_ONLY_V2" || value.knowledge.fingerprint !== plan.knowledge.fingerprint ||
      value.knowledge.projectId !== plan.knowledge.projectId || !Array.isArray(value.sections) || value.sections.length !== plan.blocks.length) {
    throw new Error("LOCAL_ONLY_V2: contrato documental incompatible con el plan.");
  }
  const knownSources = new Set(value.knowledge.sources.map((source) => source.sourceId));
  const keys = new Set<string>();
  value.sections.forEach((section, index) => {
    const block = plan.blocks[index];
    if (!section || !block || section.blockId !== block.blockId || section.blockNumber !== block.blockNumber ||
        section.blockTotal !== block.blockTotal || section.sectionOrder !== block.sectionOrder ||
        section.key !== block.sectionKey || section.title !== block.title || keys.has(section.key) ||
        typeof section.content !== "string" || !section.content.trim() ||
        !Array.isArray(section.sourceIds) || new Set(section.sourceIds).size !== section.sourceIds.length ||
        section.sourceIds.some((id: unknown) => typeof id !== "string" || !knownSources.has(id))) {
      throw new Error(`LOCAL_ONLY_V2: punto inválido en posición ${index + 1}.`);
    }
    keys.add(section.key);
  });
  const coverage = value.coverage;
  if (!coverage || coverage.requestedPointCount !== plan.blocks.length || coverage.completedPointCount !== plan.blocks.length ||
      coverage.assembledPointCount !== plan.blocks.length || coverage.missingPointCount !== 0 || coverage.coverageRatio !== 1) {
    throw new Error("LOCAL_ONLY_V2: resultado sin cobertura completa.");
  }
  return value;
}

export function parseLocalOnlyV2PersistedDocumentResult(value: unknown, document: RequirementDocumentDetail): LocalOnlyV2DocumentResult {
  if (!isLocalOnlyV2DocumentResult(value) || !value.knowledge || value.knowledge.projectId !== document.projectId) {
    throw new Error("LOCAL_ONLY_V2: resultado persistido ajeno al proyecto.");
  }
  const plan = buildLocalOnlyV2TemplateGenerationPlan(localOnlyV2TemplateFromDocument(document), value.knowledge);
  return parseLocalOnlyV2DocumentResult(value, plan);
}
