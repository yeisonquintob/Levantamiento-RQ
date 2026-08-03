# Sources Service y fuentes textuales

## Alcance del Paso 13.1

Sources Service incorpora la primera base funcional para administrar las
fuentes de un levantamiento:

- notas;
- conversaciones;
- transcripciones;
- metadatos reservados para archivos;
- texto disponible para análisis posterior;
- hash SHA-256;
- estado de procesamiento;
- trazabilidad de creación y actualización;
- archivado lógico.

La carga binaria y el almacenamiento en Azurite se implementarán en el Paso
13.2. Este paso no conecta OpenAI, Documents Service ni Workflow Service.

## Propiedad de datos

Sources Service es propietario exclusivo de `RqSourcesDb` y de la tabla
`dbo.Sources`.

`ProjectId` es una referencia externa. No existe una clave foránea hacia
`RqProjectsDb` y Sources Service no consulta repositorios ni tablas de
Projects Service.

## Control de acceso

1. El Gateway reenvía el access token sin modificarlo.
2. Sources Service valida el JWT.
3. Sources Service consulta `GET /api/v1/projects/{projectId}`.
4. Projects Service confirma que el usuario puede consultar el proyecto.
5. Solo `ADMIN`, `OWNER` y `EDITOR` pueden crear, actualizar o archivar.
6. `REVIEWER` y `VIEWER` conservan acceso de lectura.

## API

Rutas directas del servicio:

- `GET /api/v1/projects/{projectId}/sources/summary`
- `GET /api/v1/projects/{projectId}/sources`
- `POST /api/v1/projects/{projectId}/sources`
- `GET /api/v1/projects/{projectId}/sources/{sourceId}`
- `PATCH /api/v1/projects/{projectId}/sources/{sourceId}`
- `DELETE /api/v1/projects/{projectId}/sources/{sourceId}`

El frontend utiliza las mismas rutas por medio del Gateway.

## Persistencia

La migración `CreateSourcesFoundation1785801600000` crea `dbo.Sources` con
índices por proyecto, estado, fecha de actualización, tipo y hash. No crea
relaciones entre bases.

## Interfaz

La ruta `/workspace/sources` permite:

- seleccionar un proyecto accesible;
- consultar indicadores;
- buscar y filtrar;
- registrar notas, conversaciones y transcripciones;
- editar fuentes textuales;
- archivar registros;
- volver desde la tabla de proyectos mediante el botón `Fuentes`.
