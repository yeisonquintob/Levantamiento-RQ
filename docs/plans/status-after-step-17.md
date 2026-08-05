# Estado después del Paso 17

Fecha de cierre: 2026-08-05 (America/Bogota)

## Estado de los pasos

| Paso | Estado | Commit publicado |
| --- | --- | --- |
| 15 — Procesamiento asíncrono de fuentes | COMPLETO | `b626bf3` — `feat: add asynchronous source processing with BullMQ` |
| 15.5 — Administración de usuarios y credenciales | COMPLETO | `db9cb3b` — `feat: add user and credential administration` |
| 16 — Documents Service funcional | COMPLETO | `385f1a5` — `feat: implement documents domain and versioning` |
| 17 — Editor documental | COMPLETO | `f78b582` — `feat: add versioned requirement document editor` |
| 18 — Propuestas de inteligencia artificial | PENDIENTE, NO INICIADO | No aplica |

## Alcance implementado

### Paso 15

- Procesamiento asíncrono privado de fuentes con BullMQ y Redis.
- Worker separado, reintentos controlados, estados de procesamiento y limpieza.
- Almacenamiento privado en Azurite Blob, descarga autenticada, extracción y SHA-256.
- Validación de proyecto por API, sin acceso cruzado a bases de datos.

### Paso 15.5

- Administración de usuarios desde Identity Service, Gateway y Workspace.
- Roles globales, permiso `system.admin`, activación, desactivación y auditoría.
- Contraseñas temporales de una sola visualización, hash seguro y cambio obligatorio.
- Revocación/versionado de sesiones y bloqueo de cuentas inactivas.

### Paso 16

- Dominio documental propietario de `RqDocumentsDb`.
- Plantilla aplicada inmutable, documentos, versiones, las 13 secciones canónicas,
  campos, requerimientos, criterios, evidencias e historial.
- Referencias externas únicamente mediante `ProjectId` y `SourceId`, validadas por API.
- Estados `DRAFT`, `IN_REVIEW`, `APPROVED`, `REJECTED` y `ARCHIVED`.
- Concurrencia optimista, historial completo y bloqueo de versiones aprobadas.
- API REST, contratos compartidos, Swagger y exposición exclusiva por Gateway.

### Paso 17

- Listado de documentos por proyecto y creación manual.
- Editor Next.js de las 13 secciones, navegación, campos JSON anidados y guardado.
- Detección de cambios sin guardar, validación, pendientes y porcentaje de avance.
- Historial, selector y comparación de versiones, creación de nueva versión.
- Flujo de envío a revisión, aprobación y rechazo según permisos.
- Bloqueo visual y de servidor para versiones históricas o aprobadas.
- Manejo explícito de conflictos HTTP 409 con recarga de la versión vigente.
- Estados de carga, errores, confirmaciones y diseño responsive.
- Web solo se comunica con Gateway.
- Área futura separada con el texto requerido para el Paso 18, sin conexión de IA.
- Arranque local estable mediante procesos desacoplados con PID y apagado verificable.

## Migraciones aplicadas y verificadas

### RqIdentityDb

- `1785542400000-CreateIdentityFoundation`
- `1786147200000-AddUserAdministration`

### RqProjectsDb

- `1785715200000-CreateProjectsFoundation`
- `1786060800000-AddProjectTemplateSelection`

### RqSourcesDb

- `1785801600000-CreateSourcesFoundation`
- `1785888000000-AddSourceFilesAndExtraction`
- `1786060801000-AddSourceClassificationAndDescription`

### RqDocumentsDb

- `1785974400000-CreateDocumentTemplateCatalog`
- `1786233600000-CreateRequirementDocumentsDomain`

El Paso 17 no agrega migraciones; consume el dominio estable del Paso 16.

## Tablas verificadas

### Identity

- `IdentityUsers`
- `IdentityRoles`
- `IdentityPermissions`
- `IdentityUserRoles`
- `IdentityRolePermissions`
- `IdentityRefreshSessions`
- `IdentitySecurityAudit`

### Projects

- `Projects`
- `ProjectParticipants`

### Sources

- `Sources`

### Documents

- `DocumentTemplates`
- `AppliedDocumentTemplates`
- `RequirementDocuments`
- `DocumentVersions`
- `DocumentSections`
- `DocumentFields`
- `DocumentRequirements`
- `AcceptanceCriteria`
- `DocumentEvidence`
- `DocumentHistory`

No existen claves foráneas entre bases de datos de servicios.

## Endpoints disponibles a través de Gateway

Todos usan el prefijo `/api/v1`.

### Autenticación

- `POST /auth/sign-in`
- `POST /auth/refresh`
- `POST /auth/sign-out`
- `POST /auth/change-password`
- `GET /auth/me`

### Usuarios

- `GET /users`
- `GET /users/summary`
- `GET /users/roles`
- `POST /users`
- `GET /users/:userId`
- `PATCH /users/:userId`
- `PUT /users/:userId/roles`
- `POST /users/:userId/activate`
- `POST /users/:userId/deactivate`
- `POST /users/:userId/reset-password`
- `POST /users/:userId/revoke-sessions`

### Proyectos

- `GET /projects/summary`
- `GET /projects`
- `POST /projects`
- `GET /projects/:projectId`
- `PATCH /projects/:projectId`
- `POST /projects/:projectId/participants`
- `DELETE /projects/:projectId/participants/:userId`

### Fuentes

- `GET /projects/:projectId/sources/summary`
- `GET /projects/:projectId/sources`
- `POST /projects/:projectId/sources`
- `POST /projects/:projectId/sources/files`
- `GET /projects/:projectId/sources/:sourceId/download`
- `POST /projects/:projectId/sources/:sourceId/reprocess`
- `GET /projects/:projectId/sources/:sourceId`
- `PATCH /projects/:projectId/sources/:sourceId`
- `DELETE /projects/:projectId/sources/:sourceId`

### Plantillas

- `GET /templates/summary`
- `GET /templates`
- `POST /templates`
- `GET /templates/:templateId`
- `PATCH /templates/:templateId`
- `POST /templates/:templateId/publish`
- `POST /templates/:templateId/retire`
- `POST /templates/:templateId/clone`

### Documentos

- `POST /projects/:projectId/documents`
- `GET /projects/:projectId/documents`
- `GET /documents/:documentId`
- `GET /documents/:documentId/versions/:versionNumber`
- `PATCH /documents/:documentId`
- `POST /documents/:documentId/versions`
- `PATCH /documents/:documentId/versions/:versionNumber/sections/:sectionKey`
- `PATCH /documents/:documentId/versions/:versionNumber/fields`
- `POST /documents/:documentId/versions/:versionNumber/submit-review`
- `POST /documents/:documentId/versions/:versionNumber/approve`
- `POST /documents/:documentId/versions/:versionNumber/reject`
- `GET /documents/:documentId/history`
- `GET /documents/:documentId/template`
- `POST /documents/:documentId/archive`

Los mismos contratos documentales existen dentro de Documents Service, pero la
aplicación web no lo consume directamente.

## Permisos y autorización

- Administración de usuarios: rol `ADMIN` o permiso `system.admin`.
- Administración de plantillas: rol `ADMIN`, permiso `system.admin` o permiso
  `documents.templates.manage`.
- Lectura documental: administrador o participante del proyecto.
- Edición documental: administrador, `OWNER` o `EDITOR` del proyecto.
- Revisión/aprobación: administrador, `OWNER` o `REVIEWER` del proyecto.
- `VIEWER`: acceso de lectura.
- Una cuenta con contraseña temporal pendiente no puede entrar al Workspace.
- Versiones no vigentes y versiones aprobadas permanecen inmutables.

## Pruebas y verificaciones

### Validación integral final

Comando:

```bash
NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false FORCE_COLOR=0 pnpm validate:all
```

Resultado: correcto.

- instalación congelada correcta;
- lint de 18 proyectos correcto;
- typecheck de scripts y 17 proyectos con dependencias correcto;
- build de 18 proyectos correcto;
- 58 pruebas distintas correctas (`11` Identity, `8` Projects, `16` Sources,
  `23` Documents/editor);
- 47 pruebas estructurales reejecutadas correctamente;
- las cuatro bases y sus migraciones verificadas;
- almacenamiento privado y cola BullMQ verificados;
- limpieza final de procesos y puertos confirmada.

### Swagger

```bash
pnpm swagger:validate
```

Resultado: OpenAPI, Swagger UI y recursos estáticos correctos en los nueve
servicios backend.

### Pruebas focalizadas del editor

```bash
pnpm test:documents
pnpm exec nx run web:lint --skip-nx-cache
pnpm exec nx build web --skip-nx-cache
```

Resultado: `23/23` pruebas, lint y build correctos. Se validaron componentes,
formularios, las 13 secciones, navegación, guardado, validación, concurrencia,
bloqueo, comparación, historial, confirmaciones, responsive y consumo exclusivo
de Gateway.

## Smoke tests

- Paso 15: `pnpm sources:async:smoke` ejecutado dos veces; blob, SHA-256,
  worker, extracción, estado `READY` y limpieza correctos en ambas ejecuciones.
- Paso 15.5: smoke HTTP real de Identity, Gateway, frontend, SQL Server, cookies,
  sesiones, contraseña temporal, cambio obligatorio, roles, revocación,
  desactivación/activación y limpieza ejecutado dos veces correctamente.
- Paso 16: `pnpm documents:domain:smoke:twice`; documento, 13 secciones,
  actualización, nueva versión, historial, aprobación/bloqueo y limpieza correctos
  en ambas ejecuciones.

## E2E del editor

Se ejecutaron dos recorridos completos desde fixture limpia usando la cuenta de
prueba entregada fuera del repositorio. Las credenciales no se almacenaron ni se
imprimieron.

Cada recorrido confirmó:

1. inicio de sesión;
2. selección explícita de proyecto;
3. creación manual de documento;
4. apertura del editor;
5. navegación por las 13 secciones;
6. edición y detección de cambios sin guardar;
7. guardado y aumento de revisión;
8. recarga y persistencia;
9. creación confirmada de una nueva versión;
10. historial con creación, versión y actualización;
11. apertura y bloqueo de la versión anterior;
12. cierre de sesión;
13. eliminación de documentos, plantillas aplicadas y proyectos temporales.

Resultado: primera y segunda ejecución correctas.

## Archivos principales del Paso 17

- `apps/web/src/app/workspace/documents/page.tsx`
- `apps/web/src/app/workspace/documents/documents-workspace.tsx`
- `apps/web/src/app/workspace/documents/[documentId]/page.tsx`
- `apps/web/src/app/workspace/documents/[documentId]/requirement-document-editor.tsx`
- `apps/web/src/app/app-shell.tsx`
- `libs/shared/ui/src/styles.css`
- `tests/documents/document-editor.test.tsx`
- `scripts/document-editor-e2e-fixture.ts`
- `scripts/start-detached-process.mjs`
- `scripts/local-auth-up.sh`
- `scripts/local-auth-status.sh`
- `scripts/local-auth-down.sh`
- `scripts/validate-all.sh`
- `package.json`

## Ejecución local

Requisitos: Node.js/pnpm instalados, Docker Desktop iniciado y los archivos `.env`
locales ya configurados.

```bash
bash scripts/infrastructure-up.sh
pnpm identity:migration:run
pnpm projects:migration:run
pnpm sources:migration:run
pnpm documents:migration:run
pnpm auth:local:up
pnpm auth:local:status
```

Para detener:

```bash
pnpm auth:local:down
```

### Abrir Usuarios

1. Iniciar sesión con una cuenta que tenga `system.admin`.
2. Abrir `http://127.0.0.1:4200/workspace/settings/users`.

### Abrir Documentos

1. Iniciar sesión y entrar al Workspace.
2. Abrir `http://127.0.0.1:4200/workspace/documents` o usar **Documentos** en
   el sidebar.
3. Elegir un proyecto accesible.

### Abrir el Editor

1. Desde Documentos, crear un documento manual o abrir uno existente.
2. La ruta resultante es
   `http://127.0.0.1:4200/workspace/documents/:documentId`.

## Riesgos y pendientes

- Las dependencias `fast-csv` y `xmlchars` emiten advertencias no bloqueantes por
  mapas de fuentes ausentes durante webpack; build y ejecución son correctos.
- El E2E se ejecutó con el navegador integrado y fixture de limpieza, pero el
  repositorio aún no incorpora un runner de navegador autónomo. No fue necesario
  agregar una dependencia nueva para cerrar el alcance solicitado.
- El exportador oficial de la aplicación Codex no está expuesto como herramienta
  invocable en este entorno. El repositorio completo sí está publicado y
  reproducible en `origin/main`; la exportación de la tarea debe iniciarse desde
  la interfaz oficial cuando esa opción esté disponible.
- No hay trabajo funcional pendiente en los pasos 15, 15.5, 16 o 17.

## Preparación pendiente del Paso 18

El Paso 18 no se inició. No se modificó AI Analysis Service, no se instaló OpenAI,
no se crearon prompts y no se generaron ni aplicaron propuestas automáticas. La
preparación pendiente consiste en revisar y aprobar el alcance específico del
Paso 18 antes de diseñar contratos, seguridad, prompts, auditoría o integración
con un proveedor de IA.
