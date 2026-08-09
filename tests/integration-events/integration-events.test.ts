import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  INTEGRATION_EVENT_NAMES,
  type IntegrationEventName,
} from "../../libs/shared/contracts/src/index.js";
import { loadIntegrationEventsConfig } from "../../libs/shared/messaging/src/index.js";
import { IntegrationEventsPublisher } from "../../libs/shared/messaging/src/lib/integration-events.publisher.js";

test("el catálogo de eventos V1 es cerrado y versionable", () => {
  const names = new Set<IntegrationEventName>(INTEGRATION_EVENT_NAMES);
  assert.equal(names.size, INTEGRATION_EVENT_NAMES.length);
  for (const expected of [
    "source.ready",
    "analysis.requested",
    "analysis.completed",
    "review.requested",
    "document.approved",
    "export.completed",
  ] as const) {
    assert.ok(names.has(expected));
  }
});

test("RabbitMQ es opcional, seguro por protocolo y no bloquea deshabilitado", async () => {
  const disabled = loadIntegrationEventsConfig("test-service", {});
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.url, null);
  assert.equal(
    await new IntegrationEventsPublisher(disabled).publish({
      eventName: "analysis.requested",
      correlationId: "11111111-1111-4111-8111-111111111111",
      data: { analysisRequestId: "request" },
    }),
    false,
  );
  assert.throws(
    () =>
      loadIntegrationEventsConfig("test-service", {
        RABBITMQ_ENABLED: "true",
        RABBITMQ_URL: "http://127.0.0.1:5672",
      }),
    /amqp/i,
  );
  assert.throws(
    () =>
      loadIntegrationEventsConfig("test-service", {
        RABBITMQ_ENABLED: "true",
      }),
    /RABBITMQ_URL/,
  );
});

test("los productores publican eventos de dominio sin mover reglas al broker", async () => {
  const [publisher, sources, analysis, workflow] = await Promise.all([
    readFile(
      "libs/shared/messaging/src/lib/integration-events.publisher.ts",
      "utf8",
    ),
    readFile(
      "apps/sources-service/src/sources/source-processing.service.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
      "utf8",
    ),
    readFile(
      "apps/workflow-service/src/reviews/workflow-reviews.service.ts",
      "utf8",
    ),
  ]);

  assert.match(publisher, /assertExchange\([^]*"topic"/);
  assert.match(publisher, /persistent: true/);
  assert.match(publisher, /waitForConfirms/);
  assert.match(sources, /eventName: "source\.ready"/);
  assert.match(analysis, /eventName: "analysis\.started"/);
  assert.match(analysis, /eventName: "analysis\.completed"/);
  assert.match(analysis, /eventName: "analysis\.failed"/);
  assert.match(workflow, /eventName: "review\.requested"/);
  assert.match(workflow, /"document\.approved"/);
  assert.match(workflow, /"document\.rejected"/);
});
