import {
  type AiAnalysisDraft,
  type AiPlanningBacklogUserStoryV41,
} from "@levantamiento-rq/shared-contracts";

/** Reúne todas las referencias de evidencia para validarlas contra la solicitud. */
export function collectAiDraftSourceIds(
  draft: AiAnalysisDraft,
): readonly string[] {
  const ids = draft.requirements.flatMap(
    (requirement) => requirement.sourceIds,
  );
  if (draft.schemaVersion === "1.0.0") return [...new Set(ids)];
  if (draft.schemaVersion === "2.0.0") {
    ids.push(...draft.structuredAnalysis.processFlow.sourceIds);
  } else {
    ids.push(
      ...draft.structuredAnalysis.processFlows.asIs.sourceIds,
      ...draft.structuredAnalysis.processFlows.toBe.sourceIds,
      ...draft.structuredAnalysis.entityRelationship.sourceIds,
    );
  }
  if (draft.schemaVersion === "4.1.0") {
    for (const story of draft.structuredAnalysis.functionalUserStories) {
      ids.push(...story.sourceIds);
      for (const field of story.fields) ids.push(...field.sourceIds);
      for (const criterion of story.acceptanceCriteria)
        ids.push(...criterion.sourceIds);
    }
  } else {
    for (const feature of draft.structuredAnalysis.features)
      ids.push(...feature.sourceIds);
    for (const story of draft.structuredAnalysis.userStories) {
      ids.push(...story.sourceIds);
      for (const field of story.fields) ids.push(...field.sourceIds);
      for (const criterion of story.acceptanceCriteria)
        ids.push(...criterion.sourceIds);
    }
  }
  for (const scenario of draft.structuredAnalysis.tests)
    ids.push(...scenario.sourceIds);
  if (draft.schemaVersion === "4.0.0" || draft.schemaVersion === "4.1.0") {
    for (const epic of draft.structuredAnalysis.backlogStructure.epics) {
      ids.push(...epic.sourceIds);
      for (const feature of epic.features) {
        ids.push(...feature.sourceIds);
        for (const story of feature.userStories) {
          ids.push(...story.sourceIds);
          for (const task of story.tasks) ids.push(...task.sourceIds);
        }
      }
    }

    if (draft.schemaVersion === "4.1.0") {
      const pending =
        draft.structuredAnalysis.backlogStructure.pendingAssignments;
      if (pending) {
        const collectStory = (story: AiPlanningBacklogUserStoryV41) => {
          ids.push(...story.sourceIds);
          for (const task of story.tasks) ids.push(...task.sourceIds);
        };

        for (const envelope of pending.features) {
          ids.push(...envelope.item.sourceIds);
          for (const story of envelope.item.userStories) collectStory(story);
        }
        for (const envelope of pending.userStories) collectStory(envelope.item);
        for (const envelope of pending.tasks)
          ids.push(...envelope.item.sourceIds);
      }
    }
  }
  if (draft.structuredAnalysis.scrumPlan) {
    ids.push(...draft.structuredAnalysis.scrumPlan.sourceIds);
  }
  for (const contradiction of draft.contradictions) {
    ids.push(...contradiction.sourceIdsA, ...contradiction.sourceIdsB);
  }
  return [...new Set(ids)];
}

/**
 * Canonicaliza referencias de evidencia devueltas por el proveedor.
 *
 * Con una única fuente seleccionada no existe ambigüedad: si el modelo altera
 * accidentalmente un carácter del UUID, la evidencia solo puede corresponder a
 * esa fuente. Con varias fuentes, cualquier referencia desconocida se conserva
 * para que la validación de pertenencia la rechace explícitamente.
 */
export function reconcileAiDraftSourceIds(
  draft: AiAnalysisDraft,
  allowedSourceIds: readonly string[],
): AiAnalysisDraft {
  const canonicalByLowerCase = new Map(
    allowedSourceIds.map((sourceId) => [sourceId.toLowerCase(), sourceId]),
  );
  const singleSourceId =
    canonicalByLowerCase.size === 1
      ? canonicalByLowerCase.values().next().value
      : undefined;
  const reconciled = structuredClone(draft) as unknown;

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;

    for (const [key, child] of Object.entries(value)) {
      if (
        (key === "sourceIds" || key === "sourceIdsA" || key === "sourceIdsB") &&
        Array.isArray(child)
      ) {
        (value as Record<string, unknown>)[key] = child.map((sourceId) => {
          if (typeof sourceId !== "string") return sourceId;
          return (
            canonicalByLowerCase.get(sourceId.toLowerCase()) ??
            singleSourceId ??
            sourceId
          );
        });
      } else {
        visit(child);
      }
    }
  };

  visit(reconciled);
  return reconciled as AiAnalysisDraft;
}
