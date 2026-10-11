import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import {
  PENDING,
  type JsonRecord,
  recordValue,
  recordList,
  stringValue,
  displayText,
} from "./shared";

/*
 * PUNTO_6_ACCEPTANCE_CRITERIA_COMPATIBILITY
 *
 * Versiones anteriores del Punto 6 pueden conservar criterios como:
 *
 * "DADO ..., CUANDO ..., ENTONCES ..."
 *
 * El backlog canónico usa objetos:
 * { code, given, when, then, sourceIds }.
 *
 * Esta normalización permite:
 * - mostrar criterios históricos;
 * - editarlos con StoryEditor;
 * - guardarlos posteriormente en la forma canónica;
 * - no perder información ya generada.
 */
export function normalizeStoryAcceptanceCriteria(
  value: DocumentJsonValue | undefined,
  storyCode = "HU",
): JsonRecord[] {
  if (!Array.isArray(value)) return [];

  const normalizedStoryCode =
    storyCode
      .replace(/^HU-/iu, "")
      .replace(/[^A-Z0-9-]/giu, "")
      .toUpperCase() || "HU";

  return value.flatMap((item, index) => {
    const record = recordValue(item);

    if (record) {
      return [record];
    }

    if (typeof item !== "string" || !item.trim()) {
      return [];
    }

    const source = item.trim();

    const match = source.match(
      /^\s*DADO\s+([\s\S]*?)\s*,?\s+CUANDO\s+([\s\S]*?)\s*,?\s+ENTONCES\s+([\s\S]*?)\s*$/iu,
    );

    return [
      {
        code: `CA-${normalizedStoryCode}-` + String(index + 1).padStart(3, "0"),

        /*
         * Si el texto sí tiene DADO/CUANDO/ENTONCES,
         * recuperamos las tres partes.
         *
         * Si es un criterio histórico libre, conservamos
         * literalmente la información y marcamos únicamente
         * las partes inexistentes como pendientes.
         */
        given: match?.[1]?.trim() || source,
        when: match?.[2]?.trim() || PENDING,
        then: match?.[3]?.trim() || PENDING,

        sourceIds: [],
      },
    ];
  });
}

export function composeRequirementsContent(
  value: DocumentJsonValue,
  backlogValue: DocumentJsonValue | null | undefined,
): DocumentJsonValue {
  const current = recordValue(value);
  const backlog = recordValue(backlogValue);

  if (!current || !backlog) return value;

  /*
   * POINT_6_7_INDEPENDENT_FRONTEND
   *
   * En el contrato 4.1 las HU-F del Punto 6 y las HU-P del Punto 7 son
   * colecciones distintas. La compatibilidad legacy de abajo solo aplica a
   * documentos 4.0, donde ambos puntos compartían el mismo código de HU.
   *
   * Sin este corte, la vista reemplazaba HU-F persistidas y completas por las
   * HU-P de planificación. El síntoma visible era exactamente: un Hito "Sin
   * código", campos COMO/QUIERO/PARA vacíos y criterios desaparecidos.
   */
  const independentPlanningBacklog = recordList(backlog.epics).some((epic) =>
    recordList(epic.features).some((feature) =>
      recordList(feature.userStories).some(
        (story) =>
          stringValue(story.code).trim().toUpperCase().startsWith("HU-P-") ||
          Array.isArray(story.functionalRequirementCodes),
      ),
    ),
  );

  if (independentPlanningBacklog) return value;

  const epics = recordList(backlog.epics);
  if (epics.length === 0) return value;

  const currentFunctional = recordList(current.functionalRequirements);

  const currentByCode = new Map(
    currentFunctional
      .map((item) => [stringValue(item.code).toUpperCase(), item] as const)
      .filter(([code]) => Boolean(code)),
  );

  const functionalRequirements = epics.flatMap((epic) =>
    recordList(epic.features).flatMap((feature) =>
      recordList(feature.userStories).map((story) => {
        const existing = currentByCode.get(
          stringValue(story.code).toUpperCase(),
        );

        /*
         * Si el usuario ya empezó a editar una HU completa,
         * se conserva su edición local.
         *
         * Si el Punto 6 todavía tiene la representación antigua,
         * se recupera la HU completa desde Punto 7.
         */
        const existingIsRich = Boolean(
          existing &&
          stringValue(existing.role) &&
          stringValue(existing.want) &&
          stringValue(existing.benefit),
        );

        const businessStory = existingIsRich
          ? { ...story, ...existing }
          : { ...story };

        const existingCriteria = normalizeStoryAcceptanceCriteria(
          existing?.acceptanceCriteria,
          stringValue(story.code),
        );

        const backlogCriteria = normalizeStoryAcceptanceCriteria(
          story.acceptanceCriteria,
          stringValue(story.code),
        );

        const result: JsonRecord = {
          ...businessStory,

          /*
           * PUNTO_6_BUSINESS_STORY_OWNERSHIP
           *
           * Punto 7 conserva:
           * - código HU;
           * - Epic padre;
           * - Feature padre;
           * - Tasks.
           *
           * Punto 6 conserva la definición funcional completa
           * de la HU, incluido título y descripción.
           */
          code: stringValue(story.code),

          epicCode: stringValue(epic.code),
          epicTitle: stringValue(epic.title),

          featureCode: stringValue(feature.code),
          featureTitle: stringValue(feature.title),

          requirementType: "USER_STORY",

          acceptanceCriteria:
            existingCriteria.length > 0 ? existingCriteria : backlogCriteria,

          /*
           * PUNTO_6_VIEW_PRESERVES_PERSISTED_MILESTONES
           *
           * La vista normal debe mostrar exactamente los mismos
           * Hitos persistidos que el modo Editar.
           *
           * No eliminamos ni reinterpretamos Hitos existentes.
           * Las nuevas generaciones ya tienen la regla HITO != FEATURE.
           */
          milestone: existing?.milestone ?? null,

          functionality: existing?.functionality ?? null,

          milestoneDescription: existing?.milestoneDescription ?? null,
        };

        /*
         * Estos campos son exclusivos del modelo RNF.
         * No deben aparecer ni generar pendientes en una HU.
         */
        delete result.category;
        delete result.measure;
        delete result.target;

        return result;
      }),
    ),
  );

  return {
    ...current,
    functionalRequirements,

    /*
     * Los RNF NO se mezclan con las HU.
     * Continúan exactamente en su pestaña.
     */
    nonFunctionalRequirements: current.nonFunctionalRequirements ?? [],
  };
}

/*
 * PUNTO_6_MILESTONE_GROUPS
 *
 * Persistencia:
 * functionalRequirements continúa siendo la colección de HU.
 *
 * Presentación:
 * Hito -> HU completa -> criterios.
 *
 * La estructura Epic -> Feature -> HU -> Task pertenece al Punto 7.
 */
type FunctionalMilestoneStory = {
  story: JsonRecord;
  index: number;
};

export type FunctionalMilestoneGroup = {
  key: string;
  code: string;
  name: string;
  description: string;
  stories: FunctionalMilestoneStory[];
};

function isPendingFunctionalStory(story: JsonRecord): boolean {
  const status = stringValue(story.assignmentStatus).trim().toUpperCase();

  return (
    status === "PENDING_ASSIGNMENT" || !stringValue(story.milestone).trim()
  );
}

export function pendingFunctionalStories(
  value: DocumentJsonValue | undefined,
): FunctionalMilestoneStory[] {
  return recordList(value)
    .map((story, index) => ({ story, index }))
    .filter(({ story }) => isPendingFunctionalStory(story));
}

export function functionalMilestoneGroups(
  value: DocumentJsonValue | undefined,
): FunctionalMilestoneGroup[] {
  const stories = recordList(value);
  const groups = new Map<string, FunctionalMilestoneGroup>();

  stories.forEach((story, index) => {
    if (isPendingFunctionalStory(story)) return;

    const code = stringValue(story.milestone).trim();
    const name = stringValue(story.functionality).trim();
    const description = stringValue(story.milestoneDescription).trim();
    const key = code.toUpperCase();

    const existing = groups.get(key);
    if (existing) {
      existing.stories.push({ story, index });
      if (!existing.name && name) existing.name = name;
      if (!existing.description && description) {
        existing.description = description;
      }
      return;
    }

    groups.set(key, {
      key,
      code,
      name,
      description,
      stories: [{ story, index }],
    });
  });

  const milestoneNumber = (value: string) => {
    const match = /^H-([0-9]+)$/iu.exec(value);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  };

  return [...groups.values()].sort(
    (left, right) => milestoneNumber(left.code) - milestoneNumber(right.code),
  );
}

export interface ConfirmedManualMilestoneOption {
  code: string;
  title: string;
  description: string;
}

/*
 * POINT_6_MANUAL_PARENT_ASSIGNMENT_V4_7_6
 *
 * Toda Epic visible ofrece una raíz Hito canónica. AI_SUGGESTED conserva su
 * carácter de propuesta, pero puede organizar Punto 6 sin atribuir una
 * confirmación humana inexistente.
 */
export function confirmedManualMilestoneOptions(
  backlogValue: DocumentJsonValue | null | undefined,
): ConfirmedManualMilestoneOption[] {
  const backlog = recordValue(backlogValue);
  if (!backlog) return [];

  return recordList(backlog.epics).map((epic, index) => ({
    code: `H-${String(index + 1).padStart(3, "0")}`,
    title: stringValue(epic.title),
    description: stringValue(epic.description),
  }));
}

/*
 * POINT_7_INTEGRATED_EPIC_MILESTONE_VIEW_V4_7_7
 *
 * Cierre visual y de diagnóstico de la raíz común:
 * - Punto 6: Hito -> HU-F -> CA-F.
 * - Punto 7: Epic -> Feature -> HU-P -> Task.
 *
 * Epic/Hito comparten únicamente la raíz y la posición canónica.
 * HU-F y HU-P continúan siendo conceptos distintos.
 */
export interface CommonEpicMilestoneRootSummary {
  milestoneCode: string;
  epicCode: string;
  title: string;
  description: string;
  functionalStoryCount: number;
  featureCount: number;
  planningStoryCount: number;
  taskCount: number;
}

function integratedFunctionalStories(
  value: DocumentJsonValue | null | undefined,
): JsonRecord[] {
  const record = recordValue(value);
  return record ? recordList(record.functionalRequirements) : recordList(value);
}

function integratedTitleKey(value: DocumentJsonValue | undefined): string {
  return stringValue(value)
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

export function commonEpicMilestoneRoots(
  requirementsValue: DocumentJsonValue | null | undefined,
  backlogValue: DocumentJsonValue | null | undefined,
): CommonEpicMilestoneRootSummary[] {
  const backlog = recordValue(backlogValue);
  if (!backlog) return [];

  const functionalStories = integratedFunctionalStories(requirementsValue);

  return recordList(backlog.epics).map((epic, index) => {
    const milestoneCode = `H-${String(index + 1).padStart(3, "0")}`;
    const features = recordList(epic.features);
    const planningStories = features.flatMap((feature) =>
      recordList(feature.userStories),
    );
    const tasks = planningStories.flatMap((story) => recordList(story.tasks));

    const functionalStoryCount = functionalStories.filter((story) => {
      const status =
        stringValue(story.assignmentStatus).trim().toUpperCase() ||
        (stringValue(story.milestone).trim()
          ? "ASSIGNED"
          : "PENDING_ASSIGNMENT");

      return (
        status === "ASSIGNED" &&
        stringValue(story.milestone).trim().toUpperCase() === milestoneCode
      );
    }).length;

    return {
      milestoneCode,
      epicCode:
        stringValue(epic.code).trim() ||
        `EP-${String(index + 1).padStart(3, "0")}`,
      title: stringValue(epic.title),
      description: stringValue(epic.description),
      functionalStoryCount,
      featureCount: features.length,
      planningStoryCount: planningStories.length,
      taskCount: tasks.length,
    };
  });
}

export function functionalMilestoneGroupsWithRoots(
  value: DocumentJsonValue | undefined,
  backlogValue: DocumentJsonValue | null | undefined,
): FunctionalMilestoneGroup[] {
  const groups = functionalMilestoneGroups(value);
  const groupByCode = new Map(
    groups.map((group) => [group.code.trim().toUpperCase(), group] as const),
  );

  for (const root of commonEpicMilestoneRoots(value, backlogValue)) {
    const code = root.milestoneCode.trim().toUpperCase();
    const representedByLegacyGroup = groups.some(
      (group) =>
        integratedTitleKey(group.name) === integratedTitleKey(root.title),
    );
    if (groupByCode.has(code) || representedByLegacyGroup) continue;

    const group: FunctionalMilestoneGroup = {
      key: code,
      code: root.milestoneCode,
      name: root.title,
      description: root.description,
      stories: [],
    };
    groups.push(group);
    groupByCode.set(code, group);
  }

  return groups.sort((left, right) =>
    left.code.localeCompare(right.code, "es", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

/*
 * POINT_7_INTEGRATED_VALIDATION_V4_7_7
 *
 * Diagnóstico cruzado sin reasignaciones automáticas:
 * - una HU-F asignada debe usar un Hito de la raíz canónica y su mismo título;
 * - una HU-F pendiente no puede conservar datos de Hito;
 * - un work item pendiente no puede existir simultáneamente dentro del árbol.
 */
export function integratedPoint6Point7Issues(
  requirementsValue: DocumentJsonValue | null | undefined,
  backlogValue: DocumentJsonValue | null | undefined,
): string[] {
  const backlog = recordValue(backlogValue);
  if (!backlog) return [];

  const issues: string[] = [];
  const functionalStories = integratedFunctionalStories(requirementsValue);
  const roots = commonEpicMilestoneRoots(requirementsValue, backlogValue);
  const rootByMilestone = new Map(
    roots.map((root) => [root.milestoneCode, root] as const),
  );

  for (const story of functionalStories) {
    const code = displayText(stringValue(story.code)) || "HU-F sin código";
    const storyStatus =
      stringValue(story.assignmentStatus).trim().toUpperCase() ||
      (stringValue(story.milestone).trim() ? "ASSIGNED" : "PENDING_ASSIGNMENT");
    const milestone = stringValue(story.milestone).trim().toUpperCase();

    if (storyStatus === "PENDING_ASSIGNMENT") {
      if (
        milestone ||
        stringValue(story.functionality).trim() ||
        stringValue(story.milestoneDescription).trim()
      ) {
        issues.push(
          `${code}: PENDING_ASSIGNMENT no puede conservar datos de Hito.`,
        );
      }
      continue;
    }

    if (storyStatus !== "ASSIGNED") continue;

    const root = rootByMilestone.get(milestone);
    if (!root) {
      issues.push(
        `${code}: ${milestone || "Hito vacío"} no pertenece a la raíz Epic/Hito disponible.`,
      );
      continue;
    }

    if (
      integratedTitleKey(story.functionality) !== integratedTitleKey(root.title)
    ) {
      issues.push(
        `${code}: el nombre del Hito debe coincidir con ${root.epicCode} · ${root.title}.`,
      );
    }
  }

  const epics = recordList(backlog.epics);
  const features = epics.flatMap((epic) => recordList(epic.features));
  const planningStories = features.flatMap((feature) =>
    recordList(feature.userStories),
  );
  const tasks = planningStories.flatMap((story) => recordList(story.tasks));
  const canonicalCodes = new Set(
    [...features, ...planningStories, ...tasks]
      .map((item) => stringValue(item.code).trim().toUpperCase())
      .filter(Boolean),
  );

  const pendingRoot = recordValue(backlog.pendingAssignments);
  for (const [kind, label] of [
    ["features", "Feature"],
    ["userStories", "HU-P"],
    ["tasks", "Task"],
  ] as const) {
    for (const envelope of recordList(pendingRoot?.[kind])) {
      const item = recordValue(envelope.item);
      const code = stringValue(item?.code).trim().toUpperCase();
      if (code && canonicalCodes.has(code)) {
        issues.push(
          `${label} ${code}: no puede existir a la vez en el árbol y en PENDING_ASSIGNMENT.`,
        );
      }
    }
  }

  return [...new Set(issues)];
}

export function assignPendingFunctionalStoryToMilestone(
  value: DocumentJsonValue | undefined,
  backlogValue: DocumentJsonValue | null | undefined,
  storyCode: string,
  milestoneCode: string,
): DocumentJsonValue {
  const milestone = confirmedManualMilestoneOptions(backlogValue).find(
    (candidate) => candidate.code === milestoneCode.trim().toUpperCase(),
  );
  if (!milestone) return value ?? [];

  return recordList(value).map((story) => {
    if (
      stringValue(story.code).trim().toUpperCase() !==
        storyCode.trim().toUpperCase() ||
      !isPendingFunctionalStory(story)
    ) {
      return story;
    }

    return {
      ...story,
      assignmentStatus: "ASSIGNED",
      milestone: milestone.code,
      functionality: milestone.title,
      milestoneDescription: milestone.description || null,
      assignmentObservation: null,
    };
  });
}
