import { Module } from "@nestjs/common";

import { PersistenceModule } from "@levantamiento-rq/shared-persistence";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";

@Module({
  imports: [
    PersistenceModule.register({
      serviceName: "operations-service",
      defaultDatabaseName: "RqOperationsDb",
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
