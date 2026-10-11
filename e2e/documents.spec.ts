import { expect, test } from "@playwright/test";

import { requireCredentials } from "./support";

const FIELD = ".rq-document-business-form input:not([type=hidden]):not([type=checkbox]), .rq-document-business-form textarea";

/** «Volver a documentos» vive en el menú «Más acciones» del encabezado. */
async function leaveEditor(page: import("@playwright/test").Page) {
  await page.getByLabel("Más acciones").first().click();
  await page.getByRole("link", { name: "Volver a documentos" }).click();
}

/** El botón puede pulsarse antes de que termine la hidratación: se reintenta hasta que abre. */
async function openEditor(page: import("@playwright/test").Page) {
  await expect(async () => {
    await page.getByRole("button", { name: "Editar sección" }).click();
    await expect(page.locator(".rq-document-business-form")).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
}

test.describe("Editor de documentos", () => {
  test.beforeEach(() => requireCredentials());

  test("salir con cambios sin guardar pide confirmación con el diálogo propio y no escribe nada", async ({ page }) => {
    // Red de seguridad: esta prueba nunca debe modificar datos. Cualquier escritura la hace fallar.
    const writes: string[] = [];
    await page.route(/\/api\/v1\/(documents|projects)\//u, (route) => {
      if (route.request().method() !== "GET") {
        writes.push(`${route.request().method()} ${route.request().url()}`);
        return route.abort();
      }
      return route.continue();
    });

    await page.goto("/workspace/documents");
    const draft = page.getByRole("row").filter({ hasText: "Documento generado" }).first();
    test.skip(!(await draft.isVisible({ timeout: 5_000 }).catch(() => false)), "No hay un documento en borrador para probar.");
    await draft.getByRole("link", { name: "Abrir" }).click();
    await expect(page).toHaveURL(/\/workspace\/documents\//u);

    await openEditor(page);
    const field = page.locator(FIELD).first();
    await field.fill(`${await field.inputValue()} (cambio de prueba)`);

    // Con cambios sin guardar, el enlace pide confirmación; cancelar deja en el editor.
    await leaveEditor(page);
    const dialog = page.getByRole("alertdialog", { name: "Cambios sin guardar" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/workspace\/documents\/[^?]+/u);
    await expect(field).toHaveValue(/\(cambio de prueba\)/u);

    // Confirmar la salida descarta el borrador local y vuelve al listado.
    await leaveEditor(page);
    await page.getByRole("alertdialog", { name: "Cambios sin guardar" }).getByRole("button", { name: "Salir sin guardar" }).click();
    await expect(page).toHaveURL(/\/workspace\/documents(\?|$)/u);
    expect(writes).toEqual([]);
  });

  test("cambiar de sección con cambios sin guardar también pide confirmación", async ({ page }) => {
    await page.route(/\/api\/v1\/(documents|projects)\//u, (route) =>
      route.request().method() === "GET" ? route.continue() : route.abort(),
    );
    await page.goto("/workspace/documents");
    const draft = page.getByRole("row").filter({ hasText: "Documento generado" }).first();
    test.skip(!(await draft.isVisible({ timeout: 5_000 }).catch(() => false)), "No hay un documento en borrador para probar.");
    await draft.getByRole("link", { name: "Abrir" }).click();
    await openEditor(page);
    const field = page.locator(FIELD).first();
    await field.fill(`${await field.inputValue()} (otro cambio)`);
    await page.getByRole("button", { name: /Sección 2:/u }).click();
    const dialog = page.getByRole("alertdialog", { name: "Cambios sin guardar" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(field).toHaveValue(/\(otro cambio\)/u);
  });
});
