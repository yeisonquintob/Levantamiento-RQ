import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { PrototypeScreenDetail } from "../../libs/shared/contracts/src/lib/prototypes";
import { CORPORATE_DEFAULT_V1 } from "../../apps/prototypes-service/src/visual/prototype-design-system";
import { PrototypeImagePromptBuilder } from "../../apps/prototypes-service/src/visual/prototype-image-prompt.builder";
import { PrototypeVisualSpecificationBuilder } from "../../apps/prototypes-service/src/visual/prototype-visual-specification.builder";
import { PrototypeVisualSpecificationEntity } from "../../apps/prototypes-service/src/visual/prototype-visual-specification.entity";
import { PrototypeVisualSpecificationService } from "../../apps/prototypes-service/src/visual/prototype-visual-specification.service";

function screen(index = 1): PrototypeScreenDetail {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    generationId: "11111111-1111-4111-8111-111111111111",
    order: index,
    code: `screen-${index}`,
    name: `Pantalla ${index}`,
    objective: "Consultar información documentada",
    origin: index % 2 ? "EXPLICIT" : "DERIVED",
    route: `/screen-${index}`,
    components: ["invoiceTable", "filters", "exportAction", "errorState"],
    device: "RESPONSIVE",
    status: "PLANNED",
    imageStorageKey: null,
  };
}

test("WEB y MOBILE generan una especificación por pantalla con sus plantillas", () => {
  const builder = new PrototypeVisualSpecificationBuilder();
  const web = builder.build(screen(), "WEB");
  const mobile = builder.build(screen(), "MOBILE");
  assert.equal(web.length, 1);
  assert.equal(web[0]?.templateCode, "WEB_TEMPLATE_V1");
  assert.deepEqual(web[0]?.viewport, { width: 1440, height: 900 });
  assert.equal(mobile.length, 1);
  assert.equal(mobile[0]?.templateCode, "MOBILE_TEMPLATE_V1");
  assert.deepEqual(mobile[0]?.viewport, { width: 390, height: 844 });
  assert.equal(web[0]?.designSystemCode, "CORPORATE_DEFAULT_V1");
  assert.equal(mobile[0]?.designSystemCode, "CORPORATE_DEFAULT_V1");
});

test("RESPONSIVE crea Web y Móvil; 12 pantallas producen 24 specs", () => {
  const builder = new PrototypeVisualSpecificationBuilder();
  const specs = Array.from({ length: 12 }, (_, index) =>
    screen(index + 1),
  ).flatMap((item) => builder.build(item, "RESPONSIVE"));
  assert.equal(specs.length, 24);
  assert.equal(specs.filter((item) => item.device === "WEB").length, 12);
  assert.equal(specs.filter((item) => item.device === "MOBILE").length, 12);
});

test("transforma tabla y filtros por dispositivo sin alterar objetivo ni origen", () => {
  const builder = new PrototypeVisualSpecificationBuilder();
  const source = screen();
  const web = builder.build(source, "WEB")[0]!;
  const mobile = builder.build(source, "MOBILE")[0]!;
  assert.ok(
    web.components.some(
      (item) => item.type === "TABLE" && item.semanticRole === "invoiceTable",
    ),
  );
  assert.ok(
    mobile.components.some(
      (item) => item.type === "LIST" && item.semanticRole === "invoiceTable",
    ),
  );
  assert.ok(web.components.some((item) => item.type === "FILTER_BAR"));
  assert.ok(mobile.components.some((item) => item.type === "DRAWER"));
  assert.equal(web.objective, source.objective);
  assert.equal(mobile.objective, source.objective);
  assert.equal(web.screenOrigin, source.origin);
  assert.equal(mobile.screenOrigin, source.origin);
});

test("Corporate Default V1 centraliza paleta, tipografía y tokens", () => {
  assert.equal(CORPORATE_DEFAULT_V1.colors.primary, "#675579");
  assert.match(CORPORATE_DEFAULT_V1.typography.family, /Inter/);
  assert.equal(CORPORATE_DEFAULT_V1.navigation.sidebarWidth, 240);
});

test("conserva detalles extensos y clasifica el tipo declarado, no las menciones internas", () => {
  const source = screen();
  const detail =
    "Campo: Observaciones; " +
    "Texto documentado. ".repeat(20) +
    "Referencia: tabla de reglas; obligatorio al guardar.";
  source.components = [
    detail,
    "Formulario: Editar detalle con fecha y botón guardar",
    "Botón: Guardar formulario",
  ];
  const spec = new PrototypeVisualSpecificationBuilder().build(
    source,
    "WEB",
  )[0]!;
  assert.ok(
    spec.components.some(
      (item) => item.type === "TEXT_INPUT" && item.semanticRole === detail,
    ),
  );
  assert.ok(spec.components.some((item) => item.type === "FORM"));
  assert.equal(spec.actions.length, 1);
  assert.equal(spec.actions[0]?.semanticRole, "Botón: Guardar formulario");
});

test("todas las vistas comparten identidad y menú en web y móvil", () => {
  const screens = [screen(1), screen(2)];
  const builder = new PrototypeVisualSpecificationBuilder();
  const drafts = screens.flatMap((item) =>
    builder.build(item, "RESPONSIVE", {
      applicationName: "Portal documental",
      screens,
    }),
  );
  for (const draft of drafts) {
    assert.equal(draft.applicationName, "Portal documental");
    assert.equal(draft.navigation.activeScreenCode, draft.screenCode);
    assert.deepEqual(
      draft.navigation.items,
      screens.map((item) => ({
        screenCode: item.code,
        label: item.name,
        route: item.route,
      })),
    );
    const prompt = new PrototypeImagePromptBuilder().build({
      ...draft,
      id: "spec",
      createdAt: "",
      updatedAt: "",
    });
    assert.ok(prompt.includes(JSON.stringify(CORPORATE_DEFAULT_V1)));
    assert.match(prompt, /menu in EVERY view/);
    if (draft.device === "MOBILE")
      assert.match(prompt, /not an operating system home screen/);
  }
});

test("el prompt visual es determinista y no inventa reglas funcionales", () => {
  const draft = new PrototypeVisualSpecificationBuilder().build(
    screen(),
    "WEB",
  )[0]!;
  const spec = {
    ...draft,
    id: "spec-1",
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  };
  const prompt = new PrototypeImagePromptBuilder();
  assert.equal(prompt.build(spec), prompt.build(spec));
  assert.match(prompt.build(spec), /Do not add functionality/);
  assert.doesNotMatch(prompt.build(spec), /NIT|proveedor real|saldo real/i);
});

test("la construcción persistente reemplaza specs y no duplica", async () => {
  const generation = {
    id: screen().generationId,
    projectId: null,
    sourceFileName: "RQ.md",
    sourceMarkdown: "# RQ",
    sourceSha256: "a".repeat(64),
    sourceSizeBytes: "4",
    targetDevice: "RESPONSIVE" as const,
    status: "PLANNED" as
      "PLANNED" | "VISUAL_SPEC_BUILDING" | "VISUAL_SPEC_READY" | "FAILED",
    plannerProvider: "OPENAI" as const,
    plannerModel: "gpt-test",
    applicationName: "Portal",
    summary: "Consulta",
    imageProvider: null,
    totalScreens: 12,
    generatedScreens: 0,
    totalVisualSpecifications: 0,
    errorCode: null,
    errorMessage: null,
    requestedByUserId: "22222222-2222-4222-8222-222222222222",
    createdAt: new Date("2026-09-09T00:00:00Z"),
    updatedAt: new Date("2026-09-09T00:00:00Z"),
  };
  const screens = Array.from({ length: 12 }, (_, index) => {
    const value = screen(index + 1);
    return { ...value, componentsJson: JSON.stringify(value.components) };
  });
  const persisted: Record<string, unknown>[] = [];
  let deleteCount = 0;
  const generationRepo = {
    findOne: async () => generation,
    save: async (value: unknown) => value,
  };
  const screenRepo = { find: async () => screens };
  const specificationRepo = {
    create: (value: Record<string, unknown>) => value,
    find: async () => persisted,
  };
  const manager = {
    delete: async () => {
      deleteCount += 1;
      persisted.length = 0;
    },
    save: async (type: unknown, value: unknown) => {
      if (type === PrototypeVisualSpecificationEntity && Array.isArray(value))
        persisted.push(...(value as Record<string, unknown>[]));
      return value;
    },
  };
  const dataSource = {
    transaction: async (work: (manager: typeof manager) => Promise<void>) =>
      work(manager),
  };
  const service = new PrototypeVisualSpecificationService(
    generationRepo as never,
    screenRepo as never,
    specificationRepo as never,
    dataSource as never,
    new PrototypeVisualSpecificationBuilder(),
  );
  const first = await service.buildForGeneration(
    generation.id,
    generation.requestedByUserId,
  );
  assert.equal(first.total, 24);
  assert.equal(first.generation.status, "VISUAL_SPEC_READY");
  assert.equal(persisted.length, 24);
  const second = await service.buildForGeneration(
    generation.id,
    generation.requestedByUserId,
  );
  assert.equal(second.total, 24);
  assert.equal(persisted.length, 24);
  assert.equal(deleteCount, 2);
  const subset = await service.buildForGeneration(
    generation.id,
    generation.requestedByUserId,
    ["screen-2"],
  );
  assert.equal(subset.total, 2);
  assert.equal(subset.specifications[0]?.navigation.items?.length, 12);
  assert.equal(
    subset.specifications[0]?.navigation.activeScreenCode,
    "screen-2",
  );
});

test("el módulo visual no llama IA ni produce binarios o imágenes", async () => {
  const source = (
    await Promise.all(
      [
        "prototype-visual-specification.builder.ts",
        "prototype-visual-specification.service.ts",
        "prototype-image-prompt.builder.ts",
      ].map((name) =>
        readFile(
          join(process.cwd(), "apps/prototypes-service/src/visual", name),
          "utf8",
        ),
      ),
    )
  ).join("\n");
  assert.doesNotMatch(
    source,
    /fetch\s*\(|openai|ollama|image\.create|Buffer\.from|writeFile/i,
  );
});
