# Sources Service, archivos y extracción

## Alcance del Paso 13

Sources Service administra todas las fuentes previas al análisis:

- notas;
- conversaciones;
- transcripciones;
- carga múltiple de archivos;
- almacenamiento privado en Azurite/Azure Blob Storage;
- hash SHA-256 y prevención de duplicados activos por proyecto;
- extracción de contenido;
- estado de procesamiento;
- descarga protegida;
- reprocesamiento;
- trazabilidad y archivado lógico.

Este paso no conecta OpenAI, Documents Service ni Workflow Service.

## Propiedad de datos

Sources Service es propietario exclusivo de `RqSourcesDb`, la tabla
`dbo.Sources` y el contenedor Blob `rq-sources`.

`ProjectId` es una referencia externa. No existe una clave foránea hacia
`RqProjectsDb`. El servicio confirma el acceso mediante la API de Projects
Service.

## Control de acceso

1. El Gateway obtiene la cookie HttpOnly o un Bearer controlado.
2. El Gateway reenvía el access token a Sources Service.
3. Sources Service valida el JWT.
4. Sources Service consulta `GET /api/v1/projects/{projectId}`.
5. `ADMIN`, `OWNER` y `EDITOR` pueden crear, cargar, actualizar, reprocesar y
   archivar.
6. `REVIEWER` y `VIEWER` pueden consultar y descargar.

## Formatos

| Formato | Almacenamiento | Extracción |
|---|---|---|
| PDF | Sí | Texto y número de páginas |
| DOCX | Sí | Texto sin formato |
| XLSX | Sí | Hojas convertidas a contenido tabular |
| CSV | Sí | Contenido tabular |
| TXT | Sí | Texto UTF-8 |
| PNG/JPG/JPEG/WEBP | Sí | Evidencia visual, sin OCR |

Límites locales predeterminados:

- 20 archivos por operación;
- 20 MB por archivo;
- 100 MB por lote;
- 2.000.000 de caracteres extraídos por fuente.

Los límites se configuran mediante variables de entorno y también se aplican
en el Gateway.

## Validación y seguridad

- extensiones permitidas mediante catálogo cerrado;
- firma básica del formato antes de almacenar;
- texto TXT/CSV válido en UTF-8;
- nombre normalizado;
- hash SHA-256;
- índice único filtrado para impedir archivos activos duplicados por proyecto;
- rutas Blob generadas por el servidor;
- contenedor sin URL pública ni SAS entregado al navegador;
- descarga autorizada por Gateway y Sources Service.

La validación de firma no reemplaza un motor antimalware empresarial. Esa
integración requerirá un servicio de escaneo aprobado para el ambiente de
despliegue.

## Procesamiento

Estados:

```text
PENDING → PROCESSING → READY
                     ↘ FAILED
```

La extracción se ejecuta dentro de Sources Service en esta versión. Los
trabajos podrán migrarse a BullMQ cuando el volumen requiera procesamiento
asíncrono, sin cambiar el contrato público de las fuentes.

## API

- `GET /api/v1/projects/{projectId}/sources/summary`
- `GET /api/v1/projects/{projectId}/sources`
- `POST /api/v1/projects/{projectId}/sources`
- `POST /api/v1/projects/{projectId}/sources/files`
- `GET /api/v1/projects/{projectId}/sources/{sourceId}`
- `GET /api/v1/projects/{projectId}/sources/{sourceId}/download`
- `POST /api/v1/projects/{projectId}/sources/{sourceId}/reprocess`
- `PATCH /api/v1/projects/{projectId}/sources/{sourceId}`
- `DELETE /api/v1/projects/{projectId}/sources/{sourceId}`

El frontend consume las rutas por medio del Gateway.

## Persistencia

- `CreateSourcesFoundation1785801600000`
- `AddSourceFilesAndExtraction1785888000000`

La segunda migración incorpora mensaje y fecha de procesamiento, extensión,
páginas, hojas, índice de procesamiento e índice único por hash. No crea
relaciones entre bases.

## Interfaz

`/workspace/sources` mantiene un único botón `Nueva fuente` con dos modos:

- fuente textual;
- subir varios archivos.

Los KPI y el botón aparecen antes del selector de proyecto. La vista permite
filtrar por tipo, procesamiento y estado; ver detalle y texto extraído;
descargar, reprocesar y archivar.
