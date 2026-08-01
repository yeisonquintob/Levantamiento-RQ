import { Inject, Injectable } from "@nestjs/common";

import {
  asUtcIsoDateString,
  type ServiceHealth,
} from "@levantamiento-rq/shared-contracts";

import { GATEWAY_CONFIG, type GatewayConfig } from "../config/gateway-config";

@Injectable()
export class AppService {
  constructor(
    @Inject(GATEWAY_CONFIG)
    private readonly config: GatewayConfig,
  ) {}

  getHealth(): ServiceHealth {
    return {
      service: this.config.serviceName,
      status: "ok",
      timestampUtc: asUtcIsoDateString(new Date().toISOString()),
      version: this.config.version,
    };
  }
}
