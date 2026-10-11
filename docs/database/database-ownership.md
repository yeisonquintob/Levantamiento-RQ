# Propiedad de bases de datos

| Servicio      | Base prevista    | Estado                         |
| ------------- | ---------------- | ------------------------------ |
| Identity      | RqIdentityDb     | Implementada                   |
| Projects      | RqProjectsDb     | Implementada                   |
| Sources       | RqSourcesDb      | Implementada                   |
| Documents     | RqDocumentsDb    | Implementada                   |
| AI Analysis   | RqAiDb           | Implementada                   |
| ERP Knowledge | RqErpKnowledgeDb | Futura                         |
| Workflow      | RqWorkflowDb     | Implementada                   |
| Operations    | RqOperationsDb   | Implementada                   |
| Prototypes    | RqPrototypesDb   | En validación (posterior a V1) |

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

## Workflow Service

`RqWorkflowDb` almacena solicitudes, asignaciones y actividades de revisión.
Proyecto, documento, versión y usuario se conservan como identificadores
externos. Solo asignaciones y actividades tienen claves foráneas internas hacia
su solicitud de revisión.

## AI Analysis Service

`RqAiDb` conserva solicitudes, snapshots, ejecuciones, prompts, resultados,
configuraciones no secretas y auditoría de proveedores. Las credenciales viven
en Keychain o Azure Key Vault; SQL solo guarda una referencia opaca.

## Operations Service

`RqOperationsDb` conserva solicitudes y metadatos de exportación,
notificaciones, entregas, auditoría e inbox de eventos. Los artefactos PDF/DOCX
pertenecen al contenedor privado `rq-exports`.

## Prototypes Service

`RqPrototypesDb` (en validación, posterior a V1) conserva las generaciones de
prototipo, sus pantallas planificadas, las especificaciones visuales y las
imágenes generadas con sus intentos y trazas. Las imágenes viven en un
contenedor privado de Blob propio (`PROTOTYPE_IMAGES_STORAGE_CONTAINER`) y la
generación de imágenes usa su propia cola BullMQ (`PROTOTYPE_IMAGE_QUEUE`). El
servicio no abre conexiones a otras bases: referencia proyectos, documentos y
usuarios solo por identificador, y obtiene planificación e imágenes de IA
mediante la API interna de AI Analysis.

## ERP Knowledge Service

`RqErpKnowledgeDb` continúa reservada para una fase futura. No se activa
persistencia ni acceso a Dynamics productivo en la V1.
