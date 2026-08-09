import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import amqp, { type ConsumeMessage } from "amqplib";

import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";
import type { IntegrationEventEnvelope } from "../libs/shared/contracts/src/index.js";
import { IntegrationEventsPublisher } from "../libs/shared/messaging/src/index.js";

loadEnvironmentFiles({ paths: ["infrastructure/docker/.env"] });

function rabbitUrl(): string {
  const user = process.env.RABBITMQ_DEFAULT_USER?.trim();
  const password = process.env.RABBITMQ_DEFAULT_PASS?.trim();
  const port = process.env.RQ_RABBITMQ_AMQP_PORT?.trim() || "5673";
  if (!user || !password) {
    throw new Error("Faltan credenciales locales de RabbitMQ.");
  }
  return `amqp://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}`;
}

async function main(): Promise<void> {
  const url = rabbitUrl();
  const exchange = `rq.integration.smoke.${Date.now()}`;
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();
  const publisher = new IntegrationEventsPublisher({
    enabled: true,
    serviceName: "events-smoke",
    url,
    exchange,
    publishTimeoutMs: 5000,
  });
  let queueName: string | null = null;
  try {
    await channel.assertExchange(exchange, "topic", {
      durable: true,
      autoDelete: false,
    });
    const queue = await channel.assertQueue("", {
      exclusive: true,
      autoDelete: true,
    });
    queueName = queue.queue;
    await channel.bindQueue(queue.queue, exchange, "analysis.requested");
    const received = new Promise<ConsumeMessage>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("RabbitMQ no entregó el evento de prueba.")),
        5000,
      );
      void channel.consume(
        queue.queue,
        (message) => {
          if (!message) return;
          clearTimeout(timeout);
          resolve(message);
        },
        { noAck: true },
      );
    });
    const correlationId = randomUUID();
    assert.equal(
      await publisher.publish({
        eventName: "analysis.requested",
        correlationId,
        data: { analysisRequestId: randomUUID() },
      }),
      true,
    );
    const message = await received;
    const envelope = JSON.parse(
      message.content.toString("utf8"),
    ) as IntegrationEventEnvelope;
    assert.equal(envelope.eventName, "analysis.requested");
    assert.equal(envelope.eventVersion, 1);
    assert.equal(envelope.correlationId, correlationId);
    assert.equal(envelope.producer, "events-smoke");
    assert.equal(message.properties.deliveryMode, 2);
    console.log("✓ RabbitMQ entregó un evento persistente y versionado.");
    console.log("✓ CorrelationId, producer y routing key fueron preservados.");
  } finally {
    await publisher.onModuleDestroy();
    if (queueName) await channel.deleteQueue(queueName).catch(() => undefined);
    await channel.deleteExchange(exchange).catch(() => undefined);
    await channel.close().catch(() => undefined);
    await connection.close().catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(
    `No se pudo validar RabbitMQ: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
