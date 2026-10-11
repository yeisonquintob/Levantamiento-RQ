import assert from "node:assert/strict";
import test from "node:test";

import { PROTOTYPE_NOT_REQUESTED } from "../../apps/ai-analysis-service/src/execution/prototype-request-brief.js";
import type { DocumentSectionKey } from "../../libs/shared/contracts/src/index.js";
import {
  generatedSectionContent,
  resolveAppliedRequirementSectionKey,
} from "../../apps/ai-analysis-service/src/execution/ai-analysis-execution.service.js";

test("conserva la sección RNF cuando la plantilla todavía la contiene", () => {
  const sections = new Set<DocumentSectionKey>([
    "milestones",
    "nonFunctionalRequirements",
  ]);

  assert.equal(
    resolveAppliedRequirementSectionKey("nonFunctionalRequirements", sections),
    "nonFunctionalRequirements",
  );
});

test("vincula los RNF con milestones en las plantillas actuales", () => {
  const sections = new Set<DocumentSectionKey>(["milestones", "tests"]);

  assert.equal(
    resolveAppliedRequirementSectionKey("nonFunctionalRequirements", sections),
    "milestones",
  );
});

test("rechaza cualquier otra sección que realmente no pertenezca al documento", () => {
  const sections = new Set<DocumentSectionKey>(["milestones", "tests"]);

  assert.throws(
    () => resolveAppliedRequirementSectionKey("scrumPlan", sections),
    /no existe en la versión documental/u,
  );
});

function draftWithPrototype(prototypeMarkdown: unknown) {
  return {
    schemaVersion: "4.1.0",
    sections: [
      { key: "solutionProposal", content: { prototypeMarkdown } },
    ],
    structuredAnalysis: {},
  } as unknown as Parameters<typeof generatedSectionContent>[0];
}

test("Punto 13 aplica el Markdown de prototipo generado cuando Prototipo está activo", () => {
  const markdown = "# Prototipo\n\nPantalla principal";

  assert.equal(
    generatedSectionContent(
      draftWithPrototype(markdown),
      "visualFormat" as DocumentSectionKey,
      "Pendiente de definición",
      true,
    ),
    markdown,
  );
});

test("Punto 13 conserva el fallback cuando no hay Markdown de prototipo", () => {
  const withoutMarkdown = generatedSectionContent(
    draftWithPrototype(null),
    "visualFormat" as DocumentSectionKey,
    "Pendiente de definición",
    true,
  );
  const blankMarkdown = generatedSectionContent(
    draftWithPrototype("   "),
    "visualFormat" as DocumentSectionKey,
    "Pendiente de definición",
    true,
  );

  assert.deepEqual(blankMarkdown, withoutMarkdown);
  assert.notEqual(withoutMarkdown, "   ");
});

test("Punto 13 permanece no solicitado cuando Prototipo está desactivado", () => {
  const result = generatedSectionContent(
    draftWithPrototype("# Prototipo"),
    "visualFormat" as DocumentSectionKey,
    "Pendiente de definición",
    false,
  );

  assert.notEqual(result, "# Prototipo");
  assert.equal(result, PROTOTYPE_NOT_REQUESTED);
});
