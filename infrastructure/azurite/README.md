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

Sources Service crea bajo demanda el contenedor privado `rq-sources`.
Los archivos se organizan por `projectId/sourceId/hash.ext` y solamente se
descargan después de validar la sesión y el acceso al proyecto. La cadena de
conexión permanece en archivos `.env` ignorados por Git.
