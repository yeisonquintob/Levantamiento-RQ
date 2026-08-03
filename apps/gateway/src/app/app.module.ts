import { Module } from "@nestjs/common";

import { AuthGatewayController } from "../auth/auth-gateway.controller";
import { IdentityClientService } from "../auth/identity-client.service";
import { GATEWAY_CONFIG, loadGatewayConfig } from "../config/gateway-config";
import { ProjectsClientService } from "../projects/projects-client.service";
import { ProjectsGatewayController } from "../projects/projects-gateway.controller";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

@Module({
  controllers: [
    AppController,
    AuthGatewayController,
    ProjectsGatewayController,
  ],
  providers: [
    {
      provide: GATEWAY_CONFIG,
      useFactory: loadGatewayConfig,
    },
    AppService,
    IdentityClientService,
    ProjectsClientService,
  ],
})
export class AppModule {}
