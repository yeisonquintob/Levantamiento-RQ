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
  DOCUMENT_SCRUM_SECTION_DEFINITION,
  DOCUMENT_SECTION_DEFINITIONS,
  getDocumentSectionDefinitions,
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

const LEGACY_DOCUMENT_SECTION_DEFINITIONS = DOCUMENT_SECTION_DEFINITIONS.filter(
  (section) => section.key !== "solutionProposal",
);

const HISTORICAL_DOCUMENT_SECTION_DEFINITIONS = [
  ...LEGACY_DOCUMENT_SECTION_DEFINITIONS.slice(0, 5),
  {
    key: "milestones",
    title: "Requerimientos por hito o funcionalidad",
  },
  {
    key: "nonFunctionalRequirements",
    title: "Requerimientos no funcionales",
  },
  ...LEGACY_DOCUMENT_SECTION_DEFINITIONS.slice(7),
] as const;
const HISTORICAL_DOCUMENT_SECTION_DEFINITIONS_WITH_SOLUTION = [
  ...HISTORICAL_DOCUMENT_SECTION_DEFINITIONS.slice(0, 4),
  DOCUMENT_SECTION_DEFINITIONS.find(
    (section) => section.key === "solutionProposal",
  )!,
  ...HISTORICAL_DOCUMENT_SECTION_DEFINITIONS.slice(4),
] as const;
import {
  type DocumentProjectAccess,
  DocumentsProjectsAccessClient,
} from "./projects-access.client";
import { DocumentsSourcesAccessClient } from "./sources-access.client";
import { validateDocumentSectionContent } from "./documents-input";

export interface DocumentsActorContext {
  actor: AuthenticatedUser;
  accessToken: string;
  correlationId: string;
}

const PENDING = "[PENDIENTE POR DEFINIR]";
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

/**
 * Guarda de tipo para objetos JSON. `Array.isArray` no descarta bien las
 * uniones con arreglos de solo lectura, así que el estrechamiento se declara.
 */
function isJsonObject(
  value: DocumentJsonValue | undefined,
): value is { readonly [key: string]: DocumentJsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toIso(value: Date): string {
  return value.toISOString();
}

function parseJson(value: string): DocumentJsonValue {
  try {
    return JSON.parse(value) as DocumentJsonValue;
  } catch {
    // Un JSON corrupto en BD no debe filtrarse como un 500 con SyntaxError.
    throw new ConflictException(
      "El documento contiene datos almacenados con formato JSON inválido.",
    );
  }
}

const PROTOTYPE_PLACEHOLDERS = [
  "[pendiente por definir]",
  "pendiente de definición",
  "pendiente de definicion",
];
const PROTOTYPE_NOT_REQUESTED_PREFIX = "prototipo no solicitado en esta generación";

function collectText(value: DocumentJsonValue, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectText(item, out));
  else if (isJsonObject(value))
    Object.values(value).forEach((item) => collectText(item, out));
}

/** Un prototipo existe solo si hay texto real en visualFormat o en solutionProposal.prototypeMarkdown. */
export function hasPrototypeContent(content: DocumentJsonValue): boolean {
  const texts: string[] = [];
  collectText(content, texts);
  return texts.some((text) => {
    const normalized = text.trim().toLowerCase();
    return (
      normalized.length > 0 &&
      !PROTOTYPE_PLACEHOLDERS.includes(normalized) &&
      !normalized.startsWith(PROTOTYPE_NOT_REQUESTED_PREFIX)
    );
  });
}

/** Compatibilidad con versiones históricas: el prototipo quedó en solutionProposal.prototypeMarkdown. */
export function hasSolutionPrototypeMarkdown(
  content: DocumentJsonValue,
): boolean {
  return (
    isJsonObject(content) &&
    typeof content["prototypeMarkdown"] === "string" &&
    hasPrototypeContent(content["prototypeMarkdown"])
  );
}

function serialize(value: DocumentJsonValue): string {
  return JSON.stringify(value);
}

function appliedTemplateIncludesScrum(
  template: AppliedDocumentTemplateEntity,
): boolean {
  const definition = parseJson(template.definitionJson);
  if (
    !definition ||
    typeof definition !== "object" ||
    Array.isArray(definition)
  ) {
    return false;
  }
  const scrum = (definition as Readonly<Record<string, DocumentJsonValue>>)
    .scrum;
  return Boolean(
    scrum &&
    typeof scrum === "object" &&
    !Array.isArray(scrum) &&
    (scrum as Readonly<Record<string, DocumentJsonValue>>).enabled === true,
  );
}

/**
 * Devuelve la estructura de una plantilla propia (dinámica) o `null` cuando la
 * plantilla aplicada es canónica (o su definición no es interpretable), caso en
 * el que rige el layout canónico/histórico de siempre.
 */
function customTemplateLayout(
  template: AppliedDocumentTemplateEntity | null | undefined,
): ResolvedTemplateLayout["sections"] | null {
  if (!template) return null;
  try {
    const layout = resolveTemplateLayout(
      parseJson(template.definitionJson),
      appliedTemplateIncludesScrum(template),
    );
    return layout.custom ? layout.sections : null;
  } catch (error) {
    if (error instanceof ConflictException) return null;
    throw error;
  }
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
    includesScrum: appliedTemplateIncludesScrum(template),
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

interface ResolvedTemplateLayout {
  readonly sections: readonly { readonly key: string; readonly title: string }[];
  /** `true` cuando la plantilla es propia (estructura dinámica) y no canónica. */
  readonly custom: boolean;
}

function assertCanonicalTemplate(
  definition: DocumentJsonValue,
  includesScrum: boolean,
): readonly { readonly key: string; readonly title: string }[] {
  return resolveTemplateLayout(definition, includesScrum).sections;
}

function resolveTemplateLayout(
  definition: DocumentJsonValue,
  includesScrum: boolean,
): ResolvedTemplateLayout {
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
  const expected = getDocumentSectionDefinitions(includesScrum);
  const legacyBaseExpected = LEGACY_DOCUMENT_SECTION_DEFINITIONS;
  const legacyExpected = includesScrum
    ? [...legacyBaseExpected, DOCUMENT_SCRUM_SECTION_DEFINITION]
    : legacyBaseExpected;
  const historicalExpected = includesScrum
    ? [
        ...HISTORICAL_DOCUMENT_SECTION_DEFINITIONS,
        DOCUMENT_SCRUM_SECTION_DEFINITION,
      ]
    : HISTORICAL_DOCUMENT_SECTION_DEFINITIONS;
  const historicalWithSolutionExpected = includesScrum
    ? [
        ...HISTORICAL_DOCUMENT_SECTION_DEFINITIONS_WITH_SOLUTION,
        DOCUMENT_SCRUM_SECTION_DEFINITION,
      ]
    : HISTORICAL_DOCUMENT_SECTION_DEFINITIONS_WITH_SOLUTION;

  if (!Array.isArray(order) || !Array.isArray(sections)) {
    throw new ConflictException(
      "La plantilla aplicada no contiene un orden de secciones válido.",
    );
  }

  const compatibleDefinitions = [
    expected,
    legacyExpected,
    historicalExpected,
    historicalWithSolutionExpected,
  ];
  const definitionExpected = compatibleDefinitions.find(
    (candidate) =>
      sections.length === candidate.length &&
      order.length === candidate.length &&
      candidate.every((expectedSection, index) => {
        const rawSection = sections[index];
        if (
          order[index] !== expectedSection.key ||
          !rawSection ||
          typeof rawSection !== "object" ||
          Array.isArray(rawSection)
        ) {
          return false;
        }
        const section = rawSection as Readonly<
          Record<string, DocumentJsonValue>
        >;
        /*
         * La clave y sectionOrder protegen la estructura. El título y el
         * número visual de plantillas publicadas antiguas se normalizan con
         * `expected` al crear el documento, en lugar de bloquear el proceso.
         */
        return section.key === expectedSection.key;
      }),
  );

  if (!definitionExpected) {
    if (
      sections.length < 1 ||
      sections.length > 50 ||
      order.length !== sections.length
    ) {
      throw new ConflictException(
        "Cantidad de secciones de plantilla inválida.",
      );
    }
    const scrum = record.scrum;
    if (!isJsonObject(scrum) || scrum.enabled !== includesScrum) {
      throw new ConflictException(
        "Configuración Scrum inconsistente en la plantilla.",
      );
    }
    const keys = new Set<string>();
    const customSections = sections.map((raw, index) => {
      if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        typeof raw.key !== "string" ||
        !/^[a-z][a-zA-Z0-9]{2,63}$/.test(raw.key) ||
        keys.has(raw.key) ||
        raw.order !== index + 1 ||
        order[index] !== raw.key ||
        typeof raw.title !== "string" ||
        !raw.title.trim() ||
        typeof raw.required !== "boolean" ||
        typeof raw.guidance !== "string"
      ) {
        throw new ConflictException(
          "Estructura dinámica de plantilla inválida.",
        );
      }
      keys.add(raw.key);
      return { key: raw.key, title: raw.title.trim() };
    });
    return { sections: customSections, custom: true };
  }

  if (includesScrum) {
    const rawScrum = sections.at(-1);
    if (
      !rawScrum ||
      typeof rawScrum !== "object" ||
      Array.isArray(rawScrum) ||
      order.at(-1) !== DOCUMENT_SCRUM_SECTION_DEFINITION.key
    ) {
      throw new ConflictException(
        "La plantilla Scrum no conserva el punto 15 esperado.",
      );
    }
    const scrum = rawScrum as Readonly<Record<string, DocumentJsonValue>>;
    if (
      scrum.key !== DOCUMENT_SCRUM_SECTION_DEFINITION.key ||
      scrum.title !== DOCUMENT_SCRUM_SECTION_DEFINITION.title
    ) {
      throw new ConflictException(
        "La plantilla Scrum modifica el punto 15 canónico.",
      );
    }
  }

  return { sections: expected, custom: false };
}

function initialContent(
  key: string,
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
        status: "BORRADOR",
      };
    case "objectives":
      return {
        general: PENDING,
        qualitative: [PENDING],
        quantitative: [PENDING],
      };
    case "problemDescription":
      return { currentState: PENDING, operationalImpact: [PENDING] };
    case "scope":
      return {
        included: [PENDING],
        excluded: [PENDING],
        involvedSystems: [PENDING],
        kpis: Array.from({ length: 3 }, () => ({
          name: PENDING,
          relatedObjective: PENDING,
          measurement: PENDING,
          target: PENDING,
        })),
      };
    case "solutionProposal":
      return {
        objective: PENDING,
        description: PENDING,
        involvedElements: [PENDING],
        flowAlignment: {
          currentState: PENDING,
          evaluation: PENDING,
          expectedResult: PENDING,
        },
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
      return {
        functionalRequirements: [],
        nonFunctionalRequirements: [],
      };
    case "backlogStructure":
      return { epics: [] };
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
      return {
        approvals: [
          {
            name: actor.displayName,
            position: "Responsable del documento",
            responsibility: "Elaboración",
            approvalMoment: "Al elaborar la versión documental",
            status: "REGISTRADO",
          },
          {
            name: PENDING,
            position: "Líder del responsable",
            responsibility: "Revisión",
            approvalMoment: "Durante la validación del documento",
            status: "PENDIENTE",
          },
          {
            name: PENDING,
            position: "Solicitante o líder de la persona solicitante",
            responsibility: "Aprobación",
            approvalMoment: "Al finalizar la revisión",
            status: "PENDIENTE",
          },
        ],
        changeControl: [],
      };
    case "writingRules":
    case "visualFormat":
    case "automationInstruction":
      return PENDING;
    case "scrumPlan":
      return {
        cadenceDays: 15,
        scheduleBasis: "RELATIVE_DAY",
        note: "Propuesta inicial sujeta a validación y estimación del equipo Scrum.",
        sprints: [],
      };
    default:
      return PENDING;
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

function documentRecord(
  value: DocumentJsonValue | undefined,
): Readonly<Record<string, DocumentJsonValue>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Readonly<Record<string, DocumentJsonValue>>;
}

function documentRecords(value: DocumentJsonValue | undefined) {
  return Array.isArray(value)
    ? value
        .map((item) => documentRecord(item))
        .filter(
          (item): item is Readonly<Record<string, DocumentJsonValue>> =>
            item !== null,
        )
    : [];
}

/*
 * POINT_6_7_INDEPENDENT_BACKEND
 *
 * Los documentos 4.1.0 se reconocen por HU-P/functionalRequirementCodes.
 * En ese modelo no existe sincronización automática entre Punto 6 y Punto 7.
 * Los documentos legacy 4.0.0 siguen usando las funciones de proyección de
 * abajo para mantener compatibilidad histórica.
 */
function isIndependentPlanningBacklog(content: DocumentJsonValue): boolean {
  const backlog = documentRecord(content);
  if (!backlog) return false;
  return documentRecords(backlog.epics).some((epic) =>
    documentRecords(epic.features).some((feature) =>
      documentRecords(feature.userStories).some((story) => {
        const code = String(story.code ?? "")
          .trim()
          .toUpperCase();
        return (
          code.startsWith("HU-P-") ||
          Array.isArray(story.functionalRequirementCodes)
        );
      }),
    ),
  );
}

/*
 * PUNTO_7_REQUIREMENTS_SYNCHRONIZATION
 *
 * Punto 7 es la fuente canónica de:
 * - Epic
 * - Feature
 * - código HU
 * - título HU
 * - descripción estructural HU
 * - Tasks
 *
 * Punto 6 conserva la propiedad del detalle funcional.
 *
 * Esta proyección mantiene las dos secciones consistentes
 * incluso para exportación, API y consumidores que no usan
 * la composición visual del frontend.
 */
export function synchronizeBacklogStructureWithRequirements(
  backlogContent: DocumentJsonValue,
  requirementsContent: DocumentJsonValue,
): DocumentJsonValue {
  const backlog = documentRecord(backlogContent);

  const requirements = documentRecord(requirementsContent);

  if (!backlog || !requirements) {
    return requirementsContent;
  }

  if (isIndependentPlanningBacklog(backlogContent)) {
    return requirementsContent;
  }

  const existingStories = documentRecords(requirements.functionalRequirements);

  const existingByCode = new Map(
    existingStories
      .map((story) => [String(story.code ?? "").toUpperCase(), story] as const)
      .filter(([code]) => Boolean(code)),
  );

  const functionalRequirements = documentRecords(backlog.epics).flatMap(
    (epic) =>
      documentRecords(epic.features).flatMap((feature) =>
        documentRecords(feature.userStories).map((story) => {
          const code = String(story.code ?? "").toUpperCase();

          const existing = existingByCode.get(code);

          const next: Record<string, DocumentJsonValue> = {
            /*
             * Para nuevas HU usamos como base
             * el backlog. Para HU existentes,
             * preservamos primero el contenido
             * funcional humano del Punto 6.
             */
            ...story,
            ...(existing ?? {}),

            /*
             * Luego imponemos los campos cuya
             * propiedad corresponde al Punto 7.
             */
            code: story.code ?? "",
            title: story.title ?? PENDING,
            description: story.description ?? PENDING,

            requirementType: "USER_STORY",

            epicCode: epic.code ?? "",
            epicTitle: epic.title ?? PENDING,

            featureCode: feature.code ?? "",
            featureTitle: feature.title ?? PENDING,

            /*
             * HITO != FEATURE.
             *
             * Punto 7 conserva la estructura del proyecto,
             * pero no puede sobrescribir la clasificación
             * funcional por Hitos del Punto 6.
             */
            milestone: existing?.milestone ?? null,

            functionality: existing?.functionality ?? null,

            milestoneDescription: existing?.milestoneDescription ?? null,
          };

          /*
           * category / measure / target son
           * exclusivos de RNF.
           */
          delete next.category;
          delete next.measure;
          delete next.target;

          return next;
        }),
      ),
  );

  return {
    ...requirements,

    functionalRequirements,

    nonFunctionalRequirements: requirements.nonFunctionalRequirements ?? [],
  };
}

/*
 * PUNTO_6_BACKLOG_SYNCHRONIZATION
 *
 * Punto 7 conserva la propiedad de la estructura:
 * Epic -> Feature -> HU -> Task.
 *
 * Punto 6 puede modificar exclusivamente el detalle de
 * negocio de una HU.
 */
export function synchronizeRequirementStoriesWithBacklog(
  requirementsContent: DocumentJsonValue,
  backlogContent: DocumentJsonValue,
): DocumentJsonValue {
  const requirements = documentRecord(requirementsContent);

  const backlog = documentRecord(backlogContent);

  if (!requirements || !backlog) {
    return backlogContent;
  }

  if (isIndependentPlanningBacklog(backlogContent)) {
    return backlogContent;
  }

  const functionalStories = documentRecords(
    requirements.functionalRequirements,
  ).filter(
    (story) =>
      typeof story.code === "string" &&
      typeof story.role === "string" &&
      typeof story.want === "string" &&
      typeof story.benefit === "string",
  );

  if (functionalStories.length === 0) {
    return backlogContent;
  }

  const replacements = new Map(
    functionalStories.map((story) => [String(story.code).toUpperCase(), story]),
  );

  const synchronizedCodes = new Set<string>();

  /*
   * Solo estos campos pueden sincronizarse desde Punto 6.
   *
   * No se copian:
   * - Epic
   * - Feature
   * - código HU
   * - tareas
   * - dependencias
   */
  const editableKeys = [
    /*
     * Punto 6 define funcionalmente la HU.
     * La jerarquía y el código siguen protegidos.
     */
    "title",
    "description",
    "role",
    "want",
    "benefit",
    "context",
    "premises",
    "impactedSystems",
    "fields",
    "acceptanceCriteria",
  ] as const;

  const epics = documentRecords(backlog.epics).map((epic) => ({
    ...epic,

    features: documentRecords(epic.features).map((feature) => {
      const featureCode = String(feature.code ?? "");

      return {
        ...feature,

        userStories: documentRecords(feature.userStories).map((story) => {
          const code = String(story.code ?? "").toUpperCase();

          const replacement = replacements.get(code);

          if (!replacement) {
            return story;
          }

          const requestedFeatureCode = String(
            replacement.featureCode ?? featureCode,
          );

          if (requestedFeatureCode !== featureCode) {
            throw new ConflictException(
              `${code} pertenece a ${featureCode}. ` +
                "Cambia la jerarquía desde el " +
                "punto 7 · Esquema.",
            );
          }

          synchronizedCodes.add(code);

          const next: Record<string, DocumentJsonValue> = { ...story };

          for (const key of editableKeys) {
            if (replacement[key] !== undefined) {
              next[key] = replacement[key];
            }
          }

          /*
           * story.tasks permanece intacto porque
           * partimos de ...story.
           */
          return next;
        }),
      };
    }),
  }));

  /*
   * Punto 6 no puede crear una HU que no exista
   * estructuralmente en Punto 7.
   */
  for (const code of replacements.keys()) {
    if (!synchronizedCodes.has(code)) {
      throw new ConflictException(
        `${code} no existe en el punto 7 · Esquema. ` +
          "Crea o reorganiza la HU desde el esquema " +
          "antes de editarla en Requerimientos.",
      );
    }
  }

  const synchronized = {
    ...backlog,
    epics,
  } as DocumentJsonValue;

  /*
   * La sincronización pasa por la misma validación
   * estructural del editor del Punto 7.
   */
  validateDocumentSectionContent("backlogStructure", synchronized);

  return synchronized;
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
      await this.addHistory(manager, {
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
    this.requireActive(document);
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
      if (!lockedDocument) throw new NotFoundException("El documento no existe.");
      this.requireActive(lockedDocument);
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
      await this.addHistory(manager, {
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
    this.requireActive(document);
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

      if (result.affected !== 1) this.stale();

      await this.addHistory(manager, {
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
    this.requireActive(document);
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
      const clonedSections = sourceSections.map((section) => {
        const id = randomUUID();
        sectionIds.set(section.key, id);
        const content = parseJson(section.contentJson);
        const updatedContent =
          section.key === "header"
            ? this.headerForNewVersion(content, nextVersion)
            : section.key === "approvalsAndChangeControl"
              ? this.approvalsForNewVersion(content, context.actor)
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
            initialContent(
              "solutionProposal",
              access.project,
              context.actor,
              nextVersion,
              now,
            ),
          ),
          templateControlled: false,
        });
        clonedSections.sort(
          (left, right) => left.orderIndex - right.orderIndex,
        );
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
            Math.max(...clonedSections.map((section) => section.orderIndex)) +
            1,
          contentJson: serialize(
            initialContent(
              DOCUMENT_SCRUM_SECTION_DEFINITION.key,
              access.project,
              context.actor,
              nextVersion,
              now,
            ),
          ),
          templateControlled: false,
        });
      }

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
    this.requireActive(document);
    const version = await this.requireVersion(documentId, versionNumber);
    this.requireCurrent(document, version);
    const editableStatus = this.requireEditable(version);
    const section = await this.sections.findOneBy({
      documentVersionId: version.id,
      key: sectionKey,
    });

    if (!section) throw new NotFoundException("La sección no existe.");
    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      await this.lockEditableVersion(
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

      await this.synchronizePlanningSections(
        manager,
        version.id,
        sectionKey,
        request.content,
      );

      await this.touchDocument(
        manager,
        document,
        context.actor.id,
        now,
        editableStatus,
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
    const editableStatus = this.requireEditable(version);

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
      await this.lockEditableVersion(
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
      await manager.save(DocumentRequirementEntity, requirementRows, {
        chunk: SQL_SERVER_WRITE_BATCH_SIZE,
      });

      const criterionRows = request.requirements.flatMap((requirement, index) =>
        requirement.acceptanceCriteria.map((criterion) => ({
          id: randomUUID(),
          requirementId: requirementRows[index]?.id as string,
          description: criterion.description,
          orderIndex: criterion.order,
        })),
      );
      await manager.save(AcceptanceCriterionEntity, criterionRows, {
        chunk: SQL_SERVER_WRITE_BATCH_SIZE,
      });
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
        { chunk: SQL_SERVER_WRITE_BATCH_SIZE },
      );
      await this.touchDocument(
        manager,
        document,
        context.actor.id,
        now,
        editableStatus,
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
    // `documents.ai.apply` habilita la acción, pero no sustituye la
    // autorización de edición de una persona. La excepción es la identidad de
    // carga de trabajo del servicio de IA (rol SERVICE, nunca un usuario): aplica
    // el borrador de una solicitud cuya autorización ya se validó al crearla, y
    // así funciona igual en todos los proyectos.
    if (
      !(
        access.role === "SERVICE" &&
        context.actor.permissions.includes("documents.ai.apply")
      )
    ) {
      requireEdit(access);
    }
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
      await this.lockEditableVersion(
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
      const requestedSectionKeys = request.sections.map(
        (section) => section.key,
      );
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
      const preparedSections = request.sections.map((sectionInput) => {
        const section = sectionsByKey.get(sectionInput.key);
        if (!section) {
          throw new ConflictException(
            "El borrador de IA no coincide con las secciones del documento.",
          );
        }
        const content = this.contentFromAi(
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
      for (const prepared of preparedSections) {
        await manager.update(DocumentSectionEntity, prepared.section.id, {
          contentJson: serialize(prepared.content),
        });
      }
      // Punto 6 / Punto 7 en la misma transacción, como en updateSection.
      for (const prepared of preparedSections) {
        await this.synchronizePlanningSections(
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
      await manager.save(DocumentRequirementEntity, requirementRows, {
        chunk: SQL_SERVER_WRITE_BATCH_SIZE,
      });
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
        { chunk: SQL_SERVER_WRITE_BATCH_SIZE },
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
    from: readonly DocumentStatus[],
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
      if (result.affected !== 1) this.stale();

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
            this.headerForTransition(parseJson(header.contentJson), to),
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
            this.approvalsForTransition(
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
      await this.touchDocument(manager, document, context.actor.id, now, to);
      await this.addHistory(manager, {
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

  private headerForNewVersion(
    content: DocumentJsonValue,
    version: string,
  ): DocumentJsonValue {
    if (!content || typeof content !== "object" || Array.isArray(content))
      return content;
    const normalized = { ...content } as Record<string, DocumentJsonValue>;
    delete normalized.preparedBy;
    delete normalized.reviewedBy;
    delete normalized.approvedBy;
    return {
      ...normalized,
      documentVersion: version,
      status: "BORRADOR",
    };
  }

  private headerForTransition(
    content: DocumentJsonValue,
    status: DocumentStatus,
  ): DocumentJsonValue {
    if (!content || typeof content !== "object" || Array.isArray(content))
      return content;
    const visibleStatus =
      status === "IN_REVIEW"
        ? "EN VALIDACIÓN"
        : status === "APPROVED"
          ? "APROBADO"
          : status === "CHANGES_REQUESTED"
            ? "CORRECCIONES SOLICITADAS"
            : status === "REJECTED"
              ? "BORRADOR"
              : "BORRADOR";
    const normalized = { ...content } as Record<string, DocumentJsonValue>;
    delete normalized.preparedBy;
    delete normalized.reviewedBy;
    delete normalized.approvedBy;
    return { ...normalized, status: visibleStatus };
  }

  private contentFromAi(
    key: string,
    current: DocumentJsonValue,
    proposed: DocumentJsonValue,
  ): DocumentJsonValue {
    if (key === "header") {
      if (!proposed || typeof proposed !== "object" || Array.isArray(proposed))
        return proposed;
      const normalized = { ...proposed } as Record<string, DocumentJsonValue>;
      delete normalized.preparedBy;
      delete normalized.reviewedBy;
      delete normalized.approvedBy;
      return normalized;
    }
    if (key !== "approvalsAndChangeControl") return proposed;
    const proposedRecord = documentRecord(proposed);
    const currentRecord = documentRecord(current);
    const proposedApprovals = documentRecords(proposedRecord?.approvals);
    const currentApprovals = documentRecords(currentRecord?.approvals);
    const proposedByResponsibility = new Map(
      proposedApprovals.map((approval) => [
        String(approval.responsibility),
        approval,
      ]),
    );
    const currentByResponsibility = new Map(
      currentApprovals.map((approval) => [
        String(approval.responsibility),
        approval,
      ]),
    );
    const responsibilities = ["Elaboración", "Revisión", "Aprobación"];
    return {
      approvals: responsibilities.map((responsibility) => {
        const currentApproval = currentByResponsibility.get(responsibility);
        const proposedApproval = proposedByResponsibility.get(responsibility);
        const workflowHasDecided =
          currentApproval && currentApproval.status !== "PENDIENTE";
        return {
          ...(proposedApproval ?? currentApproval ?? {}),
          ...(responsibility === "Elaboración" || workflowHasDecided
            ? (currentApproval ?? {})
            : {}),
          responsibility,
        };
      }),
      // Generar o regenerar contenido no constituye un cambio aprobado.
      changeControl: [],
    };
  }

  private approvalsForNewVersion(
    content: DocumentJsonValue,
    actor: AuthenticatedUser,
  ): DocumentJsonValue {
    const record = documentRecord(content);
    const approvals = documentRecords(record?.approvals);
    const byResponsibility = new Map(
      approvals.map((approval) => [String(approval.responsibility), approval]),
    );
    return {
      approvals: [
        {
          ...(byResponsibility.get("Elaboración") ?? {}),
          name: actor.displayName,
          position: "Responsable del documento",
          responsibility: "Elaboración",
          approvalMoment: "Al elaborar la versión documental",
          status: "REGISTRADO",
        },
        {
          ...(byResponsibility.get("Revisión") ?? {}),
          responsibility: "Revisión",
          approvalMoment: "Durante la validación del documento",
          status: "PENDIENTE",
        },
        {
          ...(byResponsibility.get("Aprobación") ?? {}),
          responsibility: "Aprobación",
          approvalMoment: "Al finalizar la revisión",
          status: "PENDIENTE",
        },
      ],
      changeControl: [],
    };
  }

  private approvalsForTransition(
    content: DocumentJsonValue,
    status: DocumentStatus,
    actor: AuthenticatedUser,
    version: DocumentVersionEntity,
    now: Date,
  ): DocumentJsonValue {
    const record = documentRecord(content);
    const approvals = documentRecords(record?.approvals).map((item) => ({
      ...item,
    }));
    const update = (
      responsibility: "Revisión" | "Aprobación",
      changes: Readonly<Record<string, DocumentJsonValue>>,
    ) => {
      const index = approvals.findIndex(
        (approval) => approval.responsibility === responsibility,
      );
      if (index >= 0) {
        approvals[index] = { ...approvals[index], ...changes };
        return;
      }
      approvals.push({
        name: PENDING,
        position:
          responsibility === "Revisión"
            ? "Líder del responsable"
            : "Solicitante o líder de la persona solicitante",
        responsibility,
        approvalMoment:
          responsibility === "Revisión"
            ? "Durante la validación del documento"
            : "Al finalizar la revisión",
        status: "PENDIENTE",
        ...changes,
      });
    };

    if (status === "IN_REVIEW") {
      const elaborationIndex = approvals.findIndex(
        (approval) => approval.responsibility === "Elaboración",
      );
      const elaboration = {
        name: actor.displayName,
        position: "Responsable del documento",
        responsibility: "Elaboración",
        approvalMoment: now.toISOString(),
        status: "REGISTRADO",
      };
      if (elaborationIndex >= 0) {
        approvals[elaborationIndex] = {
          ...approvals[elaborationIndex],
          ...elaboration,
        };
      } else {
        approvals.push(elaboration);
      }
      update("Revisión", {
        approvalMoment: "Durante la validación del documento",
        status: "EN REVISIÓN",
      });
    } else if (status === "CHANGES_REQUESTED") {
      update("Revisión", {
        name: actor.displayName,
        position: "Líder del responsable",
        approvalMoment: now.toISOString(),
        status: "CAMBIOS SOLICITADOS",
      });
    } else if (status === "APPROVED") {
      update("Aprobación", {
        name: actor.displayName,
        position: "Solicitante o líder de la persona solicitante",
        approvalMoment: now.toISOString(),
        status: "APROBADO",
      });
    }

    return {
      approvals: ["Elaboración", "Revisión", "Aprobación"].map(
        (responsibility) =>
          approvals.find(
            (approval) => approval.responsibility === responsibility,
          ) ?? {
            name: PENDING,
            position: PENDING,
            responsibility,
            approvalMoment: PENDING,
            status: "PENDIENTE",
          },
      ),
      changeControl:
        status === "APPROVED" && version.versionNumber > 1
          ? [
              {
                version: version.version,
                date: now.toISOString().slice(0, 10),
                description: version.changeSummary,
                approvedBy: actor.displayName,
              },
            ]
          : (record?.changeControl ?? []),
    };
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

  private requireEditable(
    version: DocumentVersionEntity,
  ): "DRAFT" | "CHANGES_REQUESTED" {
    if (version.status !== "DRAFT" && version.status !== "CHANGES_REQUESTED") {
      throw new ConflictException(
        "Solo una versión en borrador o con correcciones solicitadas puede editarse.",
      );
    }
    return version.status;
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

    return {
      id: document.id,
      projectId: document.projectId,
      title: document.title,
      status: document.status,
      revision: document.revision,
      currentVersionNumber: document.currentVersionNumber,
      currentVersion: version.version,
      hasPrototype,
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
    /*
     * Plantillas propias: el layout válido es el de la plantilla efectiva del
     * documento, no el canónico fijo. Los documentos canónicos conservan la
     * validación histórica de abajo.
     */
    const customLayout = customTemplateLayout(appliedTemplate);
    if (customLayout) {
      if (sections.length !== customLayout.length) {
        throw new ConflictException(
          `El documento debe contener ${customLayout.length} secciones según su plantilla aplicada.`,
        );
      }
      customLayout.forEach((expectedSection, index) => {
        const actual = sections[index];
        if (
          !actual ||
          actual.key !== expectedSection.key ||
          actual.orderIndex !== index + 1
        ) {
          throw new ConflictException(
            "El documento no conserva el orden de las secciones configuradas.",
          );
        }
      });
      return;
    }
    const includesScrum = sections.at(-1)?.key === "scrumPlan";
    const withoutScrum = includesScrum ? sections.slice(0, -1) : sections;
    const hasSolutionProposal = withoutScrum.some(
      (section) => section.key === "solutionProposal",
    );
    const historicalLayout = withoutScrum.some(
      (section) => section.key === "nonFunctionalRequirements",
    );
    const baseDefinitions = historicalLayout
      ? hasSolutionProposal
        ? HISTORICAL_DOCUMENT_SECTION_DEFINITIONS_WITH_SOLUTION
        : HISTORICAL_DOCUMENT_SECTION_DEFINITIONS
      : hasSolutionProposal
        ? DOCUMENT_SECTION_DEFINITIONS
        : LEGACY_DOCUMENT_SECTION_DEFINITIONS;
    const expected = includesScrum
      ? [...baseDefinitions, DOCUMENT_SCRUM_SECTION_DEFINITION]
      : baseDefinitions;

    if (
      sections.length !== baseDefinitions.length &&
      sections.length !== baseDefinitions.length + 1
    ) {
      throw new ConflictException(
        `El documento debe contener ${baseDefinitions.length} secciones base${includesScrum ? " y Plan Scrum" : ""}.`,
      );
    }

    expected.forEach((expectedSection, index) => {
      const actual = sections[index];
      if (
        !actual ||
        actual.key !== expectedSection.key ||
        actual.orderIndex !== index + 1
      ) {
        throw new ConflictException(
          "El documento no conserva el orden de las secciones configuradas.",
        );
      }
    });
  }

  /*
   * Sincroniza Punto 6 / Punto 7 en la misma transacción que escribe la
   * sección editada. Lo comparten `updateSection` y `applyAiDraft`.
   */
  private async synchronizePlanningSections(
    manager: DataSource["manager"],
    versionId: string,
    sectionKey: string,
    content: DocumentJsonValue,
  ): Promise<void> {
    /*
     * PUNTO_7_SYNC_IN_TRANSACTION
     *
     * Al editar el esquema proyectamos de inmediato
     * Epic / Feature / HU sobre el Punto 6.
     *
     * La operación usa la misma transacción:
     * nunca queda un Punto 6 actualizado y un Punto 7
     * anterior, ni al contrario.
     */
    if (sectionKey === "backlogStructure") {
      const requirementsSection = await manager.findOne(
        DocumentSectionEntity,
        {
          where: {
            documentVersionId: versionId,
            key: "milestones",
          },
        },
      );

      if (requirementsSection) {
        const currentRequirements = parseJson(
          requirementsSection.contentJson,
        );

        const synchronizedRequirements =
          synchronizeBacklogStructureWithRequirements(
            content,
            currentRequirements,
          );

        if (
          serialize(synchronizedRequirements) !==
          serialize(currentRequirements)
        ) {
          await manager.update(
            DocumentSectionEntity,
            requirementsSection.id,
            {
              contentJson: serialize(synchronizedRequirements),
            },
          );
        }
      }
    }

    /*
     * Al editar Punto 6 sincronizamos solamente
     * el detalle de las HU con Punto 7.
     */
    if (sectionKey === "milestones") {
      const backlogSection = await manager.findOne(DocumentSectionEntity, {
        where: {
          documentVersionId: versionId,
          key: "backlogStructure",
        },
      });

      if (backlogSection) {
        const currentBacklog = parseJson(backlogSection.contentJson);

        const synchronizedBacklog = synchronizeRequirementStoriesWithBacklog(
          content,
          currentBacklog,
        );

        if (serialize(synchronizedBacklog) !== serialize(currentBacklog)) {
          await manager.update(DocumentSectionEntity, backlogSection.id, {
            contentJson: serialize(synchronizedBacklog),
          });
        }
      }
    }
  }

  private async lockEditableVersion(
    manager: DataSource["manager"],
    version: DocumentVersionEntity,
    expectedRevision: number,
    actorUserId: string,
    now: Date,
    status: "DRAFT" | "CHANGES_REQUESTED",
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
      .andWhere("Status = :status", { status })
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
