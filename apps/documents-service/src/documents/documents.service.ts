import { randomUUID } from "node:crypto";

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";

import {
  DOCUMENT_SECTION_DEFINITIONS,
  type AppliedDocumentTemplate,
  type ApplyAiAnalysisDraftRequest,
  type ArchiveRequirementDocumentRequest,
  type AuthenticatedUser,
  type CreateDocumentVersionRequest,
  type CreateRequirementDocumentRequest,
  type DocumentHistoryEntry,
  type DocumentJsonValue,
  type DocumentSectionKey,
  type DocumentStatus,
  type DocumentTransitionRequest,
  type DocumentVersionDetail,
  type DocumentVersionSummary,
  type ReplaceDocumentFieldsRequest,
  type RequirementDocumentDetail,
  type RequirementDocumentListResponse,
  type RequirementDocumentSummary,
  type UpdateDocumentSectionRequest,
  type UpdateRequirementDocumentRequest,
} from "@levantamiento-rq/shared-contracts";

import { DocumentTemplateEntity } from "../templates/document-template.entity";
import {
  AcceptanceCriterionEntity,
  AppliedAiAnalysisResultEntity,
  AppliedDocumentTemplateEntity,
  DocumentEvidenceEntity,
  DocumentFieldEntity,
  DocumentHistoryEntity,
  DocumentRequirementEntity,
  DocumentSectionEntity,
  DocumentVersionEntity,
  RequirementDocumentEntity,
} from "./document.entities";
import {
  type DocumentProjectAccess,
  DocumentsProjectsAccessClient,
} from "./projects-access.client";
import { DocumentsSourcesAccessClient } from "./sources-access.client";

export interface DocumentsActorContext {
  actor: AuthenticatedUser;
  accessToken: string;
  correlationId: string;
}

const PENDING = "[PENDIENTE POR DEFINIR]";

function toIso(value: Date): string {
  return value.toISOString();
}

function parseJson(value: string): DocumentJsonValue {
  return JSON.parse(value) as DocumentJsonValue;
}

function serialize(value: DocumentJsonValue): string {
  return JSON.stringify(value);
}

function templateWithoutDefinition(
  template: AppliedDocumentTemplateEntity,
): Omit<AppliedDocumentTemplate, "definition"> {
  return {
    id: template.id,
    sourceTemplateId: template.sourceTemplateId,
    code: template.code,
    name: template.name,
    version: template.version,
    templateType: template.templateType,
    appliedAt: toIso(template.appliedAt),
  };
}

function versionSummary(
  version: DocumentVersionEntity,
): DocumentVersionSummary {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    version: version.version,
    status: version.status,
    revision: version.revision,
    changeSummary: version.changeSummary,
    createdByUserId: version.createdByUserId,
    createdAt: toIso(version.createdAt),
    updatedAt: toIso(version.updatedAt),
    approvedByUserId: version.approvedByUserId,
    approvedAt: version.approvedAt ? toIso(version.approvedAt) : null,
  };
}

function assertCanonicalTemplate(definition: DocumentJsonValue): void {
  if (
    !definition ||
    typeof definition !== "object" ||
    Array.isArray(definition)
  ) {
    throw new ConflictException(
      "La plantilla aplicada no contiene una definición válida.",
    );
  }

  const record = definition as Readonly<Record<string, DocumentJsonValue>>;
  const order = record.sectionOrder;
  const sections = record.sections;

  if (
    !Array.isArray(order) ||
    !Array.isArray(sections) ||
    order.length !== DOCUMENT_SECTION_DEFINITIONS.length ||
    sections.length !== DOCUMENT_SECTION_DEFINITIONS.length
  ) {
    throw new ConflictException(
      "La plantilla debe contener exactamente las 13 secciones canónicas.",
    );
  }

  DOCUMENT_SECTION_DEFINITIONS.forEach((expected, index) => {
    const rawSection = sections[index];

    if (
      order[index] !== expected.key ||
      !rawSection ||
      typeof rawSection !== "object" ||
      Array.isArray(rawSection)
    ) {
      throw new ConflictException(
        "La plantilla no conserva el orden de las 13 secciones canónicas.",
      );
    }

    const section = rawSection as Readonly<Record<string, DocumentJsonValue>>;

    if (
      section.key !== expected.key ||
      section.title !== expected.title ||
      section.order !== index + 1
    ) {
      throw new ConflictException(
        "La plantilla modifica una sección canónica y no puede aplicarse al documento.",
      );
    }
  });
}

function initialContent(
  key: DocumentSectionKey,
  project: DocumentProjectAccess["project"],
  actor: AuthenticatedUser,
  version: string,
  now: Date,
): DocumentJsonValue {
  switch (key) {
    case "header":
      return {
        title: project.title,
        projectCode: project.code,
        documentVersion: version,
        createdDate: now.toISOString().slice(0, 10),
        requestingArea: project.requestingArea,
        preparedBy: { name: actor.displayName, position: PENDING },
        reviewedBy: { name: PENDING, position: PENDING },
        approvedBy: { name: PENDING, position: PENDING },
        status: "BORRADOR",
      };
    case "objectives":
      return { general: PENDING, specific: [PENDING] };
    case "problemDescription":
      return { currentState: PENDING, operationalImpact: [PENDING] };
    case "scope":
      return {
        included: [PENDING],
        excluded: [PENDING],
        involvedSystems: [PENDING],
      };
    case "processFlow":
      return {
        notation: "PENDING",
        content: PENDING,
        actors: [PENDING],
        inputs: [PENDING],
        outputs: [PENDING],
        systems: [PENDING],
      };
    case "milestones":
      return [
        {
          number: 1,
          name: PENDING,
          description: PENDING,
          keyActivities: [PENDING],
          userStory: {
            code: "HU-1",
            asA: PENDING,
            iWant: PENDING,
            soThat: PENDING,
          },
          acceptanceCriteria: [PENDING],
          businessRules: [PENDING],
          requiredFields: [
            {
              name: PENDING,
              type: PENDING,
              required: false,
              validationOrObservation: PENDING,
            },
          ],
        },
      ];
    case "nonFunctionalRequirements":
      return {
        security: [PENDING],
        traceability: [PENDING],
        performance: [PENDING],
        compatibility: [PENDING],
        availability: [PENDING],
        usability: [PENDING],
      };
    case "tests":
      return { objective: PENDING, minimumScenarios: [PENDING] };
    case "assumptionsDependenciesPending":
      return {
        assumptions: [PENDING],
        dependencies: [PENDING],
        pendingItems: [PENDING],
      };
    case "approvalsAndChangeControl":
      return { changeControl: [], approvals: [] };
    case "writingRules":
    case "visualFormat":
    case "automationInstruction":
      return { templateControlled: true };
  }
}

function requireEdit(access: DocumentProjectAccess): void {
  if (!access.canEdit) {
    throw new ForbiddenException(
      "No tienes autorización para editar documentos de este proyecto.",
    );
  }
}

function requireReview(access: DocumentProjectAccess): void {
  if (!access.canReview) {
    throw new ForbiddenException(
      "No tienes autorización para revisar o aprobar este documento.",
    );
  }
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(RequirementDocumentEntity)
    private readonly documents: Repository<RequirementDocumentEntity>,
    @InjectRepository(DocumentVersionEntity)
    private readonly versions: Repository<DocumentVersionEntity>,
    @InjectRepository(DocumentSectionEntity)
    private readonly sections: Repository<DocumentSectionEntity>,
    @InjectRepository(DocumentFieldEntity)
    private readonly fields: Repository<DocumentFieldEntity>,
    @InjectRepository(DocumentRequirementEntity)
    private readonly requirements: Repository<DocumentRequirementEntity>,
    @InjectRepository(AcceptanceCriterionEntity)
    private readonly criteria: Repository<AcceptanceCriterionEntity>,
    @InjectRepository(DocumentEvidenceEntity)
    private readonly evidence: Repository<DocumentEvidenceEntity>,
    @InjectRepository(DocumentHistoryEntity)
    private readonly historyRepository: Repository<DocumentHistoryEntity>,
    @InjectRepository(AppliedDocumentTemplateEntity)
    private readonly appliedTemplates: Repository<AppliedDocumentTemplateEntity>,
    @InjectRepository(AppliedAiAnalysisResultEntity)
    private readonly appliedAiResults: Repository<AppliedAiAnalysisResultEntity>,
    @InjectRepository(DocumentTemplateEntity)
    private readonly templates: Repository<DocumentTemplateEntity>,
    private readonly projects: DocumentsProjectsAccessClient,
    private readonly sources: DocumentsSourcesAccessClient,
  ) {}

  async create(
    context: DocumentsActorContext,
    projectId: string,
    request: CreateRequirementDocumentRequest,
  ): Promise<RequirementDocumentDetail> {
    const access = await this.projectAccess(context, projectId);
    requireEdit(access);

    if (request.idempotencyKey) {
      const existing = await this.documents.findOneBy({
        projectId,
        creationIdempotencyKey: request.idempotencyKey,
      });
      if (existing) return this.loadDetail(existing.id);
    }

    if (!access.project.template) {
      throw new ConflictException(
        "El proyecto no tiene una versión de plantilla aplicada.",
      );
    }

    const sourceTemplate = await this.templates.findOneBy({
      id: access.project.template.id,
    });

    if (!sourceTemplate || sourceTemplate.status !== "PUBLISHED") {
      throw new ConflictException(
        "La plantilla aplicada al proyecto no está publicada en Documents Service.",
      );
    }

    const definition = parseJson(sourceTemplate.definitionJson);
    assertCanonicalTemplate(definition);
    const now = new Date();
    const documentId = randomUUID();
    const appliedTemplateId = randomUUID();
    const versionId = randomUUID();
    const creationIdempotencyKey = request.idempotencyKey ?? documentId;

    await this.dataSource.transaction(async (manager) => {
      await manager.save(
        manager.create(AppliedDocumentTemplateEntity, {
          id: appliedTemplateId,
          sourceTemplateId: sourceTemplate.id,
          code: sourceTemplate.code,
          name: sourceTemplate.name,
          version: sourceTemplate.version,
          templateType: sourceTemplate.templateType,
          definitionJson: sourceTemplate.definitionJson,
          appliedAt: now,
        }),
      );
      await manager.save(
        manager.create(RequirementDocumentEntity, {
          id: documentId,
          projectId,
          appliedTemplateId,
          title: request.title ?? access.project.title,
          status: "DRAFT",
          revision: 1,
          currentVersionNumber: 1,
          creationIdempotencyKey,
          createdByUserId: context.actor.id,
          updatedByUserId: context.actor.id,
          createdAt: now,
          updatedAt: now,
          archivedByUserId: null,
          archivedAt: null,
        }),
      );
      await manager.save(
        manager.create(DocumentVersionEntity, {
          id: versionId,
          documentId,
          versionNumber: 1,
          version: "1.0.0",
          status: "DRAFT",
          revision: 1,
          changeSummary: request.changeSummary ?? "Versión inicial",
          idempotencyKey: creationIdempotencyKey,
          createdByUserId: context.actor.id,
          updatedByUserId: context.actor.id,
          createdAt: now,
          updatedAt: now,
          approvedByUserId: null,
          approvedAt: null,
          rejectedByUserId: null,
          rejectedAt: null,
        }),
      );
      await manager.save(
        DocumentSectionEntity,
        DOCUMENT_SECTION_DEFINITIONS.map((section, index) => ({
          id: randomUUID(),
          documentVersionId: versionId,
          key: section.key,
          title: section.title,
          orderIndex: index + 1,
          contentJson: serialize(
            initialContent(
              section.key,
              access.project,
              context.actor,
              "1.0.0",
              now,
            ),
          ),
          templateControlled: index >= 10,
        })),
      );
      await this.addHistory(manager, {
        documentId,
        versionId,
        eventType: "DOCUMENT_CREATED",
        actorUserId: context.actor.id,
        details: {
          projectId,
          templateId: sourceTemplate.id,
          templateVersion: sourceTemplate.version,
          sections: 13,
        },
        now,
      });
    });

    return this.loadDetail(documentId);
  }

  async list(
    context: DocumentsActorContext,
    projectId: string,
  ): Promise<RequirementDocumentListResponse> {
    await this.projectAccess(context, projectId);
    const documents = await this.documents.find({
      where: { projectId },
      order: { updatedAt: "DESC" },
    });
    const items = await Promise.all(
      documents.map((document) => this.loadSummary(document)),
    );

    return { items, totalItems: items.length };
  }

  async getById(
    context: DocumentsActorContext,
    documentId: string,
  ): Promise<RequirementDocumentDetail> {
    const document = await this.requireDocument(documentId);
    await this.projectAccess(context, document.projectId);
    return this.loadDetail(documentId);
  }

  async getVersion(
    context: DocumentsActorContext,
    documentId: string,
    versionNumber: number,
  ): Promise<DocumentVersionDetail> {
    const document = await this.requireDocument(documentId);
    await this.projectAccess(context, document.projectId);
    const version = await this.requireVersion(documentId, versionNumber);
    return this.loadVersionDetail(version);
  }

  async updateMetadata(
    context: DocumentsActorContext,
    documentId: string,
    request: UpdateRequirementDocumentRequest,
  ): Promise<RequirementDocumentDetail> {
    const document = await this.requireDocument(documentId);
    const access = await this.projectAccess(context, document.projectId);
    requireEdit(access);
    this.requireActive(document);
    const now = new Date();
    const result = await this.documents
      .createQueryBuilder()
      .update(RequirementDocumentEntity)
      .set({
        title: request.title,
        revision: () => "Revision + 1",
        updatedByUserId: context.actor.id,
        updatedAt: now,
      })
      .where("Id = :documentId", { documentId })
      .andWhere("Revision = :expectedRevision", {
        expectedRevision: request.expectedRevision,
      })
      .andWhere("Status <> :archived", { archived: "ARCHIVED" })
      .execute();

    if (result.affected !== 1) this.stale();

    await this.dataSource.transaction((manager) =>
      this.addHistory(manager, {
        documentId,
        versionId: null,
        eventType: "DOCUMENT_METADATA_UPDATED",
        actorUserId: context.actor.id,
        details: { title: request.title },
        now,
      }),
    );
    return this.loadDetail(documentId);
  }

  async createVersion(
    context: DocumentsActorContext,
    documentId: string,
    request: CreateDocumentVersionRequest,
  ): Promise<RequirementDocumentDetail> {
    const document = await this.requireDocument(documentId);
    const access = await this.projectAccess(context, document.projectId);
    requireEdit(access);
    this.requireActive(document);
    if (request.idempotencyKey) {
      const existing = await this.versions.findOneBy({
        documentId,
        idempotencyKey: request.idempotencyKey,
      });
      if (existing) return this.loadDetail(documentId);
    }
    const sourceVersion = await this.requireVersion(
      documentId,
      document.currentVersionNumber,
    );
    const sourceSections = await this.sections.find({
      where: { documentVersionId: sourceVersion.id },
      order: { orderIndex: "ASC" },
    });
    this.assertThirteenSections(sourceSections);
    const sourceFields = await this.fields.find({
      where: { documentVersionId: sourceVersion.id },
    });
    const sourceRequirements = await this.requirements.find({
      where: { documentVersionId: sourceVersion.id },
    });
    const sourceCriteria = sourceRequirements.length
      ? await this.criteria.find({
          where: {
            requirementId: In(sourceRequirements.map((item) => item.id)),
          },
        })
      : [];
    const sourceEvidence = await this.evidence.find({
      where: { documentVersionId: sourceVersion.id },
    });
    const now = new Date();
    const versionId = randomUUID();
    const nextNumber = sourceVersion.versionNumber + 1;
    const nextVersion = `1.0.${nextNumber - 1}`;

    await this.dataSource.transaction(async (manager) => {
      const updated = await manager
        .createQueryBuilder()
        .update(RequirementDocumentEntity)
        .set({
          revision: () => "Revision + 1",
          currentVersionNumber: nextNumber,
          status: "DRAFT",
          updatedByUserId: context.actor.id,
          updatedAt: now,
        })
        .where("Id = :documentId", { documentId })
        .andWhere("Revision = :expectedRevision", {
          expectedRevision: request.expectedRevision,
        })
        .andWhere("Status <> :archived", { archived: "ARCHIVED" })
        .execute();

      if (updated.affected !== 1) this.stale();

      await manager.save(
        manager.create(DocumentVersionEntity, {
          id: versionId,
          documentId,
          versionNumber: nextNumber,
          version: nextVersion,
          status: "DRAFT",
          revision: 1,
          changeSummary: request.changeSummary,
          idempotencyKey: request.idempotencyKey ?? versionId,
          createdByUserId: context.actor.id,
          updatedByUserId: context.actor.id,
          createdAt: now,
          updatedAt: now,
          approvedByUserId: null,
          approvedAt: null,
          rejectedByUserId: null,
          rejectedAt: null,
        }),
      );

      const sectionIds = new Map<string, string>();
      await manager.save(
        DocumentSectionEntity,
        sourceSections.map((section) => {
          const id = randomUUID();
          sectionIds.set(section.key, id);
          const content = parseJson(section.contentJson);
          const updatedContent =
            section.key === "header"
              ? this.headerForNewVersion(content, nextVersion)
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
        }),
      );
      await manager.save(
        DocumentFieldEntity,
        sourceFields.map((field) => ({
          id: randomUUID(),
          documentVersionId: versionId,
          sectionKey: field.sectionKey,
          key: field.key,
          label: field.label,
          valueType: field.valueType,
          valueJson: field.valueJson,
          orderIndex: field.orderIndex,
        })),
      );
      const requirementIds = new Map<string, string>();
      await manager.save(
        DocumentRequirementEntity,
        sourceRequirements.map((requirement) => {
          const id = randomUUID();
          requirementIds.set(requirement.id, id);
          return {
            id,
            documentVersionId: versionId,
            sectionKey: requirement.sectionKey,
            code: requirement.code,
            title: requirement.title,
            description: requirement.description,
            requirementType: requirement.requirementType,
            status: requirement.status,
            orderIndex: requirement.orderIndex,
          };
        }),
      );
      await manager.save(
        AcceptanceCriterionEntity,
        sourceCriteria.map((criterion) => ({
          id: randomUUID(),
          requirementId: requirementIds.get(criterion.requirementId) as string,
          description: criterion.description,
          orderIndex: criterion.orderIndex,
        })),
      );
      await manager.save(
        DocumentEvidenceEntity,
        sourceEvidence.map((item) => ({
          id: randomUUID(),
          documentVersionId: versionId,
          sourceId: item.sourceId,
          sectionKey: item.sectionKey,
          requirementId: item.requirementId
            ? (requirementIds.get(item.requirementId) ?? null)
            : null,
          excerpt: item.excerpt,
          note: item.note,
        })),
      );
      await this.addHistory(manager, {
        documentId,
        versionId,
        eventType: "VERSION_CREATED",
        actorUserId: context.actor.id,
        details: {
          fromVersion: sourceVersion.version,
          version: nextVersion,
          changeSummary: request.changeSummary,
          sections: sectionIds.size,
        },
        now,
      });
    });

    return this.loadDetail(documentId);
  }

  async updateSection(
    context: DocumentsActorContext,
    documentId: string,
    versionNumber: number,
    sectionKey: DocumentSectionKey,
    request: UpdateDocumentSectionRequest,
  ): Promise<DocumentVersionDetail> {
    const document = await this.requireDocument(documentId);
    const access = await this.projectAccess(context, document.projectId);
    requireEdit(access);
    this.requireActive(document);
    const version = await this.requireVersion(documentId, versionNumber);
    this.requireCurrent(document, version);
    this.requireDraft(version);
    const section = await this.sections.findOneBy({
      documentVersionId: version.id,
      key: sectionKey,
    });

    if (!section) throw new NotFoundException("La sección no existe.");
    if (section.templateControlled) {
      throw new ConflictException(
        "Las secciones 11, 12 y 13 están controladas por la plantilla.",
      );
    }
    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      await this.lockDraftVersion(
        manager,
        version,
        request.expectedRevision,
        context.actor.id,
        now,
      );
      await manager.update(DocumentSectionEntity, section.id, {
        contentJson: serialize(request.content),
      });
      await this.touchDocument(
        manager,
        document,
        context.actor.id,
        now,
        "DRAFT",
      );
      await this.addHistory(manager, {
        documentId,
        versionId: version.id,
        eventType: "SECTION_UPDATED",
        actorUserId: context.actor.id,
        details: { sectionKey },
        now,
      });
    });

    return this.loadVersionDetail(
      await this.requireVersion(documentId, versionNumber),
    );
  }

  async replaceFields(
    context: DocumentsActorContext,
    documentId: string,
    versionNumber: number,
    request: ReplaceDocumentFieldsRequest,
  ): Promise<DocumentVersionDetail> {
    const document = await this.requireDocument(documentId);
    const access = await this.projectAccess(context, document.projectId);
    requireEdit(access);
    this.requireActive(document);
    const version = await this.requireVersion(documentId, versionNumber);
    this.requireCurrent(document, version);
    this.requireDraft(version);

    const sourceIds = [
      ...new Set(request.evidence.map((item) => item.sourceId)),
    ];
    await Promise.all(
      sourceIds.map((sourceId) =>
        this.sources.requireSource(
          document.projectId,
          sourceId,
          context.accessToken,
          context.correlationId,
        ),
      ),
    );

    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      await this.lockDraftVersion(
        manager,
        version,
        request.expectedRevision,
        context.actor.id,
        now,
      );
      await manager.delete(DocumentEvidenceEntity, {
        documentVersionId: version.id,
      });
      const oldRequirements = await manager.find(DocumentRequirementEntity, {
        where: { documentVersionId: version.id },
        select: { id: true },
      });
      if (oldRequirements.length) {
        await manager.delete(AcceptanceCriterionEntity, {
          requirementId: In(oldRequirements.map((item) => item.id)),
        });
      }
      await manager.delete(DocumentRequirementEntity, {
        documentVersionId: version.id,
      });
      await manager.delete(DocumentFieldEntity, {
        documentVersionId: version.id,
      });

      await manager.save(
        DocumentFieldEntity,
        request.fields.map((field) => ({
          id: randomUUID(),
          documentVersionId: version.id,
          sectionKey: field.sectionKey,
          key: field.key,
          label: field.label,
          valueType: field.valueType,
          valueJson: serialize(field.value),
          orderIndex: field.order,
        })),
      );

      const clientRequirementIds = new Map<string, string>();
      const requirementRows = request.requirements.map((requirement) => {
        const id = randomUUID();
        if (requirement.clientId)
          clientRequirementIds.set(requirement.clientId, id);
        return {
          id,
          documentVersionId: version.id,
          sectionKey: requirement.sectionKey,
          code: requirement.code,
          title: requirement.title,
          description: requirement.description,
          requirementType: requirement.requirementType,
          status: requirement.status,
          orderIndex: requirement.order,
        };
      });
      await manager.save(DocumentRequirementEntity, requirementRows);

      const criterionRows = request.requirements.flatMap((requirement, index) =>
        requirement.acceptanceCriteria.map((criterion) => ({
          id: randomUUID(),
          requirementId: requirementRows[index]?.id as string,
          description: criterion.description,
          orderIndex: criterion.order,
        })),
      );
      await manager.save(AcceptanceCriterionEntity, criterionRows);
      await manager.save(
        DocumentEvidenceEntity,
        request.evidence.map((item) => ({
          id: randomUUID(),
          documentVersionId: version.id,
          sourceId: item.sourceId,
          sectionKey: item.sectionKey ?? null,
          requirementId: item.requirementClientId
            ? (clientRequirementIds.get(item.requirementClientId) as string)
            : null,
          excerpt: item.excerpt ?? null,
          note: item.note ?? null,
        })),
      );
      await this.touchDocument(
        manager,
        document,
        context.actor.id,
        now,
        "DRAFT",
      );
      await this.addHistory(manager, {
        documentId,
        versionId: version.id,
        eventType: "STRUCTURED_CONTENT_REPLACED",
        actorUserId: context.actor.id,
        details: {
          fields: request.fields.length,
          requirements: request.requirements.length,
          evidence: request.evidence.length,
        },
        now,
      });
    });

    return this.loadVersionDetail(
      await this.requireVersion(documentId, versionNumber),
    );
  }

  async applyAiDraft(
    context: DocumentsActorContext,
    documentId: string,
    versionNumber: number,
    request: ApplyAiAnalysisDraftRequest,
  ): Promise<DocumentVersionDetail> {
    const document = await this.requireDocument(documentId);
    const access = await this.projectAccess(context, document.projectId);
    requireEdit(access);
    this.requireActive(document);
    const version = await this.requireVersion(documentId, versionNumber);
    this.requireCurrent(document, version);
    this.requireDraft(version);

    const alreadyApplied = await this.appliedAiResults.findOneBy({
      analysisResultId: request.analysisResultId,
    });
    if (alreadyApplied) {
      if (
        alreadyApplied.documentId.toLowerCase() !== documentId.toLowerCase() ||
        alreadyApplied.documentVersionId.toLowerCase() !==
          version.id.toLowerCase()
      ) {
        throw new ConflictException(
          "El resultado de IA ya fue aplicado a otra versión documental.",
        );
      }
      return this.loadVersionDetail(version);
    }

    const sourceIds = [
      ...new Set(request.evidence.map((item) => item.sourceId)),
    ];
    await Promise.all(
      sourceIds.map((sourceId) =>
        this.sources.requireSource(
          document.projectId,
          sourceId,
          context.accessToken,
          context.correlationId,
        ),
      ),
    );

    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      await this.lockDraftVersion(
        manager,
        version,
        request.expectedRevision,
        context.actor.id,
        now,
      );

      const sectionRows = await manager.find(DocumentSectionEntity, {
        where: { documentVersionId: version.id },
        order: { orderIndex: "ASC" },
      });
      for (const [index, sectionInput] of request.sections.entries()) {
        const section = sectionRows[index];
        if (
          !section ||
          section.key !== sectionInput.key ||
          section.templateControlled
        ) {
          throw new ConflictException(
            "El borrador de IA no coincide con las secciones editables del documento.",
          );
        }
        await manager.update(DocumentSectionEntity, section.id, {
          contentJson: serialize(sectionInput.content),
        });
      }

      await manager.delete(DocumentEvidenceEntity, {
        documentVersionId: version.id,
      });
      const oldRequirements = await manager.find(DocumentRequirementEntity, {
        where: { documentVersionId: version.id },
        select: { id: true },
      });
      if (oldRequirements.length) {
        await manager.delete(AcceptanceCriterionEntity, {
          requirementId: In(oldRequirements.map((item) => item.id)),
        });
      }
      await manager.delete(DocumentRequirementEntity, {
        documentVersionId: version.id,
      });

      const clientRequirementIds = new Map<string, string>();
      const requirementRows = request.requirements.map((requirement) => {
        const id = randomUUID();
        if (requirement.clientId)
          clientRequirementIds.set(requirement.clientId, id);
        return {
          id,
          documentVersionId: version.id,
          sectionKey: requirement.sectionKey,
          code: requirement.code,
          title: requirement.title,
          description: requirement.description,
          requirementType: requirement.requirementType,
          status: requirement.status,
          orderIndex: requirement.order,
        };
      });
      await manager.save(DocumentRequirementEntity, requirementRows);
      await manager.save(
        AcceptanceCriterionEntity,
        request.requirements.flatMap((requirement, index) =>
          requirement.acceptanceCriteria.map((criterion) => ({
            id: randomUUID(),
            requirementId: requirementRows[index]?.id as string,
            description: criterion.description,
            orderIndex: criterion.order,
          })),
        ),
      );
      await manager.save(
        DocumentEvidenceEntity,
        request.evidence.map((item) => ({
          id: randomUUID(),
          documentVersionId: version.id,
          sourceId: item.sourceId,
          sectionKey: item.sectionKey ?? null,
          requirementId: item.requirementClientId
            ? (clientRequirementIds.get(item.requirementClientId) as string)
            : null,
          excerpt: item.excerpt ?? null,
          note: item.note ?? null,
        })),
      );
      await manager.save(
        manager.create(AppliedAiAnalysisResultEntity, {
          id: randomUUID(),
          analysisRequestId: request.analysisRequestId,
          analysisResultId: request.analysisResultId,
          documentId,
          documentVersionId: version.id,
          appliedByUserId: context.actor.id,
          appliedAt: now,
        }),
      );
      await this.touchDocument(
        manager,
        document,
        context.actor.id,
        now,
        "DRAFT",
      );
      await this.addHistory(manager, {
        documentId,
        versionId: version.id,
        eventType: "AI_DRAFT_APPLIED",
        actorUserId: context.actor.id,
        details: {
          analysisRequestId: request.analysisRequestId,
          analysisResultId: request.analysisResultId,
          sections: request.sections.length,
          requirements: request.requirements.length,
          evidence: request.evidence.length,
        },
        now,
      });
    });

    return this.loadVersionDetail(
      await this.requireVersion(documentId, versionNumber),
    );
  }

  async submitReview(
    context: DocumentsActorContext,
    documentId: string,
    versionNumber: number,
    request: DocumentTransitionRequest,
  ): Promise<DocumentVersionDetail> {
    return this.transition(
      context,
      documentId,
      versionNumber,
      request,
      "DRAFT",
      "IN_REVIEW",
      "VERSION_SUBMITTED_FOR_REVIEW",
      false,
    );
  }

  async approve(
    context: DocumentsActorContext,
    documentId: string,
    versionNumber: number,
    request: DocumentTransitionRequest,
  ): Promise<DocumentVersionDetail> {
    return this.transition(
      context,
      documentId,
      versionNumber,
      request,
      "IN_REVIEW",
      "APPROVED",
      "VERSION_APPROVED",
      true,
    );
  }

  async reject(
    context: DocumentsActorContext,
    documentId: string,
    versionNumber: number,
    request: DocumentTransitionRequest,
  ): Promise<DocumentVersionDetail> {
    return this.transition(
      context,
      documentId,
      versionNumber,
      request,
      "IN_REVIEW",
      "REJECTED",
      "VERSION_REJECTED",
      true,
    );
  }

  async archive(
    context: DocumentsActorContext,
    documentId: string,
    request: ArchiveRequirementDocumentRequest,
  ): Promise<RequirementDocumentDetail> {
    const document = await this.requireDocument(documentId);
    const access = await this.projectAccess(context, document.projectId);
    requireReview(access);
    this.requireActive(document);
    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(RequirementDocumentEntity)
        .set({
          revision: () => "Revision + 1",
          status: "ARCHIVED",
          updatedByUserId: context.actor.id,
          updatedAt: now,
          archivedByUserId: context.actor.id,
          archivedAt: now,
        })
        .where("Id = :documentId", { documentId })
        .andWhere("Revision = :expectedRevision", {
          expectedRevision: request.expectedRevision,
        })
        .andWhere("Status <> :archived", { archived: "ARCHIVED" })
        .execute();
      if (result.affected !== 1) this.stale();
      await this.addHistory(manager, {
        documentId,
        versionId: null,
        eventType: "DOCUMENT_ARCHIVED",
        actorUserId: context.actor.id,
        details: {},
        now,
      });
    });

    return this.loadDetail(documentId);
  }

  async history(
    context: DocumentsActorContext,
    documentId: string,
  ): Promise<readonly DocumentHistoryEntry[]> {
    const document = await this.requireDocument(documentId);
    await this.projectAccess(context, document.projectId);
    const rows = await this.historyRepository.find({
      where: { documentId },
      order: { createdAt: "DESC" },
    });

    return rows.map((row) => ({
      id: row.id,
      documentId: row.documentId,
      versionId: row.versionId,
      eventType: row.eventType,
      actorUserId: row.actorUserId,
      details: parseJson(row.detailsJson),
      createdAt: toIso(row.createdAt),
    }));
  }

  async appliedTemplate(
    context: DocumentsActorContext,
    documentId: string,
  ): Promise<AppliedDocumentTemplate> {
    const document = await this.requireDocument(documentId);
    await this.projectAccess(context, document.projectId);
    const template = await this.appliedTemplates.findOneBy({
      id: document.appliedTemplateId,
    });
    if (!template)
      throw new NotFoundException("La plantilla aplicada no existe.");

    return {
      ...templateWithoutDefinition(template),
      definition: parseJson(template.definitionJson),
    };
  }

  private async transition(
    context: DocumentsActorContext,
    documentId: string,
    versionNumber: number,
    request: DocumentTransitionRequest,
    from: DocumentStatus,
    to: DocumentStatus,
    eventType: string,
    reviewPermission: boolean,
  ): Promise<DocumentVersionDetail> {
    const document = await this.requireDocument(documentId);
    const access = await this.projectAccess(context, document.projectId);
    if (reviewPermission) requireReview(access);
    else requireEdit(access);
    this.requireActive(document);
    const version = await this.requireVersion(documentId, versionNumber);
    this.requireCurrent(document, version);

    if (version.status !== from) {
      throw new ConflictException(
        `La transición requiere una versión en estado ${from}.`,
      );
    }

    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      const set = {
        status: to,
        revision: () => "Revision + 1",
        updatedByUserId: context.actor.id,
        updatedAt: now,
        approvedByUserId:
          to === "APPROVED" ? context.actor.id : version.approvedByUserId,
        approvedAt: to === "APPROVED" ? now : version.approvedAt,
        rejectedByUserId:
          to === "REJECTED" ? context.actor.id : version.rejectedByUserId,
        rejectedAt: to === "REJECTED" ? now : version.rejectedAt,
      };

      const result = await manager
        .createQueryBuilder()
        .update(DocumentVersionEntity)
        .set(set)
        .where("Id = :versionId", { versionId: version.id })
        .andWhere("Revision = :expectedRevision", {
          expectedRevision: request.expectedRevision,
        })
        .andWhere("Status = :from", { from })
        .execute();
      if (result.affected !== 1) this.stale();

      const header = await manager.findOneBy(DocumentSectionEntity, {
        documentVersionId: version.id,
        key: "header",
      });
      if (!header)
        throw new ConflictException("El documento no contiene encabezado.");
      await manager.update(DocumentSectionEntity, header.id, {
        contentJson: serialize(
          this.headerForTransition(
            parseJson(header.contentJson),
            to,
            context.actor,
          ),
        ),
      });
      await this.touchDocument(manager, document, context.actor.id, now, to);
      await this.addHistory(manager, {
        documentId,
        versionId: version.id,
        eventType,
        actorUserId: context.actor.id,
        details: { from, to, comment: request.comment ?? null },
        now,
      });
    });

    return this.loadVersionDetail(
      await this.requireVersion(documentId, versionNumber),
    );
  }

  private headerForNewVersion(
    content: DocumentJsonValue,
    version: string,
  ): DocumentJsonValue {
    if (!content || typeof content !== "object" || Array.isArray(content))
      return content;
    return {
      ...content,
      documentVersion: version,
      status: "BORRADOR",
      reviewedBy: { name: PENDING, position: PENDING },
      approvedBy: { name: PENDING, position: PENDING },
    };
  }

  private headerForTransition(
    content: DocumentJsonValue,
    status: DocumentStatus,
    actor: AuthenticatedUser,
  ): DocumentJsonValue {
    if (!content || typeof content !== "object" || Array.isArray(content))
      return content;
    const visibleStatus =
      status === "IN_REVIEW"
        ? "EN VALIDACIÓN"
        : status === "APPROVED"
          ? "APROBADO"
          : status === "REJECTED"
            ? "BORRADOR"
            : "BORRADOR";
    const changes: Record<string, DocumentJsonValue> = {
      status: visibleStatus,
    };
    if (status === "IN_REVIEW") {
      changes.reviewedBy = { name: actor.displayName, position: PENDING };
    }
    if (status === "APPROVED") {
      changes.approvedBy = { name: actor.displayName, position: PENDING };
    }
    return { ...content, ...changes };
  }

  private async projectAccess(
    context: DocumentsActorContext,
    projectId: string,
  ): Promise<DocumentProjectAccess> {
    return this.projects.requireRead(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );
  }

  private requireActive(document: RequirementDocumentEntity): void {
    if (document.status === "ARCHIVED") {
      throw new ConflictException(
        "El documento está archivado y es inmutable.",
      );
    }
  }

  private requireCurrent(
    document: RequirementDocumentEntity,
    version: DocumentVersionEntity,
  ): void {
    if (document.currentVersionNumber !== version.versionNumber) {
      throw new ConflictException(
        "Solo la versión actual puede modificarse o cambiar de estado.",
      );
    }
  }

  private requireDraft(version: DocumentVersionEntity): void {
    if (version.status === "APPROVED") {
      throw new ConflictException(
        "La versión aprobada es inmutable; crea una nueva versión.",
      );
    }
    if (version.status !== "DRAFT") {
      throw new ConflictException(
        "Solo una versión en borrador puede editarse.",
      );
    }
  }

  private stale(): never {
    throw new ConflictException(
      "La revisión enviada está desactualizada. Recarga el documento antes de guardar.",
    );
  }

  private async requireDocument(
    documentId: string,
  ): Promise<RequirementDocumentEntity> {
    const document = await this.documents.findOneBy({ id: documentId });
    if (!document) throw new NotFoundException("El documento no existe.");
    return document;
  }

  private async requireVersion(
    documentId: string,
    versionNumber: number,
  ): Promise<DocumentVersionEntity> {
    const version = await this.versions.findOneBy({
      documentId,
      versionNumber,
    });
    if (!version)
      throw new NotFoundException("La versión del documento no existe.");
    return version;
  }

  private async loadSummary(
    document: RequirementDocumentEntity,
  ): Promise<RequirementDocumentSummary> {
    const [template, version] = await Promise.all([
      this.appliedTemplates.findOneBy({ id: document.appliedTemplateId }),
      this.versions.findOneBy({
        documentId: document.id,
        versionNumber: document.currentVersionNumber,
      }),
    ]);
    if (!template || !version) {
      throw new ConflictException(
        "El documento tiene referencias internas incompletas.",
      );
    }

    return {
      id: document.id,
      projectId: document.projectId,
      title: document.title,
      status: document.status,
      revision: document.revision,
      currentVersionNumber: document.currentVersionNumber,
      currentVersion: version.version,
      template: templateWithoutDefinition(template),
      createdByUserId: document.createdByUserId,
      createdAt: toIso(document.createdAt),
      updatedAt: toIso(document.updatedAt),
      archivedAt: document.archivedAt ? toIso(document.archivedAt) : null,
    };
  }

  private async loadDetail(
    documentId: string,
  ): Promise<RequirementDocumentDetail> {
    const document = await this.requireDocument(documentId);
    const [summary, version] = await Promise.all([
      this.loadSummary(document),
      this.requireVersion(documentId, document.currentVersionNumber),
    ]);
    return {
      ...summary,
      currentVersionDetail: await this.loadVersionDetail(version),
    };
  }

  private async loadVersionDetail(
    version: DocumentVersionEntity,
  ): Promise<DocumentVersionDetail> {
    const [sections, fields, requirements, evidence] = await Promise.all([
      this.sections.find({
        where: { documentVersionId: version.id },
        order: { orderIndex: "ASC" },
      }),
      this.fields.find({
        where: { documentVersionId: version.id },
        order: { sectionKey: "ASC", orderIndex: "ASC" },
      }),
      this.requirements.find({
        where: { documentVersionId: version.id },
        order: { orderIndex: "ASC" },
      }),
      this.evidence.find({ where: { documentVersionId: version.id } }),
    ]);
    this.assertThirteenSections(sections);
    const criteria = requirements.length
      ? await this.criteria.find({
          where: { requirementId: In(requirements.map((item) => item.id)) },
          order: { orderIndex: "ASC" },
        })
      : [];

    return {
      ...versionSummary(version),
      sections: sections.map((section) => ({
        id: section.id,
        key: section.key as DocumentSectionKey,
        title: section.title,
        order: section.orderIndex,
        content: parseJson(section.contentJson),
        templateControlled: section.templateControlled,
      })),
      fields: fields.map((field) => ({
        id: field.id,
        sectionKey: field.sectionKey as DocumentSectionKey,
        key: field.key,
        label: field.label,
        valueType: field.valueType,
        value: parseJson(field.valueJson),
        order: field.orderIndex,
      })),
      requirements: requirements.map((requirement) => ({
        id: requirement.id,
        sectionKey: requirement.sectionKey as DocumentSectionKey,
        code: requirement.code,
        title: requirement.title,
        description: requirement.description,
        requirementType: requirement.requirementType,
        status: requirement.status,
        order: requirement.orderIndex,
        acceptanceCriteria: criteria
          .filter((criterion) => criterion.requirementId === requirement.id)
          .map((criterion) => ({
            id: criterion.id,
            description: criterion.description,
            order: criterion.orderIndex,
          })),
      })),
      evidence: evidence.map((item) => ({
        id: item.id,
        sourceId: item.sourceId,
        sectionKey: item.sectionKey as DocumentSectionKey | null,
        requirementId: item.requirementId,
        excerpt: item.excerpt,
        note: item.note,
      })),
    };
  }

  private assertThirteenSections(
    sections: readonly DocumentSectionEntity[],
  ): void {
    if (sections.length !== DOCUMENT_SECTION_DEFINITIONS.length) {
      throw new ConflictException(
        "El documento no contiene exactamente 13 secciones.",
      );
    }
    DOCUMENT_SECTION_DEFINITIONS.forEach((expected, index) => {
      const actual = sections[index];
      if (
        !actual ||
        actual.key !== expected.key ||
        actual.title !== expected.title ||
        actual.orderIndex !== index + 1
      ) {
        throw new ConflictException(
          "El documento no conserva el orden de las 13 secciones canónicas.",
        );
      }
    });
  }

  private async lockDraftVersion(
    manager: DataSource["manager"],
    version: DocumentVersionEntity,
    expectedRevision: number,
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    const result = await manager
      .createQueryBuilder()
      .update(DocumentVersionEntity)
      .set({
        revision: () => "Revision + 1",
        updatedByUserId: actorUserId,
        updatedAt: now,
      })
      .where("Id = :versionId", { versionId: version.id })
      .andWhere("Revision = :expectedRevision", { expectedRevision })
      .andWhere("Status = :draft", { draft: "DRAFT" })
      .execute();
    if (result.affected !== 1) this.stale();
  }

  private async touchDocument(
    manager: DataSource["manager"],
    document: RequirementDocumentEntity,
    actorUserId: string,
    now: Date,
    status: DocumentStatus,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(RequirementDocumentEntity)
      .set({
        revision: () => "Revision + 1",
        status,
        updatedByUserId: actorUserId,
        updatedAt: now,
      })
      .where("Id = :documentId", { documentId: document.id })
      .execute();
  }

  private async addHistory(
    manager: DataSource["manager"],
    input: {
      documentId: string;
      versionId: string | null;
      eventType: string;
      actorUserId: string;
      details: DocumentJsonValue;
      now: Date;
    },
  ): Promise<void> {
    await manager.save(
      manager.create(DocumentHistoryEntity, {
        id: randomUUID(),
        documentId: input.documentId,
        versionId: input.versionId,
        eventType: input.eventType,
        actorUserId: input.actorUserId,
        detailsJson: serialize(input.details),
        createdAt: input.now,
      }),
    );
  }
}
