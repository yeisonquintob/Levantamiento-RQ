# Activación real de identidad

## Objetivo

Conectar `identity-service` a `RqIdentityDb`, aplicar la migración inicial,
preparar la primera cuenta administradora y validar el flujo completo mediante
el Gateway y la aplicación web.

## Configuración local

Los secretos permanecen exclusivamente en archivos ignorados por Git:

- `apps/identity-service/.env`
- `apps/gateway/.env`
- `apps/web/.env.local`

El archivo de Identity Service contiene la conexión SQL, la activación de
persistencia y autenticación, y dos secretos JWT diferentes.

## Base de datos

`identity-service` conserva la propiedad exclusiva de `RqIdentityDb`.

El comando `pnpm identity:db:ensure` confirma la existencia de la base y solo
la crea cuando `IDENTITY_CREATE_DATABASE=true` ha sido autorizado
explícitamente.

Las tablas se crean mediante:

```bash
pnpm identity:migration:run
```

No se utiliza `synchronize`, `dropSchema` ni ejecución automática de
migraciones.

## Administrador inicial

El comando `pnpm identity:bootstrap-admin`:

- crea la cuenta cuando no existe;
- valida la contraseña cuando ya existe;
- solo restablece una contraseña con autorización explícita;
- solo reactiva una cuenta con autorización explícita;
- crea o activa el rol `ADMIN`;
- crea el permiso `system.admin`;
- asigna el rol y permiso al administrador.

La contraseña nunca se imprime ni se almacena en el repositorio.

## Ejecución local

```bash
pnpm auth:local:up
pnpm auth:local:status
pnpm auth:local:down
```

Direcciones:

- `http://127.0.0.1:4200/sign-in`
- `http://127.0.0.1:4200/workspace`
- `http://127.0.0.1:3000/api/v1/health`
- `http://127.0.0.1:3001/api/v1/health`
