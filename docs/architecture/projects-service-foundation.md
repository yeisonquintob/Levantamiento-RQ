# Projects Service y Workspace

## Alcance del Paso 12

El dominio de proyectos queda operativo en una sola entrega, desde SQL Server
hasta la experiencia responsive del Workspace.

## Responsabilidades

Projects Service es propietario de:

- proyectos de levantamiento;
- código consecutivo del proyecto;
- estado general del proyecto;
- propietario y participantes;
- reglas de acceso al proyecto;
- auditoría básica de creación y actualización.

La base propietaria es `RqProjectsDb`.

## Modelo

### Projects

Contiene código, nombre, área solicitante, descripción, estado, propietario,
usuarios de auditoría y fechas UTC.

### ProjectParticipants

Relaciona un proyecto con identificadores externos de usuarios y un rol
interno: `OWNER`, `EDITOR`, `REVIEWER` o `VIEWER`.

`UserId`, `OwnerUserId`, `CreatedByUserId`, `UpdatedByUserId` y
`AddedByUserId` son referencias externas. No tienen claves foráneas hacia
`RqIdentityDb`.

## Estados

- `DRAFT`: borrador.
- `IN_PROGRESS`: en elaboración.
- `VALIDATION`: en validación.
- `APPROVED`: aprobado.
- `ARCHIVED`: archivado.

El flujo formal de revisión y aprobación continuará perteneciendo a Workflow
Service. En este paso se conserva únicamente el estado general visible del
proyecto.

## Seguridad

Projects Service valida el access token emitido por Identity Service. El
Gateway toma la cookie HttpOnly y reenvía el token como Bearer al servicio.

El administrador puede consultar todos los proyectos. Los demás usuarios
acceden únicamente cuando aparecen en `ProjectParticipants`.

## Workspace

La vista permite:

- crear proyectos;
- consultar indicadores reales;
- buscar por código, nombre o área;
- filtrar por estado;
- ver y actualizar el proyecto;
- consultar cantidad de participantes;
- operar en escritorio y móvil.

La administración visual de participantes se incorporará cuando Identity
Service publique el directorio controlado de usuarios. La API y el modelo de
participantes quedan preparados desde este paso.

## Límites

- No se modifican Sources, Documents, AI Analysis ni Workflow.
- No se consultan tablas de Identity desde Projects Service.
- No se crean datos simulados.
- No se ejecutan migraciones automáticamente durante el arranque.
