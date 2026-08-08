# Workflow funcional: revisión y aprobación

## Alcance implementado

El Punto 19 implementa el expediente formal de revisión de una versión
documental. `Workflow Service` coordina el proceso y es propietario de:

- solicitudes de revisión;
- asignaciones de revisor y aprobador;
- comentarios y solicitudes de corrección;
- aprobaciones y rechazos;
- revisión optimista, idempotencia, actor y correlación de cada actividad.

`Documents Service` conserva la propiedad exclusiva del documento, sus
versiones, contenido, estado documental e inmutabilidad. `Projects Service`
conserva participantes y roles. No existen claves foráneas entre bases.

## Estados

```text
IN_REVIEW ──► APPROVED
    │
    ├───────► CHANGES_REQUESTED
    └───────► REJECTED
```

- `APPROVED`, `CHANGES_REQUESTED` y `REJECTED` son terminales para el
  expediente de esa versión.
- Solicitar correcciones o rechazar cambia la versión documental a
  `REJECTED`.
- El autor puede clonar la versión rechazada como un nuevo borrador; la nueva
  versión obtiene su propio expediente.
- Aprobar cambia la versión documental a `APPROVED`. Esa versión es inmutable.

## Roles efectivos

| Acción                             | Roles de proyecto                  |
| ---------------------------------- | ---------------------------------- |
| Consultar                          | Cualquier participante; `ADMIN`    |
| Solicitar revisión                 | `EDITOR`, `OWNER`, `ADMIN`         |
| Comentar                           | `REVIEWER`, `OWNER`, `ADMIN`       |
| Solicitar correcciones             | Revisor asignado; `OWNER`, `ADMIN` |
| Aprobar o rechazar definitivamente | Aprobador `OWNER`; `ADMIN`         |

Los participantes `REVIEWER` reciben asignación de revisión. Si el proyecto no
tiene un revisor separado, el propietario recibe también esa asignación. El
propietario recibe siempre la asignación de aprobación.

## API pública por Gateway

```text
POST /api/v1/projects/{projectId}/documents/{documentId}/versions/{versionNumber}/reviews
GET  /api/v1/projects/{projectId}/reviews
GET  /api/v1/projects/{projectId}/reviews/{reviewId}
POST /api/v1/projects/{projectId}/reviews/{reviewId}/comments
POST /api/v1/projects/{projectId}/reviews/{reviewId}/request-changes
POST /api/v1/projects/{projectId}/reviews/{reviewId}/approve
POST /api/v1/projects/{projectId}/reviews/{reviewId}/reject
```

Las mutaciones requieren `x-idempotency-key`. Repetir la misma operación con
la misma clave devuelve el resultado ya obtenido. Reutilizarla para otra
acción o contenido responde `409`. `expectedReviewRevision` y
`expectedDocumentRevision` protegen contra decisiones desactualizadas.

El Gateway ya no publica las transiciones directas `submit-review`, `approve`
o `reject` de Documents. Esto impide omitir el expediente de Workflow desde el
frontend.

## Persistencia

`RqWorkflowDb` contiene:

- `WorkflowReviewRequests`;
- `WorkflowReviewAssignments`;
- `WorkflowReviewActivities`.

La migración `CreateWorkflowFoundation1786406400000` crea 7 índices, 2 claves
foráneas internas y conserva 7 referencias externas sin claves foráneas.
`WorkflowReviewActivities` registra tipo, actor, comentario, fecha,
`CorrelationId` e `IdempotencyKey`.

## Operación local

```bash
pnpm workflow:db:ensure
pnpm workflow:migration:run
pnpm workflow:db:verify
pnpm auth:local:up
pnpm workflow:gateway:e2e
pnpm auth:local:down
```

Si existe `apps/workflow-service/.env`, los comandos lo usan. En desarrollo
local pueden reutilizar de forma controlada las credenciales SQL ignoradas de
Documents, cambiando únicamente el nombre de base a `RqWorkflowDb`. Ningún
secreto se imprime ni se versiona.

## Validación

El E2E crea y elimina usuario, sesión, proyecto, documentos y revisiones
temporales. Comprueba autenticación, autorización, asignaciones, comentarios,
idempotencia, conflictos, aprobación e inmutabilidad, correcciones y nueva
versión, rechazo, auditoría y cierre de rutas directas.

OpenAI permanece desconectado. La publicación de los eventos catalogados
`review.requested.v1`, `document.approved.v1` y `document.rejected.v1` continúa
como integración futura del Punto 10; el flujo HTTP transaccional del Punto 19
no ejecuta IA ni mensajería.
