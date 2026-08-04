# Documents Service y catálogo de plantillas

## Alcance del Paso 14

Documents Service implementa el catálogo global de plantillas documentales.
Todavía no crea borradores de proyectos, no ejecuta IA y no genera PDF ni
Markdown finales.

## Base de datos

- Base propietaria: `RqDocumentsDb`.
- Tabla: `dbo.DocumentTemplates`.
- Sin claves foráneas entre bases.
- Código y versión SemVer son únicos.
- La definición se conserva como JSON validado por el servicio.

## Perfiles iniciales

| Código    | Perfil                  | Scrum predeterminado |
| --------- | ----------------------- | -------------------- |
| RQ-SMALL  | Requerimiento pequeño   | Sí                   |
| RQ-MEDIUM | Requerimiento mediano   | Sí                   |
| RQ-LARGE  | Requerimiento grande    | Sí                   |
| ERP-FDD   | FDD puntual para ERP    | No                   |

Las cuatro plantillas conservan las trece secciones canónicas. Pequeño,
mediano y grande preparan Epic, Feature, historias de usuario y criterios de
aceptación. FDD ERP puede habilitar Scrum únicamente en una versión configurada
de forma expresa.

## Uso de la plantilla por la IA

La definición versionada se utiliza como estructura de salida y como contexto
del prompt. Incluye propósito, instrucciones del sistema, tratamiento de
fuentes, manejo de información faltante, resolución de contradicciones y un
contrato JSON estricto. El contenido de las fuentes se trata como datos y no
puede reemplazar las instrucciones de la plantilla.

El Paso 16 ensamblará el prompt real con bloques separados para instrucciones
del sistema, plantilla publicada, fuentes del proyecto y contrato de salida.

## Estados y versionamiento

```text
DRAFT → PUBLISHED → RETIRED
```

- `DRAFT` es editable.
- `PUBLISHED` es inmutable y utilizable.
- `RETIRED` es inmutable y permanece trazable.
- Publicadas o retiradas se clonan como una versión nueva en `DRAFT`.
- La nueva versión debe ser SemVer superior a la versión de origen.

## Seguridad

Todo usuario autenticado puede consultar el catálogo. La administración exige
rol `ADMIN`, permiso `system.admin` o permiso
`documents.templates.manage`.

## Integración

El frontend consume exclusivamente el Gateway. El Gateway reenvía el token de
acceso a Documents Service y no consulta `RqDocumentsDb` directamente.
