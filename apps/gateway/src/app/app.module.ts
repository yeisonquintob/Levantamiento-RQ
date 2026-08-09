import { Module } from "@nestjs/common";

import { AiAnalysisClientService } from "../analysis/ai-analysis-client.service";
import { AiAnalysisGatewayController } from "../analysis/ai-analysis-gateway.controller";
import { AiProviderConfigurationsGatewayController } from "../analysis/ai-provider-configurations-gateway.controller";
import { AuthGatewayController } from "../auth/auth-gateway.controller";
import { IdentityClientService } from "../auth/identity-client.service";
import { GATEWAY_CONFIG, loadGatewayConfig } from "../config/gateway-config";
import { DocumentTemplatesClientService } from "../templates/document-templates-client.service";
import { DocumentTemplatesGatewayController } from "../templates/document-templates-gateway.controller";
import { ProjectsClientService } from "../projects/projects-client.service";
import { ProjectsGatewayController } from "../projects/projects-gateway.controller";
import { SourcesClientService } from "../sources/sources-client.service";
import { SourcesGatewayController } from "../sources/sources-gateway.controller";
import { UsersClientService } from "../users/users-client.service";
import { UsersGatewayController } from "../users/users-gateway.controller";
import { DocumentsClientService } from "../documents/documents-client.service";
import { DocumentsGatewayController } from "../documents/documents-gateway.controller";
import { WorkflowClientService } from "../workflow/workflow-client.service";
import { WorkflowGatewayController } from "../workflow/workflow-gateway.controller";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

@Module({
  controllers: [
    AppController,
    AuthGatewayController,
    ProjectsGatewayController,
    SourcesGatewayController,
    DocumentTemplatesGatewayController,
    UsersGatewayController,
    DocumentsGatewayController,
    AiAnalysisGatewayController,
    AiProviderConfigurationsGatewayController,
    WorkflowGatewayController,
  ],
  providers: [
    {
      provide: GATEWAY_CONFIG,
      useFactory: loadGatewayConfig,
    },
    AppService,
    IdentityClientService,
    ProjectsClientService,
    SourcesClientService,
    DocumentTemplatesClientService,
    UsersClientService,
    DocumentsClientService,
    AiAnalysisClientService,
    WorkflowClientService,
  ],
})
export class AppModule {}
