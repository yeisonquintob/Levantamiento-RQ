# Propiedad de bases de datos

| Servicio      | Base prevista    | Estado      |
| ------------- | ---------------- | ----------- |
| Identity      | RqIdentityDb     | Implementada |
| Projects      | RqProjectsDb     | Implementada |
| Sources       | RqSourcesDb      | Implementada |
| Documents     | RqDocumentsDb    | Planificada |
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
