import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLocalOnlyV2SectionContent } from "../../apps/ai-analysis-service/src/execution/local-only-v2-section-content";
import {
  removeIntrusiveScripts,
  sanitizeLocalOnlyV2GeneratedContent,
  stripInlineMarkdown,
  stripLabelPrefix,
  trimDanglingTail,
  truncateAtBoundary,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-text-hygiene";

const PENDING = "[PENDIENTE POR DEFINIR]";

test("truncateAtBoundary nunca parte una palabra ni excede el máximo", () => {
  const text =
    "El sistema debe registrar la solicitud y validar los campos obligatorios antes del envío";
  for (let max = 10; max < text.length; max += 3) {
    const result = truncateAtBoundary(text, max);
    assert.ok(result.length <= max, `excede ${max}: ${result}`);
    assert.ok(
      text.startsWith(result),
      `no es un prefijo literal del original: ${result}`,
    );
    const next = text.charAt(result.length);
    assert.ok(
      next === "" || /\s/u.test(next) || /[.,;:]$/u.test(result),
      `parte una palabra en ${max}: ${result}`,
    );
  }
});

test("truncateAtBoundary prefiere el último cierre de oración y no deja conectores", () => {
  assert.equal(
    truncateAtBoundary(
      "Se registra la solicitud. Luego se valida la información para la",
      55,
    ),
    "Se registra la solicitud.",
  );
  assert.equal(
    truncateAtBoundary("Configurar reglas de negocio para la revisión", 36),
    "Configurar reglas de negocio",
  );
  assert.equal(truncateAtBoundary("Texto corto", 50), "Texto corto");
});

test("trimDanglingTail retira conectores, separadores y paréntesis abiertos", () => {
  assert.equal(trimDanglingTail("Validar campos de"), "Validar campos");
  assert.equal(
    trimDanglingTail("Usuario aprobador (grupo de aprobación"),
    "Usuario aprobador",
  );
  assert.equal(trimDanglingTail("Plan A"), "Plan A");
  assert.equal(trimDanglingTail("Completo."), "Completo.");
});

test("removeIntrusiveScripts elimina CJK y conserva el español", () => {
  assert.equal(
    removeIntrusiveScripts("verifica existencia de documentos y registros付"),
    "verifica existencia de documentos y registros",
  );
  assert.equal(
    removeIntrusiveScripts("Gestión de niños y señalización"),
    "Gestión de niños y señalización",
  );
});

test("stripInlineMarkdown quita negritas y encabezados sin tocar asteriscos aislados", () => {
  assert.equal(
    stripInlineMarkdown(
      "**Prototipo: Flujo de Solicitud**\n1. **Registro**: formulario",
    ),
    "Prototipo: Flujo de Solicitud\n1. Registro: formulario",
  );
  assert.equal(
    stripInlineMarkdown("## Título\ncontenido"),
    "Título\ncontenido",
  );
  assert.equal(stripInlineMarkdown("5 * 3 = 15"), "5 * 3 = 15");
});

test("stripLabelPrefix retira rótulos encadenados y conserva el resto", () => {
  assert.equal(
    stripLabelPrefix("INCLUIDO: Plataforma D365 para extracción"),
    "Plataforma D365 para extracción",
  );
  assert.equal(
    stripLabelPrefix(
      "Correspondencia AS-IS/TO-BE: Estado Actual (AS-IS): Procesamiento manual",
    ),
    "Procesamiento manual",
  );
  assert.equal(stripLabelPrefix("Objetivo: "), "Objetivo:");
  assert.equal(stripLabelPrefix("Sin rótulo"), "Sin rótulo");
});

test("sanitize corrige un texto que llenó el presupuesto y quedó cortado", () => {
  const max = 60;
  const cut =
    "Se asume que el proveedor mantendrá las políticas actuales. Pregún";
  const result = sanitizeLocalOnlyV2GeneratedContent(cut, max);
  assert.equal(
    result,
    "Se asume que el proveedor mantendrá las políticas actuales.",
  );
});

test("sanitize retira el conector final de una línea de contrato sin tocar las demás", () => {
  const content = [
    "TAREA | T-004 | Probar validaciones | Prueba",
    "TAREA | T-005 | Configurar reglas de negocio para la",
  ].join("\n");
  assert.equal(
    sanitizeLocalOnlyV2GeneratedContent(content, 900),
    [
      "TAREA | T-004 | Probar validaciones | Prueba",
      "TAREA | T-005 | Configurar reglas de negocio",
    ].join("\n"),
  );
});

test("sanitize no modifica un contenido completo y limpio", () => {
  const clean = "- Dependencia con D365.\n- Restricción de correo.";
  assert.equal(sanitizeLocalOnlyV2GeneratedContent(clean, 900), clean);
});

test("sanitize combina CJK y Markdown", () => {
  assert.equal(
    sanitizeLocalOnlyV2GeneratedContent(
      "**Registro**: documentos y registros付.",
      900,
    ),
    "Registro: documentos y registros.",
  );
});

test("Alcance retira INCLUIDO/Excluido después de clasificar", () => {
  const result = normalizeLocalOnlyV2SectionContent(
    "scope",
    "INCLUIDO: Formulario web para registrar solicitudes. Control de acceso por rol de usuario. Excluido: Generación final del comprobante semanal.",
    {},
  ) as { included: string[]; excluded: string[] };
  assert.deepEqual(result.included, [
    "Formulario web para registrar solicitudes.",
    "Control de acceso por rol de usuario.",
  ]);
  assert.deepEqual(result.excluded, [
    "Generación final del comprobante semanal.",
  ]);
});

test("Solución propuesta retira rótulos de las tarjetas y conserva su clasificación", () => {
  const result = normalizeLocalOnlyV2SectionContent(
    "solutionProposal",
    "Objetivo: Implementar un formulario web integrado a D365 para digitalizar solicitudes. Correspondencia AS-IS/TO-BE: Estado Actual (AS-IS): Procesamiento manual sin control de estados. Evaluación: La falta de integración genera riesgos de errores.",
    {},
  ) as {
    objective: string;
    flowAlignment: {
      currentState: string;
      evaluation: string;
      expectedResult: string;
    };
  };
  assert.match(result.objective, /^Implementar un formulario web/u);
  assert.equal(
    result.flowAlignment.currentState,
    "Procesamiento manual sin control de estados.",
  );
  assert.equal(
    result.flowAlignment.evaluation,
    "La falta de integración genera riesgos de errores.",
  );
  for (const value of Object.values(result.flowAlignment)) {
    assert.doesNotMatch(
      value,
      /^(?:objetivo|evaluaci|correspondencia|estado actual)/iu,
    );
  }
});

test("Objetivos usa el marcador exacto cuando faltan objetivos", () => {
  const result = normalizeLocalOnlyV2SectionContent(
    "objectives",
    [
      "Objetivo general: Centralizar la gestión de solicitudes.",
      "Objetivos específicos cualitativos:",
      "1. Estandarizar el registro.",
      "Objetivos específicos cuantitativos:",
      "1. Reducir el tiempo de respuesta.",
    ].join("\n"),
    {},
  ) as { qualitative: string[]; quantitative: string[] };
  assert.equal(result.qualitative.length, 4);
  assert.equal(result.quantitative.length, 3);
  const placeholders = [...result.qualitative, ...result.quantitative].filter(
    (item) => /PENDIENTE POR DEFINIR/iu.test(item),
  );
  assert.ok(placeholders.length > 0);
  for (const item of placeholders) assert.equal(item, PENDING);
});
