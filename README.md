# Levantamiento RQ

Plataforma distribuida para el levantamiento, análisis, edición,
revisión y aprobación de requerimientos con apoyo de inteligencia
artificial.

## Objetivo

Permitir que un analista cargue documentos, conversaciones, notas y
otras fuentes para producir un borrador estructurado de requerimientos,
revisarlo, editarlo, aprobarlo y exportarlo.

La inteligencia artificial propone contenido y recomendaciones, pero
no modifica automáticamente información aprobada.

## Contexto empresarial

La plataforma podrá considerar sistemas empresariales existentes antes
de recomendar un nuevo desarrollo. Dynamics 365 podrá incorporarse en
una fase futura como fuente de conocimiento para análisis fit-gap.

Esta capacidad no representa una integración operacional ni una
conexión directa a producción.

## Arquitectura prevista

- Frontend responsive independiente.
- API Gateway / BFF.
- Identity Service.
- Projects Service.
- Sources Service.
- Documents Service.
- AI Analysis Service.
- ERP Knowledge Service.
- Workflow Service.
- Operations Service.

## Stack principal

- NestJS y TypeScript.
- Fastify.
- TypeORM.
- SQL Server / Azure SQL.
- Passport, JWT y cookies seguras.
- BullMQ y Redis.
- RabbitMQ / Azure Service Bus.
- MinIO / Azure Blob Storage.
- OpenAI API.
- Nx y pnpm.
- Docker Compose.

## Documentación

- [Arquitectura](docs/architecture/README.md)
- [Contratos HTTP](docs/api/http-contract-guidelines.md)
- [Catálogo de eventos](docs/api/event-catalog.md)
- [Propiedad de datos](docs/database/database-ownership.md)
- [Modelo documental canónico](docs/document-model/README.md)
- [Decisiones arquitectónicas](docs/decisions/README.md)

## Estado

Paso 3.1: estructura documental y plantilla canónica definidas.

La plataforma utilizará la plantilla compacta 1.0.0 con trece secciones,
contrato JSON, validaciones, versionamiento y reglas de exportación.

Todavía no se han creado aplicaciones, microservicios, bases de datos,
migraciones ni contenedores.
