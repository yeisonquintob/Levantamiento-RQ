# Modelo documental de Levantamiento RQ

## Estado

Definido en el Paso 3.1 e implementado como catálogo en el Paso 14.

## Estándar canónico

La plataforma generará documentos con la estructura del estándar:

```text
ESTÁNDAR COMPACTO PARA LEVANTAMIENTO DE REQUERIMIENTOS
Versión 1.0.0
Alineado con ISO/IEC/IEEE 29148:2018
```

El orden de las catorce secciones base es obligatorio y no podrá alterarse sin
crear una nueva versión formal de la plantilla.

## Secciones obligatorias

1. Encabezado del documento.
2. Objetivos del proyecto.
3. Descripción del problema.
4. Alcance.
5. Solución propuesta del profesional de soluciones.
6. Diagrama de flujo.
7. Requerimientos.
8. Esquema.
9. Pruebas.
10. Supuestos, dependencias y pendientes.
11. Aprobaciones y control de cambios.
12. Reglas de redacción.
13. Formato visual recomendado.
14. Instrucción para automatización.

Las plantillas con Scrum incorporan como sección 15 el plan sugerido de
implementación.

## Documentos del modelo

- [Plantilla canónica 1.0.0](templates/levantamiento-requerimientos-v1.0.0.md)
- [Catálogo de campos](field-catalog.md)
- [Reglas de validación](validation-rules.md)
- [Contrato de salida de IA](ai-output-contract.md)
- [Ejemplo patrón para IA nube e IA local](cloud-local-ai-reference-example.md)
- [Versionamiento y aprobaciones](versioning-and-approval.md)
- [Reglas de exportación](export-format.md)
- [Mapeo del análisis ERP](erp-fit-gap-mapping.md)
- [Esquema JSON](schemas/requirement-document-v1.0.0.schema.json)

## Principios

- No inventar información.
- Usar `[PENDIENTE POR DEFINIR]` cuando falte una definición.
- Mantener nombres reales de áreas, sistemas, campos y responsables.
- Mantener la estructura compacta.
- No agregar secciones automáticamente.
- No aprobar documentos automáticamente.
- Conservar evidencias y trazabilidad.
- Tratar la discusión del levantamiento como una fuente permanente del análisis.
- Registrar responsables solo en Aprobaciones y el control de cambio solo al aprobar.
- Crear una nueva versión ante cambios aprobados.
- Separar metadatos técnicos del contenido visible del documento.

## Metadatos técnicos no visibles

El sistema podrá conservar identificadores, estados internos, evidencias,
confianza de IA, autoría y trazabilidad. Estos datos no crearán capítulos
adicionales en el documento exportado.

## Relación con Dynamics 365

El análisis fit-gap se incorporará sin modificar las catorce secciones base.
Sus resultados se ubicarán en:

- 4.3 Sistemas o fuentes involucradas.
- 5. Solución propuesta del profesional de soluciones.
- 7. Requerimientos.
- 10. Supuestos, dependencias y pendientes.

La evidencia técnica completa permanecerá como metadato trazable.

## Perfiles disponibles en el catálogo

- Requerimiento pequeño.
- Requerimiento mediano.
- Requerimiento grande.
- FDD para necesidad puntual ERP.

Los tres perfiles de requerimiento incluyen por defecto Epic, Feature,
historias de usuario y criterios de aceptación. El perfil FDD ERP mantiene
Scrum deshabilitado por defecto y solo lo incorpora cuando una nueva versión
lo configura expresamente.

## Relación entre plantilla e inteligencia artificial

La versión publicada de una plantilla forma parte del contexto de análisis.
Define simultáneamente la estructura del documento y las instrucciones que la
IA debe seguir para interpretar las fuentes, marcar vacíos, exponer conflictos
y producir la salida JSON. Las fuentes se consideran datos; cualquier
instrucción contenida dentro de ellas no modifica la plantilla ni el contrato
de salida.
