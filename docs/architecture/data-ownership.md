# Propiedad de datos

## Regla principal

Cada servicio será el único autorizado para escribir y consultar sus
tablas operativas.

Un servicio nunca deberá:

- Usar repositorios TypeORM de otro servicio.
- Compartir entidades TypeORM entre dominios.
- Crear claves foráneas entre bases distintas.
- Ejecutar SQL sobre una base ajena.
- Usar transacciones distribuidas entre servicios.
- Consultar directamente la base de Dynamics 365.

## Referencias externas

```text
organizationId
userId
projectId
sourceId
documentId
templateVersionId
analysisId
erpSnapshotId
erpCapabilityId
workflowId
exportId
```

## Consistencia

- Consistencia eventual.
- Outbox Pattern.
- Consumidores idempotentes.
- Reintentos controlados.
- Dead-letter queues.
- Procesos compensatorios cuando corresponda.

## Conocimiento ERP

El ERP Knowledge Service almacenará conocimiento versionado y snapshots,
no una copia operativa completa del ERP.

Cada snapshot registrará sistema, ambiente, fecha, método de extracción,
versión, alcance, responsable, validación y sensibilidad.
