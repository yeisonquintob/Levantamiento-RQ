# Plan para definir la estructura documental

## Momento de definición

```text
Paso 3.1 — Diseñar estructura documental y plantillas
```

Este subpaso se ejecutará después de aprobar la arquitectura y antes de
crear infraestructura, bases de datos o el Documents Service.

## El modelo determinará

- Entidades y relaciones de Documents Service.
- Contratos HTTP.
- Esquemas JSON para la IA.
- Reglas de validación.
- Versionamiento.
- Editor frontend.
- Generación de PDF.
- Trazabilidad.
- Flujo de aprobación.

## Elementos que se definirán

### Plantilla

Nombre, código, descripción, tipo, estado, versión, publicación y
organización propietaria.

### Sección

Código, nombre, descripción, orden, obligatoriedad, repetición y
condiciones de visibilidad.

### Campo

Código, etiqueta, descripción, tipo, obligatoriedad, edición,
repetición, catálogo, longitud, validaciones, instrucción para IA,
permiso, evidencia y participación en PDF.

### Contenido

Valor, origen, estado, autor, fecha, evidencias, confianza de IA,
comentarios, historial, aprobación y bloqueo.

### Requerimientos

Código, nombre, descripción, actor, precondiciones, flujo, excepciones,
reglas, criterios de aceptación, prioridad, evidencias, clasificación
fit-gap e impacto ERP.

## Principios ya aprobados

- Plantillas configurables.
- Versiones publicadas inmutables.
- Documento vinculado a una versión de plantilla.
- Campos obligatorios u opcionales.
- IA con salida JSON estructurada.
- IA sin modificación de contenido aprobado.
- Evidencias relacionadas con afirmaciones importantes.
- Documento editable antes de exportar.
- Trazabilidad de cambios.
- PDF generado desde una versión específica.

## Fuera del alcance del Paso 3

No se definirán todavía las secciones, campos, orden final, diseño visual
del PDF, catálogos ni reglas específicas de cada plantilla.
