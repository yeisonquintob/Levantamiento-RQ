import assert from "node:assert/strict";
import test from "node:test";

import {
  DOCUMENT_SCRUM_SECTION_DEFINITION,
  DOCUMENT_SECTION_DEFINITIONS,
} from "../../libs/shared/contracts/src/lib/documents.js";
import type { DocumentTemplateSection } from "../../libs/shared/contracts/src/lib/document-templates.js";

import { buildAiAnalysisOutputSchemaV41 } from "../../apps/ai-analysis-service/src/execution/ai-analysis-draft.js";
import {
  buildLocalDraftLogicalBlocks,
  resolveLocalDraftLogicalBlock,
  unmappedLocalDraftStagePaths,
} from "../../apps/ai-analysis-service/src/execution/local-draft-block-map.js";
import { localDraftStages } from "../../apps/ai-analysis-service/src/execution/local-draft-stages.js";

const sourceId = "22222222-2222-4222-8222-222222222222";

function currentStages(includesScrum: boolean) {
  return localDraftStages(
    buildAiAnalysisOutputSchemaV41(
      includesScrum,
      includesScrum ? "LARGE_REQUIREMENT" : "ERP_FDD",
      [sourceId],
    ),
  );
}

function currentTemplateSections(
  includesScrum: boolean,
): DocumentTemplateSection[] {
  const definitions = includesScrum
    ? [...DOCUMENT_SECTION_DEFINITIONS, DOCUMENT_SCRUM_SECTION_DEFINITION]
    : [...DOCUMENT_SECTION_DEFINITIONS];

  return definitions.map((section, index) => ({
    key: section.key,
    order: index + 1,
    title: section.title,
    required: true,
    guidance: `Guía ${section.key}`,
  }));
}

test("el mapa usa cantidad, orden y títulos de la versión exacta de la plantilla", () => {
  const stages = currentStages(true);
  const blocks = buildLocalDraftLogicalBlocks(
    currentTemplateSections(true),
    stages,
  );

  assert.equal(blocks.length, 15);
  assert.deepEqual(
    blocks.map((block) => block.blockNumber),
    Array.from({ length: 15 }, (_, index) => index + 1),
  );
  assert.ok(blocks.every((block) => block.blockTotal === 15));
  assert.deepEqual(
    blocks.map((block) => block.blockLabel),
    [
      "Encabezado del documento",
      "Objetivos del proyecto",
      "Descripción del problema",
      "Alcance",
      "Solución propuesta del profesional de soluciones",
      "Diagrama de flujo",
      "Requerimientos",
      "Esquema",
      "Pruebas",
      "Supuestos, dependencias y pendientes",
      "Aprobaciones y control de cambios",
      "Plantilla aplicada",
      "Prototipo",
      "KPIs",
      "Plan de trabajo",
    ],
  );
  assert.deepEqual(unmappedLocalDraftStagePaths(stages, blocks), []);
});

test("una plantilla sin Scrum produce su total real y no inventa Plan de trabajo", () => {
  const stages = currentStages(false);
  const blocks = buildLocalDraftLogicalBlocks(
    currentTemplateSections(false),
    stages,
  );

  assert.equal(blocks.length, 14);
  assert.ok(blocks.every((block) => block.blockTotal === 14));
  assert.equal(
    blocks.some((block) => block.blockKey === "scrumPlan"),
    false,
  );

  // El contrato IA conserva structuredAnalysis.scrumPlan=null internamente,
  // pero una plantilla sin Scrum no crea un bloque visible para esa etapa.
  assert.ok(
    unmappedLocalDraftStagePaths(stages, blocks).includes(
      "structuredAnalysis.scrumPlan",
    ),
  );
});

test("si la plantilla cambia, el mapeo cambia sin hardcodear 15 bloques", () => {
  const stages = currentStages(false);
  const changedTemplate: DocumentTemplateSection[] = [
    {
      key: "milestones",
      order: 30,
      title: "Requerimientos ajustados",
      required: true,
      guidance: "Consolidar requerimientos.",
    },
    {
      key: "customSectionOne",
      order: 10,
      title: "Diagnóstico especial",
      required: false,
      guidance: "Punto propio de esta versión.",
    },
    {
      key: "scope",
      order: 20,
      title: "Cobertura de la solución",
      required: true,
      guidance: "Definir cobertura.",
    },
  ];

  const blocks = buildLocalDraftLogicalBlocks(changedTemplate, stages);

  assert.deepEqual(
    blocks.map((block) => [
      block.blockNumber,
      block.blockTotal,
      block.blockKey,
      block.blockLabel,
    ]),
    [
      [1, 3, "customSectionOne", "Diagnóstico especial"],
      [2, 3, "scope", "Cobertura de la solución"],
      [3, 3, "milestones", "Requerimientos ajustados"],
    ],
  );

  assert.deepEqual(blocks[0]?.stageRoots, []);
  assert.equal(blocks[0]?.presentationSource, "UNMAPPED");
  assert.equal(
    resolveLocalDraftLogicalBlock("sections.scope", blocks)?.blockNumber,
    2,
  );
  assert.equal(
    resolveLocalDraftLogicalBlock("requirements[3]", blocks)?.blockNumber,
    3,
  );
});

test("varias llamadas internas y subdivisiones siguen perteneciendo a un solo bloque visible", () => {
  const stages = currentStages(true);
  const blocks = buildLocalDraftLogicalBlocks(
    currentTemplateSections(true),
    stages,
  );

  const cases: ReadonlyArray<readonly [string, number, string]> = [
    ["structuredAnalysis.processFlows.toBe.nodes[0]", 6, "processFlow"],
    ["structuredAnalysis.entityRelationship.entities[0]", 6, "processFlow"],
    ["structuredAnalysis.functionalUserStories[2]", 7, "milestones"],
    ["requirements.__plan", 7, "milestones"],
    ["requirements[3]", 7, "milestones"],
    ["structuredAnalysis.backlogStructure.epics[0]", 8, "backlogStructure"],
    ["structuredAnalysis.tests[2]", 9, "tests"],
    ["pendingQuestions.__plan", 10, "assumptionsDependenciesPending"],
    ["warnings[0]", 10, "assumptionsDependenciesPending"],
    ["structuredAnalysis.scrumPlan.sprints[0]", 15, "scrumPlan"],
  ];

  for (const [stagePath, expectedNumber, expectedKey] of cases) {
    const block = resolveLocalDraftLogicalBlock(stagePath, blocks);
    assert.equal(block?.blockNumber, expectedNumber, stagePath);
    assert.equal(block?.blockKey, expectedKey, stagePath);
  }
});

test("los puntos especiales documentan si la salida visible es plantilla o derivada", () => {
  const blocks = buildLocalDraftLogicalBlocks(
    currentTemplateSections(true),
    currentStages(true),
  );

  const byKey = new Map(blocks.map((block) => [block.blockKey, block]));

  assert.equal(
    byKey.get("writingRules")?.presentationSource,
    "TEMPLATE_METADATA",
  );
  assert.equal(byKey.get("visualFormat")?.presentationSource, "DERIVED");
  assert.equal(
    byKey.get("automationInstruction")?.presentationSource,
    "DERIVED",
  );

  assert.ok(
    byKey.get("writingRules")?.stageRoots.includes("sections.writingRules"),
  );
  assert.ok(
    byKey.get("visualFormat")?.stageRoots.includes("sections.visualFormat"),
  );
  assert.ok(
    byKey
      .get("automationInstruction")
      ?.stageRoots.includes("sections.automationInstruction"),
  );
});
