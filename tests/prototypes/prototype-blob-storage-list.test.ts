import assert from "node:assert/strict";
import test from "node:test";

import { PrototypeImageBlobStorage } from "../../apps/prototypes-service/src/images/prototype-image-blob.storage";

function storage() {
  return new PrototypeImageBlobStorage({
    storageConnectionString: "UseDevelopmentStorage=true",
    storageContainer: "rq-prototype-images",
    maxImageBytes: 1_000_000,
  } as never);
}

function page(blobs: Array<[string, string]>, next = "") {
  const items = blobs
    .map(
      ([name, modified]) =>
        `<Blob><Name>${name}</Name><Properties><Last-Modified>${modified}</Last-Modified></Properties></Blob>`,
    )
    .join("");
  return `<?xml version="1.0"?><EnumerationResults><Blobs>${items}</Blobs><NextMarker>${next}</NextMarker></EnumerationResults>`;
}

async function withFetch<T>(
  handler: (url: URL) => Response,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) =>
    handler(new URL(String(input)))) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

async function collect(instance: PrototypeImageBlobStorage) {
  const result: Array<{ name: string; lastModified: Date }> = [];
  for await (const blob of instance.list()) result.push(blob);
  return result;
}

test("el listado recorre todas las páginas y decodifica los nombres", async () => {
  const requested: URL[] = [];
  const blobs = await withFetch(
    (url) => {
      requested.push(url);
      return url.searchParams.get("marker") === "pagina-2"
        ? new Response(
            page([
              ["prototypes/g/web/002-b.png", "Mon, 12 Oct 2026 10:00:00 GMT"],
            ]),
          )
        : new Response(
            page(
              [
                [
                  "prototypes/g/web/001-a&amp;b.png",
                  "Sun, 11 Oct 2026 08:30:00 GMT",
                ],
                [
                  "prototypes/g/movil/001-a.png",
                  "Sun, 11 Oct 2026 08:31:00 GMT",
                ],
              ],
              "pagina-2",
            ),
          );
    },
    () => collect(storage()),
  );
  assert.deepEqual(
    blobs.map((blob) => blob.name),
    [
      "prototypes/g/web/001-a&b.png",
      "prototypes/g/movil/001-a.png",
      "prototypes/g/web/002-b.png",
    ],
  );
  assert.equal(
    blobs[0]?.lastModified.toISOString(),
    "2026-10-11T08:30:00.000Z",
  );
  assert.equal(requested.length, 2);
  for (const url of requested) {
    assert.equal(url.searchParams.get("restype"), "container");
    assert.equal(url.searchParams.get("comp"), "list");
    assert.match(
      url.searchParams.get("sp") ?? "",
      /l/u,
      "el SAS solo permite listar",
    );
  }
});

test("un contenedor inexistente no tiene archivos y un error HTTP se informa", async () => {
  assert.deepEqual(
    await withFetch(
      () => new Response("", { status: 404 }),
      () => collect(storage()),
    ),
    [],
  );
  await assert.rejects(
    withFetch(
      () => new Response("", { status: 500 }),
      () => collect(storage()),
    ),
    /HTTP 500/u,
  );
});
