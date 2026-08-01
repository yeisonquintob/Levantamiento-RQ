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
| preparedBy | Elaborado por | Persona y cargo | Obligatorio |
| reviewedBy | Revisado por | Persona y cargo | Pendiente hasta revisión |
| approvedBy | Aprobado por | Persona y cargo | Pendiente hasta aprobación |
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

## 5. Diagrama

| Campo técnico | Campo visible | Tipo | Regla |
|---|---|---|---|
| processFlow | Diagrama de flujo | Diagrama | Incluye actores, actividades y decisiones |
| flowNotation | Notación | Catálogo | Mermaid, BPMN simplificado o imagen |

## 6. Hitos y funcionalidades

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

## 7. No funcionales

| Campo técnico | Campo visible | Tipo | Regla |
|---|---|---|---|
| security | Seguridad | Lista | Solo si aplica |
| traceability | Trazabilidad | Lista | Usuario, fecha, hora y acción |
| performance | Rendimiento | Lista | Debe ser medible |
| compatibility | Compatibilidad | Lista | Plataformas concretas |
| availability | Disponibilidad | Lista | Horario o porcentaje |
| usability | Usabilidad | Lista | Comportamiento verificable |

## 8. Pruebas

| Campo técnico | Campo visible | Tipo | Regla |
|---|---|---|---|
| testObjective | Objetivo de pruebas | Texto | Qué debe validarse |
| testScenarios | Escenarios mínimos | Lista numerada | Incluye escenarios aplicables |

## 9. Supuestos, dependencias y pendientes

| Campo técnico | Campo visible | Tipo | Regla |
|---|---|---|---|
| assumptions | Supuestos | Lista | Confirmado o pendiente |
| dependencies | Dependencias | Lista | Sistema, área, proveedor o dato |
| pendingItems | Pendientes | Lista | Usa marcador obligatorio si falta definición |

## 10. Aprobaciones y cambios

| Campo técnico | Campo visible | Tipo | Regla |
|---|---|---|---|
| changeControl | Control de cambios | Tabla | Versión, fecha, modificación y aprobó |
| approvals | Aprobaciones | Tabla | Rol, nombre, cargo, fecha y estado |

## 11 a 13

Las secciones 11, 12 y 13 pertenecen a la plantilla canónica. Se incluyen
en cada exportación y no son reescritas libremente por la IA.
