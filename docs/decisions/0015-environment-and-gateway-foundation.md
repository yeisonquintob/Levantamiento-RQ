# ADR-0015: Variables de entorno y base técnica del Gateway

## Estado

Aceptada.

## Decisión

Las aplicaciones cargarán configuración local desde archivos `.env` sin
reemplazar variables entregadas por el entorno de ejecución. La validación
base se centraliza en `shared-config`.

El Gateway utilizará configuración tipada para host, puerto, prefijo y
versión. También registrará globalmente correlación HTTP y respuestas Problem
Details mediante `shared-http`.

## Consecuencias

- Los servicios fallan al iniciar cuando la configuración base es inválida.
- Los secretos no se publican.
- Las respuestas HTTP del Gateway tienen trazabilidad uniforme.
- Autenticación, enrutamiento y persistencia quedan para pasos posteriores.
