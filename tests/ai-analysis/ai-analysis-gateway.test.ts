import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Gateway configura URL y timeout de AI Analysis", async () => {
  const config = await readFile(
    "apps/gateway/src/config/gateway-config.ts",
    "utf8",
  );
  const environment = await readFile(
    "apps/gateway/.env.example",
    "utf8",
  );

  assert.match(config, /aiAnalysisServiceUrl: string/);
  assert.match(config, /aiAnalysisTimeoutMs: number/);
  assert.match(config, /AI_ANALYSIS_SERVICE_URL/);
  assert.match(config, /http:\/\/127\.0\.0\.1:3005/);
  assert.match(config, /AI_ANALYSIS_TIMEOUT_MS/);
  assert.match(environment, /AI_ANALYSIS_SERVICE_URL=/);
  assert.match(environment, /AI_ANALYSIS_TIMEOUT_MS=/);
});

test("Gateway registra cliente y controlador de análisis", async () => {
  const moduleFile = await readFile(
    "apps/gateway/src/app/app.module.ts",
    "utf8",
  );

  assert.match(moduleFile, /AiAnalysisGatewayController/);
  assert.match(moduleFile, /AiAnalysisClientService/);
});

test("controlador acepta cookie, Bearer y propaga correlación", async () => {
  const controller = await readFile(
    "apps/gateway/src/analysis/ai-analysis-gateway.controller.ts",
    "utf8",
  );

  assert.match(controller, /ACCESS_COOKIE/);
  assert.match(controller, /authorization/);
  assert.match(controller, /x-correlation-id/);
  assert.match(controller, /randomUUID/);

  for (const fragment of [
    '@Controller("projects/:projectId/analysis-requests")',
    "@Post()",
    "@Get()",
    '@Get(":analysisRequestId")',
    '@Post(":analysisRequestId/cancel")',
  ]) {
    assert.ok(
      controller.includes(fragment),
      `Falta la operación Gateway: ${fragment}`,
    );
  }
});

test("cliente reenvía token, correlación, query y errores HTTP", async () => {
  const client = await readFile(
    "apps/gateway/src/analysis/ai-analysis-client.service.ts",
    "utf8",
  );

  assert.match(client, /authorization: `Bearer \$\{accessToken\}`/);
  assert.match(client, /"x-correlation-id": correlationId/);
  assert.match(client, /URLSearchParams/);
  assert.match(client, /AiAnalysisRequestListResponse/);
  assert.match(client, /AiAnalysisRequestDetail/);
  assert.match(client, /HttpException/);
  assert.match(client, /ServiceUnavailableException/);
});

test("servicios locales incorporan el puerto 3005", async () => {
  const [up, down, status] = await Promise.all([
    readFile("scripts/local-auth-up.sh", "utf8"),
    readFile("scripts/local-auth-down.sh", "utf8"),
    readFile("scripts/local-auth-status.sh", "utf8"),
  ]);

  assert.match(up, /ai-analysis-service/);
  assert.match(up, /3005/);
  assert.match(down, /ai-analysis-service/);
  assert.match(down, /3005/);
  assert.match(status, /AI Analysis Service/);
  assert.match(status, /3005/);
});

test("Gateway no ejecuta ni conecta un proveedor de IA", async () => {
  const [client, controller] = await Promise.all([
    readFile(
      "apps/gateway/src/analysis/ai-analysis-client.service.ts",
      "utf8",
    ),
    readFile(
      "apps/gateway/src/analysis/ai-analysis-gateway.controller.ts",
      "utf8",
    ),
  ]);

  assert.doesNotMatch(
    `${client}\n${controller}`,
    /OpenAI|AzureOpenAI|ChatCompletion|Responses API/,
  );
});
