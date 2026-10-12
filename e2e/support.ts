import { expect, test, type Page } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

/** Sesión del usuario de prueba, reutilizada entre pruebas (se borra al terminar). */
export const AUTH_FILE = "tmp/playwright-auth/state.json";

export function hasCredentials(): boolean {
  return Boolean(email && password);
}

/** Sin usuario de prueba las pruebas se omiten en lugar de fallar. */
export function requireCredentials(): void {
  test.skip(!email || !password, "Define E2E_EMAIL y E2E_PASSWORD para ejecutar las pruebas.");
}

/**
 * Inicia sesión. Si el acceso no se completa a la primera (por ejemplo por un límite de intentos
 * seguidos) espera un momento y lo reintenta una vez antes de fallar.
 */
export async function signIn(page: Page): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.goto("/sign-in");
    await page.getByLabel("Correo electrónico").first().fill(email ?? "");
    await page.locator('input[name="password"]').first().fill(password ?? "");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    try {
      await expect(page).toHaveURL(/\/workspace/u, { timeout: 10_000 });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(4_000);
    }
  }
}

/** Estados con los que Ejecución bloquea el seguimiento: el proyecto aún no está aprobado. */
export const BLOCKED_PROJECT_STATUS =
  /Documento generado|En validación|Borrador|Discusión|Fuentes/u;

/**
 * Filas del listado de Ejecución cuyos proyectos permiten seguimiento. Se distinguen por el estado
 * que muestra la tabla: al abrir un proyecto sin aprobar el aviso de bloqueo aparece después de
 * cargar, y las pestañas ya se ven detrás de él, así que no sirven para saber si está aprobado.
 */
export function trackableProjectRows(page: Page) {
  return page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: "Abrir" }) })
    .filter({ hasNotText: BLOCKED_PROJECT_STATUS });
}
