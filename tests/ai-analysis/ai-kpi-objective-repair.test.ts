import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAiAnalysisOutputSchemaV41,
  KpiObjectiveReferenceError,
  parseAiAnalysisDraft,
} from "../../apps/ai-analysis-service/src/execution/ai-analysis-draft.js";
import {
  applyKpiObjectiveRepairPatch,
  buildKpiObjectiveRepairSchema,
  extractKpiRepairContext,
  isKpiObjectiveReferenceError,
} from "../../apps/ai-analysis-service/src/execution/ai-kpi-objective-repair.js";
import { FakeAiProvider } from "../../apps/ai-analysis-service/src/execution/fake-ai.provider.js";
import { OpenAiResponsesProvider } from "../../apps/ai-analysis-service/src/execution/openai-responses.provider.js";
import { AiProviderError } from "../../apps/ai-analysis-service/src/execution/ai-text-provider.js";

const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

type Raw = Record<string, any>;

async function baseRaw(): Promise<Raw> {
  const generated = await new FakeAiProvider([
    { id: SOURCE_ID, title: "Fuente sintética", text: "Texto sintético." },
  ]).generate({
    systemInstruction: "system",
    userPrompt: "prompt",
    schema: buildAiAnalysisOutputSchemaV41(false),
  });
  return JSON.parse(JSON.stringify(generated.draft)) as Raw;
}

function section(raw: Raw, key: string): Raw {
  return raw.sections.find((item: Raw) => item.key === key).content;
}

/** Fija objetivos y KPI con nombres distintos para casos sintéticos. */
function withObjectives(
  raw: Raw,
  qualitative: string[],
  quantitative: string[],
  kpiObjectives: string[],
): Raw {
  const copy = structuredClone(raw);
  const objectives = section(copy, "objectives");
  objectives.qualitative = qualitative;
  objectives.quantitative = quantitative;
  const kpis = section(copy, "scope").kpis as Raw[];
  kpiObjectives.forEach((value, index) => {
    kpis[index].relatedObjective = value;
  });
  return copy;
}

function related(draft: ReturnType<typeof parseAiAnalysisDraft>): string[] {
  const scope = draft.sections.find((item) => item.key === "scope")!
    .content as Raw;
  return (scope.kpis as Raw[]).map((kpi) => kpi.relatedObjective as string);
}

// ── Dominios funcionales sintéticos (sin codificar ningún proyecto real) ────
const DOMAINS = [
  {
    name: "inventario",
    qualitative: ["Unificar el control de existencias por bodega"],
    quantitative: ["Reducir las diferencias de inventario por debajo del 2 %"],
  },
  {
    name: "talento humano",
    qualitative: ["Estandarizar el proceso de incorporación de personal"],
    quantitative: ["Disminuir el tiempo de contratación a menos de 15 días"],
  },
  {
    name: "facturación",
    qualitative: ["Automatizar la conciliación de facturas recibidas"],
    quantitative: ["Alcanzar el 98 % de facturas conciliadas sin intervención"],
  },
];

for (const domain of DOMAINS) {
  test(`canonicaliza una referencia segura (${domain.name})`, async () => {
    const [qualitative] = domain.qualitative;
    const raw = await baseRaw();

    // Literal.
    const literal = parseAiAnalysisDraft(
      withObjectives(raw, domain.qualitative, domain.quantitative, [
        qualitative!,
        qualitative!,
        qualitative!,
      ]),
    );
    assert.deepEqual(related(literal), [qualitative, qualitative, qualitative]);

    // Mayúsculas, espacios, puntuación y tildes con un único destino.
    const noisy = `  ${qualitative!
      .toUpperCase()
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")}.  `;
    const normalized = parseAiAnalysisDraft(
      withObjectives(raw, domain.qualitative, domain.quantitative, [
        noisy,
        qualitative!,
        qualitative!,
      ]),
    );
    assert.equal(related(normalized)[0], qualitative);
  });
}

test("una paráfrasis con un único destino léxico seguro se canonicaliza", async () => {
  const raw = await baseRaw();
  const draft = parseAiAnalysisDraft(
    withObjectives(
      raw,
      ["Unificar el control de existencias por bodega"],
      ["Reducir las diferencias de inventario por debajo del 2 %"],
      [
        "Unificar control de las existencias de cada bodega",
        "Unificar el control de existencias por bodega",
        "Unificar el control de existencias por bodega",
      ],
    ),
  );
  assert.equal(
    related(draft)[0],
    "Unificar el control de existencias por bodega",
  );
});

test("una paráfrasis que coincide con dos objetivos plausibles se rechaza", async () => {
  const raw = await baseRaw();
  assert.throws(
    () =>
      parseAiAnalysisDraft(
        withObjectives(
          raw,
          [
            "Reducir el tiempo de aprobación de solicitudes internas",
            "Reducir el tiempo de aprobación de solicitudes externas",
          ],
          ["Alcanzar el 95 % de solicitudes aprobadas a tiempo"],
          [
            "Reducir el tiempo de aprobación de solicitudes",
            "Alcanzar el 95 % de solicitudes aprobadas a tiempo",
            "Alcanzar el 95 % de solicitudes aprobadas a tiempo",
          ],
        ),
      ),
    (error: unknown) =>
      error instanceof KpiObjectiveReferenceError &&
      isKpiObjectiveReferenceError(error.message) &&
      error.failures.length === 1 &&
      error.failures[0]!.reason === "AMBIGUOUS" &&
      error.repairable === false,
  );
});

test("un objetivo inexistente se rechaza", async () => {
  const raw = await baseRaw();
  assert.throws(
    () =>
      parseAiAnalysisDraft(
        withObjectives(
          raw,
          ["Objetivo uno distinto"],
          ["Objetivo dos distinto"],
          [
            "Texto sin relación alguna con los objetivos generados",
            "Objetivo uno distinto",
            "Objetivo uno distinto",
          ],
        ),
      ),
    (error: unknown) =>
      error instanceof KpiObjectiveReferenceError &&
      isKpiObjectiveReferenceError(error.message) &&
      error.failures.length === 1 &&
      error.failures[0]!.kpiIndex === 0 &&
      error.failures[0]!.reason === "NO_MATCH" &&
      error.repairable === true &&
      error.noMatchIndexes.join(",") === "0",
  );
});

test("el error tipado distingue por KPI sin coincidencia y ambiguo; un KPI seguro no falla", async () => {
  const raw = withObjectives(
    await baseRaw(),
    [
      "Reducir el tiempo de aprobación de solicitudes internas",
      "Reducir el tiempo de aprobación de solicitudes externas",
    ],
    ["Alcanzar el 95 % de solicitudes aprobadas a tiempo"],
    [
      // 0: coincidencia segura (mayúsculas y tildes) → se canonicaliza.
      "ALCANZAR EL 95 % DE SOLICITUDES APROBADAS A TIEMPO",
      // 1: dos plausibles → ambiguo.
      "Reducir el tiempo de aprobación de solicitudes",
      // 2: ninguna relación → sin coincidencia.
      "Texto sin relación con los objetivos generados",
    ],
  );
  try {
    parseAiAnalysisDraft(raw);
    assert.fail("debía rechazarse");
  } catch (error) {
    assert.ok(error instanceof KpiObjectiveReferenceError);
    assert.deepEqual(
      error.failures.map((item) => [item.kpiIndex, item.reason]),
      [
        [1, "AMBIGUOUS"],
        [2, "NO_MATCH"],
      ],
    );
    // Con un KPI ambiguo no es reparable aunque otro no tenga coincidencia.
    assert.equal(error.repairable, false);
  }
});

// ── Módulo de reintento localizado ──────────────────────────────────────────
test("extractKpiRepairContext toma los objetivos exactos y los KPI de la misma respuesta", async () => {
  const raw = withObjectives(
    await baseRaw(),
    ["Objetivo A", "Objetivo B"],
    ["Objetivo B", "Objetivo C"],
    ["x", "y", "z"],
  );
  const context = extractKpiRepairContext(raw)!;
  assert.deepEqual(context.objectives, [
    "Objetivo A",
    "Objetivo B",
    "Objetivo C",
  ]);
  assert.equal(context.kpis.length, 3);
  const allNames = context.kpis.map((kpi) => kpi.name);
  const schema = buildKpiObjectiveRepairSchema(context, allNames) as Raw;
  assert.deepEqual(
    schema.properties.kpis.items.properties.relatedObjective.enum,
    ["Objetivo A", "Objetivo B", "Objetivo C"],
  );
  assert.equal(schema.properties.kpis.minItems, 3);
});

test("no hay base segura sin objetivos, con KPI repetidos o con demasiados KPI", async () => {
  const raw = await baseRaw();
  const noObjectives = withObjectives(raw, [], [], ["a", "b", "c"]);
  assert.equal(extractKpiRepairContext(noObjectives), null);

  const duplicate = structuredClone(raw);
  const kpis = section(duplicate, "scope").kpis as Raw[];
  kpis[1].name = kpis[0].name;
  assert.equal(extractKpiRepairContext(duplicate), null);

  const many = structuredClone(raw);
  const manyKpis = section(many, "scope").kpis as Raw[];
  manyKpis.push({ ...manyKpis[0], name: "Cuarto indicador" });
  assert.equal(extractKpiRepairContext(many), null);
  assert.equal(extractKpiRepairContext(null), null);
});

test("el parche se asocia por nombre (no por posición) y solo cambia relatedObjective", async () => {
  const raw = withObjectives(
    await baseRaw(),
    ["Objetivo A", "Objetivo B"],
    ["Objetivo C"],
    ["inexistente 1", "inexistente 2", "inexistente 3"],
  );
  const names = (section(raw, "scope").kpis as Raw[]).map((kpi) => kpi.name);
  const patch = {
    // Orden invertido: la asociación debe seguir al nombre.
    kpis: [
      { name: names[2], relatedObjective: "Objetivo C" },
      { name: names[1], relatedObjective: "Objetivo B" },
      { name: names[0], relatedObjective: "Objetivo A" },
    ],
  };
  const repaired = applyKpiObjectiveRepairPatch(raw, patch, names) as Raw;
  const kpis = section(repaired, "scope").kpis as Raw[];
  assert.deepEqual(
    kpis.map((kpi) => [kpi.name, kpi.relatedObjective]),
    [
      [names[0], "Objetivo A"],
      [names[1], "Objetivo B"],
      [names[2], "Objetivo C"],
    ],
  );
  const original = section(raw, "scope").kpis as Raw[];
  for (const [index, kpi] of kpis.entries()) {
    assert.equal(kpi.measurement, original[index].measurement);
    assert.equal(kpi.target, original[index].target);
  }
  // El borrador original no se muta.
  assert.equal(original[0].relatedObjective, "inexistente 1");
  assert.doesNotThrow(() => parseAiAnalysisDraft(repaired));
});

test("un parche ambiguo, incompleto o con un objetivo no exacto devuelve null", async () => {
  const raw = withObjectives(
    await baseRaw(),
    ["Objetivo A"],
    ["Objetivo B"],
    ["x", "y", "z"],
  );
  const names = (section(raw, "scope").kpis as Raw[]).map((kpi) => kpi.name);
  const good = (index: number, objective: string) => ({
    name: names[index],
    relatedObjective: objective,
  });
  // Paráfrasis del objetivo: no es copia exacta.
  assert.equal(
    applyKpiObjectiveRepairPatch(
      raw,
      {
        kpis: [
          good(0, "Objetivo a"),
          good(1, "Objetivo B"),
          good(2, "Objetivo A"),
        ],
      },
      names,
    ),
    null,
  );
  // Cantidad distinta.
  assert.equal(
    applyKpiObjectiveRepairPatch(
      raw,
      { kpis: [good(0, "Objetivo A"), good(1, "Objetivo B")] },
      names,
    ),
    null,
  );
  // Nombre repetido (un KPI sin parche).
  assert.equal(
    applyKpiObjectiveRepairPatch(
      raw,
      {
        kpis: [
          good(0, "Objetivo A"),
          good(0, "Objetivo B"),
          good(2, "Objetivo A"),
        ],
      },
      names,
    ),
    null,
  );
  // Nombre desconocido.
  assert.equal(
    applyKpiObjectiveRepairPatch(
      raw,
      {
        kpis: [
          good(0, "Objetivo A"),
          good(1, "Objetivo B"),
          { name: "Otro", relatedObjective: "Objetivo A" },
        ],
      },
      names,
    ),
    null,
  );
  assert.equal(
    applyKpiObjectiveRepairPatch(raw, "no es un objeto", names),
    null,
  );
  assert.equal(applyKpiObjectiveRepairPatch(raw, { kpis: "x" }, names), null);
  // Sin objetivos de reparación no hay nada que aplicar.
  assert.equal(applyKpiObjectiveRepairPatch(raw, { kpis: [] }, []), null);
});

test("el parche solo puede cubrir los KPI objetivo y deja intactos los demás", async () => {
  const raw = withObjectives(
    await baseRaw(),
    ["Objetivo A", "Objetivo B"],
    ["Objetivo C"],
    ["Objetivo A", "inexistente", "Objetivo C"],
  );
  const names = (section(raw, "scope").kpis as Raw[]).map((kpi) => kpi.name);
  // Solo el KPI 1 necesita reparación.
  const repaired = applyKpiObjectiveRepairPatch(
    raw,
    { kpis: [{ name: names[1], relatedObjective: "Objetivo B" }] },
    [names[1]],
  ) as Raw;
  assert.deepEqual(
    (section(repaired, "scope").kpis as Raw[]).map(
      (kpi) => kpi.relatedObjective,
    ),
    ["Objetivo A", "Objetivo B", "Objetivo C"],
  );
  // Un parche que intenta cambiar un KPI ya resuelto se rechaza.
  assert.equal(
    applyKpiObjectiveRepairPatch(
      raw,
      {
        kpis: [
          { name: names[1], relatedObjective: "Objetivo B" },
          { name: names[0], relatedObjective: "Objetivo C" },
        ],
      },
      [names[1]],
    ),
    null,
  );
});

// ── Proveedor: reintento localizado e idempotencia ──────────────────────────
function provider() {
  return new OpenAiResponsesProvider({
    configuration: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "OpenAI",
      providerType: "OPENAI",
      model: "model-enabled-for-test",
      baseUrl: "https://api.openai.com/v1",
      isEnabled: true,
      isDefault: true,
      timeoutMs: 5000,
      maxInputTokens: 120000,
      maxOutputTokens: 12000,
      maxAttempts: 3,
      secretReference: "reference",
      lastConnectionTestAt: new Date(),
      lastConnectionTestStatus: "SUCCEEDED",
      lastErrorCode: null,
      createdByUserId: SOURCE_ID,
      updatedByUserId: SOURCE_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    apiKey: "secret-api-key-for-unit-test",
  } as never);
}

function responseWith(
  payload: unknown,
  usage = { input_tokens: 100, output_tokens: 200 },
) {
  return new Response(
    JSON.stringify({
      id: "resp_test",
      status: "completed",
      output: [
        { content: [{ type: "output_text", text: JSON.stringify(payload) }] },
      ],
      usage,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function runProvider(
  responses: Array<() => Response>,
  raw: Raw,
): Promise<{
  calls: Array<Record<string, any>>;
  result?: Awaited<ReturnType<OpenAiResponsesProvider["generate"]>>;
  error?: unknown;
}> {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, any>> = [];
  let index = 0;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return next();
  }) as typeof fetch;
  try {
    const first = () => responseWith(raw);
    responses[0] = responses[0] ?? first;
    const result = await provider().generate({
      systemInstruction: "system",
      userPrompt: "user",
      schema: buildAiAnalysisOutputSchemaV41(false),
    });
    return { calls, result };
  } catch (error) {
    return { calls, error };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const BAD_OBJECTIVES = ["Texto sin relación con ningún objetivo generado"];

async function badKpiRaw(): Promise<Raw> {
  return withObjectives(
    await baseRaw(),
    ["Objetivo A", "Objetivo B"],
    ["Objetivo C"],
    [BAD_OBJECTIVES[0]!, BAD_OBJECTIVES[0]!, BAD_OBJECTIVES[0]!],
  );
}

test("una respuesta válida no genera una segunda llamada al proveedor", async () => {
  const raw = withObjectives(
    await baseRaw(),
    ["Objetivo A"],
    ["Objetivo B"],
    ["Objetivo A", "Objetivo B", "Objetivo A"],
  );
  const { calls, result, error } = await runProvider(
    [() => responseWith(raw)],
    raw,
  );
  assert.equal(error, undefined);
  assert.equal(calls.length, 1);
  assert.equal(result?.inputTokens, 100);
});

test("un KPI con objetivo inexistente se recupera con UN reintento localizado", async () => {
  const bad = await badKpiRaw();
  const names = (section(bad, "scope").kpis as Raw[]).map((kpi) => kpi.name);
  const patch = {
    kpis: [
      { name: names[0], relatedObjective: "Objetivo A" },
      { name: names[1], relatedObjective: "Objetivo C" },
      { name: names[2], relatedObjective: "Objetivo B" },
    ],
  };
  const { calls, result, error } = await runProvider(
    [
      () => responseWith(bad, { input_tokens: 1000, output_tokens: 2000 }),
      () => responseWith(patch, { input_tokens: 30, output_tokens: 40 }),
    ],
    bad,
  );
  assert.equal(error, undefined);
  assert.equal(calls.length, 2, "una llamada principal y un único reintento");
  // La llamada de reparación es pequeña, estricta y no lleva el borrador.
  const repair = calls[1]!;
  assert.equal(repair.text.format.name, "kpi_objective_patch");
  assert.equal(repair.text.format.strict, true);
  assert.deepEqual(
    repair.text.format.schema.properties.kpis.items.properties.relatedObjective
      .enum,
    ["Objetivo A", "Objetivo B", "Objetivo C"],
  );
  assert.doesNotMatch(JSON.stringify(repair), /secret-api-key-for-unit-test/u);
  assert.ok(JSON.stringify(repair).length < 5_000);
  // El resultado conserva los objetivos canónicos, avisa y suma los tokens.
  const scope = result!.draft.sections.find((item) => item.key === "scope")!
    .content as Raw;
  assert.deepEqual(
    (scope.kpis as Raw[]).map((kpi) => kpi.relatedObjective),
    ["Objetivo A", "Objetivo C", "Objetivo B"],
  );
  assert.match(result!.draft.warnings.join("\n"), /reintento localizado/u);
  assert.equal(result!.inputTokens, 1030);
  assert.equal(result!.outputTokens, 2040);
});

test("un reintento con objetivo no exacto o ambiguo falla cerrado sin más llamadas", async () => {
  const bad = await badKpiRaw();
  const names = (section(bad, "scope").kpis as Raw[]).map((kpi) => kpi.name);
  const invalid = {
    kpis: names.map((name) => ({ name, relatedObjective: "Objetivo a" })),
  };
  const { calls, result, error } = await runProvider(
    [() => responseWith(bad), () => responseWith(invalid)],
    bad,
  );
  assert.equal(result, undefined);
  assert.ok(error instanceof AiProviderError);
  assert.equal(
    (error as AiProviderError).code,
    "OPENAI_STRUCTURED_OUTPUT_INVALID",
  );
  assert.match((error as Error).message, /reintento localizado/u);
  assert.match((error as Error).message, /relatedObjective/u);
  assert.equal(calls.length, 2, "no hay un tercer intento");
});

test("un fallo de transporte en el reintento también falla cerrado", async () => {
  const bad = await badKpiRaw();
  const { calls, result, error } = await runProvider(
    [() => responseWith(bad), () => new Response("error", { status: 500 })],
    bad,
  );
  assert.equal(result, undefined);
  assert.ok(error instanceof AiProviderError);
  assert.equal(calls.length, 2);
});

test("un error de validación distinto al KPI no dispara el reintento localizado", async () => {
  const raw = await baseRaw();
  raw.sections = raw.sections.slice(1); // rompe el contrato de secciones
  const { calls, result, error } = await runProvider(
    [() => responseWith(raw)],
    raw,
  );
  assert.equal(result, undefined);
  assert.ok(error instanceof AiProviderError);
  assert.equal(calls.length, 1);
});

// ── Proveedor: ambigüedad ≠ elección arbitraria ─────────────────────────────
const INTERNAL = "Reducir el tiempo de aprobación de solicitudes internas";
const EXTERNAL = "Reducir el tiempo de aprobación de solicitudes externas";
const TIMELY = "Alcanzar el 95 % de solicitudes aprobadas a tiempo";
const AMBIGUOUS_REFERENCE = "Reducir el tiempo de aprobación de solicitudes";
const UNRELATED_REFERENCE = "Texto sin relación con los objetivos generados";

function rawWith(kpiObjectives: string[]): Promise<Raw> {
  return baseRaw().then((raw) =>
    withObjectives(raw, [INTERNAL, EXTERNAL], [TIMELY], kpiObjectives),
  );
}

function scopeRelated(
  result: Awaited<ReturnType<typeof runProvider>>["result"],
): string[] {
  const scope = result!.draft.sections.find((item) => item.key === "scope")!
    .content as Raw;
  return (scope.kpis as Raw[]).map((kpi) => kpi.relatedObjective as string);
}

test("dos objetivos plausibles: el proveedor NO llama a la reparación ni elige uno", async () => {
  const ambiguous = await rawWith([AMBIGUOUS_REFERENCE, TIMELY, TIMELY]);
  const { calls, result, error } = await runProvider(
    [
      () =>
        responseWith(ambiguous, { input_tokens: 1000, output_tokens: 2000 }),
      // Si el proveedor llamara de nuevo, esta respuesta "resolvería" la
      // ambigüedad escogiendo un objetivo: no debe usarse nunca.
      () => {
        throw new Error("No debía existir una llamada de reparación.");
      },
    ],
    ambiguous,
  );
  assert.equal(calls.length, 1, "una sola llamada: no hay reparación");
  assert.equal(result, undefined, "el borrador no se devuelve ni se aplica");
  assert.ok(error instanceof AiProviderError);
  const failure = error as AiProviderError;
  assert.equal(failure.code, "OPENAI_STRUCTURED_OUTPUT_INVALID");
  assert.match(failure.message, /relatedObjective/u);
  assert.match(failure.message, /varias referencias igualmente plausibles/u);
  assert.deepEqual(failure.details, {
    cause: "KPI_OBJECTIVE_AMBIGUOUS",
    ambiguousCount: 1,
    noMatchCount: 0,
  });
});

test("un KPI ambiguo junto a otro sin coincidencia tampoco activa la reparación", async () => {
  const mixed = await rawWith([
    AMBIGUOUS_REFERENCE,
    UNRELATED_REFERENCE,
    TIMELY,
  ]);
  const { calls, result, error } = await runProvider(
    [
      () => responseWith(mixed),
      () => {
        throw new Error("No debía existir una llamada de reparación.");
      },
    ],
    mixed,
  );
  assert.equal(calls.length, 1);
  assert.equal(result, undefined);
  assert.ok(error instanceof AiProviderError);
  assert.equal(
    (error as AiProviderError).code,
    "OPENAI_STRUCTURED_OUTPUT_INVALID",
  );
  assert.deepEqual((error as AiProviderError).details, {
    cause: "KPI_OBJECTIVE_AMBIGUOUS",
    ambiguousCount: 1,
    noMatchCount: 1,
  });
});

test("una diferencia superficial con un único destino se canonicaliza sin llamar de nuevo", async () => {
  const safe = await rawWith([
    "ALCANZAR EL 95 % DE SOLICITUDES APROBADAS A TIEMPO",
    INTERNAL,
    EXTERNAL,
  ]);
  const { calls, result, error } = await runProvider(
    [() => responseWith(safe)],
    safe,
  );
  assert.equal(error, undefined);
  assert.equal(calls.length, 1);
  assert.deepEqual(scopeRelated(result), [TIMELY, INTERNAL, EXTERNAL]);
});

test("solo el KPI sin coincidencia se repara; los seguros se conservan canonicalizados", async () => {
  const partial = await rawWith([
    "ALCANZAR EL 95 % DE SOLICITUDES APROBADAS A TIEMPO", // seguro
    UNRELATED_REFERENCE, // sin coincidencia
    INTERNAL, // exacto
  ]);
  const names = (section(partial, "scope").kpis as Raw[]).map(
    (kpi) => kpi.name,
  );
  const { calls, result, error } = await runProvider(
    [
      () => responseWith(partial, { input_tokens: 500, output_tokens: 900 }),
      () =>
        responseWith(
          { kpis: [{ name: names[1], relatedObjective: EXTERNAL }] },
          { input_tokens: 20, output_tokens: 30 },
        ),
    ],
    partial,
  );
  assert.equal(error, undefined);
  assert.equal(calls.length, 2);
  // La reparación solo menciona y solo puede devolver el KPI sin coincidencia.
  const repair = calls[1]!;
  assert.deepEqual(
    repair.text.format.schema.properties.kpis.items.properties.name.enum,
    [names[1]],
  );
  assert.equal(repair.text.format.schema.properties.kpis.minItems, 1);
  assert.equal(repair.text.format.schema.properties.kpis.maxItems, 1);
  const prompt = JSON.stringify(repair.input);
  assert.ok(prompt.includes(String(names[1])));
  assert.ok(!prompt.includes(String(names[0])));
  assert.ok(!prompt.includes(String(names[2])));
  // Resultado: los tres KPI quedan como copia exacta de un objetivo generado.
  assert.deepEqual(scopeRelated(result), [TIMELY, EXTERNAL, INTERNAL]);
  assert.equal(result!.inputTokens, 520);
  assert.equal(result!.outputTokens, 930);
});
