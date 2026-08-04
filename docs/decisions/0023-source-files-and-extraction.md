# ADR-0023: Archivos de fuentes y extracción controlada

## Estado

Aceptada.

## Contexto

Las fuentes textuales del Paso 13.1 no cubren documentos, hojas de cálculo ni
evidencias visuales. Los binarios no deben almacenarse dentro de SQL Server ni
exponerse directamente mediante URLs públicas.

## Decisión

Sources Service será propietario del registro de metadatos en `RqSourcesDb` y
del contenido binario en Azure Blob Storage. Durante desarrollo se utilizará
Azurite y el contenedor privado `rq-sources`.

El Gateway aceptará cargas multipart y reenviará los archivos al servicio.
Sources Service aplicará límites, catálogo cerrado, validación de firma,
SHA-256 y acceso por proyecto antes de persistir.

La extracción inicial será síncrona:

- PDF mediante `unpdf`;
- DOCX mediante `mammoth`;
- XLSX mediante `exceljs` y CSV como texto UTF-8;
- TXT como UTF-8;
- imágenes como evidencia sin OCR.

El navegador nunca recibirá la cadena de conexión ni una ruta directa al
Blob. Las descargas se resolverán nuevamente por Gateway y Sources Service.

## Consecuencias

- la base conserva solo metadatos y texto extraído;
- un archivo activo duplicado por hash y proyecto será rechazado;
- archivar no elimina inmediatamente el Blob;
- los errores de extracción conservan el archivo para permitir reprocesar;
- el escaneo antimalware deberá integrarse con un servicio aprobado antes de
  producción;
- el procesamiento podrá moverse a BullMQ sin cambiar las rutas públicas.
