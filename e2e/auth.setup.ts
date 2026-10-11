import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { test as setup } from "@playwright/test";

import { AUTH_FILE, hasCredentials, signIn } from "./support";

/** Inicia sesión una sola vez y reutiliza la sesión: evita decenas de accesos seguidos. */
setup("autenticar el usuario de prueba", async ({ page }) => {
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  if (!hasCredentials()) {
    writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }));
    setup.skip(true, "Define E2E_EMAIL y E2E_PASSWORD para ejecutar las pruebas con sesión.");
    return;
  }
  await signIn(page);
  await page.context().storageState({ path: AUTH_FILE });
});
