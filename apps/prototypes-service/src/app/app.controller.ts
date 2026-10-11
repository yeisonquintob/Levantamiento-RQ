import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AppService } from "./app.service";
@ApiTags("health")
@Controller("health")
export class AppController {
  constructor(private readonly app: AppService) {}
  @Get() health() {
    return this.app.health();
  }
}
