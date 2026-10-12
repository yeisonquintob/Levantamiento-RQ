import { expect, test } from "./diagnostics";

import { requireCredentials } from "./support";

test.describe("Inicio", () => {
  test.beforeEach(() => requireCredentials());

  test("el avance de los proyectos se guarda en la sesión y se muestra de inmediato al volver", async ({ page }) => {
    await page.goto("/workspace");
    const percentages = () => page.getByText(/^\d+% (avance|completo)$/u).allInnerTexts();
    const cachedCount = () =>
      page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("rq-home-progress-v1:")).length);
    // Espera a que el cálculo real de TODOS los proyectos termine y escriba su caché (basta con uno).
    await expect.poll(async () => (await percentages()).length, { timeout: 30_000 }).toBeGreaterThan(0);
    const projects = (await percentages()).length;
    await expect.poll(cachedCount, { timeout: 60_000 }).toBeGreaterThanOrEqual(projects);

    // La pantalla pasa del avance provisional al real justo DESPUÉS de escribir la caché: se espera a
    // que el porcentaje se estabilice para que «antes» sea el valor real y no el provisional.
    let before = await percentages();
    await expect
      .poll(
        async () => {
          // Se deja pasar un tiempo entre las dos lecturas: `poll` evalúa de inmediato y dos lecturas
          // seguidas darían siempre el mismo valor provisional.
          await page.waitForTimeout(600);
          const current = await percentages();
          const stable = JSON.stringify(current) === JSON.stringify(before);
          before = current;
          return stable;
        },
        { timeout: 10_000, intervals: [0] },
      )
      .toBe(true);

    // Con las peticiones de cálculo bloqueadas, sin caché Inicio mostraría el avance provisional
    // (distinto del real). Con caché muestra exactamente los mismos porcentajes de antes.
    await page.route(/\/api\/v1\/(documents|projects\/[^/]+\/(sources|documents))/u, (route) => route.abort());
    await page.reload();
    await expect.poll(percentages, { timeout: 5_000 }).toEqual(before);
  });
});
