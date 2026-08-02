# Identidad, autenticación y autorización base

## Objetivo

El Paso 10 incorpora la primera capacidad funcional de identidad de
Levantamiento RQ sin crear usuarios predeterminados ni almacenar secretos en
Git.

## Flujo

1. El navegador consume únicamente el Gateway.
2. El Gateway envía las credenciales a Identity Service.
3. Identity Service valida el usuario contra RqIdentityDb.
4. La contraseña se verifica mediante scrypt con sal aleatoria.
5. Identity Service emite un access token y un refresh token.
6. El Gateway conserva ambos tokens en cookies HttpOnly.
7. El frontend protege el workspace mediante la existencia de la cookie de
   acceso.
8. Cada autorización real se valida nuevamente en backend.

## Persistencia

Identity Service es propietario exclusivo de:

- IdentityUsers
- IdentityRoles
- IdentityPermissions
- IdentityUserRoles
- IdentityRolePermissions
- IdentityRefreshSessions

La migración inicial se encuentra en
`apps/identity-service/src/database/migrations`.

No existen claves foráneas hacia bases de otros servicios.

## Seguridad

- No se almacenan contraseñas en texto plano.
- Los refresh tokens se almacenan mediante SHA-256.
- Los refresh tokens se rotan en cada renovación.
- Los usuarios inactivos son rechazados.
- Los errores de credenciales no revelan si el correo existe.
- Los secretos JWT se reciben por variables de entorno.
- El Gateway no tiene base de datos.
- El frontend no guarda tokens en localStorage.
- Las cookies son HttpOnly y SameSite=Lax.
- `AUTH_COOKIE_SECURE=true` es obligatorio bajo HTTPS.

## Configuración

La autenticación queda deshabilitada por defecto. Para habilitarla se requiere:

- `DATABASE_ENABLED=true`
- conexión válida a `RqIdentityDb`
- `AUTH_ENABLED=true`
- secretos JWT distintos de mínimo 32 caracteres

## Comandos

```bash
pnpm test:auth
pnpm validate:auth
```

Para un entorno con SQL Server configurado:

```bash
pnpm identity:migration:run
IDENTITY_USER_EMAIL=analista@empresa.com IDENTITY_USER_NAME="Analista" IDENTITY_USER_PASSWORD="una-clave-segura" pnpm identity:create-user
```

El script del Paso 10 no aplica migraciones ni crea usuarios reales porque no
dispone de credenciales empresariales.
