import {
  AI_BACKLOG_TASK_ORIGINS,
  AI_SCRUM_TASK_TYPES,
  type AiBacklogStructure,
  type AiBacklogTask,
  type AiBacklogUserStory,
  type AiFeature,
  type AiRequiredField,
  type AiUserStory,
} from "@levantamiento-rq/shared-contracts";
import {
  object,
  string,
  strings,
  array,
  sourceIds,
} from "./ai-draft-parse-primitives";
import {
  canonicalBacklogCode,
  canonicalReferenceCode,
} from "./ai-draft-code-aliases";

export function parseFeatures(value: unknown): AiFeature[] {
  return array(value, "structuredAnalysis.features", 40).map((item, index) => {
    const feature = object(item, `structuredAnalysis.features[${index}]`);
    return {
      code: string(
        feature.code,
        `structuredAnalysis.features[${index}].code`,
        50,
      ),
      title: string(
        feature.title,
        `structuredAnalysis.features[${index}].title`,
        300,
      ),
      objective: string(
        feature.objective,
        `structuredAnalysis.features[${index}].objective`,
        2_000,
      ),
      description: string(
        feature.description,
        `structuredAnalysis.features[${index}].description`,
        5_000,
      ),
      inScope: strings(
        feature.inScope,
        `structuredAnalysis.features[${index}].inScope`,
        50,
      ),
      outOfScope: strings(
        feature.outOfScope,
        `structuredAnalysis.features[${index}].outOfScope`,
        50,
      ),
      userStoryCodes: strings(
        feature.userStoryCodes,
        `structuredAnalysis.features[${index}].userStoryCodes`,
        100,
      ),
      sourceIds: sourceIds(
        feature.sourceIds,
        `structuredAnalysis.features[${index}].sourceIds`,
      ),
    };
  });
}

export function reconcileFeatureStoryCodes(
  features: readonly AiFeature[],
  userStories: readonly AiUserStory[],
): AiFeature[] {
  const storyCodesByFeature = new Map<string, string[]>();
  for (const story of userStories) {
    const codes = storyCodesByFeature.get(story.featureCode) ?? [];
    codes.push(story.code);
    storyCodesByFeature.set(story.featureCode, codes);
  }
  return features.map((feature) => ({
    ...feature,
    // featureCode en la HU es la relación propietaria. La lista inversa es
    // redundante y se reconstruye para tolerar duplicados cruzados del modelo.
    userStoryCodes: storyCodesByFeature.get(feature.code) ?? [],
  }));
}

export function parseField(value: unknown, name: string): AiRequiredField {
  const field = object(value, name);
  if (typeof field.required !== "boolean") {
    throw new Error(`${name}.required no es booleano.`);
  }
  return {
    name: string(field.name, `${name}.name`, 200),
    dataType: string(field.dataType, `${name}.dataType`, 120),
    required: field.required,
    validation: string(field.validation, `${name}.validation`, 2_000),
    sourceIds: sourceIds(field.sourceIds, `${name}.sourceIds`),
  };
}

export function parseUserStories(value: unknown): AiUserStory[] {
  return array(value, "structuredAnalysis.userStories", 150).map(
    (item, index) => {
      const name = `structuredAnalysis.userStories[${index}]`;
      const story = object(item, name);
      const criteria = array(
        story.acceptanceCriteria,
        `${name}.acceptanceCriteria`,
        50,
      ).map((criterionItem, criterionIndex) => {
        const criterionName = `${name}.acceptanceCriteria[${criterionIndex}]`;
        const criterion = object(criterionItem, criterionName);
        return {
          code: string(criterion.code, `${criterionName}.code`, 50),
          given: string(criterion.given, `${criterionName}.given`, 2_000),
          when: string(criterion.when, `${criterionName}.when`, 2_000),
          then: string(criterion.then, `${criterionName}.then`, 2_000),
          sourceIds: sourceIds(
            criterion.sourceIds,
            `${criterionName}.sourceIds`,
          ),
        };
      });
      if (criteria.length === 0) {
        throw new Error(
          `${name} debe tener al menos un criterio de aceptación.`,
        );
      }
      return {
        code: string(story.code, `${name}.code`, 50),
        featureCode: string(story.featureCode, `${name}.featureCode`, 50),
        title: string(story.title, `${name}.title`, 300),
        role: string(story.role, `${name}.role`, 500),
        want: string(story.want, `${name}.want`, 2_000),
        benefit: string(story.benefit, `${name}.benefit`, 2_000),
        context: string(story.context, `${name}.context`, 5_000),
        premises: strings(story.premises, `${name}.premises`, 50),
        impactedSystems: strings(
          story.impactedSystems,
          `${name}.impactedSystems`,
          50,
        ),
        fields: array(story.fields, `${name}.fields`, 100).map(
          (field, fieldIndex) =>
            parseField(field, `${name}.fields[${fieldIndex}]`),
        ),
        acceptanceCriteria: criteria,
        sourceIds: sourceIds(story.sourceIds, `${name}.sourceIds`),
      };
    },
  );
}

function parseBacklogTask(value: unknown, name: string): AiBacklogTask {
  const task = object(value, name);
  const type = string(task.type, `${name}.type`, 30);
  const origin = string(task.origin, `${name}.origin`, 40);
  if (!AI_SCRUM_TASK_TYPES.includes(type as never)) {
    throw new Error(`${name}.type no está permitido.`);
  }
  if (!AI_BACKLOG_TASK_ORIGINS.includes(origin as never)) {
    throw new Error(`${name}.origin no está permitido.`);
  }
  return {
    code: canonicalBacklogCode(task.code, `${name}.code`, "TASK"),
    title: string(task.title, `${name}.title`, 300),
    description: string(task.description, `${name}.description`, 2_000),
    type: type as AiBacklogTask["type"],
    origin: origin as AiBacklogTask["origin"],
    dependencyCodes: strings(
      task.dependencyCodes,
      `${name}.dependencyCodes`,
      30,
    ).map((code) => canonicalReferenceCode(code, "TASK")),
    sourceIds: sourceIds(task.sourceIds, `${name}.sourceIds`),
  };
}

export function parseBacklogStructure(value: unknown): AiBacklogStructure {
  const backlog = object(value, "structuredAnalysis.backlogStructure");
  return {
    epics: array(
      backlog.epics,
      "structuredAnalysis.backlogStructure.epics",
      40,
    ).map((epicValue, epicIndex) => {
      const epicName = `structuredAnalysis.backlogStructure.epics[${epicIndex}]`;
      const epic = object(epicValue, epicName);
      return {
        code: canonicalBacklogCode(epic.code, `${epicName}.code`, "EPIC"),
        title: string(epic.title, `${epicName}.title`, 300),
        description: string(epic.description, `${epicName}.description`, 5_000),
        sourceIds: sourceIds(epic.sourceIds, `${epicName}.sourceIds`),
        features: array(epic.features, `${epicName}.features`, 40).map(
          (featureValue, featureIndex) => {
            const featureName = `${epicName}.features[${featureIndex}]`;
            const feature = object(featureValue, featureName);
            const featureCode = canonicalBacklogCode(
              feature.code,
              `${featureName}.code`,
              "FEATURE",
            );
            return {
              code: featureCode,
              title: string(feature.title, `${featureName}.title`, 300),
              description: string(
                feature.description,
                `${featureName}.description`,
                5_000,
              ),
              sourceIds: sourceIds(
                feature.sourceIds,
                `${featureName}.sourceIds`,
              ),
              userStories: array(
                feature.userStories,
                `${featureName}.userStories`,
                150,
              ).map((storyValue, storyIndex): AiBacklogUserStory => {
                const storyName = `${featureName}.userStories[${storyIndex}]`;
                const story = object(storyValue, storyName);
                const criteria = array(
                  story.acceptanceCriteria,
                  `${storyName}.acceptanceCriteria`,
                  50,
                ).map((criterionValue, criterionIndex) => {
                  const criterion = object(
                    criterionValue,
                    `${storyName}.acceptanceCriteria[${criterionIndex}]`,
                  );
                  return {
                    ...criterion,
                    code: canonicalBacklogCode(
                      criterion.code,
                      `${storyName}.acceptanceCriteria[${criterionIndex}].code`,
                      "ACCEPTANCE_CRITERION",
                    ),
                  };
                });
                const parsed = parseUserStories([
                  {
                    ...story,
                    code: canonicalBacklogCode(
                      story.code,
                      `${storyName}.code`,
                      "USER_STORY",
                    ),
                    featureCode,
                    acceptanceCriteria: criteria,
                  },
                ])[0];
                return {
                  ...parsed,
                  description: string(
                    story.description,
                    `${storyName}.description`,
                    5_000,
                  ),
                  tasks: array(story.tasks, `${storyName}.tasks`, 200).map(
                    (task, taskIndex) =>
                      parseBacklogTask(
                        task,
                        `${storyName}.tasks[${taskIndex}]`,
                      ),
                  ),
                };
              }),
            };
          },
        ),
      };
    }),
  };
}
