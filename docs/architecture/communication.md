# Comunicación

## HTTP síncrono

Se utilizará para respuestas inmediatas: iniciar sesión, consultar
proyectos, guardar secciones, consultar documentos, buscar capacidades
ERP o solicitar operaciones.

Reglas: `/api/v1`, tiempos de espera, reintentos solo seguros,
Correlation ID obligatorio y errores uniformes.

## Eventos de integración

Se utilizarán para hechos como fuente procesada, análisis completado,
snapshot ERP importado, documento aprobado o PDF generado.

Los eventos serán versionados, mínimos, sin secretos ni archivos
completos, publicados mediante Outbox y consumidos de forma idempotente.

## BullMQ

Se reservará para extracción, conversión, indexación, importación de
snapshots ERP, análisis con IA, fit-gap, PDF y notificaciones.

BullMQ no reemplaza el bus de eventos entre servicios.

## Matriz

| Necesidad | Mecanismo |
|---|---|
| Respuesta inmediata | HTTP |
| Comunicar un hecho | Evento |
| Trabajo largo o reintentable | BullMQ |
| Consultar datos del propietario | API interna |
| Compartir entidades de negocio | No permitido |
| Importar conocimiento ERP | Trabajo controlado |
