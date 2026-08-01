# SQL Server y Azure SQL

## Decisión para desarrollo

El Mac de desarrollo utiliza arquitectura ARM64. SQL Server no se
incluirá en Docker Compose ni se ejecutará mediante emulación no
soportada.

Cuando se implementen los servicios se utilizará una de estas opciones:

1. Azure SQL para desarrollo.
2. SQL Server remoto administrado por la organización.
3. Un host Linux x86-64 autorizado para contenedores de SQL Server.

## Configuración pendiente

El archivo local `infrastructure/docker/.env` reserva:

```text
SQL_SERVER_HOST
SQL_SERVER_PORT
SQL_SERVER_ADMIN_USER
SQL_SERVER_ADMIN_PASSWORD
SQL_SERVER_ENCRYPT
SQL_SERVER_TRUST_SERVER_CERTIFICATE
```

Estos valores no se utilizan todavía y no se publican en Git.

## Bases previstas

- `RqIdentityDb`.
- `RqProjectsDb`.
- `RqSourcesDb`.
- `RqDocumentsDb`.
- `RqAiDb`.
- `RqErpKnowledgeDb` en una fase futura.
- `RqWorkflowDb`.
- `RqOperationsDb`.

En el Paso 4 no se crea ninguna base, usuario, esquema ni migración.
