# ADR-0019: Activación real y bootstrap del administrador

## Estado

Aceptada.

## Decisión

La activación local de identidad se realizará mediante configuración de
entorno ignorada por Git y comandos operativos explícitos.

La creación de `RqIdentityDb`, cuando sea necesaria, requerirá autorización
expresa. Las tablas se aplicarán únicamente mediante migraciones TypeORM.

El primer administrador se preparará mediante un proceso idempotente que
valida la contraseña existente y exige autorización para restablecerla o
reactivar la cuenta.

## Consecuencias

- Los secretos JWT y las credenciales SQL no forman parte del repositorio.
- El Gateway continúa sin base de datos.
- `identity-service` mantiene la propiedad exclusiva de `RqIdentityDb`.
- No se crean usuarios ni contraseñas predeterminadas.
- La base real no se elimina ni se revierte automáticamente ante fallos
  posteriores.
- El entorno local utiliza cookies `HttpOnly` sin `Secure`; producción deberá
  usar HTTPS y `AUTH_COOKIE_SECURE=true`.
