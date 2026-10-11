# Auditoría de cambios

La vista Configuración → Auditoría requiere `system.admin` y permite consultar tres grupos sin seleccionar previamente un proyecto:

- Cambios administrativos: proveedores de IA y usuarios/roles.
- Proyectos: creación, cambios de título, descripción, área y estado, participantes y eliminación.
- Aprobaciones: solicitud de revisión, correcciones, aprobación y rechazo documental.

Los filtros de texto, módulo/proyecto, fechas y resultado se aplican automáticamente. Las fechas se interpretan en hora de Colombia. Los resultados están paginados; cada evento muestra persona, recurso, acción, fecha y los valores anteriores y nuevos cuando existen. `Vacío` representa un campo sin contenido, sin confundirlo con `false` o `0`.

## Persistencia

Cada servicio conserva sus propios registros. Las modificaciones de usuarios, proyectos y proveedores guardan el cambio y su auditoría en una transacción de su base de datos. Al sustituir el proveedor predeterminado se audita también el proveedor que deja de serlo. La rotación prepara una referencia nueva en la bóveda y confirma referencia y auditoría juntas antes de retirar la credencial anterior. La auditoría nunca guarda claves, contraseñas ni referencias de la bóveda.

Las aprobaciones provienen de los eventos existentes de Workflow consumidos por Operations. Los eventos nuevos incluyen el nombre de la persona, comentario y transición. El historial de Operations y el nuevo historial de proyectos sobreviven a la eliminación de un proyecto.

No se reconstruyen valores anteriores desconocidos. La migración de proyectos incorpora exclusivamente el creador y la fecha de creación existentes; la etiqueta usa el nombre actual del proyecto y el registro lo identifica como histórico. Los eventos antiguos de IA y usuarios mantienen la información disponible. Gateway resuelve los nombres actuales de personas cuyo registro antiguo solo contiene el identificador; el identificador permanece visible.

## API de consulta

| Ruta en Gateway | Servicio propietario |
| --- | --- |
| `GET /api/v1/admin/ai-providers/audit-events` | AI Analysis |
| `GET /api/v1/users/audit-events` | Identity |
| `GET /api/v1/projects/audit-events` | Projects |
| `GET /api/v1/admin/audit/approvals` | Operations |

Parámetros: `page`, `pageSize` (máximo 100), `search`, `result`, `from`, `to` y `projectId` para proyectos/aprobaciones. La ruta previa de auditoría por proyecto conserva su contrato y control de acceso.

## Instalación y comprobación

Aplicar `pnpm identity:migration:run`, `pnpm projects:migration:run` y `pnpm ai:migration:run` antes de iniciar la versión nueva. Las migraciones no truncan ni eliminan el historial al intentar revertirse.

`pnpm test:audit` verifica acceso, filtros, valores vacíos, registro transaccional, conservación tras borrar proyectos y rotación de credenciales. `tests/audit/database-read-smoke.ts` permite comprobar consultas contra las bases locales sin modificar registros: ejecutar con `TSX_TSCONFIG_PATH=tests/audit/tsconfig.json node --import tsx tests/audit/database-read-smoke.ts <projects|users|ai|approvals>` y la configuración de base de datos correspondiente.
