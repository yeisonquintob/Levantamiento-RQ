# Catálogo inicial de eventos

## Sobre estándar

```json
{
  "eventId": "uuid",
  "eventName": "source.processed",
  "eventVersion": 1,
  "occurredAtUtc": "2026-08-01T00:00:00Z",
  "producer": "sources-service",
  "correlationId": "uuid",
  "causationId": "uuid",
  "organizationId": "uuid",
  "data": {}
}
```

## Eventos iniciales

- `user.created.v1`
- `user.disabled.v1`
- `project.created.v1`
- `project.updated.v1`
- `source.uploaded.v1`
- `source.processed.v1`
- `analysis.requested.v1`
- `analysis.completed.v1`
- `analysis.failed.v1`
- `erp-knowledge.snapshot-imported.v1`
- `erp-knowledge.snapshot-validated.v1`
- `erp-knowledge.fit-gap-completed.v1`
- `document.draft-created.v1`
- `document.version-created.v1`
- `review.requested.v1`
- `document.approved.v1`
- `document.rejected.v1`
- `export.requested.v1`
- `pdf.generated.v1`
- `notification.delivered.v1`

## Reglas

- El nombre describe un hecho ocurrido.
- El contrato se versiona.
- El payload es mínimo.
- No se envían archivos completos ni secretos.
- Cada consumidor debe ser idempotente.
