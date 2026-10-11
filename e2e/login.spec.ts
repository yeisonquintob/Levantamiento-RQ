import { expect, test } from "@playwright/test";

import { requireCredentials, signIn } from "./support";

test.describe("Inicio de sesión", () => {
  test("la página de acceso ofrece el formulario sin credenciales", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeVisible();
  });

  test("un usuario válido entra al Centro de trabajo", async ({ page }) => {
    requireCredentials();
    await signIn(page);
    // El título de la página es el encabezado principal (h1) de la barra superior.
    await expect(page.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Etapas del levantamiento" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Ejecución", exact: true })).toBeVisible();
  });
});
