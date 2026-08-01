import { Module } from "@nestjs/common";

import { PersistenceModule } from "@levantamiento-rq/shared-persistence";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";

@Module({
  imports: [
    PersistenceModule.register({
      serviceName: "documents-service",
      defaultDatabaseName: "RqDocumentsDb",
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
