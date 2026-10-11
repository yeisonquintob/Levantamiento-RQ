import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { authenticatedSignInDestination } from "../../apps/web/src/app/sign-in/sign-in-navigation-policy";

test("un usuario autenticado no vuelve a mostrar el inicio de sesión", () => {
  assert.equal(authenticatedSignInDestination(false), "/workspace");
  assert.equal(authenticatedSignInDestination(true), "/change-password");
});

test("el inicio de sesión permanece disponible sin sesión validada", () => {
  assert.equal(authenticatedSignInDestination(null), null);
});

test("el acceso reemplaza el historial y revalida restauraciones del navegador", async () => {
  const [form, page] = await Promise.all([
    readFile("apps/web/src/app/sign-in/sign-in-form.tsx", "utf8"),
    readFile("apps/web/src/app/sign-in/page.tsx", "utf8"),
  ]);

  assert.match(form, /window\.location\.replace/u);
  assert.match(form, /addEventListener\("pageshow"/u);
  assert.match(form, /api\/v1\/auth\/me/u);
  assert.match(page, /resolveAuthenticatedDestination/u);
  assert.match(page, /cache: "no-store"/u);
});
