# Observabilidad operativa

Cada backend ofrece tres señales sin autenticación para probes internos:

- `/api/v1/health`: proceso disponible.
- `/api/v1/health/ready`: aplicación inicializada y lista para recibir tráfico.
- `/api/v1/metrics`: métricas Prometheus agregadas.

Las métricas cubren solicitudes por método y clase HTTP, duración, operaciones de análisis IA y exportación, trabajos de cola y conexión del worker. No usan rutas, correos, usuarios, proyectos, documentos, prompts, respuestas ni identificadores como etiquetas. Redis, SQL, Blob y Service Bus deben complementarse con métricas administradas de Azure.

Los logs funcionales usan JSON estructurado y `correlationId`. En producción se envía stdout/stderr a Log Analytics y Application Insights u OpenTelemetry; nunca se registran cookies, JWT, contraseñas, claves de API, contenido documental o cadenas de conexión.

Alertas mínimas recomendadas:

- tasa 5xx superior al 2 % durante cinco minutos;
- worker desconectado o cola sin progreso;
- cinco fallos consecutivos de IA o exportación;
- latencia p95 fuera del objetivo del servicio;
- probe readiness fallido en dos intervalos;
- capacidad de SQL, Storage, Redis o Service Bus superior al 80 %.
