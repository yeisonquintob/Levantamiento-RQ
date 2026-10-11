import { randomUUID } from "node:crypto";

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, Repository } from "typeorm";

import {
  type AppliedDocumentTemplate,
  type ApplyAiAnalysisDraftRequest,
  type ArchiveRequirementDocumentRequest,
  type AuthenticatedUser,
  type CreateDocumentVersionRequest,
  type CreateRequirementDocumentRequest,
  type DocumentHistoryEntry,
  type DocumentSectionKey,
  type DocumentStatus,
  type DocumentTransitionRequest,
  type DocumentVersionDetail,
  type DocumentVersionSummary,
  type ProjectDomainPurgeResult,
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
  approvalsForTransition,
  headerForTransition,
} from "./documents-approvals";
import {
  requireActive,
  requireCurrent,
  requireDraft,
  requireEditable,
  requireEdit,
  requireReview,
  stale,
} from "./documents-guards";
import { initialContent } from "./documents-initial-content";
import {
  hasPrototypeContent,
  hasSolutionPrototypeMarkdown,
  parseJson,
  serialize,
} from "./documents-json";
import {
  toDocumentSummary,
  toHistoryEntry,
  toVersionDetail,
  templateWithoutDefinition,
  versionSummary,
} from "./documents-mappers";
import {
  appliedTemplateIncludesScrum,
  assertCanonicalTemplate,
  assertSectionsLayout,
  customTemplateLayout,
} from "./documents-template-layout";
import {
  buildCriterionRows,
  buildEvidenceRows,
  buildRequirementRows,
  cloneSectionsForNewVersion,
  prepareAiSections,
} from "./documents-version-content";
import {
  lockEditableVersion,
  touchDocument,
  addHistory,
} from "./documents-writes";
import { synchronizePlanningSections } from "./documents-backlog-sync";
import {
  type DocumentProjectAccess,
  DocumentsProjectsAccessClient,
} from "./projects-access.client";
import { DocumentsSourcesAccessClient } from "./sources-access.client";

export {
  hasPrototypeContent,
  hasSolutionPrototypeMarkdown,
} from "./documents-json";
export {
  synchronizeBacklogStructureWithRequirements,
  synchronizeRequirementStoriesWithBacklog,
} from "./documents-backlog-sync";

export interface DocumentsActorContext {
  actor: AuthenticatedUser;
  accessToken: string;
  correlationId: string;
}

const SQL_SERVER_WRITE_BATCH_SIZE = 100;
const SQL_SERVER_IN_BATCH_SIZE = 500;

async function deleteAcceptanceCriteriaInBatches(
  manager: EntityManager,
  requirementIds: readonly string[],
): Promise<void> {
  for (
    let index = 0;
    index < requirementIds.length;
    index += SQL_SERVER_IN_BATCH_SIZE
  ) {
    await manager.delete(AcceptanceCriterionEntity, {
      requirementId: In(
        requirementIds.slice(index, index + SQL_SERVER_IN_BATCH_SIZE),
      ),
    });
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
    const expectedSections = assertCanonicalTemplate(
      definition,
      sourceTemplate.includesScrum,
    );
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
        expectedSections.map((section, index) => ({
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
          templateControlled: false,
        })),
      );
      await addHistory(manager, {
        documentId,
        versionId,
        eventType: "DOCUMENT_CREATED",
        actorUserId: context.actor.id,
        details: {
          projectId,
          templateId: sourceTemplate.id,
          templateVersion: sourceTemplate.version,
          sections: expectedSections.length,
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
      documents.map(async (document) => {
        const [summary, versionCount] = await Promise.all([
          this.loadSummary(document),
          this.versions.countBy({ documentId: document.id }),
        ]);
        return { ...summary, versionCount };
      }),
    );

    return { items, totalItems: items.length };
  }

  async purgeProject(
    context: DocumentsActorContext,
    projectId: string,
  ): Promise<ProjectDomainPurgeResult> {
    const access = await this.projectAccess(context, projectId);
    if (access.role !== "ADMIN" && access.role !== "OWNER") {
      throw new ForbiddenException(
        "Solo ADMIN o el propietario pueden eliminar todos los documentos.",
      );
    }
    requireEdit(access);
    const documents = await this.documents.find({ where: { projectId } });
    if (documents.length === 0) return { deleted: true, count: 0 };

    const documentIds = documents.map((document) => document.id);
    const appliedTemplateIds = [
      ...new Set(documents.map((document) => document.appliedTemplateId)),
    ];
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(AppliedAiAnalysisResultEntity, {
        documentId: In(documentIds),
      });
      await manager.delete(RequirementDocumentEntity, {
        id: In(documentIds),
      });
      for (const appliedTemplateId of appliedTemplateIds) {
        const remaining = await manager.countBy(RequirementDocumentEntity, {
          appliedTemplateId,
        });
        if (remaining === 0) {
          await manager.delete(AppliedDocumentTemplateEntity, {
            id: appliedTemplateId,
          });
        }
      }
    });

    return { deleted: true, count: documents.length };
  }

  async getById(
    context: DocumentsActorContext,
    documentId: string,
  ): Promise<RequirementDocumentDetail> {
    const document = await this.requireDocument(documentId);
    await this.projectAccess(context, document.projectId);
    return this.loadDetail(documentId);
  }

  async listVersions(
    context: DocumentsActorContext,
    documentId: string,
  ): Promise<readonly DocumentVersionSummary[]> {
    const document = await this.requireDocument(documentId);
    await this.projectAccess(context, document.projectId);
    const versions = await this.versions.find({
      where: { documentId },
      order: { versionNumber: "DESC" },
    });
    return versions.map(versionSummary);
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

  async deleteDraftVersion(
    context: DocumentsActorContext,
    documentId: string,
    versionNumber: number,
  ): Promise<{ deleted: true; documentDeleted: boolean }> {
    const document = await this.requireDocument(documentId);
    const access = await this.projectAccess(context, document.projectId);
    requireEdit(access);
    requireActive(document);
    const version = await this.requireVersion(documentId, versionNumber);
    if (version.status !== "DRAFT") {
      throw new ConflictException(
        "Solo se pueden eliminar versiones en estado DRAFT.",
      );
    }
    const now = new Date();
    let documentDeleted = false;
    await this.dataSource.transaction(async (manager) => {
      /*
       * La comprobación de estado se repite dentro de la transacción con
       * bloqueo de actualización (UPDLOCK), de modo que una transición
       * concurrente (p. ej. enviar a revisión) no deje borrar una versión
       * que ya no es DRAFT.
       */
      const lockedDocument = await manager.findOne(RequirementDocumentEntity, {
        where: { id: documentId },
        lock: { mode: "pessimistic_write" },
      });
      if (!lockedDocument)
        throw new NotFoundException("El documento no existe.");
      requireActive(lockedDocument);
      const lockedVersion = await manager.findOne(DocumentVersionEntity, {
        where: { id: version.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!lockedVersion)
        throw new NotFoundException("La versión del documento no existe.");
      if (lockedVersion.status !== "DRAFT") {
        throw new ConflictException(
          "Solo se pueden eliminar versiones en estado DRAFT.",
        );
      }
      const versions = await manager.find(DocumentVersionEntity, {
        where: { documentId },
        order: { versionNumber: "DESC" },
      });
      documentDeleted = versions.length === 1;

      await manager.delete(AppliedAiAnalysisResultEntity, {
        documentVersionId: version.id,
      });
      // La condición de estado en el DELETE es la defensa final contra carreras.
      const deleted = await manager.delete(DocumentVersionEntity, {
        id: version.id,
        status: "DRAFT",
      });
      if (deleted.affected !== 1) {
        throw new ConflictException(
          "Solo se pueden eliminar versiones en estado DRAFT.",
        );
      }
      if (documentDeleted) {
        await manager.delete(RequirementDocumentEntity, { id: documentId });
        return;
      }
      if (lockedDocument.currentVersionNumber === versionNumber) {
        const previous = versions.find(
          (candidate) => candidate.id !== version.id,
        );
        if (!previous)
          throw new ConflictException(
            "No existe una versión anterior recuperable.",
          );
        await manager.update(RequirementDocumentEntity, documentId, {
          currentVersionNumber: previous.versionNumber,
          status: previous.status,
          revision: () => "Revision + 1",
          updatedByUserId: context.actor.id,
          updatedAt: now,
        });
      }
      await addHistory(manager, {
        documentId,
        versionId: null,
        eventType: "DOCUMENT_DRAFT_DELETED",
        actorUserId: context.actor.id,
        details: { deletedVersionId: version.id, versionNumber },
        now,
      });
    });
    return { deleted: true, documentDeleted };
  }

  async updateMetadata(
    context: DocumentsActorContext,
    documentId: string,
    request: UpdateRequirementDocumentRequest,
  ): Promise<RequirementDocumentDetail> {
    const document = await this.requireDocument(documentId);
    const access = await this.projectAccess(context, document.projectId);
    requireEdit(access);
    requireActive(document);
    const now = new Date();
    // Actualización e historial en una sola transacción: no queda un cambio
    // de título sin su evento de auditoría.
    await this.dataSource.transaction(async (manager) => {
      const result = await manager
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

      if (result.affected !== 1) stale();

      await addHistory(manager, {
        documentId,
        versionId: null,
        eventType: "DOCUMENT_METADATA_UPDATED",
        actorUserId: context.actor.id,
        details: { title: request.title },
        now,
      });
    });
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
    requireActive(document);
    if (request.idempotencyKey) {
      const existing = await this.versions.findOneBy({
        documentId,
        idempotencyKey: request.idempotencyKey,
      });
      if (existing) {
        const detail = await this.loadDetail(documentId);
        if (detail.status === "DRAFT")
          await this.projects.documentGenerated(
            document.projectId,
            documentId,
            context.accessToken,
          );
        return detail;
      }
    }
    const sourceVersion = await this.requireVersion(
      documentId,
      document.currentVersionNumber,
    );
    const sourceSections = await this.sections.find({
      where: { documentVersionId: sourceVersion.id },
      order: { orderIndex: "ASC" },
    });
    const appliedTemplate = await this.appliedTemplates.findOneBy({
      id: document.appliedTemplateId,
    });
    if (!appliedTemplate) {
      throw new ConflictException(
        "El documento no conserva la plantilla aplicada.",
      );
    }
    this.assertDocumentSections(sourceSections, appliedTemplate);
    // Las plantillas propias no reciben las secciones canónicas añadidas
    // por las migraciones de layout (solución propuesta y Plan Scrum).
    const isCustomTemplate = customTemplateLayout(appliedTemplate) !== null;
    const includesScrum = appliedTemplateIncludesScrum(appliedTemplate);
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

      if (updated.affected !== 1) stale();

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

      const { clonedSections, sectionCount } = cloneSectionsForNewVersion({
        sourceSections,
        versionId,
        nextVersion,
        actor: context.actor,
        project: access.project,
        now,
        isCustomTemplate,
        includesScrum,
      });

      // DOCUMENT_VERSION_CLONE_SQL_CHUNK_V1_2
      // SQL Server admite como máximo 2.100 parámetros por solicitud.
      // TypeORM divide aquí las inserciones masivas de una versión grande
      // sin cambiar la transacción ni el resultado funcional.
      await manager.save(DocumentSectionEntity, clonedSections, { chunk: 100 });
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
        { chunk: 100 },
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
        { chunk: 100 },
      );
      await manager.save(
        AcceptanceCriterionEntity,
        sourceCriteria.map((criterion) => ({
          id: randomUUID(),
          requirementId: requirementIds.get(criterion.requirementId) as string,
          description: criterion.description,
          orderIndex: criterion.orderIndex,
        })),
        { chunk: 100 },
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
        { chunk: 100 },
      );
      await addHistory(manager, {
        documentId,
        versionId,
        eventType: "VERSION_CREATED",
        actorUserId: context.actor.id,
        details: {
          fromVersion: sourceVersion.version,
          version: nextVersion,
          changeSummary: request.changeSummary,
          sections: sectionCount,
        },
        now,
      });
    });

    await this.projects.documentGenerated(
      document.projectId,
      documentId,
      context.accessToken,
    );
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
    requireActive(document);
    const version = await this.requireVersion(documentId, versionNumber);
    requireCurrent(document, version);
    const editableStatus = requireEditable(version);
    const section = await this.sections.findOneBy({
      documentVersionId: version.id,
      key: sectionKey,
    });

    if (!section) throw new NotFoundException("La sección no existe.");
    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      await lockEditableVersion(
        manager,
        version,
        request.expectedRevision,
        context.actor.id,
        now,
        editableStatus,
      );
      await manager.update(DocumentSectionEntity, section.id, {
        contentJson: serialize(request.content),
      });

      await synchronizePlanningSections(
        manager,
        version.id,
        sectionKey,
        request.content,
      );

      await touchDocument(
        manager,
        document,
        context.actor.id,
        now,
        editableStatus,
      );
      await addHistory(manager, {
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
    requireActive(document);
    const version = await this.requireVersion(documentId, versionNumber);
    requireCurrent(document, version);
    const editableStatus = requireEditable(version);

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
      await lockEditableVersion(
        manager,
        version,
        request.expectedRevision,
        context.actor.id,
        now,
        editableStatus,
      );
      await manager.delete(DocumentEvidenceEntity, {
        documentVersionId: version.id,
      });
      const oldRequirements = await manager.find(DocumentRequirementEntity, {
        where: { documentVersionId: version.id },
        select: { id: true },
      });
      if (oldRequirements.length) {
        await deleteAcceptanceCriteriaInBatches(
          manager,
          oldRequirements.map((item) => item.id),
        );
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
        { chunk: SQL_SERVER_WRITE_BATCH_SIZE },
      );

      const { requirementRows, clientRequirementIds } = buildRequirementRows(
        request.requirements,
        version.id,
      );
      await manager.save(DocumentRequirementEntity, requirementRows, {
        chunk: SQL_SERVER_WRITE_BATCH_SIZE,
      });

      const criterionRows = buildCriterionRows(
        request.requirements,
        requirementRows,
      );
      await manager.save(AcceptanceCriterionEntity, criterionRows, {
        chunk: SQL_SERVER_WRITE_BATCH_SIZE,
      });
      await manager.save(
        DocumentEvidenceEntity,
        buildEvidenceRows(request.evidence, version.id, clientRequirementIds),
        { chunk: SQL_SERVER_WRITE_BATCH_SIZE },
      );
      await touchDocument(
        manager,
        document,
        context.actor.id,
        now,
        editableStatus,
      );
      await addHistory(manager, {
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
    // `documents.ai.apply` habilita la acción, pero no sustituye la
    // autorización de edición de una persona. La excepción es la identidad de
    // carga de trabajo del servicio de IA (rol SERVICE, nunca un usuario): aplica
    // el borrador de una solicitud cuya autorización ya se validó al crearla, y
    // así funciona igual en todos los proyectos.
    if (!(
      access.role === "SERVICE" &&
      context.actor.permissions.includes("documents.ai.apply")
    )) {
      requireEdit(access);
    }
    requireActive(document);
    const version = await this.requireVersion(documentId, versionNumber);
    requireCurrent(document, version);
    requireDraft(version);

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
      await this.projects.documentGenerated(
        document.projectId,
        documentId,
        context.accessToken,
      );
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
      await lockEditableVersion(
        manager,
        version,
        request.expectedRevision,
        context.actor.id,
        now,
        "DRAFT",
      );

      const sectionRows = await manager.find(DocumentSectionEntity, {
        where: { documentVersionId: version.id },
        order: { orderIndex: "ASC" },
      });
      const preparedSections = prepareAiSections(sectionRows, request);
      for (const prepared of preparedSections) {
        await manager.update(DocumentSectionEntity, prepared.section.id, {
          contentJson: serialize(prepared.content),
        });
      }
      // Punto 6 / Punto 7 en la misma transacción, como en updateSection.
      for (const prepared of preparedSections) {
        await synchronizePlanningSections(
          manager,
          version.id,
          prepared.key,
          prepared.content,
        );
      }

      await manager.delete(DocumentEvidenceEntity, {
        documentVersionId: version.id,
      });
      const oldRequirements = await manager.find(DocumentRequirementEntity, {
        where: { documentVersionId: version.id },
        select: { id: true },
      });
      if (oldRequirements.length) {
        await deleteAcceptanceCriteriaInBatches(
          manager,
          oldRequirements.map((item) => item.id),
        );
      }
      await manager.delete(DocumentRequirementEntity, {
        documentVersionId: version.id,
      });

      const { requirementRows, clientRequirementIds } = buildRequirementRows(
        request.requirements,
        version.id,
      );
      await manager.save(DocumentRequirementEntity, requirementRows, {
        chunk: SQL_SERVER_WRITE_BATCH_SIZE,
      });
      await manager.save(
        AcceptanceCriterionEntity,
        buildCriterionRows(request.requirements, requirementRows),
        { chunk: SQL_SERVER_WRITE_BATCH_SIZE },
      );
      await manager.save(
        DocumentEvidenceEntity,
        buildEvidenceRows(request.evidence, version.id, clientRequirementIds),
        { chunk: SQL_SERVER_WRITE_BATCH_SIZE },
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
      await touchDocument(manager, document, context.actor.id, now, "DRAFT");
      await addHistory(manager, {
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

    await this.projects.documentGenerated(
      document.projectId,
      documentId,
      context.accessToken,
    );
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
      ["DRAFT", "CHANGES_REQUESTED"],
      "IN_REVIEW",
      "VERSION_SUBMITTED_FOR_REVIEW",
      false,
    );
  }

  async requestChanges(
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
      ["IN_REVIEW"],
      "CHANGES_REQUESTED",
      "VERSION_CHANGES_REQUESTED",
      true,
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
      ["IN_REVIEW"],
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
      ["IN_REVIEW"],
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
    requireActive(document);
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
      if (result.affected !== 1) stale();
      await addHistory(manager, {
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

    return rows.map(toHistoryEntry);
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
    from: readonly DocumentStatus[],
    to: DocumentStatus,
    eventType: string,
    reviewPermission: boolean,
  ): Promise<DocumentVersionDetail> {
    const document = await this.requireDocument(documentId);
    const access = await this.projectAccess(context, document.projectId);
    if (reviewPermission) requireReview(access);
    else requireEdit(access);
    requireActive(document);
    const version = await this.requireVersion(documentId, versionNumber);
    requireCurrent(document, version);

    if (!from.includes(version.status)) {
      throw new ConflictException(
        `La transición requiere una versión en estado ${from.join(" o ")}.`,
      );
    }

    const customLayout = customTemplateLayout(
      await this.appliedTemplates.findOneBy({
        id: document.appliedTemplateId,
      }),
    );

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
        .andWhere("Status IN (:...from)", { from })
        .execute();
      if (result.affected !== 1) stale();

      /*
       * Encabezado y aprobaciones son secciones canónicas. Una plantilla propia
       * puede no incluirlas: en ese caso solo cambia el estado de la versión.
       */
      const header = await manager.findOneBy(DocumentSectionEntity, {
        documentVersionId: version.id,
        key: "header",
      });
      if (header) {
        await manager.update(DocumentSectionEntity, header.id, {
          contentJson: serialize(
            headerForTransition(parseJson(header.contentJson), to),
          ),
        });
      } else if (!customLayout) {
        throw new ConflictException("El documento no contiene encabezado.");
      }
      const approvals = await manager.findOneBy(DocumentSectionEntity, {
        documentVersionId: version.id,
        key: "approvalsAndChangeControl",
      });
      if (approvals) {
        await manager.update(DocumentSectionEntity, approvals.id, {
          contentJson: serialize(
            approvalsForTransition(
              parseJson(approvals.contentJson),
              to,
              context.actor,
              version,
              now,
            ),
          ),
        });
      } else if (!customLayout) {
        throw new ConflictException(
          "El documento no contiene la sección de aprobaciones.",
        );
      }
      await touchDocument(manager, document, context.actor.id, now, to);
      await addHistory(manager, {
        documentId,
        versionId: version.id,
        eventType,
        actorUserId: context.actor.id,
        details: {
          from: version.status,
          to,
          comment: request.comment ?? null,
        },
        now,
      });
    });

    return this.loadVersionDetail(
      await this.requireVersion(documentId, versionNumber),
    );
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
    const prototypeSections = await this.sections.find({
      where: {
        documentVersionId: version.id,
        key: In(["visualFormat", "solutionProposal"]),
      },
    });
    const hasPrototype = prototypeSections.some((section) => {
      const content = parseJson(section.contentJson);
      return section.key === "visualFormat"
        ? hasPrototypeContent(content)
        : hasSolutionPrototypeMarkdown(content);
    });

    return toDocumentSummary(document, version, template, hasPrototype);
  }

  private async loadDetail(
    documentId: string,
  ): Promise<RequirementDocumentDetail> {
    const document = await this.requireDocument(documentId);
    const [summary, version] = await Promise.all([
      this.loadSummary(document),
      this.requireVersion(documentId, document.currentVersionNumber),
    ]);
    const applied = await this.appliedTemplates.findOneByOrFail({
      id: document.appliedTemplateId,
    });
    return {
      ...summary,
      appliedTemplate: {
        ...templateWithoutDefinition(applied),
        definition: parseJson(applied.definitionJson),
      },
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
    this.assertDocumentSections(
      sections,
      await this.appliedTemplateOfVersion(version),
    );
    const criteria = requirements.length
      ? await this.criteria.find({
          where: { requirementId: In(requirements.map((item) => item.id)) },
          order: { orderIndex: "ASC" },
        })
      : [];

    return toVersionDetail(
      version,
      sections,
      fields,
      requirements,
      criteria,
      evidence,
    );
  }

  /**
   * Plantilla efectiva de una versión: la aplicada (snapshot) al documento.
   */
  private async appliedTemplateOfVersion(
    version: DocumentVersionEntity,
  ): Promise<AppliedDocumentTemplateEntity | null> {
    const document = await this.documents.findOneBy({ id: version.documentId });
    if (!document) return null;
    return this.appliedTemplates.findOneBy({ id: document.appliedTemplateId });
  }

  private assertDocumentSections(
    sections: readonly DocumentSectionEntity[],
    appliedTemplate?: AppliedDocumentTemplateEntity | null,
  ): void {
    assertSectionsLayout(sections, appliedTemplate);
  }
}
