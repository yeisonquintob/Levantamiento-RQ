import { defineConfig, devices } from "@playwright/test";

/**
 * Pruebas de extremo a extremo de la web. Se ejecutan contra el proyecto ya levantado
 * (`ejecutar_y_status_levantamiento_rq.sh`) con un usuario de prueba que se entrega por
 * variables de entorno: E2E_EMAIL y E2E_PASSWORD. Nunca se guardan credenciales en el código.
 */
const port = process.env.E2E_PORT ?? "4200";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "tmp/playwright-report" }],
  ],
  outputDir: "tmp/playwright-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`,
    locale: "es-CO",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // En CI se levanta la web compilada (sin backend: el smoke simula el gateway). En local se reutiliza
  // el servidor ya levantado por el script de arranque.
  webServer:
    process.env.CI && !process.env.E2E_BASE_URL
      ? {
          command: `pnpm exec nx start web --port=${port}`,
          url: `http://127.0.0.1:${port}/sign-in`,
          reuseExistingServer: false,
          timeout: 180_000,
        }
      : undefined,
  globalTeardown: "./e2e/global-teardown.ts",
  projects: [
    // Smoke determinista (sin backend ni credenciales): es el que se ejecuta de forma obligatoria en CI.
    {
      name: "smoke",
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // El acceso se prueba sin sesión previa; el resto reutiliza la sesión de «setup».
    {
      name: "login",
      testMatch: /login\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: [/login\.spec\.ts/, /smoke\.spec\.ts/, /auth\.setup\.ts/],
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tmp/playwright-auth/state.json",
      },
    },
  ],
});
