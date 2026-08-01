# Configuración de variables de entorno

## Alcance

Las nueve aplicaciones backend utilizan la librería
`@levantamiento-rq/shared-config` para cargar archivos locales y validar la
configuración técnica mínima.

## Precedencia

1. Variables suministradas por el sistema operativo o la plataforma.
2. `apps/<servicio>/.env`.
3. `.env` en la raíz del workspace.
4. Valores técnicos predeterminados del servicio.

Las variables ya presentes en el proceso nunca son reemplazadas por archivos.

## Variables base

| Variable       | Uso                                  |
| -------------- | ------------------------------------ |
| `NODE_ENV`     | `development`, `test` o `production` |
| `SERVICE_NAME` | Nombre técnico del servicio          |
| `HOST`         | Interfaz de escucha                  |
| `PORT`         | Puerto entre 1 y 65535               |

El Gateway agrega `API_GLOBAL_PREFIX` y `APP_VERSION`.

## Seguridad

Los archivos `.env` reales permanecen fuera de Git. Solo se publican
`.env.example` sin secretos.
