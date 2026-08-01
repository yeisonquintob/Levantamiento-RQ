# Seguridad

## Autenticación

- Access tokens de corta duración.
- Refresh token en cookie HttpOnly.
- Cookie Secure en HTTPS.
- Contraseñas nunca en texto plano.
- Sesiones revocables.

## Autorización

Se evaluarán permiso funcional, organización, participación, rol dentro
del proyecto, estado del recurso y propiedad de la operación.

## Secretos

No se almacenarán en Git claves de OpenAI, contraseñas SQL, tokens,
certificados privados ni credenciales de Redis, RabbitMQ, MinIO o
Dynamics.

## Auditoría

Se registrarán usuario, organización, acción, recurso, fecha UTC,
resultado, Correlation ID y fuentes utilizadas cuando corresponda.

## Conocimiento ERP

- La IA no tendrá acceso directo a producción.
- Las importaciones serán explícitas y auditadas.
- Los snapshots podrán anonimizarse.
- Se excluirán datos transaccionales innecesarios.
- Cada fuente tendrá nivel de sensibilidad.
- Los resultados fit-gap requerirán validación humana.
