# Estado después del Paso 18

## Punto 18 — completo

El alcance autoritativo del Punto 18 termina en 18.1E. Todos sus subpasos
definidos están cerrados:

| Subpaso | Estado |
|---|---|
| 18.1A — Modelo y contrato | COMPLETO |
| 18.1B — Persistencia | COMPLETO |
| 18.1B.1 — Activación de RqAiDb | COMPLETO |
| 18.1C — Seguridad | COMPLETO |
| 18.1D — API AI Analysis | COMPLETO |
| 18.1E — Gateway y E2E autenticado | COMPLETO |

Último commit funcional:

```text
ed7af54 feat: expose ai analysis requests through gateway
```

La validación final corrigió en `07d6e93` la comparación de UUID de
participantes recibidos desde Projects Service para que no distinga mayúsculas
y minúsculas, igual que las demás comparaciones externas de UUID.

## Persistencia

`RqAiDb` conserva la estructura aprobada:

- 3 tablas;
- 7 índices;
- 2 claves foráneas internas;
- 5 referencias externas sin claves foráneas;
- migración `CreateAiAnalysisFoundation1786320000000`.

No existen claves foráneas entre bases de datos.

## Gateway y E2E

Gateway publica las cuatro operaciones de solicitudes de análisis: crear,
listar, consultar y cancelar. El E2E autenticado pasó dos veces consecutivas y
verificó sesión real, cookie HttpOnly, snapshot de fuentes, estado `PENDING`,
cero ejecuciones, cancelación idempotente y limpieza de datos temporales.

## Proveedor y límites

OpenAI permanece desconectado. `DISABLED` es el único proveedor admitido por el
contrato y la base de datos. Crear una solicitud no crea una
`AnalysisExecution` ni ejecuta IA automáticamente.

Se mantiene la revisión humana obligatoria: la IA no aprueba, no sobrescribe
contenido aprobado y no aplica cambios automáticamente.

## Límite del roadmap

No existe actualmente una definición autoritativa de 18.1F, 18.2 o
equivalente. El flujo descrito en `ai-analysis-flow.md` permanece como
arquitectura conceptual futura y no se implementa como parte del Punto 18 sin
una decisión posterior.
