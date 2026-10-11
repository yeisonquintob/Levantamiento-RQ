import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import {
  PENDING,
  type JsonRecord,
  recordValue,
  recordList,
  stringValue,
} from "./shared";

export function nextBacklogCode(
  items: readonly JsonRecord[],
  prefix: string,
): string {
  const maximum = items.reduce((currentMaximum, item) => {
    const code = stringValue(item.code);

    const match = code.match(new RegExp(`^${prefix}-(\\d+)$`, "u"));

    return Math.max(currentMaximum, match ? Number(match[1]) : 0);
  }, 0);

  return `${prefix}-` + String(maximum + 1).padStart(3, "0");
}

export type PendingPlanningAssignmentKind =
  "features" | "userStories" | "tasks";

export function planningPendingRecord(root: JsonRecord): JsonRecord {
  return (
    recordValue(root.pendingAssignments) ?? {
      features: [],
      userStories: [],
      tasks: [],
    }
  );
}

function planningItemFromEnvelope(
  envelope: JsonRecord | undefined,
): JsonRecord | null {
  return envelope ? recordValue(envelope.item) : null;
}

function replacePendingPlanningCollection(
  root: JsonRecord,
  kind: PendingPlanningAssignmentKind,
  nextItems: readonly JsonRecord[],
): JsonRecord {
  const pending = planningPendingRecord(root);
  return {
    ...root,
    pendingAssignments: {
      ...pending,
      features:
        kind === "features" ? [...nextItems] : recordList(pending.features),
      userStories:
        kind === "userStories"
          ? [...nextItems]
          : recordList(pending.userStories),
      tasks: kind === "tasks" ? [...nextItems] : recordList(pending.tasks),
    },
  };
}

/*
 * POINT_6_MANUAL_PLANNING_ASSIGNMENT_V4_7_6
 *
 * Estas funciones realizan únicamente una decisión humana explícita:
 * mover un work item pendiente al padre seleccionado o crear el padre
 * inmediato solicitado. Nunca infieren relaciones ni convierten HU-P en HU-F.
 */
export function assignPendingPlanningItem(
  value: DocumentJsonValue,
  kind: PendingPlanningAssignmentKind,
  pendingIndex: number,
  parentCode: string,
): DocumentJsonValue {
  const root = recordValue(value);
  if (!root) return value;

  const pending = planningPendingRecord(root);
  const collection = recordList(pending[kind]);
  const envelope = collection[pendingIndex];
  const item = planningItemFromEnvelope(envelope);
  if (!item) return value;

  const normalizedParent = parentCode.trim().toUpperCase();
  let assigned = false;
  let epics = recordList(root.epics);

  if (kind === "features") {
    epics = epics.map((epic) => {
      if (stringValue(epic.code).trim().toUpperCase() !== normalizedParent) {
        return epic;
      }
      assigned = true;
      return {
        ...epic,
        features: [...recordList(epic.features), item],
      };
    });
  } else if (kind === "userStories") {
    epics = epics.map((epic) => ({
      ...epic,
      features: recordList(epic.features).map((feature) => {
        if (
          stringValue(feature.code).trim().toUpperCase() !== normalizedParent
        ) {
          return feature;
        }
        assigned = true;
        return {
          ...feature,
          userStories: [...recordList(feature.userStories), item],
        };
      }),
    }));
  } else {
    epics = epics.map((epic) => ({
      ...epic,
      features: recordList(epic.features).map((feature) => ({
        ...feature,
        userStories: recordList(feature.userStories).map((story) => {
          if (
            stringValue(story.code).trim().toUpperCase() !== normalizedParent
          ) {
            return story;
          }
          assigned = true;
          return {
            ...story,
            tasks: [...recordList(story.tasks), item],
          };
        }),
      })),
    }));
  }

  if (!assigned) return value;

  const nextRoot = replacePendingPlanningCollection(
    {
      ...root,
      epics,
    },
    kind,
    collection.filter((_, index) => index !== pendingIndex),
  );

  return nextRoot;
}

export function createParentForPendingPlanningItem(
  value: DocumentJsonValue,
  kind: PendingPlanningAssignmentKind,
  pendingIndex: number,
  containerCode: string | null,
  parentTitle: string,
): DocumentJsonValue {
  const root = recordValue(value);
  if (!root) return value;

  const title = parentTitle.trim();
  if (title.length < 2) return value;

  const pending = planningPendingRecord(root);
  const collection = recordList(pending[kind]);
  const envelope = collection[pendingIndex];
  const item = planningItemFromEnvelope(envelope);
  if (!item) return value;

  const epics = recordList(root.epics);
  const normalizedContainer = containerCode?.trim().toUpperCase() ?? "";

  if (kind === "features") {
    const code = nextBacklogCode(epics, "EP");
    const nextRoot = replacePendingPlanningCollection(
      {
        ...root,
        structureStatus:
          stringValue(root.structureStatus).trim().toUpperCase() ===
            "AI_SUGGESTED" && epics.length === 0
            ? "CONFIRMED"
            : root.structureStatus,
        epics: [
          ...epics,
          {
            code,
            title,
            description: PENDING,
            sourceNumber: null,
            sourceIds: [],
            features: [item],
          },
        ],
      },
      kind,
      collection.filter((_, index) => index !== pendingIndex),
    );
    return nextRoot;
  }

  if (kind === "userStories") {
    const allFeatures = [
      ...epics.flatMap((epic) => recordList(epic.features)),
      ...recordList(pending.features).flatMap((candidate) => {
        const pendingFeature = planningItemFromEnvelope(candidate);
        return pendingFeature ? [pendingFeature] : [];
      }),
    ];
    const code = nextBacklogCode(allFeatures, "FE");
    let created = false;
    const nextEpics = epics.map((epic) => {
      if (stringValue(epic.code).trim().toUpperCase() !== normalizedContainer) {
        return epic;
      }
      created = true;
      return {
        ...epic,
        features: [
          ...recordList(epic.features),
          {
            code,
            title,
            description: PENDING,
            sourceNumber: null,
            sourceIds: [],
            userStories: [item],
          },
        ],
      };
    });
    if (!created) return value;

    return replacePendingPlanningCollection(
      {
        ...root,
        epics: nextEpics,
      },
      kind,
      collection.filter((_, index) => index !== pendingIndex),
    );
  }

  const allStories = [
    ...epics.flatMap((epic) =>
      recordList(epic.features).flatMap((feature) =>
        recordList(feature.userStories),
      ),
    ),
    ...recordList(pending.features).flatMap((candidate) => {
      const pendingFeature = planningItemFromEnvelope(candidate);
      return pendingFeature ? recordList(pendingFeature.userStories) : [];
    }),
    ...recordList(pending.userStories).flatMap((candidate) => {
      const pendingStory = planningItemFromEnvelope(candidate);
      return pendingStory ? [pendingStory] : [];
    }),
  ];
  const code = nextBacklogCode(allStories, "HU-P");
  let created = false;
  const nextEpics = epics.map((epic) => ({
    ...epic,
    features: recordList(epic.features).map((feature) => {
      if (
        stringValue(feature.code).trim().toUpperCase() !== normalizedContainer
      ) {
        return feature;
      }
      created = true;
      return {
        ...feature,
        userStories: [
          ...recordList(feature.userStories),
          {
            code,
            title,
            description: PENDING,
            sourceNumber: null,
            functionalRequirementCodes: [],
            sourceIds: [],
            tasks: [item],
          },
        ],
      };
    }),
  }));
  if (!created) return value;

  return replacePendingPlanningCollection(
    {
      ...root,
      epics: nextEpics,
    },
    kind,
    collection.filter((_, index) => index !== pendingIndex),
  );
}
