import { crc32 } from "node:zlib";
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import {
  COMFY_ID,
  PNG,
  baseGeneration,
  completedImages,
  mockPrototypeUi,
  progressFor,
} from "./prototype-ui-mocks";

/**
 * Generar prototipo en el navegador, con la API simulada y sin sesión real: no necesita backend,
 * base de datos ni credenciales. Se omiten cuando hay un usuario de prueba real (E2E_EMAIL), porque
 * esa sesión validaría contra el gateway verdadero y no contra la pasarela falsa.
 */
test.describe("Generar prototipo (navegador, API simulada)", () => {
  test.skip(
    Boolean(process.env.E2E_EMAIL),
    "Estas pruebas usan la pasarela falsa, no una sesión real.",
  );
  test.use({ viewport: { width: 1440, height: 800 } });

  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([
      {
        name: "rq_access",
        value: "e2e",
        url: baseURL ?? "http://127.0.0.1:4200",
      },
    ]);
  });

  async function openGeneration(page: Page) {
    await page.goto("/workspace/prototype");
    await page.getByRole("button", { name: "Abrir", exact: true }).click();
    await expect(page.getByText("Documento Markdown")).toBeVisible();
  }

  test("una generación fallida tras planificar se restaura con su plan y no vuelve a usar la IA del Markdown", async ({
    page,
  }) => {
    const { calls } = await mockPrototypeUi(page, {
      generation: {
        totalImages: 0,
        failedImages: 0,
        totalVisualSpecifications: 0,
        errorCode: "PROTOTYPE_VISUAL_SPEC_FAILED",
        errorMessage: "No fue posible preparar las especificaciones visuales.",
      },
    });
    await openGeneration(page);
    await expect(page.getByText("5 pantallas", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Pantalla login", { exact: false }).first(),
    ).toBeVisible();
    // Reinterpretar el Markdown consume la IA: no debe pedirse el plan de nuevo.
    await page.waitForTimeout(1_500);
    expect(calls.filter((call) => call.path.endsWith("/plan"))).toEqual([]);
  });

  test("cambiar la IA de imágenes y reintentar aplica la nueva IA antes del reintento", async ({
    page,
  }) => {
    const { calls } = await mockPrototypeUi(page);
    await openGeneration(page);
    const imageSelect = page.locator(".rq-prototype-config select").nth(1);
    await expect(imageSelect).toBeEnabled();
    await imageSelect.selectOption(COMFY_ID);
    await page.getByRole("button", { name: /Reintentar fallidas/u }).click();
    await expect.poll(() => calls.length).toBe(2);
    const sequence = calls.map((call) =>
      call.path.replace(/^generations\/[^/]+\//u, ""),
    );
    expect(sequence).toEqual(["image-provider", "images/retry-failed"]);
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      imageConfigurationId: COMFY_ID,
    });
  });

  test("con imágenes fallidas se pueden exportar los prompts e importar PNG", async ({
    page,
  }) => {
    await mockPrototypeUi(page);
    await openGeneration(page);
    await expect(page.getByText("Algunas imágenes fallaron")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Exportar prompts (TXT)" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Importar imágenes" }),
    ).toBeEnabled();
  });

  test("descargar todas las imágenes entrega un ZIP válido con las carpetas web y movil", async ({
    page,
  }) => {
    const done = baseGeneration({
      status: "COMPLETED",
      totalImages: 6,
      completedImages: 6,
      failedImages: 0,
    });
    await mockPrototypeUi(page, {
      generation: done,
      images: completedImages(3),
      progress: progressFor(done),
    });
    await openGeneration(page);
    await page.getByRole("tab", { name: /Imágenes/u }).click();
    const button = page.getByRole("button", { name: "Descargar todas (6)" });
    await expect(button).toBeEnabled();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      button.click(),
    ]);
    expect(download.suggestedFilename()).toBe("imagenes-portal-de-cartera.zip");
    const path = await download.path();
    const zip = readFileSync(path);

    // Registro final, directorio central y cada entrada con su CRC y contenido.
    const eocd = zip.length - 22;
    expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(zip.readUInt16LE(eocd + 10)).toBe(6);
    let cursor = zip.readUInt32LE(eocd + 16);
    const names: string[] = [];
    for (let entry = 0; entry < 6; entry += 1) {
      expect(zip.readUInt32LE(cursor)).toBe(0x02014b50);
      const nameLength = zip.readUInt16LE(cursor + 28);
      const size = zip.readUInt32LE(cursor + 24);
      const local = zip.readUInt32LE(cursor + 42);
      names.push(
        zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"),
      );
      expect(size).toBe(PNG.length);
      expect(zip.readUInt32LE(cursor + 16)).toBe(crc32(PNG));
      const dataStart = local + 30 + zip.readUInt16LE(local + 26);
      expect(zip.subarray(dataStart, dataStart + size).equals(PNG)).toBe(true);
      cursor += 46 + nameLength;
    }
    expect(names.sort()).toEqual([
      "movil/01-login-mobile.png",
      "movil/02-dashboard-mobile.png",
      "movil/03-clientes-mobile.png",
      "web/01-login-web.png",
      "web/02-dashboard-web.png",
      "web/03-clientes-web.png",
    ]);
  });

  test("la importación rechaza un PNG por encima del límite sin enviarlo y acepta uno cercano al límite", async ({
    page,
  }) => {
    const { calls } = await mockPrototypeUi(page);
    await openGeneration(page);
    const input = page.locator('input[type="file"][accept="image/png"]');
    const mb = 1024 * 1024;

    // 21 MB: se rechaza en el navegador, antes de convertir a base64.
    await input.setInputFiles({
      name: "01-login-web.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(21 * mb, 1),
    });
    await expect(
      page.getByText(/«01-login-web\.png» pesa 21\.0 MB y el máximo es 20 MB/u),
    ).toBeVisible();
    expect(
      calls.filter((call) => call.path.endsWith("/images/import")),
    ).toEqual([]);

    // 19 MB: pasa la validación y viaja en base64 (≈ 25,3 MB), dentro del límite HTTP del servidor.
    await input.setInputFiles({
      name: "01-login-web.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(19 * mb, 1),
    });
    await expect(page.getByText(/1 imagen importada de 1/u)).toBeVisible({
      timeout: 30_000,
    });
    const sent = calls.filter((call) => call.path.endsWith("/images/import"));
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0]?.body ?? "{}") as {
      fileName: string;
      imageBase64: string;
    };
    expect(body.fileName).toBe("01-login-web.png");
    expect(body.imageBase64.length).toBe(Math.ceil((19 * mb) / 3) * 4);
  });

  test("la importación usa el límite que publica el servidor, no un valor fijo", async ({
    page,
  }) => {
    const { calls } = await mockPrototypeUi(page, {
      importMaxBytes: 5 * 1024 * 1024,
    });
    await openGeneration(page);
    const input = page.locator('input[type="file"][accept="image/png"]');
    const mb = 1024 * 1024;

    // 6 MB entra en el máximo antiguo (20 MB) pero supera el configurado en el servidor (5 MB).
    await input.setInputFiles({
      name: "01-login-web.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(6 * mb, 1),
    });
    await expect(
      page.getByText(/«01-login-web\.png» pesa 6\.0 MB y el máximo es 5 MB/u),
    ).toBeVisible();
    expect(
      calls.filter((call) => call.path.endsWith("/images/import")),
    ).toEqual([]);

    await input.setInputFiles({
      name: "01-login-web.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(4 * mb, 1),
    });
    await expect(page.getByText(/1 imagen importada de 1/u)).toBeVisible({
      timeout: 30_000,
    });
  });
});
