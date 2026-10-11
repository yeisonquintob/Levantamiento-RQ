import { expect, test } from "@playwright/test";

/**
 * Smoke obligatorio en CI: no necesita backend, base de datos ni credenciales. El gateway se simula
 * con `page.route`, así que el resultado es determinista y nunca se omite.
 */
test.describe("Smoke de la web (sin backend)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/v1/auth/me", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "No autenticado" }),
      }),
    );
  });

  test("la página de acceso muestra el formulario y envía una cabecera CSP", async ({
    page,
  }) => {
    const response = await page.goto("/sign-in");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-security-policy"]).toContain(
      "default-src 'self'",
    );
    await expect(
      page.getByRole("heading", { name: "Iniciar sesión" }),
    ).toBeVisible();
    await expect(page.getByLabel("Correo electrónico").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Iniciar sesión" }),
    ).toBeVisible();
  });

  test("un acceso rechazado por el gateway se informa sin salir de la página", async ({
    page,
  }) => {
    await page.route("**/api/v1/auth/sign-in", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "Credenciales inválidas." }),
      }),
    );
    await page.goto("/sign-in");
    await page
      .getByLabel("Correo electrónico")
      .first()
      .fill("persona@example.com");
    await page
      .locator('input[name="password"]')
      .first()
      .fill("no-es-una-clave-real");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Credenciales inválidas." }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/u);
  });

  test("el gateway caído se informa con un mensaje claro", async ({ page }) => {
    await page.route("**/api/v1/auth/sign-in", (route) =>
      route.abort("connectionrefused"),
    );
    await page.goto("/sign-in");
    await page
      .getByLabel("Correo electrónico")
      .first()
      .fill("persona@example.com");
    await page
      .locator('input[name="password"]')
      .first()
      .fill("no-es-una-clave-real");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "no está disponible" }),
    ).toBeVisible();
  });

  test("el área de trabajo exige sesión y redirige al acceso", async ({
    page,
  }) => {
    await page.goto("/workspace");
    await expect(page).toHaveURL(/\/sign-in/u);
    await expect(
      page.getByRole("heading", { name: "Iniciar sesión" }),
    ).toBeVisible();
  });

  test("manifiesto y robots se sirven", async ({ request }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    expect((await manifest.json()).short_name).toBe("RQ");
    expect((await request.get("/robots.txt")).status()).toBe(200);
  });

  test("una ruta inexistente muestra la página 404 de la aplicación", async ({
    page,
  }) => {
    const response = await page.goto("/esta-ruta-no-existe");
    expect(response?.status()).toBe(404);
  });
});
