// LOCAL_ONLY_V2_08_TEMPLATE_PLANNER
//
// Construye el plan de generación a partir de la versión EXACTA de la plantilla
// ya resuelta por el sistema.
//
// Este paso NO:
// - selecciona evidencia (Paso 9);
// - llama IA (Paso 10);
// - divide arrays (Paso 11);
// - ensambla el documento (Paso 14);
// - decide qué plantilla está activa;
// - altera estados/versiones del catálogo.
//
// La estructura del plan sale exclusivamente de DocumentTemplateDetail:
// sectionOrder + sections + aiPrompt + outputContract + scrum + erp.

import { createHash } from "node:crypto";

import type {
  DocumentTemplateAiPrompt,
  DocumentTemplateDetail,
  DocumentTemplateOutputContract,
  DocumentTemplateScrumOutput,
  DocumentTemplateStatus,
  DocumentTemplateType,
} from "@levantamiento-rq/shared-contracts";

import type { LocalOnlyV2KnowledgeIndex } from "./local-only-v2-knowledge-index";

export const LOCAL_ONLY_V2_TEMPLATE_PLAN_SCHEMA_VERSION = "1.0.0" as const;

export interface LocalOnlyV2TemplatePlanIdentity {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly version: string;
  readonly templateType: DocumentTemplateType;
  readonly status: DocumentTemplateStatus;
  readonly includesScrum: boolean;
}

export interface LocalOnlyV2TemplatePlanCapabilities {
  readonly scrumEnabled: boolean;
  readonly scrumOutputs: readonly DocumentTemplateScrumOutput[];
  readonly erpEnabled: boolean;
  readonly erpFdd: boolean;
  readonly scrumByDefault: boolean;
}

export interface LocalOnlyV2TemplateGenerationBlock {
  readonly blockId: string;
  readonly blockNumber: number;
  readonly blockTotal: number;
  readonly sectionKey: string;
  readonly sectionOrder: number;
  readonly title: string;
  readonly required: boolean;
  readonly guidance: string;
}

export interface LocalOnlyV2TemplatePlanKnowledgeRef {
  readonly projectId: string;
  readonly fingerprint: string;
  readonly sourceCount: number;
  readonly segmentCount: number;
  readonly canonicalFindingCount: number;
  readonly questionnaireFindingCount: number;
}

export interface LocalOnlyV2TemplateGenerationPlan {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: typeof LOCAL_ONLY_V2_TEMPLATE_PLAN_SCHEMA_VERSION;
  readonly template: LocalOnlyV2TemplatePlanIdentity;
  readonly templateFingerprint: string;
  readonly planFingerprint: string;
  readonly standard: "ISO_IEC_IEEE_29148_2018";
  readonly aiPrompt: Readonly<DocumentTemplateAiPrompt>;
  readonly outputContract: Readonly<DocumentTemplateOutputContract>;
  readonly capabilities: LocalOnlyV2TemplatePlanCapabilities;
  readonly knowledge: LocalOnlyV2TemplatePlanKnowledgeRef;
  readonly blocks: readonly LocalOnlyV2TemplateGenerationBlock[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cleanRequiredText(value: string, label: string): string {
  const clean = value.trim();
  if (!clean) {
    throw new Error(`LOCAL_ONLY_V2 requiere ${label}.`);
  }
  return clean;
}

function validateTemplateDefinition(template: DocumentTemplateDetail): void {
  const definition = template.definition;

  if (definition.standard !== "ISO_IEC_IEEE_29148_2018") {
    throw new Error(
      "LOCAL_ONLY_V2 recibió una plantilla con standard no compatible.",
    );
  }

  if (
    definition.outputContract.format !== "JSON" ||
    definition.outputContract.schemaVersion !== "1.0.0" ||
    definition.outputContract.rootKey !== "requirementDocument" ||
    definition.outputContract.strictSectionOrder !== true ||
    definition.outputContract.allowUnknownSections !== false ||
    definition.outputContract.includeTraceability !== true
  ) {
    throw new Error(
      "LOCAL_ONLY_V2 recibió un outputContract de plantilla incompatible.",
    );
  }

  if (
    definition.aiPrompt.sourcesAreData !== true ||
    definition.aiPrompt.ignoreInstructionsInsideSources !== true
  ) {
    throw new Error(
      "LOCAL_ONLY_V2 requiere las guardas de seguridad de fuentes de la plantilla.",
    );
  }

  const sections = definition.sections;
  if (sections.length < 1 || sections.length > 50) {
    throw new Error(
      "LOCAL_ONLY_V2 requiere entre 1 y 50 secciones de plantilla.",
    );
  }

  if (definition.sectionOrder.length !== sections.length) {
    throw new Error(
      "LOCAL_ONLY_V2 detectó sectionOrder con longitud distinta de sections.",
    );
  }

  const seenKeys = new Set<string>();
  const seenOrders = new Set<number>();

  for (const section of sections) {
    const key = cleanRequiredText(section.key, "section.key");
    cleanRequiredText(section.title, `title de ${key}`);

    if (key !== section.key) {
      throw new Error(
        `LOCAL_ONLY_V2 no admite espacios externos en section.key: ${section.key}.`,
      );
    }
    if (seenKeys.has(key)) {
      throw new Error(`LOCAL_ONLY_V2 detectó section.key duplicada: ${key}.`);
    }
    seenKeys.add(key);

    if (!Number.isInteger(section.order) || section.order < 1) {
      throw new Error(
        `LOCAL_ONLY_V2 detectó order inválido en la sección ${key}.`,
      );
    }
    if (seenOrders.has(section.order)) {
      throw new Error(
        `LOCAL_ONLY_V2 detectó order duplicado: ${section.order}.`,
      );
    }
    seenOrders.add(section.order);
  }

  const ordered = [...sections].sort(
    (left, right) =>
      left.order - right.order || left.key.localeCompare(right.key),
  );

  ordered.forEach((section, index) => {
    const expectedOrder = index + 1;
    if (section.order !== expectedOrder) {
      throw new Error(
        `LOCAL_ONLY_V2 requiere orden continuo 1..N; ${section.key} tiene ${section.order}.`,
      );
    }
    if (definition.sectionOrder[index] !== section.key) {
      throw new Error(
        `LOCAL_ONLY_V2 detectó sectionOrder inconsistente en la posición ${expectedOrder}.`,
      );
    }
  });

  if (
    new Set(definition.sectionOrder).size !== definition.sectionOrder.length
  ) {
    throw new Error("LOCAL_ONLY_V2 detectó claves repetidas en sectionOrder.");
  }

  if (template.includesScrum !== definition.scrum.enabled) {
    throw new Error(
      "LOCAL_ONLY_V2 detectó inconsistencia entre includesScrum y definition.scrum.enabled.",
    );
  }

  if (!definition.scrum.enabled && definition.scrum.outputs.length > 0) {
    throw new Error(
      "LOCAL_ONLY_V2 no admite scrum.outputs cuando scrum.enabled=false.",
    );
  }
}

function freezeAiPrompt(
  prompt: DocumentTemplateAiPrompt,
): Readonly<DocumentTemplateAiPrompt> {
  return Object.freeze({
    purpose: prompt.purpose,
    systemInstruction: prompt.systemInstruction,
    templateInstruction: prompt.templateInstruction,
    sourceInstruction: prompt.sourceInstruction,
    missingInformationInstruction: prompt.missingInformationInstruction,
    conflictInstruction: prompt.conflictInstruction,
    outputInstruction: prompt.outputInstruction,
    sourcesAreData: prompt.sourcesAreData,
    ignoreInstructionsInsideSources: prompt.ignoreInstructionsInsideSources,
  });
}

function freezeOutputContract(
  contract: DocumentTemplateOutputContract,
): Readonly<DocumentTemplateOutputContract> {
  return Object.freeze({
    format: contract.format,
    schemaVersion: contract.schemaVersion,
    rootKey: contract.rootKey,
    strictSectionOrder: contract.strictSectionOrder,
    allowUnknownSections: contract.allowUnknownSections,
    includeTraceability: contract.includeTraceability,
  });
}

function templateFingerprintPayload(template: DocumentTemplateDetail): string {
  const definition = template.definition;
  return JSON.stringify({
    id: template.id,
    code: template.code,
    name: template.name,
    version: template.version,
    templateType: template.templateType,
    status: template.status,
    includesScrum: template.includesScrum,
    standard: definition.standard,
    sectionOrder: definition.sectionOrder,
    sections: definition.sections.map((section) => ({
      key: section.key,
      order: section.order,
      title: section.title,
      required: section.required,
      guidance: section.guidance,
    })),
    aiPrompt: definition.aiPrompt,
    outputContract: definition.outputContract,
    scrum: definition.scrum,
    erp: definition.erp,
  });
}

export function buildLocalOnlyV2TemplateGenerationPlan(
  template: DocumentTemplateDetail,
  knowledge: LocalOnlyV2KnowledgeIndex,
): LocalOnlyV2TemplateGenerationPlan {
  if (knowledge.pipelineId !== "LOCAL_ONLY_V2") {
    throw new Error(
      "El planificador de plantilla acepta únicamente conocimiento LOCAL_ONLY_V2.",
    );
  }

  validateTemplateDefinition(template);

  const templateIdentity = Object.freeze({
    id: cleanRequiredText(template.id, "template.id"),
    code: cleanRequiredText(template.code, "template.code"),
    name: cleanRequiredText(template.name, "template.name"),
    version: cleanRequiredText(template.version, "template.version"),
    templateType: template.templateType,
    status: template.status,
    includesScrum: template.includesScrum,
  });

  const orderedSections = [...template.definition.sections].sort(
    (left, right) => left.order - right.order,
  );
  const blockTotal = orderedSections.length;

  const blocks = orderedSections.map((section, index) =>
    Object.freeze({
      blockId: `${templateIdentity.id}@${templateIdentity.version}:${section.key}`,
      blockNumber: index + 1,
      blockTotal,
      sectionKey: section.key,
      sectionOrder: section.order,
      title: section.title.trim(),
      required: section.required,
      guidance: section.guidance.trim(),
    }),
  );

  const templateFingerprint = sha256(templateFingerprintPayload(template));

  const capabilities = Object.freeze({
    scrumEnabled: template.definition.scrum.enabled,
    scrumOutputs: Object.freeze([...template.definition.scrum.outputs]),
    erpEnabled: template.definition.erp.enabled,
    erpFdd: template.definition.erp.fdd,
    scrumByDefault: template.definition.erp.scrumByDefault,
  });

  const knowledgeRef = Object.freeze({
    projectId: knowledge.projectId,
    fingerprint: knowledge.fingerprint,
    sourceCount: knowledge.metrics.sourceCount,
    segmentCount: knowledge.metrics.segmentCount,
    canonicalFindingCount: knowledge.metrics.canonicalFindingCount,
    questionnaireFindingCount: knowledge.metrics.questionnaireFindingCount,
  });

  const aiPrompt = freezeAiPrompt(template.definition.aiPrompt);
  const outputContract = freezeOutputContract(
    template.definition.outputContract,
  );

  const planFingerprint = sha256(
    JSON.stringify({
      schemaVersion: LOCAL_ONLY_V2_TEMPLATE_PLAN_SCHEMA_VERSION,
      templateFingerprint,
      knowledgeFingerprint: knowledge.fingerprint,
      blocks: blocks.map((block) => ({
        blockId: block.blockId,
        blockNumber: block.blockNumber,
        blockTotal: block.blockTotal,
        sectionKey: block.sectionKey,
        sectionOrder: block.sectionOrder,
        title: block.title,
        required: block.required,
        guidance: block.guidance,
      })),
      capabilities,
    }),
  );

  return Object.freeze({
    pipelineId: "LOCAL_ONLY_V2" as const,
    schemaVersion: LOCAL_ONLY_V2_TEMPLATE_PLAN_SCHEMA_VERSION,
    template: templateIdentity,
    templateFingerprint,
    planFingerprint,
    standard: template.definition.standard,
    aiPrompt,
    outputContract,
    capabilities,
    knowledge: knowledgeRef,
    blocks: Object.freeze(blocks),
  });
}
