import {
  type AiFunctionalUserStoryV41,
  type AiPlanningBacklogStructureV41,
  type AiScrumPlan,
  type AiTestScenario,
} from "@levantamiento-rq/shared-contracts";
import {
  canonicalReferenceCode,
  canonicalFunctionalStoryReference,
  canonicalFunctionalCriterionReference,
  canonicalPlanningStoryReference,
} from "./ai-draft-code-aliases";
import { pushReconciliationWarning } from "./ai-draft-parse-primitives";
import { canonicalizeScrumTaskCodesV490 } from "./ai-draft-identity-canonicalization";

/*
 * AI_V41_GLOBAL_GRAPH_RECONCILIATION
 *
 * Hay dos grafos canónicos independientes:
 * - funcional: Hito -> HU-F -> CA-F
 * - planificación: EP -> FE -> HU-P -> T
 *
 * Solo functionalRequirementCodes conecta ambos. Tests apuntan a HU-F/CA-F
 * y pueden además referenciar Tasks T-. Scrum apunta a FE/HU-P/T-.
 */
export function reconcileV41Graph(
  functionalUserStories: readonly AiFunctionalUserStoryV41[],
  backlogStructure: AiPlanningBacklogStructureV41,
  tests: readonly AiTestScenario[],
  scrumPlan: AiScrumPlan | null,
  initialWarnings: readonly string[],
): {
  functionalUserStories: AiFunctionalUserStoryV41[];
  backlogStructure: AiPlanningBacklogStructureV41;
  tests: AiTestScenario[];
  scrumPlan: AiScrumPlan | null;
  warnings: string[];
} {
  const warnings = [...initialWarnings].slice(0, 100);
  const functionalByCode = new Map(
    functionalUserStories.map((story) => [story.code, story] as const),
  );
  const criterionByCode = new Map<
    string,
    { code: string; storyCode: string }
  >();
  for (const story of functionalUserStories) {
    for (const criterion of story.acceptanceCriteria) {
      criterionByCode.set(criterion.code, {
        code: criterion.code,
        storyCode: story.code,
      });
    }
  }

  const featureByCode = new Map<string, { code: string; title: string }>();
  const planningStoryByCode = new Map<
    string,
    {
      code: string;
      featureCode: string;
      functionalRequirementCodes: readonly string[];
    }
  >();
  const planningTaskByCode = new Map<
    string,
    { code: string; storyCode: string }
  >();

  for (const epic of backlogStructure.epics) {
    for (const feature of epic.features) {
      featureByCode.set(feature.code, {
        code: feature.code,
        title: feature.title,
      });
      for (const story of feature.userStories) {
        planningStoryByCode.set(story.code, {
          code: story.code,
          featureCode: feature.code,
          functionalRequirementCodes: story.functionalRequirementCodes,
        });
        for (const task of story.tasks) {
          planningTaskByCode.set(task.code, {
            code: task.code,
            storyCode: story.code,
          });
        }
      }
    }
  }

  const reconciledBacklog: AiPlanningBacklogStructureV41 = {
    ...backlogStructure,
    structureStatus: backlogStructure.structureStatus ?? "CONFIRMED",
    epics: backlogStructure.epics.map((epic) => ({
      ...epic,
      features: epic.features.map((feature) => ({
        ...feature,
        userStories: feature.userStories.map((story) => ({
          ...story,
          functionalRequirementCodes: [
            ...new Set(
              story.functionalRequirementCodes.flatMap((rawCode) => {
                let code: string;
                try {
                  code = canonicalFunctionalStoryReference(rawCode);
                } catch {
                  pushReconciliationWarning(
                    warnings,
                    `${story.code}: se omitió la referencia funcional inválida ${rawCode}.`,
                  );
                  return [];
                }
                if (!functionalByCode.has(code)) {
                  pushReconciliationWarning(
                    warnings,
                    `${story.code}: se omitió la HU funcional inexistente ${rawCode}.`,
                  );
                  return [];
                }
                return [code];
              }),
            ),
          ],
          tasks: story.tasks.map((task) => ({
            ...task,
            origin: task.sourceNumber ? "EVIDENCE" : task.origin,
            dependencyCodes: [
              ...new Set(
                task.dependencyCodes.flatMap((rawCode) => {
                  const code = canonicalReferenceCode(rawCode, "TASK");
                  if (!planningTaskByCode.has(code)) {
                    pushReconciliationWarning(
                      warnings,
                      `${task.code}: se omitió la dependencia inexistente ${rawCode}.`,
                    );
                    return [];
                  }
                  return [code];
                }),
              ),
            ],
          })),
        })),
      })),
    })),
  };

  const reconciledPlanningStories = new Map<
    string,
    {
      code: string;
      featureCode: string;
      functionalRequirementCodes: readonly string[];
    }
  >();
  const reconciledPlanningTasks = new Map<
    string,
    { code: string; storyCode: string }
  >();
  for (const epic of reconciledBacklog.epics) {
    for (const feature of epic.features) {
      for (const story of feature.userStories) {
        reconciledPlanningStories.set(story.code, {
          code: story.code,
          featureCode: feature.code,
          functionalRequirementCodes: story.functionalRequirementCodes,
        });
        for (const task of story.tasks) {
          reconciledPlanningTasks.set(task.code, {
            code: task.code,
            storyCode: story.code,
          });
        }
      }
    }
  }

  const reconciledTests = tests.map((scenario) => {
    const storyCodes = [
      ...new Set(
        scenario.userStoryCodes.flatMap((rawCode) => {
          let code: string;
          try {
            code = canonicalFunctionalStoryReference(rawCode);
          } catch {
            pushReconciliationWarning(
              warnings,
              `${scenario.code}: se omitió la HU funcional inválida ${rawCode}.`,
            );
            return [];
          }
          if (!functionalByCode.has(code)) {
            pushReconciliationWarning(
              warnings,
              `${scenario.code}: se omitió la HU funcional inexistente ${rawCode}.`,
            );
            return [];
          }
          return [code];
        }),
      ),
    ];
    const storySet = new Set(storyCodes);

    const criterionCodes = [
      ...new Set(
        scenario.acceptanceCriterionCodes.flatMap((rawCode) => {
          let code: string;
          try {
            code = canonicalFunctionalCriterionReference(rawCode);
          } catch {
            pushReconciliationWarning(
              warnings,
              `${scenario.code}: se omitió el criterio funcional inválido ${rawCode}.`,
            );
            return [];
          }
          const criterion = criterionByCode.get(code);
          if (!criterion || !storySet.has(criterion.storyCode)) {
            pushReconciliationWarning(
              warnings,
              `${scenario.code}: se omitió el criterio inexistente o ajeno ${rawCode}.`,
            );
            return [];
          }
          return [criterion.code];
        }),
      ),
    ];

    const taskCodes = [
      ...new Set(
        (scenario.taskCodes ?? []).flatMap((rawCode) => {
          const code = canonicalReferenceCode(rawCode, "TASK");
          const task = reconciledPlanningTasks.get(code);
          if (!task) {
            pushReconciliationWarning(
              warnings,
              `${scenario.code}: se omitió la Task inexistente ${rawCode}.`,
            );
            return [];
          }
          const planningStory = reconciledPlanningStories.get(task.storyCode);
          if (
            planningStory &&
            storyCodes.length > 0 &&
            !planningStory.functionalRequirementCodes.some((functionalCode) =>
              storySet.has(functionalCode),
            )
          ) {
            pushReconciliationWarning(
              warnings,
              `${scenario.code}: se omitió ${code} porque su HU-P no tiene trazabilidad con las HU-F de la prueba.`,
            );
            return [];
          }
          return [code];
        }),
      ),
    ];

    return {
      ...scenario,
      userStoryCodes: storyCodes,
      acceptanceCriterionCodes: criterionCodes,
      taskCodes,
    };
  });

  let reconciledScrumPlan: AiScrumPlan | null = null;
  if (scrumPlan) {
    const testByCode = new Map(
      reconciledTests.map(
        (scenario) => [scenario.code.toUpperCase(), scenario] as const,
      ),
    );
    const firstPassSprints = scrumPlan.sprints.map((sprint) => {
      const storyCodes = [
        ...new Set(
          sprint.userStoryCodes.flatMap((rawCode) => {
            let code: string;
            try {
              code = canonicalPlanningStoryReference(rawCode);
            } catch {
              pushReconciliationWarning(
                warnings,
                `${sprint.code}: se omitió la HU-P inválida ${rawCode}.`,
              );
              return [];
            }
            if (!reconciledPlanningStories.has(code)) {
              pushReconciliationWarning(
                warnings,
                `${sprint.code}: se omitió la HU-P inexistente ${rawCode}.`,
              );
              return [];
            }
            return [code];
          }),
        ),
      ];
      const featureCodes = [
        ...new Set(
          storyCodes
            .map((code) => reconciledPlanningStories.get(code)?.featureCode)
            .filter((code): code is string => Boolean(code)),
        ),
      ];
      const tasks = sprint.tasks.flatMap((task) => {
        let storyCode: string;
        try {
          storyCode = canonicalPlanningStoryReference(task.userStoryCode);
        } catch {
          pushReconciliationWarning(
            warnings,
            `${sprint.code}/${task.code}: se omitió la Task Scrum por HU-P inválida ${task.userStoryCode}.`,
          );
          return [];
        }
        if (!reconciledPlanningStories.has(storyCode)) {
          pushReconciliationWarning(
            warnings,
            `${sprint.code}/${task.code}: se omitió la Task Scrum por HU-P inexistente ${task.userStoryCode}.`,
          );
          return [];
        }
        return [
          {
            ...task,
            code: canonicalReferenceCode(task.code, "TASK"),
            userStoryCode: storyCode,
          },
        ];
      });
      const testCodes = [
        ...new Set(
          sprint.testCodes.flatMap((rawCode) => {
            const code = rawCode.trim().toUpperCase();
            if (!testByCode.has(code)) {
              pushReconciliationWarning(
                warnings,
                `${sprint.code}: se omitió la prueba inexistente ${rawCode}.`,
              );
              return [];
            }
            return [code];
          }),
        ),
      ];
      return {
        ...sprint,
        code: sprint.code.trim().toUpperCase(),
        featureCodes,
        userStoryCodes: storyCodes,
        tasks,
        testCodes,
      };
    });

    const canonicalScrumPlan = canonicalizeScrumTaskCodesV490(
      { ...scrumPlan, sprints: firstPassSprints },
      warnings,
    );
    if (!canonicalScrumPlan) {
      throw new Error("La canonicalización Scrum perdió el plan.");
    }
    const scrumTaskByCode = new Map(
      canonicalScrumPlan.sprints.flatMap((sprint) =>
        sprint.tasks.map((task) => [task.code, task.code] as const),
      ),
    );
    reconciledScrumPlan = {
      ...canonicalScrumPlan,
      sprints: canonicalScrumPlan.sprints.map((sprint) => ({
        ...sprint,
        tasks: sprint.tasks.map((task) => ({
          ...task,
          dependencyCodes: [
            ...new Set(
              task.dependencyCodes.flatMap((rawCode) => {
                const code = canonicalReferenceCode(rawCode, "TASK");
                if (!scrumTaskByCode.has(code)) {
                  pushReconciliationWarning(
                    warnings,
                    `${sprint.code}/${task.code}: se omitió la dependencia Scrum inexistente ${rawCode}.`,
                  );
                  return [];
                }
                return [code];
              }),
            ),
          ],
        })),
      })),
    };
  }

  return {
    functionalUserStories: [...functionalUserStories],
    backlogStructure: reconciledBacklog,
    tests: reconciledTests,
    scrumPlan: reconciledScrumPlan,
    warnings,
  };
}
