// Pasarela mínima para las pruebas de navegador sin backend: solo responde a /auth/me, que el
// layout de /workspace consulta desde el servidor de Next.js. El resto de llamadas a la API las
// intercepta cada prueba con `page.route`.
import { createServer } from "node:http";

const port = Number(process.env.FAKE_GATEWAY_PORT ?? 3000);

createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  response.setHeader(
    "access-control-allow-origin",
    request.headers.origin ?? "*",
  );
  response.setHeader("access-control-allow-credentials", "true");
  response.setHeader(
    "access-control-allow-headers",
    "content-type,x-correlation-id,x-idempotency-key",
  );
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.url?.startsWith("/api/v1/auth/me")) {
    response.end(
      JSON.stringify({
        displayName: "Usuario E2E",
        email: "e2e@example.test",
        roles: ["ADMIN"],
        permissions: ["system.admin"],
        mustChangePassword: false,
      }),
    );
    return;
  }
  response.statusCode = 404;
  response.end(
    JSON.stringify({
      message: "Sin simulación: la prueba debe interceptar esta llamada.",
    }),
  );
}).listen(port, "127.0.0.1", () => console.log(`pasarela falsa en :${port}`));
