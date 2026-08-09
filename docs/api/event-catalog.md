# Catálogo de eventos de integración V1

## Sobre estándar

```json
{
  "eventId": "uuid",
  "eventName": "source.ready",
  "eventVersion": 1,
  "occurredAtUtc": "2026-08-09T00:00:00Z",
  "producer": "sources-service",
  "correlationId": "uuid",
  "causationId": "uuid-opcional",
  "organizationId": "uuid-opcional",
  "data": {}
}
```

`eventName` también es la routing key. La versión viaja en
`eventVersion`; no se agrega el sufijo `.v1` al nombre. RabbitMQ usa el
exchange durable `rq.integration.v1`.

## Eventos implementados

| Evento                     | Productor   | Propósito                             |
| -------------------------- | ----------- | ------------------------------------- |
| `source.ready`             | Sources     | fuente extraída y lista para análisis |
| `analysis.requested`       | AI Analysis | solicitud persistida y encolada       |
| `analysis.started`         | AI Analysis | intento real iniciado por el worker   |
| `analysis.completed`       | AI Analysis | resultado estructurado persistido     |
| `analysis.failed`          | AI Analysis | intento final fallido y sanitizado    |
| `review.requested`         | Workflow    | documento enviado a revisión          |
| `review.changes-requested` | Workflow    | revisor solicitó correcciones         |
| `document.approved`        | Workflow    | versión aprobada e inmutable          |
| `document.rejected`        | Workflow    | revisión rechazada                    |
| `export.requested`         | Operations  | solicitud de exportación encolada     |
| `export.completed`         | Operations  | artefacto PDF/DOCX disponible         |
| `export.failed`            | Operations  | generación agotó sus reintentos       |

Operations consume los eventos que generan notificaciones o auditoría. Su
inbox tiene unicidad por `eventId`, valida la pareja productor/evento y mueve
errores temporales a una cola de retry con intentos acotados.

## Reglas

- El nombre describe un hecho ya ocurrido.
- El contrato y el sobre se versionan.
- El payload es mínimo y usa referencias externas, no entidades compartidas.
- No se publican archivos, secretos, JWT, cookies, prompts o contenido completo.
- Publicación y consumo conservan `correlationId` y `causationId` cuando aplica.
- Los consumidores son idempotentes; RabbitMQ no contiene reglas de negocio.
- La desactivación local del broker no cambia la transacción del dominio.

## Eventos futuros

ERP Knowledge podrá agregar eventos de snapshot y fit-gap únicamente cuando
exista un alcance empresarial aprobado. No forman parte del contrato V1 activo.
Azure Service Bus conservará semántica y versión al reemplazar el transporte
RabbitMQ durante el despliegue.
