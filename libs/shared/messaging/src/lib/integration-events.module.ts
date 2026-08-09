import { DynamicModule, Module } from "@nestjs/common";

import {
  loadIntegrationEventsConfig,
  type IntegrationEventsConfig,
} from "./integration-events.config.js";
import { IntegrationEventsPublisher } from "./integration-events.publisher.js";

export const INTEGRATION_EVENTS_CONFIG = Symbol("INTEGRATION_EVENTS_CONFIG");

@Module({})
export class IntegrationEventsModule {
  static register(input: { serviceName: string }): DynamicModule {
    const config: IntegrationEventsConfig = loadIntegrationEventsConfig(
      input.serviceName,
    );
    return {
      module: IntegrationEventsModule,
      providers: [
        { provide: INTEGRATION_EVENTS_CONFIG, useValue: config },
        {
          provide: IntegrationEventsPublisher,
          inject: [INTEGRATION_EVENTS_CONFIG],
          useFactory: (value: IntegrationEventsConfig) =>
            new IntegrationEventsPublisher(value),
        },
      ],
      exports: [IntegrationEventsPublisher, INTEGRATION_EVENTS_CONFIG],
    };
  }
}
