import assert from "node:assert/strict";
import test from "node:test";

import { PrototypesController } from "../../apps/prototypes-service/src/prototypes/prototypes.controller";

const PLANNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IMAGES = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GENERATION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const request = {
  authPrincipal: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
} as never;

function build(options: {
  plannerAvailable: boolean;
  imagesAvailable: boolean;
}) {
  const created: unknown[] = [];
  let started = 0;
  let retried = 0;
  const controller = new PrototypesController(
    {
      createSource: async (input: unknown) => {
        created.push(input);
        return { id: GENERATION };
      },
      getGeneration: async () => ({
        id: GENERATION,
        imageConfigurationId: IMAGES,
      }),
    } as never,
    {} as never,
    {} as never,
    {
      start: async () => {
        started += 1;
        return {};
      },
      retryFailed: async () => {
        retried += 1;
        return {};
      },
    } as never,
    {
      options: async () => ({
        planning: [{ id: PLANNER, available: options.plannerAvailable }],
        images: [{ id: IMAGES, available: options.imagesAvailable }],
      }),
    } as never,
  );
  return { controller, created, counts: () => ({ started, retried }) };
}

const body = {
  sourceFileName: "requerimiento.md",
  markdown: "# Portal\n\n## Inicio de sesión\nFormulario.",
  targetDevice: "RESPONSIVE",
  plannerConfigurationId: PLANNER,
  imageConfigurationId: IMAGES,
};

test("interpretar el Markdown no exige que la IA de imágenes esté probada", async () => {
  const { controller, created } = build({
    plannerAvailable: true,
    imagesAvailable: false,
  });
  await controller.create(request, body);
  assert.equal(created.length, 1);
});

test("la IA que interpreta el Markdown sí debe estar disponible", async () => {
  const { controller, created } = build({
    plannerAvailable: false,
    imagesAvailable: true,
  });
  await assert.rejects(
    () => controller.create(request, body),
    /Selecciona modelos habilitados/u,
  );
  assert.equal(created.length, 0);
});

test("generar o reintentar imágenes exige la IA de imágenes disponible", async () => {
  const blocked = build({ plannerAvailable: true, imagesAvailable: false });
  await assert.rejects(
    () => blocked.controller.imagesStart(request, GENERATION),
    /Pruébala en Configuración/u,
  );
  await assert.rejects(
    () => blocked.controller.retryFailedImages(request, GENERATION),
    /Pruébala en Configuración/u,
  );
  assert.deepEqual(blocked.counts(), { started: 0, retried: 0 });

  const ready = build({ plannerAvailable: true, imagesAvailable: true });
  await ready.controller.imagesStart(request, GENERATION);
  await ready.controller.retryFailedImages(request, GENERATION);
  assert.deepEqual(ready.counts(), { started: 1, retried: 1 });
});
