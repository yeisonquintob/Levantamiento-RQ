# ESTÁNDAR COMPACTO PARA LEVANTAMIENTO DE REQUERIMIENTOS

Alineado con ISO/IEC/IEEE 29148:2018  
Versión: 1.0.0

======================================================================
## 1. ENCABEZADO DEL DOCUMENTO
======================================================================

**Título:**  
LEVANTAMIENTO DE REQUERIMIENTOS – [NOMBRE DEL PROYECTO]

**Código:** [CÓDIGO]  
**Versión:** [X.X.X]  
**Fecha de creación:** [DD/MM/AAAA]  
**Área solicitante:** [ÁREA]  
**Elaborado por:** [NOMBRE Y CARGO]  
**Revisado por:** [NOMBRE Y CARGO]  
**Aprobado por:** [NOMBRE Y CARGO]  
**Estado:** [BORRADOR / EN VALIDACIÓN / APROBADO]

======================================================================
## 2. OBJETIVOS DEL PROYECTO
======================================================================

### 2.1. Objetivo general

[Describir en un párrafo qué se quiere lograr, para quién y con qué propósito.]

### 2.2. Objetivos específicos

- [Objetivo específico 1]
- [Objetivo específico 2]
- [Objetivo específico 3]

**Regla:**  
Los objetivos deben iniciar con un verbo en infinitivo y expresar resultados.

======================================================================
## 3. DESCRIPCIÓN DEL PROBLEMA
======================================================================

### 3.1. Estado actual

[Explicar cómo se realiza actualmente el proceso, quién participa, qué sistemas
o archivos se utilizan y dónde se presentan dificultades.]

### 3.2. Impacto operacional

- [Tiempo invertido]
- [Errores o reprocesos]
- [Falta de trazabilidad]
- [Demoras]
- [Riesgos para la operación]

======================================================================
## 4. ALCANCE
======================================================================

### 4.1. Incluye

- [Proceso, funcionalidad, área, sistema o usuario incluido]

### 4.2. No incluye

- [Elemento expresamente fuera de alcance]

### 4.3. Sistemas o fuentes involucradas

- [ERP]
- [CRM]
- [Archivos]
- [Base de datos]
- [Otro]

======================================================================
## 5. DIAGRAMA DE FLUJO
======================================================================

Insertar un diagrama sencillo del proceso:

```text
INICIO → ACTIVIDAD → VALIDACIÓN → DECISIÓN → RESULTADO → FIN
```

El diagrama debe mostrar:

- Actor o responsable.
- Actividades principales.
- Decisiones.
- Entradas y salidas.
- Sistemas involucrados.

======================================================================
## 6. REQUERIMIENTOS POR HITO O FUNCIONALIDAD
======================================================================

Repetir la siguiente estructura para cada hito o funcionalidad.

----------------------------------------------------------------------
### HITO [NÚMERO]: [NOMBRE]
----------------------------------------------------------------------

**Descripción:**

[Explicar brevemente qué debe lograrse.]

**Actividades clave:**

- [Actividad 1]
- [Actividad 2]
- [Actividad 3]

**Historia de usuario [HU-XX]:**

Como [tipo de usuario],  
Quiero [funcionalidad o necesidad],  
Para [beneficio esperado].

**Criterios de aceptación:**

1. [Resultado verificable]
2. [Validación esperada]
3. [Restricción o condición]
4. [Resultado final]

**Reglas de negocio:**

- [Regla 1]
- [Regla 2]

**Campos o datos requeridos:**

| Campo | Tipo | Obligatorio | Validación u observación |
|---|---|---|---|
|  |  | Sí / No |  |

======================================================================
## 7. REQUERIMIENTOS NO FUNCIONALES
======================================================================

Registrar únicamente los que apliquen.

**Seguridad:**

- Solo usuarios autorizados podrán acceder.
- Los permisos dependerán del rol asignado.

**Trazabilidad:**

- Registrar usuario, fecha, hora y acción realizada.

**Rendimiento:**

- [Tiempo máximo de respuesta o volumen esperado.]

**Compatibilidad:**

- [Web / Android / iOS / escritorio.]

**Disponibilidad:**

- [Horario o porcentaje requerido.]

**Usabilidad:**

- La navegación debe ser clara y los mensajes deben indicar qué debe hacer el usuario.

======================================================================
## 8. PRUEBAS
======================================================================

### 8.1. Objetivo de pruebas

[Explicar qué se debe validar antes de aprobar la solución.]

### 8.2. Escenarios mínimos

1. Flujo exitoso.
2. Campos obligatorios incompletos.
3. Datos inválidos.
4. Usuario sin permisos.
5. Fallo de integración o fuente.
6. Corrección antes de guardar.
7. Confirmación del registro.
8. Validación de trazabilidad.

======================================================================
## 9. SUPUESTOS, DEPENDENCIAS Y PENDIENTES
======================================================================

**Supuestos:**

- [Supuesto confirmado o pendiente]

**Dependencias:**

- [Sistema, área, proveedor, dato o aprobación necesaria]

**Pendientes:**

- [Información que aún debe ser definida]

**Regla:**  
No inventar información. Cuando no exista definición, escribir:  
`[PENDIENTE POR DEFINIR]`

======================================================================
## 10. APROBACIONES Y CONTROL DE CAMBIOS
======================================================================

### CONTROL DE CAMBIOS

| Versión | Fecha | Modificación | Aprobó |
|---|---|---|---|
|  |  |  |  |

### APROBACIONES

| Rol | Nombre | Cargo | Fecha | Estado |
|---|---|---|---|---|
| Elaboró |  |  |  |  |
| Revisó |  |  |  |  |
| Aprobó |  |  |  |  |

======================================================================
## 11. REGLAS DE REDACCIÓN
======================================================================

- Usar español formal y claro.
- Mantener la misma numeración en todo el documento.
- Usar frases cortas.
- No repetir información.
- No utilizar “etc.” en los requerimientos.
- No usar términos ambiguos como “rápido”, “fácil” o “varios” sin explicar.
- Para requerimientos usar: “El sistema deberá...”.
- Para historias de usuario usar: “Como..., quiero..., para...”.
- Para criterios de aceptación usar resultados verificables.
- Un requerimiento debe expresar una sola necesidad principal.
- No mezclar funcionalidades de fases futuras con el alcance actual.

======================================================================
## 12. FORMATO VISUAL RECOMENDADO
======================================================================

**Fuente:**  
Arial, Aptos o fuente corporativa.

**Tamaños:**

- Título principal: 16 puntos.
- Título de capítulo: 13 o 14 puntos.
- Subtítulo: 11 o 12 puntos.
- Texto: 10,5 u 11 puntos.
- Tablas: 9 o 10 puntos.

**Configuración:**

- Interlineado: 1,15.
- Márgenes: 2,5 cm.
- Títulos en negrita.
- Texto alineado a la izquierda.
- Encabezado con título, código y versión.
- Pie de página con número de página.
- Tablas con encabezado visible.
- Utilizar la identidad visual corporativa sin recargar el documento.

======================================================================
## 13. INSTRUCCIÓN PARA AUTOMATIZACIÓN
======================================================================

Analiza la información suministrada y genera un documento usando exactamente
esta estructura.

**Reglas obligatorias:**

1. No inventar información.
2. Mantener los nombres de áreas, sistemas, campos y responsables.
3. Separar objetivo, problema, alcance, requerimientos y pruebas.
4. Organizar las funcionalidades por hitos.
5. Crear historias de usuario con formato Como / Quiero / Para.
6. Crear criterios de aceptación verificables.
7. Incluir reglas de negocio y campos cuando apliquen.
8. Marcar la información faltante como `[PENDIENTE POR DEFINIR]`.
9. No aprobar automáticamente el documento.
10. Mantener un estilo compacto, sin explicaciones extensas ni secciones innecesarias.

======================================================================
## FIN DEL ESTÁNDAR
======================================================================
