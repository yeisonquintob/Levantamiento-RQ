# Propiedad de bases de datos

| Servicio      | Base prevista    | Estado      |
| ------------- | ---------------- | ----------- |
| Identity      | RqIdentityDb     | Implementada |
| Projects      | RqProjectsDb     | Implementada |
| Sources       | RqSourcesDb      | Implementada |
| Documents     | RqDocumentsDb    | Implementada |
| AI Analysis   | RqAiDb           | Planificada |
| ERP Knowledge | RqErpKnowledgeDb | Futura      |
| Workflow      | RqWorkflowDb     | Planificada |
| Operations    | RqOperationsDb   | Planificada |

## Reglas

- Una base pertenece a un solo servicio.
- Cada servicio tendrá migraciones TypeORM propias.
- No existirán claves foráneas entre bases.
- No existirán repositorios TypeORM compartidos.
- Las referencias externas serán identificadores.
- La comunicación será mediante APIs o eventos.
- Dynamics 365 no será consultado mediante SQL directo.
- Los snapshots ERP tendrán versión y trazabilidad.

## Implementación técnica

- [Base de persistencia TypeORM y SQL Server](persistence-foundation.md)

## Sources Service

`RqSourcesDb` conserva metadatos, estado y texto extraído. Los binarios
pertenecen al contenedor privado `rq-sources` de Azure Blob Storage/Azurite.
No se guardan archivos completos en SQL Server y no existen claves foráneas
hacia `RqProjectsDb`.

## Documents Service

`RqDocumentsDb` es propietario de `dbo.DocumentTemplates`. El catálogo guarda
metadatos, versión SemVer, estado y definición JSON de cada plantilla. No
existen claves foráneas hacia otras bases; los identificadores de usuario y
la plantilla de origen se conservan como referencias externas o internas sin
acoplar dominios.
