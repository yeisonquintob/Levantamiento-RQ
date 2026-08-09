import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import amqp, {
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from "amqplib";

import {
  asCorrelationId,
  asUtcIsoDateString,
  INTEGRATION_EVENT_NAMES,
  type IntegrationEventEnvelope,
  type IntegrationEventName,
} from "@levantamiento-rq/shared-contracts";
import {
  INTEGRATION_EVENTS_CONFIG,
  type IntegrationEventsConfig,
} from "@levantamiento-rq/shared-messaging";

import {
  IntegrationEventInboxService,
  PermanentIntegrationEventError,
} from "./integration-event-inbox.service";
import {
  OPERATIONS_NOTIFICATIONS_CONFIG,
  type OperationsNotificationsConfig,
} from "./operations-notifications.config";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTING_KEYS = [
  "review.requested",
  "review.changes-requested",
  "document.approved",
  "document.rejected",
  "analysis.failed",
  "export.completed",
  "export.failed",
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseIntegrationEvent(
  value: unknown,
): IntegrationEventEnvelope {
  if (!record(value)) {
    throw new PermanentIntegrationEventError(
      "El sobre del evento no es válido.",
    );
  }
  if (typeof value.eventId !== "string" || !UUID.test(value.eventId)) {
    throw new PermanentIntegrationEventError("eventId no es válido.");
  }
  if (
    typeof value.eventName !== "string" ||
    !INTEGRATION_EVENT_NAMES.includes(value.eventName as IntegrationEventName)
  ) {
    throw new PermanentIntegrationEventError("eventName no es válido.");
  }
  if (value.eventVersion !== 1) {
    throw new PermanentIntegrationEventError(
      "La versión del evento no es compatible.",
    );
  }
  if (
    typeof value.occurredAtUtc !== "string" ||
    !Number.isFinite(Date.parse(value.occurredAtUtc))
  ) {
    throw new PermanentIntegrationEventError("occurredAtUtc no es válido.");
  }
  if (
    typeof value.producer !== "string" ||
    !value.producer.trim() ||
    value.producer.length > 120
  ) {
    throw new PermanentIntegrationEventError("producer no es válido.");
  }
  if (
    typeof value.correlationId !== "string" ||
    !UUID.test(value.correlationId)
  ) {
    throw new PermanentIntegrationEventError("correlationId no es válido.");
  }
  if (!record(value.data)) {
    throw new PermanentIntegrationEventError("data no es válido.");
  }
  return {
    eventId: value.eventId.toLowerCase(),
    eventName: value.eventName as IntegrationEventName,
    eventVersion: 1,
    occurredAtUtc: asUtcIsoDateString(
      new Date(value.occurredAtUtc).toISOString(),
    ),
    producer: value.producer.trim(),
    correlationId: asCorrelationId(value.correlationId.toLowerCase()),
    ...(typeof value.causationId === "string"
      ? { causationId: value.causationId.slice(0, 120) }
      : {}),
    ...(typeof value.organizationId === "string"
      ? { organizationId: value.organizationId.slice(0, 120) }
      : {}),
    data: value.data,
  };
}

@Injectable()
export class IntegrationEventsConsumer
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(IntegrationEventsConsumer.name);
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    @Inject(INTEGRATION_EVENTS_CONFIG)
    private readonly eventsConfig: IntegrationEventsConfig,
    @Inject(OPERATIONS_NOTIFICATIONS_CONFIG)
    private readonly config: OperationsNotificationsConfig,
    private readonly inbox: IntegrationEventInboxService,
  ) {}

  onModuleInit(): void {
    if (!this.eventsConfig.enabled) {
      this.logger.warn(
        "Consumo de notificaciones desactivado porque RABBITMQ_ENABLED=false.",
      );
      return;
    }
    void this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const channel = this.channel;
    const connection = this.connection;
    this.channel = null;
    this.connection = null;
    if (channel) await channel.close().catch(() => undefined);
    if (connection) await connection.close().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connection || !this.eventsConfig.url) return;
    try {
      const connection = await amqp.connect(this.eventsConfig.url);
      const channel = await connection.createConfirmChannel();
      await channel.assertExchange(this.eventsConfig.exchange, "topic", {
        durable: true,
        autoDelete: false,
      });
      await channel.assertQueue(this.config.queueName, {
        durable: true,
        autoDelete: false,
      });
      await channel.assertQueue(this.config.retryQueueName, {
        durable: true,
        autoDelete: false,
        messageTtl: this.config.retryDelayMs,
        deadLetterExchange: this.eventsConfig.exchange,
        deadLetterRoutingKey: this.config.retryRoutingKey,
      });
      for (const routingKey of ROUTING_KEYS) {
        await channel.bindQueue(
          this.config.queueName,
          this.eventsConfig.exchange,
          routingKey,
        );
      }
      await channel.bindQueue(
        this.config.queueName,
        this.eventsConfig.exchange,
        this.config.retryRoutingKey,
      );
      await channel.prefetch(5);
      connection.on("error", (error) => {
        this.logger.error(`Conexión RabbitMQ interrumpida: ${error.message}`);
      });
      connection.on("close", () => {
        this.connection = null;
        this.channel = null;
        this.scheduleReconnect();
      });
      this.connection = connection;
      this.channel = channel;
      await channel.consume(
        this.config.queueName,
        (message) => {
          if (message) void this.consume(channel, message);
        },
        { noAck: false },
      );
      this.logger.log(
        `Consumiendo eventos en ${this.config.queueName}; correo=${this.config.emailEnabled ? "habilitado" : "deshabilitado"}.`,
      );
    } catch (error) {
      this.logger.error(
        `No se inició el consumidor RabbitMQ: ${error instanceof Error ? error.message : "error no identificado"}`,
      );
      this.scheduleReconnect();
    }
  }

  private async consume(channel: ConfirmChannel, message: ConsumeMessage) {
    let event: IntegrationEventEnvelope;
    try {
      event = parseIntegrationEvent(
        JSON.parse(message.content.toString("utf8")) as unknown,
      );
    } catch (error) {
      this.logger.error(
        `Evento descartado: ${error instanceof Error ? error.message : "sobre inválido"}`,
      );
      channel.ack(message);
      return;
    }

    try {
      await this.inbox.process(event);
      channel.ack(message);
    } catch (error) {
      await this.inbox.markFailed(event, error).catch(() => undefined);
      const currentAttempt = this.attempt(message);
      const permanent = error instanceof PermanentIntegrationEventError;
      if (permanent || currentAttempt >= this.config.maxAttempts) {
        this.logger.error(
          `Evento ${event.eventName}/${event.eventId} agotó el procesamiento en intento ${currentAttempt}.`,
        );
        channel.ack(message);
        return;
      }
      channel.sendToQueue(this.config.retryQueueName, message.content, {
        persistent: true,
        contentType: "application/json",
        contentEncoding: "utf-8",
        messageId: event.eventId,
        correlationId: event.correlationId,
        headers: {
          ...message.properties.headers,
          "x-rq-attempt": currentAttempt + 1,
        },
      });
      try {
        await channel.waitForConfirms();
        channel.ack(message);
      } catch {
        channel.nack(message, false, true);
      }
    }
  }

  private attempt(message: ConsumeMessage): number {
    const value = message.properties.headers?.["x-rq-attempt"];
    return typeof value === "number" && Number.isInteger(value) && value > 0
      ? value
      : 1;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, 5_000);
  }
}
