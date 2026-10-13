import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

import { SourcesGatewayController } from "../../apps/gateway/src/sources/sources-gateway.controller";

/**
 * Pruebas con Fastify y @fastify/multipart REALES (resueltos como los usa el Gateway): el límite total de la
 * carga y los de archivos se aplican sobre un flujo multipart verdadero, no sobre una simulación.
 */
const gatewayRequire = createRequire(
  resolve("apps/gateway/src/sources/sources-gateway.controller.ts"),
);
const Fastify = gatewayRequire("fastify") as typeof import("fastify").default;
const multipart = gatewayRequire(
  "@fastify/multipart",
) as typeof import("@fastify/multipart").default;

const BATCH_LIMIT = 10_000;
const FILE_LIMIT = 8_000;
const FILES_LIMIT = 3;

interface Behaviour {
  /** El servicio de fuentes rechaza la comprobación previa con este estado (p. ej. 403 para un VIEWER). */
  denyWith?: number;
}

async function appWith(behaviour: Behaviour = {}) {
  const calls = {
    uploadAccess: 0,
    uploadFiles: [] as unknown[][],
    partsRead: 0,
  };
  const sources = {
    uploadAccess: async () => {
      calls.uploadAccess += 1;
      if (behaviour.denyWith)
        throw Object.assign(new Error("denegado"), {
          getStatus: () => behaviour.denyWith,
        });
      return { allowed: true };
    },
    uploadFiles: async (...args: unknown[]) => {
      calls.uploadFiles.push(args);
      return { accepted: args[2] };
    },
  };
  const controller = new SourcesGatewayController(
    sources as never,
    { sourcesMaxBatchBytes: BATCH_LIMIT } as never,
  );

  const app = Fastify();
  await app.register(multipart as never, {
    limits: {
      files: FILES_LIMIT,
      fileSize: FILE_LIMIT,
      parts: FILES_LIMIT + 5,
    },
  });
  app.post("/projects/:projectId/sources/files", async (request, reply) => {
    const original = (
      request as unknown as { parts: (...a: unknown[]) => unknown }
    ).parts.bind(request);
    (request as unknown as { parts: unknown }).parts = (...args: unknown[]) => {
      calls.partsRead += 1;
      return original(...args);
    };
    try {
      const result = await controller.uploadFiles(
        request as never,
        (request.params as { projectId: string }).projectId,
      );
      return result;
    } catch (error) {
      const status =
        (error as { getStatus?: () => number }).getStatus?.() ?? 500;
      return reply.status(status).send({ message: (error as Error).message });
    }
  });
  return { app, calls };
}

function multipartBody(fileSizes: number[]) {
  const boundary = "----rq-test-boundary";
  const parts: Buffer[] = [];
  fileSizes.forEach((size, index) => {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="f${index}.txt"\r\nContent-Type: text/plain\r\n\r\n`,
      ),
      Buffer.alloc(size, 65),
      Buffer.from("\r\n"),
    );
  });
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{"files":[]}\r\n--${boundary}--\r\n`,
    ),
  );
  return {
    payload: Buffer.concat(parts),
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      cookie: "rq_access=token",
    },
  };
}

async function upload(
  appInstance: Awaited<ReturnType<typeof appWith>>["app"],
  fileSizes: number[],
  extraHeaders: Record<string, string> = {},
) {
  const { payload, headers } = multipartBody(fileSizes);
  return appInstance.inject({
    method: "POST",
    url: "/projects/p-1/sources/files",
    payload,
    headers: { ...headers, ...extraHeaders },
  });
}

test("un lote justo en el límite total se acepta y llega íntegro al servicio de fuentes", async () => {
  const { app, calls } = await appWith();
  try {
    // 4.000 + 3.000 + 3.000 = 10.000 bytes: exactamente el límite.
    const response = await upload(app, [4_000, 3_000, 3_000]);

    assert.equal(response.statusCode, 200);
    assert.equal(calls.uploadFiles.length, 1);
    const files = calls.uploadFiles[0]?.[2] as { buffer: Buffer }[];
    assert.deepEqual(
      files.map((file) => file.buffer.length),
      [4_000, 3_000, 3_000],
    );
  } finally {
    await app.close();
  }
});

test("un lote que supera el límite total en un byte se rechaza con 413 sin entregarlo al servicio", async () => {
  const { app, calls } = await appWith();
  try {
    const response = await upload(app, [4_000, 3_000, 3_001]);

    assert.equal(response.statusCode, 413);
    assert.match(response.json().message, /tamaño total/u);
    assert.equal(calls.uploadFiles.length, 0);
  } finally {
    await app.close();
  }
});

test("el límite total se aplica aunque cada archivo esté dentro de su propio límite", async () => {
  const { app, calls } = await appWith();
  try {
    // Dos archivos de 7.000 bytes (< 8.000 por archivo) suman 14.000 > 10.000.
    const response = await upload(app, [7_000, 7_000]);

    assert.equal(response.statusCode, 413);
    assert.equal(calls.uploadFiles.length, 0);
  } finally {
    await app.close();
  }
});

test("un archivo mayor que el límite por archivo y demasiados archivos responden 413", async () => {
  const { app, calls } = await appWith();
  try {
    assert.equal((await upload(app, [FILE_LIMIT + 1])).statusCode, 413);
    assert.equal((await upload(app, [10, 10, 10, 10])).statusCode, 413);
    assert.equal(calls.uploadFiles.length, 0);
  } finally {
    await app.close();
  }
});

test("quien no puede gestionar el proyecto recibe 403 y su envío no se lee", async () => {
  const { app, calls } = await appWith({ denyWith: 403 });
  try {
    const response = await upload(app, [5_000]);

    assert.equal(response.statusCode, 403);
    assert.equal(calls.uploadAccess, 1);
    assert.equal(calls.partsRead, 0, "no se leyó ninguna parte del multipart");
    assert.equal(calls.uploadFiles.length, 0);
  } finally {
    await app.close();
  }
});

test("la comprobación de acceso se hace antes de leer y la carga permitida la hace una sola vez", async () => {
  const { app, calls } = await appWith();
  try {
    const response = await upload(app, [100]);

    assert.equal(response.statusCode, 200);
    assert.equal(calls.uploadAccess, 1);
    assert.equal(calls.partsRead, 1);
  } finally {
    await app.close();
  }
});
