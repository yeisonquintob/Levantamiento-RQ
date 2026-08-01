# ADR-0011: Infraestructura local compatible con ARM64

## Estado

Aceptada.

## Contexto

El equipo principal de desarrollo es un Mac con procesador Apple Silicon.
Las imágenes de SQL Server para Linux están soportadas en hosts x86-64,
no en emulación o traducción ARM64.

## Decisión

La infraestructura local ejecutará Redis, RabbitMQ y Azurite de forma
nativa en Docker ARM64.

SQL Server o Azure SQL será remoto durante el desarrollo. No se añadirá
un contenedor SQL local no soportado.

## Consecuencias

- El entorno local evita emulación de SQL Server.
- Se requiere conectividad con la instancia SQL cuando se implementen
  los servicios.
- En el Paso 4 no se crean bases de datos.
