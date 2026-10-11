import {
  type AiAnalysisDraftRequirement,
  type AiBacklogStructure,
  type AiScrumPlan,
  type AiTestScenario,
} from "@levantamiento-rq/shared-contracts";
import { canonicalReferenceCode } from "./ai-draft-code-aliases";
import { pushReconciliationWarning } from "./ai-draft-parse-primitives";
import { normalizedTextReference } from "./ai-draft-objective-reference";

/*
 * AI_V4_GLOBAL_GRAPH_RECONCILIATION
 *
 * V4 trata backlogStructure como fuente canónica estructural.
 * Las referencias redundantes de Pruebas, Scrum y requirements
 * se reconcilian contra ese grafo antes de la validación estricta.
 *
 * Política:
 * - equivalencia técnica inequívoca -> normalizar;
 * - referencia inexistente no estructural -> omitir y advertir;
 * - estructura canónica rota (duplicados/ciclos) -> assertReferences falla.
 */
export function reconcileV4Graph(
  backlogStructure: AiBacklogStructure,
  requirements: readonly AiAnalysisDraftRequirement[],
  tests: readonly AiTestScenario[],
  scrumPlan: AiScrumPlan | null,
  initialWarnings: readonly string[],
): {
  backlogStructure: AiBacklogStructure;
  requirements: AiAnalysisDraftRequirement[];
  tests: AiTestScenario[];
  scrumPlan: AiScrumPlan | null;
  warnings: string[];
} {
  const warnings = [...initialWarnings].slice(0, 100);

  const featureByKey = new Map<string, { code: string; title: string }>();
  const storyByKey = new Map<
    string,
    { code: string; title: string; featureCode: string }
  >();
  const criterionByKey = new Map<string, { code: string; storyCode: string }>();
  const backlogTaskByKey = new Map<
    string,
    { code: string; storyCode: string }
  >();

  for (const epic of backlogStructure.epics) {
    for (const feature of epic.features) {
      featureByKey.set(canonicalReferenceCode(feature.code, "FEATURE"), {
        code: feature.code,
        title: feature.title,
      });
      for (const story of feature.userStories) {
        storyByKey.set(canonicalReferenceCode(story.code, "USER_STORY"), {
          code: story.code,
          title: story.title,
          featureCode: feature.code,
        });
        for (const criterion of story.acceptanceCriteria) {
          criterionByKey.set(
            canonicalReferenceCode(criterion.code, "ACCEPTANCE_CRITERION"),
            {
              code: criterion.code,
              storyCode: story.code,
            },
          );
        }
        for (const task of story.tasks) {
          backlogTaskByKey.set(canonicalReferenceCode(task.code, "TASK"), {
            code: task.code,
            storyCode: story.code,
          });
        }
      }
    }
  }

  const reconciledBacklog: AiBacklogStructure = {
    epics: backlogStructure.epics.map((epic) => ({
      ...epic,
      features: epic.features.map((feature) => ({
        ...feature,
        userStories: feature.userStories.map((story) => ({
          ...story,
          tasks: story.tasks.map((task) => ({
            ...task,
            dependencyCodes: [
              ...new Set(
                task.dependencyCodes.flatMap((rawCode) => {
                  const resolved = backlogTaskByKey.get(
                    canonicalReferenceCode(rawCode, "TASK"),
                  );
                  if (!resolved) {
                    pushReconciliationWarning(
                      warnings,
                      `${task.code}: se omitió la dependencia inexistente ${rawCode}.`,
                    );
                    return [];
                  }
                  return [resolved.code];
                }),
              ),
            ],
          })),
        })),
      })),
    })),
  };

  const canonicalStories = new Map(
    [...storyByKey.values()].map(
      (story) =>
        [canonicalReferenceCode(story.code, "USER_STORY"), story] as const,
    ),
  );

  const requirementByStory = new Set<string>();
  const reconciledRequirements = requirements.flatMap((requirement) => {
    if (requirement.sectionKey !== "milestones") {
      return [requirement];
    }

    let story = canonicalStories.get(
      canonicalReferenceCode(requirement.code, "USER_STORY"),
    );

    if (!story) {
      const titleKey = normalizedTextReference(requirement.title);
      const titleMatches = [...canonicalStories.values()].filter(
        (candidate) => normalizedTextReference(candidate.title) === titleKey,
      );
      story = titleMatches.length === 1 ? titleMatches[0] : undefined;
    }

    if (!story) {
      pushReconciliationWarning(
        warnings,
        `${requirement.code}: el metadato funcional del Punto 6 no pudo vincularse de forma inequívoca a una HU del Punto 7 y se omitió para evitar una referencia huérfana.`,
      );
      return [];
    }

    if (requirementByStory.has(story.code)) {
      pushReconciliationWarning(
        warnings,
        `${story.code}: se omitió un metadato funcional duplicado del Punto 6.`,
      );
      return [];
    }

    requirementByStory.add(story.code);

    let milestone = requirement.milestone ?? null;
    if (milestone) {
      const normalizedMilestone = milestone
        .trim()
        .toUpperCase()
        .replaceAll(/\s+/gu, "-")
        .replace(/^HITO-/u, "H-");
      if (/^H-[A-Z0-9-]+$/u.test(normalizedMilestone)) {
        milestone = normalizedMilestone;
      } else {
        pushReconciliationWarning(
          warnings,
          `${story.code}: el Hito "${milestone}" no tiene formato H-... y quedó pendiente de revisión.`,
        );
        milestone = null;
      }
    }

    return [
      {
        ...requirement,
        code: story.code,
        title: story.title,
        milestone,
      },
    ];
  });

  const reconciledTests = tests.map((scenario) => {
    const storyCodes: string[] = [];
    const criterionCodes: string[] = [];
    const taskCodes: string[] = [];

    for (const rawCode of scenario.userStoryCodes) {
      const resolved = storyByKey.get(
        canonicalReferenceCode(rawCode, "USER_STORY"),
      );
      if (!resolved) {
        pushReconciliationWarning(
          warnings,
          `${scenario.code}: se omitió la HU inexistente ${rawCode}.`,
        );
        continue;
      }
      storyCodes.push(resolved.code);
    }

    for (const rawCode of scenario.acceptanceCriterionCodes) {
      const resolved = criterionByKey.get(
        canonicalReferenceCode(rawCode, "ACCEPTANCE_CRITERION"),
      );
      if (!resolved) {
        pushReconciliationWarning(
          warnings,
          `${scenario.code}: se omitió el criterio inexistente ${rawCode}.`,
        );
        continue;
      }
      criterionCodes.push(resolved.code);
      storyCodes.push(resolved.storyCode);
    }

    for (const rawCode of scenario.taskCodes ?? []) {
      const resolved = backlogTaskByKey.get(
        canonicalReferenceCode(rawCode, "TASK"),
      );
      if (!resolved) {
        pushReconciliationWarning(
          warnings,
          `${scenario.code}: se omitió la Task inexistente ${rawCode}.`,
        );
        continue;
      }
      taskCodes.push(resolved.code);
      storyCodes.push(resolved.storyCode);
    }

    const canonicalStoryCodes = [...new Set(storyCodes)];
    const storySet = new Set(canonicalStoryCodes);

    const canonicalCriterionCodes = [
      ...new Set(
        criterionCodes.filter((code) => {
          const owner = criterionByKey.get(
            canonicalReferenceCode(code, "ACCEPTANCE_CRITERION"),
          );
          if (owner && storySet.has(owner.storyCode)) {
            return true;
          }
          pushReconciliationWarning(
            warnings,
            `${scenario.code}: se omitió ${code} porque no pertenece a una HU vinculada a la prueba.`,
          );
          return false;
        }),
      ),
    ];

    const canonicalTaskCodes = [
      ...new Set(
        taskCodes.filter((code) => {
          const owner = backlogTaskByKey.get(
            canonicalReferenceCode(code, "TASK"),
          );
          if (owner && storySet.has(owner.storyCode)) {
            return true;
          }
          pushReconciliationWarning(
            warnings,
            `${scenario.code}: se omitió ${code} porque no pertenece a una HU vinculada a la prueba.`,
          );
          return false;
        }),
      ),
    ];

    if (canonicalStoryCodes.length === 0) {
      pushReconciliationWarning(
        warnings,
        `${scenario.code}: la prueba quedó sin HU canónica asociada y requiere revisión humana.`,
      );
    }

    return {
      ...scenario,
      userStoryCodes: canonicalStoryCodes,
      acceptanceCriterionCodes: canonicalCriterionCodes,
      taskCodes: canonicalTaskCodes,
    };
  });

  const testByKey = new Map(
    reconciledTests.map(
      (scenario) => [scenario.code.trim().toUpperCase(), scenario] as const,
    ),
  );

  let reconciledScrumPlan = scrumPlan;

  if (scrumPlan) {
    const firstPassSprints = scrumPlan.sprints.map((sprint) => {
      const storyCodes: string[] = [];

      for (const rawCode of sprint.userStoryCodes) {
        const resolved = storyByKey.get(
          canonicalReferenceCode(rawCode, "USER_STORY"),
        );
        if (!resolved) {
          pushReconciliationWarning(
            warnings,
            `${sprint.code}: se omitió la HU inexistente ${rawCode}.`,
          );
          continue;
        }
        storyCodes.push(resolved.code);
      }

      const canonicalStoryCodes = [...new Set(storyCodes)];

      const featureCodes =
        canonicalStoryCodes.length > 0
          ? [
              ...new Set(
                canonicalStoryCodes
                  .map((storyCode) =>
                    storyByKey.get(
                      canonicalReferenceCode(storyCode, "USER_STORY"),
                    ),
                  )
                  .filter(
                    (
                      story,
                    ): story is {
                      code: string;
                      title: string;
                      featureCode: string;
                    } => Boolean(story),
                  )
                  .map((story) => story.featureCode),
              ),
            ]
          : [
              ...new Set(
                sprint.featureCodes.flatMap((rawCode) => {
                  const resolved = featureByKey.get(
                    canonicalReferenceCode(rawCode, "FEATURE"),
                  );
                  if (!resolved) {
                    pushReconciliationWarning(
                      warnings,
                      `${sprint.code}: se omitió la Feature inexistente ${rawCode}.`,
                    );
                    return [];
                  }
                  return [resolved.code];
                }),
              ),
            ];

      const testCodes = [
        ...new Set(
          sprint.testCodes.flatMap((rawCode) => {
            const resolved = testByKey.get(rawCode.trim().toUpperCase());
            if (!resolved) {
              pushReconciliationWarning(
                warnings,
                `${sprint.code}: se omitió la prueba inexistente ${rawCode}.`,
              );
              return [];
            }
            return [resolved.code];
          }),
        ),
      ];

      const tasks = sprint.tasks.flatMap((task) => {
        const story = storyByKey.get(
          canonicalReferenceCode(task.userStoryCode, "USER_STORY"),
        );
        if (!story) {
          pushReconciliationWarning(
            warnings,
            `${sprint.code}/${task.code}: la Task Scrum se omitió porque referencia la HU inexistente ${task.userStoryCode}.`,
          );
          return [];
        }
        return [
          {
            ...task,
            code: canonicalReferenceCode(task.code, "TASK"),
            userStoryCode: story.code,
          },
        ];
      });

      return {
        ...sprint,
        code: sprint.code.trim().toUpperCase(),
        featureCodes,
        userStoryCodes: canonicalStoryCodes,
        testCodes,
        tasks,
      };
    });

    const scrumTaskByKey = new Map(
      firstPassSprints.flatMap((sprint) =>
        sprint.tasks.map(
          (task) =>
            [canonicalReferenceCode(task.code, "TASK"), task.code] as const,
        ),
      ),
    );

    reconciledScrumPlan = {
      ...scrumPlan,
      sprints: firstPassSprints.map((sprint) => ({
        ...sprint,
        tasks: sprint.tasks.map((task) => ({
          ...task,
          dependencyCodes: [
            ...new Set(
              task.dependencyCodes.flatMap((rawCode) => {
                const resolved = scrumTaskByKey.get(
                  canonicalReferenceCode(rawCode, "TASK"),
                );
                if (!resolved) {
                  pushReconciliationWarning(
                    warnings,
                    `${sprint.code}/${task.code}: se omitió la dependencia Scrum inexistente ${rawCode}.`,
                  );
                  return [];
                }
                return [resolved];
              }),
            ),
          ],
        })),
      })),
    };
  }

  return {
    backlogStructure: reconciledBacklog,
    requirements: reconciledRequirements,
    tests: reconciledTests,
    scrumPlan: reconciledScrumPlan,
    warnings,
  };
}
