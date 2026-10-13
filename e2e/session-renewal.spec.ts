import { expect, test } from "./diagnostics";
import { requireCredentials } from "./support";

const GATEWAY = process.env.E2E_GATEWAY_URL ?? "http://127.0.0.1:3000";

/**
 * Cuando el token de acceso caduca, el navegador borra su cookie y la web depende de recibir un 401 legible
 * para renovar la sesión con la cookie de renovación. El Gateway rechaza esa petición antes de leer el
 * cuerpo: si esa respuesta no llevara las cabeceras CORS, el navegador solo vería «Failed to fetch» y la
 * sesión no se renovaría.
 */
test.describe("Sesión caducada", () => {
  test.beforeEach(() => requireCredentials());

  test("sin la cookie de acceso la API responde un 401 que el navegador puede leer, también en una carga", async ({
    page,
    context,
  }) => {
    // Página neutra (sin la aplicación): la web redirige sola al detectar la falta de la cookie.
    await page.goto("/robots.txt");
    await context.clearCookies({ name: "rq_access" });

    const results = await page.evaluate(async (gateway) => {
      const read = async (path: string, init: RequestInit) => {
        try {
          const response = await fetch(`${gateway}${path}`, {
            ...init,
            credentials: "include",
          });
          return response.status;
        } catch (error) {
          return `error de red: ${(error as Error).message}`;
        }
      };
      const form = new FormData();
      form.append(
        "files",
        new Blob([new Uint8Array(2 * 1024 * 1024)]),
        "a.txt",
      );
      form.append("metadata", "{}");
      return {
        consulta: await read("/api/v1/projects", {}),
        carga: await read(
          "/api/v1/projects/00000000-0000-4000-8000-000000000001/sources/files",
          { method: "POST", body: form },
        ),
      };
    }, GATEWAY);

    expect(results).toEqual({ consulta: 401, carga: 401 });
  });
});
