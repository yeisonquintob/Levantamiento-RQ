import { expect, test, type Page } from "@playwright/test";

import { requireApprovedProject, requireCredentials, trackableProjectRows } from "./support";

/** Cada pestaña debe apuntar (aria-controls) a un panel que exista y esté etiquetado por ella. */
async function expectTabsControlPanels(page: Page) {
  const report = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((tab) => {
      const target = tab.getAttribute("aria-controls");
      const panel = target ? document.getElementById(target) : null;
      return {
        label: (tab.textContent ?? "").trim().slice(0, 40),
        controls: target,
        panelExists: Boolean(panel),
      };
    }),
  );
  expect(report.length).toBeGreaterThan(0);
  const broken = report.filter((item) => !item.controls || !item.panelExists);
  expect(broken, JSON.stringify(broken)).toEqual([]);
}

test.describe("Pestañas accesibles", () => {
  test.beforeEach(() => requireCredentials());

  test("Ejecución: las pestañas controlan su panel y el panel se etiqueta con la pestaña activa", async ({ page }) => {
    await page.goto("/workspace/execution");
    // Un proyecto aprobado (sin aviso de bloqueo): se reconoce por el estado del listado.
    await expect(page.getByRole("button", { name: "Abrir" }).first()).toBeVisible();
    const trackable = trackableProjectRows(page);
    requireApprovedProject(await trackable.count(), "No hay un proyecto aprobado con plan de trabajo.");
    await trackable.first().getByRole("button", { name: "Abrir" }).click();
    await expect(page.getByRole("tab", { name: /Resumen de cumplimiento/u })).toBeVisible();
    await expectTabsControlPanels(page);
    const panel = page.getByRole("tabpanel");
    await expect(panel).toHaveAttribute("aria-labelledby", "rq-exec-tab-summary");
    await page.getByRole("tab", { name: /Actividades y tareas/u }).click();
    await expect(panel).toHaveAttribute("aria-labelledby", "rq-exec-tab-tasks");
    await expectTabsControlPanels(page);
  });

  test("Configuración de proveedores de IA: las tres vistas comparten un panel etiquetado", async ({ page }) => {
    await page.goto("/workspace/settings/ai-providers");
    test.skip(!(await page.getByRole("tab").first().isVisible({ timeout: 6_000 }).catch(() => false)), "El usuario de prueba no accede a esta configuración.");
    await expectTabsControlPanels(page);
    await page.getByRole("tab", { name: /Por proveedor/u }).click();
    await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "ai-provider-tab-PROVIDERS");
  });
});

test.describe("Catálogo de modelos de IA", () => {
  test("la lista de modelos no se desborda sobre el panel de detalle", async ({ page }) => {
    requireCredentials();
    await page.goto("/workspace/settings/ai-providers");
    test.skip(!(await page.getByRole("tab", { name: /Por proveedor/u }).isVisible({ timeout: 6_000 }).catch(() => false)), "El usuario de prueba no accede a esta configuración.");
    await page.getByRole("tab", { name: /Por proveedor/u }).click();
    await page.getByRole("button", { name: /^Imágenes\s*\d/u }).first().click();
    const models = page.locator(".rq-ai-cat__models");
    await expect(models).toBeVisible();
    const overflow = await models.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
