# Contrato de salida de IA

## Objetivo

La IA devolverá contenido estructurado compatible con el esquema JSON de
la plantilla 1.0.0. No devolverá únicamente texto libre.

## Reglas

- Responder en español formal y claro.
- Mantener las trece secciones.
- No inventar información.
- Marcar datos faltantes con `[PENDIENTE POR DEFINIR]`.
- Incluir evidencias mediante identificadores técnicos.
- Separar hechos, inferencias, contradicciones y preguntas abiertas.
- No aprobar automáticamente.
- No cambiar el texto fijo de las secciones 11, 12 y 13.

## Resultado por campo generado

Cada valor generado podrá conservar metadatos técnicos:

```json
{
  "value": "El sistema deberá registrar la aprobación.",
  "status": "PROPOSED",
  "sourceIds": ["source-uuid"],
  "confidence": 0.88,
  "requiresHumanReview": true,
  "contradictionIds": [],
  "generatedBy": {
    "model": "model-id",
    "promptVersion": "1.0.0"
  }
}
```

Estos metadatos no crean columnas ni secciones visibles adicionales.

## Estados permitidos

- `PENDING_INFORMATION`
- `PROPOSED`
- `HUMAN_EDITED`
- `VALIDATED`
- `APPROVED`
- `REJECTED`

La IA solo podrá producir `PENDING_INFORMATION` o `PROPOSED`.

## Contradicciones

Cuando dos fuentes sean incompatibles:

1. Se conservan ambas evidencias.
2. Se describe la contradicción.
3. Se crea un pendiente.
4. No se selecciona una versión como verdadera sin decisión humana.
