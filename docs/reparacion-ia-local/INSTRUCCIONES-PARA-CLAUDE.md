# Diagnóstico y reparación acotada de requerimientos con IA local

Fecha: 26 de septiembre de 2026.
Proyecto observado: RQ-2026-000309 · Proceso de Soat.
Estado: corrección acotada implementada y verificada con pruebas aisladas; falta confirmar el incidente real con la respuesta original del modelo.

## 1. Conclusiones y evidencia

La captura muestra una ejecución fallida al 10 %, en «Preparación», con una fuente de conversación y el modelo `qwen3.5:9b`. El código visible es `AI_EXECUTION_FAILED` y el detalle es:

> LOCAL_ONLY_V2 rechazó Requerimientos: la salida no contiene ninguna estructura HITO/HU reconocible, o la jerarquía del contrato quedó corrupta.

El mensaje se encuentra en `apps/ai-analysis-service/src/execution/local-only-v2-sequential-block-generator.ts`, aproximadamente en la línea 1615. Las líneas pueden cambiar; localizar por el texto exacto.

El código inspeccionado confirma que el rechazo ocurre cuando la sección es `milestones`, hay hallazgos relevantes y `classifyMilestonesContent(output.content)` devuelve `UNPARSEABLE`.

Antes de ese rechazo YA existe una llamada de reparación. Su resultado se acepta únicamente si respeta el límite de caracteres, deja de ser `UNPARSEABLE` y conserva los elementos existentes mediante `repairPreservesExistingMilestonesElements`. El bloque captura excepciones y comprueba cancelación, pero no muestra en ese punto el motivo de la reparación fallida.

La reparación solicita un formato textual con HITO/HU y campos COMO, QUIERO, PARA, CONTEXTO y CA; no debe suponerse que el contenido interno sea un árbol JSON. También indica que una HU incompleta puede conservarse como `PENDING_DOCUMENTATION`. No se debe convertir incompletitud documental en corrupción estructural.

No se inspeccionó la respuesta original de esta ejecución ni sus registros. Por tanto, todavía NO está confirmada la causa raíz. Las posibilidades a comprobar son: formato no reconocido, respuesta truncada, jerarquía inválida, reparación rechazada por sus controles o error durante la reparación. El contador `46.043 / 300.000` de la captura no demuestra agotamiento del contexto.

La etapa «Preparación» podría no representar el punto real del fallo. Es una observación pendiente de investigación, no una autorización para modificar la interfaz.

## 2. Instrucción para Claude: alcance obligatorio

Investiga y corrige exclusivamente el rechazo HITO/HU descrito en este documento. La lectura del repositorio está permitida para entender dependencias; las escrituras deben limitarse al mínimo necesario.

Lista inicial permitida para cambios:

- `apps/ai-analysis-service/src/execution/local-only-v2-sequential-block-generator.ts`.
- Un nuevo archivo de pruebas de regresión específico en `tests/ai-analysis/`.
- Este documento, únicamente para registrar evidencia y resultados.

Si la causa exige editar otro archivo, primero explica el archivo exacto, la razón y el cambio propuesto; solicita autorización del usuario antes de ampliar esta lista. No modifiques otro componente solo por estar relacionado.

Restricciones:

- Preserva todos los cambios previos, incluidos archivos sin seguimiento. El repositorio ya contiene numerosos cambios; no atribuyas esos cambios a esta reparación.
- No uses reset, restore, checkout de archivos, clean, stash ni borrados para dejar limpio el repositorio. No hagas commits, despliegues ni publicaciones.
- No refactorices módulos, renombres archivos ni ejecutes formateadores o correcciones automáticas globales.
- No alteres interfaz, discusión, prototipos, imágenes, proveedores de nube, otros servicios, contratos compartidos, infraestructura, dependencias, archivos de bloqueo, variables de entorno, credenciales o migraciones.
- Respeta `docs/architecture/local-only-v2-protected-boundaries.json`. No actualices sus hashes ni las pruebas de protección para ocultar cambios. Su baseline histórico no sustituye la captura del estado actual.
- No cambies de modelo o proveedor ni actives IA de nube. No aumentes presupuestos, tiempos o reintentos sin evidencia y autorización si requiere ampliar el alcance.
- No desactives validaciones, inventes HU, devuelvas éxito vacío ni elimines hitos, historias o requisitos no funcionales para conseguir que pase la validación.
- No escribas en bases de datos ni relances el proyecto real como parte de esta tarea. Usa pruebas aisladas; una verificación con datos reales requerirá autorización específica.

Estas instrucciones delimitan el trabajo, pero no constituyen un bloqueo técnico del sistema de archivos. Verifica las escrituras efectivas al terminar.

## 3. Procedimiento de reparación

1. Lee las instrucciones del repositorio aplicables. Registra el estado inicial y una referencia del contenido de los archivos que vayas a tocar. Captura también un inventario de hashes del código/configuración y archivos sin seguimiento relevantes, guardado fuera del árbol del proyecto, para detectar cambios fuera del alcance. Un simple `git diff` no distingue modificaciones previas de las nuevas.
2. Sigue el flujo de `output.content`, `classifyMilestonesContent` y `repairPreservesExistingMilestonesElements`. Lee el prompt, el esquema de transporte, el parser y las pruebas existentes. No añadas un segundo mecanismo de reparación sin revisar el que ya existe.
3. Busca registros disponibles en modo lectura. Identifica qué recibió el clasificador y por qué la reparación no se aceptó. No vuelques fuentes completas, datos personales ni credenciales en registros o en este documento. Si no hay registros, reproduce las condiciones con un cliente simulado y declara esa limitación.
4. Escribe primero una prueba que reproduzca el defecto confirmado. Distingue un contenido válido con variaciones de presentación de uno cuya jerarquía realmente está rota.
5. Implementa el cambio mínimo según la evidencia: alinear el prompt con el formato que realmente consume el parser, corregir una validación errónea o normalizar únicamente variaciones seguras. Conserva campos, relaciones y trazabilidad. Si el arreglo requiere tocar el parser en otro archivo, solicita la ampliación concreta del alcance.
6. Reutiliza la reparación existente y mantén sus límites. Si es necesario para explicar el fallo, añade diagnóstico acotado del motivo de rechazo o excepción, sin contenido sensible. Respeta cancelaciones y no escondas errores como éxitos.
7. No soluciones el síntoma del 10 % cambiando porcentajes arbitrarios. Documenta por separado cualquier defecto de progreso; cambios de interfaz o de orquestación fuera de la lista requieren autorización.

## 4. Validación y criterios de aceptación

Ejecuta las pruebas pertinentes usando los scripts y convenciones ya existentes, sin instalar ni actualizar dependencias. Si necesitas documentación de APIs o herramientas, consulta Context7 conforme a las instrucciones del repositorio.

Comprueba como mínimo:

- Estructura HITO/HU válida aceptada, con su contenido intacto.
- Caso exacto del defecto reproducido y corregido.
- Contenido sin estructura reconocible rechazado sin generar éxito ficticio.
- Jerarquía corrupta rechazada.
- HU incompleta tratada según el contrato existente de documentación pendiente.
- Reparación válida aceptada y reparación que elimina elementos rechazada.
- Error o cancelación durante reparación manejados sin ocultar el fallo ni continuar indebidamente.

Ejecuta las pruebas existentes pertinentes de contrato secuencial, reparación localizada y límites protegidos. Si hay fallos previos, identifícalos sin corregir componentes ajenos. No afirmes haber validado persistencia o ejecución real si solo se ejecutaron pruebas unitarias.

Al finalizar, compara el estado y los hashes con la referencia inicial. Solo deben existir cambios nuevos en la lista permitida. Si aparecen cambios concurrentes ajenos, informa y no los reviertas. Revisa el contenido del diff propio, no solamente los nombres de archivos.

## 5. Entrega requerida

Registra causa confirmada y evidencia, cambio aplicado, archivos y fragmentos modificados, pruebas ejecutadas con sus resultados y limitaciones pendientes. Confirma explícitamente que no alteraste archivos fuera del alcance ni modificaciones previas. Si no pudiste reproducir el fallo real, no declares resuelto el incidente únicamente porque una prueba simulada pase.

## 6. Estado de esta entrega documental

En la entrega inicial se creó únicamente este archivo. Posteriormente el usuario autorizó orquestar el análisis y la ejecución de la reparación. El resultado de esa ejecución se registra a continuación.

## 7. Reparación ejecutada y revisada

Defecto confirmado mediante reproducción aislada: `requirementsFromText`, en `local-only-v2-section-content.ts`, acepta prefijos de lista (`-`, `*`, `•`, `1.`, `1)`), pero los cuatro recorridos del generador que validan y protegen el contenido no aplicaban esa misma interpretación. Una salida válida con viñetas podía disparar el rechazo de Requerimientos. Además, los controles de conservación podían no reconocer elementos anteriores con viñetas y aceptar una reparación que perdiera campos, criterios de aceptación o identidad de una HU.

Se añadió el helper local `milestonesContractLines` en el generador, reutilizado por la validación, clasificación, conteo estructural y extracción de campos protegidos. Replica el prefijo ya aceptado por el ensamblador. Solo normaliza la interpretación de líneas: no cambia el texto original, no inventa datos ni relaja la jerarquía. No se modificó el ensamblador ni se añadieron llamadas o reintentos al modelo.

Archivos intervenidos:

- `apps/ai-analysis-service/src/execution/local-only-v2-sequential-block-generator.ts`: helper y cuatro puntos de uso.
- `tests/ai-analysis/local-only-v2-milestones-list-prefix.test.ts`: nuevo archivo de regresión.
- Este documento: registro de resultados.

Validación:

- Antes de corregir: 9 fallos entre 18 pruebas nuevas, demostrando rechazo de prefijos válidos, rechazo de HU pendiente y aceptación indebida de reparaciones destructivas.
- Después de corregir: 19/19 pruebas nuevas aprobadas, incluida una prueba adicional de prefijos mixtos.
- Conjunto pertinente: 109/109 pruebas aprobadas, sin omisiones, de presupuesto de inferencia, reparación localizada, contrato secuencial, contenido de secciones y regresión nueva.
- Se comprobó conservación de campos e identidad, rechazo de contenido sin estructura y jerarquías corruptas, documentación pendiente, error y cancelación de reparación.
- La prueba de fronteras protegidas dio 2 aprobadas y 1 fallida por diferencias preexistentes del inventario contra el manifiesto histórico. Se ejecutó antes del cambio de producción; no se modificó el manifiesto ni se ocultó el fallo.

Comando del conjunto aprobado:

```sh
TSX_TSCONFIG_PATH=apps/ai-analysis-service/tsconfig.app.json node --import tsx --test tests/ai-analysis/local-only-v2-inference-budget.test.ts tests/ai-analysis/local-only-v2-localized-repair.test.ts tests/ai-analysis/local-only-v2-sequential-block-contract.test.ts tests/ai-analysis/local-only-v2-section-content.test.ts tests/ai-analysis/local-only-v2-milestones-list-prefix.test.ts
```

Se capturó una referencia inicial de 2.823 archivos (seguidos y no ignorados sin seguimiento), con hashes y copia del generador en `/tmp/rq-hito-baseline`. La comparación final confirmó únicamente los tres archivos indicados, sin eliminaciones. Los cambios previos se conservaron; no se alteraron configuración, dependencias ni datos. Esta comprobación no cubre archivos ignorados por Git.

Limitaciones: los dos registros locales consultados no contenían el mensaje ni la respuesta original del incidente. Se corrigió una incompatibilidad demostrable, pero no puede afirmarse que fuera la causa de la captura. No se ejecutó generación contra Ollama real, no se verificó persistencia, no se desplegó ni reinició ningún servicio. El comportamiento del progreso al 10 % queda fuera de esta reparación. Los resultados de pruebas aisladas no garantizan por sí solos el éxito de una nueva ejecución real.
