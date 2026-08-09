import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  InMemorySlidingWindowLimiter,
  isBrowserMutationAllowed,
} from "../../apps/gateway/src/security/gateway-security";

test("el límite de inicio de sesión bloquea intentos y expira la ventana", () => {
  let now = 1_000;
  const limiter = new InMemorySlidingWindowLimiter(2, 60_000, () => now);

  assert.equal(limiter.consume("127.0.0.1").allowed, true);
  assert.equal(limiter.consume("127.0.0.1").allowed, true);
  const rejected = limiter.consume("127.0.0.1");
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.retryAfterSeconds, 60);

  now += 60_001;
  assert.equal(limiter.consume("127.0.0.1").allowed, true);
});

test("las mutaciones de navegador exigen el origen configurado", () => {
  const webOrigin = "http://127.0.0.1:4200";

  assert.equal(
    isBrowserMutationAllowed({
      method: "GET",
      origin: "https://evil.test",
      webOrigin,
    }),
    true,
  );
  assert.equal(
    isBrowserMutationAllowed({ method: "POST", origin: webOrigin, webOrigin }),
    true,
  );
  assert.equal(
    isBrowserMutationAllowed({
      method: "POST",
      origin: "https://evil.test",
      webOrigin,
    }),
    false,
  );
  assert.equal(
    isBrowserMutationAllowed({
      method: "PATCH",
      secFetchSite: "cross-site",
      webOrigin,
    }),
    false,
  );
  assert.equal(
    isBrowserMutationAllowed({ method: "POST", webOrigin }),
    true,
    "clientes internos sin cabeceras de navegador siguen habilitados",
  );
});

test("la PWA excluye navegación, API, Workspace y credenciales de la caché", async () => {
  const worker = await readFile("apps/web/public/sw.js", "utf8");
  const manifest = await readFile("apps/web/src/app/manifest.ts", "utf8");

  assert.match(worker, /request\.mode === "navigate"/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /url\.pathname\.startsWith\("\/workspace"\)/);
  assert.match(worker, /request\.headers\.has\("authorization"\)/);
  const publicShell = worker.match(/const PUBLIC_SHELL = \[([\s\S]*?)\];/)?.[1];
  assert.ok(publicShell);
  assert.doesNotMatch(publicShell, /api|workspace|document/i);
  assert.match(manifest, /display: "standalone"/);
  assert.match(manifest, /icon-512\.png/);
});
