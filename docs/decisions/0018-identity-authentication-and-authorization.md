# ADR-0018: Identidad, autenticación y autorización

## Estado

Aceptada.

## Decisión

Identity Service será el único propietario de usuarios, roles, permisos y
sesiones de renovación.

El Gateway será el único punto externo para iniciar, renovar y cerrar sesión.
El frontend nunca accederá directamente a Identity Service.

Las contraseñas se protegerán con scrypt y sal aleatoria. Los access tokens
serán JWT de corta duración y los refresh tokens serán JWT rotatorios
registrados mediante hash en RqIdentityDb.

El Gateway almacenará los tokens en cookies HttpOnly. La presencia de una
cookie en el frontend solo permite navegación preliminar; la autorización
definitiva siempre pertenece al backend.

## Consecuencias

- El Gateway permanece sin persistencia.
- No se comparten entidades de identidad con otros servicios.
- No se crean credenciales predeterminadas.
- Los secretos no forman parte del repositorio.
- La autenticación puede permanecer deshabilitada mientras no exista una
  conexión válida a RqIdentityDb.
- Microsoft Entra ID, MFA, recuperación de contraseña e invitaciones quedan
  fuera de este paso.
