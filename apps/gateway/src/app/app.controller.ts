import { Controller, Get } from "@nestjs/common";

import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import type { ServiceHealth } from "@levantamiento-rq/shared-contracts";

import { AppService } from "./app.service";

@ApiTags("health")
@Controller("health")
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: "Consultar disponibilidad del servicio" })
  @ApiOkResponse({
    description: "El servicio se encuentra disponible.",
    schema: {
      type: "object",
      properties: {
        service: { type: "string" },
        status: { type: "string", example: "ok" },
        timestampUtc: { type: "string", format: "date-time" },
        version: { type: "string", nullable: true },
      },
      required: ["service", "status", "timestampUtc"],
    },
  })
  @Get()
  getHealth(): ServiceHealth {
    return this.appService.getHealth();
  }
}
