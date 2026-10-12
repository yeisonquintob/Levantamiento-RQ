# Integración y E2E con servicios reales en CI

El job `integration-e2e` de `.github/workflows/ci.yml` levanta el stack completo en un runner limpio y ejecuta:

1. `pnpm test:integration` — verificación real contra los servicios levantados:
   - Bases de datos de Identity, Projects, Sources, Documents, Workflow, AI Analysis, Operations y Prototypes (migraciones aplicadas, tablas, índices, claves foráneas y ausencia de secretos).
   - Almacenamiento (Azurite) y colas (Redis) de Sources.
   - RabbitMQ: entrega de un evento persistente y versionado conservando `correlationId`, productor y clave de enrutamiento (`events:rabbitmq:smoke`).
2. `pnpm swagger:validate` en modo `SWAGGER_USE_RUNNING=1` — el contrato OpenAPI y la interfaz Swagger de los ocho servicios con API, sobre los servicios ya levantados. Antes era un job aparte con la base de datos desactivada, pero los servicios con persistencia solo registran sus rutas con ella activa, así que ese job nunca podía pasar.
3. `pnpm test:integration:prototypes` — la generación de imágenes con servicios reales (SQL Server, BullMQ/Redis y Azurite; solo el proveedor de IA es simulado, con una cola y un contenedor propios por ejecución): generar, detener→reintentar y detener→importar con un trabajo antiguo que termina tarde, eliminar durante la generación, reemplazar una imagen cuatro veces y el reconciliador de archivos huérfanos.
4. `pnpm test:e2e:v1` — recorrido completo por el gateway: login, proyecto, documento, exportación PDF/DOCX, auditoría y notificaciones.
5. Playwright con sesión real (`login` y `chromium`) sobre datos creados por `documents:editor:e2e:fixture`.

## Cómo se levanta (`scripts/ci-stack-up.sh`)

- `scripts/ci-prepare-env.mjs` genera `infrastructure/docker/.env` y `apps/*/.env` a partir de los `.env.example`. Nunca sobrescribe un `.env` existente salvo con `--force`.
- Redis, RabbitMQ y Azurite arrancan con `scripts/infrastructure-up.sh`. SQL Server arranca en un contenedor efímero del propio job.
- Se crean las bases y se aplican las migraciones de identity, projects, sources, documents, ai, workflow y operations. La creación de cada base se autoriza solo dentro del script (`*_CREATE_DATABASE`).
- Se crea un administrador de prueba con `identity:bootstrap-admin` y se arranca todo con `scripts/local-auth-up.sh`.

## Credenciales

Contraseña de SQL Server y del usuario E2E se generan en cada ejecución (`openssl rand`), se enmascaran en los registros y no se guardan. El correo es `e2e-admin@example.test`.

## Probarlo en local

No uses tu entorno de desarrollo: el script escribe `.env` y crea bases. En un clon limpio, con Docker y un SQL Server accesible:

```bash
export CI_SQL_PASSWORD='…' E2E_EMAIL=e2e-admin@example.test E2E_PASSWORD='…'
bash scripts/ci-stack-up.sh
```

Los puertos 3000–3009 y 4200 deben estar libres.
