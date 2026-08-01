# Azurite

Azurite emula Azure Blob, Queue y Table Storage durante el desarrollo
local. Azure Blob Storage será el servicio previsto para producción.

## Configuración inicial

- Imagen: `mcr.microsoft.com/azure-storage/azurite:3.36.0`.
- Blob: `127.0.0.1:10000`.
- Queue: `127.0.0.1:10001`.
- Table: `127.0.0.1:10002`.
- Datos persistentes en un volumen Docker.
- Telemetría deshabilitada para la instancia local.

La cuenta `devstoreaccount1` y su clave conocida pertenecen únicamente
al emulador. No sirven para una cuenta productiva de Azure Storage.

En esta etapa no se crean contenedores Blob ni se cargan archivos.
