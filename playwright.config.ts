import { defineConfig, devices } from "@playwright/test";

/**
 * Pruebas de extremo a extremo de la web. Se ejecutan contra el proyecto ya levantado
 * (`ejecutar_y_status_levantamiento_rq.sh`) con un usuario de prueba que se entrega por
 * variables de entorno: E2E_EMAIL y E2E_PASSWORD. Nunca se guardan credenciales en el código.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "tmp/playwright-report" }]],
  outputDir: "tmp/playwright-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4200",
    locale: "es-CO",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  globalTeardown: "./e2e/global-teardown.ts",
  projects: [
    // El acceso se prueba sin sesión previa; el resto reutiliza la sesión de «setup».
    { name: "login", testMatch: /login\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "chromium",
      testIgnore: [/login\.spec\.ts/, /auth\.setup\.ts/],
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "tmp/playwright-auth/state.json" },
    },
  ],
});
