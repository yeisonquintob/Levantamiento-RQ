import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  appendUniqueSourceFiles,
  composeQuestionnaireEvidence,
  parseDiscussionSourceSelectionCounts,
  REQUIREMENTS_QUESTION_IDS,
  REQUIREMENTS_QUESTIONNAIRE,
} from "../../apps/web/src/app/workspace/sources/source-capture-helpers";

test("el cuestionario conserva sus seis bloques y 31 preguntas", () => {
  assert.equal(REQUIREMENTS_QUESTIONNAIRE.length, 6);
  assert.equal(REQUIREMENTS_QUESTION_IDS.length, 31);
  assert.equal(new Set(REQUIREMENTS_QUESTION_IDS).size, 31);
});

test("el indicador cuenta selecciones solo después de agregar la discusión", () => {
  const selections = {
    "discovery-current-need": "ORIGINAL",
    "discovery-urgency-impact": "LOCAL",
    "discovery-expected-result": "CLOUD",
  };
  assert.deepEqual(
    parseDiscussionSourceSelectionCounts(
      JSON.stringify({ selectedAnswers: selections }),
    ),
    { manual: 0, local: 0, cloud: 0 },
  );
  assert.deepEqual(
    parseDiscussionSourceSelectionCounts(
      JSON.stringify({ sourceId: "source-1", selectedAnswers: selections }),
    ),
    { manual: 1, local: 1, cloud: 1 },
  );
});

test("las preguntas marcadas quedan incorporadas como evidencia textual", () => {
  const selected = new Set(["discovery-current-need", "acceptance-production"]);
  const content = composeQuestionnaireEvidence(
    "La operación se realiza en hojas de cálculo.",
    selected,
  );

  assert.match(content, /^La operación se realiza/u);
  assert.match(content, /CUESTIONARIO DE LEVANTAMIENTO APLICADO/u);
  assert.match(content, /1\. Descubrimiento y contexto/u);
  assert.match(content, /6\. Criterios de aceptación/u);
  assert.match(content, /- \[x\] ¿Qué problema o necesidad/u);
  assert.match(content, /- \[x\] ¿Qué condiciones deben cumplirse/u);
  assert.doesNotMatch(content, /¿Qué datos actuales podemos utilizar/u);
});

test("una nueva selección de archivos se acumula sin borrar la anterior", () => {
  const first = { name: "entrevista.pdf", size: 100, lastModified: 1 };
  const second = { name: "proceso.docx", size: 200, lastModified: 2 };
  const result = appendUniqueSourceFiles([first], [second]);

  assert.deepEqual(result.files, [first, second]);
  assert.equal(result.addedCount, 1);
  assert.equal(result.duplicateCount, 0);
});

test("la acumulación evita duplicados y respeta el máximo de 20", () => {
  const current = Array.from({ length: 19 }, (_, index) => ({
    name: `archivo-${index}.pdf`,
    size: index + 1,
    lastModified: index + 1,
  }));
  const duplicate = current[0];
  assert.ok(duplicate);
  const accepted = { name: "nuevo.pdf", size: 50, lastModified: 50 };
  const overflow = { name: "otro.pdf", size: 51, lastModified: 51 };
  const result = appendUniqueSourceFiles(current, [
    duplicate,
    accepted,
    overflow,
  ]);

  assert.equal(result.files.length, 20);
  assert.equal(result.addedCount, 1);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.overflowCount, 1);
  assert.equal(result.files.at(-1), accepted);
});

test("Nueva fuente presenta captura y cuestionario en columnas y acumula selecciones", async () => {
  const workspace = await readFile(
    "apps/web/src/app/workspace/sources/sources-workspace.tsx",
    "utf8",
  );

  assert.match(workspace, /className="rq-source-text-capture"/u);
  assert.match(workspace, /appendUniqueSourceFiles\(/u);
  assert.match(workspace, /event\.currentTarget\.value = ""/u);
});
