# ADR-0012: Azurite para almacenamiento local

## Estado

Aceptada.

## Contexto

La producción utilizará Azure Blob Storage. El desarrollo necesita un
emulador local compatible con las APIs de Azure Storage.

## Decisión

Azurite será el almacenamiento local para Blob, Queue y Table Storage.
MinIO se retira de la arquitectura prevista.

## Consecuencias

- El código local utilizará contratos de Azure Storage.
- Los datos se conservarán en un volumen Docker.
- Las diferencias entre el emulador y Azure deberán validarse en pruebas
  de integración contra un ambiente real antes de producción.
