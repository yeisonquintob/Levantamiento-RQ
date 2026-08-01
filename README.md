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
- [Plan del modelo documental](docs/document-model/README.md)
- [Decisiones arquitectónicas](docs/decisions/README.md)

## Estado

Paso 3: arquitectura definida y documentada.

La estructura detallada de los documentos se definirá en el Paso 3.1,
antes de implementar bases de datos, APIs o el Documents Service.

Todavía no se han creado aplicaciones, microservicios, bases de datos
ni contenedores.
