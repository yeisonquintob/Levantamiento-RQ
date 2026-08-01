# Base de persistencia TypeORM y SQL Server

## Alcance del Paso 8

Se incorpora una base técnica compartida para conectar los ocho
servicios propietarios de datos a SQL Server o Azure SQL mediante
TypeORM.

## Servicios y bases

| Servicio              | Base               |
| --------------------- | ------------------ |
| Identity Service      | `RqIdentityDb`     |
| Projects Service      | `RqProjectsDb`     |
| Sources Service       | `RqSourcesDb`      |
| Documents Service     | `RqDocumentsDb`    |
| AI Analysis Service   | `RqAiDb`           |
| ERP Knowledge Service | `RqErpKnowledgeDb` |
| Workflow Service      | `RqWorkflowDb`     |
| Operations Service    | `RqOperationsDb`   |

El Gateway no tiene base de datos.

## Activación

La persistencia está deshabilitada de forma predeterminada con
`DATABASE_ENABLED=false`. Esto permite iniciar y validar los servicios
sin disponer todavía de una instancia remota.

Cuando se habilite, cada servicio requiere su propio archivo `.env`
con host, usuario, contraseña y base.

## Reglas obligatorias

- `synchronize` permanece deshabilitado.
- `dropSchema` permanece deshabilitado.
- Las migraciones no se ejecutan automáticamente al iniciar.
- Cada servicio conserva su propio `data-source.ts` y carpeta de
  migraciones.
- No existen entidades, repositorios ni migraciones compartidas.
- No existen claves foráneas entre bases.
- No se crean bases ni usuarios durante este paso.
