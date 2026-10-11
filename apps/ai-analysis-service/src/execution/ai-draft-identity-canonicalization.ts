import {
  type AiFunctionalUserStoryV41,
  type AiPlanningBacklogStructureV41,
  type AiScrumPlan,
  type AiTestScenario,
} from "@levantamiento-rq/shared-contracts";
import { pushReconciliationWarning } from "./ai-draft-parse-primitives";
import {
  canonicalReferenceCode,
  canonicalFunctionalStoryReference,
  canonicalFunctionalCriterionReference,
  canonicalPlanningStoryReference,
} from "./ai-draft-code-aliases";

interface CanonicalCodeOccurrence {
  originalCode: string;
  canonicalCode: string;
  ownerIndex: number;
  itemIndex: number;
}

function canonicalCodeAtV490(
  occurrences: readonly CanonicalCodeOccurrence[],
  index: number,
): string {
  const occurrence = occurrences[index];
  if (!occurrence) {
    throw new Error(
      "La canonicalización técnica perdió la correspondencia de un nodo.",
    );
  }
  return occurrence.canonicalCode;
}

function canonicalizeTechnicalCodeOccurrencesV490(
  codes: readonly { code: string; ownerIndex: number }[],
  prefix: string,
  warningContext: (occurrence: CanonicalCodeOccurrence) => string,
  warnings: string[],
): CanonicalCodeOccurrence[] {
  const reserved = new Set(codes.map(({ code }) => code));
  const occupied = new Set<string>();
  let nextNumber = 1;

  const nextFreeCode = (): string => {
    while (true) {
      const candidate = `${prefix}-${String(nextNumber).padStart(3, "0")}`;
      nextNumber += 1;
      if (!reserved.has(candidate) && !occupied.has(candidate))
        return candidate;
    }
  };

  return codes.map(({ code, ownerIndex }, itemIndex) => {
    const canonicalCode = occupied.has(code) ? nextFreeCode() : code;
    occupied.add(canonicalCode);
    const occurrence = {
      originalCode: code,
      canonicalCode,
      ownerIndex,
      itemIndex,
    };
    if (canonicalCode !== code) {
      pushReconciliationWarning(
        warnings,
        `${warningContext(occurrence)}: ${code} duplicado fue canonicalizado como ${canonicalCode}.`,
      );
    }
    return occurrence;
  });
}

function canonicalizeSequentialAliasesV490(
  rawCodes: readonly string[],
  label: string,
  warnings: string[],
): CanonicalCodeOccurrence[] {
  const codes = rawCodes.map((code) => code.trim().toUpperCase());
  const reserved = new Set(codes);
  const occupied = new Set<string>();
  return codes.map((code, itemIndex) => {
    let canonicalCode = code;
    if (occupied.has(code)) {
      const match = code.match(/^([A-Z][A-Z0-9-]*?)-?(\d+)$/u);
      if (!match?.[1]) {
        throw new Error(
          `${label} contiene el código duplicado no reparable ${code}.`,
        );
      }
      const prefix = match[1].replace(/-$/u, "");
      let next = 1;
      do {
        canonicalCode = `${prefix}-${String(next).padStart(3, "0")}`;
        next += 1;
      } while (reserved.has(canonicalCode) || occupied.has(canonicalCode));
      pushReconciliationWarning(
        warnings,
        `${label}: ${code} duplicado fue canonicalizado como ${canonicalCode}.`,
      );
    }
    occupied.add(canonicalCode);
    return {
      originalCode: code,
      canonicalCode,
      ownerIndex: 0,
      itemIndex,
    };
  });
}

/*
 * V4_9_0_SCRUM_TASK_IDENTITY_CANONICALIZATION
 *
 * El código propuesto por la IA no identifica al nodo. La identidad de una
 * Task Scrum incluye Sprint, posición y contenido. Se preservan todos los
 * nodos y se repara únicamente el identificador técnico repetido.
 */
export function canonicalizeScrumTaskCodesV490(
  plan: AiScrumPlan | null,
  warnings: string[],
): AiScrumPlan | null {
  if (!plan) return null;

  const flattened = plan.sprints.flatMap((sprint, sprintIndex) =>
    sprint.tasks.map((task) => ({ code: task.code, ownerIndex: sprintIndex })),
  );
  const occurrences = canonicalizeTechnicalCodeOccurrencesV490(
    flattened,
    "T",
    (occurrence) =>
      `Scrum/${plan.sprints[occurrence.ownerIndex]?.code ?? `Sprint ${occurrence.ownerIndex + 1}`}`,
    warnings,
  );
  let flatIndex = 0;

  return {
    ...plan,
    sprints: plan.sprints.map((sprint, sprintIndex) => ({
      ...sprint,
      tasks: sprint.tasks.map((task) => {
        const occurrence = occurrences[flatIndex++];
        if (!occurrence) {
          throw new Error("La canonicalización Scrum perdió una Task.");
        }
        const dependencyCodes = task.dependencyCodes.map((rawCode) => {
          const code = canonicalReferenceCode(rawCode, "TASK");
          const candidates = occurrences.filter(
            (candidate) =>
              candidate.originalCode === code &&
              candidate.itemIndex !== occurrence.itemIndex,
          );
          if (candidates.length <= 1) {
            return candidates[0]?.canonicalCode ?? code;
          }
          const sameSprint = candidates.filter(
            (candidate) => candidate.ownerIndex === sprintIndex,
          );
          if (sameSprint.length === 1)
            return sameSprint[0]?.canonicalCode ?? code;
          if (sameSprint.length > 1) {
            throw new Error(
              `${sprint.code}/${occurrence.canonicalCode} contiene la referencia ambigua ${code}; no se eligió un destino arbitrario.`,
            );
          }
          const previousSprints = candidates.filter(
            (candidate) => candidate.ownerIndex < sprintIndex,
          );
          if (previousSprints.length === 1) {
            return previousSprints[0]?.canonicalCode ?? code;
          }
          throw new Error(
            `${sprint.code}/${occurrence.canonicalCode} contiene la referencia ambigua ${code}; no se eligió un destino arbitrario.`,
          );
        });
        return {
          ...task,
          code: occurrence.canonicalCode,
          dependencyCodes: [...new Set(dependencyCodes)],
        };
      }),
    })),
  };
}

function resolveCanonicalOccurrenceV490(
  rawCode: string,
  occurrences: readonly CanonicalCodeOccurrence[],
  preferred: (occurrence: CanonicalCodeOccurrence) => boolean,
  context: string,
): string {
  const candidates = occurrences.filter(
    (occurrence) => occurrence.originalCode === rawCode,
  );
  if (candidates.length <= 1) return candidates[0]?.canonicalCode ?? rawCode;
  const contextual = candidates.filter(preferred);
  if (contextual.length === 1) return contextual[0]?.canonicalCode ?? rawCode;
  throw new Error(
    `${context} contiene la referencia ambigua ${rawCode}; no se eligió un destino arbitrario.`,
  );
}

function sharesEvidenceV490(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const rightSet = new Set(right);
  return left.some((sourceId) => rightSet.has(sourceId));
}

/* Canonicaliza los espacios técnicos independientes de Punto 6 y Punto 7. */
export function canonicalizeV41IdentityGraphV490(
  functionalUserStories: readonly AiFunctionalUserStoryV41[],
  backlogStructure: AiPlanningBacklogStructureV41,
  tests: readonly AiTestScenario[],
  scrumPlan: AiScrumPlan | null,
  warnings: string[],
): {
  functionalUserStories: AiFunctionalUserStoryV41[];
  backlogStructure: AiPlanningBacklogStructureV41;
  tests: AiTestScenario[];
  scrumPlan: AiScrumPlan | null;
} {
  const functionalOccurrences = canonicalizeTechnicalCodeOccurrencesV490(
    functionalUserStories.map((story) => ({ code: story.code, ownerIndex: 0 })),
    "HU-F",
    () => "Punto 6/HU-F",
    warnings,
  );
  const criterionRows = functionalUserStories.flatMap((story, storyIndex) =>
    story.acceptanceCriteria.map((criterion) => ({
      code: criterion.code,
      ownerIndex: storyIndex,
    })),
  );
  const reservedCriterionCodes = new Set(criterionRows.map(({ code }) => code));
  const occupiedCriterionCodes = new Set<string>();
  const nextCriterionByStory = new Map<number, number>();
  const criterionOccurrences = criterionRows.map(
    ({ code, ownerIndex }, itemIndex): CanonicalCodeOccurrence => {
      let canonicalCode = code;
      if (occupiedCriterionCodes.has(code)) {
        const storySuffix =
          functionalOccurrences[ownerIndex]?.canonicalCode.replace(
            /^HU-F-/u,
            "",
          ) ?? String(ownerIndex + 1).padStart(3, "0");
        let next = nextCriterionByStory.get(ownerIndex) ?? 1;
        do {
          canonicalCode = `CA-F-${storySuffix}-${String(next).padStart(2, "0")}`;
          next += 1;
        } while (
          reservedCriterionCodes.has(canonicalCode) ||
          occupiedCriterionCodes.has(canonicalCode)
        );
        nextCriterionByStory.set(ownerIndex, next);
      }
      occupiedCriterionCodes.add(canonicalCode);
      const occurrence = {
        originalCode: code,
        canonicalCode,
        ownerIndex,
        itemIndex,
      };
      if (canonicalCode !== code) {
        pushReconciliationWarning(
          warnings,
          `Punto 6/${functionalOccurrences[ownerIndex]?.canonicalCode ?? "HU-F"}/CA-F: ${code} duplicado fue canonicalizado como ${canonicalCode}.`,
        );
      }
      return occurrence;
    },
  );

  const epics = backlogStructure.epics;
  const featureRows = epics.flatMap((epic, epicIndex) =>
    epic.features.map((feature) => ({
      code: feature.code,
      ownerIndex: epicIndex,
    })),
  );
  let planningFeatureIndex = 0;
  let planningStoryIndex = 0;
  const storyRows: { code: string; ownerIndex: number }[] = [];
  const taskRows: { code: string; ownerIndex: number }[] = [];
  for (const epic of epics) {
    for (const feature of epic.features) {
      for (const story of feature.userStories) {
        storyRows.push({ code: story.code, ownerIndex: planningFeatureIndex });
        for (const task of story.tasks) {
          taskRows.push({ code: task.code, ownerIndex: planningStoryIndex });
        }
        planningStoryIndex += 1;
      }
      planningFeatureIndex += 1;
    }
  }
  const epicOccurrences = canonicalizeTechnicalCodeOccurrencesV490(
    epics.map((epic) => ({ code: epic.code, ownerIndex: 0 })),
    "EP",
    () => "Punto 7/Epic",
    warnings,
  );
  const featureOccurrences = canonicalizeTechnicalCodeOccurrencesV490(
    featureRows,
    "FE",
    (occurrence) =>
      `Punto 7/${epicOccurrences[occurrence.ownerIndex]?.canonicalCode ?? "Epic"}/Feature`,
    warnings,
  );
  const storyOccurrences = canonicalizeTechnicalCodeOccurrencesV490(
    storyRows,
    "HU-P",
    () => "Punto 7/HU-P",
    warnings,
  );
  const taskOccurrences = canonicalizeTechnicalCodeOccurrencesV490(
    taskRows,
    "T",
    () => "Punto 7/Task",
    warnings,
  );

  let criterionIndex = 0;
  const canonicalFunctionalStories = functionalUserStories.map(
    (story, storyIndex) => ({
      ...story,
      code: canonicalCodeAtV490(functionalOccurrences, storyIndex),
      acceptanceCriteria: story.acceptanceCriteria.map((criterion) => ({
        ...criterion,
        code: canonicalCodeAtV490(criterionOccurrences, criterionIndex++),
      })),
    }),
  );

  let featureIndex = 0;
  let storyIndex = 0;
  let taskIndex = 0;
  const canonicalBacklog: AiPlanningBacklogStructureV41 = {
    ...backlogStructure,
    epics: epics.map((epic, epicIndex) => ({
      ...epic,
      code: canonicalCodeAtV490(epicOccurrences, epicIndex),
      features: epic.features.map((feature) => {
        const currentFeatureIndex = featureIndex++;
        return {
          ...feature,
          code: canonicalCodeAtV490(featureOccurrences, currentFeatureIndex),
          userStories: feature.userStories.map((story) => {
            const currentStoryIndex = storyIndex++;
            const canonicalFunctionalRequirementCodes =
              story.functionalRequirementCodes.map((rawCode) =>
                resolveCanonicalOccurrenceV490(
                  canonicalFunctionalStoryReference(rawCode),
                  functionalOccurrences,
                  (candidate) =>
                    sharesEvidenceV490(
                      story.sourceIds,
                      functionalUserStories[candidate.itemIndex]?.sourceIds ??
                        [],
                    ),
                  `${story.code}.functionalRequirementCodes`,
                ),
              );
            return {
              ...story,
              code: canonicalCodeAtV490(storyOccurrences, currentStoryIndex),
              functionalRequirementCodes: [
                ...new Set(canonicalFunctionalRequirementCodes),
              ],
              tasks: story.tasks.map((task) => {
                const currentTaskIndex = taskIndex++;
                const dependencyCodes = task.dependencyCodes.map((rawCode) =>
                  resolveCanonicalOccurrenceV490(
                    canonicalReferenceCode(rawCode, "TASK"),
                    taskOccurrences,
                    (candidate) => candidate.ownerIndex === currentStoryIndex,
                    `${task.code}.dependencyCodes`,
                  ),
                );
                return {
                  ...task,
                  code: canonicalCodeAtV490(taskOccurrences, currentTaskIndex),
                  dependencyCodes: [...new Set(dependencyCodes)],
                };
              }),
            };
          }),
        };
      }),
    })),
  };

  const testOccurrences = canonicalizeSequentialAliasesV490(
    tests.map((scenario) => scenario.code),
    "Pruebas",
    warnings,
  );
  const canonicalTests = tests.map((scenario, scenarioIndex) => {
    const userStoryCodes = scenario.userStoryCodes.map((rawCode) =>
      resolveCanonicalOccurrenceV490(
        canonicalFunctionalStoryReference(rawCode),
        functionalOccurrences,
        (candidate) =>
          sharesEvidenceV490(
            scenario.sourceIds,
            functionalUserStories[candidate.itemIndex]?.sourceIds ?? [],
          ),
        `${scenario.code}.userStoryCodes`,
      ),
    );
    const userStorySet = new Set(userStoryCodes);
    const acceptanceCriterionCodes = scenario.acceptanceCriterionCodes.map(
      (rawCode) =>
        resolveCanonicalOccurrenceV490(
          canonicalFunctionalCriterionReference(rawCode),
          criterionOccurrences,
          (candidate) => {
            const owner = functionalOccurrences[candidate.ownerIndex];
            return Boolean(owner && userStorySet.has(owner.canonicalCode));
          },
          `${scenario.code}.acceptanceCriterionCodes`,
        ),
    );
    const taskCodes = (scenario.taskCodes ?? []).map((rawCode) =>
      resolveCanonicalOccurrenceV490(
        canonicalReferenceCode(rawCode, "TASK"),
        taskOccurrences,
        (candidate) => {
          const originalStory = epics
            .flatMap((epic) => epic.features)
            .flatMap((feature) => feature.userStories)[candidate.ownerIndex];
          return Boolean(
            originalStory?.functionalRequirementCodes.some((code) => {
              const canonicalCode = resolveCanonicalOccurrenceV490(
                canonicalFunctionalStoryReference(code),
                functionalOccurrences,
                (functionalCandidate) =>
                  sharesEvidenceV490(
                    originalStory.sourceIds,
                    functionalUserStories[functionalCandidate.itemIndex]
                      ?.sourceIds ?? [],
                  ),
                `${originalStory.code}.functionalRequirementCodes`,
              );
              return userStorySet.has(canonicalCode);
            }),
          );
        },
        `${scenario.code}.taskCodes`,
      ),
    );
    return {
      ...scenario,
      code: canonicalCodeAtV490(testOccurrences, scenarioIndex),
      userStoryCodes: [...new Set(userStoryCodes)],
      acceptanceCriterionCodes: [...new Set(acceptanceCriterionCodes)],
      taskCodes: [...new Set(taskCodes)],
    };
  });

  const sprintOccurrences = scrumPlan
    ? canonicalizeSequentialAliasesV490(
        scrumPlan.sprints.map((sprint) => sprint.code),
        "Scrum/Sprints",
        warnings,
      )
    : [];
  const canonicalScrumPlan = scrumPlan
    ? {
        ...scrumPlan,
        sprints: scrumPlan.sprints.map((sprint, sprintIndex) => {
          const rawStoryMultiplicity = new Map<string, number>();
          for (const rawCode of sprint.userStoryCodes) {
            const code = canonicalPlanningStoryReference(rawCode);
            rawStoryMultiplicity.set(
              code,
              (rawStoryMultiplicity.get(code) ?? 0) + 1,
            );
          }
          const seenStories = new Map<string, number>();
          const userStoryCodes = sprint.userStoryCodes.map((rawCode) => {
            const code = canonicalPlanningStoryReference(rawCode);
            const candidates = storyOccurrences.filter(
              (occurrence) => occurrence.originalCode === code,
            );
            if (candidates.length <= 1) {
              return candidates[0]?.canonicalCode ?? code;
            }
            const occurrenceIndex = seenStories.get(code) ?? 0;
            seenStories.set(code, occurrenceIndex + 1);
            if (rawStoryMultiplicity.get(code) === candidates.length) {
              return canonicalCodeAtV490(candidates, occurrenceIndex);
            }
            return resolveCanonicalOccurrenceV490(
              code,
              storyOccurrences,
              (candidate) => {
                const parentFeature = featureOccurrences[candidate.ownerIndex];
                return Boolean(
                  parentFeature &&
                  sprint.featureCodes.some(
                    (featureCode) =>
                      canonicalReferenceCode(featureCode, "FEATURE") ===
                      parentFeature.originalCode,
                  ),
                );
              },
              `${sprint.code}.userStoryCodes`,
            );
          });
          const storySet = new Set(userStoryCodes);
          const featureCodes = [
            ...new Set(
              storyOccurrences
                .filter((occurrence) => storySet.has(occurrence.canonicalCode))
                .map(
                  (occurrence) =>
                    featureOccurrences[occurrence.ownerIndex]?.canonicalCode,
                )
                .filter((code): code is string => Boolean(code)),
            ),
          ];
          const sprintFunctionalCodes = new Set(
            canonicalBacklog.epics
              .flatMap((epic) => epic.features)
              .flatMap((feature) => feature.userStories)
              .filter((story) => storySet.has(story.code))
              .flatMap((story) => story.functionalRequirementCodes),
          );
          const testCodes = sprint.testCodes.map((rawCode) =>
            resolveCanonicalOccurrenceV490(
              rawCode.trim().toUpperCase(),
              testOccurrences,
              (candidate) =>
                canonicalTests[candidate.itemIndex]?.userStoryCodes.some(
                  (code) => sprintFunctionalCodes.has(code),
                ) ?? false,
              `${sprint.code}.testCodes`,
            ),
          );
          const dependencies = sprint.dependencies.map((rawCode) => {
            const code = rawCode.trim().toUpperCase();
            const candidates = sprintOccurrences.filter(
              (candidate) =>
                candidate.originalCode === code &&
                candidate.itemIndex !== sprintIndex,
            );
            if (candidates.length <= 1) {
              return candidates[0]?.canonicalCode ?? code;
            }
            const previous = candidates.filter(
              (candidate) => candidate.itemIndex < sprintIndex,
            );
            if (previous.length === 1) {
              return previous[0]?.canonicalCode ?? code;
            }
            throw new Error(
              `${sprint.code}.dependencies contiene la referencia ambigua ${code}; no se eligió un destino arbitrario.`,
            );
          });
          return {
            ...sprint,
            code: canonicalCodeAtV490(sprintOccurrences, sprintIndex),
            featureCodes,
            userStoryCodes: [...new Set(userStoryCodes)],
            testCodes: [...new Set(testCodes)],
            dependencies: [...new Set(dependencies)],
            tasks: sprint.tasks.map((task) => ({
              ...task,
              userStoryCode: resolveCanonicalOccurrenceV490(
                canonicalPlanningStoryReference(task.userStoryCode),
                storyOccurrences,
                (candidate) => storySet.has(candidate.canonicalCode),
                `${sprint.code}/${task.code}.userStoryCode`,
              ),
            })),
          };
        }),
      }
    : null;

  return {
    functionalUserStories: canonicalFunctionalStories,
    backlogStructure: canonicalBacklog,
    tests: canonicalTests,
    scrumPlan: canonicalScrumPlan,
  };
}
