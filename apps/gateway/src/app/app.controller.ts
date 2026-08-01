import { Controller, Get } from "@nestjs/common";

import type { ServiceHealth } from "@levantamiento-rq/shared-contracts";

import { AppService } from "./app.service";

@Controller("health")
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHealth(): ServiceHealth {
    return this.appService.getHealth();
  }
}
