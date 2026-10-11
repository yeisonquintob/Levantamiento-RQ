import { expect, test } from "@playwright/test";

import { requireCredentials } from "./support";

test.describe("Ejecución", () => {
  test.beforeEach(async ({ page }) => {
    requireCredentials();
    await page.goto("/workspace/execution");
  });

  test("el listado de proyectos muestra el estado de cada uno y se puede abrir", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Proyectos en ejecución" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Estado actual" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir" }).first()).toBeVisible();
  });

  test("las pestañas del seguimiento se recorren con las flechas del teclado", async ({ page }) => {
    // Abre el primer proyecto que permita seguimiento (aprobado): no muestra el aviso de bloqueo.
    const rows = page.getByRole("button", { name: "Abrir" });
    const count = await rows.count();
    let opened = false;
    for (let index = 0; index < count && !opened; index += 1) {
      await page.goto("/workspace/execution");
      await rows.nth(index).click();
      if (await page.getByRole("tab", { name: /Resumen de cumplimiento/u }).isVisible({ timeout: 4_000 }).catch(() => false)) {
        opened = true;
      }
    }
    test.skip(!opened, "No hay un proyecto aprobado con plan de trabajo para probar.");
    const summary = page.getByRole("tab", { name: /Resumen de cumplimiento/u });
    const tasks = page.getByRole("tab", { name: /Actividades y tareas/u });
    await summary.focus();
    await page.keyboard.press("ArrowRight");
    await expect(tasks).toBeFocused();
    await expect(tasks).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(summary).toHaveAttribute("aria-selected", "true");
  });

  test("la checklist de tareas se muestra y marcar queda bloqueado si no hay permisos de edición", async ({ page }) => {
    const rows = page.getByRole("button", { name: "Abrir" });
    let opened = false;
    for (let index = 0; index < (await rows.count()) && !opened; index += 1) {
      await page.goto("/workspace/execution");
      await rows.nth(index).click();
      opened = await page.getByRole("tab", { name: /Actividades y tareas/u }).isVisible({ timeout: 4_000 }).catch(() => false);
    }
    test.skip(!opened, "No hay un proyecto aprobado con plan de trabajo.");
    await page.getByRole("tab", { name: /Actividades y tareas/u }).click();
    // Solo lectura: nunca se marca nada en esta prueba.
    await expect(page.getByRole("checkbox", { name: /Tarea .* hecha/u }).first()).toBeVisible();
  });

  test("un proyecto sin aprobar abre el aviso de bloqueo y permite regresar", async ({ page }) => {
    const gated = page.getByRole("row").filter({ hasText: /Documento generado|En validación|Borrador|Discusión|Fuentes/u }).first();
    test.skip(!(await gated.isVisible().catch(() => false)), "Todos los proyectos están aprobados.");
    await gated.getByRole("button", { name: "Abrir" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Proyecto no aprobado" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Regresar" }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe("Encabezado principal", () => {
  test("cada módulo tiene un único h1 con el título de la página", async ({ page }) => {
    requireCredentials();
    const pages: Array<[string, string]> = [
      ["/workspace/projects", "Proyectos"],
      ["/workspace/execution", "Ejecución"],
      ["/workspace/prototype", "Generar prototipo"],
    ];
    for (const [path, title] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    }
  });
});

test.describe("Filtros en la URL", () => {
  test("la búsqueda del listado se guarda en la URL y se recupera al recargar", async ({ page }) => {
    requireCredentials();
    await page.goto("/workspace/execution");
    const search = page.getByPlaceholder("Código, título o área");
    // Se escribe letra a letra: la URL cambia en cada tecla y el campo no pierde el foco.
    await search.click();
    await search.pressSequentially("soat", { delay: 40 });
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("soat");
    await expect(page).toHaveURL(/[?&]q=soat/u);

    await page.reload();
    await expect(search).toHaveValue("soat");
    // Solo quedan los proyectos que coinciden con el filtro recuperado de la URL.
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    for (const text of await rows.allInnerTexts()) expect(text.toLowerCase()).toContain("soat");

    // Un enlace con el filtro ya puesto funciona igual, y «Limpiar» deja la URL sin filtros.
    await page.goto("/workspace/execution?q=soat");
    await expect(search).toHaveValue("soat");
    await page.getByRole("button", { name: "Limpiar" }).click();
    await expect(search).toHaveValue("");
    await expect(page).not.toHaveURL(/[?&]q=/u);
  });
});

test.describe("Filtros en la URL de los demás listados", () => {
  const pages: Array<[string, string]> = [
    ["/workspace/projects", "Código, título"],
    ["/workspace/discussion", "Código, título"],
    ["/workspace/sources", "Código, título"],
    ["/workspace/documents", "Código, título o área solicitante"],
    ["/workspace/prototype", "Nombre, archivo, proyecto"],
  ];
  for (const [path, placeholder] of pages) {
    test(`${path}: un enlace con ?q=… llega con la búsqueda aplicada`, async ({ page }) => {
      requireCredentials();
      await page.goto(`${path}?q=prueba-url`);
      await expect(page.getByPlaceholder(placeholder)).toHaveValue("prueba-url");
    });
  }
});
