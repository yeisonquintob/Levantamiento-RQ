import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { PrototypeGeneratedImage } from "../../libs/shared/contracts/src/lib/prototypes";
import {
  adjacentScreenIndex,
  galleryDevices,
  orderPrototypeImages,
  PROTOTYPE_GENERATION_STORAGE_KEY,
  prototypeImageFileName,
  prototypeOriginLabel,
  selectedImageForDevice,
} from "../../apps/web/src/app/workspace/prototype/prototype-gallery";

function image(
  order: number,
  device: "WEB" | "MOBILE" = "WEB",
): PrototypeGeneratedImage {
  return {
    id: `${device}-${order}`,
    generationId: "generation",
    visualSpecificationId: `spec-${device}-${order}`,
    screenId: `screen-${order}`,
    screenCode: `Facturas con IMP ${order}`,
    screenName: `Pantalla ${order}`,
    screenOrder: order,
    screenObjective: `Objetivo ${order}`,
    screenOrigin: order % 2 ? "EXPLICIT" : "DERIVED",
    device,
    provider: "OPENAI_IMAGES",
    model: "image-model",
    status: "COMPLETED",
    mediaType: "image/png",
    storageKey: `private/${order}.png`,
    width: 100,
    height: 100,
    attemptNumber: 1,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  };
}

test("selector Web/Móvil solo muestra dispositivos pertinentes", () => {
  assert.deepEqual(galleryDevices("RESPONSIVE"), ["WEB", "MOBILE"]);
  assert.deepEqual(galleryDevices("WEB"), ["WEB"]);
  assert.deepEqual(galleryDevices("MOBILE"), ["MOBILE"]);
});

test("galería respeta PrototypeScreen.order y conserva equivalente al cambiar dispositivo", () => {
  const images = [image(3), image(1), image(2), image(2, "MOBILE")];
  assert.deepEqual(
    orderPrototypeImages(images).map((item) => item.screenOrder),
    [1, 2, 2, 3],
  );
  assert.equal(
    selectedImageForDevice(images, "MOBILE", "screen-2")?.id,
    "MOBILE-2",
  );
});

test("navegación anterior/siguiente se limita a la colección", () => {
  assert.equal(adjacentScreenIndex(1, 4, -1), 0);
  assert.equal(adjacentScreenIndex(1, 4, 1), 2);
  assert.equal(adjacentScreenIndex(0, 4, -1), 0);
  assert.equal(adjacentScreenIndex(3, 4, 1), 3);
});

test("origen se presenta en lenguaje funcional", () => {
  assert.equal(
    prototypeOriginLabel("EXPLICIT"),
    "Definida en el requerimiento",
  );
  assert.equal(prototypeOriginLabel("DERIVED"), "Derivada del flujo");
});

test("descarga individual produce nombre seguro y ordenado", () => {
  assert.equal(
    prototypeImageFileName(image(4)),
    "04-facturas-con-imp-4-web.png",
  );
});

test("persistencia local conserva únicamente el ID de generación", () => {
  assert.equal(
    PROTOTYPE_GENERATION_STORAGE_KEY,
    "rq-prototype-current-generation-v1",
  );
});

test("workspace contiene galería horizontal antes de la imagen y contadores por formato", async () => {
  const source = await workspaceSource();
  assert.match(source, /Pantallas/);
  assert.match(source, /styles.galleryStrip/);
  assert.ok(
    source.indexOf("styles.galleryStrip") < source.indexOf("styles.stage}"),
  );
  assert.match(source, /styles.galleryCounts/);
  assert.match(source, /thumbs/);
  assert.match(source, /imageProgress.failedImages/);
  assert.doesNotMatch(source, /Motor de planificación:|Vistas del prototipo/);
  assert.match(source, /imageStatusLabel/);
  assert.match(source, /aria-label="Ver imagen anterior"/);
  assert.match(source, /aria-label="Ver imagen siguiente"/);
  assert.match(source, /onClick=\{\(\) => navigate\(-1\)\}/);
  assert.match(source, /onClick=\{\(\) => navigate\(1\)\}/);
});

test("progreso usa backend, aria-live y polling no agresivo con visibilitychange", async () => {
  const source = await workspaceSource();
  assert.match(source, /imageProgress\.completedImages/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /3_500/);
  assert.doesNotMatch(source, /Math\.random|setProgress\s*\(/);
});

test("al terminar el Markdown espera selección antes de generar imágenes", async () => {
  const source = await workspaceSource();
  const pipeline = source.slice(
    source.indexOf("async function continueWithImages"),
    source.indexOf("async function imageAction"),
  );
  assert.match(pipeline, /visual-specifications/);
  assert.match(pipeline, /PrototypeImageGenerationResult/);
  assert.match(pipeline, /setPreviewTab\("IMAGES"\)/);
  assert.match(source, /imageProviderSelected/);
  assert.match(source, /selectedScreenCodes/);
  assert.match(source, /Generar imagen de/);
  assert.match(source, /Generar.*pantalla/);
  assert.doesNotMatch(
    source,
    /void continueWithImages\(generation\);\n  }, \[/,
  );
  assert.match(source, /stopCurrentGeneration/);
});

test("el módulo abre siempre en historial y Nuevo inicia una fuente", async () => {
  const source = await workspaceSource();
  const newButton = source.slice(
    source.indexOf("className={styles.newPrototype}"),
    source.indexOf(
      "</button>",
      source.indexOf("className={styles.newPrototype}"),
    ),
  );
  // "Nuevo" inicia una fuente nueva, pero queda deshabilitado mientras hay una
  // acción activa: reiniciar el estado durante un `await` podría aplicar su
  // resultado sobre una generación ya descartada.
  assert.match(newButton, /onClick=\{startNewPrototype\}/);
  assert.match(newButton, /disabled=\{Boolean\(actionBusy\)\}/);
  assert.match(source, /useState<"SOURCE" \| "HISTORY">\(\s*"HISTORY",\s*\)/);
  assert.match(source, /El módulo abre siempre en el listado completo/);
  assert.doesNotMatch(source, /setHistoryFormat/);
  assert.match(source, /setHistoryDateFrom/);
  assert.match(source, /setHistoryDateTo/);
  assert.match(source, /setHistorySort/);
  assert.doesNotMatch(source, /aria-current=\{workspaceView/);
});

test("reload recupera todos los recursos sin volver a POST images", async () => {
  const source = await workspaceSource();
  const restore = source.slice(
    source.indexOf("async function restoreGeneration"),
    source.indexOf("async function getJson"),
  );
  assert.match(restore, /screens/);
  assert.match(restore, /visual-specifications/);
  assert.match(restore, /images/);
  assert.match(restore, /image-progress/);
  assert.doesNotMatch(restore, /postJson|method:\s*"POST"/);
});

test("retry, retry-failed y regeneración confirmada están disponibles", async () => {
  const source = await workspaceSource();
  assert.match(source, /Reintentar imagen/);
  assert.match(source, /Reintentar fallidas/);
  assert.match(source, /puede producir consumo adicional de IA/);
  // La confirmación es el diálogo propio de la app (useConfirm), no el cuadro nativo.
  assert.match(source, /await confirm\(\{\s+title: "Regenerar imagen"/);
  assert.doesNotMatch(source, /window\.confirm/);
});

test("descarga revoca object URL y las miniaturas cargan diferido", async () => {
  const source = await workspaceSource();
  assert.match(source, /URL\.createObjectURL/);
  assert.match(source, /URL\.revokeObjectURL/);
  assert.match(source, /loading="lazy"/);
});

test("accesibilidad, bloqueo de doble costo y tabs no disparan generación", async () => {
  const source = await workspaceSource();
  assert.match(source, /aria-current/);
  assert.match(source, /aria-label="Pantalla anterior"/);
  assert.match(source, /disabled=\{\s*recovering \|\|\s*isActive/s);
  const choose = source.slice(
    source.indexOf("function chooseDevice"),
    source.indexOf("function navigate"),
  );
  assert.doesNotMatch(choose, /postJson|startImages|generatePrototype/);
});

test("workspace no expone secretos, base64 ni rutas Blob", async () => {
  const source = await workspaceSource();
  assert.doesNotMatch(
    source,
    /apiKey|secretReference|imageBase64|storageConnectionString/,
  );
  assert.doesNotMatch(source, /storageKey\}/);
});

async function workspaceSource() {
  return readFile(
    join(
      process.cwd(),
      "apps/web/src/app/workspace/prototype/prototype-workspace.tsx",
    ),
    "utf8",
  );
}

test("Nuevo se deshabilita solo mientras actionBusy tiene valor y se libera al terminar", async () => {
  const source = await workspaceSource();
  // Sin acción activa el estado inicial es null: el botón está disponible.
  assert.match(
    source,
    /const \[actionBusy, setActionBusy\] = useState<string \| null>\(null\)/,
  );
  // Cada vez que se marca una acción activa existe su liberación; las acciones
  // asíncronas la hacen en `finally` para liberarla también ante un error.
  const marks = [...source.matchAll(/setActionBusy\((?!null)[^)]*\)/g)].length;
  const releases = [...source.matchAll(/setActionBusy\(null\)/g)].length;
  assert.ok(marks > 0);
  assert.ok(
    releases >= marks,
    `hay ${marks} acciones que marcan actividad y solo ${releases} liberaciones`,
  );
  const finallyReleases = [
    ...source.matchAll(/finally \{[^}]*setActionBusy\(null\)/g),
  ].length;
  assert.ok(
    finallyReleases > 0,
    "la liberación debe estar en un bloque finally",
  );
  // `startNewPrototype()` solo se invoca desde el botón (protegido por
  // actionBusy) o dentro de la eliminación de la selección, que ya está en una
  // acción activa y reinicia la pantalla antes de liberarla.
  const calls = [...source.matchAll(/startNewPrototype\(\)/g)].map(
    (match) => match.index ?? -1,
  );
  const definition = source.indexOf("function startNewPrototype()");
  const deleting = source.indexOf('setActionBusy("delete-selected")');
  const deletingEnd = source.indexOf("setActionBusy(null)", deleting);
  assert.ok(deleting >= 0 && deletingEnd > deleting);
  for (const call of calls) {
    if (call === definition + "function ".length) continue;
    assert.ok(
      call > deleting && call < deletingEnd,
      "startNewPrototype() solo puede llamarse desde una acción ya protegida",
    );
  }
});
