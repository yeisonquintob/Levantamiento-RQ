import { FakeAiProvider } from "../../apps/ai-analysis-service/src/execution/fake-ai.provider.js";
import { buildAiAnalysisOutputSchemaV41 } from "../../apps/ai-analysis-service/src/execution/ai-analysis-draft.js";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

export async function localDraftFixture(
  includesScrum = false,
): Promise<Record<string, any>> {
  const provider = new FakeAiProvider([
    {
      id: SOURCE_ID,
      title: "Fuente planificación",
      text: "3.2.1 Modelar mantenimiento; 3.2.1.1 Validar prototipo.",
    },
  ]);
  const generated = await provider.generate({
    systemInstruction: "system",
    userPrompt: "prompt",
    schema: buildAiAnalysisOutputSchemaV41(includesScrum),
  });
  const raw = JSON.parse(JSON.stringify(generated.draft)) as Record<
    string,
    any
  >;
  const oldStory =
    raw.structuredAnalysis.backlogStructure.epics[0].features[0].userStories[0];
  const oldCriterion = oldStory.acceptanceCriteria[0];
  const oldTask = oldStory.tasks[0];

  raw.schemaVersion = "4.1.0";
  raw.requirements = raw.requirements.filter(
    (item: Record<string, any>) =>
      item.sectionKey === "nonFunctionalRequirements",
  );
  raw.structuredAnalysis = {
    processFlows: raw.structuredAnalysis.processFlows,
    entityRelationship: raw.structuredAnalysis.entityRelationship,
    functionalUserStories: [
      {
        code: "HU-F-001",
        title: oldStory.title,
        description: oldStory.description,
        milestone: "H-001",
        functionality: "Mantenimiento",
        milestoneDescription: "Hito funcional de mantenimiento.",
        role: oldStory.role,
        want: oldStory.want,
        benefit: oldStory.benefit,
        context: oldStory.context,
        premises: oldStory.premises,
        impactedSystems: oldStory.impactedSystems,
        fields: oldStory.fields,
        acceptanceCriteria: [
          {
            ...oldCriterion,
            code: "CA-F-001-01",
          },
        ],
        sourceIds: oldStory.sourceIds,
      },
    ],
    backlogStructure: {
      epics: raw.structuredAnalysis.backlogStructure.epics.map(
        (epic: Record<string, any>) => ({
          code: epic.code,
          title: epic.title,
          description: epic.description,
          sourceNumber: "3",
          sourceIds: epic.sourceIds,
          features: epic.features.map((feature: Record<string, any>) => ({
            code: feature.code,
            title: feature.title,
            description: feature.description,
            sourceNumber: "3.2",
            sourceIds: feature.sourceIds,
            userStories: feature.userStories.map(() => ({
              code: "HU-P-001",
              title: "Modelar mantenimiento",
              description: "Planificación de implementación.",
              sourceNumber: "3.2.1",
              functionalRequirementCodes: ["HU-F-001"],
              sourceIds: oldStory.sourceIds,
              tasks: [
                {
                  ...oldTask,
                  sourceNumber: "3.2.1.1",
                  origin: "IMPLEMENTATION_PROPOSAL",
                },
              ],
            })),
          })),
        }),
      ),
    },
    tests: raw.structuredAnalysis.tests.map(
      (scenario: Record<string, any>) => ({
        ...scenario,
        userStoryCodes: ["HU-F-001"],
        acceptanceCriterionCodes: ["CA-F-999"],
        taskCodes: [oldTask.code],
      }),
    ),
    scrumPlan: includesScrum ? raw.structuredAnalysis.scrumPlan : null,
  };
  raw.structuredAnalysis.backlogStructure.structureStatus = "AI_SUGGESTED";
  raw.structuredAnalysis.backlogStructure.pendingAssignments = {
    features: [],
    userStories: [],
    tasks: [],
  };
  const story = raw.structuredAnalysis.functionalUserStories[0];
  story.title = "Modelar mantenimiento";
  story.description = "Documentar el mantenimiento con trazabilidad.";
  story.assignmentStatus = "ASSIGNED";
  story.documentationStatus = "COMPLETE";
  story.documentationObservation = null;
  story.assignmentObservation = null;
  story.functionalNeedCodes = [];
  raw.structuredAnalysis.tests.forEach((scenario: Record<string, any>) => {
    scenario.acceptanceCriterionCodes = ["CA-F-001-01"];
  });
  raw.sections.find(
    (section: Record<string, any>) => section.key === "solutionProposal",
  ).content.prototypeMarkdown = null;
  return raw;
}
