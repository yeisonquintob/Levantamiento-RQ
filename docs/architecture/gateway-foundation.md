# Base técnica del Gateway

## Capacidades implementadas

- Configuración tipada y validada al iniciar.
- Prefijo global configurable.
- Identificador de correlación mediante `x-correlation-id`.
- Respuestas de error con el contrato Problem Details.
- Health check tipado en `GET /api/v1/health`.
- Versión del servicio en el health check.
- Registro estructurado de inicio.
- Cierre ordenado mediante shutdown hooks.

## Fuera del alcance del Paso 7

- Autenticación y autorización.
- Usuarios, roles y permisos.
- Proxy o rutas hacia servicios internos.
- Bases de datos, TypeORM y migraciones.
- RabbitMQ, BullMQ, Redis y Azurite dentro de las aplicaciones.
- OpenAI, lógica empresarial y frontend.
