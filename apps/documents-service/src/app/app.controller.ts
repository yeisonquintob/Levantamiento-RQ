import { Controller, Get } from "@nestjs/common";

import { AppService, type HealthResponse } from "./app.service";

@Controller("health")
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHealth(): HealthResponse {
    return this.appService.getHealth();
  }
}
