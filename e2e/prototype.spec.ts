import { expect, test } from "./diagnostics";

import { MARKDOWN, PNG_BYTES, mockPrototypeApi } from "./prototype-mocks";
import { requireCredentials } from "./support";

test.describe("Generar prototipo (servicios de IA simulados)", () => {
  test.beforeEach(() => requireCredentials());

  async function processMarkdown(page: import("@playwright/test").Page) {
    await page.goto("/workspace/prototype");
    await page.getByRole("button", { name: "+ Nuevo" }).click();
    await expect(page).toHaveURL(/view=source/u);
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "requerimiento.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(MARKDOWN),
    });
    await page.getByRole("button", { name: /Procesar Markdown/u }).click();
    await expect(page.getByRole("button", { name: /Generar 2 pantallas seleccionadas/u })).toBeVisible();
  }

  test("procesar el Markdown detalla cada pantalla y ofrece generar o exportar", async ({ page }) => {
    const calls = await mockPrototypeApi(page);
    await processMarkdown(page);
    expect(calls.create).toBe(1);
    expect(calls.plan).toBe(1);
    // La IA vuelve a leer el documento una vez por pantalla.
    await expect.poll(() => calls.detail).toBe(2);
    await expect(page.getByRole("button", { name: "Exportar prompts (TXT)" })).toBeVisible();
    await expect(page.getByText("Respuesta procesada lista")).toBeVisible();
  });

  test("el detalle por pantalla se puede detener y deja el resto con su detalle básico", async ({ page }) => {
    const calls = await mockPrototypeApi(page, { detailDelayMs: 3_000 });
    await page.goto("/workspace/prototype");
    await page.getByRole("button", { name: "+ Nuevo" }).click();
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "requerimiento.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(MARKDOWN),
    });
    await page.getByRole("button", { name: /Procesar Markdown/u }).click();
    const stop = page.getByRole("button", { name: "Detener detalle" });
    await expect(stop).toBeVisible();
    await expect(page.getByText(/Detallando 0\/2/u).first()).toBeVisible();
    await stop.click();
    await expect(page.getByText(/Detalle detenido: 0 de 2 pantallas detalladas/u)).toBeVisible();
    await expect(stop).toBeHidden();
    // Tras detener, las acciones vuelven a estar disponibles y no se pidió detalle de más.
    await expect(page.getByRole("button", { name: /Generar 2 pantallas seleccionadas/u })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Detallar de nuevo con la IA" })).toBeEnabled();
    expect(calls.detail).toBe(1);
  });

  test("exportar descarga un TXT autosuficiente con nombres de archivo y guía de apariencia", async ({ page }) => {
    const calls = await mockPrototypeApi(page);
    await processMarkdown(page);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar prompts (TXT)" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("prompts-portal-de-cartera.txt");
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toContain("PROMPTS PARA GENERAR LAS IMÁGENES DEL PROTOTIPO · Portal de cartera");
    expect(text).toContain("GUÍA DE APARIENCIA (igual para TODAS las imágenes)");
    expect(text).toContain("Archivo: 01-login-web.png");
    expect(text).toContain("Archivo: 02-clientes-web.png");
    expect(calls.visualSpecifications).toBe(1);
    expect(calls.promptExport).toBe(1);
  });

  test("después de exportar se puede procesar el texto de nuevo, con confirmación propia", async ({ page }) => {
    const calls = await mockPrototypeApi(page);
    await processMarkdown(page);
    await page.getByRole("button", { name: "Exportar prompts (TXT)" }).click();
    const again = page.getByRole("button", { name: /Procesar texto de nuevo/u });
    await expect(again).toBeEnabled();
    await again.click();
    const dialog = page.getByRole("alertdialog", { name: "Procesar el texto de nuevo" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Procesar de nuevo" }).click();
    await expect.poll(() => calls.plan).toBe(2);
  });

  test("las imágenes generadas fuera se importan por el nombre del archivo", async ({ page }) => {
    const calls = await mockPrototypeApi(page);
    await processMarkdown(page);
    await page.getByRole("button", { name: "Exportar prompts (TXT)" }).click();
    await expect.poll(() => calls.promptExport).toBe(1);
    await page.getByRole("tab", { name: /Imágenes/u }).click();
    await page.locator('input[type="file"][accept="image/png"]').setInputFiles({
      name: "01-login-web.png",
      mimeType: "image/png",
      buffer: PNG_BYTES,
    });
    await expect(page.getByText("1 imagen importada de 1.")).toBeVisible();
    expect(calls.imports).toEqual(["01-login-web.png"]);
  });

  test("la flecha lateral de «Volver» regresa al listado desde el prototipo", async ({ page }) => {
    await mockPrototypeApi(page);
    await page.goto("/workspace/prototype");
    await page.getByRole("button", { name: "+ Nuevo" }).click();
    await expect(page).toHaveURL(/view=source/u);
    await page.getByRole("link", { name: "Volver" }).click();
    await expect(page).not.toHaveURL(/view=source/u);
    await expect(page.getByRole("button", { name: "+ Nuevo" })).toBeVisible();
  });
});
