import { randomUUID } from "node:crypto";

import { ConflictException } from "@nestjs/common";

import {
  DOCUMENT_SCRUM_SECTION_DEFINITION,
  type ApplyAiAnalysisDraftRequest,
  type AuthenticatedUser,
  type DocumentEvidenceInput,
  type DocumentRequirementInput,
  type DocumentSectionKey,
} from "@levantamiento-rq/shared-contracts";

import type { DocumentSectionEntity } from "./document.entities";
import {
  approvalsForNewVersion,
  contentFromAi,
  headerForNewVersion,
} from "./documents-approvals";
import { validateDocumentSectionContent } from "./documents-input";
import { initialContent } from "./documents-initial-content";
import { parseJson, serialize } from "./documents-json";
import type { DocumentProjectAccess } from "./projects-access.client";

export function buildRequirementRows(
  requirements: readonly DocumentRequirementInput[],
  documentVersionId: string,
) {
  const clientRequirementIds = new Map<string, string>();
  const requirementRows = requirements.map((requirement) => {
    const id = randomUUID();
    if (requirement.clientId)
      clientRequirementIds.set(requirement.clientId, id);
    return {
      id,
      documentVersionId,
      sectionKey: requirement.sectionKey,
      code: requirement.code,
      title: requirement.title,
      description: requirement.description,
      requirementType: requirement.requirementType,
      status: requirement.status,
      orderIndex: requirement.order,
    };
  });
  return { requirementRows, clientRequirementIds };
}

export function buildCriterionRows(
  requirements: readonly DocumentRequirementInput[],
  requirementRows: readonly { readonly id: string }[],
) {
  return requirements.flatMap((requirement, index) =>
    requirement.acceptanceCriteria.map((criterion) => ({
      id: randomUUID(),
      requirementId: requirementRows[index]?.id as string,
      description: criterion.description,
      orderIndex: criterion.order,
    })),
  );
}

export function buildEvidenceRows(
  evidence: readonly DocumentEvidenceInput[],
  documentVersionId: string,
  clientRequirementIds: ReadonlyMap<string, string>,
) {
  return evidence.map((item) => ({
    id: randomUUID(),
    documentVersionId,
    sourceId: item.sourceId,
    sectionKey: item.sectionKey ?? null,
    requirementId: item.requirementClientId
      ? (clientRequirementIds.get(item.requirementClientId) as string)
      : null,
    excerpt: item.excerpt ?? null,
    note: item.note ?? null,
  }));
}

export function prepareAiSections(
  sectionRows: readonly DocumentSectionEntity[],
  request: ApplyAiAnalysisDraftRequest,
) {
  const sectionsByKey = new Map(
    sectionRows.map((section) => [section.key, section]),
  );
  const allSectionKeys = sectionRows.map((section) => section.key);
  const legacyAiSectionKeys = sectionRows
    .filter(
      (section) =>
        !["writingRules", "visualFormat", "automationInstruction"].includes(
          section.key,
        ),
    )
    .map((section) => section.key);
  const requestedSectionKeys = request.sections.map((section) => section.key);
  const matches = (expected: readonly string[]) =>
    requestedSectionKeys.length === expected.length &&
    requestedSectionKeys.every((key, index) => key === expected[index]);
  if (
    new Set(requestedSectionKeys).size !== requestedSectionKeys.length ||
    (!matches(allSectionKeys) && !matches(legacyAiSectionKeys))
  ) {
    throw new ConflictException(
      "El borrador debe contener las secciones del documento en su orden real.",
    );
  }
  for (const reference of [...request.requirements, ...request.evidence]) {
    if (
      reference.sectionKey != null &&
      !sectionsByKey.has(reference.sectionKey)
    ) {
      throw new ConflictException(
        "La trazabilidad referencia una sección ajena al documento.",
      );
    }
  }
  // Se valida todo el contenido antes de escribir la primera sección.
  return request.sections.map((sectionInput) => {
    const section = sectionsByKey.get(sectionInput.key);
    if (!section) {
      throw new ConflictException(
        "El borrador de IA no coincide con las secciones del documento.",
      );
    }
    const content = contentFromAi(
      sectionInput.key,
      parseJson(section.contentJson),
      sectionInput.content,
    );
    // Mismo esquema que exige el editor manual (updateSection).
    validateDocumentSectionContent(
      sectionInput.key as DocumentSectionKey,
      content,
    );
    return { section, key: sectionInput.key, content };
  });
}

export function cloneSectionsForNewVersion(input: {
  sourceSections: readonly DocumentSectionEntity[];
  versionId: string;
  nextVersion: string;
  actor: AuthenticatedUser;
  project: DocumentProjectAccess["project"];
  now: Date;
  isCustomTemplate: boolean;
  includesScrum: boolean;
}) {
  const {
    sourceSections,
    versionId,
    nextVersion,
    actor,
    project,
    now,
    isCustomTemplate,
    includesScrum,
  } = input;
  const sectionIds = new Map<string, string>();
  const clonedSections = sourceSections.map((section) => {
    const id = randomUUID();
    sectionIds.set(section.key, id);
    const content = parseJson(section.contentJson);
    const updatedContent =
      section.key === "header"
        ? headerForNewVersion(content, nextVersion)
        : section.key === "approvalsAndChangeControl"
          ? approvalsForNewVersion(content, actor)
          : content;
    return {
      id,
      documentVersionId: versionId,
      key: section.key,
      title: section.title,
      orderIndex: section.orderIndex,
      contentJson: serialize(updatedContent),
      templateControlled: section.templateControlled,
    };
  });

  if (
    !isCustomTemplate &&
    !sourceSections.some((section) => section.key === "solutionProposal")
  ) {
    const processFlowOrder =
      sourceSections.find((section) => section.key === "processFlow")
        ?.orderIndex ?? 5;
    for (const section of clonedSections) {
      if (section.orderIndex >= processFlowOrder) section.orderIndex += 1;
    }
    const id = randomUUID();
    sectionIds.set("solutionProposal", id);
    clonedSections.push({
      id,
      documentVersionId: versionId,
      key: "solutionProposal",
      title: "Solución propuesta del profesional de soluciones",
      orderIndex: processFlowOrder,
      contentJson: serialize(
        initialContent("solutionProposal", project, actor, nextVersion, now),
      ),
      templateControlled: false,
    });
    clonedSections.sort((left, right) => left.orderIndex - right.orderIndex);
  }

  if (
    includesScrum &&
    !isCustomTemplate &&
    !sourceSections.some(
      (section) => section.key === DOCUMENT_SCRUM_SECTION_DEFINITION.key,
    )
  ) {
    const id = randomUUID();
    sectionIds.set(DOCUMENT_SCRUM_SECTION_DEFINITION.key, id);
    clonedSections.push({
      id,
      documentVersionId: versionId,
      key: DOCUMENT_SCRUM_SECTION_DEFINITION.key,
      title: DOCUMENT_SCRUM_SECTION_DEFINITION.title,
      orderIndex:
        Math.max(...clonedSections.map((section) => section.orderIndex)) + 1,
      contentJson: serialize(
        initialContent(
          DOCUMENT_SCRUM_SECTION_DEFINITION.key,
          project,
          actor,
          nextVersion,
          now,
        ),
      ),
      templateControlled: false,
    });
  }
  return { clonedSections, sectionCount: sectionIds.size };
}
