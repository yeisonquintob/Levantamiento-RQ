# Catálogo de campos

## Convenciones

- Los identificadores técnicos no se muestran en el documento.
- Los campos visibles conservan los nombres del estándar.
- Un dato desconocido no se completa por inferencia.
- Los valores faltantes se representan como `[PENDIENTE POR DEFINIR]`.

## 1. Encabezado

| Campo técnico | Campo visible | Tipo | Regla |
|---|---|---|---|
| title | Título | Texto | Obligatorio |
| projectCode | Código | Texto | Obligatorio |
| documentVersion | Versión | SemVer | Obligatorio |
| createdDate | Fecha de creación | Fecha | Obligatorio |
| requestingArea | Área solicitante | Texto | Obligatorio |
| status | Estado | Catálogo | BORRADOR, EN VALIDACIÓN o APROBADO |

## 2. Objetivos

| Campo técnico | Campo visible | Tipo | Regla |
|---|---|---|---|
| generalObjective | Objetivo general | Párrafo | Un solo resultado principal |
| specificObjectives | Objetivos específicos | Lista | Cada elemento inicia con infinitivo |

## 3. Problema

| Campo técnico | Campo visible | Tipo | Regla |
|---|---|---|---|
| currentState | Estado actual | Texto | Describe proceso, actores y sistemas |
| operationalImpact | Impacto operacional | Lista | Solo impactos sustentados |

## 4. Alcance

| Campo técnico | Campo visible | Tipo | Regla |
|---|---|---|---|
| includedScope | Incluye | Lista | Elementos dentro del alcance |
| excludedScope | No incluye | Lista | Exclusiones explícitas |
| involvedSystems | Sistemas o fuentes | Lista | ERP, CRM, archivos, bases u otros |

## 5. Solución propuesta del profesional de soluciones

| Campo técnico | Campo visible | Tipo | Regla |
|---|---|---|---|
| objective | Objetivo | Texto | Breve y respaldado por las fuentes |
| description | Descripción breve | Párrafo | Explica la solución sin inventar definiciones |
| involvedElements | Elementos involucrados | Lista | Sistemas, módulos, datos o procesos relevantes |
| flowAlignment.currentState | Estado actual · AS-IS | Texto | Corresponde al diagrama actual |
| flowAlignment.evaluation | Evaluación | Texto | Explica la decisión técnica o funcional |
| flowAlignment.expectedResult | Resultado · TO-BE | Texto | Corresponde al diagrama esperado |

## 6. Diagrama

| Campo técnico | Campo visible | Tipo | Regla |
|---|---|---|---|
| processFlow | Diagrama de flujo | Diagrama | Incluye actores, actividades y decisiones |
| flowNotation | Notación | Catálogo | Mermaid, BPMN simplificado o imagen |

## 7. Requerimientos

| Campo técnico | Campo visible | Tipo | Regla |
|---|---|---|---|
| milestoneNumber | Número del hito | Entero | Secuencial |
| milestoneName | Nombre | Texto | Obligatorio |
| description | Descripción | Texto | Compacta |
| keyActivities | Actividades clave | Lista | Solo actividades relevantes |
| userStoryCode | Historia de usuario | Código | Formato HU-XX |
| userRole | Como | Texto | Actor real |
| desiredCapability | Quiero | Texto | Una necesidad principal |
| expectedBenefit | Para | Texto | Beneficio verificable |
| acceptanceCriteria | Criterios | Lista numerada | Resultados verificables |
| businessRules | Reglas de negocio | Lista | Reglas sustentadas |
| requiredFields | Campos requeridos | Tabla | Campo, tipo, obligatoriedad y validación |

Los requerimientos funcionales y no funcionales se presentan en esta sección.
Cada requerimiento no funcional conserva categoría, descripción, medida,
objetivo verificable, prioridad y fuente de verificación.

## 8. Esquema

Organiza el backlog canónico como Epic, Feature, Historia de Usuario y Tarea.

## 9. Pruebas

| Campo técnico | Campo visible | Tipo | Regla |
|---|---|---|---|
| testObjective | Objetivo de pruebas | Texto | Qué debe validarse |
| testScenarios | Escenarios mínimos | Lista numerada | Incluye escenarios aplicables |

## 10. Supuestos, dependencias y pendientes

| Campo técnico | Campo visible | Tipo | Regla |
|---|---|---|---|
| assumptions | Supuestos | Lista | Confirmado o pendiente |
| dependencies | Dependencias | Lista | Sistema, área, proveedor o dato |
| pendingItems | Pendientes | Lista | Usa marcador obligatorio si falta definición |

## 11. Aprobaciones y cambios

| Campo técnico | Campo visible | Tipo | Regla |
|---|---|---|---|
| approvals | Aprobaciones | Tabla | Elaboración: responsable autenticado; revisión: su líder; aprobación: solicitante o su líder. El actor real se registra al ejecutar cada transición |
| changeControl | Control de cambios | Tabla | Máximo un registro compacto por versión; se crea únicamente al aprobar un cambio, nunca al generar con IA |

## 12 a 14

Las secciones 12, 13 y 14 pertenecen a la plantilla canónica. Se incluyen
en cada exportación y no son reescritas libremente por la IA.
