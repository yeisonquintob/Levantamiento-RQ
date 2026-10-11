import assert from "node:assert/strict";
import test from "node:test";
import type { ViabilityCriterion } from "../../libs/shared/contracts/src/index";
import { evaluateDiscussionViability, evaluateViability, isInsufficientDiscussionAnswer, validateViabilityCriteria } from "../../libs/shared/contracts/src/index";

const criteria: ViabilityCriterion[] = Array.from({ length: 10 }, (_, index) => ({ id: String(index + 1), level: index + 1, minimumPercentage: index === 0 ? 0 : index * 10 + 1, maximumPercentage: (index + 1) * 10, name: `Nivel ${index + 1}`, description: "Descripción", recommendation: "Recomendación", viable: index >= 5, order: index + 1, active: true }));

test("evalúa correctamente todos los límites de los rangos", () => {
  for (const item of criteria) {
    assert.equal(evaluateViability(item.minimumPercentage, criteria).level, item.level);
    assert.equal(evaluateViability(item.maximumPercentage, criteria).level, item.level);
  }
});

test("rechaza vacíos y solapamientos", () => {
  assert.ok(validateViabilityCriteria(criteria.map((item, index) => index === 1 ? { ...item, minimumPercentage: 10 } : item)).some((error) => error.includes("solapamiento")));
  assert.ok(validateViabilityCriteria(criteria.map((item, index) => index === 1 ? { ...item, minimumPercentage: 12 } : item)).some((error) => error.includes("vacío")));
});

test("detecta respuestas insuficientes sin IA", () => {
  assert.equal(isInsufficientDiscussionAnswer(""), true);
  assert.equal(isInsufficientDiscussionAnswer("Información insuficiente para determinarlo."), true);
  assert.equal(isInsufficientDiscussionAnswer("El responsable es el área de logística y el plazo acordado es de 15 días."), false);
});

test("consolida por la mejor evidencia utilizable y detecta discrepancias", () => {
  const answer = (definitionPercentage: number) => ({ answer: "Respuesta concreta con responsable, alcance y plazo verificable.", definitionPercentage });
  const result = evaluateDiscussionViability({ questionIds: ["q1", "q2"], manual: { q1: answer(50) }, local: { q1: answer(80), q2: { answer: "Información insuficiente.", definitionPercentage: 90 } }, cloud: { q1: answer(70), q2: answer(60) }, criteria, discrepancyThreshold: 25 });
  assert.equal(result.consolidated.definitionPercentage, 70);
  assert.equal(result.consolidated.usable, 2);
  assert.equal(result.local.requiresReview, 1);
  assert.equal(result.hasSignificantDiscrepancy, true);
});
