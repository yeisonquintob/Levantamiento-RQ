import assert from "node:assert/strict";
import { crc32 as nodeCrc32 } from "node:zlib";
import test from "node:test";

import {
  buildZip,
  crc32,
} from "../../apps/web/src/app/workspace/prototype/zip-store";
import {
  prototypeImageZipFolder,
  prototypeImagesZipName,
} from "../../apps/web/src/app/workspace/prototype/prototype-gallery";

const png = (seed: number) =>
  Uint8Array.from({ length: 300 }, (_, index) => (index * seed + 7) % 256);

test("el CRC-32 coincide con el de Node", () => {
  for (const seed of [1, 3, 17]) {
    const data = png(seed);
    assert.equal(crc32(data), nodeCrc32(Buffer.from(data)));
  }
  assert.equal(crc32(new Uint8Array()), 0);
});

test("buildZip escribe un ZIP estándar con carpetas, nombres UTF-8 y contenido intacto", () => {
  const first = png(3);
  const second = png(5);
  const zip = buildZip([
    {
      name: "web/01-inicio-web.png",
      data: first,
      modified: new Date(2026, 9, 11, 18, 30, 40),
    },
    { name: "movil/01-inicio-movil.png", data: second },
    { name: "web/02-niño-ñandú.png", data: new Uint8Array() },
  ]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  // Registro final: 3 entradas y directorio central dentro del archivo.
  const eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  assert.equal(view.getUint16(eocd + 8, true), 3);
  assert.equal(view.getUint16(eocd + 10, true), 3);
  const directoryOffset = view.getUint32(eocd + 16, true);
  assert.equal(view.getUint32(directoryOffset, true), 0x02014b50);

  // Cada entrada del directorio apunta a una cabecera local con el mismo nombre y datos idénticos.
  let cursor = directoryOffset;
  const decoder = new TextDecoder();
  const expected = [
    { name: "web/01-inicio-web.png", data: first },
    { name: "movil/01-inicio-movil.png", data: second },
    { name: "web/02-niño-ñandú.png", data: new Uint8Array() },
  ];
  for (const item of expected) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50);
    assert.equal(
      view.getUint16(cursor + 8, true) & 0x0800,
      0x0800,
      "nombres UTF-8",
    );
    assert.equal(view.getUint16(cursor + 10, true), 0, "sin compresión");
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const local = view.getUint32(cursor + 42, true);
    const name = decoder.decode(
      zip.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    assert.equal(name, item.name);
    assert.equal(size, item.data.length);
    assert.equal(crc, nodeCrc32(Buffer.from(item.data)));
    assert.equal(view.getUint32(local, true), 0x04034b50);
    const localNameLength = view.getUint16(local + 26, true);
    const dataStart = local + 30 + localNameLength;
    assert.deepEqual(zip.subarray(dataStart, dataStart + size), item.data);
    cursor += 46 + nameLength;
  }
  assert.equal(
    cursor,
    eocd,
    "el directorio central termina donde empieza el registro final",
  );
});

test("nombre del ZIP y carpeta por formato", () => {
  assert.equal(
    prototypeImagesZipName("Portal de Cartera"),
    "imagenes-portal-de-cartera.zip",
  );
  assert.equal(
    prototypeImagesZipName("Niño/Ñandú ✓"),
    "imagenes-nino-nandu.zip",
  );
  assert.equal(prototypeImagesZipName(null), "imagenes-prototipo.zip");
  assert.equal(prototypeImageZipFolder({ device: "WEB" } as never), "web");
  assert.equal(prototypeImageZipFolder({ device: "MOBILE" } as never), "movil");
});
