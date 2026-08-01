# Contratos HTTP

## Convenciones

- Prefijo público: `/api/v1`.
- JSON como formato inicial.
- Fechas UTC en ISO 8601.
- Identificadores como cadenas opacas.
- Paginación consistente.
- Correlation ID en solicitud y respuesta.
- OpenAPI generado por el Gateway.
- Errores con estructura uniforme.

## Respuesta paginada

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "totalItems": 0,
  "totalPages": 0
}
```

## Error

```json
{
  "type": "https://errors.levantamiento-rq.local/validation",
  "title": "La solicitud no es válida",
  "status": 400,
  "detail": "Uno o más campos presentan errores.",
  "instance": "/api/v1/projects",
  "correlationId": "uuid",
  "errors": {
    "name": ["El nombre es obligatorio."]
  }
}
```
