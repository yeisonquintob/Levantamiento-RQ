# Aplicaciones backend

## Estado

Las aplicaciones base NestJS fueron creadas como esqueletos técnicos.
Todavía no contienen entidades, casos de uso, persistencia, mensajería,
autenticación ni lógica empresarial.

## Aplicaciones y puertos locales

| Aplicación            | Scope Nx      | Puerto predeterminado |
| --------------------- | ------------- | --------------------: |
| gateway               | gateway       |                  3000 |
| identity-service      | identity      |                  3001 |
| projects-service      | projects      |                  3002 |
| sources-service       | sources       |                  3003 |
| documents-service     | documents     |                  3004 |
| ai-analysis-service   | ai            |                  3005 |
| erp-knowledge-service | erp-knowledge |                  3006 |
| workflow-service      | workflow      |                  3007 |
| operations-service    | operations    |                  3008 |

Cada aplicación:

- Usa NestJS con Fastify.
- Escucha solamente en `127.0.0.1` de forma predeterminada.
- Admite `HOST` y `PORT` mediante variables de entorno.
- Expone `GET /api/v1/health`.
- Tiene etiquetas Nx de scope y `type:app`.
- Puede compilarse y validarse de manera independiente.

## Fuera del alcance de este paso

- Frontend Next.js.
- Librerías compartidas.
- Bases de datos y TypeORM.
- Autenticación y autorización.
- RabbitMQ, Redis y Azurite dentro de las aplicaciones.
- OpenAI.
- Lógica funcional.
- Endpoints de negocio.
