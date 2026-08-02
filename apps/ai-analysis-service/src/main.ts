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

loadEnvironmentFiles({
  paths: [".env", "apps/ai-analysis-service/.env"],
});

async function bootstrap(): Promise<void> {
  const config = loadBaseServiceConfig({
    serviceName: "ai-analysis-service",
    defaultPort: 3005,
  });

  const { AppModule } = await import("./app/app.module.js");

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const globalPrefix = "api/v1";

  app.setGlobalPrefix(globalPrefix);
  if (config.environment === "development") {
    const openApiConfig = new DocumentBuilder()
      .setTitle("Levantamiento RQ - AI Analysis Service API")
      .setDescription("Análisis asistido por inteligencia artificial.")
      .setVersion("1.0.0")
      .addTag("health", "Disponibilidad técnica del servicio")
      .build();

    const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);

    SwaggerModule.setup("api/docs", app, openApiDocument, {
      customSiteTitle: "Levantamiento RQ - AI Analysis Service API",
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
    `AI Analysis Service disponible en http://${config.host}:${config.port}/${globalPrefix} (${config.environment})`,
    "Bootstrap",
  );
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);

  Logger.error(message, "Bootstrap");
  process.exitCode = 1;
});
