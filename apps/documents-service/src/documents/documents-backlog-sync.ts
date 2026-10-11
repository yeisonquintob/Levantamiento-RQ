import { ConflictException } from "@nestjs/common";
import type { EntityManager } from "typeorm";

import type { DocumentJsonValue } from "@levantamiento-rq/shared-contracts";

import { DocumentSectionEntity } from "./document.entities";
import { PENDING } from "./documents-constants";
import { validateDocumentSectionContent } from "./documents-input";
import {
  documentRecord,
  documentRecords,
  parseJson,
  serialize,
} from "./documents-json";

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

/*
 * Sincroniza Punto 6 / Punto 7 en la misma transacción que escribe la
 * sección editada. Lo comparten `updateSection` y `applyAiDraft`.
 */
export async function synchronizePlanningSections(
  manager: EntityManager,
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
    const requirementsSection = await manager.findOne(DocumentSectionEntity, {
      where: {
        documentVersionId: versionId,
        key: "milestones",
      },
    });

    if (requirementsSection) {
      const currentRequirements = parseJson(requirementsSection.contentJson);

      const synchronizedRequirements =
        synchronizeBacklogStructureWithRequirements(
          content,
          currentRequirements,
        );

      if (
        serialize(synchronizedRequirements) !== serialize(currentRequirements)
      ) {
        await manager.update(DocumentSectionEntity, requirementsSection.id, {
          contentJson: serialize(synchronizedRequirements),
        });
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
