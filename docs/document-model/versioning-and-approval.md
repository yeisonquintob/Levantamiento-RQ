# Versionamiento y aprobación

## Plantillas

Estados del catálogo:

```text
BORRADOR → PUBLICADA → RETIRADA
```

- La plantilla canónica inicia en la versión `1.0.0`.
- Una versión publicada o retirada es inmutable.
- Cambiar estructura, orden o reglas exige nueva versión.
- Los documentos conservan la versión de plantilla utilizada.
- El prompt de análisis y el contrato de salida pertenecen a esa misma versión.
- Una nueva versión se crea clonando una versión publicada o retirada.
- La nueva versión debe ser SemVer superior a la versión de origen.
- Código y versión forman una combinación única dentro del catálogo.

## Documentos

Estados implementados:

```text
BORRADOR → EN VALIDACIÓN → APROBADO
                         ↘ CON CORRECCIONES / RECHAZADO
```

Internamente corresponden a `DRAFT`, `IN_REVIEW`, `APPROVED` y `REJECTED` en
Documents. Workflow conserva `IN_REVIEW`, `CHANGES_REQUESTED`, `APPROVED` y
`REJECTED` para el expediente de cada versión.

## Cambios

- Editar un borrador actualiza su revisión interna.
- Solicitar validación bloquea cambios no autorizados.
- Aprobar crea una versión inmutable.
- Modificar un aprobado crea una nueva versión en BORRADOR.
- Generar o regenerar un borrador no crea una entrada de control de cambios.
- Al aprobar una versión posterior a la inicial, el control de cambios registra una única entrada compacta con versión, fecha, modificación y quién aprobó.
- Comentarios, correcciones y decisiones registran actor, correlación y clave
  idempotente en `RqWorkflowDb`.
- Repetir una mutación con la misma clave no duplica la actividad.

## Roles

- Elaboró: la persona responsable autenticada que crea y edita.
- Revisó: su líder, que valida y solicita correcciones.
- Aprobó: la persona solicitante o su líder, que toma la decisión final.

Los nombres inferidos desde fuentes son propuestas; el actor autenticado que
ejecuta cada transición es el dato definitivo del expediente.

Una misma persona podrá ocupar más de un rol únicamente cuando la política
de la organización lo permita y quede auditado.

La implementación y sus rutas se describen en
[`workflow-review-approval.md`](../architecture/workflow-review-approval.md).
