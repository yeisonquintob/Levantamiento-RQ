# ADR-0025: Workflow coordina la revisión y Documents conserva el contenido

## Estado

Aceptada e implementada en el Punto 19.

## Contexto

Documents ya podía versionar y cambiar el estado de una versión, pero exponer
esas transiciones directamente no creaba asignaciones, comentarios ni un
expediente de decisión. El límite definido asigna esos datos a Workflow y el
contenido aprobado a Documents.

## Decisión

- Workflow es propietario de solicitudes, asignaciones y actividad de revisión.
- Documents sigue siendo propietario del estado e inmutabilidad documental.
- Projects resuelve acceso y roles mediante HTTP autenticado.
- Workflow coordina las transiciones de Documents mediante HTTP y propaga JWT
  y correlación.
- El Gateway expone solo las transiciones de Workflow al frontend.
- Toda mutación de Workflow requiere clave idempotente.
- Las referencias a proyecto, documento, versión y usuario no crean claves
  foráneas entre bases.

## Consecuencias

- Una aprobación siempre deja evidencia de actor, rol, fecha y correlación.
- La versión aprobada queda inmutable en Documents.
- Las correcciones generan una versión posterior, no sobrescriben la revisada.
- La consistencia entre Workflow y Documents se coordina por HTTP con revisión
  optimista. Los eventos y reintentos distribuidos se incorporarán cuando se
  complete el alcance pendiente del Punto 10.
- OpenAI no participa en el proceso de decisión.
