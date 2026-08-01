# Redis

Redis se ejecuta mediante Docker Compose y se utilizará posteriormente
para BullMQ, caché y coordinación interna.

## Configuración inicial

- Imagen: `redis:8.2.8-alpine`.
- Puerto del contenedor: `6379`.
- Puerto local: `6381`.
- Persistencia AOF habilitada.
- Contraseña obligatoria.
- Volumen persistente administrado por Docker.

En esta etapa no se crean colas BullMQ ni claves de aplicación.
