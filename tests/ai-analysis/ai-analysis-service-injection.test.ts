import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import { AiAnalysisExecutionService } from "../../apps/ai-analysis-service/src/execution/ai-analysis-execution.service.js";
import { AiAnalysisService } from "../../apps/ai-analysis-service/src/analysis/ai-analysis.service.js";

// Un parámetro `X | null` se compila como `Object`; sin @Inject explícito Nest
// entrega null y el avance por puntos de la IA local nunca se leía.
test("AiAnalysisService recibe AiAnalysisExecutionService por @Inject explícito", () => {
  const declared = (Reflect.getMetadata("self:paramtypes", AiAnalysisService) ??
    []) as Array<{ index: number; param: unknown }>;
  const injected = declared.find(
    (entry) => entry.param === AiAnalysisExecutionService,
  );
  assert.ok(
    injected,
    "el parámetro executionService debe declarar @Inject(AiAnalysisExecutionService)",
  );
  const constructorLength = AiAnalysisService.length;
  assert.ok(injected.index < constructorLength + 8);
});
