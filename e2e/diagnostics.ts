import { expect, test as base } from "@playwright/test";

/**
 * `test` con diagnóstico automático: si una prueba falla, deja en una anotación de GitHub Actions lo
 * que el navegador tenía en ese momento (URL, texto visible, errores de consola y respuestas HTTP
 * fallidas). Los registros y el informe de Playwright exigen sesión de GitHub para verse; la
 * anotación se ve en el PR sin descargar nada.
 */
function oneLine(value: string, max: number): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, max);
}

export const test = base.extend<{ diagnostics: void }>({
  diagnostics: [
    async ({ page }, use, testInfo) => {
      const problems: string[] = [];
      page.on("pageerror", (error) =>
        problems.push(`pageerror: ${oneLine(error.message, 160)}`),
      );
      page.on("console", (message) => {
        if (message.type() === "error")
          problems.push(`console: ${oneLine(message.text(), 160)}`);
      });
      page.on("response", (response) => {
        if (response.status() >= 400)
          problems.push(
            `HTTP ${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`,
          );
      });
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame())
          problems.push(
            `navegó a ${new URL(frame.url()).pathname}${new URL(frame.url()).search}`,
          );
      });
      await use();
      if (
        !process.env.GITHUB_ACTIONS ||
        testInfo.status === testInfo.expectedStatus
      )
        return;
      let text = "";
      try {
        text = oneLine(
          await page.locator("body").innerText({ timeout: 2_000 }),
          350,
        );
      } catch {
        text = "(no se pudo leer la página)";
      }
      const detail = [
        `url=${page.url()}`,
        `texto=${text}`,
        `eventos=${problems.slice(-12).join(" | ") || "ninguno"}`,
      ].join(" ## ");
      // Las anotaciones de GitHub usan %0A para el salto de línea; aquí todo va en una sola línea.
      console.log(
        `::error title=Diagnóstico E2E: ${oneLine(testInfo.title, 70).replace(/[:,]/gu, " ")}::${detail.replace(/%/gu, "%25").slice(0, 1500)}`,
      );
    },
    { auto: true },
  ],
});

export { expect };
