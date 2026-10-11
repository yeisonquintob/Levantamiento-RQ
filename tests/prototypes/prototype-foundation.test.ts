import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parsePrototypeGenerationCreate } from "../../apps/prototypes-service/src/prototypes/prototype-input";
import {
  markdownSha256,
  PrototypeGenerationService,
} from "../../apps/prototypes-service/src/prototypes/prototype-generation.service";

test("valida y conserva un Markdown real, su nombre y targetDevice", () => {
  const input = parsePrototypeGenerationCreate({
    sourceFileName: "RQ-real.md",
    markdown: "# Requerimiento\r\nContenido",
    targetDevice: "MOBILE",
  });
  assert.equal(input.sourceFileName, "RQ-real.md");
  assert.equal(input.markdown, "# Requerimiento\nContenido");
  assert.equal(input.targetDevice, "MOBILE");
});
test("rechaza Markdown vacío", () => {
  assert.throws(
    () =>
      parsePrototypeGenerationCreate({
        sourceFileName: "vacio.md",
        markdown: "  \n",
        targetDevice: "WEB",
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "El archivo Markdown está vacío.",
  );
});
test("calcula SHA-256 determinístico después de normalizar finales de línea", () => {
  assert.equal(markdownSha256("# RQ\r\nTexto"), markdownSha256("# RQ\nTexto"));
  assert.equal(
    markdownSha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
test("crea PrototypeGeneration SOURCE_READY y no crea pantallas", async () => {
  let saved: Record<string, unknown> | undefined;
  const generationRepo = {
    create: (value: Record<string, unknown>) => ({
      id: "11111111-1111-4111-8111-111111111111",
      ...value,
      createdAt: new Date("2026-09-09T00:00:00Z"),
      updatedAt: new Date("2026-09-09T00:00:00Z"),
    }),
    save: async (value: Record<string, unknown>) => {
      saved = value;
      return value;
    },
    findOne: async () => saved ?? null,
  };
  const screenRepo = { find: async () => [] };
  const service = new PrototypeGenerationService(
    generationRepo as never,
    screenRepo as never,
  );
  const created = await service.createSource(
    { sourceFileName: "RQ.md", markdown: "# RQ", targetDevice: "RESPONSIVE" },
    "22222222-2222-4222-8222-222222222222",
  );
  assert.equal(created.status, "SOURCE_READY");
  assert.equal(created.targetDevice, "RESPONSIVE");
  assert.equal(created.totalScreens, 0);
  assert.equal((saved as Record<string, unknown>).sourceMarkdown, "# RQ");
  assert.equal(
    (created as unknown as Record<string, unknown>).sourceMarkdown,
    undefined,
  );
  assert.deepEqual(
    await service.listScreens(
      created.id,
      "22222222-2222-4222-8222-222222222222",
    ),
    [],
  );
});
test("la interfaz lee File.text y no simula generación con setGenerated", async () => {
  const source = await readFile(
    join(
      process.cwd(),
      "apps/web/src/app/workspace/prototype/prototype-source.ts",
    ),
    "utf8",
  );
  const workspace = await readFile(
    join(
      process.cwd(),
      "apps/web/src/app/workspace/prototype/prototype-workspace.tsx",
    ),
    "utf8",
  );
  assert.match(source, /await file\.text\(\)/);
  assert.doesNotMatch(workspace, /setGenerated\s*\(/);
  assert.match(workspace, /markdown:\s*markdownContent/);
});
test("el dominio no importa proveedores de IA, Ollama ni imágenes", async () => {
  const service = await readFile(
    join(
      process.cwd(),
      "apps/prototypes-service/src/prototypes/prototype-generation.service.ts",
    ),
    "utf8",
  );
  assert.doesNotMatch(
    service,
    /openai|ollama|imagegen|AiAnalysisExecutionService/i,
  );
});

test("GET screens puede devolver el plan persistido con componentes", async () => {
  const owner = "22222222-2222-4222-8222-222222222222";
  const generation = {
    id: "11111111-1111-4111-8111-111111111111",
    requestedByUserId: owner,
  };
  const generationRepo = { findOne: async () => generation };
  const screenRepo = {
    find: async () => [
      {
        id: "33333333-3333-4333-8333-333333333333",
        generationId: generation.id,
        order: 1,
        code: "home",
        name: "Inicio",
        objective: "Mostrar resumen",
        origin: "EXPLICIT",
        route: "/",
        componentsJson: '["Tabla","Filtros"]',
        device: "WEB",
        status: "PLANNED",
        imageStorageKey: null,
      },
    ],
  };
  const service = new PrototypeGenerationService(
    generationRepo as never,
    screenRepo as never,
  );
  const screens = await service.listScreens(generation.id, owner);
  assert.deepEqual(screens[0]?.components, ["Tabla", "Filtros"]);
  assert.equal(screens[0]?.status, "PLANNED");
});

test("GET generations lista únicamente el historial del usuario", async () => {
  const owner = "22222222-2222-4222-8222-222222222222";
  let query: Record<string, unknown> | undefined;
  const generationRepo = {
    find: async (options: Record<string, unknown>) => {
      query = options;
      return [];
    },
  };
  const service = new PrototypeGenerationService(
    generationRepo as never,
    { find: async () => [] } as never,
  );

  assert.deepEqual(await service.listGenerations(owner), []);
  assert.deepEqual(query?.where, { requestedByUserId: owner });
  assert.deepEqual(query?.order, {
    updatedAt: "DESC",
    createdAt: "DESC",
  });
});
