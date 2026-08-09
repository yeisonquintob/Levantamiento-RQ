import { resolve } from "node:path";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import {
  loadBaseServiceConfig,
  loadEnvironmentFiles,
} from "@levantamiento-rq/shared-config";
import { ApplicationExceptionFilter } from "@levantamiento-rq/shared-http";
import { registerRuntimeTelemetry } from "@levantamiento-rq/shared-observability";

loadEnvironmentFiles({
  paths: [".env", "apps/projects-service/.env"],
});

async function bootstrap(): Promise<void> {
  const config = loadBaseServiceConfig({
    serviceName: "projects-service",
    defaultPort: 3002,
  });

  const { AppModule } = await import("./app/app.module.js");

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const globalPrefix = "api/v1";

  registerRuntimeTelemetry(app.getHttpAdapter().getInstance(), {
    serviceName: config.serviceName,
    globalPrefix,
  });
  app.setGlobalPrefix(globalPrefix);
  app.useGlobalFilters(new ApplicationExceptionFilter());

  if (config.environment === "development") {
    const openApiConfig = new DocumentBuilder()
      .setTitle("Levantamiento RQ - Projects Service API")
      .setDescription(
        "Proyectos, participantes y acceso del levantamiento de requerimientos.",
      )
      .setVersion("1.0.0")
      .addTag("health", "Disponibilidad técnica del servicio")
      .addTag("projects", "Gestión de proyectos y participantes")
      .addBearerAuth()
      .build();

    const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);

    SwaggerModule.setup("api/docs", app, openApiDocument, {
      customSwaggerUiPath: resolve(
        __dirname,
        "../../../node_modules/swagger-ui-dist",
      ),
      customSiteTitle: "Levantamiento RQ - Projects Service API",
      swaggerOptions: {
        displayRequestDuration: true,
        persistAuthorization: false,
      },
    });
  }

  app.enableShutdownHooks();
  await app.listen(config.port, config.host);

  Logger.log(
    `Projects Service disponible en http://${config.host}:${config.port}/${globalPrefix} (${config.environment})`,
    "Bootstrap",
  );
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);

  Logger.error(message, "Bootstrap");
  process.exitCode = 1;
});
