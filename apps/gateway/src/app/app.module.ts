import { Module } from "@nestjs/common";

import { GATEWAY_CONFIG, loadGatewayConfig } from "../config/gateway-config";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

@Module({
  controllers: [AppController],
  providers: [
    {
      provide: GATEWAY_CONFIG,
      useFactory: loadGatewayConfig,
    },
    AppService,
  ],
})
export class AppModule {}
