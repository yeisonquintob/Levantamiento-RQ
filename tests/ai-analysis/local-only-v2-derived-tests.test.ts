import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLocalOnlyV2Sections } from "../../apps/ai-analysis-service/src/execution/local-only-v2-backlog-alignment";

const milestones = {
  functionalRequirements: [
    {
      code: "HU-F-001",
      title: "Registrar solicitud",
      want: "registrar una solicitud con sus datos",
      context: "Usuario autenticado con acceso al formulario.",
      milestone: "H-001",
      functionality: "Solicitudes",
      acceptanceCriteria: [
        {
          code: "CA-F-001",
          given: "datos completos",
          when: "se envía",
          then: "la solicitud queda registrada",
        },
        {
          code: "CA-F-002",
          given: "datos incompletos",
          when: "se envía",
          then: "se muestran los faltantes",
        },
      ],
    },
    {
      code: "HU-F-002",
      title: "Sin criterios",
      milestone: "H-001",
      functionality: "Solicitudes",
      acceptanceCriteria: [],
    },
  ],
};

const backlog = {
  structureStatus: "AI_SUGGESTED",
  epics: [
    {
      code: "EP-001",
      title: "Solicitudes",
      features: [
        {
          code: "FE-001",
          title: "Registro",
          userStories: [
            {
              code: "HU-P-001",
              title: "Registrar",
              functionalRequirementCodes: ["HU-F-001"],
              tasks: [{ code: "T-001" }, { code: "T-002" }],
            },
          ],
        },
      ],
    },
  ],
  pendingAssignments: { features: [], userStories: [], tasks: [] },
};

function testsOf(testsContent: unknown): {
  scenarios: Array<Record<string, unknown>>;
} {
  const result = normalizeLocalOnlyV2Sections(
    [
      { key: "milestones", content: milestones },
      { key: "backlogStructure", content: backlog },
      { key: "tests", content: testsContent },
    ] as never,
    () => undefined,
  );
  return result.find((item) => item.key === "tests")!.content as never;
}

test("sin escenarios del modelo, Pruebas se arma con las HU-F y sus criterios", () => {
  const { scenarios } = testsOf({ scenarios: [] });
  assert.equal(scenarios.length, 1);
  const [scenario] = scenarios;
  assert.equal(scenario?.code, "TS-001");
  assert.deepEqual(scenario?.userStoryCodes, ["HU-F-001"]);
  assert.deepEqual(scenario?.acceptanceCriterionCodes, [
    "CA-F-001",
    "CA-F-002",
  ]);
  assert.deepEqual(scenario?.taskCodes, ["T-001", "T-002"]);
  assert.equal(
    scenario?.precondition,
    "Usuario autenticado con acceso al formulario.",
  );
  assert.match(
    String(scenario?.expectedResult),
    /la solicitud queda registrada/u,
  );
});

test("si el modelo entregó escenarios no se reemplazan", () => {
  const own = {
    scenarios: [
      {
        code: "TS-001",
        title: "Propio",
        userStoryCodes: ["HU-F-001"],
        acceptanceCriterionCodes: [],
        taskCodes: [],
        precondition: "p",
        action: "a",
        expectedResult: "r",
        sourceIds: [],
      },
    ],
  };
  const { scenarios } = testsOf(own);
  assert.equal(scenarios[0]?.title, "Propio");
});
