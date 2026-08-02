# ADR-0020: OpenAPI y Swagger en todos los servicios backend

## Estado

Aceptada.

## Decisión

Los nueve servicios NestJS publicarán OpenAPI y Swagger UI únicamente en
`development`. Cada servicio conserva su propio documento. El Gateway describe
cookies HttpOnly e Identity Service describe Bearer para contratos internos.

## Consecuencias

- Cada API puede validarse independientemente.
- Swagger no se habilita automáticamente en producción.
- Los ejemplos no contienen secretos ni credenciales reales.
- La documentación no reemplaza las pruebas automatizadas.
