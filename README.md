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
- Azurite / Azure Blob Storage.
- OpenAI API.
- Nx y pnpm.
- Docker Compose.

## Documentación

- [Arquitectura](docs/architecture/README.md)
- [Infraestructura local](infrastructure/docker/README.md)
- [Contratos HTTP](docs/api/http-contract-guidelines.md)
- [Catálogo de eventos](docs/api/event-catalog.md)
- [Propiedad de datos](docs/database/database-ownership.md)
- [Modelo documental canónico](docs/document-model/README.md)
- [Decisiones arquitectónicas](docs/decisions/README.md)

## Estado

Paso 4: infraestructura local preparada.

Docker Compose incluye Redis, RabbitMQ y Azurite con imágenes ARM64 y
versiones fijadas. SQL Server o Azure SQL se utilizará mediante una
instancia remota durante el desarrollo.

Todavía no se han creado aplicaciones, microservicios, bases de datos
ni migraciones.

## Estado de implementación

Paso 5: aplicaciones backend NestJS creadas con Fastify.

Existen nueve esqueletos técnicos compilables. Todavía no se han
implementado lógica empresarial, persistencia, mensajería, seguridad,
inteligencia artificial ni frontend.

## Librerías compartidas

El Paso 6 incorporó contratos técnicos, configuración, errores, soporte HTTP,
observabilidad y utilidades de pruebas bajo `libs/shared`.

Los límites entre scopes y tipos se validan mediante ESLint y etiquetas Nx.

## Paso 7: variables de entorno y Gateway

Las nueve aplicaciones validan su configuración técnica mediante `shared-config`. El Gateway registra correlación HTTP, Problem Details, health check tipado y registro estructurado de inicio.

## Paso 8: base de persistencia

Los ocho servicios propietarios de datos cuentan con configuración TypeORM para SQL Server o Azure SQL. La persistencia permanece deshabilitada hasta disponer de credenciales reales.

## Paso 9: frontend responsive

Existe una aplicación Next.js llamada `web` y una librería `shared-ui` con temas, escalas de accesibilidad y componentes base.

## Paso 10: identidad, autenticación y autorización

Identity Service contiene el modelo de usuarios, roles, permisos y sesiones.
El Gateway expone inicio, renovación, consulta y cierre de sesión mediante
cookies HttpOnly. La autenticación permanece deshabilitada hasta configurar
RqIdentityDb y los secretos JWT; no se incluyen usuarios predeterminados.

## Paso 11: activación real de identidad

La autenticación local puede conectarse a RqIdentityDb mediante archivos
de entorno ignorados por Git. El proceso controlado confirma o crea la base,
aplica la migración, prepara el primer administrador y valida la sesión real
a través de Identity Service, Gateway y frontend.

## Swagger y OpenAPI

Los nueve servicios backend publican Swagger UI únicamente en desarrollo.
El Gateway está disponible en `http://127.0.0.1:3000/api/docs`.

La validación completa se ejecuta con:

```bash
pnpm swagger:validate
```

## Paso 12: Projects Service y Workspace

`RqProjectsDb` almacena proyectos y participantes sin relaciones entre bases.
Projects Service valida access tokens, el Gateway publica la API de proyectos
y el Workspace permite crear, consultar, filtrar y actualizar registros reales.
