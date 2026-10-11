import { expect, test } from "@playwright/test";

import { requireCredentials } from "./support";

test.describe("Inicio", () => {
  test.beforeEach(() => requireCredentials());

  test("el avance de los proyectos se guarda en la sesión y se muestra de inmediato al volver", async ({ page }) => {
    await page.goto("/workspace");
    const percentages = () => page.getByText(/^\d+% (avance|completo)$/u).allInnerTexts();
    const cachedCount = () =>
      page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("rq-home-progress-v1:")).length);
    // Espera a que el cálculo real de TODOS los proyectos termine y escriba su caché.
    await expect.poll(async () => (await percentages()).length, { timeout: 30_000 }).toBeGreaterThan(1);
    const projects = (await percentages()).length;
    await expect.poll(cachedCount, { timeout: 60_000 }).toBeGreaterThanOrEqual(projects);

    // Con las peticiones de cálculo bloqueadas, sin caché Inicio mostraría el avance provisional
    // (distinto del real). Con caché muestra exactamente los mismos porcentajes de antes.
    const before = await percentages();
    await page.route(/\/api\/v1\/(documents|projects\/[^/]+\/(sources|documents))/u, (route) => route.abort());
    await page.reload();
    await expect.poll(percentages, { timeout: 5_000 }).toEqual(before);
  });
});
