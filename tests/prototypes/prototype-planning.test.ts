import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  parsePrototypePlan,
  type PrototypePlan,
} from "../../libs/shared/contracts/src/lib/prototypes";
import { OpenAiPrototypePlannerProvider } from "../../apps/prototypes-service/src/planning/openai-prototype-planner.provider";
import type { PrototypePlannerProvider } from "../../apps/prototypes-service/src/planning/prototype-planner.provider";
import { PrototypePlanningService } from "../../apps/prototypes-service/src/planning/prototype-planning.service";
import { PrototypeGenerationEntity } from "../../apps/prototypes-service/src/prototypes/prototype-generation.entity";
import { PrototypeScreenEntity } from "../../apps/prototypes-service/src/prototypes/prototype-screen.entity";

const validPlan: PrototypePlan = {
  applicationName: "Portal DIAN",
  summary: "Consulta operativa",
  targetDevice: "RESPONSIVE",
  screens: [
    {
      code: "login",
      name: "Inicio de sesión",
      objective: "Permitir autenticación corporativa",
      origin: "DERIVED",
      route: "/login",
      components: ["Formulario de acceso"],
      order: 1,
    },
    {
      code: "reportes",
      name: "Reportes DIAN",
      objective: "Consultar reportes documentados",
      origin: "EXPLICIT",
      route: "/reportes",
      components: ["Tabla", "Filtros"],
      order: 2,
    },
  ],
};

test("PrototypePlannerProvider permanece desacoplado y OpenAI lo implementa", async () => {
  const client = {
    execute: async () => ({
      provider: "OPENAI" as const,
      model: "gpt-test",
      executionId: "exec-1",
      structuredResult: validPlan,
    }),
  };
  const provider: PrototypePlannerProvider = new OpenAiPrototypePlannerProvider(
    client as never,
  );
  const output = await provider.plan({
    markdown: "# Portal",
    targetDevice: "RESPONSIVE",
    correlationId: "corr",
  });
  assert.deepEqual(output.plan, validPlan);
  assert.equal(output.model, "gpt-test");
});

test("JSON estructurado válido produce un plan", () => {
  assert.deepEqual(parsePrototypePlan(validPlan, "RESPONSIVE"), validPlan);
});
test("JSON inválido falla", () => {
  assert.throws(() => parsePrototypePlan({ ...validPlan, summary: "" }));
});
test("screen code duplicado falla", () => {
  assert.throws(
    () =>
      parsePrototypePlan({
        ...validPlan,
        screens: [
          validPlan.screens[0],
          { ...validPlan.screens[1], code: "login" },
        ],
      }),
    /PROTOTYPE_SCREEN_CODE_DUPLICATED/,
  );
});
test("origin inválido falla", () => {
  assert.throws(() =>
    parsePrototypePlan({
      ...validPlan,
      screens: [{ ...validPlan.screens[0], origin: "INVENTED" }],
    }),
  );
});
test("screens vacío falla", () => {
  assert.throws(
    () => parsePrototypePlan({ ...validPlan, screens: [] }),
    /PROTOTYPE_PLAN_EMPTY/,
  );
});

function generation() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: null,
    sourceFileName: "RQ.md",
    sourceMarkdown: "# Portal",
    sourceSha256: "a".repeat(64),
    sourceSizeBytes: "8",
    targetDevice: "RESPONSIVE" as const,
    status: "SOURCE_READY" as const,
    plannerProvider: null,
    plannerModel: null,
    applicationName: null,
    summary: null,
    imageProvider: null,
    totalScreens: 0,
    generatedScreens: 0,
    errorCode: null,
    errorMessage: null,
    requestedByUserId: "22222222-2222-4222-8222-222222222222",
    createdAt: new Date("2026-09-09T00:00:00Z"),
    updatedAt: new Date("2026-09-09T00:00:00Z"),
  };
}

test("planifica, reemplaza pantallas y termina PLANNED sin duplicar", async () => {
  const entity = generation();
  const persistedScreens: unknown[] = [];
  let deletes = 0;
  const repo = {
    findOne: async () => entity,
    save: async (value: unknown) => value,
  };
  const manager = {
    delete: async (type: unknown) => {
      if (type !== PrototypeGenerationEntity) {
        if (type === PrototypeScreenEntity) deletes += 1;
        persistedScreens.length = 0;
      }
    },
    create: (_type: unknown, value: unknown) => value,
    save: async (type: unknown, value: unknown) => {
      if (type !== PrototypeGenerationEntity && Array.isArray(value))
        persistedScreens.push(...value);
      return value;
    },
  };
  const dataSource = {
    transaction: async (work: (manager: typeof manager) => Promise<void>) =>
      work(manager),
  };
  const fake: PrototypePlannerProvider = {
    plan: async () => ({
      plan: validPlan,
      provider: "OPENAI",
      model: "gpt-test",
      executionId: "exec-1",
    }),
  };
  const service = new PrototypePlanningService(
    repo as never,
    dataSource as never,
    fake,
  );
  const first = await service.planGeneration(
    entity.id,
    entity.requestedByUserId,
  );
  assert.equal(first.generation.status, "PLANNED");
  assert.equal(first.generation.totalScreens, 2);
  assert.equal(first.generation.plannerProvider, "OPENAI");
  assert.equal(persistedScreens.length, 2);
  await service.planGeneration(entity.id, entity.requestedByUserId);
  assert.equal(deletes, 2);
  assert.equal(persistedScreens.length, 2);
});

test("un error del provider termina FAILED sin persistir pantallas", async () => {
  const entity = generation();
  const repo = {
    findOne: async () => entity,
    save: async (value: unknown) => value,
  };
  const dataSource = {
    transaction: async () => {
      throw new Error("no debe ejecutarse");
    },
  };
  const fake: PrototypePlannerProvider = {
    plan: async () => {
      throw new Error("provider failure");
    },
  };
  const service = new PrototypePlanningService(
    repo as never,
    dataSource as never,
    fake,
  );
  await assert.rejects(
    service.planGeneration(entity.id, entity.requestedByUserId),
  );
  assert.equal(entity.status, "FAILED");
  assert.equal(entity.errorCode, "PROTOTYPE_PLANNING_FAILED");
});

test("la implementación no usa prompt documental, Ollama ni generación de imágenes", async () => {
  const files = await Promise.all(
    [
      "apps/prototypes-service/src/planning/openai-prototype-planner.provider.ts",
      "apps/ai-analysis-service/src/internal/internal-structured-execution.service.ts",
      "apps/ai-analysis-service/src/internal/prototype-planning-instruction.ts",
    ].map((path) => readFile(join(process.cwd(), path), "utf8")),
  );
  const source = files.join("\n");
  assert.doesNotMatch(source, /ai-analysis-prompt-builder|document.*prompt/i);
  // La planificación admite un modelo local elegido de forma explícita (rama
  // LOCAL del servicio interno). El proveedor de OpenAI y la instrucción no
  // deben depender de Ollama, y el servicio solo lo usa en esa rama con el
  // esquema del plan de pantallas.
  assert.doesNotMatch(files[0]!, /ollama/i);
  assert.doesNotMatch(files[2]!, /ollama/i);
  assert.match(files[1]!, /selected\.engine === "LOCAL"/);
  assert.match(
    files[1]!,
    /new OllamaClient\(config\)\.generate\(prompt, PROTOTYPE_PLAN_JSON_SCHEMA\)/,
  );
  assert.doesNotMatch(
    source,
    /image[_-]?generation|openai images|imageStorage/i,
  );
});

function detailHarness(structuredResult: unknown, status = "PLANNED") {
  const entity = { ...generation(), status, applicationName: "Portal DIAN", summary: "Consulta operativa", plannerConfigurationId: "33333333-3333-4333-8333-333333333333" } as any;
  const screens: any[] = validPlan.screens.map((screen, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    generationId: entity.id,
    order: screen.order,
    code: screen.code,
    name: screen.name,
    objective: screen.objective,
    origin: screen.origin,
    route: screen.route,
    componentsJson: JSON.stringify(screen.components),
    device: "RESPONSIVE",
    status: "PLANNED",
    imageStorageKey: null,
  }));
  const requests: any[] = [];
  const repo = { findOne: async () => entity, save: async (value: unknown) => value };
  const screenRepo = {
    findOne: async ({ where }: any) => screens.find((item) => item.id === where.id) ?? null,
    find: async () => screens,
    save: async (value: unknown) => value,
  };
  const dataSource = { getRepository: () => screenRepo };
  const client = {
    executeScreenDetail: async (request: unknown) => {
      requests.push(request);
      if (structuredResult instanceof Error) throw structuredResult;
      return { provider: "OLLAMA", model: "qwen-test", executionId: "exec-2", structuredResult };
    },
  };
  const service = new PrototypePlanningService(repo as never, dataSource as never, {} as never, client as never);
  return { service, entity, screens, requests };
}

test("detalla UNA pantalla con la IA elegida y reemplaza su lista de componentes", async () => {
  const detail = {
    objective: "Consultar reportes con filtros por periodo y exportación según el rol",
    components: ["Tabla: Reportes — columnas: Código, Periodo, Estado [RF-04]", "Filtro: Periodo (mes y año) [RF-04]", "Tabla"],
  };
  const { service, entity, screens, requests } = detailHarness(detail);
  const result = await service.detailScreen(entity.id, screens[1].id, entity.requestedByUserId);
  // La petición lleva el Markdown completo, el menú y SOLO esa pantalla como foco.
  assert.equal(requests[0].purpose, "PROTOTYPE_SCREEN_DETAIL");
  assert.equal(requests[0].providerConfigurationId, entity.plannerConfigurationId);
  assert.deepEqual(requests[0].input.menu, ["Inicio de sesión", "Reportes DIAN"]);
  assert.equal(requests[0].input.screen.code, "reportes");
  assert.deepEqual(requests[0].input.screen.components, ["Tabla", "Filtros"]);
  // Lo nuevo manda y lo anterior solo se conserva si no quedó cubierto.
  assert.equal(result.provider, "OLLAMA");
  assert.equal(result.previousComponentCount, 2);
  assert.deepEqual(result.screen.components, [...detail.components, "Filtros"]);
  assert.equal(result.screen.objective, detail.objective);
  assert.equal(JSON.parse(screens[1].componentsJson).length, 4);
  // La otra pantalla no se toca.
  assert.equal(JSON.parse(screens[0].componentsJson).length, 1);
});

test("si la IA falla la pantalla conserva su detalle y solo se detalla con el plan listo", async () => {
  const failing = detailHarness(new Error("Ollama no responde"));
  await assert.rejects(failing.service.detailScreen(failing.entity.id, failing.screens[1].id, failing.entity.requestedByUserId), /Ollama no responde/u);
  assert.deepEqual(JSON.parse(failing.screens[1].componentsJson), ["Tabla", "Filtros"]);

  const built = detailHarness({ objective: "x", components: ["Tabla: a"] }, "VISUAL_SPEC_READY");
  await assert.rejects(built.service.detailScreen(built.entity.id, built.screens[0].id, built.entity.requestedByUserId), /antes de preparar el diseño/u);
  assert.equal(built.requests.length, 0);
});
