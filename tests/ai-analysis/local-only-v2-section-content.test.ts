import assert from "node:assert/strict";
import test from "node:test";

import type { DocumentJsonValue } from "@levantamiento-rq/shared-contracts";

import { normalizeLocalOnlyV2SectionContent } from "../../apps/ai-analysis-service/src/execution/local-only-v2-section-content";

const currentHeader: DocumentJsonValue = {
  title: "Proceso de Soat",
  code: "RQ-2026-000309",
  version: "1.0.21",
  date: "2026-09-21",
  requestingArea: "Área Centralizadora de Solicitudes",
  status: "BORRADOR",
};

test("LOCAL_ONLY_V2 adapta los primeros seis puntos al contrato del editor", () => {
  assert.deepEqual(
    normalizeLocalOnlyV2SectionContent(
      "header",
      "Título inventado (LOCAL_ONLY_V2), versión 1.0 y fecha sin definir",
      currentHeader,
    ),
    currentHeader,
  );

  const objectives = normalizeLocalOnlyV2SectionContent(
    "objectives",
    "Objetivo general: Automatizar la gestión de solicitudes.\nObjetivos específicos:\n- Reducir reprocesos.\n- Mejorar la trazabilidad.",
    {},
  ) as Record<string, unknown>;
  assert.equal(objectives.general, "Automatizar la gestión de solicitudes.");
  assert.equal((objectives.qualitative as unknown[]).length, 4);
  assert.equal((objectives.quantitative as unknown[]).length, 3);
  assert.deepEqual((objectives.qualitative as string[]).slice(0, 2), [
    "Reducir reprocesos.",
    "Mejorar la trazabilidad.",
  ]);
  assert.match(
    (objectives.quantitative as string[])[0] ?? "",
    /PENDIENTE POR DEFINIR/u,
  );

  const problem = normalizeLocalOnlyV2SectionContent(
    "problemDescription",
    "La solicitud se registra manualmente. Los reprocesos generan demoras operativas. Existe riesgo de error en la digitación.",
    {},
  ) as Record<string, unknown>;
  assert.equal(problem.currentState instanceof String, false);
  assert.equal((problem.operationalImpact as unknown[]).length, 2);

  const problemWithManyImpacts = normalizeLocalOnlyV2SectionContent(
    "problemDescription",
    "Actualmente el proceso es manual. Existe demora operativa. Hay riesgo de rechazo. Ocurren errores de digitación. Se presentan reprocesos frecuentes. Existe pérdida de trazabilidad. La operación tiene sobrecarga. También hay ineficiencia en la conciliación.",
    {},
  ) as Record<string, unknown>;
  assert.equal(
    (problemWithManyImpacts.operationalImpact as unknown[]).length,
    5,
  );

  const scope = normalizeLocalOnlyV2SectionContent(
    "scope",
    "Incluye el formulario y la integración con D365. Fuera de alcance: reportes avanzados para una segunda etapa. Participan ERP D365, correo, Cero Papel y plataforma Lockton.",
    {},
  ) as Record<string, unknown>;
  assert.ok((scope.included as unknown[]).length > 0);
  assert.ok((scope.excluded as unknown[]).length > 0);
  assert.deepEqual(scope.involvedSystems, [
    "Microsoft Dynamics 365 (D365)",
    "Cero Papel",
    "Plataforma Lockton",
  ]);
  assert.ok((scope.included as unknown[]).length <= 10);
  assert.ok((scope.excluded as unknown[]).length <= 5);

  const solution = normalizeLocalOnlyV2SectionContent(
    "solutionProposal",
    "Centralizar y automatizar la gestión de solicitudes. La situación actual depende de correo. La evaluación identifica una brecha de trazabilidad. El resultado TO-BE integra D365.",
    {},
  ) as Record<string, unknown>;
  assert.equal(typeof solution.objective, "string");
  assert.equal(typeof solution.description, "string");
  assert.ok(Array.isArray(solution.involvedElements));
  assert.ok((solution.description as string).length <= 700);
  assert.ok((solution.involvedElements as unknown[]).length <= 4);
  assert.equal(typeof solution.flowAlignment, "object");

  const process = normalizeLocalOnlyV2SectionContent(
    "processFlow",
    "Diagrama de flujo AS-IS y TO-BE:\n1. Registrar solicitud manual.\n2. Validar por correo.\nProblema: existen errores de digitación.\nProblema: ocurren demoras en la aprobación.\nProblema: hay reprocesos por datos incompletos.\nProblema: existe riesgo de rechazo.\nProblema: se pierde la trazabilidad.\nTO-BE\n1. Registrar formulario digital.\n2. Validar automáticamente.\nAutomatizar la carga de datos.\nIntegrar D365 con el formulario.\nCentralizar las aprobaciones.\nEnviar notificaciones automáticas.\nMejorar la trazabilidad.\nEl resultado esperado es reducir los errores.",
    {},
  ) as Record<string, unknown>;
  const flows = process.processFlows as Record<string, Record<string, unknown>>;
  assert.ok((flows.asIs.nodes as unknown[]).length >= 2);
  assert.ok((flows.toBe.nodes as unknown[]).length >= 2);
  assert.equal((flows.asIs.problems as unknown[]).length, 5);
  assert.equal((flows.toBe.improvements as unknown[]).length, 5);
  assert.ok((flows.toBe.expectedResults as unknown[]).length > 0);
  assert.equal(
    (flows.asIs.nodes as { label: string }[]).some((node) =>
      /diagrama de flujo/iu.test(node.label),
    ),
    false,
  );
  assert.equal(process.entityRelationship, null);
});

test("processFlow con contrato canónico: AS-IS no hereda contenido exclusivo de TO-BE y TO-BE no es una copia del AS-IS", () => {
  const asIsContent = [
    "FLUJO AS-IS",
    "CARRIL | ASIS-L01 | Solicitante | ACTOR",
    "NODO | ASIS-N01 | ASIS-L01 | START | Registra la solicitud en papel",
    "NODO | ASIS-N02 | ASIS-L01 | PROCESS | Radica la solicitud en ventanilla",
    "NODO | ASIS-N03 | ASIS-L01 | END | Archiva la solicitud",
    "ARISTA | ASIS-N01 | ASIS-N02 | ",
    "ARISTA | ASIS-N02 | ASIS-N03 | ",
    "PROBLEMA | El registro en papel genera pérdida de información.",
  ].join("\n");
  const toBeContent = [
    "FLUJO TO-BE",
    "CARRIL | TOBE-L01 | Solicitante | ACTOR",
    "CARRIL | TOBE-L02 | Portal web | SYSTEM",
    "NODO | TOBE-N01 | TOBE-L01 | START | Radica la solicitud en el portal",
    "NODO | TOBE-N02 | TOBE-L02 | SYSTEM | Valida automáticamente los datos",
    "NODO | TOBE-N03 | TOBE-L01 | END | Recibe la confirmación",
    "ARISTA | TOBE-N01 | TOBE-N02 | ",
    "ARISTA | TOBE-N02 | TOBE-N03 | ",
    "MEJORA | Elimina el registro manual en papel.",
    "RESULTADO | Reduce la pérdida de información.",
  ].join("\n");

  const normalized = normalizeLocalOnlyV2SectionContent(
    "processFlow",
    [asIsContent, toBeContent].join("\n"),
    {},
  ) as Record<string, unknown>;
  const flows = normalized.processFlows as Record<
    string,
    Record<string, unknown>
  >;

  // AS-IS no contiene mejoras/resultados (exclusivos del TO-BE).
  assert.deepEqual(flows.asIs.improvements, []);
  assert.deepEqual(flows.asIs.expectedResults, []);
  assert.deepEqual(flows.asIs.problems, [
    "El registro en papel genera pérdida de información.",
  ]);

  // TO-BE no es una copia del AS-IS: distinto número de carriles/pasos y
  // contenido propio (mejora/resultado), no problemas.
  assert.equal((flows.asIs.lanes as unknown[]).length, 1);
  assert.equal((flows.toBe.lanes as unknown[]).length, 2);
  assert.notDeepEqual(
    (flows.asIs.nodes as Array<{ label: string }>).map((node) => node.label),
    (flows.toBe.nodes as Array<{ label: string }>).map((node) => node.label),
  );
  assert.deepEqual(flows.toBe.problems, []);
  assert.deepEqual(flows.toBe.improvements, [
    "Elimina el registro manual en papel.",
  ]);
});
