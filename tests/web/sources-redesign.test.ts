// Rediseño focalizado de la pantalla «Fuentes del levantamiento»: estado único,
// lenguaje funcional, divulgación técnica, etiquetas honestas y apariencia
// (4 temas × 4 tamaños de texto).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as ReactAll from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// El panel usa el runtime JSX clásico bajo tsx; Next usa el automático.
(globalThis as unknown as { React: unknown }).React = ReactAll;

import { SourcesGenerationPanel } from "../../apps/web/src/app/workspace/sources/sources-generation-panel";
import {
  classifyGenerationFailure,
  describeGenerationOutcome,
  sourceGenerationCell,
  sourcePreparationLabel,
} from "../../apps/web/src/app/workspace/sources/sources-generation-summary";
import { readStyles } from "../support/read-styles";

const DIR = "apps/web/src/app/workspace/sources/";
const AMBIGUOUS_MESSAGE =
  "OpenAI devolvió una salida estructurada inconsistente: scope.kpis[0].relatedObjective no referencia de forma inequívoca un objetivo específico cualitativo o cuantitativo generado. Hay varias referencias igualmente plausibles; no se reintenta para no elegir un objetivo de forma arbitraria.";
const UNREPAIRED_MESSAGE =
  "OpenAI devolvió una salida estructurada inconsistente: scope.kpis[1].relatedObjective no referencia de forma inequívoca un objetivo específico cualitativo o cuantitativo generado. El reintento localizado no obtuvo una referencia única y segura a un objetivo específico.";
const NO_MATCH_MESSAGE =
  "scope.kpis[2].relatedObjective no referencia de forma inequívoca un objetivo específico cualitativo o cuantitativo generado.";

function render(outcomeInput: Parameters<typeof describeGenerationOutcome>[0]) {
  const outcome = describeGenerationOutcome(outcomeInput);
  return {
    outcome,
    markup: renderToStaticMarkup(
      createElement(SourcesGenerationPanel, {
        outcome,
        progress: 92,
        reviewHref: "/workspace/documents/doc-1",
      }),
    ),
  };
}

const count = (text: string, needle: string): number =>
  text.split(needle).length - 1;

// ---------------------------------------------------------------- estado único

test("el estado general se muestra una sola vez, sin porcentaje ni encabezado duplicados", () => {
  const { markup } = render({
    status: "FAILED",
    errorCode: "OPENAI_STRUCTURED_OUTPUT_INVALID",
    errorMessage: AMBIGUOUS_MESSAGE,
  });
  assert.equal(count(markup, "Fallida"), 1);
  assert.equal(count(markup, "92%"), 1);
  assert.doesNotMatch(markup, /Resumen de ejecución · Resumen de ejecución/u);
  assert.equal(count(markup, "Resumen de ejecución"), 0);
});

test("los cuatro estados terminales y activos usan una sola etiqueta visible", () => {
  const cases = [
    ["COMPLETED", "Completada"],
    ["PROCESSING", "En proceso"],
    ["PENDING", "En cola"],
    ["CANCELLED", "Cancelada"],
    ["FAILED", "Fallida"],
  ] as const;
  for (const [status, label] of cases) {
    const { markup, outcome } = render({ status });
    assert.equal(outcome.statusLabel, label);
    assert.equal(count(markup, label), 1, `${status}: «${label}» repetida`);
  }
});

test("el estado activo y el único reloj comparten fila y usan el azul de la barra", async () => {
  const outcome = describeGenerationOutcome({ status: "PROCESSING" });
  const markup = renderToStaticMarkup(
    createElement(SourcesGenerationPanel, {
      // El reloj lo mueve un componente propio a partir del inicio de la ejecución.
      elapsedSince: new Date(Date.now() - 79 * 60_000).toISOString(),
      outcome,
      progress: 89,
    }),
  );
  const css = await readStyles();

  assert.equal(count(markup, "Tiempo transcurrido"), 1);
  assert.match(
    markup,
    /class="rq-gen__state"[\s\S]*?class="rq-gen__elapsed"[\s\S]*?En proceso/u,
  );
  assert.match(
    css,
    /data-rq-state="active"[\s\S]*?\.rq-gen__state[\s\S]*?background: var\(--rq-gen-bar\)/u,
  );
});

test("sin solicitud iniciada el panel indica que está lista, sin simular una ejecución", () => {
  const outcome = describeGenerationOutcome({
    status: null,
    selectedSourceCount: 3,
  });
  assert.equal(outcome.state, "ready");
  assert.match(outcome.headline, /3 fuentes seleccionadas/u);
  assert.deepEqual(outcome.actions, []);
});

// ------------------------------------------------- mensaje funcional vs técnico

test("KPI ambiguo: lenguaje funcional, no reparable, sin ruta JSON ni código en el texto principal", () => {
  const { outcome, markup } = render({
    status: "FAILED",
    errorCode: "OPENAI_STRUCTURED_OUTPUT_INVALID",
    errorMessage: AMBIGUOUS_MESSAGE,
    technical: { requestId: "req-1", model: "gpt-5-mini", attempt: 1 },
  });
  assert.equal(outcome.failureKind, "KPI_AMBIGUOUS");
  assert.equal(outcome.repairable, false);
  assert.equal(
    outcome.headline,
    "No fue posible relacionar un indicador con un único objetivo",
  );
  assert.match(outcome.explanation ?? "", /más de un objetivo/u);
  assert.match(outcome.consequence ?? "", /No se aplicó el resultado/u);

  const main = `${outcome.headline} ${outcome.explanation} ${outcome.consequence}`;
  assert.doesNotMatch(main, /scope\.kpis|relatedObjective|OPENAI_/u);

  const technical = outcome.technical.map((row) => `${row.label}=${row.value}`);
  assert.ok(
    technical.some((row) => row === "Código=OPENAI_STRUCTURED_OUTPUT_INVALID"),
  );
  assert.ok(technical.some((row) => row === "Causa=KPI_OBJECTIVE_AMBIGUOUS"));
  assert.ok(
    technical.some((row) => row === "Ruta=scope.kpis[0].relatedObjective"),
  );
  assert.ok(technical.some((row) => row === "Modelo=gpt-5-mini"));

  // La ruta y el código ya no viven en el panel: solo en la pestaña técnica.
  assert.doesNotMatch(markup, /scope\.kpis|OPENAI_STRUCTURED/u);
});

test("KPI sin coincidencia (NO_MATCH) se distingue y es reparable; el reintento fallido no lo es", () => {
  assert.equal(
    classifyGenerationFailure(
      "OPENAI_STRUCTURED_OUTPUT_INVALID",
      NO_MATCH_MESSAGE,
    ),
    "KPI_NO_MATCH",
  );
  const noMatch = describeGenerationOutcome({
    status: "FAILED",
    errorMessage: NO_MATCH_MESSAGE,
  });
  assert.equal(noMatch.repairable, true);
  assert.match(noMatch.headline, /no coincide con ningún objetivo/u);

  const unrepaired = describeGenerationOutcome({
    status: "FAILED",
    errorMessage: UNREPAIRED_MESSAGE,
  });
  assert.equal(unrepaired.failureKind, "KPI_UNREPAIRED");
  assert.equal(unrepaired.repairable, false);
  assert.ok(
    unrepaired.technical.some(
      (row) => row.value === "KPI_OBJECTIVE_UNREPAIRED",
    ),
  );
});

test("el panel principal ya no gestiona un disclosure técnico propio", () => {
  const { markup } = render({
    status: "FAILED",
    errorCode: "OPENAI_STRUCTURED_OUTPUT_INVALID",
    errorMessage: AMBIGUOUS_MESSAGE,
  });
  assert.doesNotMatch(markup, /rq-gen__disclosure|aria-expanded/u);
  assert.doesNotMatch(markup, /Detalles técnicos|Ver detalles técnicos/u);
});

test("acciones por estado: completada sin duplicar Ver borrador; fallos con recuperación específica", () => {
  const completed = describeGenerationOutcome({
    status: "COMPLETED",
    hasDocument: true,
    technical: { requestId: "req-completed" },
  });
  assert.deepEqual(completed.actions, []);
  // Completada también expone filas técnicas (pestaña «Detalles técnicos»).
  assert.deepEqual(
    completed.technical.map((row) => row.key),
    [
      "request",
      "version",
      "model",
      "attempt",
      "duration",
      "tokens",
      "correlation",
    ],
  );
  const completedMarkup = render({
    status: "COMPLETED",
    hasDocument: true,
    technical: { requestId: "req-completed" },
  }).markup;
  assert.doesNotMatch(completedMarkup, /Revisar resultado/u);
  assert.doesNotMatch(completedMarkup, /Detalles técnicos/u);

  const failed = describeGenerationOutcome({
    status: "FAILED",
    errorMessage: AMBIGUOUS_MESSAGE,
  });
  assert.deepEqual(failed.actions, ["technical-details"]);

  const withCheckpoint = describeGenerationOutcome({
    status: "FAILED",
    errorMessage: "Falla genérica",
    hasCheckpoint: true,
  });
  assert.deepEqual(withCheckpoint.actions, [
    "retry-checkpoint",
    "technical-details",
  ]);

  const apply = describeGenerationOutcome({
    status: "FAILED",
    errorCode: "AI_AUTO_APPLY_UNAVAILABLE",
    providerCompleted: true,
  });
  assert.deepEqual(apply.actions, ["retry-application", "technical-details"]);
  assert.match(apply.consequence ?? "", /sin volver a consumir IA en la nube/u);

  assert.deepEqual(
    describeGenerationOutcome({ status: "PROCESSING" }).actions,
    [],
  );
  assert.deepEqual(describeGenerationOutcome({ status: "CANCELLED" }).actions, [
    "technical-details",
  ]);
  for (const status of ["FAILED", "CANCELLED"] as const) {
    assert.doesNotMatch(
      render({ status, errorMessage: AMBIGUOUS_MESSAGE }).markup,
      /Reintentar generación/u,
    );
  }
});

test("el mensaje genérico del proveedor no se presenta como explicación principal", () => {
  const outcome = describeGenerationOutcome({
    status: "FAILED",
    errorMessage: "Error 500 interno de un proveedor desconocido",
    stageLabel: "Generación en nube",
  });
  assert.equal(outcome.failureKind, "GENERIC");
  assert.doesNotMatch(
    `${outcome.headline} ${outcome.explanation}`,
    /Error 500/u,
  );
  assert.match(outcome.explanation ?? "", /Generación en nube/u);
  assert.ok(outcome.technical.some((row) => /Error 500/u.test(row.value)));
});

// --------------------------------------------- teclado, foco y regiones aria-live

test("el estado se anuncia en una región aria-live y el panel no gestiona technicalOpen", async () => {
  const panel = await readFile(`${DIR}sources-generation-panel.tsx`, "utf8");
  assert.doesNotMatch(panel, /technicalOpen|technicalToggle/u);
  assert.match(panel, /aria-live="polite"/u);
  assert.match(panel, /role="status"/u);
  assert.match(panel, /aria-atomic="true"/u);
  // El reloj no está dentro de la región viva: no anuncia cada segundo.
  const live = panel.split('role="status"')[1]?.split("</div>")[0] ?? "";
  assert.doesNotMatch(live, /Tiempo transcurrido/u);
});

// --------------------------------------------------------- etiquetas honestas

test("las etiquetas describen el comportamiento real: Archivar, Activas, Preparadas y modo de IA", async () => {
  const [source, processingMenu] = await Promise.all([
    readFile(`${DIR}sources-workspace.tsx`, "utf8"),
    readFile("apps/web/src/app/workspace/ai-engine-selection.tsx", "utf8"),
  ]);
  assert.match(source, />\s*Archivar\s*</u);
  assert.doesNotMatch(source, />\s*Eliminar\s*</u);
  assert.match(source, /Archivadas/u);
  assert.match(source, /no se elimina físicamente/iu);
  assert.doesNotMatch(source, /title="Listas"/u);
  assert.match(source, /title="Fuentes"/u);
  assert.doesNotMatch(source, /title="Preparadas"/u);
  assert.match(source, /description="Activas \/ preparadas"/u);
  assert.match(
    source,
    /value=\{`\$\{Math\.max\(metrics\.total - metrics\.archived, 0\)\} \/ \$\{metrics\.ready\}`\}/u,
  );
  assert.equal((source.match(/<RqKpiCard/gu) ?? []).length, 3);
  assert.doesNotMatch(source, /fuente\(s\) procesada\(s\)/u);
  assert.match(source, /Preparación del archivo/u);
  assert.match(source, /En la generación/u);
  assert.match(processingMenu, /label = "Procesamiento IA"/u);
  assert.match(processingMenu, /<span>\{label\}<\/span>/u);
  assert.match(source, /<AiProcessingMenu\s+label="IA"/u);
  assert.doesNotMatch(processingMenu, /IA para generar el documento/u);
  assert.doesNotMatch(source, /className="rq-source-group-label"/u);

  assert.deepEqual(sourcePreparationLabel("READY"), {
    symbol: "✓",
    label: "Preparada",
  });
  // Estado de toda la generación → «Incluida»; estado propio de la fuente → se conserva.
  assert.equal(sourceGenerationCell(true, "Fallida").label, "Incluida");
  assert.equal(sourceGenerationCell(true, "Completada").label, "Incluida");
  assert.equal(sourceGenerationCell(true, "Analizada").label, "Analizada");
  assert.equal(sourceGenerationCell(false, "Fallida").included, false);
});

test("la tabla conserva selección múltiple, acciones y encabezados accesibles", async () => {
  const source = await readFile(`${DIR}sources-workspace.tsx`, "utf8");
  assert.match(source, /Seleccionar todas las fuentes elegibles visibles/u);
  assert.match(source, /aria-label=\{`Seleccionar \$\{source\.title\}`\}/u);
  assert.equal(count(source, '<th scope="col"'), 9);
  assert.match(source, /Descargar/u);
  assert.match(source, /title=\{\s*source\.description/u);
});

// ------------------------------------------------------------------ apariencia

const THEMES = ["normal", "cold", "warm", "dark"] as const;
const SCALES = { compact: 0.92, normal: 1, large: 1.1, "extra-large": 1.2 };

function themeVars(css: string, theme: (typeof THEMES)[number]) {
  const selector =
    theme === "normal"
      ? /:root,\s*html\[data-rq-theme="normal"\] \{([\s\S]*?)\n\}/u
      : new RegExp(
          `html\\[data-rq-theme="${theme}"\\] \\{([\\s\\S]*?)\\n\\}`,
          "u",
        );
  const body = css.match(selector)?.[1] ?? "";
  const vars = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/gu)) {
    vars.set(m[1]!, m[2]!.trim());
  }
  return vars;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test("los cuatro temas definen tokens de texto semántico con contraste ≥ 4.5:1 sobre página, superficie y superficie suave", async () => {
  const css = await readStyles();
  const base = themeVars(css, "normal");
  for (const theme of THEMES) {
    const vars = new Map([...base, ...themeVars(css, theme)]);
    const get = (name: string) => {
      const value = vars.get(name);
      assert.ok(value, `${theme}: falta ${name}`);
      return value;
    };
    const backgrounds = [
      get("--rq-color-page"),
      get("--rq-color-surface"),
      get("--rq-color-surface-soft"),
    ];
    for (const token of [
      "--rq-color-text",
      "--rq-color-muted",
      "--rq-color-danger-text",
      "--rq-color-warning-text",
      "--rq-color-success-text",
      "--rq-color-info-text",
    ]) {
      for (const background of backgrounds) {
        const ratio = contrast(get(token), background);
        assert.ok(
          ratio >= 4.5,
          `${theme} ${token} sobre ${background}: ${ratio.toFixed(2)}:1`,
        );
      }
    }
  }
});

function rulesOf(css: string, selectorPrefix: RegExp): string[] {
  // Analizador de llaves: incluye reglas dentro de @media y descarta comentarios.
  const source = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  const rules: string[] = [];
  const stack: { selector: string; bodyStart: number }[] = [];
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") {
      stack.push({ selector: source.slice(start, i).trim(), bodyStart: i + 1 });
      start = i + 1;
    } else if (char === "}") {
      const open = stack.pop();
      if (open && !open.selector.startsWith("@")) {
        const body = source.slice(open.bodyStart, i);
        if (!body.includes("{") && selectorPrefix.test(open.selector)) {
          rules.push(`${open.selector} {${body}}`);
        }
      }
      start = i + 1;
    } else if (char === ";" && stack.length === 0) {
      start = i + 1;
    }
  }
  return rules;
}

test("el rediseño no usa alturas rígidas ni colores de error fijos", async () => {
  const css = await readStyles();
  const genRules = rulesOf(
    css,
    /\.rq-gen|\.rq-source-prep|\.rq-source-summary/u,
  );
  assert.ok(genRules.length > 20, "faltan las reglas consolidadas .rq-gen");
  for (const rule of genRules) {
    assert.doesNotMatch(
      rule,
      /(^|[\s;{])(height|max-height):\s*\d+(\.\d+)?px/u,
      `altura rígida: ${rule.slice(0, 80)}`,
    );
    assert.doesNotMatch(
      rule,
      /#[0-9a-f]{3,8}\b|rgb\((?!255 255 255)|\bred\b/iu,
      rule.slice(0, 80),
    );
    assert.doesNotMatch(rule, /font-size:\s*\d+px/u);
  }
  // Los colores de error del bloque usan el token semántico.
  const failed = genRules.filter((rule) =>
    /data-rq-state="failed"/u.test(rule),
  );
  assert.ok(failed.length > 0);
  for (const rule of failed) {
    assert.match(rule, /--rq-color-danger-text|--rq-gen-accent|--rq-gen-bar/u);
  }
  // El texto de Fuentes no usa el color de acción como color de texto.
  // El índice de proyectos (`.rq-sources-index`) tiene insignias delineadas con el color de acción
  // por diseño; la regla vigila el monitor y el resto de la pantalla de Fuentes.
  const sourceRules = rulesOf(
    css,
    /\.rq-source|\.rq-sources-workspace|\.rq-gen/u,
  ).filter((rule) => !/^\s*\.rq-sources-index/u.test(rule));
  for (const rule of sourceRules) {
    assert.doesNotMatch(
      rule,
      /(^|[\s;{])color:\s*var\(--rq-action-(danger|warning|affirmative)\)/u,
      rule.slice(0, 90),
    );
  }
});

test("ningún texto de Fuentes baja de 10 px efectivos en ninguno de los 4 tamaños", async () => {
  const css = await readStyles();
  const sourceRules = rulesOf(
    css,
    /\.rq-source|\.rq-sources-workspace|\.rq-gen|\.rq-local-draft/u,
  );
  for (const [name, scale] of Object.entries(SCALES)) {
    for (const rule of sourceRules) {
      for (const m of rule.matchAll(
        /font-size:\s*calc\(([\d.]+)(px|rem) \* var\(--rq-font-scale\)\)/gu,
      )) {
        const px = Number(m[1]) * (m[2] === "rem" ? 16 : 1) * scale;
        assert.ok(
          px >= 10,
          `${name}: ${px.toFixed(1)} px en «${rule.slice(0, 70)}»`,
        );
      }
    }
  }
});

test("las 16 combinaciones tema × tamaño existen y los tamaños escalan con --rq-font-scale", async () => {
  const css = await readStyles();
  assert.equal(THEMES.length * Object.keys(SCALES).length, 16);
  for (const theme of THEMES) {
    assert.match(css, new RegExp(`html\\[data-rq-theme="${theme}"\\]`, "u"));
  }
  for (const [font, scale] of Object.entries(SCALES)) {
    assert.match(
      css,
      new RegExp(
        `html\\[data-rq-font="${font}"\\] \\{\\s*--rq-font-scale: ${scale};`,
        "u",
      ),
    );
  }
});

test("la cuadrícula es flexible y responsive; el movimiento respeta prefers-reduced-motion", async () => {
  const css = await readStyles();
  assert.match(
    css,
    /\.rq-sources-workspace \.rq-gen \{[^}]*grid-template-columns: minmax\(0, 1fr\)/u,
  );
  assert.match(
    css,
    /@media \(max-width: 64rem\) \{\s*\.rq-sources-workspace \.rq-gen \{\s*grid-template-columns: minmax\(0, 1fr\)/u,
  );
  // Etapas: columnas iguales sin bordes ni fichas.
  assert.match(css, /\.rq-gen__pipeline \{[^}]*display: grid/u);
  assert.match(
    css,
    /\.rq-gen__pipeline\[data-rq-step-count="3"\] \{[^}]*repeat\(3, minmax\(0, 1fr\)\)/u,
  );
  assert.match(
    css,
    /\.rq-gen__pipeline\[data-rq-step-count="4"\] \{[^}]*repeat\(4, minmax\(0, 1fr\)\)/u,
  );
  assert.match(
    css,
    /\.rq-gen__pipeline\[data-rq-step-count="5"\] \{[^}]*repeat\(5, minmax\(0, 1fr\)\)/u,
  );
  assert.match(
    css,
    /\.rq-gen__pipeline li \{[^}]*block-size: 2rem;[^}]*border: 1px solid[^}]*border-radius[^}]*background:/u,
  );
  assert.match(css, /overflow-x: auto/u);
  const reduced =
    css.match(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.rq-gen \*[\s\S]*?\n\}/u,
    )?.[0] ?? "";
  assert.match(reduced, /animation: none !important/u);
  assert.match(reduced, /transition: none !important/u);
  assert.match(reduced, /rq-source-cloud-indeterminate/u);
  // Palabras completas: ni «anywhere» ni «break-all» fuera de los detalles técnicos.
  assert.doesNotMatch(
    css,
    /\.rq-source-table[^{]*\{[^}]*word-break:\s*break-all/u,
  );
  assert.match(
    css,
    /\.rq-gen__technical-list dd \{[^}]*overflow-wrap: anywhere/u,
  );
  // Detalles técnicos: filas compactas etiqueta–valor como General.
  assert.match(
    css,
    /\.rq-source-consumption-tabs \.rq-gen__technical-list > div \{[^}]*display: flex;[^}]*justify-content: space-between;[^}]*font-size: calc\(11px/u,
  );
  assert.match(
    css,
    /\.rq-source-consumption-tabs \.rq-gen__technical-list dd \{[^}]*overflow-wrap: anywhere;[^}]*text-align: right/u,
  );
});

test("las capas antiguas del monitor se eliminaron y las clases ya no se usan", async () => {
  const [css, source] = await Promise.all([
    readStyles(),
    readFile(`${DIR}sources-workspace.tsx`, "utf8"),
  ]);
  for (const dead of [
    "rq-source-generation-status",
    "rq-source-generation-monitor",
    "rq-source-generation-pipeline",
    "rq-source-generation-stage-card",
    "rq-source-generation-failure",
    "rq-source-processing-inline",
  ]) {
    assert.doesNotMatch(css, new RegExp(dead, "u"), `CSS conserva ${dead}`);
    assert.doesNotMatch(source, new RegExp(dead, "u"), `TSX usa ${dead}`);
  }
});

// Ajustes tras revisar la pantalla real (capturas del usuario).
test("una ejecución terminada no promete una corrección que no ofrece", () => {
  const outcome = describeGenerationOutcome({
    status: "FAILED",
    errorMessage: NO_MATCH_MESSAGE,
  });
  assert.doesNotMatch(outcome.explanation ?? "", /corrección|admite/iu);
});

test("la tabla acota el texto largo del archivo y no existe «Reintentar generación»", async () => {
  const [source, css] = await Promise.all([
    readFile(`${DIR}sources-workspace.tsx`, "utf8"),
    readStyles(),
  ]);
  assert.doesNotMatch(source, /Selecciona al menos una fuente en la tabla/u);
  assert.doesNotMatch(source, /Reintentar generación|"retry-generation"/u);
  assert.match(source, /<span title=\{fileDescription\(source\)\}>/u);
  assert.match(
    css,
    /\.rq-source-table__file > span \{[^}]*-webkit-line-clamp: 2/u,
  );
  assert.doesNotMatch(source, /Fuentes marcadas: manual/u);
});

test("la tarjeta lateral unifica General, Detalles técnicos y Mostrar en un tablist de tamaño estable", async () => {
  const [panel, source, css] = await Promise.all([
    readFile(`${DIR}sources-generation-panel.tsx`, "utf8"),
    readFile(`${DIR}sources-workspace.tsx`, "utf8"),
    readStyles(),
  ]);
  assert.match(css, /"title state controls"/u);
  assert.match(css, /\.rq-gen__live \{\s*display: contents;/u);
  assert.match(panel, /className="rq-gen__state"/u);
  // Tablist accesible con las tres vistas; General inicia activa.
  assert.match(source, /role="tablist"/u);
  assert.match(source, /role="tab"/u);
  assert.match(source, /role="tabpanel"/u);
  assert.match(source, /aria-selected=\{consumptionTab === tab\.id\}/u);
  assert.match(source, /useState<ConsumptionTab>\("general"\)/u);
  assert.match(source, /label: "General"/u);
  assert.match(source, /label: "Detalles técnicos"/u);
  assert.match(source, /label: "Mostrar"/u);
  assert.doesNotMatch(source, /tab\.hint/u);
  assert.match(source, /Aún no hay borrador por puntos para mostrar/u);
  assert.match(source, /generationOutcome\.technical\.map/u);
  assert.match(source, /Aún no hay detalles técnicos/u);
  // «Mostrar» controla el detalle por puntos; los botones antiguos desaparecen.
  assert.match(source, /draftProgressExpanded = consumptionTab === "show"/u);
  assert.doesNotMatch(source, /technicalToggle/u);
  assert.doesNotMatch(source, /draftProgressExpanded \? "Ocultar"/u);
  // Altura fija con área interna desplazable; la inactiva se ve atenuada.
  assert.match(
    css,
    /\.rq-sources-workspace \.rq-gen__side \{[^}]*block-size: 12rem;[^}]*overflow: hidden/u,
  );
  assert.match(
    css,
    /\.rq-source-consumption-tabs__panel \{[^}]*overflow: auto/u,
  );
  assert.match(
    css,
    /\.rq-source-consumption-tabs__tab \{[^}]*border: 0;[^}]*color: var\(--rq-color-muted\)/u,
  );
  assert.match(
    css,
    /\.rq-source-consumption-tabs__list \{[^}]*flex-wrap: nowrap/u,
  );
  assert.match(
    css,
    /\.rq-sources-workspace \.rq-gen \{[^}]*minmax\(16rem, 20rem\)/u,
  );
  // El detalle por puntos vive en el panel Mostrar, no bajo el procesamiento.
  assert.doesNotMatch(source, /draftProgress=\{/u);
  assert.match(
    source,
    /id="rq-consumption-panel-show"[\s\S]*renderDraftNode\(\)/u,
  );
});

test("la tarjeta de tokens se conserva y cambia según el modo: local, híbrido (mejora de tokens) y nube (costo)", async () => {
  const [source, panel, css] = await Promise.all([
    readFile(`${DIR}sources-workspace.tsx`, "utf8"),
    readFile(`${DIR}sources-generation-panel.tsx`, "utf8"),
    readStyles(),
  ]);
  const card =
    source.split("const generalConsumptionNode = (")[1]?.split("\n  );")[0] ??
    "";
  assert.match(source, /tokenCardMode/u);
  assert.match(source, /"Mejora de tokens"/u);
  assert.match(source, /"Costo estimado"/u);
  assert.match(source, /"Consumo local"/u);
  assert.match(card, /tokens analizados en local/u);
  assert.match(card, /tokens estimados de entrada/u);
  assert.match(card, /Costo estimado:/u);
  assert.match(card, /buildTokenBreakdownRows/u);
  assert.match(card, /\{tokenEstimate\.reductionPercentage/u);
  // La tarjeta lateral existe y el bloque de estado no es una tarjeta.
  assert.match(
    panel,
    /<aside aria-label="Consumo de la ejecución" className="rq-gen__side">/u,
  );
  assert.match(
    css,
    /\.rq-sources-workspace \.rq-gen__main \{(?:(?!border|background)[^}])*\}/u,
  );
});

test("los indicadores importantes incluyen el modo de procesamiento de IA", async () => {
  const source = await readFile(`${DIR}sources-workspace.tsx`, "utf8");
  const bar =
    source
      .split('className="rq-module-commandbar"')[1]
      ?.split("rq-ai-processing-options")[0] ?? "";
  assert.equal((bar.match(/<RqKpiCard/gu) ?? []).length, 3);
  assert.match(bar, /<RqKpiGrid/u);
  for (const title of ["Fuentes", "Discusión", "Procesamiento IA"]) {
    assert.match(bar, new RegExp(`title="${title}"`, "u"));
  }
  assert.doesNotMatch(
    bar,
    /title="(Preparadas|Activas|Con error|Archivos|Textuales|Listas)"/u,
  );
  assert.doesNotMatch(bar, /Más métricas|rq-source-more-metrics/u);
});

test("Nueva fuente está junto a Limpiar y no en la barra superior", async () => {
  const source = await readFile(`${DIR}sources-workspace.tsx`, "utf8");
  const commandbar = source.slice(
    source.indexOf('className="rq-module-commandbar"'),
    source.indexOf('className="rq-projects-filters"'),
  );
  const filters = source.slice(
    source.indexOf('className="rq-projects-filters"'),
    source.indexOf('<RqTableShell title="Fuentes">'),
  );

  assert.doesNotMatch(commandbar, />\s*Nueva fuente\s*</u);
  assert.match(filters, />\s*Limpiar\s*</u);
  assert.match(filters, />\s*Nueva fuente\s*</u);
  assert.match(filters, /rq-projects-filters/u);
});

test("el KPI de procesamiento muestra el modo de IA, no el selector de versión", async () => {
  const [source, panel, css] = await Promise.all([
    readFile(`${DIR}sources-workspace.tsx`, "utf8"),
    readFile(`${DIR}sources-generation-panel.tsx`, "utf8"),
    readStyles(),
  ]);

  assert.doesNotMatch(panel, /Generación · \{modeLabel\}/u);
  assert.match(source, /Generación · \{generationModeLabel\}/u);
  assert.match(source, /title="Procesamiento IA"/u);
  assert.match(source, /value=\{generationKpiLabel\}/u);
  assert.match(source, /"IA híbrida"/u);
  assert.doesNotMatch(source, /aria-label="Abrir otra versión del documento"/u);
  assert.match(
    css,
    /\.rq-sources-workspace > \.rq-table-shell > \.rq-table-shell__header \{\s*display: none;/u,
  );
});

// Un intento fallido, con error o cancelado no debe dejar una versión.
test("un intento fallido o cancelado descarta su borrador y no ofrece reintentos sobre él", () => {
  for (const status of ["FAILED", "CANCELLED"] as const) {
    const outcome = describeGenerationOutcome({
      status,
      errorMessage: "Falla genérica",
      hasCheckpoint: true,
      draftDiscarded: true,
    });
    assert.deepEqual(outcome.actions, ["technical-details"]);
    assert.match(
      `${outcome.explanation ?? ""} ${outcome.consequence ?? ""}`,
      /No se creó ninguna versión del documento/u,
    );
  }
  const apply = describeGenerationOutcome({
    status: "FAILED",
    errorCode: "AI_AUTO_APPLY_UNAVAILABLE",
    providerCompleted: true,
    draftDiscarded: true,
  });
  assert.deepEqual(apply.actions, ["technical-details"]);
  assert.doesNotMatch(apply.consequence ?? "", /sin volver a consumir/u);
});

test("la pantalla elimina el borrador creado solo para intentos observados en curso que terminan mal", async () => {
  const source = await readFile(`${DIR}sources-workspace.tsx`, "utf8");
  assert.match(source, /observedActiveGenerationsRef/u);
  assert.match(source, /discardedGenerationsRef/u);
  assert.match(
    source,
    /\/api\/v1\/documents\/\$\{encodeURIComponent\(generation\.documentId\)\}\/versions\/\$\{generation\.generatedVersionNumber\}`,\s*\{ method: "DELETE" \}/u,
  );
  // Nunca para COMPLETED ni para intentos antiguos que no se vieron en curso.
  assert.match(source, /if \(generation\.status === "COMPLETED"\) return;/u);
  assert.match(
    source,
    /!observedActiveGenerationsRef\.current\.has\(generation\.id\)/u,
  );
  assert.match(source, /no se creó ninguna versión/u);
});

test("la barra de Fuentes ya no repite el retorno a fuentes", async () => {
  const source = await readFile(`${DIR}sources-workspace.tsx`, "utf8");
  assert.doesNotMatch(source, /‹ Volver a fuentes/u);
});

test("los puntos del borrador conservan recuadro y se compactan solo en Mostrar", async () => {
  const css = await readStyles();
  assert.match(
    css,
    /\.rq-source-consumption-tabs__panel\s+\.rq-local-draft-block-progress__list\s+> li \{[^}]*border: 1px solid[^}]*\}/u,
  );
  assert.match(
    css,
    /\.rq-source-consumption-tabs__panel\s+\.rq-local-draft-block-progress__list \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*\}/u,
  );
  assert.doesNotMatch(
    css,
    /\.rq-source-consumption-tabs__panel\s+\.rq-local-draft-block-progress__list \{[^}]*auto-fill[^}]*\}/u,
  );
  assert.match(
    css,
    /@media \(min-width: 64\.0625rem\) \{\s*\.rq-sources-workspace \.rq-gen \{\s*grid-template-columns: minmax\(0, 1fr\) minmax\(18rem, 24rem\);/u,
  );
});

test("el respaldo desde secciones ordena y marca cada punto COMPLETED sin tocar checkpoints", async () => {
  const source = await readFile(`${DIR}sources-workspace.tsx`, "utf8");
  const start = source.indexOf(
    "export function localDraftBlocksFromDocumentSections(",
  );
  const end = source.indexOf("async function discoverCurrentGeneration(");
  assert.ok(start >= 0 && end > start);
  const helper = source
    .slice(start, end)
    .replace("export function", "function")
    .replace(/\): LocalDraftBlockProgress\[\] \{/u, ") {")
    .replace(
      /sections: readonly \{[^}]*\}\[\],\s*updatedAt: string,/u,
      "sections, updatedAt",
    );
  const fn = new Function(
    `${helper}; return localDraftBlocksFromDocumentSections;`,
  )() as (
    sections: { key: string; title: string; order: number }[],
    updatedAt: string,
  ) => {
    blockNumber: number;
    blockTotal: number;
    blockKey: string;
    blockLabel: string;
    status: string;
    updatedAt: string;
  }[];
  const blocks = fn(
    [
      { key: "b", title: "Segundo", order: 2 },
      { key: "a", title: "Primero", order: 1 },
    ],
    "2026-10-05T00:00:00.000Z",
  );
  assert.deepEqual(
    blocks.map((block) => [
      block.blockNumber,
      block.blockTotal,
      block.blockKey,
      block.status,
    ]),
    [
      [1, 2, "a", "COMPLETED"],
      [2, 2, "b", "COMPLETED"],
    ],
  );
  assert.equal(blocks[0]?.updatedAt, "2026-10-05T00:00:00.000Z");
  assert.deepEqual(fn([], "x"), []);
  // No reemplaza bloques existentes ni ejecuciones no completadas.
  assert.match(source, /detail\.status !== "COMPLETED" \|\|/u);
  assert.match(
    source,
    /\(detail\.processing\?\.localDraftBlocks\?\.length \?\? 0\) > 0/u,
  );
});

test("General omite Duración y Tokens; el badge de estado tiene geometría común", async () => {
  const [panel, source, css] = await Promise.all([
    readFile(`${DIR}sources-generation-panel.tsx`, "utf8"),
    readFile(`${DIR}sources-workspace.tsx`, "utf8"),
    readStyles(),
  ]);
  const rows = source.slice(
    source.indexOf("const generationResultRows"),
    source.indexOf("const consumptionTabs"),
  );
  assert.doesNotMatch(rows, /"Duración"/u);
  assert.doesNotMatch(rows, /Tokens \(entrada \/ salida\)/u);
  assert.match(rows, /"Modelo"/u);
  assert.match(
    css,
    /\.rq-gen__state \.rq-status \{\s*min-height: 1\.75rem;\s*padding: 0\.25rem 0\.75rem;\s*border: 1px solid transparent;\s*font-size: calc\(0\.75rem \* var\(--rq-font-scale\)\);/u,
  );
  assert.match(css, /\.rq-gen__state-icon \{\s*margin-inline-end: 0\.375rem;/u);
  assert.match(panel, /className="rq-gen__state-icon"/u);
  // Duración y tokens reales bajo la etiqueta de estado, solo si COMPLETED.
  assert.match(
    panel,
    /<\/RqStatusBadge>[\s\S]*?\{statusContent \?[\s\S]*?className="rq-gen__state-meta"/u,
  );
  assert.match(
    css,
    /\.rq-gen__state-meta \{[^}]*align-items: flex-end;[^}]*text-align: end;/u,
  );
  assert.doesNotMatch(
    css.match(/\.rq-gen__state-meta \{[^}]*\}/u)?.[0] ?? "",
    /border|background/u,
  );
  assert.match(source, /statusContent=\{completedStatusContent\}/u);
  assert.match(
    source,
    /latestExecution\?\.status === "COMPLETED" &&[\s\S]*?Duración: \{completedStatusDuration\}[\s\S]*?Tokens \(entrada \/ salida\):/u,
  );
  // Sin métricas persistidas la línea permanece visible con "No disponibles".
  assert.match(
    source,
    /latestExecution\?\.status === "COMPLETED" \? \([\s\S]*?Tokens \(entrada \/ salida\):[\s\S]*?: "No disponibles"/u,
  );
  // Título y modo ejecutado agrupados dentro de la región viva existente.
  assert.match(
    panel,
    /className="rq-gen__live"[\s\S]*?className="rq-gen__headline"[\s\S]*?className="rq-gen__title"[\s\S]*?className="rq-gen__text"/u,
  );
  assert.match(
    css,
    /\.rq-gen__outcome\[data-rq-state="completed"\] \.rq-gen__headline \{[^}]*grid-area: title;[^}]*flex-direction: column;/u,
  );
  // Solo Duración gana jerarquía; Tokens conserva su estilo.
  assert.match(source, /className="rq-gen__state-duration"/u);
  assert.match(
    css,
    /\.rq-gen__outcome\[data-rq-state="completed"\] \.rq-gen__state-duration \{[^}]*color: var\(--rq-color-text\);[^}]*font-size: calc\(0\.75rem \* var\(--rq-font-scale\)\);[^}]*font-weight: 800;/u,
  );
  assert.match(
    css,
    /\.rq-gen__progress \{[^}]*margin-block-start: 0\.375rem;/u,
  );
});

test("detalles técnicos: siete filas estándar en el mismo orden para local, nube e híbrida", () => {
  const labels = [
    "Solicitud",
    "Versión generada",
    "Modelo",
    "Intento",
    "Duración",
    "Tokens (entrada / salida)",
    "Correlación del proveedor",
  ];
  const full = {
    requestId: "req-1",
    versionLabel: "v2",
    model: "m",
    attempt: 1,
    durationLabel: "1 min 5 s",
    inputTokens: 1000,
    outputTokens: 200,
  };
  const rowsOf = (technical: Record<string, unknown>) =>
    describeGenerationOutcome({ status: "COMPLETED", technical }).technical;

  const local = rowsOf({ requestId: "req-1", localOnly: true });
  assert.deepEqual(
    local.map((row) => row.label),
    labels,
  );
  const value = (rows: typeof local, label: string) =>
    rows.find((row) => row.label === label)?.value;
  assert.equal(value(local, "Correlación del proveedor"), "No aplica");
  assert.equal(value(local, "Duración"), "No disponible");
  assert.equal(
    value(local, "Tokens (entrada / salida)"),
    "No disponible / No disponible",
  );

  const cloud = rowsOf({ ...full, providerRequestId: "resp_1" });
  const hybrid = rowsOf({ ...full, providerRequestId: "resp_1" });
  for (const rows of [cloud, hybrid]) {
    assert.deepEqual(
      rows.map((row) => row.label),
      labels,
    );
    assert.equal(value(rows, "Duración"), "1 min 5 s");
    assert.equal(
      value(rows, "Tokens (entrada / salida)"),
      `${(1000).toLocaleString("es-CO")} / ${(200).toLocaleString("es-CO")}`,
    );
    assert.equal(value(rows, "Correlación del proveedor"), "resp_1");
  }
  const cloudMissing = rowsOf({ requestId: "req-1" });
  assert.equal(
    value(cloudMissing, "Correlación del proveedor"),
    "No disponible",
  );
});

test("la barra de Fuentes es adaptable: acciones con columna flexible y envoltura en modo híbrido", async () => {
  const css = await readStyles();
  assert.match(
    css,
    /\.rq-sources-workspace > \.rq-module-commandbar \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, auto\);/u,
  );
  assert.match(
    css,
    /\.rq-sources-workspace \.rq-module-commandbar__actions\.rq-source-command-actions \{[^}]*min-width: 0;\s*flex-wrap: wrap;/u,
  );
  assert.doesNotMatch(
    css,
    /\.rq-sources-workspace \.rq-module-commandbar__actions\.rq-source-command-actions \{[^}]*flex-wrap: nowrap/u,
  );
});

test("el pipeline híbrido de cinco etapas se reparte en 3+2 y la tarjeta de consumo queda a la derecha", async () => {
  const css = await readStyles();
  const panelSource = await readFile(
    "apps/web/src/app/workspace/sources/sources-generation-panel.tsx",
    "utf8",
  );
  const workspaceSource = await readFile(
    "apps/web/src/app/workspace/sources/sources-workspace.tsx",
    "utf8",
  );
  assert.match(
    css,
    /\.rq-main > \.rq-content:has\(> \.rq-sources-workspace\) \{[^}]*container-type: inline-size;\s*container-name: rq-sources-content;/u,
  );
  assert.doesNotMatch(
    css,
    /@media \(min-width: 64\.0625rem\) and \(max-width: 80rem\)/u,
  );
  assert.match(
    css,
    /@container rq-sources-content \(max-width: 80rem\) \{\s*\.rq-sources-workspace\s+\.rq-gen\[data-rq-generation-mode="LOCAL_CLOUD"\]\s+\.rq-gen__pipeline\[data-rq-step-count="5"\] \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/u,
  );
  // El híbrido ya no apila la tarjeta debajo: conserva las dos columnas.
  assert.doesNotMatch(
    css,
    /@container rq-sources-content \(max-width: 80rem\) \{\s*\.rq-sources-workspace\s+\.rq-gen(?:\[[^\]]*\])?:has\(/u,
  );
  // La columna de contenido no se ensancha más que la ventana.
  assert.match(
    css,
    /\.rq-main > \.rq-content:has\(> \.rq-sources-workspace\) \{\s*grid-template-columns: minmax\(0, 1fr\);/u,
  );
  assert.match(
    panelSource,
    /data-rq-generation-mode=\{generationMode \?\? undefined\}/u,
  );
  assert.match(workspaceSource, /generationMode=\{displayedGenerationMode\}/u);
  assert.match(
    css,
    /@media \(min-width: 64\.0625rem\) \{\s*\.rq-sources-workspace \.rq-gen \{\s*grid-template-columns: minmax\(0, 1fr\) minmax\(18rem, 24rem\);/u,
  );
});

test("selección previa: tiene prioridad sobre una solicitud terminal y no mezcla resultados reales", async () => {
  const source = await readFile(`${DIR}sources-workspace.tsx`, "utf8");
  assert.match(
    source,
    /const selectionPreview =\s*selectedSourceIds\.size > 0 &&\s*!trackedGenerationActive &&\s*batchProcessing === null/u,
  );
  assert.match(
    source,
    /const presentedGeneration = selectionPreview \? null : trackedGeneration;/u,
  );
  // Modo, progreso, resultado, pipeline y encabezado derivan de presentedGeneration.
  assert.match(
    source,
    /resolveTrackedGenerationMode\(\s*presentedGeneration,\s*aiEngines\.engines,?\s*\)/u,
  );
  assert.match(source, /const latestExecution = presentedGeneration\?\./u);
  assert.match(source, /generationFinished =\s*presentedGeneration !== null/u);
  assert.match(source, /presentedGeneration\?\.processing \? \(/u);
  assert.match(
    source,
    /presentedGeneration \? null : "Estimación previa a la ejecución"/u,
  );
});

test("la estimación previa es honesta: rotula estimados, no inventa reducción y acota el tiempo de referencia", async () => {
  const source = await readFile(`${DIR}sources-workspace.tsx`, "utf8");
  for (const label of [
    "Fuentes (estimado)",
    "Tokens originales (estimado)",
    "Tokens locales (estimado)",
    "Reducción (estimado)",
    "Contexto consolidado (estimado)",
    "Entrada a la nube (estimado)",
    "Disponible en la nube (estimado)",
  ]) {
    assert.ok(source.includes(label), label);
  }
  // En híbrido la reducción y el envío solo aparecen con consolidación conocida.
  assert.match(
    source,
    /const consolidationKnown =\s*generationUsesLocal &&\s*generationUsesCloud &&\s*tokenEstimate\.consolidatedTokens !== null/u,
  );
  assert.match(
    source,
    /generationUsesCloud && \(!generationUsesLocal \|\| consolidationKnown\)/u,
  );
  assert.match(source, /se\s+confirmarán durante el análisis local/u);
  // Tiempo de referencia: mismo modo y tiempos reales; si no, sin medición.
  assert.match(
    source,
    /previewReferenceMode === displayedGenerationMode &&\s*previewReferenceExecution\?\.startedAt &&\s*previewReferenceExecution\.finishedAt/u,
  );
  assert.match(source, /Sin medición comparable todavía/u);
  assert.match(source, /Tiempo de referencia/u);
  assert.match(source, /el costo, los tokens de salida y la duración/u);
});

test("detalles técnicos cubren los cinco estados con contexto de modo y fuentes", () => {
  const context = { modeLabel: "Híbrido", sourceCount: 3 };
  const labels = (rows: readonly { label: string }[]) =>
    rows.map((row) => row.label);
  const value = (
    rows: readonly { label: string; value: string }[],
    l: string,
  ) => rows.find((row) => row.label === l)?.value;

  const ready = describeGenerationOutcome({
    status: null,
    context: {
      ...context,
      estimate: {
        method: "CHARACTERS_DIVIDED_BY_4",
        model: "gpt-x",
        promptCharacters: 4000,
        estimatedInputTokens: 1000,
        maxInputTokens: 8000,
        canProcess: true,
        usesCloud: true,
      },
    },
  }).technical;
  assert.equal(value(ready, "Modo"), "Híbrido");
  assert.equal(value(ready, "Fuentes seleccionadas"), "3");
  assert.equal(
    value(ready, "Método de estimación"),
    "Caracteres ÷ 4 (estimado)",
  );
  assert.ok(labels(ready).includes("Límite de entrada en la nube"));
  assert.ok(!labels(ready).includes("Duración"));
  assert.ok(!labels(ready).includes("Tokens (entrada / salida)"));

  const active = describeGenerationOutcome({
    status: "PROCESSING",
    stageLabel: "Borrador local",
    context,
    technical: { requestId: "req-1", versionLabel: "v2" },
  }).technical;
  assert.deepEqual(labels(active), [
    "Modo",
    "Fuentes",
    "Etapa",
    "Solicitud",
    "Versión generada",
  ]);

  for (const status of ["COMPLETED", "CANCELLED", "FAILED"] as const) {
    const rows = describeGenerationOutcome({
      status,
      context,
      errorMessage: status === "FAILED" ? "boom" : null,
      technical: { requestId: "req-1", durationLabel: "00:10" },
    }).technical;
    assert.deepEqual(labels(rows).slice(0, 2), ["Modo", "Fuentes"]);
    assert.equal(value(rows, "Duración"), "00:10");
    assert.ok(labels(rows).includes("Tokens (entrada / salida)"));
    assert.ok(labels(rows).includes("Correlación del proveedor"));
  }
});
