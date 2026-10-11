import assert from "node:assert/strict";
import test from "node:test";

import { PrototypeGenerationService } from "../../apps/prototypes-service/src/prototypes/prototype-generation.service";

const ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACTOR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OLLAMA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMFY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function entity(status: string) {
  return {
    id: ID,
    requestedByUserId: ACTOR,
    sourceFileName: "requerimiento.md",
    sourceSizeBytes: "10",
    sourceSha256: "a".repeat(64),
    targetDevice: "RESPONSIVE",
    status,
    imageConfigurationId: OLLAMA,
    plannerConfigurationId: null,
    totalScreens: 2,
    generatedScreens: 0,
    totalVisualSpecifications: 4,
    totalImages: 4,
    completedImages: 0,
    failedImages: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function build(found: ReturnType<typeof entity> | null) {
  const saved: unknown[] = [];
  const service = new PrototypeGenerationService(
    {
      findOne: async () => found,
      save: async (value: unknown) => {
        saved.push(value);
        return value;
      },
    } as never,
    {} as never,
  );
  return { service, saved };
}

test("cambia la IA de imágenes de un prototipo con imágenes fallidas", async () => {
  const { service, saved } = build(entity("FAILED"));
  const detail = await service.updateImageConfiguration(ID, ACTOR, COMFY);
  assert.equal(detail.imageConfigurationId, COMFY);
  assert.equal(saved.length, 1);
});

test("no permite cambiarla mientras se generan imágenes", async () => {
  const { service, saved } = build(entity("IMAGE_GENERATING"));
  await assert.rejects(
    () => service.updateImageConfiguration(ID, ACTOR, COMFY),
    /Detén la generación/u,
  );
  assert.equal(saved.length, 0);
});

test("un prototipo ajeno o inexistente no existe para el usuario", async () => {
  const { service } = build(null);
  await assert.rejects(
    () => service.updateImageConfiguration(ID, ACTOR, COMFY),
    /no existe/u,
  );
});
