# ADR-0022: Sources Service y fuentes textuales

## Estado

Aceptada.

## Contexto

La plataforma necesita reunir evidencias antes de generar análisis o
documentos. Estas fuentes pertenecen a un proyecto, pero no deben quedar
almacenadas en la base de Projects Service ni crear dependencias entre bases.

## Decisión

Sources Service será propietario de `RqSourcesDb`.

En el Paso 13.1 se implementan notas, conversaciones y transcripciones. La
carga binaria queda separada para el Paso 13.2 porque requiere definir el
contrato de almacenamiento, límites, antivirus, extracción y referencias de
Azurite/Azure Blob Storage.

`ProjectId` se conservará como identificador externo sin clave foránea.
Sources Service validará el acceso consultando la API de Projects Service con
el mismo access token recibido.

Solo `ADMIN`, `OWNER` y `EDITOR` podrán modificar fuentes. `REVIEWER` y
`VIEWER` tendrán acceso de lectura.

## Consecuencias

- Se respeta la propiedad de datos por servicio.
- El frontend continúa consumiendo únicamente el Gateway.
- Sources Service depende de la disponibilidad de Projects Service para
  autorizar operaciones.
- El contenido textual queda listo para un análisis posterior, pero no activa
  inteligencia artificial automáticamente.
- Los archivos físicos aún no se almacenan.
