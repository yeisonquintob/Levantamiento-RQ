import { randomUUID } from "node:crypto";

import { Logger, type OnModuleDestroy } from "@nestjs/common";
import amqp, { type ChannelModel, type ConfirmChannel } from "amqplib";

import {
  asCorrelationId,
  asUtcIsoDateString,
  type IntegrationEventEnvelope,
  type IntegrationEventName,
} from "@levantamiento-rq/shared-contracts";

import type { IntegrationEventsConfig } from "./integration-events.config.js";

export interface PublishIntegrationEventInput<
  TData extends Record<string, unknown>,
> {
  eventName: IntegrationEventName;
  eventVersion?: number;
  correlationId: string;
  causationId?: string;
  organizationId?: string;
  data: TData;
}

export class IntegrationEventsPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(IntegrationEventsPublisher.name);
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private connecting: Promise<ConfirmChannel> | null = null;

  constructor(private readonly config: IntegrationEventsConfig) {}

  async publish<TData extends Record<string, unknown>>(
    input: PublishIntegrationEventInput<TData>,
  ): Promise<boolean> {
    if (!this.config.enabled) return false;
    const eventId = randomUUID();
    const envelope: IntegrationEventEnvelope<TData> = {
      eventId,
      eventName: input.eventName,
      eventVersion: input.eventVersion ?? 1,
      occurredAtUtc: asUtcIsoDateString(new Date().toISOString()),
      producer: this.config.serviceName,
      correlationId: asCorrelationId(input.correlationId),
      ...(input.causationId ? { causationId: input.causationId } : {}),
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      data: input.data,
    };
    try {
      const channel = await this.withTimeout(this.requireChannel());
      channel.publish(
        this.config.exchange,
        input.eventName,
        Buffer.from(JSON.stringify(envelope), "utf8"),
        {
          persistent: true,
          contentType: "application/json",
          contentEncoding: "utf-8",
          type: input.eventName,
          appId: this.config.serviceName,
          messageId: eventId,
          correlationId: input.correlationId,
          timestamp: Date.now(),
        },
      );
      await this.withTimeout(channel.waitForConfirms());
      return true;
    } catch (error) {
      await this.close();
      this.logger.error(
        `No se publicó ${input.eventName}: ${error instanceof Error ? error.message : "error no identificado"}`,
      );
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  private async requireChannel(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;
    if (this.connecting) return this.connecting;
    this.connecting = this.connect();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connect(): Promise<ConfirmChannel> {
    const connection = await amqp.connect(this.config.url as string);
    connection.on("error", (error) => {
      this.logger.error(`Conexión RabbitMQ interrumpida: ${error.message}`);
    });
    connection.on("close", () => {
      this.connection = null;
      this.channel = null;
    });
    const channel = await connection.createConfirmChannel();
    await channel.assertExchange(this.config.exchange, "topic", {
      durable: true,
      autoDelete: false,
    });
    this.connection = connection;
    this.channel = channel;
    return channel;
  }

  private async close(): Promise<void> {
    const channel = this.channel;
    const connection = this.connection;
    this.channel = null;
    this.connection = null;
    if (channel) await channel.close().catch(() => undefined);
    if (connection) await connection.close().catch(() => undefined);
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Tiempo de espera RabbitMQ agotado.")),
            this.config.publishTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
