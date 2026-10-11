import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("las claves JWT locales se reutilizan y solo rotan de forma explícita", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rq-jwt-lifecycle-"));
  const destination = join(directory, "jwt-keys.env");

  try {
    await execFileAsync(process.execPath, [
      "scripts/generate-local-jwt-keys.mjs",
      destination,
    ]);
    const first = await readFile(destination, "utf8");

    await execFileAsync(process.execPath, [
      "scripts/generate-local-jwt-keys.mjs",
      destination,
    ]);
    assert.equal(await readFile(destination, "utf8"), first);

    await execFileAsync(process.execPath, [
      "scripts/generate-local-jwt-keys.mjs",
      destination,
      "--rotate",
    ]);
    assert.notEqual(await readFile(destination, "utf8"), first);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("el apagado conserva el keyset local y elimina solo archivos PID", async () => {
  const down = await readFile("scripts/local-auth-down.sh", "utf8");

  assert.doesNotMatch(down, /rm\s+-rf\s+"\$PID_DIR"/u);
  assert.match(down, /-name '\*\.pid' -delete/u);
});

test("Fuentes renueva y reintenta una sola vez antes de cerrar la sesión", async () => {
  const helper = await readFile(
    "apps/web/src/app/authenticated-fetch.ts",
    "utf8",
  );
  const sources = await readFile(
    "apps/web/src/app/workspace/sources/sources-workspace.tsx",
    "utf8",
  );

  assert.match(helper, /response\.status !== 401/u);
  assert.match(helper, /api\/v1\/auth\/refresh/u);
  assert.match(helper, /refresh\.status === 401 \|\| refresh\.status === 403/u);
  assert.match(helper, /return fetch\(input/u);
  assert.match(sources, /authenticatedFetch/u);
});
