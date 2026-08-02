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
import {
  ApplicationExceptionFilter,
  CorrelationIdInterceptor,
} from "@levantamiento-rq/shared-http";

loadEnvironmentFiles({
  paths: [".env", "apps/identity-service/.env"],
});

async function bootstrap(): Promise<void> {
  const config = loadBaseServiceConfig({
    serviceName: "identity-service",
    defaultPort: 3001,
  });

  const { AppModule } = await import("./app/app.module.js");

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.setGlobalPrefix("api/v1");
  app.useGlobalInterceptors(new CorrelationIdInterceptor());
  app.useGlobalFilters(new ApplicationExceptionFilter());
  if (config.environment === "development") {
    const openApiConfig = new DocumentBuilder()
      .setTitle("Levantamiento RQ - Identity Service API")
      .setDescription("Usuarios, roles, permisos, sesiones y tokens.")
      .setVersion("1.0.0")
      .addTag("health", "Disponibilidad técnica del servicio")
      .addTag("authentication", "Identidad y sesiones")
      .addBearerAuth()
      .build();

    const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);

    SwaggerModule.setup("api/docs", app, openApiDocument, {
      customSiteTitle: "Levantamiento RQ - Identity Service API",
      swaggerOptions: {
        displayRequestDuration: true,
        persistAuthorization: false,
        withCredentials: true,
      },
    });
  }
  app.enableShutdownHooks();

  await app.listen(config.port, config.host);

  Logger.log(
    `Identity Service disponible en http://${config.host}:${config.port}/api/v1 (${config.environment})`,
    "Bootstrap",
  );
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);

  Logger.error(message, "Bootstrap");
  process.exitCode = 1;
});
